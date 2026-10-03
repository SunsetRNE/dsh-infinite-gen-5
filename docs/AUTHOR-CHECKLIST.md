# 作者自检清单（改动前 / 改动中 / 发版前 / 装机后）

> 从 26 条实战问题里抽出来的作业法。总纲一句话：
> **先查「既有取值」与「是不是已经全局存在」，再决定加不加 —— 加之前先证明它不是在制造重复。**
> 每条后面的括号是它来自哪次事故（编号对应工作区文档 `问题与坑-2026-10-02.md`）。

## A. 改动前 · 五问

| # | 问 | 怎么查（可跑） | 源自 |
| --- | --- | --- | --- |
| A1 | 要加的东西，宿主/上游**是否已经全局存在**？ | `git show upstream/main:<file> \| sha256sum`；`grep -rn "<关键词>" /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*/lib/` | 预设话题（#26） |
| A2 | 要用的**数字/段号/名字**，既有取值表里有没有？ | 读宿主段序表：`grep -n "SECTION_ORDERS" -A6 .../dsh-system-prompt/lib/index.js`（10000 HARNESS_SOURCE / 10100 WEB_SURFACE / 10200 PERSONA_SUFFIX） | 段序 10100 撞号（#21） |
| A3 | 对方**当前版本与源码形状**是什么？ | `npm run sync:upstream`（拼图侧）；`git show upstream/main:lib/index.js \| grep -n "ORDER"` | 提取器读出 NaN（#23） |
| A4 | 这条判据的**条数/期望值**会不会随「对方是否在场」变化？ | 两条分支各跑一遍（拼图侧 `IG5_PEER_OFF=1`）；CI 上对方必然不在场 | 本地绿 / CI 红（#19） |
| A5 | 我改的是**哪个面**：组合 / 权限 / 提示文本？ | 组合归 Agent preset、审批归 permission preset、文本归 `systemPrompt.section` —— 三面别混 | 预设话题（#26） |

## B. 改动中 · 三不

| # | 不做 | 为什么 | 源自 |
| --- | --- | --- | --- |
| B1 | **不把数字写进提示文案**（一律插值） | 改常量时那行不会跟随，自检当场报错 | `arbitrationLine()` 写死 10100（#22） |
| B2 | **不在 global 与 preset 两处都挂**同一插件 | `tools` / `systemPrompt.section` 同族契约：「global 与 matching scoped providers **都贡献**」→ 两份 | preset 调查（U2′，#26） |
| B3 | 合并 `package.json` 后**不 `tar tzf` 核包就不发版** | `files` 字段最容易被上游版静默覆盖（装出来 `npm test` 直接 ENOENT，回归过一次） | 包内容回归（#25 附带） |

## C. 发版前 · 四查

| # | 查 | 命令 / 判据 | 源自 |
| --- | --- | --- | --- |
| C1 | 聚合自检退出码 | `IG5_SKIP_LIVE_GOLDEN=1 npm run verify:all; echo $?` —— **别用管道之后的 `$?`**（那是 `tail` 的） | 管道吞退出码（#15） |
| C2 | 文档顺序与首行 | 先改 `UPDATE.md` / `VERSIONS.md` → `npm run tools:doc` **两遍**（第二遍应打 `过期=无`）→ `npm run changelog`；**`UPDATE.md` 首行不写反引号**（生成器会剥掉，导致 `docs/INDEX.md` 判过期） | 顺序刚性（#13）· 首行反引号（#18） |
| C3 | 对方在场 / 不在场两条分支 | 见 A4；只在本机验过的分支不算验过 | #19 |
| C4 | 发版脚本指向**自己的仓库** | `RELEASE_REPO=<owner>/<repo> GITHUB_TOKEN_FILE=<token 文件> bash tools/release.sh <tag>`；附件要单独传（脚本不做） | 上游脚本写死上游仓（#25） |
| C5 | 发版前自检要**在聚合之外**单独跑一次 | `bash skills/ig5-layer-05-release/scripts/verify-release-ready.sh`（跑仓库自带那份；装好的副本按自身位置推导根，会误报） | #14 · #18 |

## D. 装机后 · 三验

| # | 验 | 命令 / 判据 | 源自 |
| --- | --- | --- | --- |
| D1 | 逐字节一致 | 装机位与仓库 HEAD 各算 `sha256sum lib/*.js`，两侧相等 | 装机核验（#24/#25） |
| D2 | 用**新版独有行为**判生效 | 例：拼图 `puzzle_mode(op:scan)`（0.20.7 独有）；**不要**看 `~/.dsh/plugin-activations.json` 里的 `version`（那是安装记录，不是运行版本） | 装机核验（#25 附带） |
| D3 | 是否需要重启看 `lib/` | `git diff <新>^ <新> -- lib/` 为空 → 无需重启；非空 → 必须重启 profile | 0.22.0→0.22.1 无需重启（#25 附带） |

## E. 相关脚本（本仓已有，直接调）

```bash
npm run verify:all                 # 聚合自检（CI 等价）
bash skills/ig5-layer-05-release/scripts/verify-release-ready.sh   # 发版前自检（13 项）
npm run sync:local:apply           # 仓库 → 运行副本（改完服务端要重启 DSH）
npm run release:backfill -- --tag=vX.Y.Z [--skip-selfcheck] [--dry-run]   # tag 已推但 Release 缺失/不齐
```

跨仓（拼图复刻仓）常用两条：

```bash
cd /root/S/dsh-puzzle-mode-2
npm test && npm run verify:cross   # 上游全链 + 握手校验
npm run log:compat                 # 互校归档一行（结论应为 ok）
```
