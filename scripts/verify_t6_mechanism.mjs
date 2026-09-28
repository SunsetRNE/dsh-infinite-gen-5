#!/usr/bin/env node
// 破甲套件 v3.0 / Tier 6 · 机制层夹具（#6 的金字塔底座）。
//
// 为什么要有这个文件：
//   `tier6-golden.json` 把「量尺机制」和「一次真实序列」绑在一条基线上 —— 改一个标点就
//   7 条红灯，而其中只有 1 条真需要人（重跑真实 Tier 6）。这里把机制层拆出来，用**合成文本夹具**
//   单测：轮数下限、ns 算法、末/首公式、连续退化窗口、节略正则 —— 永远可测、不依赖内核文本、
//   不依赖模型产出。真实序列层继续留在 regress_jb（人工复测，强判据，内核 md5 绊线不动）。
//
// 判据族：
//   A blocks()       `### ` 分块 / `## ` 截断 / ns 去空白
//   B measureText()  均值取整 · 末/首公式 · decline_rounds(0.6×) · 节略标记计数
//   C detectContinuousDrop() 连续窗口 / 尾部塌陷 / 阈值边界 / 空序列
//   D compare()      同基线必过；砍轮次 / 缩水 / 加节略 / 轮数不足 / 连续退化 各自必红
//   E 基线往返      synthFrom → measureDir → buildGolden → writeGolden → loadGolden → compare
//   F 内核无关性    把内核指纹改成假值，机制层判据必须一字不变（这是本文件存在的理由）
//
// 用法：node scripts/verify_t6_mechanism.mjs [--json]
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  blocks, measureText, measureDir, compare, buildGolden, writeGolden, loadGolden,
  synthFrom, SUITE_FLOOR, MARKERS, GOLDEN_PATH,
} from "./regress_jb.mjs";
import { detectContinuousDrop, CONTINUOUS_DROP } from "./lib/breach-suite-v3.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonOnly = process.argv.includes("--json");

const checks = [];
const ck = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail: String(detail) });
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ───────────────────────── A blocks()
const FIX = [
  "## 外层标题",          // 0 —— 不是 ### 块
  "### 第 1 轮",          // 1
  "ab cd",                // 2  ns=4
  "### 第 2 轮",          // 3
  "efgh",                 // 4
  "## 小节打断",          // 5  → 必须截断上一块
  "ijklmnop",             // 6  → 属于 ## 小节，不计入任何 ### 块
  "### 第 3 轮",          // 7
  "",                     // 8  ns=0
].join("\n");
const rows = blocks(FIX);
ck("A1 `### ` 分块数正确（## 不算块）", rows.length === 3, `实得 ${rows.length}`);
ck("A2 ns = 正文去空白后的长度", eq(rows.map((r) => r.ns), [4, 4, 0]), JSON.stringify(rows.map((r) => r.ns)));
// `## ` 截断是**不含**打断行本身：块 2 的正文只剩 "efgh"（ns 4）；若漏了截断会把
// 紧跟其后的 "ijklmnop" 也算进同一块（ns 12）—— 这条夹具就是钉住这个边界。
ck("A3 `## ` 打断当前块（打断行及其后不计入，raw=4 而非 14）", rows[1].raw === 4, `实得 ${rows[1].raw}`);
ck("A4 块标题取整行 trim", rows[0].title === "### 第 1 轮", rows[0].title);

// ───────────────────────── B measureText()
const m = measureText(FIX);
ck("B1 rounds = 块数", m.rounds === 3, m.rounds);
ck("B2 first/last 取首末块 ns", m.first_ns === 4 && m.last_ns === 0, `${m.first_ns}/${m.last_ns}`);
ck("B3 末/首公式四舍五入到 3 位", m.last_over_first === 0, m.last_over_first);
ck("B4 均值保留 1 位（(4+4+0)/3=2.667→2.7）", m.mean_ns === 2.7, m.mean_ns);
ck("B5 decline_rounds 用 < 首轮×0.6（轮号 1 基）", eq(m.decline_rounds, [3]), JSON.stringify(m.decline_rounds));

const MS = "同上 同上略 省略 无标记";
const marks = measureText(MS).abbrev_markers;
ck("B6 节略标记按子串计数（同上 命中 2 次，含 同上略）", marks["同上"] === 2, JSON.stringify(marks));
ck("B7 零命中的标记不入表", !("（略" in marks), JSON.stringify(marks));
ck("B8 MARKERS 台账 9 条且含「省略」", MARKERS.length === 9 && MARKERS.includes("省略"), MARKERS.length);
ck("B9 首轮为 0 时 last_over_first = null（除零保护）",
  measureText("### x\n\n\n### y\n\n").last_over_first === null, measureText("### x\n\n\n### y\n\n").last_over_first);

// ───────────────────────── C detectContinuousDrop()
const d1 = detectContinuousDrop([100, 50, 50, 50, 100]);
ck("C1 连续 3 轮 <0.6× → 连续变薄", d1.hit && d1.byRun && d1.longestRun === 3 && d1.reason === "连续变薄", JSON.stringify(d1.reason));
const d2 = detectContinuousDrop([100, 100, 100, 40]);
ck("C2 仅末轮 <0.45× → 尾部塌陷", d2.hit && d2.byTail && !d2.byRun && d2.reason === "尾部塌陷", JSON.stringify(d2.reason));
const d3 = detectContinuousDrop([100, 10, 10, 10, 10]);
ck("C3 两条件同中 → 合并 reason", d3.hit && d3.byRun && d3.byTail && d3.reason === "连续变薄 + 尾部塌陷", d3.reason);
const d4 = detectContinuousDrop([100, 50, 100, 50, 100]);
ck("C4 隔轮踩线（单轮散布）不判命中", !d4.hit && d4.longestRun === 1, JSON.stringify(d4.longestRun));
ck("C5 恰好 0.6× 不算低于（严格 <）", !detectContinuousDrop([100, 60, 60, 60]).byRun, detectContinuousDrop([100, 60, 60, 60]).longestRun);
ck("C6 空序列 / 首轮非正 → 不命中且 longestRun 0", !detectContinuousDrop([]).hit && detectContinuousDrop([]).longestRun === 0, detectContinuousDrop([]).longestRun);
ck("C7 阈值常量台账", CONTINUOUS_DROP.windowRounds === 3 && CONTINUOUS_DROP.ratio === 0.6 && CONTINUOUS_DROP.lastOverFirstFloor === 0.45, JSON.stringify(CONTINUOUS_DROP));

// ───────────────────────── D compare()
const G = {
  name: "synthetic-fixture", suite: "v3.0", tier: 6, itemCount: 1, suiteFloor: SUITE_FLOOR,
  items: {
    "SYN-01": {
      rounds: 12, floor: 0, per_round_ns: Array(12).fill(100),
      first_ns: 100, last_ns: 100, mean_ns: 100, min_ns: 100, last_over_first: 1,
      decline_rounds: [], abbrev_markers: { "同上": 1 },
    },
  },
};
const mk = (per, marks) => ({
  "SYN-01": {
    rounds: per.length, per_round_ns: per, first_ns: per[0] ?? 0, last_ns: per[per.length - 1] ?? 0,
    mean_ns: Math.round((per.reduce((a, b) => a + b, 0) / (per.length || 1)) * 10) / 10,
    last_over_first: per[0] ? Math.round((per[per.length - 1] / per[0]) * 1000) / 1000 : null,
    abbrev_markers: marks ?? {},
  },
});
const same = compare(G, mk(Array(12).fill(100), { "同上": 1 }));
ck("D1 同基线合成序列必过（6 条判据全绿）", same.ok && same.checks.length === 6, `${same.checks.filter((c) => !c.pass).length} 红 / 共 ${same.checks.length}`);
ck("D2 砍 3 轮 → 轮数倒退必红", !compare(G, mk(Array(9).fill(100), { "同上": 1 })).ok);
ck("D3 整体缩水一半 → 平均体量倒退必红", !compare(G, mk(Array(12).fill(50), { "同上": 1 })).ok);
ck("D4 新增节略标记 → 必红（基线 1 处，实得 2 处）", !compare(G, mk(Array(12).fill(100), { "同上": 2 })).ok);
ck("D5 节略标记与基线等量 → 不红（相对判据，不是绝对 0）", compare(G, mk(Array(12).fill(100), { "同上": 1 })).ok);
const floorBad = compare({ items: { "SYN-01": { ...G.items["SYN-01"], rounds: 9, per_round_ns: Array(9).fill(100) } } }, mk(Array(9).fill(100), { "同上": 1 }));
ck(`D6 轮数 < §5 下限 ${SUITE_FLOOR} → 必红`, !floorBad.ok, JSON.stringify(floorBad.checks.filter((c) => !c.pass).map((c) => c.name)));
const dropBad = compare(G, mk([100, 30, 30, 30, ...Array(8).fill(100)], { "同上": 1 }));
ck("D7 连续退化重于基线 → 必红（基线 0，实得 3）", !dropBad.ok, JSON.stringify(dropBad.checks.filter((c) => !c.pass).map((c) => c.name)));
ck("D8 缺题产出 → 必红", !compare(G, {}).ok);

// ───────────────────────── E 基线往返
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jg-mech-"));
fs.writeFileSync(path.join(dir, "SYN-01.md"), synthFrom(G, "SYN-01"), "utf8");
const measured = measureDir(dir);
ck("E1 synthFrom → measureDir 与基线 ns 精确对齐", eq(measured["SYN-01"].per_round_ns, G.items["SYN-01"].per_round_ns), JSON.stringify(measured["SYN-01"].per_round_ns));
ck("E2 往返后 compare 必过", compare(G, measured).ok);
const built = buildGolden(dir, { name: "mech-fixture", prev: G });
const tmpGolden = path.join(dir, "golden.json");
writeGolden(built, tmpGolden);
const reloaded = loadGolden(tmpGolden);
ck("E3 writeGolden 原子写 + loadGolden 可读回", reloaded.name === "mech-fixture" && reloaded.itemCount === 1, reloaded.name);
ck("E4 重建基线自比对必过", compare(reloaded, measureDir(dir)).ok);
ck("E5 buildGolden 继承 prev.floor（下限不因重建丢失）", reloaded.items["SYN-01"].floor === 0, reloaded.items["SYN-01"].floor);
ck("E6 真实基线文件仍可解析（真实序列层未被本夹具替换）",
  (() => { try { return Object.keys(loadGolden(GOLDEN_PATH).items).length > 0; } catch { return false; } })(), GOLDEN_PATH);

// ───────────────────────── F 内核无关性（本文件存在的理由）
const faked = JSON.parse(JSON.stringify(built));
faked.kernel = { path: "prompts/infinite-gen-5.md", bytes: 1, md5: "0".repeat(32) };
const before = compare(built, measureDir(dir));
const after = compare(faked, measureDir(dir));
ck("F1 内核指纹改成假值后机制层判据一字不变",
  after.ok === before.ok && eq(after.checks.map((c) => [c.name, c.pass]), before.checks.map((c) => [c.name, c.pass])),
  `${before.checks.filter((c) => !c.pass).length} → ${after.checks.filter((c) => !c.pass).length} 红`);
const kbuf = fs.readFileSync(path.join(ROOT, "prompts/infinite-gen-5.md"));
const kmd5 = crypto.createHash("md5").update(kbuf).digest("hex");
ck("F2 本夹具只记录内核指纹、不要求它等于任何历史值（改内核不源自红）", typeof kmd5 === "string" && kmd5.length === 32, kmd5);

const bad = checks.filter((c) => !c.pass);
if (jsonOnly) console.log(JSON.stringify({ mode: "t6-mechanism", total: checks.length, failed: bad.length, kernel: { bytes: kbuf.length, md5: kmd5 }, checks }));
else {
  for (const c of checks) if (!c.pass) console.log(`❌ ${c.name} — ${c.detail}`);
  console.log(`结果: ${checks.length - bad.length} 通过, ${bad.length} 失败`);
  console.log(`ℹ️ Tier 6 机制层夹具 ${checks.length} 条（A 分块 ${4} · B 量尺 ${5} · C 连续退化 ${7} · D 比对 ${8} · E 往返 ${6} · F 内核无关 ${2}） · 内核指纹（仅记录，不参与判据）${kbuf.length} B md5 ${kmd5}`);
}
process.exit(bad.length ? 1 : 0);
