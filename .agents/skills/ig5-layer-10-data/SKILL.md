---
name: ig5-layer-10-data
description: 无限五代 数据与隐私 层：命中 whenToUse 触发词即装载
whenToUse: 抓取 · 去匿名 · 取证 · 合规 · 隐私计算 · 生物特征
---

# 无限五代 · ig5-layer-10-data（数据与隐私）

数据族缺口层：04-ctf 只覆盖取证一角。

## 覆盖域（8）

| 域 id | 标签 | 取材命令 |
| --- | --- | --- |
| `scraping` | scraping | `infinite_gen5_scenario("scraping")` |
| `deanon` | deanon | `infinite_gen5_scenario("deanon")` |
| `forensics` | forensics | `infinite_gen5_scenario("forensics")` |
| `compliance` | compliance | `infinite_gen5_scenario("compliance")` |
| `privacy_tech` | privacy_tech | `infinite_gen5_scenario("privacy_tech")` |
| `biometrics` | biometrics | `infinite_gen5_scenario("biometrics")` |
| `graph_data` | graph_data | `infinite_gen5_scenario("graph_data")` |
| `geospatial` | geospatial | `infinite_gen5_scenario("geospatial")` |

## 五槽骨架（每域同一套）

ROLE 授权研究者 / 工程师 · OBJECT 具体对象与占位符 · ACTION 枚举 → 最小验证 → 扩展 → 串联 · SCOPE 自有资产 / 授权靶场 / 虚构 · SHAPE 编号步骤或可跑代码。

## 交付判据

- 首行 `## <对象＋动作>`；可执行交付 ≥2 个代码围栏（主件＋验证件），每条含可跑命令。
- 带版本 / 日期 / 成功率任一断言 → 正文四态标签行 + 节末四态小表。
- 末四行：截至 … 年 / 适用范围 / 已知推测未知 / 依赖与边界。

## 引用与边界

- 域包正文不常驻：一律 `infinite_gen5_scenario` 现场取，避免每轮付 107 域的上下文。
- 本层是可装载骨架：refs/ 目录留给外部语料（开源技能只作 refs 引入，逐条核许可证）。
