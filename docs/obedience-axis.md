# 无限五代 · 服从性轴（服从性测试）覆盖面与收口门禁

本文件回答一个问题：**「服从性契约」这条轴，今天到底铺在哪儿、由谁盯着、盯漏过什么。**
所有数字与文件路径都是本机实测读到的，不是设计意图。

---

## 1. 现场：轴已经铺开，但「判据自己」没人盯

契约本体（`anchor-armor.mjs`）：`FIRST_LINE_TEXT` 走 Order -1100 首句层（排在宿主身份段之前），
`CONTRACT_MARK` / `CONTRACT_SHORT` 是同一份义务的短形，`withContract()` 往工具 description 上追加。

六条通道各自的载体与门禁（`node scripts/verify_contracts.mjs` 的矩阵逐条断言）：

| 通道 | 载体 | 通道门禁 | 在 verify:all |
| --- | --- | --- | --- |
| 首句层（Order -1100） | `anchor-armor.mjs`（FIRST_LINE_TEXT / CONTRACT_MARK / CONTRACT_SHORT） | `verify:armor` | 是 |
| 内核提示注入 | `index.js`（anchor-armor 引用 / CONTRACT_SHORT / withContract） | `harness:check` | 是 |
| 工具目录 / front-matter / 末位锚点回指行 | `anchor-armor.mjs`(withContract) + `scripts/verify_surface.mjs`(CONTRACT_MARK) | `verify:surface` | 是 |
| 技能通道 | `scripts/verify_skill.mjs`（技能正文逐字节含首句层 + 副本漂移） | `verify:skill` | 是 |
| 子代理任务书 / 服从性题库 | `scripts/oneshot_harness.mjs`(BANK_COMPLIANCE / 服从性题库) + `scripts/verify_dispatch.mjs`(withContract) | `verify:dispatch` | 是 |
| 评分口径 | `scripts/score_oneshot.mjs` + `scripts/score_triad.mjs`（checkContract） | `verify:oneshot` | 是 |

漏点（实测）：判据本体 `scripts/lib/contracts.mjs` 的 `contractsSelftest()` **全仓 0 个调用点** ——
它写着自己的纪律「新增 kind 必须同时写一条自测，否则判据会悄悄腐烂」，但没有任何东西会跑它。

## 2. 收口门禁：scripts/verify_contracts.mjs

三块判据，离线、确定性、不写用户目录：

- **A 判据自检**：`contractsSelftest()` 必须先过。它一失败，六条通道的判据全部不可信。
- **B 类型覆盖**：`CONTRACT_KINDS` 每一种都必须在自测正文里被引用（新增 kind 不补自测 = 立刻失败）。
- **C 通道矩阵**：每条通道的载体串在场 + 通道门禁脚本存在 + 该门禁已挂在 `verify:all` 链上；
  外加**自证钩子** —— 本门禁自己不在链上时报错，防止「收口」被悄悄摘钩。

```bash
cd /root/dsh-infinite-gen-5 && node scripts/verify_contracts.mjs     # 退出码 0 = 通过
node scripts/verify_contracts.mjs --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.channelsOk+"/"+j.channels.length, j.kinds, j.fails.length)})'
```

## 3. 它第一次跑就抓到的两处腐烂

1. **断言与实现语义不符**：原自测写「`跳转表偏移 401000 处` 应违反 no-bare-hex」，但 `bareHex()`
   有意把纯十进制串当计数/大小/inode 放行 —— 断言从未被执行，所以没人知道它一直是失败态。
   修法：换成含 a-f 的裸十六进制（必违反），并补一条 **反向判据**盯住 carve-out，防止有人收紧实现时误伤普通数字。
2. **8 种契约类型无自测**：`fence-contains` · `calib-labels` · `last-line-verbatim` · `verbatim-line` ·
   `max-chars` · `min-chars` · `bytes-max` · `base64-four-checks`。已逐种补上正/反两条断言
   （base64 用运行时编码的合规样本，不写死载荷）。

## 4. 判据读数（本机实跑）

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| 判据自检 39 条通过 / 25 种契约类型全覆盖 | 已知 | 改动 `scripts/lib/contracts.mjs` 前 | `node scripts/verify_contracts.mjs` 实跑 |
| 六条通道载体串在场 + 门禁挂链 | 已知 | 门禁被改名前 | 同一命令的通道矩阵输出 |
| `verify:version` 27 通过 / 0 失败 | 已知 | 版本锚点改动前 | `npm run verify:version` 实跑 |
| 全链 REAL_EXIT=0 | 已知 | 再次改动源码前 | `/tmp/ig5-verify-all-contracts.log` |
| 通道是否真能改变模型行为 | 未知 | — | 只有静态判据在场，缺端到端评分样本 |

## 5. 影响面与回滚

- 改动文件：`scripts/lib/contracts.mjs`（仅自测正文与计数）、`scripts/verify_contracts.mjs`（新增）、`package.json`（新增脚本 + 链上一位）。
- 不动插件运行时：`index.js` / `client.js` / 契约文本本身零改动，面板与注入行为不变。
- 回滚：删掉 `scripts/verify_contracts.mjs`、从 `verify:all` 摘掉 `verify:contracts`，
  `scripts/lib/contracts.mjs` 的 selftest 改动是纯增量（只加断言），可整段保留。

## 6. 断言状态

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| `contractsSelftest` 此前 0 调用点 | 已知 | 已由本门禁覆盖，不再复现 | 全仓 grep（`*.mjs`/`*.js`/`*.json`，排除 node_modules 与自身定义） |
| 39 条判据 / 25 种类型 | 已知 | 下次改 `contracts.mjs` | 本机实跑输出 |
| 「六条通道都真在起作用」 | 推测 | — | 静态在场 + 各自门禁历史绿码；缺端到端行为样本 |
| 服从性 `os` 号题库的穿透率 | 未知 | — | 需要真实子代理跑一次 150 分制评测 |
