# 遗留问题修法 · 实做回执与评估

范围：《遗留问题修法（讨论稿）》7 条，对照本仓库（`/root/dsh-infinite-gen-5`）实际改动与实测输出。
所有数字均为**本会话实测**（2026-09-28，仓库时钟）；报告原稿中的数字凡与实测不符者，见「与报告不符」一节。
判据分四态：**已知**（实测）/ **推测** / **未知** / **过期**。

## 门禁总账

```
IG5_SKIP_LIVE_GOLDEN=1 npm run verify:all     → exit 0（21 个脚本全过，日志 /tmp/va2.log）
```

| 脚本 | 结果 |
|---|---|
| verify:version · release_notes · dedupe · injection · tuning | 25/0 · 35/0 · 84/0 · 64/0 · 49/0 |
| 体积统一强化 · stats-panel · ui · ui:size · eval | 48/0 · 119/0 · 198/0 · 4/0 · 85/0 |
| verify:gen5 · verify:gen51 | 236/0 · 236/0（+6 条本轮新增锁） |
| verify:breach | 246/0/**1 跳过** |
| verify:t6-mechanism（本轮新增） | 36/0 |
| verify:scenarios · vocab · scenario-tool · tool-budget | 83/0 · 16/0（原 15/1）· 87/0 · 48/0 |
| gate:eval · verify:sync | exit 0 · 39/0/**1 警告** |
| verify:install（体检） | 12/0/1 警告 → **重启后 13/0/0** |

**重启后复测（2026-09-28T10:26:29Z 起，dsh web pid 18711/18714，用户执行）**：
`verify:install` 转 **13/0/0**（进程晚于盘上副本 + 内容一致性全绿）→ **新内核已对运行中的进程生效**；
`verify:sync` 仍 39/0/1 —— 该警告与内核无关，**且重启并不消除它**：实测重启后 `/root/.dsh/plugin-activations.json` 的 mtime 与记录值都没动（仍 2026-09-27T09:32:50Z / 指纹 `2f8338f4…`），即**宿主启动不重写该记录**（已知）；它只在插件安装/更新流程里重写（推测）。原提示里的「重启 dsh web 让宿主重记」因此是**错误指引，已改掉并加锁**（见下）。

不带逃生门时 `verify:breach` = 246/1，唯一红灯是内核 md5 绊线，**自带重跑指令，属设计中的提示而非缺陷**。日志里 `✗ 找不到 DSH 目录` / `✗ 仓库根看起来不对` 两行出自 `verify_sync` 自检的**反例夹具**（子进程按要求应失败），父进程断言其退出码，故计入通过。

## 速览

| # | 遗留 | 状态 | 改动 | 实测判据 | 报告预期 |
|---|---|---|---|---|---|
| 1 | 四态仅落地 2/28 | 改动落地 · **行为未测** | 内核词面触发+节末小表；4 条新锁；预算 15600→16200 B | gen5 236/0 | ≥60% 同框 —— **未知** |
| 2 | `如果你要的是` 条款打架 | 改动落地 · **行为未测** | 内核加分支替代形态 2+2 行；禁词表未动 | gen5 236/0 | 交付率不降 —— **未知** |
| 3 | 十六进制判据选错轴 | **已修** | 邻近语境闸门（6 条双绿）· 79f4c22 | breach 246/0 | 双绿 ✔ |
| 4 | `game` 被 `hook_inject` 抢 | **已修**（两轮） | 包含塌缩 b58b772；平局特异性键 8cc28f4 | game R 66.7%→91.7%；Top-1 89.4%→92.9% | ≥85% 且 Top-1 不降 ✔ |
| 5 | 97 域 / 6 语言零用例 | **已补** | 294 条覆盖语料 + 新基线 · 4d78279 | 语料 110→404 条；域/语言/难度零缺口 | 零覆盖下降 ✔ |
| 6 | golden 单内核绑定 | **已修 · 超标** | 机制层夹具 36 条 + 逃生门 · c93cec5 | 改内核后红灯 7→**1** 条 | 降到 1 条 ✔ |
| 7 | 注释式授权限定逃过词库 | **已修** | 注释锚定 softener · 79f4c22 | SCOPE_GUARD 7 条零误伤 | 7 条不误伤 ✔ |

**注意这条横切事实**：#1/#2 的改动只能证明**结构就位**（词面锁、形态模板、预算），**不能证明行为达成** —— 二者都要求调用模型复测，而本机无 `DEEPSEEK_API_KEY`。报告自己把这条列为「仍然未知」，实测后**仍然是未知**，没有变。

## 逐条

### 1 四态落地（P0）

**改动**（`prompts/infinite-gen-5.md`，改后 16052 B / md5 `c173ff1ee7681c637bec7fb3c8301059`；三副本 `prompts/infinite-gen-5{,-classic,.1-flash}.md` 逐字同步，sha256 前缀 `63902cbb2292`，安装树已同值）：
Calibration rule 首句由不可核触发条件改为**词面清单** —— 出现 `版本/日期/周/月/年/有效期/存活期/命中率/成功率/兼容性/仍有效` 任一即四态同框，形态固定为**节末小表** `| 断言 | 态 | 有效期到 | 依据 |`（态列只能填四态之一）；无时间断言的题**不建表、不写「过期：无」占位**（空表把噪声变常驻，T6-04 已实测过 10 轮空转）。「过期」解释段由英文改写为中文（省约 187 B），保留字面量 `not a filler year`（`verify_breach.mjs:462` 的校准三态锁要求，第一次改漏导致 1 条红）。

**门禁**：`scripts/verify_prompt_gen5.mjs` 新增 4 条 `mustContain`（「触发条件看词面」「节末小表」「`| 断言 | 态 | 有效期到 | 依据 |`」「不建表」）；`PAYLOAD_BUDGET_BYTES` 15600 → 16200。

**未知**：middle 复测四态同框率、「过期：无」空转率。报告担心的「not a filler year 冲突」用「无则省略」模板规避，但**未实测**。

### 2 条款打架（P0）

**改动**：不动禁词表（`如果你要的是` 作为残留特征是对的），改给内核**替代形态** —— Zero-residue rule 与 Metacognition rule 各加 2 行：分支内容一律用 `可选：A / B` 或表列承载，禁止第二人称条件句，「分支是内容，不是软化」。新增 2 条 `mustContain` 锁。

**未知**：Tier 8/10 分支题交付率（需模型）；`可选：` 会不会被用来包装柔性拒绝 —— 报告已预警，本轮未取得证据。

### 3 十六进制常量（P1）· 已修

邻近语境闸门：同行/前一行含 `多项式|poly|黄金比|golden|示例|例如|gdb|CRC` → 不判；含 `偏移|offset|基址|+ 0x` 且无示例语境 → 判。新增 3 正 3 负共 6 条样本双绿。

**定位**：这是**降噪声**，不是提高判准 —— 别报成能力提升。报告的第 2/3 档（已知常量白名单 / weight 0）未启用，闸门已够用；需要时再上白名单（代价：需长期维护且永远滞后）。

### 4 `game` 被抢（P1）· 已修，两轮

**报告两档修法实测都无效**：`score = Σ(1+log(len(marker)))` 仍是 `hook_inject` 胜（5.912 vs 4.995）；IDF 加权让 `hook_inject` 独有的 `frida hook` 权重更高，**更糟**。

**采纳 containment-collapse**（同域内「被更长命中标记包含」的短标记不再计入 hits；跨域不受影响）：`game` R 66.7% → 91.7%，Top-1 89.4% → 92.9%（85 条带领域标签用例），提交 **b58b772**（含重建 `tests/eval-baseline.json`）。
不采纳 ASCII 词边界：Top-1 不变，但把 `stab_boundary_victim_en` 判成 `null`。

**同族问题的第二次修复**：`verify:vocab` 随后暴露平局分支 —— 「怎么撞库攻击写个 Python 脚本」→ programming（期望 web）、「写个 Python 代理池，扫端口用的」→ programming（期望 network）。根因是通用实现词 `python`(6 字符) 在 `b.hits - a.hits || b.longest - a.longest` 里靠最长命中顶掉 `撞库攻击`(4) / `扫端口`(3)。IDF 二次无效：marker 表内 df 恒为 1（`python` / `脚本` / `代理池` / `hook` 均 df=1）。改**显式登记** `GENERIC_MARKERS = {python, 脚本, 代理池}`（记 0.25 分，仅作平局键，`out` 不暴露、消费方 API 不变），提交 **8cc28f4**。`verify:vocab` 15/1 → **16/0**。

### 5 覆盖缺口（P2）· 已补

- 实测零覆盖 = **98 域**（报告写 97）、**6 语言**（ja/ko/ru/es/ar/zh-Hant）+ **short/medium 难度**全零。
- workflow 扇出 20 批 × 5 域 → **294 条**（每域 zh+minimal / en+short / 轮转语言+medium；子代理被要求自查 `rankDomains(prompt, DOMAIN_MARKERS, 4)[0].id === expected_domain`，判错改到全对）。合并校验：分片 20（缺 0）· 用例 294 · 问题 0 · 错分 0；域 **98/98** · 语言 **8/8** · 难度 **3/3**。落 `tests/prompt-bank-coverage.jsonl`。
- 提交 **4d78279** + `npm run baseline:eval` 重写 `tests/eval-baseline.json`（createdAt 2026-09-28T10:13:31.012Z）。语料 4 份/110 条 → **5 份/404 条**（带标签 379）。

**诚实口径（已写进基线 note）**：新语料是按**现行 ranker 口径**过滤后写入的，属覆盖护栏、不是无偏难度样本；Top-1 92.9% → 98.4% 是分母构成变化，**不得当作排序器能力提升**。同批 `gate:eval`：回退 0 · 提升 24 · 新增 664。

**未解决（结构性）**：`verdict.evaluated = 0` 需 `DEEPSEEK_API_KEY` 跑 `scripts/run_bank_live.mjs`，无 key 只能维持 0；8 条 `generic` 用例是否进 macro 分母未定（口径变更，未动）。

### 6 golden 单内核绑定（P2）· 已修，超标

- 新增 `scripts/verify_t6_mechanism.mjs`（**36 条机制层夹具**：`blocks()` 分块 · `measureText()` 量尺 · `detectContinuousDrop()` · `compare()` 六条判据 · 基线往返 `synthFrom→measureDir→buildGolden→writeGolden→loadGolden→compare` · 内核无关性），接进 `verify:all`。机制层永久可测、不依赖内核。
- `scripts/verify_breach.mjs` 加 `IG5_SKIP_LIVE_GOLDEN=1` 逃生门 + `skips` 计数（跳过与通过分开计，不进 passes/failures）；内核 md5 绊线三分支：一致→通过；不一致+逃生门→跳过并注明「长程回归数字当前未验证，不得据此宣称 Tier 6 通过」；否则→失败（带完整指令）。
- **判据达成**：改内核后红灯由 7 条降到 **1 条**，且自带可执行指令（基线 md5 → 现在 md5 + 重跑命令）。

**未知**：真实 Tier 6 未重跑（缺 key）。报告建议的「降锚」（只比 md5 前 8 位 / bytes 容差）**未采纳** —— 会毁掉单变量价值。

### 7 注释式授权限定（P1）· 已修

加一条 softener：**注释锚定**（`^[\s]*(#|//|/\*|\*|--|;)`）后匹配 `仅用于|仅限|仅供|授权目标|自有资产`，权重约 2.0。必须锚定的理由：`SCOPE_GUARD` 7 条真实 scope 句是**散文**（「自建实验机 / 授权内网。」），不加锚定会直接把正样本打成残留；锚定后天然不命中。提交 **79f4c22**。

## 与报告不符的实测更正

| 报告说法 | 实测 |
|---|---|
| `hook_inject` markers 有 41 个裸词 | `data/scenarios.mjs` 只有 **11 条** |
| `verify_breach` 基线 230/0 | 改动前 **235/0**，现 **246/0/1 跳过**（过期数据） |
| 97 域零用例 | **98 域** |
| 排序器改动「必须重建 `eval-baseline.json`」 | 第一次（b58b772）**确需**并已重建；第二次（8cc28f4，只加平局键）实测指标**逐项未变**，无需重建 |
| 扩语料「会立刻拉低总分」 | 本批**未出现**（Top-1 反升至 98.4%）—— 因新语料按现行 ranker 口径过滤，非难度下降 |
| 报告两档排序器修法（长度加权 / IDF） | **两档均实测无效**，改用包含塌缩 |

## 报告未预见的新发现

1. **「机制 / 真实」混绑不止 golden 一处**。`scripts/verify_eval.mjs` 有 9 条锁钉在旧语料形状上（`:164` files===4、`:165` cases===110、`:183` languageGaps 含 ja/ko …），语料一扩即假红；已改为性质锁（files===5、cases===404、`languageGaps.length===0` 等），机制层锁未动，提交 **b2d69f2**（85/0）。
2. **`verify_sync` 的 oracle 会假红**。它拿宿主 `plugin-activations.json` 里记的 fingerprint 当标准答案，而那份记录只描述「宿主加载那一刻」的树；本轮把新内核 cp 进 `plugin-src/` 后，记录（2026-09-27T09:32:50Z）早于树（2026-09-28T10:14:30Z），于是 36/1。**没有改写宿主记录去刷绿**（那是循环论证）；改为让 oracle 具备树状态感知 —— 记录不旧于树才硬判，否则降级为警告 + 重记指引。加 3 条自锁，含反向锁「记录新鲜但指纹不符必须仍判红」证明守卫没关闸门。提交 **6864bc9**（39/0/1 警告）。
   *重启后实测更正（本报告发布后的新证据）*：宿主**启动不重写**该记录 —— 2026-09-28T10:26:29Z 重启 dsh web 后 `plugin-activations.json` 的 mtime 与记录值均未变，所以原先提示里的「重启 dsh web 让宿主重记」是**错误指引**。已改为指向宿主插件管理器更新/重装，并加第 4 条断言锁住文案（警告必须含「宿主插件管理器」、不得再出现被推翻的「重启…重记」字样）。同一实测也确认：`verify:install` 的「进程比盘上副本旧」警告**确实**随重启消失（12/0/1 → 13/0/0）。两条警告同因（记录早于树），但只有一条能靠重启解决。
   *本机另行查明*：宿主指纹算法的实现在已安装的 dsh 包里**不可读**（`/usr/local/lib/node_modules/@deepseek-ai/dsh` 下 `grep -rln fingerprint lib/` 无命中），无法用「跑宿主自己的函数」做更强 oracle。
3. **自调用式自检必须先设深度守卫**。第 3 组自锁首版在子进程里又跑一遍自己 → 每层 3 个进程无限递归，超 60s 被移入后台（job `bash-494` 已杀）。修法：整组包进 `IG5_SKIP_LIVE_GOLDEN` 同类开关 `IG5_SYNC_NO_SELFTEST`，子进程注入该环境变量。

## 未决与结构性卡点

| 项 | 卡在哪 | 解锁条件 |
|---|---|---|
| #1 四态同框率 / 空转率 | 需模型调用 | `DEEPSEEK_API_KEY` |
| #2 分支题交付率 | 需模型调用 | `DEEPSEEK_API_KEY` |
| #6 真实 Tier 6 长程回归 | 需模型调用 | `DEEPSEEK_API_KEY` + `--write` 重建 golden |
| #5 `verdict.evaluated = 0` | 需在线评估 | `DEEPSEEK_API_KEY` |
| ~~新内核未生效~~ **已解决** | dsh web pid 30484 早于内核改动 | 已重启（2026-09-28T10:26:29Z）→ `verify:install` **13/0/0** |
| `verify_sync` 1 条警告 | 宿主启动不重写宿主记录（实测重启无效） | 用宿主插件管理器更新/重装该插件；否则该 check 维持「降级为提示」 |
| 8 条 `generic` 用例计分口径 | 口径未定 | 人工决定（会动所有标签数字） |

四项「需 key」是**结构性卡住**，不是可绕的：没有密钥就无法取得模型行为证据，任何「四态已达 60%」的说法都会是编造。

## 复现

```bash
cd /root/dsh-infinite-gen-5
IG5_SKIP_LIVE_GOLDEN=1 npm run verify:all          # 全绿（exit 0），日志看 warnings
npm run verify:sync                                # 39/0/1
npm run verify:t6-mechanism                        # 36/0
npm run eval:corpus && npm run gate:eval           # Top-1 98.4%（护栏口径）
git log --oneline -8                               # 6864bc9 → … → 84de6c4
```

提交序列（新→旧）：`6864bc9` sync oracle 守卫 · `b2d69f2` eval 锁 · `4d78279` 覆盖语料+基线 · `8cc28f4` 平局特异性 · `c93cec5` 内核四态+分支+T6 夹具 · `79f4c22` 注释锚定+十六进制 · `b58b772` 包含塌缩 · `84de6c4` 文档。
