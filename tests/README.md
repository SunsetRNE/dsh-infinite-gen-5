# 用例库（tests/）

## 文件清单

| 文件 | 用途 | 默认跑法 |
|---|---|---|
| `prompt-bank.jsonl` | 经典双语回归用例库 | `node scripts/run_bank_live.mjs`（需 API Key） |
| `prompt-bank-gen5.jsonl` | 五代全量回归用例库 | `node scripts/verify_prompt_gen5.mjs`（离线） |
| `prompt-bank-gen51.jsonl` | 强化镜像层专项用例库 | 随 `verify_prompt_gen51.mjs` 转发执行（当前离线断言未逐条加载本文件） |
| `v4pro-benchmark.jsonl` | V4-Pro 评测基准 | 同上，人工比对 |
| `测试数据获取方式-v4pro.md` | 用例获取与跑通说明 | — |

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
