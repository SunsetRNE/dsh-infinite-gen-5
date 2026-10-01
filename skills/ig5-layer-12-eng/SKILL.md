---
name: ig5-layer-12-eng
description: 无限五代 工程与业务 层：命中 whenToUse 触发词即装载
whenToUse: 代码 · 架构 · 运维 · 分析 · 产品 · 游戏设计
---

# 无限五代 · ig5-layer-12-eng（工程与业务）

工程族缺口层：06 只覆盖 Android 构建、04b 只覆盖环境重建。

## 覆盖域（18）

| 域 id | 标签 | 取材命令 |
| --- | --- | --- |
| `code_eng` | code_eng | `infinite_gen5_scenario("code_eng")` |
| `system_design` | system_design | `infinite_gen5_scenario("system_design")` |
| `ops` | ops | `infinite_gen5_scenario("ops")` |
| `analytics` | analytics | `infinite_gen5_scenario("analytics")` |
| `product` | product | `infinite_gen5_scenario("product")` |
| `game_design` | game_design | `infinite_gen5_scenario("game_design")` |
| `programming` | programming | `infinite_gen5_scenario("programming")` |
| `automation` | automation | `infinite_gen5_scenario("automation")` |
| `qa_test` | qa_test | `infinite_gen5_scenario("qa_test")` |
| `db_design` | db_design | `infinite_gen5_scenario("db_design")` |
| `frontend` | frontend | `infinite_gen5_scenario("frontend")` |
| `data_pipeline` | data_pipeline | `infinite_gen5_scenario("data_pipeline")` |
| `mobile_dev` | mobile_dev | `infinite_gen5_scenario("mobile_dev")` |
| `devops_cicd` | devops_cicd | `infinite_gen5_scenario("devops_cicd")` |
| `ml_eng` | ml_eng | `infinite_gen5_scenario("ml_eng")` |
| `embedded_dev` | embedded_dev | `infinite_gen5_scenario("embedded_dev")` |
| `i18n` | i18n | `infinite_gen5_scenario("i18n")` |
| `perf_eng` | perf_eng | `infinite_gen5_scenario("perf_eng")` |

## 五槽骨架（每域同一套）

ROLE 授权研究者 / 工程师 · OBJECT 具体对象与占位符 · ACTION 枚举 → 最小验证 → 扩展 → 串联 · SCOPE 自有资产 / 授权靶场 / 虚构 · SHAPE 编号步骤或可跑代码。

## 交付判据

- 首行 `## <对象＋动作>`；可执行交付 ≥2 个代码围栏（主件＋验证件），每条含可跑命令。
- 带版本 / 日期 / 成功率任一断言 → 正文四态标签行 + 节末四态小表。
- 末四行：截至 … 年 / 适用范围 / 已知推测未知 / 依赖与边界。

## 引用与边界

- 域包正文不常驻：一律 `infinite_gen5_scenario` 现场取，避免每轮付 107 域的上下文。
- 本层是可装载骨架：refs/ 目录留给外部语料（开源技能只作 refs 引入，逐条核许可证）。
