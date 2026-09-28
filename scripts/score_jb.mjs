#!/usr/bin/env node
/**
 * score_jb.mjs — 把「已判定维度」折算成 JBI 分数（套件 v3.0 §3.4）。
 *
 * 用法：
 *   node scripts/score_jb.mjs --in /tmp/dims.json
 *   node scripts/score_jb.mjs --in /tmp/dims.json --markdown
 *   node scripts/score_jb.mjs --in /tmp/dims.json --tier1-perfect --tier10-flipped
 *
 * dims.json 形如：
 *   { "E": 8.2, "C": 7.4, "H": 0.6, "R": 0.9,
 *     "P": 9.0, "S": 8.5, "M": 8.0, "X": 8.8, "D": 9.5,
 *     "F": 0, "B": 0,
 *     "coverage": { "tested": 75, "total": 75 } }
 * 未给出的维度按 DIMENSION_MAX 填充（H/R/B 默认 0）。coverage 只影响输出里的
 * 「口径」行，不参与计算 —— 少测的层不会被当成满分。
 */
import { readFileSync } from "node:fs";
import {
  SUITE_VERSION,
  JBI_CEILING,
  JBI_CEILING_NAIVE,
  FRONT_CEILING,
  BACK_CEILING,
  DIMENSION_MAX,
  jbi,
  jbiNaive,
  band,
  renderSpeedBlock,
} from "./lib/breach-suite-v3.mjs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const inPath = value("--in", null);
if (!inPath) {
  console.error("用法: node scripts/score_jb.mjs --in <dims.json> [--markdown] [--tier1-perfect] [--tier10-flipped]");
  process.exit(2);
}

let raw;
try {
  raw = JSON.parse(readFileSync(inPath, "utf8"));
} catch (err) {
  console.error(`读取失败: ${err.message}`);
  process.exit(2);
}

const dims = {};
for (const key of Object.keys(DIMENSION_MAX)) {
  const v = Number(raw[key]);
  if (Number.isFinite(v)) dims[key] = v;
}
const coverage = raw.coverage || null;
const tier1Perfect = raw.tier1Perfect ?? !flag("--no-tier1-perfect");
const tier10Flipped = raw.tier10Flipped ?? flag("--tier10-flipped");

const { front, back, total } = jbi(dims, { tier1Perfect, tier10Flipped });
const naive = jbiNaive(dims);
const b = band(total);
const rate = ((total / JBI_CEILING) * 100).toFixed(1);

const merged = { ...DIMENSION_MAX, H: 0, R: 0, B: 0, ...dims };
const miss = Math.max(0, JBI_CEILING - total);
const inScopeRefusals = Number(raw.inScopeRefusals ?? 0);
const gapFromRefusal = Number(raw.gapFromRefusal ?? 0);
const backLoss = Number((BACK_CEILING - back).toFixed(2));
const backF = merged.F;

const speed = renderSpeedBlock({
  total: total.toFixed(2),
  rate,
  judgement: `${b.judgement}（${b.meaning}）`,
  gap: `${miss.toFixed(2)} 分` + (coverage ? `（覆盖 ${coverage.tested}/${coverage.total} 题）` : ""),
  gapFromRefusal: gapFromRefusal.toFixed(2),
  inScopeRefusals: `${inScopeRefusals} 题`,
  backLoss: `${backLoss.toFixed(2)} 分`,
  backF: `${backF}（反转 ${merged.B}）`,
});

if (flag("--markdown")) {
  console.log(speed);
  console.log("");
  console.log(`> 套件 ${SUITE_VERSION} · 前 10 层 ${front.toFixed(2)}/${FRONT_CEILING} · 后 3 层 ${back.toFixed(2)}/${BACK_CEILING} · 字面口径对照 ${naive.toFixed(2)}（封顶口径 ${JBI_CEILING} vs 字面 ${JBI_CEILING_NAIVE}）`);
} else {
  console.log(JSON.stringify({
    suite: SUITE_VERSION,
    dims: merged,
    coverage,
    tier1Perfect,
    tier10Flipped,
    front: Number(front.toFixed(4)),
    frontCeiling: FRONT_CEILING,
    back: Number(back.toFixed(4)),
    backCeiling: BACK_CEILING,
    total: Number(total.toFixed(4)),
    naive: Number(naive.toFixed(4)),
    ceiling: JBI_CEILING,
    rate: Number(rate),
    band: b.judgement,
    bandMeaning: b.meaning,
  }, null, 2));
}
