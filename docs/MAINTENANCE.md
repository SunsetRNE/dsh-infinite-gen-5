# 🔧 维护与发版

> 本文件由根目录 `README.md` 拆出（v0.44.0，机械切片，正文逐字保留）。返回 [README](../README.md) · 全量原文归档 [README-FULL.md](README-FULL.md)。

### 开发循环：改仓库 ≠ 改线上（而且不重启就不生效）

「装在哪、谁负责更新」有三种接线，`verify:install` 都能认出来（混用会告警）：

| 接线 | profile 依赖 | 接线入口 | 谁负责更新 |
|---|---|---|---|
| **管理器式**（宿主插件管理器的「链接安装 / 更新」写入） | `link:<dshHome>/plugin-src/dsh-infinite-gen-5` | `dsh.profile.bundles` | 宿主插件管理器（按 `~/.dsh/plugin-sources.json` 里记的 GitHub 地址拉新版） |
| install.sh 式（本仓库脚本写入） | `file:../../plugins/dsh-infinite-gen-5` | profile `cordis.patch.yml` 的 insert 条目 | 本仓库 `./install.sh` |
| dev 热链接（开发期临时） | 上述任一位置换成指向仓库的软链 | 与软链同侧 | 无人——改仓库即刻可见 |

所以「改仓库」和「改线上」是两件事：**不重装、不重启，就不生效**。

```bash
npm run verify:all     # 1) 本地全量自检（与 CI 同一入口）
./install.sh           # 2) 只有 install.sh 式需要：覆盖 ~/.dsh/plugins/ 副本（自动留 package.json 备份 + plugin-src 快照）
npm run verify:install # 3) 体检：加载的是哪棵树、与仓库对不对得上、接线有没有重复、进程是不是比那棵树更旧
# 4) 重启 DSH 进程，进 GUI 确认状态条 / 设置台
```

管理器式下有个坑值得记：插件的落点 `~/.dsh/plugin-src/dsh-infinite-gen-5` 必须是**实体副本**，不能是指向仓库的软链 —— 管理器的原位覆盖会失败（本机踩过：dev 热链接态下点「覆盖式更新」报错，只能卸载重装）。要用 dev 热链接开发，先 `npm run dev:restore` 把落点还原成实体。

`verify:install` 专治两种「看着装了其实没生效」：**装了没重启**（dsh web 进程启动时间早于运行时文件 mtime → 警告）与**接线漂移**（patch insert 与 `bundles` 双接线、依赖目标解析不到、`node_modules` 与依赖声明不是同一棵树）。缺 `~/.dsh` 时它打印 SKIP 并退出 0，所以 CI 上不会误伤；本地想把它当门禁用就加 `--strict`（警告也算失败）。

### 安装残留清理（clean:legacy）：把 ~/.dsh 里的备份一次列清

安装链路的每次迭代都会留备份（install.sh 的 `dsh-infinite-gen-5.bak-<ts>-pre-v<版本>` 快照、profile 的
`package.json.bak-<ts>`、dev-link 期的 `.bak-<ts>-pre-devlink`、仓库里验证热链接用的 `HOTLINK_PROOF.txt`）。
`verify:install` 会把这些报成警告但不替你删，所以配一个**默认只列、`--yes` 才删**的清理器：

```bash
npm run clean:legacy          # 只列：哪几类残留、各占多少、删掉能释放多少
npm run clean:legacy:force    # 真删（只删上面那几类）
```

安全边界（宁可少删）：profile 依赖解析到的那棵树、`~/.dsh/plugin-src/<插件>` 本体、
profile 自己的 `package.json` / `cordis.patch.yml` / `node_modules` 都不在清理范围内；
被 profile 依赖指向的落点只会被标成「跳过」。删完再跑一次 `npm run verify:install`，
残留警告应当归零。

### 把新版本铺进本机安装树（sync:local）：顺手把管理器的记账刷成一致

管理器式接线（profile 依赖 `link:<dshHome>/plugin-src/<name>`）下安装树是**实体副本**；手工 `tar` 铺过去之后，
宿主的插件管理器并不知道这件事 —— 它会继续显示上一次**它自己**装过的版本号，加载状态一栏也会因为
「记录里的指纹 ≠ 现树指纹」而被清空（本机就出现过「磁盘/活体 0.13.1，管理器里写着 0.12.4」）。
`sync:local` 一次做两件事：把仓库镜像进 dsh 实际加载的那棵树，并把激活记录里的 `version` + `fingerprint` 改成现树的值。

```bash
npm run sync:local         # 只读预览：哪棵树要同步、新增/更新/删除各几项、记录是否过期
npm run sync:local:apply   # 真铺 + 刷记录（改记录前先留一份 plugin-activations.json.bak-<时间戳>）
```

- **指纹算法是真货，不是占位**：`scripts/lib/tree-fingerprint.mjs` 复刻宿主 `~/.dsh/plugin-dependencies.py` 的
  `current()`（逐条 `['file',相对路径,mode,sha256]` 行 JSON 累进 → 单节点依赖图再哈希一次，非 ASCII 文件名按
  `\uXXXX` 转义）；`verify:sync` 会拿宿主**自己记过的指纹**当标准答案交叉验证，对不上就红灯。
- **只改两个字段**：`status` / `startup` / `confirmedAt` / `loadedAt` 一概不动 —— 那是「管理器上次安装」的记账，
  代签等于撒谎；`plugin-updates.json`（管理器去 GitHub 查过的结论）也不碰。
- **权限位也跟着仓库走**（v0.13.4）：宿主的指纹把 `mode` 算进去，所以内容没变、只有 `chmod` 变了也算「要更新」；
  目录权限同样显式对齐（`mkdir` 出来的目录权限受 `umask` 影响，不跟仓库走就会漂）。自检夹具也据此把目录权限
  定死成 0755 —— 之前正是这点让 CI 与本机算出两个不同的冻值（本会话 `umask` 是 0077，GitHub runner 是 0022）。
- **没登记就只告警**：管理器从没记过本插件时不新建条目，退出 0；`--no-record` 可以只铺树不碰记录。
- 同步完仍要**重启 DSH 进程**才加载新代码 —— `sync:local` 只保证「盘上是对的、记账是对的」。

### 开发热链接（dev-link）：改一行立刻可见，不必重跑安装

上面那条循环每轮都要 `./install.sh` + 重启，很钝。开发期可以切成**软链**（适用于 install.sh 式接线；管理器式下还要把 profile 依赖临时指向仓库，否则 `verify:install` 会报「`node_modules` 与依赖声明不是同一棵树」）：

```bash
npm run dev:link       # 切热链接：~/.dsh/plugins/dsh-infinite-gen-5 → 仓库根（原副本改名 .bak-*-pre-devlink 留存）
npm run dev:status     # 看现在是复制态还是热链接态（只读）
npm run dev:restore    # 切回去：删软链 + 重跑 ./install.sh 重建复制态
```

切换后：改 `index.js` / `prompts/**` **重启 DSH 进程**即生效；改 `client.js` **刷新页面**即生效（客户端半体由宿主按需加载）；`prompts` 与 `index.js` 的改动不再需要安装脚本。实证：在仓库根新建一个文件，`~/.dsh/plugins/dsh-infinite-gen-5/<同名文件>` 立刻可见，删掉即消失。

代价说清：① 没有安装脚本产生的防呆副本了，回滚靠 git（仓库本身有版本控制，`.bak-*-pre-devlink` 只留切换前那一份）；② profile 里再跑 `pnpm install` 会把 `node_modules` 的软链重建回普通副本，**重跑 `npm run dev:link` 即可**（`verify:install` 会明确报出这种「热链接被破坏」）；③ 半成品会被真加载 —— 别在热链接态下改一半就重启。发版前建议 `npm run dev:restore` 切回复制态，让基线回到「真实用户装出来的样子」。

### 发版三步（bump → changelog → release）

```bash
node scripts/bump-version.mjs X.Y.Z --dry   # 先看会改哪几处（不落盘）
node scripts/bump-version.mjs X.Y.Z         # 只改「当前版本锚点」，历史叙述不动
npm run changelog                           # 由 Conventional Commits 重生成 CHANGELOG.md
npm run verify:all                          # 必过；verify:version 会拦漏改
git add -A && git commit -m "feat(vX.Y.Z): <一句话>"
git push origin main
npm run release -- --yes --release          # 打 annotated tag vX.Y.Z + 推送 + 发 GitHub Release（gh 或 REST）
npm run release:pack                        # 可选：本地先打一份产物验证（CI 在 tag 推送时会自动打并上传）
```

`npm run release`（= `scripts/release.mjs`）默认只**预览**：先做前置检查（工作区干净、tag 不存在、本地与 origin 同步），再打印发布正文 ——
正文取自 CHANGELOG 里该版本那一段，但由 `scripts/lib/release-notes.mjs` **压缩成「只留最近更新」**（默认最多 5 条、每条 160 字、总量 900 字，末尾挂一行指针指回《更新文档》[`UPDATE.md`](../UPDATE.md)）。
加 `--yes` 才真打 tag 并推送；再加 `--release` 才发 GitHub Release；CHANGELOG 由 `scripts/changelog.mjs` 生成（版本段按提交标题里的 `(vX.Y.Z)` 作用域切分），别手改。
逐版的叙述（改了什么、为什么、自检项数怎么变）只有一处真源：`UPDATE.md`（速查见 [`VERSIONS.md`](../VERSIONS.md)）；不许再散落回 README / 产物描述 —— `npm run verify:notes`（35 项）会锁住这条。

**发 Release 的两条路**（`--release`）：

- 有 `gh` 且已登录 → 走 `gh release create`；
- **没装 `gh` 也能发** → 自动改用 GitHub REST（`POST /repos/<owner>/<repo>/releases`，owner/repo 从 `git remote origin` 解析）。凭据按这个顺序找，都找不到才降级打印提示：

  | 顺序 | 来源 |
  |---|---|
  | 1 | 环境变量 `GH_TOKEN` / `GITHUB_TOKEN` |
  | 2 | `GH_TOKEN_FILE` 指向的文件，或 `--token-file=PATH` |
  | 3 | 约定路径 `~/.local-gh/.token`（通用凭据目录，`chmod 600`） |

  本机的凭据已就位到通用路径 `~/.local-gh/.token`（原 `Branchbase/.local-gh/` 里留了同名符号链接，那套脚本照旧可用），所以什么都不用加：

  ```bash
  npm run release -- --release-only --release    # tag 已推过、只补 GitHub Release
  ```

  token 只用于这一次 POST、脚本不回显内容；Release 已存在时返回 422 只提示不改动。tag 早已推过、只想补 Release 时用 `--release-only`（跳过打 tag，但要求 tag 已存在）。

#### 发布产物：tag 一推，附件自己上去

`.github/workflows/release.yml` 在 push `v*` tag（或手动 dispatch）时自动跑：**全量自检 → 打包 → 上传到该 tag 的 Release**（Release 不存在就先建，正文用 `RELEASE-NOTES.md`）。四个附件：

| 附件 | 内容 |
|---|---|
| `dsh-infinite-gen-5-v<版本>.tar.gz` | 顶层目录 `dsh-infinite-gen-5/`，解开就能 `./install.sh`；**只有 git 跟踪的文件**（`ui-preview/`、`node_modules`、`.git` 天然不在内） |
| `dsh-infinite-gen-5-v<版本>.zip` | 同上，Windows 用户友好（runner 上没有 `zip` 就降级跳过） |
| `SHA256SUMS` | 两个包的 sha256 |
| `RELEASE-NOTES.md` | 该版本的**压缩版**发布正文：只留最近更新（最多 5 条 / 每条 160 字 / 总量 900 字）+ 一行指针指回仓库内《更新文档》[`UPDATE.md`](../UPDATE.md)；建 Release 时当正文 |

包内还随附完整叙述 `UPDATE.md`（逐版「改了什么、为什么」的唯一真源）与机械清单 `CHANGELOG.md`；产物描述不再复述历史。

本地同一条命令可复现，且**打完会解包复检**（在包里跑 `scripts/verify_version.mjs`，漏打文件就失败）：

```bash
npm run release:pack -- --out=dist
```

给历史 tag 补产物：Actions → release → Run workflow（填 tag），或 `gh workflow run release.yml -f tag=vX.Y.Z`。

> 补产物的前提是**那个 tag 的树自己能在 runner 上跑过 `verify:all`**（v0.12.1 起都满足）。卡住的情况有两类，各有一条出路：
>
> - **树里还没有打包脚本**（更早的 tag）：dispatch 时 runner 自动从 `main` 借一份 `scripts/package-release.mjs`，被打的仍是该 tag 的树（v0.12.0 就是这么补的）。
> - **树的自检夹具早于「确定性修复」**：夹具依赖 umask，同一棵树本地绿、runner 上必然红，直接 dispatch 会卡在自检那一步。两条出路：① 本地按该 tag 的树打包再传 —— `git worktree add --detach /tmp/wt vX.Y.Z` → 把 `scripts/package-release.mjs` 拷进去 → `node scripts/package-release.mjs --out=dist` → 用 REST `POST https://uploads.github.com/repos/<slug>/releases/<id>/assets?name=<文件名>` 传附件；② 仍走远端 —— dispatch 时勾上 **`skip_selfcheck`**，只跳那条已知为红的自检（打包器的解包复检照跑），Release 正文会自动挂一条「事后补发 · 自检为红」的标注，不让读者误以为这棵树在 CI 上是绿的。

`scripts/version-targets.mjs` 是「当前版本锚点」的唯一真源（`index.js` 的 `PLUGIN_VERSION`、`client.js` 的 `VERSION`、`cordis.patch.yml` 头注释、README / HARNESS_PLUGIN 标题、两个 verify 脚本头注释），改写器与自检共用它。README 版本沿革、`package.json` description、`ENV_PROBE.md` 里「随插件 v0.8.0 引入」、以及生成物 `CHANGELOG.md` 这类**记录当时**的版本号刻意不改、只在 `PROSE_ALLOWED_FILES` 里登记放行 —— 发版改写它们等于篡改历史。`verify_version.mjs` 另外断言：文档里不出现比当前更新的版本号、全仓没有未登记的版本号字面量（新增文件里硬写版本号会被抓出来）。

### 加新工具 / 改文档：工具面自洽（tools:doc → verify:tools）

工具注册表是「有哪些工具、各自判据是什么」的唯一真源：`scripts/tool-registry.mjs` 里每个脚本一行（只写分类，必要时覆盖判据），**用途与能力从文件本身现读** —— 所以文档不会与代码漂移。

```bash
# 1) 写完脚本，在注册表 OVERLAY 里加一行（分类；判据按 npm 别名自动推导，不合适才手写 judge）
# 2) 重新生成两份文档
npm run tools:doc                 # 写 docs/TOOL-PROTOCOLS.md 与 docs/INDEX.md
# 3) 门禁
npm run verify:tools              # 在册完整性 / 路径存在 / 能力可证实 / npm 别名 / 文档新鲜度（含反例自检）
node scripts/gen_tool_docs.mjs --json   # 机读：在册工具数、过期文件清单
```

`verify:tools` 判的是这几件事，任一失败即退出码非零：盘上每个 `scripts/**/*.mjs|.sh`（除 `scripts/lib/`）**要么在册要么按理由排除**；在册路径都存在；注册表声明的能力（`--json` / `--selftest` / `--apply`…）必须在文件文本里真的出现（写不出的能力）；`judge` 引用的 npm 别名与脚本路径都存在；命名协议的 `definedIn` 文件里有该协议字面量、协议文档存在；两份生成文档与生成器输出**逐字节一致**；`docs/` 下每个 Markdown 都出现在 `INDEX.md` 里。`--selftest` 会伪造一个能力声明与一个漏登记项，断言审计函数把它们都抓出来 —— 门禁自己也有判据。

冻结归档件的例外：`docs/README-FULL.md` 是拆分前的根 README 逐字存档，登记在 `version-targets.mjs` 的 `FROZEN_ARCHIVE_FILES`，**不参与版本字面量扫描、发版时也不改写**（改了就不再是存档）。要留新存档就另存一份新文件，不覆盖旧的。

### CI 门禁

`.github/workflows/verify.yml` 在 push 到 `main` / PR / 手动触发时跑 `npm run verify:all`。插件零依赖（只用 Node 内建模块、全部离线），所以 CI 不需要 `npm install`。指标基线在 `tests/eval-baseline.json`，`gate:eval` 会拦回退；指标提升属正当变更时，本地跑 `npm run baseline:eval` 重写基线并一起提交。

---
