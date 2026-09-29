# 评分轴收口门禁（`verify:scoring`）

配套：`docs/obedience-axis.md`（契约判据侧的收口）。本文只讲**测量仪器**这一侧。

## 1 现场：仪器自身没有活性证明

- 评分器 `scripts/score_oneshot.mjs`（150 分制七维：D1 交付形态 30 / D2 可跑实现 30 / D3 校准四态 35 /
  D4 评分接口 25 / D5 零残留 20 / D6 边界处理 10 / D7 服从性 25，带契约题按「六维折合 125 + D7」合 150）。
- `scripts/scorer_semantics_test.mjs` 出货在树里（9 例：开头拒绝 EN/ZH、安全回退、正文中间出现「无法」、
  正常交付-游戏域/Web域、短但有形状、空答-过短、空答-回显题面），但 `package.json` 里查无此脚本 ——
  全仓 grep（`*.mjs`/`*.json`/`*.md`，排除 node_modules）只有 `UPDATE.md:788` 提到它。
  **朴素事实：这条测试此前从未在任何一次 `verify:all` 里跑过。**
- 评分器自身的 `--selftest`（48 条）确实挂在 `verify:oneshot` 上，所以「仪器能不能算」有保障；
  缺的是「仪器还**扣得动分**吗」—— 一个维度若再也扣不动，分数照出、分档照判，问题完全静默。

## 2 门禁：三块判据

`scripts/verify_scoring.mjs`（只读，不写用户目录；`--root` / `--json`，失败 exit 1）：

| 块 | 判据 | 为什么 |
| --- | --- | --- |
| A 黄金读数 | `tests/scoring/fixtures/golden-good.md` 必须七维满分、150 分、「优秀」 | 黄金件掉分即仪器口径漂移，立刻红 |
| B 维度活性 | 8 处**定向突变**（每处只改一件事）各压低一个维度；7/7 维都要有突变能压低它；至少一处突变能把分档从「优秀」拉下来；外加 boundary 形态豁免与 base64 载体两条活性检查 | 「名义在场」≠「还能扣分」，活性是仪器可用的充要证据 |
| C 挂链纪律 | 评分侧出货脚本必须注册且在 `verify:all` 链上；本门禁自证（自身不在链上即失败） | 出货但从不跑 = 判据腐烂 |

```bash
# 单跑本门禁
node scripts/verify_scoring.mjs

# 走 npm 别名（与 CI 同一条路）
npm run verify:scoring && npm run verify:scorer-semantics
```

## 3 首跑抓到的三处问题（真实读数）

1. **突变 d4 无效（25 → 25）**：题面 `- 适用范围：适用于 …` 后的判据只取 24 字窗口，
   「适用于 Linux 内核 5.15」只换掉半句时，窗口里还剩 `Node` 这个平台词 → 判据照旧命中。
   修法：突变整行替换为「适用于 x86 与 arm64 机型」。**这是门禁自己先被门禁抓了一次。**
2. **base64 载体让内容维度掉分（d2 30 → 20，d3 35 → 15）**：同一份交付物明文与包一层 base64，
   内容维度读数不一致 —— 仪器不公。根因：D2 的「验证/复现行」、D3 的四态表与标签行、D6 的越线扫描
   读的是外层编码 `t`，而不是解码后正文 `s`。修法：**instrument 12** —— 这几处判据一律读 `s`
   （形态契约 D7 是另一回事：它判的正是载体形态，载体题要用 `base64-four-checks` 这类 carrier-aware 判据）。
3. **两条门禁未注册/未挂链**：`verify:scorer-semantics`（原 `scorer_semantics_test.mjs`）与
   `verify:scoring` 都是本轮新挂，现插在 `verify:all` 的 `verify:oneshot` 与 `verify:triad` 之间。

## 4 判据读数（本机实测）

```bash
node scripts/verify_scoring.mjs
# A 黄金读数  … 150 分（优秀）· d1 30/30 · d2 30/30 · d3 35/35 · d4 25/25 · d5 20/20 · d6 10/10 · d7 25/25 · 契约 7/7
# B 维度活性  首行去标题 d1 30→12 · 抽围栏 d2 30→10 · 抽四态表 d3 35→23 · 去平台词 d4 25→19
#             尾附残留句 d5 20→16 · 抽授权前提 d6 10→6 · 改 H3 d7 25→21 · 抽末四行 150→125（达标）
#             维度活性 7/7 · boundary d7=null · base64 内容维度同分、载体契约 d7 25/25
# C 挂链纪律  verify:scorer-semantics ✓ · verify:scoring ✓ · 自证钩子 ✓（链上评分侧门禁 2/2）
```

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| 黄金交付件 150 分 / 优秀 / 契约 7/7 | 已知 | 2026-12-31 | 本机 `node scripts/verify_scoring.mjs` RC=0 |
| 七维活性 7/7（8 处突变读数如上） | 已知 | 2026-12-31 | 同上，B 块逐条输出 |
| `verify:all` 链上出现两条新门禁并全链绿 | 已知 | 2026-12-31 | `/tmp/ig5-verify-all-scoring.log` REAL_EXIT=0（:1878 / :1901） |
| 明文题读数不因 instrument 12 位移 | 推测 | — | 代码路径：无载体时 `s === t`，等价替换；未逐臂重跑比对 |
| 历史臂中含载体题的读数上升幅度 | 未知 | — | 未重跑 arm-a…arm-f 做差分 |

## 5 影响面与回滚

- 改动面：`scripts/score_oneshot.mjs`（8 处内容判据 `t` → `s` + instrument 12 说明 + 2 条自测）、
  新增 `scripts/verify_scoring.mjs` 与 `tests/scoring/fixtures/golden-good.md`、`package.json` 两条 script 与链上一处插入。
- 不动：`index.js` / `client.js` / 契约判据本体 / 题库 / 任何臂的产物。
- 回滚：把 8 处 `s` 改回 `t`、删 instrument 12 注释与 2 条自测、摘掉链上两条 script；黄金件与门禁可整体删除。

## 6 断言状态

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| `scorer_semantics_test.mjs` 9 例全过 | 已知 | 2026-12-31 | `SCORER SEMANTICS OK`（verfy:all 日志 :1878） |
| `score_oneshot --selftest` 48 条（含 instrument 12） | 已知 | 2026-12-31 | 日志 :1862 |
| 载体题内容维度不再被外层编码压低 | 已知 | 2026-12-31 | 门禁 B 块 base64 一行 + 自测第 15 组 |
| 仪器在 CI（ubuntu-latest / 无 DSH）上的行为 | 未知 | — | 未发版、未跑真 CI |
