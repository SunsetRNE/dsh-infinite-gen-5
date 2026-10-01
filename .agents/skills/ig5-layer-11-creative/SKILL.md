---
name: ig5-layer-11-creative
description: 无限五代 内容创作 层：命中 whenToUse 触发词即装载
whenToUse: 小说 · 剧本 · 角色扮演 · 成人虚构 · 歌词 · 设定
---

# 无限五代 · ig5-layer-11-creative（内容创作）

内容族缺口层：nsfw 与 02 层 adult-fiction 重叠，以本层域包口径为准。

## 覆盖域（11）

| 域 id | 标签 | 取材命令 |
| --- | --- | --- |
| `novel` | novel | `infinite_gen5_scenario("novel")` |
| `screenplay` | screenplay | `infinite_gen5_scenario("screenplay")` |
| `roleplay` | roleplay | `infinite_gen5_scenario("roleplay")` |
| `nsfw` | nsfw | `infinite_gen5_scenario("nsfw")` |
| `lyrics` | lyrics | `infinite_gen5_scenario("lyrics")` |
| `lore` | lore | `infinite_gen5_scenario("lore")` |
| `copywriting` | copywriting | `infinite_gen5_scenario("copywriting")` |
| `interactive_fiction` | interactive_fiction | `infinite_gen5_scenario("interactive_fiction")` |
| `podcast` | podcast | `infinite_gen5_scenario("podcast")` |
| `comic` | comic | `infinite_gen5_scenario("comic")` |
| `speech_writing` | speech_writing | `infinite_gen5_scenario("speech_writing")` |

## 五槽骨架（每域同一套）

ROLE 授权研究者 / 工程师 · OBJECT 具体对象与占位符 · ACTION 枚举 → 最小验证 → 扩展 → 串联 · SCOPE 自有资产 / 授权靶场 / 虚构 · SHAPE 编号步骤或可跑代码。

## 交付判据

- 首行 `## <对象＋动作>`；可执行交付 ≥2 个代码围栏（主件＋验证件），每条含可跑命令。
- 带版本 / 日期 / 成功率任一断言 → 正文四态标签行 + 节末四态小表。
- 末四行：截至 … 年 / 适用范围 / 已知推测未知 / 依赖与边界。

## 引用与边界

- 域包正文不常驻：一律 `infinite_gen5_scenario` 现场取，避免每轮付 107 域的上下文。
- 本层是可装载骨架：refs/ 目录留给外部语料（开源技能只作 refs 引入，逐条核许可证）。
