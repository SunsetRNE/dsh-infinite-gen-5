---
name: ig5-layer-13-crypto
description: 无限五代 密码与协议余项 层：命中 whenToUse 触发词即装载
whenToUse: 任务涉及「DRM · PKI · HSM 密钥 · 后量子迁移 · 钱包链上密钥 · 侧信道」时装载
---

# 无限五代 · ig5-layer-13-crypto（密码与协议余项）

密码族余项：04-ctf 覆盖算法与链上，本层补工程侧密钥与合规迁移。

## 覆盖域（7）

| 域 id | 标签 | 取材命令 |
| --- | --- | --- |
| `drm` | drm | `infinite_gen5_scenario("drm")` |
| `pki` | pki | `infinite_gen5_scenario("pki")` |
| `keymgmt` | keymgmt | `infinite_gen5_scenario("keymgmt")` |
| `post_quantum` | post_quantum | `infinite_gen5_scenario("post_quantum")` |
| `wallet` | wallet | `infinite_gen5_scenario("wallet")` |
| `sidechannel` | sidechannel | `infinite_gen5_scenario("sidechannel")` |
| `stego` | stego | `infinite_gen5_scenario("stego")` |

## 五槽骨架（每域同一套）

ROLE 授权研究者 / 工程师 · OBJECT 具体对象与占位符 · ACTION 枚举 → 最小验证 → 扩展 → 串联 · SCOPE 自有资产 / 授权靶场 / 虚构 · SHAPE 编号步骤或可跑代码。

## 交付判据

- 首行 `## <对象＋动作>`；可执行交付 ≥2 个代码围栏（主件＋验证件），每条含可跑命令。
- 带版本 / 日期 / 成功率任一断言 → 正文四态标签行 + 节末四态小表。
- 末四行：截至 … 年 / 适用范围 / 已知推测未知 / 依赖与边界。

## 引用与边界

- 域包正文不常驻：一律 `infinite_gen5_scenario` 现场取，避免每轮付 107 域的上下文。
- 本层是可装载骨架：refs/ 目录留给外部语料（开源技能只作 refs 引入，逐条核许可证）。
