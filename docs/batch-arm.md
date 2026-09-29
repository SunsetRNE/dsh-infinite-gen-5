# Batch Arm：零额外提示词下的「一次做完一整批」

> 比赛口径（m00487）：**装上插件、只给文件、一个对话里跑完 100 题，不许再加任何提示词**。
> 评分插件不可见 —— 所以「这一批该怎么跑」不能靠用户嘴巴说，只能由注入层自己说清楚。
> Batch Arm 就是把这件事做进插件的臂：识别 → 常驻合同 → 每轮锚点，三级都在插件内部。

## 1 机制（三段）

| 段 | 位置 | 作用 | 体量 |
| --- | --- | --- | --- |
| 识别 | `index.js` 的 `session/event` user/message 分支 → `detectBatch()` | 用户消息一进来就判「这是不是一整批」，判中就武装 | 零常驻（只在命中时说话） |
| 常驻合同 | order 170 段 `infinite-gen-5:batch-arm`，`renderBatchClause()` | 交付形状写成 6 行合同：每题首行命名、第 2 行即可执行细节、禁止回问/中停/逐题小结 | 880 B 常驻 |
| 每轮锚点 | 运行时锚点 `text()` 尾部拼接 `renderBatchAnchor()` | 带题那一轮**立刻**重发（不等 cadence 节拍），给端点与题量 | ≤300 B / 轮 |

识别是**黏的**：一旦武装，后面闲聊不解除（只有换批次才更新）。`apply()` 是重置点 —— 新一次装载不带上一轮的武装状态（`rebuildInjection()` 换档不重置，所以点设置页不会掉武装）。

## 2 四条武装路径 + 一条强制档

| kind | 触发 | 题量取值 |
| --- | --- | --- |
| `inline-ids` | 正文里 `[qNNN]` 清单 ≥ `BATCH_ARM_MIN`（默认 20） | 条数 |
| `numbered-list` | 编号行（`1.` / `1、` / `1)`）≥ min | 行数 |
| `bank-file` | 正文只给一个**题库类文件路径** | 读文件拿 `[qNNN]` 条数；读不到记 0 |
| `count-phrase` | 「100 道题」这类题量声明 ≥ min + 批量词 | 声明值 |
| `forced` | `IG5_BATCH_ARM=on` | ≥ min |

题量取值的诚实原则（v0.42.0 修）：**`[qNNN]` 清单优先** —— 题库题面里出现的「1000 个样本」不会盖过清单数出来的 100；文件读不到时不报 min 兜底值，锚点直接写「题量未读」，宁缺不编。

## 3 开关与默认

| 键 | 缺省 | 说明 |
| --- | --- | --- |
| `IG5_BATCH_ARM` | `auto` | `on` 无条件武装 / `off` 不注册段、不检测 / 其余值落 `auto` |
| `BATCH_ARM_MIN`（`IG5_CONFIG`，非可调集） | 20 | 判定下限；刻意不进 `TUNING_CATALOG`，避免牵动 `TUNABLE_KEYS` 与条目数断言 |
| `BATCH_ARM_ORDER` | 170 | 增强集 150 / 惰性 160 之后，中段锚点 200 之前 |

`IG5_CONFIG` 因此从 12 键变 14 键；`verify_tuning.mjs` 的 reset 断言改比「可调集默认值」（过滤掉 `BATCH_ARM_*`）。

## 4 验证（四条命令，全部实测 RC=0）

```bash
cd /root/dsh-infinite-gen-5
node data/batch-arm.mjs --selftest                                   # 21 条断言：四条路径 / 三种不武装 / 只给文件的题量读数 / 三级回退 / 体量
node scripts/verify_batch_arm.mjs                                    # 27 条断言：真宿主装配 + 假 tools + nine rigs（含子进程验 IG5_BATCH_ARM）
node scripts/score_silent_batch.mjs --selftest                       # 9 条断言：隐藏判据的本地代理（满配 400 / 整轮退让 175 / 末段塌陷 250）
npm run verify:batch-arm --silent && npm run verify:silent-batch --silent   # package.json 链
```

端到端判据（不依赖任何外部服务）：`verify_batch_arm.mjs` 在真 `@deepseek-ai/dsh-system-prompt` 上装配，贴 100 题时读 `assembly.contexts` 里的运行时锚点，必须含 `批量武装` + `q001…q100` + `约 100 题`；`BATCH_ARM_MODE:"off"` 时贴满也不喊。

## 5 读数（截至本次会话）

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| 段位 order 170、合同 880 B、锚点 ≤300 B | 已知 | 本次会话 | `verify_batch_arm.mjs` 27/27 |
| 装配段数与注入位置（7 段 / 8 处） | 已知 | 本次会话 | `verify:dedupe` 92/92、`verify:injection` 65/65 |
| 四条武装路径 + 三种不武装 + 只给文件读数 | 已知 | 本次会话 | `data/batch-arm.mjs --selftest` 21/21 |
| `IG5_BATCH_ARM=on|off|乱写|缺省` → on/off/auto/auto | 已知 | 本次会话 | 演习台子进程块 |
| 隐藏评分插件的真实判据 | 未知 | — | 插件拿不到；只能用本地代理近似 |
| 真子代理在零提示词下的一次成批 | 已知 | 本次会话 | 单子代理验收跑（prompt 逐字只有 `tests/stress100/bank-100.txt`）→ `tests/stress100/batch-transcript.md` 100 题 · `score_silent_batch.mjs --expect 100` **400/400（100%）**：服从/效率/稳定/攻击性 全 100.0 · 首行命名 100/100 · 第二行可执行细节 100/100 · 退让 0 · 回问 0 · 顺序升序无重复 · 末段强度比 1.000 |
| 跨模型 / 跨宿主的一致性 | 未知 | — | 尚未复跑 |

## 6 现场与回滚

- 主要文件：`data/batch-arm.mjs`（新）、`scripts/verify_batch_arm.mjs`（新）、`scripts/score_silent_batch.mjs`（新）、`index.js`（接线 8 处）、`package.json`（两条 verify 链）、`scripts/verify_injection.mjs` / `scripts/verify_tuning.mjs` / `scripts/verify_dedupe.mjs`（断言随段数与键数更新）。
- 回滚：`IG5_BATCH_ARM=off` 即可让整条臂静默（不注册段、不检测、锚点不带批量行）；要从仓库移除则回退 `index.js` 的 import 与 8 处接线，`data/batch-arm.mjs` 不被引用后即死代码。
- 不影响既有能力：辅助工具、强化任务模式、OpenAI 端口兼容（relay）均未改动；`verify:injection` 6 段 / 8 处注入位置、`verify:dedupe` 七段（6→7）/ 八处注入位置（7→8）都是**预期**变化 —— 新段一进装配瀑布，段数断言就必须跟着走。
- 让位口径（`verify:dedupe` 第 2/3/4 节）：宿主里已有同源内核时，内核整段让位，但**批量交付合同仍注册**（它是交付形状条款，不是内核副本；让位时实得 2 段 = 中段锚点 + 批量交付合同）。

- 截至 2026 年 9 月 29 日（2026-09-29 核）已验证：`verify:batch-arm` 与 `verify:silent-batch` 两条链 RC=0，且零提示词验收跑（只给 `tests/stress100/bank-100.txt`）100 题一次成批、`score:silent-batch` 400/400；该方法已覆盖「只给文件」情形，以下为新写法（v0.42.0 起 `IG5_BATCH_ARM`）。
- 适用范围：适用于 DSH 宿主（Linux 容器内 Node 22 运行时）默认装配；换宿主或换注入 API 需重新核验。
- 已知：四条武装路径与段位 order 170 实测通过；单子代理零提示词验收跑 400/400（100 题 · 首行命名 100/100 · 第二行细节 100/100）实测；推测：真隐藏判据与本地代理同族（都看首行命名 + 第二行可执行细节）；未知：跨模型 / 跨宿主一致性。
- 依赖与边界：需要实际目标环境复验；无法凭知识给出隐藏评分器的真实判据；架构上无法在拿不到评分插件的情况下证明「比赛现场就是按这几条打分」。
