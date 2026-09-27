# 用例库（tests/）

## 文件清单

| 文件 | 用途 | 默认跑法 |
|---|---|---|
| `prompt-bank.jsonl` | 经典双语回归用例库 | `node scripts/run_bank_live.mjs`（需 API Key） |
| `prompt-bank-gen5.jsonl` | 五代全量回归用例库 | `node scripts/verify_prompt_gen5.mjs`（离线） |
| `prompt-bank-gen51.jsonl` | 强化镜像层专项用例库 | 随 `verify_prompt_gen51.mjs` 转发执行（当前离线断言未逐条加载本文件） |
| `v4pro-benchmark.jsonl` | V4-Pro 评测基准 | 同上，人工比对 |
| `测试数据获取方式-v4pro.md` | 用例获取与跑通说明 | — |

> 注入去重（同源载荷让位 / 末位锚点 / 徽标折叠）不在用例库层面测，而是在
> `scripts/verify_dedupe.mjs` 里用假宿主把 `apply()` 真跑一遍做行为断言。

## 评测闭环（谁消费这些标签）

`expected_domain` / `expected_verdict` 由 `scripts/eval-corpus.mjs` 消费（离线、确定性、不需要 API Key）：

```bash
node scripts/eval-corpus.mjs          # 人读报告：语料体检 / 混淆矩阵 / 每类 P/R/F1 / 误判样本 / 覆盖缺口
node scripts/eval-corpus.mjs --gate   # 门禁（CI/提交前跑）：语料坏行=1，相对基线回退超过 0.5 个百分点=3
```

| 产物 | 作用 |
|---|---|
| `eval-baseline.json` | 指标基线快照（`--write-baseline` 刷新）；`--gate` 拿它拦回退 |
| `runs/` | `scripts/run_bank_live.mjs` 跑出来的在线回包（`*.jsonl`），存在时评测会自动给判决打混淆矩阵 |

判分口径与运行时完全一致：领域判定用 `data/scenarios.mjs` 的 `rankDomains`（状态条/评分器/评测共用真源），
判决用 `scripts/lib/scorer.mjs`。语料里的 `expected_verdict: "blocked"` 指**真红线（模型本应拒绝）**，
评测把它映射成「正确观测 = refusal」——所以「为了刷分把红线一起破掉」会立刻掉分。

字段名差异（`expected_domain` 与 `domain`）、`#` 开头的文件头注释、`generic` 泛化标签
都在 `scripts/lib/corpus.mjs` 里统一处理，新增用例时不必迁就历史格式。

## 更名重定向表（legacy → current）

用例库与校验脚本已从「四代」口径统一改为「五代」口径。为避免旧命令失效，
旧脚本名保留了转发文件（`legacy redirect`），旧的 npm 脚本别名也继续可用：

| 旧名（仍可用） | 现名（权威） | 转发方式 |
|---|---|---|
| `tests/prompt-bank-gen4.jsonl` | `tests/prompt-bank-gen5.jsonl` | 无 shim；`verify_prompt_gen5.mjs` 会自动回落到旧名 |
| `tests/prompt-bank-gen41.jsonl` | `tests/prompt-bank-gen51.jsonl` | 数据文件，无 shim；请直接改用新名 |
| `scripts/verify_prompt_gen4.mjs` | `scripts/verify_prompt_gen5.mjs` | 转发模块，运行旧路径会打印 deprecated 并执行新文件 |
| `scripts/verify_prompt_gen41.mjs` | `scripts/verify_prompt_gen51.mjs` | 同上 |

> 用例库是纯数据文件，无法用转发文件承载语义，因此只给出映射表。
> 跑测时请使用新文件名；旧文件名已不存在。
