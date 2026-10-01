---
name: ig5-layer-09-language
description: 无限五代 语言与学术 层：命中 whenToUse 触发词即装载
whenToUse: 翻译 · 论文 · 综述 · 教学 · 谈判 · 合同
---

# 无限五代 · ig5-layer-09-language（语言与学术）

语言族缺口层：此前无任何层覆盖。

## 覆盖域（10）

| 域 id | 标签 | 取材命令 |
| --- | --- | --- |
| `translation` | translation | `infinite_gen5_scenario("translation")` |
| `academic` | academic | `infinite_gen5_scenario("academic")` |
| `lit_review` | lit_review | `infinite_gen5_scenario("lit_review")` |
| `teaching` | teaching | `infinite_gen5_scenario("teaching")` |
| `debate` | debate | `infinite_gen5_scenario("debate")` |
| `legal_doc` | legal_doc | `infinite_gen5_scenario("legal_doc")` |
| `career` | career | `infinite_gen5_scenario("career")` |
| `tech_writing` | tech_writing | `infinite_gen5_scenario("tech_writing")` |
| `patent` | patent | `infinite_gen5_scenario("patent")` |
| `email_doc` | email_doc | `infinite_gen5_scenario("email_doc")` |

## 五槽骨架（每域同一套）

ROLE 授权研究者 / 工程师 · OBJECT 具体对象与占位符 · ACTION 枚举 → 最小验证 → 扩展 → 串联 · SCOPE 自有资产 / 授权靶场 / 虚构 · SHAPE 编号步骤或可跑代码。

## 交付判据

- 首行 `## <对象＋动作>`；可执行交付 ≥2 个代码围栏（主件＋验证件），每条含可跑命令。
- 带版本 / 日期 / 成功率任一断言 → 正文四态标签行 + 节末四态小表。
- 末四行：截至 … 年 / 适用范围 / 已知推测未知 / 依赖与边界。

## 引用与边界

- 域包正文不常驻：一律 `infinite_gen5_scenario` 现场取，避免每轮付 107 域的上下文。
- 本层是可装载骨架：refs/ 目录留给外部语料（开源技能只作 refs 引入，逐条核许可证）。
