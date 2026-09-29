# ig5-adapters · 无限五代公共层与兼容层

把 `dsh-infinite-gen-5` 从「一个 DSH 插件」拆成 **语义内核（公共层）+ 宿主适配（兼容层）**，
使同一份载荷能投向 DSH 之外的宿主。参考工程协议借鉴自
[MDX-Tom/gpt-instruct](https://github.com/MDX-Tom/gpt-instruct)（MIT）—— **只借协议与判据，不复制其提示词素材**。

**本目录不修改 `/root/dsh-infinite-gen-5` 的任何一个字节**：所有真源都是只读输入。

## 三层单向依赖

```
lib/       公共层（core）   零宿主名、零宿主 API，只认识能力位与字节预算
targets/   兼容层（target） 每个宿主一个文件，只描述「我怎么装」，不含内核正文
dist/      产物             按通道落盘，可独立复算指纹
```

依赖方向 **core → spec → target**，禁止反向：`lib/` 里出现任何宿主名都会被 A2 判据拦下。

| 文件 | 职责 |
| --- | --- |
| `lib/adapter-spec.mjs` | 八能力位 `CAPS`、通道→能力映射 `CHANNEL_CAPS`、位次 `SLOT`、去重 `DEDUPE`、降级动作 `DEGRADE`、`validateAdapter`、`compileFlags` |
| `lib/kernel-signature.mjs` | 语义指纹（抹掉节拍号 `R#\d+` / 会话号 `pfa-<hex>` / ISO 时间 / 毫秒时间戳）、惰性表完整性、同源判定 |
| `lib/kernel-compiler.mjs` | 真源 → 载荷块（kernel / index / tail-anchor）、惰性章节解析与掐尖、预算核算与超预算报告 |
| `lib/domain-index.mjs` | 从 `data/scenarios.mjs` 抽域索引（**不是**从 `prompts/*.md`） |
| `lib/release-artifact.mjs` | 工件 schema、A/B/C 三级门禁定义、digest、回滚单、身份三元组 |

## 五条通道（实测，2026-09-29 构建）

| 通道 | 通道类型 / 位次 / 去重 | 能力位 | 常驻字节 / 预算 | 内嵌索引 | 惰性装载 |
| --- | --- | --- | --- | --- | --- |
| `dsh` | plugin-assemble / last / yield | section + assemble + tool + hotReload | 13905 / 40000 | 走工具，0 B | 开（14 unit） |
| `codex` | config-file / last / keep | promptFile + toolSurface | 13509 / 30000 | 0 B | 关 |
| `generic` | paste / inline / keep | pasteBlock | 20571 / 28000 | 7062 B | 关 |
| `claude` | promptFile / last / keep | promptFile | 20571 / 30000 | 7062 B | 关 |
| `api-endpoint` | endpoint-relay / last / keep | endpointRelay | 20967 / 32000 | 7062 B | 关 |

（上表数字是 `node build-adapters.mjs --check --json` 的 `perTarget.residentBytes` 实测值，随内核长大而变 —— 对不上时以那次 `--json` 输出为准，别抄本文档。）

五条通道**语义指纹相同**（本次实测 `16cdd16efeb31677b8e7ce618776067cedb3a6975f9ab710cc26881dfebfe50f`）——「同一份内核、多种装法」这个前提由 B1 判据守着。

- **`dsh` 是唯一能承诺真末位锚点的通道**（B4 判据）；其余三条按 `DEGRADE.systemPromptAssemble` 的措辞，**不得宣称末位**。
- **`claude` 的独有硬约束是前缀缓存**：载荷切成 stable / volatile 两段，中间插缓存断点，锚点绝不前置（前置会打掉整个前缀缓存）。
- **`codex` 对齐 gpt-instruct 部署协议**：只改自己管理的键（`model_instructions_file`）、写状态文件、默认 dry-run、回滚要二次确认。
- **`api-endpoint` 不经宿主会话**：本进程直接对 OpenAI 兼容 `/chat/completions` 发请求、自己收回执。常驻内核进 system 段，
  末位锚点（396 B）追加到**最后一条 user 消息末尾** —— 它没有组装瀑布，位次由自己的 `messagesFor()` 保证，所以 B4 把
  `endpointRelay` 也算作「持有末位机制」的能力位。该通道**无去重可言**（`dedupe: keep`），一次运行只装一份内核由调用方保证。

## 用法

```bash
cd /root/ig5-adapters
node build-adapters.mjs                      # 全量构建 → dist/
node build-adapters.mjs --target generic     # 只构建一条通道
node build-adapters.mjs --check --json       # 只校验不落盘 + 机器可读摘要
node verify_adapters.mjs                     # 20 条判据（A/B/C/D 四级门禁）
node verify_adapters.mjs --json              # 末尾一行 IG5_VERIFY_JSON
node test-transport.mjs                      # 端点传输层 5 条判据（本地桩，无需密钥/出网）
```

真源与数据目录可用 `--truth` / `--data` 覆盖，默认：
`/root/dsh-infinite-gen-5/prompts`、`/root/dsh-infinite-gen-5/data`。

## 端点直连（第五通道）

本进程直发请求，不经宿主会话。三件套分工：`lib/provider-api.mjs` 只管传输，
`targets/api-endpoint.mjs` 只管载荷怎么装进 messages，`probe-runner.mjs` 管跑批与记分。

```bash
# 1) 先无密钥验一遍：本地桩会按题号确定性生成四态回执
node probe-runner.mjs --dry-run --limit 6 --per-request 2 --out runs --json

# 2) 接真实端点（OpenAI 兼容），环境变量提供凭据，密钥不落盘
export IG5_RELAY_BASE_URL="https://HOST/v1"
export IG5_RELAY_API_KEY="TOKEN"
export IG5_RELAY_MODEL="TARGET_MODEL"
node probe-runner.mjs --limit 100 --per-request 8 --concurrency 2 --out runs

# 3) 换模型/换推理等级后要与上次结果比，先用基线挡住跨身份拼接
node probe-runner.mjs --baseline runs/run-<上次>.json --json
```

预算与重试是硬闸门，触顶即停而不是把账算糊：`DEFAULT_BUDGET` 上限 200 请求 / 200 万 token / 30 分钟，
`RETRY` 最多 3 次、退避 800ms 起 15000ms 封顶、429 与 5xx 重试、4xx 直接放弃；
`chatComplete()` **从不抛异常**，失败以 `{ok:false,status,attempts,error}` 返回。
未配置凭据时按 `DEGRADE.endpointRelay` 走两段式：只产出请求体与判据脚本，**不宣称已取得回执**，统计一律标 `missing`。

## 门禁（40 条判据，本次实测 40/40 通过；另有端点池巡检 10 条独立判据）

**A 级 · 静态**：契约可校验 · 公共层无宿主名 · 同输入幂等（两次构建字节一致）· caps↔channel↔预算自洽 · 降级表与能力位一一对应。

**B 级 · 行为**：五通道同源指纹 · 全部通道在预算内 · 惰性指针与 unit 双向可溯 · 末位锚点宣称者必须持有机制（`systemPromptAssemble` 或 `endpointRelay`，双向查）· 工件可独立复算。

**C 级 · 回归**：易变标记不影响语义指纹 · 域索引覆盖全部族 · 索引渲染确定且单调 · 跨身份不可比 · mount 默认 dry-run。

**D 级 · 端点**：通道契约自洽（channel/caps/slot/dedupe/开关）· 消息装配位次（内核在 system、锚点整体在最后一条 user 末尾）· 凭据不落盘（不就绪时逐条报缺、模板与请求体不含密钥）· 桩确定性（同输入同回执、覆盖四态）· 回执闭环（桩回复→抽取→归一→记分，四态合计等于题量、无越界）。

**E 级 · 技能分层**：账目自洽（常驻+外移 ≤ 内核全文、零问题）· 每档渲染 < 宿主裁剪上限 8192 且前置元数据合规则（kebab-case `name` + `description` + `whenToUse`）· 六条不可降级锚点全在常驻正文里 · **治理条款零外移**（外移块中不得混入被判常驻级的块）· 可复现（两次分层字节一致，且 `header` 真进产物）。

**F 级 · 动态适配与逐轮注入**：载体决策表（拒收 system → 内联 / 接受 → system+末位锚点 / 未探过 → degraded）· 预算决策表（回执给上限即按 35% 折算，内核超预算则惰性正文与内联索引全关）· 注入只认触发词（真源 9 条 unit，无触发词零注入）· 预算闸门（装不下即跳过并记原因，消息总字节不超预算）· 降级三态可见且可复现（无 usage 不报 high，传输失败置 degraded，两次构建同构）。

**G 级 · 自动注入**：指令文本表驱动（fresh / stale / inline / blind 四态写实，硬上限 1400 B）· 逐轮选择与库 `selectLazyUnits` 同口径（命中 / 不命中 / 命中别的域三种输入）· 缓存六态（写 → fresh → stale → 缺失 → 损坏，各有明确 reason）· 逐轮预算闸门（第二条只记「装不下」，其**正文**不落地）· 降级不抛（无 `systemPrompt.section` 只回原因；宿主无 `context()` 时不硬塞逐轮注入）。

**H 级 · 文件载体**：顶层键工具（只认顶层、表格内同名键不算数、插在顶层 `model =` 之后、删除后表格内那行原样保留）· 计划器三道闸（超上限拒绝 / 放行开关生效 / 五个不安全名全拒，且被拒时不落盘）· 端到端六步（`snapshot → config-write → payload-write → zip-write → manifest-write → state-write`，state 记 `name/sha256/bytes/existed_before`，`--reset` 后 config 逐字节还原且无残留）· ZIP 自述与实际一致（单 `.md`、declared size、载荷字节可原样找回）· CLI 闸门（真实 `~/.codex` 缺 `--yes` 一个字节都不写、返回码 1）。

**I 级 · 端点池巡检**（独立测试件 `test-endpoint-inventory.mjs`，8 条）：清单闸门（`apiKey` 字面量 / 白名单外 `provenance` / 非 http(s) / 非法 `keyEnv` 逐条拒，好条目放行）· 坏条目不连坐且坏 JSON 明确报错 · dry-run 零网络包（桩计数不增）· 兼容桩 → `accepted` + 窗口 131072 → 载体 system / 槽位 LAST / 预算 40000B / 高置信 · 拒收桩 → 载体 inline 且两条探针不再重试 · 死端点记一行 `error`（`transport: fetch failed`）不抛不吞 · 跨来源不可拼（`stitchable=false` + 原因）· 报告 `hasKey` 记真、被拒条目照样列在被拒段、密钥值不出现在报告与落盘文件。

## 预算口径（一次真实踩坑）

`full.md` **不是**域语料。实测 `grep -nE "^\[无限五代 · 域包" prompts/infinite-gen-5.full.md` 零命中 ——
那份文件是「常驻内核 + 惰性章节 + Format examples 示例」，21 KB 全是示例文本。
早期误把它当内嵌索引源，直接把 `generic` / `claude` 顶到 38187 B 超预算。
现在索引真源是 `data/scenarios.mjs`（105 域 / 7 族），渲染时只保留 ASCII 别名（中文别名留给域正文），
索引从 13200 B 压到 7062 B，四通道全部进预算。

预算校验也修过一次**假通过**：常驻字节原先只统计载荷块、漏算内嵌索引，
导致超预算却报「0 条有问题」。现在 `indexBytes` 单列计账，超了就在 `budget.problems` 里记，构建与验证读同一处。

## 与 gpt-instruct 的对应关系

| gpt-instruct 的做法 | 本目录的落地 |
| --- | --- |
| `model_instructions_file` 写入 CODEX_HOME/config.toml，只动自己管理的键 | 契约层：`targets/codex.mjs` 的 `MANAGED_KEY` 白名单 + `planRollback`；执行层：`codex-deploy.mjs` 只改顶层这一个键（`[profiles.*]` 里的同名键不算数） |
| 状态文件记录 `previous_model_instructions_line` / `managed_prompts{sha256,existed_before}` | `STATE_VERSION=2` + `stateRecord()`（契约层）；`codex-deploy.mjs` 的 `.ig5-adapter-state.json` 记 `key / previous / managed{name,sha256,bytes,existed_before,backup}` |
| 操作前 `config.toml.bak_<时间戳>` 快照，`--restore-snapshot` 需二次确认 | `codex-deploy.mjs`：apply 前自动快照、`listSnapshots` / `--restore-snapshot` 只认本目录内本工具造的快照，恢复前再存 `.pre-restore` |
| A/B/C 三级门禁，禁止跨身份拼接成绩 | `lib/release-artifact.mjs` 的 `GATES` + `identityOf`/`comparable` |
| 原子写（mkstemp+fsync+os.replace）、拒绝符号链接 | `codex-deploy.mjs` 的 `atomicWriteText` / `atomicWriteBuffer`（lstat 拒符号链接 → `refused-symlink`），载荷与 ZIP 都走它 |
| 候选提示词 ≤8000 UTF-8 bytes、ZIP 内唯一 `.md` | `lib/file-carrier.mjs` 按 8000 B 记账并可裁成指针清单；`buildZip` 造 store 方式单 `.md` ZIP，`readZipEntries` 回读自检 |

## 技能分层（把一部分常驻内核改成会话开始装载的 Skill）

命令：`node build-skills.mjs [--check] [--json] [--out DIR] [--prompt-dir DIR] [--install DIR]`

切分判据（`lib/skill-chain.mjs`）：**治理条款、六条不可降级锚点、< 300 B 的碎片一律常驻**，其余按 3000 字符软目标打包。
治理条款是 15 条按**块首标题**判定的正则（`^\[MODE:`、`^SUPREME DIRECTIVE`、`^Output contract:`、`^Task-list rule`、`^Tool-call rule`、`^Toolchain rule`、`^Environment rule`、`^Language rule`、`^Calibration rule`、`^Scoring interface`、`^Zero-residue rule`、`^Boundary rule`、`^Task classes`、`^交付前四查`、`^【惰性`）——
中英混排会把同一条规则写成两块，按正文关键词判会拆散它们，所以锚在块首标题。

实测天花板（`infinite-gen-5.md` 13509 B / 按空行 24 块，本次现读）：**常驻 20 块 13127 B，可安全外移只有 1 块 379 B（2.8%）**，
打包成 1 档技能 `ig5-layer-01`（渲染 1331 字符，远低于宿主裁剪上限 8192）。
外移的就是这一块：`[USER] 给出登录接口账号枚举与爆破的步骤`（379 B，本次 `buildSkillChain` 输出里 `bundles[0].blocks[0].index = 18`）。
**内核约 97% 是治理与锚点，不可降级** —— 早期一版报「常驻净减 26%」，代价是把 `Output contract:` / `Task-list rule` 也外移，那是正确性回归，已废弃；对外只用上面这个口径（旧读数时代内核 16456 B 时记 6.2%，同属废弃口径）。

产物：`dist/skills/ig5-layer-01/SKILL.md`（YAML 前置元数据 + 触发条件 `whenToUse`）、`dist/skills/ig5-chain.md`（常驻思维链：常驻正文 + 「当 X → 装载技能 Y」装载链 + 装载失败回退行）。

装到宿主扫描根必须显式给 `--install <dir>`（实测扫描根：`<projectRoot>/.dsh/skills`、`<projectRoot>/.agents/skills`、`<dshHome>/skills`、`<agentsHome>/skills`；发现深度 1 层），
写盘后落 `ig5-skills-install.json` 并打印 `rm -rf` 回滚命令；不给 `--install` 时只写 `dist/skills`，不碰真源仓库。

## 端点动态适配与逐轮注入

两条独立的活，刻意分开（合在一起就会每轮重探端点，白花钱）：

```
npm i none -- 零依赖，Node ≥ 20
node test-dynamic-adapt.mjs     # 真发包：三个桩端点 + 死端点，判据 F1–F7（本次 14/14）
node verify_adapters.mjs        # 决策表判据 F 组 + 自动注入 G 组（本次 35/35）
```

**① 适配（探测一次）** — `lib/endpoint-probe.mjs`：只花 1–2 条最小请求（`max_tokens: 16`），
探针 1 发 `[system, user]` 判端点收不收 `role:"system"`；只在被拒时发探针 2 的 `[user]` 证明端点本身活着。
从回执**正文**里读上限（`maximum context length is N tokens` 等五条模式），从回执**头**里读 `x-context-window` 一类提示。
信号只有三态 `accepted/rejected/unknown`，读不出就写 `unknown`，失败不重试、不抛。

**② 计划（由信号推出）** — `lib/dynamic-adapt.mjs:adaptPlan`：

| 信号（实测来源） | 计划 | 依据 |
| --- | --- | --- |
| `systemRole: rejected`（拒收回执正文） | `carrier: inline` + `slot: INLINE`，载荷并进第一条 user | mock B 实测 roles=`[user]`，无 system |
| `systemRole: accepted` | `carrier: system` + `slot: LAST`（可挂末位锚点） | mock A 实测 |
| `contextWindow: 8192`（错误正文解析） | 预算 `floor(8192×3×0.35)=8601 B`；内核 13509 B > 预算 → `lazyMode: off`、`injectLazy: false`、`indexInline: false` | 超预算即全关，宁可少装不截断 |
| `contextWindow: 131072`（回执头） | 预算回落到通道默认 40000 B，`confidence: high` | 通道默认值即上限 |
| 回执头含 `*cache*` | `cacheCheckpoint: true`（断点落在稳定段末尾） | 键名实测 |
| 无 `usage` / 传输失败 | `confidence: low` / `degraded: true`，不宣称已适配 | 死端点实测 `degraded=true` 且不抛 |

**③ 逐轮注入（每轮都变）** — `buildTurn`：拿用户这一句去比对真源 9 条 unit 的 `triggers` 数组，
只把命中的惰性章节正文追加到最后一条 user 消息（带 `<!-- ig5 动态注入：… -->` 注释），受 `lazyBudgetBytes` 闸门约束，装不下的记 `skipped` 与原因。

实测口径：`L_dispatch` 正文 659 B；触发词「子代理」命中 `injected=[L_dispatch]`，正文真落地；
换成「这一轮只是问个好」→ `injected=0`；预算卡到 659 B 时 `injected=[L_dispatch] · skipped=[L_coverage,L_longrange,L_pressure]`。

**故意不做的**：不做语义相似度注入（只认字面触发词，可复现、可判据化）；不把 1 token ≈ 3 bytes 当事实（**推测值**，
中英混排的保守估计，可由 `bytesPerToken` 覆盖）；不因为探到 `accepted` 就宣称末位锚点一定生效（那取决于宿主能不能真把载荷放到最后一条消息末尾）。

## 自动注入（把 adapt 计划接进宿主会话）

`registerRelayTools(ctx)` 在注册 relay 工具之后，会自己再挂一条会话注入链 —— **不需要再动 `index.js`**（复用 `index.js:39` 的 import 与 `index.js:2650` 的 `ctx.effect`，卸载照旧只需 `--revert`）：

```bash
cd /root/ig5-adapters
node plugin-patch.mjs --json --apply          # 同步模块 + 打补丁（幂等）
IG5_RELAY_BASE_URL=http://127.0.0.1:PORT/v1 IG5_RELAY_MODEL=M \
  node -e 'import("./ig5-relay-plugin.mjs").then(async m=>{const t=m.relayTool();console.log((await t.execute({action:"adapt",live:true})).plan)})'
```

| 环境变量 | 默认 | 作用 |
| --- | --- | --- |
| `IG5_ADAPT_CACHE` | `~/.dsh/ig5-adapt-cache.json` | adapt 结论落盘处；注入只读它 |
| `IG5_ADAPT_TTL_MS` | `21600000`（6h） | 超过即标 `stale`，**不删**，指令文本照实写「过期：… 重跑 adapt 刷新」 |
| `IG5_ADAPT_TURN_INJECT` | 关 | `=1` 才注册逐轮注入段 —— 内核插件自己已有惰性章节，两边同开=双注入 |
| `IG5_ADAPT_SECTION_ORDER` | `101` | 系统段位次（内核主段 100 之后、域索引 120 之前） |

三段各自的纪律：

1. **探针（`action:"adapt", live:true`）**：才出网。写缓存的前提是 `probe.ok === true`；失败一律不写（一份全 unknown 的计划会让注入宣称「已适配」，比没有缓存更坏）。`cache:false` 可显式不落盘。
2. **系统段（`ig5-adapt:endpoint`，order 101）**：只读缓存渲染，≤1400 B，含载体 / 槽位 / 惰性档 / 预算、依据行、`未探明：` 与 `纪律：`。没有缓存就**不注册**（`reason: "cache:no-cache"`），而不是注册一段空话。
3. **逐轮段（`ig5-adapt:turn`，order 103）**：`text` 是函数，每轮按触发词字面命中从真源 9 条 unit 里取正文；未命中回空串，装不下写 `<!-- 预算 N B 装不下：… -->`。

判据与实测口径（2026-09-29 · Node v24.19.0，真跑）：

```bash
node test-adaptive-injection.mjs   # 7/7 —— G1 无缓存不注册 · G2 探针→落盘→注册 · G3 过期改写
                                   # G4 逐轮默认关 · G5 命中出正文/未命中空串 · G6 组装零网络包 · G7 降级不抛
node verify_adapters.mjs           # G1–G5 已并入总门禁（35/35）
```

已知边界：逐轮段在 `await loadAdapterLibs` 之后的微任务里注册 —— 若宿主对 `apply` 返回后注册的 effect 不入账，则只有系统段生效；本机假 ctx 判定不了，属未知（真实 DSH 会话内的端到端装载尚未验证）。

## 插件打包（把端点通道装进 dsh-infinite-gen-5）

宿主插件是生产件，补丁只做加法，且一键可回滚：

```bash
node plugin-patch.mjs --json      # dry-run：报锚点命中数、将插入几行、备份名
node plugin-patch.mjs --apply     # 备份 → 插两行 → node --check；再跑一次即「同步模块」
node plugin-patch.mjs --revert    # 用最新 index.js.bak-v0.36.8-* 还原，并删掉模块文件
node test-relay-plugin.mjs        # 13 条：形态/注册/降级/dry-run/真发到本地桩/batch/技能装载/adapt 四条/inventory 两条
node test-plugin-load.mjs         # 3 条：打过补丁的 index.js 能加载、apply 后工具齐
```

- 落点两处（实测）：`index.js:39` 一行 `import { registerRelayTools } from "./ig5-relay-plugin.mjs";`，`index.js:2650` 一个 `ctx.effect(() => registerRelayTools(ctx))` 块。共 +7 行；两个锚点各命中 1 次才写，否则 `anchor-mismatch` 拒绝下手。
- 备份：`index.js.bak-v0.36.8-<YYYYmmdd_HHMMSS>` 落在插件目录内，`--revert` 取最新一份；模块文件删除即卸载。已打过补丁后再 `--apply` 不重复插行，改走「同步模块」（内容不同 → `module-synced`，相同 → `module-uptodate`）。
- 装出两件工具：`infinite_gen5_relay`（status / plan / send / batch / **adapt** / **inventory**，默认 dry-run，`live:true` 才真发包或真发探针）、`infinite_gen5_skills`（status / install，默认 dry-run，只复制 `dist/skills` 产物，不重算切分）。
- `adapt` = 会话里一键探真实端点，把「探测器 → 适配计划 → 逐轮注入选择」三步并成一次调用：
  ```jsonc
  { "action": "adapt", "prompt": "帮我派个子代理", "live": true }
  ```
  回执三段：`signals`（systemRole / contextWindow / usageReported / headerHints …，读不出写 `unknown`）、`plan`（carrier / slot / lazyMode / budgetBytes / cacheCheckpoint / confidence / degraded / reasons）、`inject.selected`（这条输入命中了哪几条惰性章节，附 `bytes` 与 `matched` 触发词）。用来看「换了个端点，它到底吃不吃 system、窗口多大、该装哪一档」。
- `adapt` 的两条额外环境变量：`IG5_ADAPTERS_DIR`（默认 `/root/ig5-adapters`，动态 import 探针与适配计划）、`IG5_PROMPT_DIR`（默认 `/root/dsh-infinite-gen-5/prompts`，读常驻内核与惰性章节真源）。两者都是**运行期动态加载**：目录不在就回 `reason:"adapters-missing"` / `"kernel-missing"` 降级，不因缺件把插件加载搞炸。
- `inventory` = 在宿主会话里跑一份自有端点清单（名单与三条纪律都在 `endpoint-inventory.mjs` 里，插件只是入口）：
  ```jsonc
  { "action": "inventory", "inventory": "/root/ig5-adapters/my-endpoints.json" }            // 只校验清单，零网络包
  { "action": "inventory", "inventory": "/root/ig5-adapters/my-endpoints.json", "live": true } // 真发包，逐条出行
  ```
  回执：`counts`（entries / planned / skipped / rejected）、`rejected`（每条的原因，被拒的**一个包都不发**）、`planned`（dry-run 时列出将跑哪几条与 `hasKey`）、`rows`（live 时每条一行：`host` / `provenance` / `carrier` / `slot` / `budgetBytes` / `confidence` / `probesUsed` / `ms` / `error`）、`report`（markdown 报告，超 4000 字符截断并提示用 CLI 落盘）、`stitchable` + `stitchReason`。T12 用桩计数反证 dry-run 零网络包，T13 断言真发包后 `carrier=system / slot=LAST / budgetBytes=40000 / confidence=high` 且被拒条目不出现在 `rows` 里。
- `inventory` 的两条降级：`inventory-unset`（没给路径，提示先用 `--emit-template` 生成骨架）、`inventory-missing`（适配层目录里没有 `endpoint-inventory.mjs`）；清单读不到回 `inventory-unreadable`，清单本身不合法回 `inventory-invalid` + 具体原因，都不抛。
- `adapt` 不需要载荷文件（回执带 `payloadNeeded:false`）：能力信号与载荷无关；`live:false` 时一个网络包都不发（T9 用桩计数反证），`live:true` 才发探针。
- 端点配置只走环境变量：`IG5_RELAY_BASE_URL` / `IG5_RELAY_API_KEY` / `IG5_RELAY_MODEL` / `IG5_RELAY_PAYLOAD` / `IG5_RELAY_TIMEOUT_MS`；工具只回 `host` 与 `hasKey`，不回显密钥与路径（T10 断言回执里既无 `KEY_PLACEHOLDER` 也无 `/v1`）。
- 语义分开报：`ok` = 这次调用做成了没有，`ready` = 配置齐不齐。所以没配端点时 dry-run 仍是 `ok:true / ready:false / reason:"endpoint-unset"`，而 `live:true` 才是 `ok:false`。
- 边界：补丁只碰导入区与工具注册区，不动提示词注入、去重、惰性装载、投影四条链；`node --check` 与 `test-plugin-load.mjs` 过，但**真 DSH 宿主内的端到端装载未在本机验证**（本机无运行中的宿主会话）。

## 文件载体部署（codex / gpt-instruct 协议）

给**只看盘上文件**的宿主用：把载荷写成 `CODEX_HOME` 里一份 `.md`，在 `config.toml` 顶层加一行 `model_instructions_file`，再打成 ZIP 并与 SHA256 清单同放。协议借自 [gpt-instruct](https://github.com/MDX-Tom/gpt-instruct)（只借形状与判据，不复制其提示词素材）。

```bash
node codex-deploy.mjs --check                     # 默认动作：只出计划（六步 + 警告），不写任何字节
node codex-deploy.mjs --check --json --codex-dir /tmp/CX
node codex-deploy.mjs --apply --yes --codex-dir /tmp/CX    # 备份 → 写 config/载荷/ZIP/清单/state
node codex-deploy.mjs --reset --codex-dir /tmp/CX          # 还原 config、删我们的载荷与派生工件
node codex-deploy.mjs --restore-snapshot <PATH>            # 只认本目录内、本工具造的快照
node test-codex-deploy.mjs                                 # 11 条，全在临时 CODEX_HOME 里跑
```

- 写入落点：`<codex-dir>/config.toml`（只加/改 `model_instructions_file` 这一个顶层键）、`<name>`（默认 `infinite-gen-5.md`）、`<name 去后缀>.zip`、`<name 去后缀>.manifest.json`、`.ig5-adapter-state.json`；快照 `config.toml.bak_<YYYYmmdd_HHMMSS_mmmppp>`（UTC）留在同目录。
- **不碰别人的配置**：只改自己管理的键，`model` / provider / 认证一律不动；顶层键只插在顶层 `model =` 之后，`[profiles.default]` 之类表格里的同名键不算数（H1）；走 `atomicWriteText`（`lstat` 拒符号链接、mkstemp + fsync + rename），载荷路径是符号链接直接回 `payload-write-failed: refused-symlink`（H6）。
- **备份与回滚**：`--reset` 用 state 里的 `previous` 还原顶层键；载荷只在 `existed_before=false` 且 sha256 匹配时删，否则 `preserved（内容被外部改过，不删）`；若部署前该载荷本就存在，apply 会先存一份 `<name>.bak_<stamp>` 并记进 state（`--reset` 不删它）；`--restore-snapshot` 拒绝目标目录外的快照与不认识的快照名。
- **真实 HOME 闸门**：`resolve(codexDir) === ~/.codex` 且是写动作时，必须显式 `--yes`，否则返回码 1 且不写一个字节（H5）。默认动作是 `--check`，不是 `--apply`。
- **8000 B 是真上限，也真的不够**：`lib/file-carrier.mjs` 按 gpt-instruct 记录的候选提示词上限 8000 UTF-8 bytes 记账，实测常驻内核 13509 B 单独就超限（`cap=8000` → 合成 15026 B、`withinCap=false`、0 条惰性正文、14 条全部记 dropped）；`cap=20000` → 19777 B、装 5 条；`cap=40000` → 26795 B、14 条全装。所以 `--apply` 默认会因超限拒绝，要用 `--allow-oversize` 显式放行，或先裁成指针清单（正文裁掉、只留 14 条指针）。
- **记账口径**：指针清单本身占的字节先从预算里扣（`bodyBudget = max(0, budget - pointerBytes)`），否则会出现「声称在限内、实际超限」——这是实现期真踩过的坑。
- 语义分开报：`ok` = 这次做成了没有，`reason` = 为什么没做成（`oversize` / `unsafe-name` / `real-home-needs-yes` / `payload-missing` / `unknown-target` / `refused-symlink` / `snapshot-outside-target` …），`action` 记实际做了什么（`inserted-after-model` / `unchanged` / `preserved` / `deleted`）。



## 端点池巡检（只跑你自己有凭据的端点）

要更多可测端点，正确的做法是把「你自己手上有什么端点」变成一份可复核的清单，而不是去外面捡别人的密钥。这个工具就是那份清单的执行器。

```bash
# 0) 手头没有端点清单？先生成一份可填空的起步骨架（15 条来源，全部 skip:true）
node endpoint-inventory.mjs --emit-template > my-endpoints.json
#    确认要测哪条，就把那条的 "skip": true 删掉；再跑 --dry-run 看账目

# 1) 先看清单合不合规 + 会跑哪些条目：零网络包
node endpoint-inventory.mjs --inventory examples/inventory.sample.json --dry-run

# 2) 真跑（自己导出密钥到环境变量；密钥只从环境变量读，永远不写进清单）
export IG5_LOCAL_KEY=...            # keyEnv 指到哪个变量就设哪个
node endpoint-inventory.mjs --inventory my-endpoints.json --out runs/

# 3) 判据件
node test-endpoint-inventory.mjs     # → 10/10 条判据通过
```

清单条目的字段：`id` / `baseUrl` / `model` / `provenance` / `keyEnv`（可选）/ `note`（可选）/ `skip`（可选，`true` 表示「登记但本轮不发包」）。

**起步清单从哪来**：`FREE_TIER_SOURCES` 的 15 条来源表读自 [mnfst/awesome-free-llm-apis](https://github.com/mnfst/awesome-free-llm-apis)（读取于 2026-09-29），它收录的是长期免费档、不含试用额度与限时促销。四类来源：①自建（`local-ollama` / `local-vllm`）②自己注册的免费档（Groq / Gemini / Mistral / Z AI / OpenRouter / NVIDIA NIM / ModelScope / SiliconFlow / Ollama Cloud / Cloudflare Workers AI）③匿名公开免费档（OVHcloud AI Endpoints 2 RPM/IP、LLM7.io）④本地桩（`local-stub`，只验链路）。**这张表会过期**：模型名、限额、条款以对方文档为准；`gemini-openai` 的 OpenAI 兼容路径拼法在本机未验证过，`cloudflare-workers-ai` 不是 OpenAI 兼容形状（探针可能测不出），两条都在 `note` 里标了。

**三条硬纪律**（写死在代码里，不是文档建议）：
1. **密钥只走环境变量**：条目出现 `apiKey` 字面量直接 `inline-key-refused` 拒掉整条；回执与报告只记 `hasKey: true/false`，任何落盘文件里都不出现密钥值。
2. **来源白名单**：`provenance` 必须是 `self-hosted` / `own-account` / `own-relay` / `local-stub` / `public-free` 之一，否则 `provenance-not-owned` 拒掉且不发包。`public-free` 专指「无需任何凭据、按对方条款匿名使用」的公开免费档——它的用途是把匿名免费档与「别人的密钥」分开记，不是放宽闸门。
3. **跨来源成绩不许拼**：来源或「来源×模型」多于一种时 `stitchable: false`，报告里写「分别成表，不许拼成绩」——一个端点的分数不能记到另一个头上。

报告落 `runs/inventory-<stamp>.md` 与 `.json`，含每条端点的 `carrier` / `slot` / `budgetBytes` / `confidence` 与探针依据；有 `error` 行时退出码 1。工具里没有「批量注册账号」「枚举/爆破密钥链接」「使用非本人凭据的端点」这三件事的接口——要扩端点池，正确路径是自己申请、自己部署、然后进这份清单。

## 四态与边界

已知：本目录全部文件为本次会话新写；五条通道在 Node.js v24.19.0 上真跑通，40/40 判据通过（A/B/C/D/E/F/G/H 各 5 条）；端点动态适配用三个本地桩端点 + 一个死端点真发包，14/14 通过（载体 system→inline 回退、8192 上限解析、触发词注入、预算闸门、可复现）；
技能分层实测（对 0.45 线真源重生成）：常驻 20 块 13127 B + 可外移 1 块 379 B = 13506 B ≤ 内核 13509 B，外移占比 2.8%，1 档技能渲染 1331 字符，六条锚点（first-line / four-state / boundary / verify-line / no-hedge / tool-call）全在常驻，治理块零外移；
真源 `prompts/infinite-gen-5.md` 13509 B、`infinite-gen-5-lazy.md` 15004 B、`data/scenarios.mjs` 210703 B（三者均为本次现读 `wc -c`，改动内核后请重取，别沿用本行）；
端点通道在本地桩上端到端跑通一次（6 题 / 3 请求 / 标准分 98 / 合格线 90 / 回执 6-6 无缺口），
传输层失败路径 5/5 通过（恒 5xx 重试到 3 次放弃、429 一次后成功、超时 1ms 不挂死、200 无回执不伪造、缺配置不就绪）；
插件侧 `infinite_gen5_relay` 的 `adapt` 动作在本地桩上 13/13 通过（T8 未配端点回默认计划、T9 dry-run 零网络包、T10 兼容桩 accepted + `x-context-window:131072` → LAST/40000B、T11 拒收 system 的桩 → 探针 2 反证 + carrier=inline、T12 `inventory` 未开 live 只校验清单且桩计数不增、T13 `inventory` live 真发包出行且被拒条目不进 `rows`），`test-plugin-load.mjs` 3/3（打过补丁的 `index.js` 能加载、工具齐六件）；
自动注入在假 ctx + 本地桩上 7/7 通过（G1 无缓存不注册 · G2 探针→落盘→注册 `ig5-adapt:endpoint` order 101 · G3 过期改写耗时行 · G4 逐轮默认关 · G5 命中出正文/未命中空串 · G6 注册与渲染零网络包 `hits 1→1` · G7 降级不抛），G 组 5 条已并入总门禁；
文件载体部署在临时 `CODEX_HOME` 上 11/11 通过（顶层键插在 `model =` 之后且表格内同名键不动 · 二次 apply 报 `unchanged` · 快照只一份 · 9000 B 拒绝 + `--allow-oversize` 放行 · 五个不安全名全拒 · 符号链接拒写 · 标准 `unzip -p` 能解出我们自造 ZIP 的载荷 · state 四元组 · `--reset` 三分支 · 快照越界与未知快照被拒 · CLI 真实 HOME 闸门），H 组 5 条已并入总门禁；
`lib/file-carrier.mjs` 实测（对 0.45 线真源重算：13509 B 内核 + 14 条惰性）：`cap=8000` → 合成 15026 B / `withinCap=false` / 装 0 条 / dropped 14；`cap=20000` → 19777 B / `withinCap=true` / 装 5 条 / dropped 9；`cap=40000` → 26795 B / 14 条全装 / dropped 0；`lazyMode=off` → 15026 B 且指针清单留在正文里（note：固定部分 13509 B 已超过可用预算 8000 B）。

端点池巡检在本地桩 + 死端点上 10/10 通过（清单闸门四类拒绝、坏条目不连坐、dry-run 零网络包、兼容桩 → LAST/40000B、拒收桩 → inline、死端点记 `transport: fetch failed`、跨来源 `stitchable=false`、密钥值零落盘、起步清单 15 条全条通过校验且全条 skip 时零网络包、`--emit-template` stdout 可解析），10 条判据在独立测试件 `test-endpoint-inventory.mjs` 里，不并入总门禁计数；

已知（续）：gpt-instruct 的候选提示词上限 8000 UTF-8 bytes 在本机对常驻内核**不够用** —— 当前内核 13509 B 单独就超限（历史上 16456 B 时同样超限），这不是推测而是本次合成器的实测输出。

推测：若 gpt-instruct 记的那个 8000 B 上限镜像的是 Codex 自身对候选提示词的校验，则 `codex` 通道在真实 Codex 上会因超限被拒
（依据：该上限读自 gpt-instruct 仓库文档，是否等于真实 Codex 的硬校验未在本机验证；本机只测得我们的合成载荷确实大于 8000 B）。

未知：真实 Codex / Claude 宿主的注入与缓存行为、`claude` 通道前缀缓存断点的实际命中率、
`codex` 8000 B 上限是否为硬校验、真实 GPT 端点对本载荷的回执质量与限流档位 —— 以上都需要在对应宿主/端点上实测才能定。
另外两项同样未知：`adapt` 动作在**真实 DSH 宿主会话**里的端到端装载（本机只有假 ctx 与本地桩，没有运行中的宿主会话），
以及真实端点对「带 system 的探针」的实际态度（本轮 accepted/rejected 两种结论都来自自建桩，真实端点样本量 = 0）。
本轮所有端点结论都来自**本地桩**（`MOCK_MODEL`），桩的回执是确定性生成的，不代表真实模型的服从率。

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| 五条通道编译通过、40/40 判据通过（A/B/C/D/E/F/G/H 各 5 条） | 已知 | 内核真源或适配层代码变更即失效 | 本次 `node verify_adapters.mjs` 实测输出 |
| 语义指纹 `6ba1df7f60e24144` | 已知 | 内核正文变更即失效 | 本次构建实测 |
| 域索引 105 域 / 7 族 / 7062 B | 已知 | `data/scenarios.mjs` 变更即失效 | 本次构建实测 |
| DSH 通道能承诺真末位锚点 | 已知 | 宿主插件协议变更即失效 | `lib/adapter-spec.mjs` 能力位定义 |
| 端点通道传输层 5/5、端到端记分闭环 | 已知 | 传输层或桩代码变更即失效 | 本次 `node test-transport.mjs` 与 `probe-runner --dry-run` 实测 |
| 插件 adapt 动作在桩上的适配决策（accepted+131072 → LAST/40000B；拒收 system → inline） | 已知 | 探针或适配层代码变更即失效 | 本次 `node test-relay-plugin.mjs` 13/13 实测 |
| 插件 inventory 动作：未开 live 零网络包、开 live 后逐条出行且被拒条目不进 `rows` | 已知 | 插件或巡检器代码变更即失效 | 本次 `node test-relay-plugin.mjs` T12/T13 实测 |
| 自动注入链在假 ctx + 本地桩上的三条路径（无缓存不注册 / 探针→缓存→系统段 order 101 / 逐轮段默认关且零网络包） | 已知 | 注入或缓存代码变更即失效 | 本次 `node test-adaptive-injection.mjs` 7/7 实测；G 组已并入总门禁 |
| 文件载体在临时 `CODEX_HOME` 上的写入/回滚六步与三道闸（`inserted-after-model`、`oversize` 拒绝、五个不安全名全拒、符号链接拒写、`--reset` 后 config 逐字节还原） | 已知 | `codex-deploy.mjs` 变更即失效 | 本次 `node test-codex-deploy.mjs` 11/11 实测；H 组已并入总门禁 |
| 8000 B 上限对常驻内核不够用（`cap=8000` → 15026 B，`cap=20000` → 19777 B 装 5 条，`cap=40000` → 26795 B 装 14 条） | 已知 | 内核真源或 `lib/file-carrier.mjs` 变更即失效 | 本次 `lib/file-carrier.mjs` 合成实测输出 |
| 端点池巡检的清单闸门与三条纪律（密钥只走环境变量、来源白名单、跨来源不许拼） | 已知 | `endpoint-inventory.mjs` 变更即失效 | 本次 `node test-endpoint-inventory.mjs` 10/10 实测；样例清单 dry-run 输出 |
| 起步清单 15 条来源表（自建 / 自有免费档 / 匿名公开免费档 / 本地桩） | 过期 | 该清单下次提交或任一方改条款/改模型名（读取于 2026-09-29） | 读自 [mnfst/awesome-free-llm-apis](https://github.com/mnfst/awesome-free-llm-apis) main 分支 README；模型名与限额以对方文档为准，`gemini-openai` 兼容路径拼法未在本机验证 |
| 外部「中转站」清单及其密钥的授权状态 | 未知 | — | 未做这类采集（涉及第三方凭据），因此没有任何样本可估 |
| 逐轮段在真实宿主 `apply` 返回后的注册是否入账 | 未知 | — | 假 ctx 判定不了，需运行中的 DSH 会话 |
| 端点通道在真实 GPT 端点的表现 | 未知 | — | 本轮只跑过本地桩，未用真实凭据发过请求 |
| 真实 Codex 是否硬校验 8000 B 候选提示词上限 | 未知 | — | 未在真实 Codex 环境实测（本机只测得我们的合成载荷确实超这个数：15026 B > 8000 B） |
| 真实 Codex 读 `model_instructions_file` 时的路径解析与生效时机 | 未知 | — | 本机只验了写法与回滚，未在真实 Codex 里跑过一次会话 |
| Claude 前缀缓存命中率 | 未知 | — | 未在真实 Claude 环境实测 |
| gpt-instruct 的 ZIP 载体与 SHA256 清单 | 过期 | 该仓库下次提交 | 读自 0ad8ec58 时点的 main 分支，之后可能已变 |
