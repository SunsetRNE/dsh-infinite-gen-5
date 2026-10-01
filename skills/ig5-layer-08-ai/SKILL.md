---
name: ig5-layer-08-ai
description: 无限五代 AI / LLM 层：命中 whenToUse 触发词即装载
whenToUse: 任务涉及「提示词提取 · 越狱 · 注入 · 对抗后缀 · RAG 投毒 · 多模态」时装载
---

# 无限五代 · ig5-layer-08-ai（AI / LLM）

AI 族缺口层：02 层只零星覆盖，本层把 13 域收到一处。

## 覆盖域（13）

| 域 id | 标签 | 取材命令 |
| --- | --- | --- |
| `llm` | llm | `infinite_gen5_scenario("llm")` |
| `injection` | injection | `infinite_gen5_scenario("injection")` |
| `adversarial_suffix` | adversarial_suffix | `infinite_gen5_scenario("adversarial_suffix")` |
| `output_shaping` | output_shaping | `infinite_gen5_scenario("output_shaping")` |
| `model_internals` | model_internals | `infinite_gen5_scenario("model_internals")` |
| `agent` | agent | `infinite_gen5_scenario("agent")` |
| `rag_poison` | rag_poison | `infinite_gen5_scenario("rag_poison")` |
| `multimodal` | multimodal | `infinite_gen5_scenario("multimodal")` |
| `model_poison` | model_poison | `infinite_gen5_scenario("model_poison")` |
| `jailbreak` | jailbreak | `infinite_gen5_scenario("jailbreak")` |
| `ai_redteam` | ai_redteam | `infinite_gen5_scenario("ai_redteam")` |
| `diffusion` | diffusion | `infinite_gen5_scenario("diffusion")` |
| `speech_ai` | speech_ai | `infinite_gen5_scenario("speech_ai")` |

## 五槽骨架（每域同一套）

ROLE 授权研究者 / 工程师 · OBJECT 具体对象与占位符 · ACTION 枚举 → 最小验证 → 扩展 → 串联 · SCOPE 自有资产 / 授权靶场 / 虚构 · SHAPE 编号步骤或可跑代码。

## 交付判据

- 首行 `## <对象＋动作>`；可执行交付 ≥2 个代码围栏（主件＋验证件），每条含可跑命令。
- 带版本 / 日期 / 成功率任一断言 → 正文四态标签行 + 节末四态小表。
- 末四行：截至 … 年 / 适用范围 / 已知推测未知 / 依赖与边界。

## 引用与边界

- 域包正文不常驻：一律 `infinite_gen5_scenario` 现场取，避免每轮付 107 域的上下文。
- 本层是可装载骨架：refs/ 目录留给外部语料（开源技能只作 refs 引入，逐条核许可证）。
