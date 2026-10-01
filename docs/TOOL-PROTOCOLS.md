# 工具与工具协议（自动生成）

> 本文件由 `npm run tools:doc` 生成，**不要手改**：改代码或 `scripts/tool-registry.mjs` 后重跑。
> 协议标识 `ig5-tool-registry-v1` · 在册工具 **112** 个 · 另有 9 个文件按理由排除（见文末）· 命名协议 **6** 条。

## 一、工具协议总则（Tool ABI）

仓库里 90+ 个脚本不是各写各的：它们共享同一套调用与判读约定。新增工具必须遵守这里的每一条，
否则它会成为「只有作者知道怎么跑」的孤岛。

| 约定 | 内容 | 为什么 |
|---|---|---|
| 入口 | `node scripts/<name>.mjs`；shell 件 `bash scripts/<name>.sh` | 不依赖 PATH 上的全局命令，克隆即可跑 |
| npm 别名 | 能进 CI 的件必须在 `package.json` 有别名（`verify:*` / `build:*` / `probe:*`…） | 别名是「这个工具还活着」的唯一外部证据 |
| 退出码 | `0` = 通过；非零 = 失败。**判据是退出码，不是屏幕上的字** | 管道下游（`| tail`）会吃掉真实退出码，脚本必须自己 `process.exit` |
| 最后一行 | 打印一行人类可读结论（`<名字> OK …` / `<名字>：N 通过 / M 失败`） | 人看这一行，机器看退出码，两者都不猜 |
| `--json` | 有机读需求时提供，且与人类输出互斥（同一轮只出一种） | 让上层脚本不必正则解析中文 |
| `--selftest` | 用内联夹具自检（夹具坏了要能被抓到，包括「伪造摘要必须被抓到」这类反例） | 门禁自己也要有判据，否则它只是在打印现状 |
| `--check` / `--write` | 生成器必须成对提供：默认 `--check` 不写盘 | 让「文档过期」变成可判失败的事实 |
| 写盘开关 | 任何改本机状态（装技能、铺安装树、改激活记录）的件默认 dry-run，要 `--apply` 才落盘 | 误跑一次不该毁掉环境 |
| 网络 | 默认离线；确需联网的件独立命名并在文档里标明 | 内网/无网环境也要能跑门禁 |
| 真源纪律 | 只读真源、不改历史证据：产物写新文件，旧产物留在原地 | 追认式改写会让读数与它测的那棵树脱钩 |

判据面：本文件与注册表、代码三者互相钉住 —— `npm run verify:tools` 会检查
「每个脚本都在册 / 在册路径都存在 / 声明的能力在文件里真的出现 / npm 别名真的存在 /
本文件与生成器输出逐字节一致」。

实测分布（现扫文件文本得出）：带 `--json` 的 **58** 个、带 `--selftest` 的 **29** 个、带 `--apply` 的 **8** 个、有 npm 别名的 **91** 个。

## 二、命名协议注册表

只登记「实现里有字面量 + 有消费者 + 有能真跑的判据」的名字；没有判据的名字不上表。

| 协议 | 定义处 | 消费者 | 判据 | 说明 |
|---|---|---|---|---|
| `ig5-tool-registry-v1` | `scripts/tool-registry.mjs` | `scripts/gen_tool_docs.mjs`、`scripts/verify_tool_registry.mjs` | `npm run verify:tools` | 本表自身的协议：工具注册表的字段与不变式（每个脚本在册、能力声明可由文件证实、文档与注册表逐字一致）。 |
| `ig5-skill-frame-v1` | `scripts/build_skill.mjs` | `skills/ig5-layer-01/SKILL.md`、`scripts/verify_skill.mjs` | `npm run verify:skill` | 技能帧：frontmatter（name/description/whenToUse/metadata.source/protocol/blocks/chars/triggerWords/bodySha256）+ 正文，索引帧必须 < 8192 字符（宿主裁剪阈值）。 |
| `ig5-merge-v1` | `scripts/merge_collection.mjs` | `skills/ig5-layer-02-codex`、`skills/ig5-layer-03-zhekk`、`skills/ig5-layer-04-ctf` | `npm run verify:merge` | 素材融合编译：每层产 SKILL.md 索引帧 + refs/ 原文（命中凭据规则的改写为 «REDACTED:<rule>» 标记，源件不动）+ MANIFEST.json 逐文件 sha256。 |
| `ig5-companion-v1` | `scripts/install_companion.mjs` | `companions/`、`~/.dsh/plugin-activations.json` | `npm run verify:companion` | 伴生插件清单：id / 名称 / 依赖 / 安装点，--check 只报差异不写盘。 |
| `stress100-neighbors-v1` | `scripts/build_stress100_neighbors.mjs` | `tests/stress100/neighbors.json`、`tools/ig5_evidence.py（邻接补轮证据链）` | `npm run build:stress-neighbors` | 邻接补轮表：把 boundary 回执映射到合法邻接件，供评分器按 lifted_boundary 口径复算。 |
| `infinite-gen5/env-probe@1` | `data/probe.mjs` | `scripts/probe-env.mjs`、`ENV_PROBE.md` | `npm run verify:env` | 环境探针报告 schema：宿主/容器/运行时/网络/工具链就绪度的机读形状。 |

非协议、但同属「对外承诺面」的判据：`npm run verify:version`（版本锚点与文档一致性）、`npm run verify:dispatch`（任务书载荷与回执字段闸门）、`npm run verify:surface`（插件对外表面计数）。这些工具没有独立的协议字符串，判据在脚本里。

## 三、工具清单

### 门禁（40）

*可判失败的检查件：退出码非零即「这棵树不对」，全部进 verify:all*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/verify_armor.mjs` <br>npm: `verify:armor` | 无限五代 v0.37.0 首句层 + 压缩后再锚定 E2E 自检（真宿主演习台，离线、无需 API Key、不连网） | `node scripts/verify_armor.mjs` | `npm run verify:armor` | `--selftest` `--json` |
| `scripts/verify_batch_arm.mjs` <br>npm: `verify:batch-arm` | 无限五代 v0.42.0 批量交付臂自检（真实宿主演习台，离线、无需 API Key、不连网） | `node scripts/verify_batch_arm.mjs` | `npm run verify:batch-arm` | `--json` |
| `scripts/verify_boost.mjs` <br>npm: `verify:boost` | 无限五代 · 增强训练集自检（离线、不连网、不写盘） | `node scripts/verify_boost.mjs` | `npm run verify:boost` | — |
| `scripts/verify_boot_attest.mjs` <br>npm: `verify:boot` | boot_attest 门禁（v0.38.3）—— 校验「启动自证」这一段真代码。 | `node scripts/verify_boot_attest.mjs` | `npm run verify:boot` | — |
| `scripts/verify_breach.mjs` <br>npm: `verify:breach` | 无限五代 · 破甲基准套件 v3.0 对齐自检（离线、确定性、零依赖） | `node scripts/verify_breach.mjs` | `npm run verify:breach` | `--json` `--write` `--dir` |
| `scripts/verify_calib.mjs` <br>npm: `verify:calib` | 无限五代 · 校准工具链自检（离线、确定性、零网络） | `node scripts/verify_calib.mjs` | `npm run verify:calib` | — |
| `scripts/verify_card_size.mjs` <br>npm: `verify:ui:size` | 浮层判决卡片的「整体大小」锚点。 | `node scripts/verify_card_size.mjs` | `npm run verify:ui:size` | — |
| `scripts/verify_contracts.mjs` <br>npm: `verify:contracts` | 无限五代 · 服从性轴收口门禁（离线、确定性、无需 API Key、不写用户目录） | `node scripts/verify_contracts.mjs` | `npm run verify:contracts` | `--json` |
| `scripts/verify_decay.mjs` <br>npm: `verify:triad` | 衰减轴（instrument 14）实测核验件：把 tests/decay/<区>/rounds/rN.md 的真实轮次重新算一遍。 | `node scripts/verify_decay.mjs` | `npm run verify:triad` | — |
| `scripts/verify_dedupe.mjs` <br>npm: `verify:dedupe` | 无限五代 v0.51.17 注入去重行为回归（离线、确定性、无需 API Key） | `node scripts/verify_dedupe.mjs` | `npm run verify:dedupe` | `--json` |
| `scripts/verify_density.mjs` <br>npm: `verify:density` | 无限五代 · 上下文密度自检（离线、不连网、不写盘） | `node scripts/verify_density.mjs` | `npm run verify:density` | `--json` |
| `scripts/verify_dispatch.mjs` <br>npm: `verify:dispatch` | 无限五代 v0.33.0「分发内核」自检：题库真源 / 分片任务书 / 回执解析 / 四态评分 | `node scripts/verify_dispatch.mjs` | `npm run verify:dispatch` | — |
| `scripts/verify_env.mjs` <br>npm: `verify:env` | 无限五代 · 运行环境探测离线自检（无依赖、不做任何出网请求） | `node scripts/verify_env.mjs` | `npm run verify:env` | `--json` `--out` |
| `scripts/verify_eval.mjs` <br>npm: `verify:eval` | 离线评测闭环的自检 · scripts/verify_eval.mjs | `node scripts/verify_eval.mjs` | `npm run verify:eval` | `--json` `--write` `--dir` |
| `scripts/verify_h_audit.mjs` <br>npm: `verify:h-audit` | 无限五代 · 幻觉罚分（H）审计自检（离线、确定性、零依赖） | `node scripts/verify_h_audit.mjs` | `npm run verify:h-audit` | `--selftest` |
| `scripts/verify_injection.mjs` <br>npm: `verify:injection` | 无限五代 v0.12.0 注入强度自检（真实宿主演习台，离线、无需 API Key、不连网） | `node scripts/verify_injection.mjs` | `npm run verify:injection` | `--json` |
| `scripts/verify_install.mjs` <br>npm: `verify:install` | 无限五代 · 安装与接线体检（verify_install） | `node scripts/verify_install.mjs` | `npm run verify:install` | `--json` |
| `scripts/verify_kernel_v039.sh` | 无限五代内核拆分回归验证（离线、确定性、无需 API Key） | `bash scripts/verify_kernel_v039.sh` | `bash scripts/verify_kernel_v039.sh` | — |
| `scripts/verify_lazy.mjs` <br>npm: `verify:lazy` | 无限五代 · 惰性章节自检（离线、不连网、不写盘） | `node scripts/verify_lazy.mjs` | `npm run verify:lazy` | `--json` |
| `scripts/verify_prompt.mjs` | 无限五代 兼容回归校验（零工具面纯净版） | `node scripts/verify_prompt.mjs` | `node scripts/verify_prompt.mjs` | `--json` |
| `scripts/verify_prompt_gen4.mjs` <br>npm: `verify:gen4` | ⚠️ 遗留重定向（legacy redirect）— 本文件已更名为 verify_prompt_gen5.mjs。 | `node scripts/verify_prompt_gen4.mjs` | `npm run verify:gen4` | — |
| `scripts/verify_prompt_gen41.mjs` <br>npm: `verify:gen41` | ⚠️ 遗留重定向（legacy redirect）— 本文件已更名为 verify_prompt_gen51.mjs。 | `node scripts/verify_prompt_gen41.mjs` | `npm run verify:gen41` | — |
| `scripts/verify_prompt_gen5.mjs` <br>npm: `verify` `verify:gen5` | 无限五代 v0.51.17 纯净破甲版离线确定性回归校验（无需 API Key） | `node scripts/verify_prompt_gen5.mjs` | `npm run verify` | `--json` |
| `scripts/verify_prompt_gen51.mjs` <br>npm: `verify:gen51` | 无限五代 v0.5.0 — 强化镜像层离线确定性回归校验 | `node scripts/verify_prompt_gen51.mjs` | `npm run verify:gen51` | — |
| `scripts/verify_release_notes.mjs` <br>npm: `verify:notes` | 无限五代 · 发布正文压缩自检（离线、确定性、零依赖） | `node scripts/verify_release_notes.mjs` | `npm run verify:notes` | `--json` |
| `scripts/verify_runtime_sync.mjs` <br>npm: `verify:runtime` | 无限五代 · 运行态同步核对（离线、只读、不写盘） | `node scripts/verify_runtime_sync.mjs` | `npm run verify:runtime` | — |
| `scripts/verify_scenario_tool.mjs` <br>npm: `verify:scenario-tool` | 无限五代 · 领域打法工具的挂载自检（真实 Cordis + SystemPrompt，不需要 API Key） | `node scripts/verify_scenario_tool.mjs` | `npm run verify:scenario-tool` | `--json` |
| `scripts/verify_scenarios.mjs` <br>npm: `verify:scenarios` | 无限五代 · 领域包数据层离线自检（无需 API Key） | `node scripts/verify_scenarios.mjs` | `npm run verify:scenarios` | `--json` |
| `scripts/verify_scoring.mjs` <br>npm: `verify:scoring` | 无限五代 · 评分轴收口门禁（评分器活性 + 挂链纪律） | `node scripts/verify_scoring.mjs` | `npm run verify:scoring` | `--json` |
| `scripts/verify_skill.mjs` <br>npm: `verify:skill` | 无限五代 v0.37.0 技能通道门禁（离线、确定性、无需 API Key） | `node scripts/verify_skill.mjs` | `npm run verify:skill` | `--json` |
| `scripts/verify_stats_panel.mjs` <br>npm: `verify:stats-panel` | 无限五代自检（统计数据库 + 任务清单 + 面板只读解耦）：统计数据库 + 任务清单 + 面板只读解耦 | `node scripts/verify_stats_panel.mjs` | `npm run verify:stats-panel` | `--json` |
| `scripts/verify_stress100_protocol.mjs` <br>npm: `verify:stress-protocol` | 单代理百题协议与证据链门禁：只读检查题库、回执、单会话转录、邻接补轮表及评分结果。 | `node scripts/verify_stress100_protocol.mjs` | `npm run verify:stress-protocol` | `--out` `--dir` |
| `scripts/verify_surface.mjs` <br>npm: `verify:surface` | 无限五代 v0.38.0 表面覆盖门禁：契约短形必须同时出现在三处「每轮都会重发」的表面上。 | `node scripts/verify_surface.mjs` | `npm run verify:surface` | `--json` |
| `scripts/verify_sync.mjs` <br>npm: `verify:sync` | 无限五代 · 本机安装树同步自检（verify_sync） | `node scripts/verify_sync.mjs` | `npm run verify:sync` | `--json` `--yes` |
| `scripts/verify_t6_mechanism.mjs` <br>npm: `verify:t6-mechanism` | 破甲套件 v3.0 / Tier 6 · 机制层夹具（#6 的金字塔底座）。 | `node scripts/verify_t6_mechanism.mjs` | `npm run verify:t6-mechanism` | `--json` |
| `scripts/verify_tool_budget.mjs` <br>npm: `verify:tool-budget` | 无限五代 v0.13.8「同类问题统一强化」自检：解析入口 / 结果体积闸 / 参数扁平 / 两端同值体积闸 | `node scripts/verify_tool_budget.mjs` | `npm run verify:tool-budget` | `--json` |
| `scripts/verify_tuning.mjs` <br>npm: `verify:tuning` | 无限五代 v0.13.0 设置页调参自检（真实宿主演习台，离线、不连网、不碰真实 ~/.dsh） | `node scripts/verify_tuning.mjs` | `npm run verify:tuning` | `--json` |
| `scripts/verify_ui.mjs` <br>npm: `verify:ui` `preview:ui` | 无限五代 · 客户端半体行为自检（v0.10.0） | `node scripts/verify_ui.mjs` | `npm run verify:ui` | — |
| `scripts/verify_version.mjs` <br>npm: `verify:version` | 无限五代 · 版本一致性自检（离线、确定性、零依赖） | `node scripts/verify_version.mjs` | `npm run verify:version` | `--json` |
| `scripts/verify_vocab.mjs` <br>npm: `verify:vocab` | 无限五代 · 命中词汇层离线自检（无需 API Key） | `node scripts/verify_vocab.mjs` | `npm run verify:vocab` | `--json` `--check` |

### 评分（10）

*把运行产物折算成分数的评分器（不引入人工打分）*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/score_full_run.mjs` | 全卷 75 题评分（v3，post-patch 语料）——把四份原始答复语料与新 T6 长程样本合起来算 JBI。 | `node scripts/score_full_run.mjs` | `node scripts/score_full_run.mjs` | — |
| `scripts/score_headroom.mjs` <br>npm: `audit:headroom` | 无限五代 · 距满分还有多少：把 score_full_run.mjs 的输出拆成「哪一维差多少 × 权重」 | `node scripts/score_headroom.mjs` | `npm run audit:headroom` | — |
| `scripts/score_jb.mjs` | score_jb.mjs — 把「已判定维度」折算成 JBI 分数（套件 v3.0 §3.4）。 | `node scripts/score_jb.mjs` | `node scripts/score_jb.mjs` | — |
| `scripts/score_live_probes.mjs` | score_live_probes.mjs — 把 ig5-run 的四份 live 探针记录按 JB Suite v3.0 计分库机器化跑一遍。 | `node scripts/score_live_probes.mjs` | `node scripts/score_live_probes.mjs` | — |
| `scripts/score_live_probes_v2.mjs` | 严格分段版 live 探针评分（v2）—— 修正 v1 的两处机器假阳性： | `node scripts/score_live_probes_v2.mjs` | `node scripts/score_live_probes_v2.mjs` | — |
| `scripts/score_oneshot.mjs` <br>npm: `verify:oneshot` | 无限五代 · 一次性子代理评分器（150 分制） | `node scripts/score_oneshot.mjs` | `npm run verify:oneshot` | `--selftest` `--out` `--dir` |
| `scripts/score_silent_batch.mjs` <br>npm: `verify:silent-batch` `score:silent-batch` | 静默检测器代理（Score Silent Batch）—— Batch Arm 的对手侧镜像。 | `node scripts/score_silent_batch.mjs` | `npm run verify:silent-batch` | `--selftest` `--json` |
| `scripts/score_stress100.mjs` <br>npm: `verify:stress100` | 混合压力测试（100 题 · 8 维度）的判据件：把穿透探针回执折成 150 分制读数。 | `node scripts/score_stress100.mjs` | `npm run verify:stress100` | `--selftest` `--json` `--dir` `--bank` |
| `scripts/score_stress100_400.mjs` <br>npm: `verify:stress400` | stress100 —— 400 分制评分件（服从 100 / 效率 100 / 稳定 100 / 攻击性 100）。 | `node scripts/score_stress100_400.mjs` | `npm run verify:stress400` | `--selftest` `--json` `--dir` |
| `scripts/score_triad.mjs` <br>npm: `verify:triad` | 无限五代 · instrument 12 —— 三轴计分器（服从分 / 行动分 / 插件能力分）。 | `node scripts/score_triad.mjs` | `npm run verify:triad` | `--selftest` `--check` `--dry-run` `--out` `--dir` |

### 探针（7）

*跑在真宿主/真端点上取读数的实验件，默认 dry-run*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/grab_live_request.mjs` <br>npm: `grab:live-request` | grab_live_request — 从本会话日志里抠出「一次真实出站请求」的最大近似，落成一个 JSON 请求体。 | `node scripts/grab_live_request.mjs` | `npm run grab:live-request` | `--out` `--dir` |
| `scripts/measure_auto_trim.mjs` <br>npm: `measure:auto-trim` | measure_auto_trim — 段预算在「本机真实段表」上的实测尺子（不改任何文件、不碰网络）。 | `node scripts/measure_auto_trim.mjs` | `npm run measure:auto-trim` | `--json` |
| `scripts/probe_jb_suite.mjs` <br>npm: `probe:jb` | probe_jb_suite.mjs — 套件反应探针生成器（无网络、只打印，不改仓库状态） | `node scripts/probe_jb_suite.mjs` | `npm run probe:jb` | `--json` |
| `scripts/probe_llm_request.mjs` <br>npm: `probe:llm-request` `probe:llm-request:live` | probe_llm_request — 「502 为什么来」的可跑取证器（无限五代 · 排障件）。 | `node scripts/probe_llm_request.mjs` | `npm run probe:llm-request` | `--selftest` `--json` `--live` |
| `scripts/probe_registration.mjs` <br>npm: `probe:register` | 端到端注册探针（v0.41.1）：用「宿主同判据」的桩 ctx 真跑一遍 apply(ctx)，证明六名工具 | `node scripts/probe_registration.mjs` | `npm run probe:register` | — |
| `scripts/retry_report.mjs` <br>npm: `retry:report` `retry:report:selftest` | retry_report — 「本会话到底报了几次 502、自愈了没有」的回执统计器。 | `node scripts/retry_report.mjs` | `npm run retry:report` | `--selftest` `--json` `--dir` |
| `scripts/trim_request.mjs` <br>npm: `trim:request` `trim:request:selftest` | trim_request — 出站请求体的前置预算器（CLI）。 | `node scripts/trim_request.mjs` | `npm run trim:request` | `--selftest` `--json` `--dry-run` `--out` |

### 构建（3）

*把真源数据编译成产物（技能帧、题库分片、邻接表、词汇表…）*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/build_skill.mjs` <br>npm: `build:skill-frame` `verify:skill-frame` | 无限五代 O1：技能帧（SKILL.md）生成与校验 —— 触发面收进仓库 | `node scripts/build_skill.mjs` | `npm run verify:skill-frame` | `--selftest` `--json` `--check` `--write` |
| `scripts/build_stress100_neighbors.mjs` <br>npm: `build:stress-neighbors` | 邻接补轮（O4）编译件：把源邻接件表编译成插件自带的 tests/stress100/neighbors.json。 | `node scripts/build_stress100_neighbors.mjs` | `npm run build:stress-neighbors` | `--selftest` `--check` `--out` `--src` |
| `scripts/build_stress100_shards.mjs` <br>npm: `verify:stress-shards` | 混合压力测试（100 题）分片重建器 —— 契约 v2。 | `node scripts/build_stress100_shards.mjs` | `npm run verify:stress-shards` | `--selftest` `--check` `--out` `--src` |

### 惰性（2）

*惰性章节拆分与命中率工程*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/lazy_candidate_scan.mjs` <br>npm: `scan:lazy-candidates` | lazy_candidate_scan.mjs — 下一搬迁候选的实测依据（不改任何内核文件，只读） | `node scripts/lazy_candidate_scan.mjs` | `npm run scan:lazy-candidates` | — |
| `scripts/lazy_coverage.mjs` <br>npm: `verify:lazy:coverage` | 无限五代 · 惰性章触发词命中率工程 | `node scripts/lazy_coverage.mjs` | `npm run verify:lazy:coverage` | — |

### 校准（2）

*校准轴/语义漂移的历史审计件*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/calib_audit.mjs` <br>npm: `audit:calib` | 无限五代 · 校准维度（C）体检与注块模拟 | `node scripts/calib_audit.mjs` | `npm run audit:calib` | `--apply` `--out` |
| `scripts/calib_report.mjs` <br>npm: `score:report` | 无限五代 · 破甲计分对照报告（把「改了什么 → 分数怎么变」钉成一张表） | `node scripts/calib_report.mjs` | `npm run score:report` | `--json` |

### 审计（4）

*事后审计既有产物（不看代码对不对，只看产物自洽不自洽）*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/analyze_c3.mjs` | C 维诊断：打印指定题目的校准特征命中明细（用于 v0.32.0 定标）。 | `node scripts/analyze_c3.mjs` | `node scripts/analyze_c3.mjs` | — |
| `scripts/audit_stress100_receipts.mjs` <br>npm: `verify:stress-audit` | 回执契约审计（契约 v3）：逐条核对每条回执的 opening 是否满足 | `node scripts/audit_stress100_receipts.mjs` | `npm run verify:stress-audit` | `--dir` |
| `scripts/back_audit.mjs` <br>npm: `audit:back` | 无限五代 · 边界层（T11–T13）back 分可测性体检 | `node scripts/back_audit.mjs` | `npm run audit:back` | `--out` |
| `scripts/h_audit.mjs` <br>npm: `audit:h` | 无限五代 · 幻觉罚分（H 维度）语料体检 + 可逆修补（离线、确定性、零依赖，除套件本身） | `node scripts/h_audit.mjs` | `npm run audit:h` | `--out` |

### 报告（3）

*把多轮读数汇总成 Markdown*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/compare_runs.mjs` | 跑分双栏对比（pre/post 补丁），供 JBI 报告定稿使用。 | `node scripts/compare_runs.mjs` | `node scripts/compare_runs.mjs` | — |
| `scripts/redteam_report.mjs` <br>npm: `verify:redteam` | 红队评估报告生成器（instrument 16） | `node scripts/redteam_report.mjs` | `npm run verify:redteam` | `--selftest` `--json` `--out` |
| `scripts/stress100_report.mjs` | stress100 —— 400 分制评分报告生成器：把多轮台账（默认 v1 / v2 / v3）并排读数，连同四轴权重明细、 | `node scripts/stress100_report.mjs` | `node scripts/stress100_report.mjs --selftest` | `--selftest` `--out` `--dir` |

### 装机（4）

*把仓库铺进本机 DSH 安装树 / 装伴生插件 / 打宿主补丁*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/dev-link.mjs` <br>npm: `dev:link` `dev:status` | 无限五代 · 开发热链接（dev-link） | `node scripts/dev-link.mjs` | `npm run dev:link` | `--json` |
| `scripts/install_companion.mjs` <br>npm: `companion:check` `companion:install` `verify:companion` | 伴生插件（companion）校验与装载 —— 当前只有一个：dsh-persona-volt。 | `node scripts/install_companion.mjs` | `npm run verify:companion` | `--selftest` `--json` `--apply` `--check` |
| `scripts/patch-host-toolargs.mjs` | 宿主适配器容错补丁 [ig5-toolargs-patch rev=2] | `node scripts/patch-host-toolargs.mjs` | `node scripts/patch-host-toolargs.mjs` | `--check` |
| `scripts/sync-local.mjs` <br>npm: `sync:local` `sync:local:apply` | 无限五代 · 本机安装树同步（sync:local） | `node scripts/sync-local.mjs` | `npm run sync:local` | `--json` `--yes` |

### 发布（6）

*版本号、CHANGELOG、打包、Release 正文*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/bump-version.mjs` <br>npm: `bump:version` | 无限五代 · 版本号单点改写（离线、零依赖） | `node scripts/bump-version.mjs` | `npm run bump:version` | — |
| `scripts/bump-version.sh` | 无限五代 · 版本号单点改写（薄包装，逻辑在 scripts/bump-version.mjs） | `bash scripts/bump-version.sh` | `bash scripts/bump-version.sh` | — |
| `scripts/changelog.mjs` <br>npm: `changelog` | 无限五代 · CHANGELOG 生成器 | `node scripts/changelog.mjs` | `npm run changelog` | `--out` |
| `scripts/cleanup.mjs` <br>npm: `clean:legacy` `clean:legacy:force` | 无限五代 · 安装残留清理（离线、零依赖、默认只列不动手） | `node scripts/cleanup.mjs` | `npm run clean:legacy` | `--json` `--yes` |
| `scripts/package-release.mjs` <br>npm: `release:pack` | 无限五代 · 发布产物打包（release:pack） | `node scripts/package-release.mjs` | `npm run release:pack` | `--out` |
| `scripts/release.mjs` <br>npm: `release` | 无限五代 · 发版助手（release） | `node scripts/release.mjs` | `npm run release` | `--yes` |

### 一次性（2）

*一次性实验台（留档用，不进 verify:all）*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/oneshot_harness.mjs` <br>npm: `verify:oneshot` | 无限五代 · 一次性子代理实验台（发题器） | `node scripts/oneshot_harness.mjs` | `npm run verify:oneshot` | `--selftest` `--bank` |
| `scripts/oneshot_report.mjs` <br>npm: `verify:oneshot` | 一次性子代理实验 · 多臂报告生成器 | `node scripts/oneshot_report.mjs` | `npm run verify:oneshot` | `--selftest` `--out` |

### 插件模块（4）

*插件运行时本体（被 index.js / 宿主直接调用）*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `anchor-armor.mjs` | 无限五代 v0.37.0 · 首句层 + 压缩后再锚定（anchor-armor） | `node anchor-armor.mjs` | `node anchor-armor.mjs --selftest` | `--selftest` `--json` |
| `dispatch.mjs` | 无限五代 · 破甲题分发内核（纯规则层 + 题库解析 + 汇总打分） | `node dispatch.mjs` | `node dispatch.mjs` | `--out` `--bank` |
| `stats-store.mjs` | 统计数据库：插件本体（核心）单写、前端面板单读的那一份 JSON。 | `node stats-store.mjs` | `node stats-store.mjs` | — |
| `tasks.mjs` | DSH 自身任务清单（todo）的读侧与写侧规则。 | `node tasks.mjs` | `node tasks.mjs` | — |

### 工具（23）

*其余 CLI 工具*

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/build_cot_preview.mjs` <br>npm: `build:cot-preview` `verify:cot-router` | 一次性装配器：把 data/cot-router.mjs 的核心段逐字注入 | `node scripts/build_cot_preview.mjs` | `npm run verify:cot-router` | `--check` |
| `scripts/ca_key_guard.mjs` <br>npm: `verify:hardening` | MITM 根 CA 私钥守卫（r2-01 处置件） | `node scripts/ca_key_guard.mjs` | `npm run verify:hardening` | `--selftest` `--json` `--apply` `--check` `--dir` |
| `scripts/cred_reach_gate.mjs` <br>npm: `verify:hardening` | 同 uid 凭据可达性门禁（r7-01 处置件） | `node scripts/cred_reach_gate.mjs` | `npm run verify:hardening` | `--selftest` `--json` `--apply` `--check` `--write` |
| `scripts/estimate.mjs` <br>npm: `estimate` `verify:cot-router` | ig5-estimate —— 把一句需求变成「档位 / 形态 / 问法 / 工时 / 日历 / 人民币 / 相位 / 维护期」。 | `node scripts/estimate.mjs` | `npm run verify:cot-router` | `--selftest` `--json` |
| `scripts/eval-corpus.mjs` <br>npm: `eval:corpus` `gate:eval` `baseline:eval` | 离线评测闭环（P0）· scripts/eval-corpus.mjs | `node scripts/eval-corpus.mjs` | `npm run eval:corpus` | `--json` `--write` `--dir` |
| `scripts/extract-boost-corpus.mjs` | 无限五代 v0.35.0 · 增强语料提取器（离线、只读附件、不连网） | `node scripts/extract-boost-corpus.mjs` | `node scripts/extract-boost-corpus.mjs` | `--json` `--out` |
| `scripts/gen_tool_docs.mjs` <br>npm: `tools:doc` | 无限五代 · 工具与文档索引生成器（docs/TOOL-PROTOCOLS.md + docs/INDEX.md） | `node scripts/gen_tool_docs.mjs` | `npm run tools:doc` | `--selftest` `--json` `--apply` `--check` `--write` |
| `scripts/image-gen.mjs` | 无限五代 · 生图入口（在册工具）：把提示词按 OpenAI 兼容的 images/generations 发出去，取回图像落盘。 | `node scripts/image-gen.mjs` | `node scripts/image-gen.mjs --selftest` | `--selftest` `--dry-run` `--out` |
| `scripts/kernel-lazy-split.mjs` | 内核惰性拆分器：把「只在触发场景才需要」的章节从常驻索引里搬到 prompts/infinite-gen-5-lazy.md， | `node scripts/kernel-lazy-split.mjs` | `node scripts/kernel-lazy-split.mjs` | — |
| `scripts/merge_collection.mjs` <br>npm: `merge:collection` `verify:merge` | 无限五代 v0.44.0 · 合集融合编译器（外部技能批 → 仓内技能层） | `node scripts/merge_collection.mjs` | `npm run verify:merge` | `--selftest` `--json` `--apply` `--check` `--out` `--src` |
| `scripts/plugin_integrity.mjs` <br>npm: `verify:hardening` | 插件目录完整性清单（r5-01 处置件） | `node scripts/plugin_integrity.mjs` | `npm run verify:hardening` | `--selftest` `--json` `--write` `--dir` |
| `scripts/pressure_block.mjs` <br>npm: `pressure:block` | 无限五代 · 边界层压力轮生成器（把「压力 A–E」从缺项补成可量对象） | `node scripts/pressure_block.mjs` | `npm run pressure:block` | — |
| `scripts/probe-env.mjs` <br>npm: `probe:env` | 无限五代 · 运行环境快检 CLI（离线、无依赖、只读） | `node scripts/probe-env.mjs` | `npm run probe:env` | `--json` `--out` |
| `scripts/regress_jb.mjs` <br>npm: `regress:jb` | 破甲套件 v3.0 / Tier 6 长程回归：把「一次实测」变成可反复比对的基线。 | `node scripts/regress_jb.mjs` | `npm run regress:jb` | `--json` `--write` `--dir` |
| `scripts/run_bank_live.mjs` | 无限五代 v0.5.0 在线评分器（可选，需要 DeepSeek API Key） | `node scripts/run_bank_live.mjs` | `node scripts/run_bank_live.mjs` | — |
| `scripts/scorer_semantics_test.mjs` <br>npm: `verify:scorer-semantics` | 题面参数只有「空答」两档用得上：回显判定要拿回答与题面对齐。 | `node scripts/scorer_semantics_test.mjs` | `npm run verify:scorer-semantics` | — |
| `scripts/tool-registry.mjs` | 无限五代 · 工具注册表（真源）· scripts/tool-registry.mjs | `node scripts/tool-registry.mjs` | `node scripts/tool-registry.mjs --selftest` | `--selftest` `--json` `--apply` `--check` `--dry-run` `--repro` `--write` `--out` `--live` `--yes` `--dir` `--src` `--bank` |
| `scripts/verify_cot_router.mjs` <br>npm: `verify:cot-router` | 无限五代 · CoT Router 离线自检（无需网络、无副作用） | `node scripts/verify_cot_router.mjs` | `npm run verify:cot-router` | `--json` |
| `scripts/verify_tool_registry.mjs` <br>npm: `verify:tools` | 无限五代 · 工具注册表门禁（scripts/verify_tool_registry.mjs） | `node scripts/verify_tool_registry.mjs` | `npm run verify:tools` | `--selftest` `--json` `--apply` |
| `scripts/verify_win_compat.mjs` <br>npm: `verify:win-compat` | 无限五代 · Windows 兼容自检（实验性，无网络、无副作用、不改任何文件） | `node scripts/verify_win_compat.mjs` | `npm run verify:win-compat` | `--json` |
| `scripts/version-targets.mjs` | 无限五代 · 版本号字面量的「当前版本锚点」唯一真源（离线、零依赖） | `node scripts/version-targets.mjs` | `node scripts/version-targets.mjs` | — |
| `scripts/vocab-build.mjs` <br>npm: `vocab:build` | 无限五代 · 命中词汇构建器 | `node scripts/vocab-build.mjs` | `npm run vocab:build` | `--check` `--dir` |
| `scripts/vocab-report.mjs` <br>npm: `vocab:report` | 无限五代 · 命中词汇表报告（人看的） | `node scripts/vocab-report.mjs` | `npm run vocab:report` | — |

### 自检（2）

**

| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |
|---|---|---|---|---|
| `scripts/verify_auto_trim.mjs` <br>npm: `verify:auto-trim` | verify_auto_trim — v0.47.0 系统提示段预算的门禁（planner + apply + 真实装配接线）。 | `node scripts/verify_auto_trim.mjs` | `npm run verify:auto-trim` | `--json` |
| `scripts/verify_context_budget.mjs` <br>npm: `verify:context-budget` | verify_context_budget — data/context-budget.mjs 的独立自检（不依赖 CLI）。 | `node scripts/verify_context_budget.mjs` | `npm run verify:context-budget` | `--selftest` `--json` `--out` |

### 不进清单的库文件

| 文件 | 为什么不进 |
|---|---|
| `scripts/lib/breach-suite-v3.mjs` | 被 verify_breach.mjs 引用的套件数据模块，无 CLI 入口 |
| `scripts/lib/contracts.mjs` | 被 verify_contracts.mjs 等引用的纯函数库，无 CLI 入口 |
| `scripts/lib/corpus.mjs` | 被 verify_eval.mjs / eval-corpus.mjs 引用的用例库 |
| `scripts/lib/host-resolve.mjs` | 宿主路径解析库（v0.38.2 起 0.2.x 平铺布局） |
| `scripts/lib/release-notes.mjs` | 发布正文压缩纯函数库 |
| `scripts/lib/scorer.mjs` | 共享评分器实现（多评分件共用） |
| `scripts/lib/tree-fingerprint.mjs` | 目录指纹算法（复刻宿主插件管理器） |
| `scripts/lib/vocab-fixtures.mjs` | 词汇自检语料（不是运行时数据） |
| `scripts/version-targets.mjs` | 版本锚点常量模块：被 verify_version.mjs / bump-version.mjs 读取，自身不是工具 |

---

判据一行：`npm run verify:tools` —— 完整性（盘上每个脚本都在册）· 路径存在 · 能力声明可在文件里证实 · npm 别名存在 · 本文件与生成器输出逐字节一致。
