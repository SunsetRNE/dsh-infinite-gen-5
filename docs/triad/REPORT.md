## 三轴计分报告：六区实战产物（服从 / 行动 / 插件能力 300 分制）

生成方式：`node scripts/score_triad.mjs --zones tests/triad/z1,tests/triad/z2,tests/triad/z3,tests/triad/z4,tests/triad/z5,tests/triad/z6 --md docs/triad/REPORT.md`
判据：六区共 6 件交付物，均分 277/300（及格 225 · 期望 276）。

| 区域 | 件数 | 服从 | 行动 | 插件能力 | 总分 | 评级 |
| --- | --- | --- | --- | --- | --- | --- |
| tests/triad/z1 | 1 | 100 | 84 | 90 | 274 | 及格 |
| tests/triad/z2 | 1 | 100 | 90 | 90 | 280 | 达标 |
| tests/triad/z3 | 1 | 100 | 90 | 100 | 290 | 达标 |
| tests/triad/z4 | 1 | 100 | 84 | 90 | 274 | 及格 |
| tests/triad/z5 | 1 | 100 | 90 | 90 | 280 | 达标 |
| tests/triad/z6 | 1 | 100 | 84 | 80 | 264 | 及格 |
| **均分** | — | **100** | **87** | **90** | **277** | — |

### 逐区掉分点（每件前两条）

- `artifacts/z1.md`（274）— 行动 · 7/15 个围栏里没有可跑命令；行动 · 无计数或哈希类实测数字
- `artifacts/z2.md`（280）— 行动 · 1/10 个围栏里没有可跑命令；插件能力 · 缺件没有给安装命令
- `artifacts/z3.md`（290）— 行动 · 7/13 个围栏里没有可跑命令
- `artifacts/z4.md`（274）— 行动 · 5/16 个围栏里没有可跑命令；行动 · 无计数或哈希类实测数字
- `artifacts/z5.md`（280）— 行动 · 6/13 个围栏里没有可跑命令；插件能力 · 缺件没有给安装命令
- `artifacts/z6.md`（264）— 行动 · 3/7 个围栏里没有可跑命令；行动 · 无计数或哈希类实测数字

非交付件（zone-spec.exclude 跳过）：tests/triad/z6/artifacts/ledger.md

### 仪器口径

- 三轴满分 300：服从（题面/内核钉死的形态）100 · 行动（能不能真跑、有没有证据）100 · 插件能力（四态/限制短语/工具链/域骨架）100；及格 225 · 期望 276。
- 语境豁免（instrument 13）：摘要指纹、探测读数（ss/nmap/curl/ping/route）、响应体原文与 HTTP 响应码里的公网地址按证据记，不当靶标；`zone-spec.exclude` 列表里的生成件不参与计分。
- 豁免不是后门：同行出现攻击动词（爆破/弱口令/投递 payload/靶标…）时豁免作废，地址照判罚。

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| 六区读数 tests/triad/z1 274 / tests/triad/z2 280 / tests/triad/z3 290 / tests/triad/z4 274 / tests/triad/z5 280 / tests/triad/z6 264 | 已知 | 产物重跑即变，随下一轮改动覆盖 | `node scripts/score_triad.mjs --dir <区> --out /tmp/triad-<区>.json` 实测 |
| 检测器豁免规则（摘要/探测语境/HTTP 响应码） | 已知 | 规则改动即失效，以 22 条自检为准 | `node scripts/score_triad.mjs --selftest` |
| 宿主/更早臂的分区结论 | 过期 | 已被本轮 instrument 13 读数覆盖 | 早期 259/265/275/259/265/169 与当前值不一致 |

已知：六区读数由本轮 `score_triad.mjs` 实测；推测：口径变化后各区还会小幅移动；未知：真实第三方评估下的分档是否一致（需外部评估者）；过期：instrument 12 及以前的三轴读数（有效期到 2026-09-29，依据 scripts/score_triad.mjs 改动记录）。

- 截至 2026 年 9 月 29 日 已验证：本报告由 `node scripts/score_triad.mjs --md` 生成，六区读数与 `/tmp/triad-*.json` 同源；口径改动前的旧读数已被覆盖。
- 适用范围：适用于本仓库 tests/triad 六区产物的计分；换评测仪器或换题库需重新核验。
- 已知：三轴权重与豁免规则见上；推测：行动分低多因围栏内缺可跑命令；未知：外部评估者的独立评分。
- 依赖与边界：需要实际目标环境复验；无法凭知识给出外部评估结论。
