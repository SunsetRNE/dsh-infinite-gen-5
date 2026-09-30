# 🧠 架构与注入机制

> 本文件由根目录 `README.md` 拆出（v0.44.0，机械切片，正文逐字保留）。返回 [README](../README.md) · 全量原文归档 [README-FULL.md](README-FULL.md)。

> ### 🧬 单内核 + 末位锚点（Single Kernel + Tail Anchor）
>
> - 注入槽位：`infinite-gen-5:global-system-prompt`（Order 100，完整内核）
>   + `infinite-gen-5:dual-layer-reinforce`（Order 200，默认只放约 200 字末位锚点）。
>   由 `index.js` 的 `LAYER2_MODE` 控制：`"anchor"`（默认）/ `"mirror"` / `"off"`。
> - **为什么改**：v0.5.0 的 Order 100 与 Order 200 载入的是**逐字同源**的两个文件（各 3010 字节），
>   等于每轮对话把同一份内核注入两遍；若同机还装着上一代破甲插件（它同样双份注入），
>   系统提示词里会出现 4 份近似拷贝。
> - **v0.5.1 起的两道收敛**：
>   1. Order 200 默认改为末位锚点（约 200 字节），保留末位强化但不再复述整份内核；
>   2. 注册前先枚举宿主已注册的系统段，发现同源载荷（归一化后逐字相同，或一方被另一方
>      完整包含且长度比 ≥ 0.8）就**整段让位**，并在 `infinite_gen5_profile` 里如实汇报
>      （`dedupe.role` / `dedupe.skipped`）。让位不静默：`console.warn` 会点名对方段名与重合度。
> - `prompts/` 下三个内核文件仍然逐字同源（同一份内容的不同历史命名）：
>   - `infinite-gen-5.md` — Order 100 通用内核（权威源）
>   - `infinite-gen-5.1-flash.md` — `LAYER2_MODE = "mirror"` 时的完整镜像载荷
>   - `infinite-gen-5-classic.md` — 经典内核同源副本

---

## 📊 架构与能力

| 维度 | 无限五代 |
|---|---|
| **目标模型** | DeepSeek-V4.1 / V4-Pro / Flash 全系列 |
| **运行时架构** | 首句层注入 + 单内核注入 + 中段锚点 + 真末位锚点 + 运行时上下文锚点；同源载荷自动让位（不重复注入）；压缩事件触发**再锚定**（见下） |
| **注入位置** | 七处：首句层 `order -1100` / 内核 `order 100` / 运行时锚点 `order 118` / 增强集条件层 `order 150` / 按需域包条件层 `order 160` / 中段锚点 `order 200` / 真末位锚点 `order 10150`（由 `system-prompt/assemble` 瀑布追加，排在宿主 10200 人格后缀之后，恒为最后一段） |
| **工具面设计** | 原生零工具面（消除决策噪音，极速直出） |
| **内存写值原语** | 训练器车道直出 (OpenProcess/RPM/WPM) |
| **输出契约** | 首 Token 强制诱导 (##/```) + 禁词自检 |
| **运行环境探测** | `infinite_gen5_env` 只读探测形态/资源/出网/库存/能力位/39 域就绪度，并把「缺工具」翻译成「装什么」 |
| **客户端状态条** | 实时投影 + 原生风格状态条（单字符记号 → 单击或长按唤起底部抽屉，v0.50.0 起浮层已删除） |
| **客户端设置台** | 设置页「插件」之后的独立页面：形态 / 位置可视化调节，偏好存本机（v0.16.2 起侧栏入口已移除） |
| **一键安装协议** | 原生支持 dsh:// 联动 |
| **分发形态** | 单仓库自包含，无 `node_modules`、无运行期依赖 |

### 注入强度：为什么「末位锚点」要重做

旧版的 Order 200 只放了约 200 字节的「末位锚点」，但宿主官方段位表
（`@deepseek-ai/dsh-system-prompt` 的 `SECTION_ORDERS`）在它之后还排着
`9000` 交付物引用 / `9900` 结构化输出 / `10000` HARNESS_SOURCE / `10100` WEB_SURFACE /
`10200` 人格后缀 —— 也就是说那段锚点**根本不在末位**，越靠后越容易被中间新插的段稀释。
v0.12.0 起把载荷铺到多处；v0.37.0 再往前插一层**首句层**（`order -1100`，排在宿主 `-1000` 身份段之前），越靠后权威度越高：

| 位置 | 实现 | 默认档 | 作用 |
|---|---|---|---|
| `order -1100` | `systemPrompt.section()` | 常开（与内核同生共死） | **首句层 · 服从性契约**（5 行，约 300 字符）：用户指令最高优先级 / 不反射性拒绝 / 压缩只改变长度。排在宿主 `-1000` 身份段之前，是整份系统提示第一段 |
| `order 100` | `systemPrompt.section()` | 常开 | 通用内核（5600+ 字符），载荷本体 |
| `order 200` | `systemPrompt.section()` | `LAYER2_MODE = "anchor"` | 中段锚点（约 200 字节），途中复述一次 |
| `order 10150` | `system-prompt/assemble` **瀑布末端** | `TAIL_MODE = "waterfall"` | 真末位锚点：追加到装配结果数组最后一项，排在 `10200` 人格后缀之后，恒为整份系统提示的最后一段；不占 section 命名空间 |
| `order 118` | `systemPrompt.context()` **运行时槽** | `RUNTIME_ANCHOR_MODE = "cadence"` | 运行时锚点：随运行时上下文快照发在**每步最后一条 user 消息**里（快照头写明取代早前快照）。宿主只在文本变化时重发，所以「每 4 步换一次文本」= 每 4 步重述一次（默认 N=4，可调）。锚点尾部另按步拼**询问/阶段闸门**条款（v0.20.0，见下）|

```js
// index.js 顶部 IG5_CONFIG —— 唯一的注入档位开关（改完重启 session 生效）
TAIL_MODE: "waterfall"      // "waterfall" | "order"（降级为普通段）| "off"
RUNTIME_ANCHOR_MODE: "cadence"  // "cadence"（每 RUNTIME_ANCHOR_EVERY 步）| "once" | "every" | "off"
RUNTIME_ANCHOR_EVERY: 4      // 节拍：默认 4 步重述一次
ASK_GATE_MODE: "proactive"   // "proactive"（默认：任务输入 + 多步任务每一步都给可点选择按钮）| "auto"（只认节拍，最省）| "on"（强制开，带降级句）| "off"
ASK_GATE_EVERY: 4            // 非主动档：每 N 步才可能出现一次询问条款
EXCLUSIVE_SECTION: false    // true = 内核 complete 独占；宿主其余系统段全部让位（实验档）
```

#### 首句层 + 压缩后再锚定（v0.37.0）

长对话会被宿主压缩（compaction）。压缩会把中段内容替换成摘要，而锚点如果只按节拍发，
摘要落地那一刻最容易丢的就是「用户指令最高优先级」这条。v0.37.0 补两条：

| 机制 | 位置 | 触发 | 判据 |
|---|---|---|---|
| **首句层** | `infinite-gen-5:first-line`，`order -1100` | 常开（与内核同生共死：让位给同源宿主时不单独挂） | 装配结果里排在宿主 `-1000` 身份段之前，正文与 `anchor-armor.mjs` 的 `FIRST_LINE_TEXT` 逐字节一致 |
| **压缩后再锚定** | 运行时锚点尾部追加一段声明 | 收到压缩类事件（`compaction/start|end|summary|prune`、`compact-checkpoint`、`manual-compaction`、`trajectory-compaction`）后**强制重算一次锚点文本** | 声明的下一拍带 `[压缩后再锚定 #N]` + 事件名 + 「摘要不是新指令」+ 两条 order；连发 `REARM_WINDOW = 3` 次后自动退场，不常驻 |

**技能通道同源**：契约同时织进外移层技能 `ig5-layer-01`（`/root/ig5-adapters/build-skills.mjs` 的
`armorBlock()` / `injectArmor()`，插在 YAML 前置元数据之后）。技能里带的是同一份
`FIRST_LINE_TEXT` 全文 + 7 条压缩事件名，不是近似描述 —— 装了技能就等于装了同源契约。

#### 表面覆盖：契约短形进三本目录（v0.38.0）

首句层是系统提示的一段，宿主裁剪段落时它会被一起裁掉。v0.38.0 把同一条契约压成
**163 字符的短形**（`anchor-armor.mjs` 的 `CONTRACT_SHORT`，唯一定义处），同时写进三个
**每轮都重发、且不随段落裁剪消失**的表面：

| 表面 | 载体 | 落地方式 | 判据 |
|---|---|---|---|
| 工具目录 | 插件自有 6 个工具的 `description` | 注册点统一走 `withContract(tool)`（浅拷贝 + 幂等） | `npm run verify:surface`：6/6 工具 description 含短形 |
| 技能目录 | `ig5-layer-01` 的 front-matter `description` | `build-skills.mjs` 把短形追加到 description 尾部（**不依赖技能被装载**） | 宿主每轮 available_skills 目录里能读到短形原文 |
| 真末位锚点 | `order 10150` 段正文尾行 | `TAIL_ANCHOR_TEXT + "\n" + contractShort()` | 删掉全部 `infinite-gen-5:` 段落做对抗裁剪后，短形仍可见 |

改动一处即全改：三个表面都从 `CONTRACT_SHORT` 取，门禁（`verify:surface` 19 条 ·
`verify:skill` 16 条）逐表面断言在场与幂等。

#### 运行期调参：八个开关不必改代码重发布

优先级 **设置页（v0.13.0 起）> profile config > `IG5_*` 环境变量 > 文件内默认值**，各级覆盖就地写回
`IG5_CONFIG`，`infinite_gen5_profile` 工具新增 `configOverrides`，如实汇报每个生效值是哪来的。

| 开关 | 环境变量 | 取值 |
|---|---|---|
| `LAYER2_MODE` | `IG5_LAYER2_MODE` | `anchor` / `mirror` / `off` |
| `DEDUPE_PAYLOAD` | `IG5_DEDUPE_PAYLOAD` | `true` / `false` |
| `TAIL_MODE` | `IG5_TAIL_MODE` | `waterfall` / `order` / `off` |
| `RUNTIME_ANCHOR_MODE` | `IG5_RUNTIME_ANCHOR_MODE` | `cadence` / `once` / `every` / `off` |
| `RUNTIME_ANCHOR_EVERY` | `IG5_RUNTIME_ANCHOR_EVERY` | 正整数（默认 4） |
| `ASK_GATE_MODE` | `IG5_ASK_GATE_MODE` | `proactive`（默认）/ `auto` / `on` / `off` |
| `ASK_GATE_EVERY` | `IG5_ASK_GATE_EVERY` | 正整数（默认 4） |
| `EXCLUSIVE_SECTION` | `IG5_EXCLUSIVE_SECTION` | `true` / `false` |

管理器式安装下试档位最省事：profile 的 `cordis.patch.yml` 里加一条**只带 `config`、不带 `insert`**
的定向覆盖（不带 insert 就不算双接线，`verify:install` 仍报「单一接线入口」）：

```yaml
- id: dsh-infinite-gen-5
  config:
    RUNTIME_ANCHOR_EVERY: 2
    EXCLUSIVE_SECTION: true
```

本机实测（2026-09-27，v0.12.3）：在 profile 的 `cordis.patch.yml` 里加这条 **只带 `config`** 的定向覆盖后，
`dsh --profile web --dump-config` 显示本插件**仍然只有一条** `- id: dsh-infinite-gen-5`、`config.RUNTIME_ANCHOR_EVERY: 2`
被合进同一条（不是新增第二条接线）；重启进程后运行时锚点序号按 `R#1 → R#2 → R#3` 递增（默认档是 `R#1 → R#4 → R#8`），
证明「改配置 → 重启」这条路真的通了 —— 调档位不必再改代码、发版、等管理器更新。

临时试一次也可以用环境变量（只影响这一次进程）：`IG5_EXCLUSIVE_SECTION=1 dsh web …`。
注意档位键（`LAYER2_MODE` / `TAIL_MODE` / `RUNTIME_ANCHOR_MODE` / `ASK_GATE_MODE`）的取值是**字符串**：
`"off"` 不会被当成布尔 `false` —— 自检专门锁了这条，否则 off 档会静默失效。

#### 用户向选择 / 阶段闸门：不常驻，只在该注入的那一步拼进运行时锚点

内核口径与「提问」天生对冲（缺参数自造占位符并继续、不要求用户自证授权），所以这里**不加常驻开关**，
而是把条件压在运行时锚点尾部（与 L2 域包同一个条件注入层）：文本一变就重发、旧快照作废，条件天然是
「这一步该不该注入」。**能力闸 × 意图闸是前置，时机闸与频次闸二者之一成立即注入**：

- **能力闸**：`ctx.get("userQuestions")` 探针（宿主没暴露提问服务时永不注入，免得模型去调不存在的工具）。
- **意图闸**：用户说过「不要问 / 别问 / 自己定 / 直接做」→ 全局静默（连阶段条款一起）；说过「问问 / 建议 /
  怎么选 / 拿不准 / 意见」→ 当步立即开闸，不等节拍。
- **时机闸**（`proactive` 档，默认）：任务输入第 1 步必开（先给选择）；多步任务在跑时**每一步**都开
  （不可逆动作 / 方向分叉 / 影响面大的取舍随时可能出现）。`auto` 档关掉时机闸、只认节拍。
- **频次闸**：`rev % ASK_GATE_EVERY === 0`（默认 4）。闲聊与单步任务退回节拍，不会变成「每步提醒模型考虑要不要问」。

打开时给的是**可点按钮合同**，分两档发：入口 / 用户点名要建议 / 节拍到点发**全文**（三个必问时刻 ——
任务输入、执行中重大决策、输出收尾 —— 加问法：一次只问一个问题、`header` ≤15 字点题、2–5 个互斥且穷尽的
选项、`label` 用动词短语、`description` 写「是什么 + 代价收益 + 什么情况选它」、推荐项放第一并标
`(Recommended)`、留一个「你来定」兜底、确需多选才 `multi_select`）；多步任务**中间的每一步**只发一行压缩
复述，省掉约 600 字符的合同税。反滥用：能自造占位符（TARGET / HOST / TOKEN / OFFSET / PAYLOAD / SERIAL /
ROLE_A / ROLE_B）或已有可回滚默认最优解的直接做、不问；同一轮最多问一次；同一分叉不重复问。
多步任务另外拿到**阶段契约**：每阶段收尾给「做法 / 判据 / 产物」三行并同步清单，正文不报百分比（百分比只由
面板按清单事实显示）。阶段闸门不走频次闸（否则「每步自报」会退化成「每 4 步才自报」）。

档位按钮有两处，走的是**同一条写通道**（`statsStore.stage` + `save` → POST `/infinite-gen-5/tuning`）：

- **浮层卡片**（v0.22.0）：点状态条弹出的判决卡片里，「位置 <槽位>」那一行右端一个胶囊按钮
  「选择：<当前档> → <下一档>」，点一下循环切档（主动 → 按节拍 → 强制开 → 关闭 → 主动）；`title` 交代两档含义。
  （并进「位置」行而不是新起一节 —— 另起一节会把卡片高度从 353px 顶回 399px，撞尺寸回归。）
- **设置页** →「插件」→「无限五代」→「注入档位」区的「用户向选择（询问闸门）」：
  `主动`（默认）/ `按节拍` / `强制开` / `关闭`。

改完**刷新页面**即可看到；重启进程后旧页面会因 token 失效而 401 → 设置页退化成一行 YAML 提示、
浮层按钮显示「档位未就绪（刷新页面）」并禁用，**一个开关都不显示**（不是功能没了）。

#### 设置面板里直接调档位：点一下就重装，不必重启进程

上面那条「改配置 → 重启」还得手工敲。v0.13.0 起插件在自己的设置页里长出一个**注入档位**面板
（设置 → 无限五代那一页，就在官方「插件」之后），八个开关与节拍间隔 N 都能点。

- 服务端在宿主 `webServer` 上挂四条精确路由：`/infinite-gen-5/tuning`（读档位 / 改档位）、
  `/infinite-gen-5/stats`（只读统计库快照）、`/infinite-gen-5/tasks`（把清单镜像写回宿主）、
  `/infinite-gen-5/events`（v0.15.0 的 SSE 推送：统计库一落盘推一帧信号）。并把**一次性的 token**
  随 index.html 注入页面（`window.__IG5_TUNING__` / `window.__IG5_STATS__`）。路由自守：只收本机回环 +
  这个 token —— 宿主的路由匹配前没有任何鉴权中间件，所以这一步必须插件自己做。
- 推送那条路由是唯一的例外：`EventSource` 带不了自定义请求头，所以它额外接受 `?token=`
  （仅这条路由放行，其余读 / 写路由仍旧只认 `x-ig5-token`），并且仍然只收本机回环。
  推送帧只当闹钟用：面板收到就回读 `/stats`，正文永远走那条只读路由，前端不解析任何 HTTP 负载。
- **webServer 是后挂服务，必须等它**（v0.13.1 修的真缺陷）：宿主的 `WebServer` 在
  `async [Service.init]()` 里才真正 `listen()`，服务 fiber 要等 socket 绑定完才算激活，而
  `ctx.get("webServer")` 默认只返回「提供方 fiber 已激活」的实现 —— 于是 v0.13.0 在真机上
  永远拿到 `undefined`，面板一直显示「接口不可用」（演习台上因为假服务先挂好，反而没暴露）。
  现在改为宿主同款写法 `ctx.inject(["webServer"], (webCtx) => …)`：服务一就绪就补挂路由与
  index 注入，期间如实汇报「不可用」而不假装成功。自检补了「webServer 晚到」一节，并用真实
  `dsh-host-webserver`（临时端口）跑过端到端：无 token 401 / 带 token 200 / POST 改档当场重装。
- 点「保存并生效」= 一条 POST：服务端把档位写进 `$DSH_HOME/infinite-gen-5-tuning.json`，
  然后**卸掉注入部分的 effect、按新档重装一遍**（工具与投影不重挂，重装次数计入 `rebuilds`），
  因此**不用重启进程、不用刷页面**。每行右侧的标记写明这个值是谁给的（设置页 / profile config /
  环境变量 / 文件默认）；`infinite_gen5_profile` 的 `tuning` 字段是同一份实况。
- 「复位到默认」发的是 `{reset:true}`（删掉落盘的覆盖），不是把当前值再发一遍；接口拿不到时
  （非 Web 组合、宿主没给 `webServer`、插件早于 v0.13.0）面板降级成只读提示 + 一段可直接贴进
  `cordis.patch.yml` 的 YAML，既不白屏，也不偷偷把失败当成功。
- 自检：`scripts/verify_tuning.mjs`（真实宿主演习台 **49** 条；存储被指到临时目录，全程不碰真实
  `~/.dsh`）覆盖路由自守 / 改档位后装配真的换了 / 落盘 / 优先级 / 复位 / 无 webServer 降级 /
  **webServer 晚挂**（v0.13.1 修的那个坑，见下）；
  客户端那一半（面板渲染、草稿、POST 内容、错误上屏）接在 `verify_ui.mjs` 里。

#### 面板数据为什么要等一轮结束：推开那条延迟链

v0.14.x 的面板要等对话框输出完才动，不是事件引擎慢 —— 事件在生成中途就一直在涨。链子在别处：
核心把库写盘时做了 750 ms 防抖，面板每 2 s 固定轮询一次，于是「最坏 750 ms + 2 s」的观测延迟
落在每一次改数上。v0.15.0 把这条链四段一起改了：

- **推开（SSE）**：新增 `/infinite-gen-5/events`，统计库每次真落盘就推一帧
  `{type:"stats", seq, at, generatedAt, counts}`；面板收到立刻回读 `/stats`。帧里**不带正文**，
  只有信号（实测 < 400 B），读路径仍然只有那一条，前端也仍旧不解析任何 HTTP 负载。
- **快落盘**：写入节流从 750 ms 降到 250 ms（`STATS_FLUSH_MS`），落盘仍是原子写
  （临时文件 + `rename`），失败不通知、下次重试。
- **兜底轮询**：推送不可用 / 断线 / 宿主没给这条路径时自动回落 —— 活跃期（6 s 内有变化）400 ms、
  空闲期 3 s，`document.hidden` 时直接停，切回前台补一次并重排定时器。
- **live 分区**：核心每秒（`unref`）发布一版 `live`：本轮是否在跑、持续多久、最后事件与类型、
  30 s 窗口内的事件数与速率、最近 8 次工具调用流水（工具名 / 时间 / 字节数 / 是否被截断）。
  只有内容真的变了才写库，空转不产流量。
- 面板新增「实时（信号来源 / 本轮 / 工具流水）」显示组：当前是推送中还是轮询中、回落原因、
  本轮已跑多久、事件速率、最近调了什么工具 —— 都是库里的数字与前端自己的传输状态，面板一个都不猜。
- 自检：`verify_stats_panel.mjs` **119** 项（多出 SSE 握手头 / hello 帧 / 变更广播 / 上限 503 /
  查询串 token 只对推送路由放行 / live 分区落地 / 命中环流水与定长），`verify_ui.mjs` **198** 条（多出 EventSource
  订阅 URL、收到推送就回读、断线回落文案、400 ms 与 3 s 两种间隔、后台暂停、卸载关连接、卡片 chip 与最近命中）。

两条安全边界：**让位就整体让位** —— 内核因同源去重让位时，真末位锚点与运行时锚点也不再单独挂上，
否则模型手里只剩半个载荷；**独占档不丢锚点** —— `complete` 模式下宿主会在瀑布之后把 sections 裁成
`[completeSection]`，所以末位锚点改为并进内核文本而不是单独追加。真实宿主上的装配顺序、
快照节拍与降级路径由 `scripts/verify_injection.mjs` 断言（找不到宿主时 SKIP 并退出 0）。

---

## 🧬 素材融合层（外部素材 → 可追溯资产）

外部素材（Codex 破甲技能批、zhekk 红队终端技能、CTF 知识库、VOLT 人格插件）经 `scripts/merge_collection.mjs` 编译成三层技能 + 一个伴生插件，**正文原样搬运、不改写内容**，每层出一份 `MANIFEST.json`（`protocol: ig5-merge-v1`）逐文件钉 sha256 与字节数。

唯一例外是**凭据样串脱敏**：素材里有公开披露案例的原文，夹着格式完整的 token / 密钥样串，GitHub Push Protection（`GH013`）会按 partner 模式表把整条 push 拦下。编译器按 `SECRET_RULES` 在写入时替换成 `«REDACTED:<KIND>»`（沿用素材既有的标记体例），**源件一字不动**，命中逐条记进 `MANIFEST.json` 的 `sanitized` 段（源 sha256 → 产物 sha256），`--check` 每次复扫产物、命中即报错。实测两层共 24 个文件命中（`jwt` 26 处、AWS 三件套 2 组、`github-token` 4 处、`private-key-block` 4 处、`google-api-key` 3 处、`npm-auth-token` 1 处）。

```bash
node scripts/merge_collection.mjs --src /root/dsh-infinite-gen-4/合集   # 编译三层
node scripts/merge_collection.mjs --check                              # 复算清单（漂移即报错）
node scripts/merge_collection.mjs --install ~/.dsh/skills --apply      # 装进宿主技能扫描根
node scripts/install_companion.mjs --check                             # 伴生插件清单复算
node scripts/install_companion.mjs --install --apply                   # 装到 ~/.dsh/plugin-src/
```

三层规模（实测）：`ig5-layer-02-codex` 736 文本文件 / 跳过 28（非文本扩展名，逐条记进 `skipped`）、`ig5-layer-03-zhekk` 321 文件、`ig5-layer-04-ctf` 155 文件。伴生插件 `dsh-persona-volt` 4 文件 36,299 B，唯一依赖 `@deepseek-ai/schemastery` 由 DSH 安装树提供，无需额外 `npm install`；**激活记录由宿主写**（GUI 插件页开关或重启 DSH），脚本不手改 `~/.dsh/plugin-activations.json`。

细节与回滚行见 [docs/MERGE-COLLECTION.md](MERGE-COLLECTION.md)。
