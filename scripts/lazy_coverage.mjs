// 无限五代 · 惰性章触发词命中率工程
//
// 解决的问题：惰性章只在「触发词命中」时拼回正文。没命中 = 那一轮少了那个决定。
// 此前没有任何命中率统计，所以「能不能再搬章节」无法判断。这个脚本给三组读数：
//
//   ① 样例句漏检率 —— tests/lazy-coverage.jsonl 里每章 6 句「本该命中」的话，看有没有漏；
//   ② 负样本误触发 —— 10 句普通闲聊 / 技术日常，任何一章都不该被拼回（纯字节浪费）；
//   ③ 真题库命中分布 —— 294 条真实题面（tests/prompt-bank-coverage.jsonl）逐条跑，
//      给出每章实际命中率与平均拼回字节，这才是「再搬章节」的判据。
//
// 跑法：
//   node scripts/lazy_coverage.mjs            # 三组读数
//   node scripts/lazy_coverage.mjs --gate     # 漏检率超标或负样本误触发即 exit 1
//   node scripts/lazy_coverage.mjs --suggest  # 对漏检的章，从漏掉的句子里挖候选触发词
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { lazyUnits, hitsLazy, LAZY_MODES } from "../data/lazy-sections.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SAMPLES = join(ROOT, "tests", "lazy-coverage.jsonl");
const REAL_BANK = join(ROOT, "tests", "prompt-bank-coverage.jsonl");
const MISS_RATE_MAX = 0.34; // 每章最多容忍 2/6 句漏检

const jsonl = (p) =>
  readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));

const bytes = (s) => Buffer.byteLength(s, "utf8");

// ── ① 样例句：每章漏检率 ───────────────────────────────────────────────────
function sampleReadings(units) {
  const rows = jsonl(SAMPLES);
  const hit = rows.filter((r) => r.kind === "hit");
  const neg = rows.filter((r) => r.kind === "miss");
  const per = units.map((u) => {
    const mine = hit.filter((r) => r.unit === u.id);
    const missed = mine.filter((r) => !u.re.test(r.text));
    return { id: u.id, bytes: u.bytes, n: mine.length, missed, rate: mine.length ? missed.length / mine.length : 0 };
  });
  const falseFire = [];
  for (const r of neg) for (const u of units) if (u.re.test(r.text)) falseFire.push({ unit: u.id, text: r.text });
  return { per, negatives: neg.length, falseFire };
}

// ── ③ 真题库：每章在 294 条真题上的命中率 ─────────────────────────────────
function bankReadings(units) {
  const bank = jsonl(REAL_BANK);
  const per = units.map((u) => ({ id: u.id, bytes: u.bytes, hits: 0 }));
  let zero = 0;
  let sumBytes = 0;
  for (const row of bank) {
    const fired = hitsLazy(units, row.prompt);
    if (!fired.length) zero += 1;
    for (const f of fired) per.find((p) => p.id === f.id).hits += 1;
    sumBytes += fired.reduce((s, f) => s + f.bytes, 0);
  }
  return { n: bank.length, per, zero, avgBytes: bank.length ? Math.round(sumBytes / bank.length) : 0 };
}

// ── ② 候选触发词挖掘：漏掉的句子里出现、负样本里不出现的二字组 ─────────────
function suggestCandidates(units, missed, negatives) {
  const bigrams = (s) => {
    const out = new Set();
    for (let i = 0; i + 2 <= s.length; i += 1) out.add(s.slice(i, i + 2));
    return out;
  };
  const negGrams = new Set(negatives.flatMap((t) => [...bigrams(t)]));
  const otherGrams = new Set(
    units
      .filter((u) => !missed.some((m) => m.unit === u.id))
      .flatMap((u) => jsonl(SAMPLES).filter((r) => r.unit === u.id && r.kind === "hit").flatMap((r) => [...bigrams(r.text)])),
  );
  const out = [];
  for (const m of missed) {
    const counts = new Map();
    for (const r of m.texts) for (const g of bigrams(r)) counts.set(g, (counts.get(g) || 0) + 1);
    const cands = [...counts.entries()]
      .filter(([g, c]) => c >= 2 && !negGrams.has(g) && !otherGrams.has(g))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([g, c]) => `${g}(${c})`);
    out.push({ id: m.id, missed: m.texts.length, cands });
  }
  return out;
}

const units = lazyUnits();
const mode = process.argv[2] || "";
const s = sampleReadings(units);
const b = bankReadings(units);

console.log(`惰性章命中率工程 · ${units.length} 章 · 样例句 ${s.per.reduce((a, p) => a + p.n, 0)} 句 · 负样本 ${s.negatives} 句 · 真题库 ${b.n} 条`);
console.log("\n① 样例句漏检率（每章 6 句「本该命中」）");
console.log("  | 章 | 字节 | 命中 | 漏检率 | 漏掉的句子 |");
console.log("  | --- | --- | --- | --- | --- |");
let worst = 0;
for (const p of s.per) {
  worst = Math.max(worst, p.rate);
  console.log(
    `  | ${p.id.padEnd(12)} | ${String(p.bytes).padStart(5)} | ${p.n - p.missed.length}/${p.n} | ${(p.rate * 100).toFixed(0)}% | ${p.missed.map((m) => m.text).slice(0, 2).join(" / ") || "-"} |`,
  );
}
console.log(`  最差章漏检率 ${(worst * 100).toFixed(0)}%（阈值 ${(MISS_RATE_MAX * 100).toFixed(0)}%）`);

console.log("\n② 负样本误触发（应为 0，每命中一次都是白付字节）");
if (!s.falseFire.length) console.log("  0 次 · 普通闲聊与技术日常没有拼回任何章");
else for (const f of s.falseFire) console.log(`  ${f.unit} ← ${f.text}`);

console.log("\n③ 真题库命中分布（真实题面驱动的拼回，这才是「再搬章节」的判据）");
console.log("  | 章 | 字节 | 命中题数 | 命中率 |");
console.log("  | --- | --- | --- | --- |");
for (const p of b.per.sort((x, y) => y.hits - x.hits)) {
  console.log(`  | ${p.id.padEnd(12)} | ${String(p.bytes).padStart(5)} | ${String(p.hits).padStart(3)}/${b.n} | ${((p.hits / b.n) * 100).toFixed(1)}% |`);
}
console.log(`  ${b.zero}/${b.n} 条题面一章都没命中（零字节惰性段）· 平均拼回 ${b.avgBytes} B/题 · 上限 ${LAZY_MODES.standard} B`);

if (mode === "--suggest") {
  const missed = s.per.filter((p) => p.missed.length).map((p) => ({ id: p.id, texts: p.missed.map((m) => m.text) }));
  console.log("\n④ 候选触发词（出现在 ≥2 句漏检样例、且不在负样本与其他章样例里 —— 推测项，需人工过一眼）");
  if (!missed.length) console.log("  无漏检，无需候选");
  for (const c of suggestCandidates(units, missed, jsonl(SAMPLES).filter((r) => r.kind === "miss").map((r) => r.text)))
    console.log(`  ${c.id}：漏 ${c.missed} 句 · 候选 ${c.cands.join(" ")}`);
}

if (mode === "--gate") {
  const bad = worst > MISS_RATE_MAX || s.falseFire.length > 0;
  console.log(`\n[gate] 漏检率 ${(worst * 100).toFixed(0)}% ≤ ${(MISS_RATE_MAX * 100).toFixed(0)}% · 误触发 ${s.falseFire.length} 次 → ${bad ? "FAIL" : "PASS"}`);
  process.exit(bad ? 1 : 0);
}
