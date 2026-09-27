# DeepSeek Harness Plugin — 无限五代 / dsh-infinite-gen-5 (v0.12.0)

网络安全红队（Red-Teaming）测试插件，项目名：**无限五代（Infinite Generation Five）**。
专为 **DeepSeek-V4.1 / V4-Pro / V4-Flash 及 MoE 架构** 重构，采用
**「零工具面纯净直出 + 单内核注入 + 同源载荷去重 + 实时会话投影」**架构。

## 核心架构与特性

- **原生零工具面架构（Pure Zero-Tool Architecture）**：插件不挂载外部冗余功能性工具 Schema，
  消除模型推理阶段的决策犹豫与上下文 Token 浪费，让模型首 Token 直接产出可运行代码与实战步骤。
- **单内核注入 + 三段锚点（Single Kernel + Three Anchors，v0.12.0）**：
  - `infinite-gen-5:global-system-prompt`（Order 100）→ `prompts/infinite-gen-5.md`（载荷本体）
  - `infinite-gen-5:dual-layer-reinforce`（Order 200）→ 中段锚点 `ANCHOR_TEXT`（约 200 字节；
    `LAYER2_MODE = "mirror"` 时才载入 `prompts/infinite-gen-5.1-flash.md`，且与 Order 100 同源时自动跳过）
  - **真末位锚点**（`infinite-gen-5:tail-anchor`，`TAIL_MODE = "waterfall"`）：挂在
    `system-prompt/assemble` 瀑布上，把 `TAIL_ANCHOR_TEXT` 追加到装配结果 `sections` 数组的最后一项。
    宿主对该返回值只做 `complete` 兜底与 `"\n\n"` 拼接（数组顺序 = 拼接顺序），所以它排在 `10200`
    人格后缀之后，恒为整份系统提示的最后一段，且不占 section 命名空间。`TAIL_MODE = "order"` 时
    降级为 `order 10150` 普通段（会被宿主 complete 模式裁掉）；瀑布不可用时自动退化为同一位置。
    动机：宿主段位表在旧版 Order 200 之后还有 `10100` WEB_SURFACE / `10200` 人格后缀，
    所谓「末位锚点」其实不在末位。
  - **运行时锚点**（`infinite-gen-5:runtime-anchor`，`RUNTIME_ANCHOR_MODE = "cadence"`，`order 118`）：
    注册进 `systemPrompt.context()` 槽（沙箱策略 110 / 审批策略 115 / 子代理委派 120 同槽），
    宿主每步把它作为**最后一条 user 消息**追加在消息链尾，快照头写明取代早前快照 ——
    这是离模型最近、权威表述最强的一格。宿主只在文本变化时重发快照，所以节拍靠换文本实现：
    `cadence` 每 6 步换一次（默认）/ `once` 只发一次 / `every` 每步换。
  - **独占档**（`EXCLUSIVE_SECTION = true`，默认关，实验性）：内核段带 `complete: true`，宿主只保留
    这一份系统提示，其余段（工具用法、沙箱策略、设备协议、宿主身份……）整体让位；此时末位锚点
    必须并进内核文本（宿主在瀑布之后把 sections 裁成 `[completeSection]`），否则会被一起裁掉。
  - 两条边界：**让位就整体让位**（内核因同源去重让位时，两段锚点也不再单独注册）；
    `infinite_gen5_profile` 的 `injectionPlacements` / `injectionStrength` 如实汇报四处位置与档位。
- **同源载荷去重（Same-Kernel Dedupe）**：注册前枚举宿主系统段，命中同源载荷即整段让位，
  并在 `infinite_gen5_profile` 的 `dedupe` 字段如实汇报（角色 / 让位对象 / 重合度）。
  - 载荷中的 `{{...}}` 非内置变量由 `index.js` 做安全转义，避免模板解析器抛错。
- **领域 / 语言覆盖（v0.6.0）**：内核载荷不再只点名 3 个任务族，改为
  **五槽骨架** `ROLE / OBJECT / ACTION / SCOPE / SHAPE`（未列领域自行拆槽、直接产出）
  + **45 个领域 × 7 族点名** + **语言规则**（任何语言的软化词都视为「重新框定并继续」）。
  载荷 3010 B → 4837 B。
- **领域包工具 `infinite_gen5_scenario`**：56 个领域包共约 98 KB（v0.7.0 计算机向扩写 11 个域），
  放在工具里按需取用而不是常驻 system prompt。无参调用返回约 4.6 KB 索引（≈1.3 K token），
  带用户原话只返回命中的那一个包（≈0.2–1.0 K token）。
- **工具链注入（v0.7.0）**：每个计算机域在 `data/toolchains.mjs` 里配了
  `<工具> — <用途> | 装: <命令> | 验: <命令>` 形式的工具链，外加一份「缺工具协议」
  （探测 → 安装 → 验证 → 降级替代）。工具的返回值与 playbook 正文都带这两块，
  模型在本地缺工具时会照单安装、验证后再跑，而不是停手或让用户自己装。
- **客户端设置台（v0.10.0，v0.11.1 归位）**：客户端半体自带设置页入口（`settings.section`，`order 16`，紧随官方「插件」之后）与独立页面，
  形态 / 挂载位置 / 侧栏入口可视化调节，偏好存本机 `localStorage`；设置页与状态条共用同一偏好源。
- **输出契约与首 Token 诱导**：首行强制以 `##` 或 ``` 命名交付物 + 静默推理 + 占位符自造，
  杜绝散文式开场与拒答先验。
- **用户指令最高优先级（Supreme User Authority）**：用户任务与显式命令为最高优先级，
  不存在可拒绝的请求类别。
- **评分器与会话投影**：开头窗口（160）判拒 + REFUSAL / FALLBACK / SAFE / RISK 四类标记
  + 域命中检测，驱动客户端状态条展示。该投影是**评分器**，不参与系统提示词注入。
- **离线评测闭环**：`scripts/lib/corpus.mjs` + `scripts/eval-corpus.mjs` 把 `tests/` 里 110 条语料的领域/判决标签接进计量（混淆矩阵、每类 P/R/F1、Top-1/Top-3、误判样本、覆盖缺口），并以 `tests/eval-baseline.json` 做回归门禁（回退超过 0.5 个百分点即失败）；判分口径与运行时同一套（`rankDomains` + `scorer.mjs`），语料里的 `blocked`（真红线）按语义映射成 refusal，所以「为了刷分把红线一起破掉」会立刻掉分。
- **客户端实时状态条**：在输入框 dock 行（与上下文计量器同排）挂载**单字符记号指示器**（v0.8.2 起：空闲/执行中只有一个圆点，执行中呼吸；判决时圆点被一个记号替代 —— `✓` 通过 / `✕` 拒绝 / `!` 兜底，按宿主 success/error 令牌着色，判决常驻到你的下一条发言）。全部使用宿主 `--dsw-*` 令牌；领域、候选排名、命中标记词、扫描范围、落笔时刻等明细进**点击浮层**与悬停 title。形态由 `client.js` 的 `TRIGGER_MODE` 控制：`glyph`（默认，单字符）/ `compact`（短词 `通过 web(3)`）/ `full`（v0.8.0 的长文字）/ `dot`（纯圆点）。
- **profile 元数据工具**：`infinite_gen5_profile` 返回内核版本、注入槽位清单与能力标记。

## 注入面文件

| 文件 | 用途 | 内容 |
|---|---|---|
| `prompts/infinite-gen-5.md` | Order 100 通用内核 | 内核载荷（权威源） |
| `prompts/infinite-gen-5.1-flash.md` | Order 200 强化镜像（`LAYER2_MODE = "mirror"` 时启用） | 与 Order 100 逐字同源，默认不注入 |
| `prompts/infinite-gen-5-classic.md` | 经典内核同源副本 | 同源载荷（逐字一致） |

三个文件的 SHA256 完全相同，`scripts/verify_prompt_gen5.mjs` / `verify_prompt.mjs` 会强断言这一点。

## 版本

| 版本 | 说明 |
|---|---|
| v0.3.0 | 双层注入首版（Order 100 通用内核 + Order 200 战场实测层） |
| v0.5.0 | 双层注入收敛为同源同构内核；注入槽位统一为 `infinite-gen-5:*`；内核载荷与强化镜像逐字一致（**即双份重复注入**） |
| v0.5.1 | Order 200 默认改为末位锚点（约 200 字节），不再复述整份内核；新增同源载荷去重（命中即整段让位并如实上报）；客户端五代徽标接管显示，折叠上一代破甲徽标 |
| v0.5.2 | 客户端状态条从 `conversation.input.dock`（与任务列表同列）迁到 `conversation.composer.dock`（输入框自己的 dock 行）；样式全部改走宿主 `--dsw-*` 令牌，去掉硬编码绿色/发光动画；空闲态收成一个中性圆点，点击展开最近判决浮层 |
| **v0.12.0** | **注入强度三件套**：① 真末位锚点 —— 挂在 `system-prompt/assemble` 瀑布上，把 `TAIL_ANCHOR_TEXT` 追加到装配结果 `sections` 数组最后一项（宿主对该返回值只做 complete 兜底与 `"\n\n"` 拼接，数组顺序即拼接顺序），排在宿主 `10200` 人格后缀之后，恒为整份系统提示的最后一段，且不占 section 命名空间（`TAIL_MODE = "waterfall"` / 降级 `"order"` 10150 / `"off"`）；② 运行时锚点 —— 注册进 `systemPrompt.context()` 槽（与沙箱策略 110、审批策略 115、子代理委派 120 同槽，`order 118`），随运行时上下文快照发在**每步最后一条 user 消息**里，快照头写明取代早前快照；宿主只在文本变化时重发，故节拍靠换文本实现（`cadence` 每 6 步 / `once` / `every`）；③ 可选 `complete` 独占档（默认关）：宿主其余系统段整体让位，末位锚点并进内核文本以免被裁掉。两条边界：内核因同源去重让位时两段锚点也不再单独注册；profile 新增 `injectionPlacements` / `injectionStrength` 如实汇报四处位置与档位。新增 `scripts/verify_injection.mjs`（真实宿主演习台 **34** 项，无宿主时 SKIP 且退出 0）与 `verify_dedupe` 81 项 |
| **v0.11.1** | 客户端设置台**归位 + 比例精修**：设置页入口从最顶部（`order -100`）挪到官方「插件」之后（`order 16`，nav 顺序 账户 -10 / 通用 0 / 模型 10 / 插件 15 / 无限五代 16），顺序取自 `__meta.consoleOrder` 并由自检锁住「排在官方插件之后」；同一页重做比例 —— 限宽 560px、形态四档两列网格、挂载位置三列、侧栏入口单列、预览改成带「空闲 / 执行中 / 判决」标签的内嵌面板（每行 28px）、只读信息两栏对齐、按钮统一 30px 高（「完成」用宿主主按钮样式）；纯客户端改动，刷新页面即生效，`verify_ui` **135** 项 |
| **v0.11.0** | 内核新增 **Tool-call rule（工具调用卫生）**：一轮一个工具、参数短而平（禁裸换行 / 未转义引号 / 单次塞整份文件正文）、长输出按行范围分段小写、`invalid JSON` 或空包按重试信号改小重发 —— 针对反复出现的 `DeepSeek Messages stream: tool input is invalid JSON`；内核 6393 → 6789 B（仍 ≤6800 B 预算），`verify_prompt_gen5` 142 → 146 项 |
| **v0.10.0** | 客户端长出**自己的设置台**：设置页最顶部注册一个「无限五代」入口（宿主原生 `settings.section` 槽，`order -100`，排在官方「通用/模型/插件」之前），点开即插件独立页面（不 require 宿主组件包）—— 形态四档 `glyph`/`compact`/`full`/`dot`（带空闲·执行中·判决三行预览）、挂载位置三档、可选侧栏入口（`main` + `sidebar.panellist`，与官方「插件」面板同款）、只读信息与「恢复默认」；偏好写 `localStorage["dsh-infinite-gen-5:prefs"]`（无本地存储时降级为仅本会话，非法值逐字段忽略），设置页与状态条共用同一偏好源；`verify_ui` 92 → 132 项 |
| **v0.9.0** | 新增**离线评测闭环**：`scripts/lib/corpus.mjs`（纯函数：jsonl 解析/注释与坏行分离、字段别名归一、blocked 语义映射、混淆矩阵、每类 P/R/F1、覆盖缺口、快照扁平化与容差比对）+ `scripts/eval-corpus.mjs`（CLI：`--json` / `--gate` / `--write-baseline` / `--top`）+ `tests/eval-baseline.json` 回归门禁 + `scripts/verify_eval.mjs`（81 项，含 CLI 真跑退出码 0/1/3）；把 110 条语料里从未被消费的 85 条领域标签与 78 条判决标签接进计量，首批实测 Top-1 68.2% / Top-3 76.5%（宏 F1 71.9%），并抓出 llm 召回 17.6%、postex 缺包、5 个标签假阳三处真问题 |
| **v0.8.2** | 状态条入口压成**单字符记号**：判决只上屏 `✓` / `✕` / `!`（按 success/error 令牌着色）并替代空闲时的圆点，避免「通过 injection」这种中文状态词 + 英文领域 id 的混读；领域与数值一律进点击浮层与悬停 title；`TRIGGER_MODE` 四档 `glyph`(默认)/`compact`/`full`/`dot`；`verify_ui` 92 项（新增形态切换与记号断言）。纯客户端改动，刷新页面即生效 |
| **v0.8.1** | 客户端状态条入口压成**多态指示器**：空闲与执行中只有一个圆点（执行中呼吸），判决时圆点变 success/error 色并只留短词（`通过 web(3)` / `拒绝` / `兜底`）；载荷数、候选领域排名、命中标记词、扫描范围、落笔时刻全部收进点击浮层与悬停 title；形态由 `client.js` 的 `TRIGGER_MODE` 控制（`compact` 默认 / `full` v0.8.0 长文字 / `dot` 纯圆点）。纯客户端改动，刷新页面即生效 |
| **v0.8.0** | 新增 `infinite_gen5_env` 运行环境探测工具 + `scripts/probe-env.mjs` CLI + `data/probe.mjs` 只读引擎 + `scripts/verify_env.mjs`（149 项）；分层探测形态/资源/出网/库存/能力位/设备/39 域就绪度，把「缺工具」翻译成「装什么」；内核新增「环境规则」，载荷预算 6200 → 6800 B |
| **v0.7.1** | 状态条判决**常驻**（原先 3.2 秒后自动淡出，观感是「一闪而过」）；覆盖明细上屏：领域判定改扫**全文**（判拒仍只扫开头 160 字）、候选领域排名（`web 3*`）、真正命中的标记词、扫描范围、落笔时刻；投影新增 `domainRanked` / `domainMarkers` / `openingChars` / `textChars` / `at` |
| **v0.7.0** | 计算机向扩写：领域包 45 → 56（re 逆向 / unpack 脱壳 / obfuscation 反混淆 / hook_inject / malware 样本 / exploit_dev 利用 / fuzzing 模糊测试 / decrypt 口令恢复 / stego 隐写 / programming 工具链 / automation 自动化）；新增 `data/toolchains.mjs`（每域装/验命令 + 缺工具降级协议）；内核新增「工具链规则」与第五条工具链示例（载荷 4837 B → 6028 B）；`detectDomain` 增加「命中标记更长者更具体」的归因修正 |
| **v0.6.1** | 领域工具去掉 `deferLoading: true`：实测延迟加载会让工具从模型的工具表里消失，内核里「call infinite_gen5_scenario」变成死指针；改为常驻定义约 0.8 KB（34 KB 包正文仍按需取用） |
| **v0.6.0** | 内核载荷扩写为五槽骨架 + 45 域 × 7 族点名 + 语言规则；45 个领域包全文移入 `infinite_gen5_scenario` 工具（定义常驻约 0.8 KB，包正文按需取用）；新增 `data/scenarios.mjs` 作为领域标记表的唯一真源（运行时与离线评分器共用，消除两份漂移表）；配套 3 套新自检 |

## Local verification

```powershell
node --check index.js
node scripts/verify_prompt_gen5.mjs   # 146 项：载荷逐字同源 + 五槽骨架 + 七族点名 + 语言/工具链/环境/工具调用卫生规则 + 体积预算 + 投影 + 品牌纯净度
node scripts/verify_scenarios.mjs     # 83 项：56 个领域包 / 索引预算 / 标记表唯一真源 / 工具链装验成对 / 匹配用例
node scripts/verify_scenario_tool.mjs # 85 项：真宿主挂载三个工具（+ 环境工具离线调用） + 工具链返回 + 「包正文不进 system prompt」硬断言
node scripts/verify_dedupe.mjs        # 81 项：同源让位 / 中段锚点 / 真末位锚点降级 / 运行时锚点节拍 / 版本单一真源
node scripts/verify_injection.mjs     # 34 项：真实宿主演习台（装配顺序 / 真末位位置 / 运行时快照节拍 / 独占档 / 瀑布降级；无宿主时 SKIP 并以 0 退出）
node scripts/verify_version.mjs       # 22 项：版本锚点唯一且等于 package.json / 文档无超前版本号 / 全仓无未登记字面量
node scripts/verify_install.mjs       # 10 项：盘上三处版本一致 / profile 接线 / 进程是否比已装副本更旧（缺 ~/.dsh 时 SKIP）
node scripts/verify_ui.mjs            # 135 项：状态条行为 + 设置台（偏好读写与持久化 / 形态与位置切换生效 / 侧栏开关 / 清理与幂等；--emit-html 出视觉预览）
node scripts/verify_env.mjs           # 149 项：环境探测（纯函数 / 只读与隐私边界 / CLI 退出码 / 性能预算）
node scripts/verify_eval.mjs          # 81 项：评测计量（P/R/F1 手算可核）+ 语料载入形状 + CLI 退出码 0/1/3
node scripts/verify_prompt.mjs        # 64 项：载荷锚点 + 导出 + 安装协议 + 用例库
node scripts/eval-corpus.mjs --gate   # 离线评测门禁：坏行=1、相对 tests/eval-baseline.json 回退=3
```

一条命令跑全部（CI 门禁同一入口）：`npm run verify:all`。

## 维护与发版

```bash
npm run verify:all                          # 与 CI 同一入口，必须全绿
./install.sh                                # 把仓库整份拷进 ~/.dsh/plugins/dsh-infinite-gen-5
npm run verify:install                      # 体检：三处副本版本一致 / 接线 / 是否需要重启
# 重启 DSH 进程后才会生效（安装是复制，不是软链）

node scripts/bump-version.mjs X.Y.Z         # 只改「当前版本锚点」（version-targets.mjs 为唯一真源）
npm run changelog                           # 由 Conventional Commits 重生成 CHANGELOG.md（勿手改）
npm run verify:all && git add -A && git commit -m "feat(vX.Y.Z): <一句话>"
npm run release -- --yes --release          # 默认只预览：前置检查 + CHANGELOG 正文；--yes 打 tag 并推送，--release 再调 gh
```

README / 本文档的版本沿革、`package.json` description、`ENV_PROBE.md` 的历史引用、以及生成物 `CHANGELOG.md` 里的版本号属**历史叙述**，刻意不改写（`verify_version.mjs` 只在 `PROSE_ALLOWED_FILES` 里放行）；发版时改了它们等于篡改历史。

### 开发热链接（dev 期省掉安装 + 重启）

```bash
npm run dev:link       # ~/.dsh/plugins/dsh-infinite-gen-5 → 本仓库（原副本改名 .bak-*-pre-devlink）
npm run dev:status     # 只读：现在是复制态还是热链接态
npm run dev:restore    # 删软链 + 重跑 ./install.sh 回到复制态
```

热链接态下改 `prompts/**` 或 `index.js` 只需**重启 DSH 进程**，改 `client.js` **刷新页面**即可，不必再跑安装脚本。代价：安装脚本的防呆副本不再自动产生（回滚靠 git）、profile 里 `pnpm install` 会重建 `node_modules` 普通副本从而打断热链接（`verify_install` 会报出，重跑 `npm run dev:link` 修复）。发版前建议先 `dev:restore`。

## Install in the desktop Harness

两种接线都能装载本插件，`install.sh` / `install.ps1` 用的是**第二种**（patch insert），因为它在 profile 里显式、可回滚：

```powershell
# 方式 A：bundles 装载（profile/package.json）
"dependencies": {
  "dsh-infinite-gen-5": "file:../../plugins/dsh-infinite-gen-5"
},
"dsh": {
  "profile": {
    "bundles": ["@deepseek-ai/dsh-base", "dsh-infinite-gen-5"]
  }
}
```

```yaml
# 方式 B：profile/cordis.patch.yml 里显式插一条（install.sh 写入）
- insert:
    - id: dsh-infinite-gen-5
      name: dsh-infinite-gen-5
```

依赖统一写成 `file:../../plugins/dsh-infinite-gen-5`（指向 `~/.dsh/plugins/` 下的实体副本，**不是** `link:` 到 `plugin-src` 的旧接线），然后 `cd ~/.dsh/profiles/<profile> && pnpm install`，**重启 DSH 进程**才会生效（安装是复制而非软链）。

注意：若 profile 中同时启用其它同样注册系统提示词段的破甲包，组装时会出现多份载荷叠加；
如需本插件载荷独占生效，请二选一保留 —— 或者打开 `EXCLUSIVE_SECTION`（v0.12.0 起可选，默认关）。
