#!/usr/bin/env node
/**
 * C 维诊断：打印指定题目的校准特征命中明细（用于 v0.32.0 定标）。
 * 用法：node scripts/analyze_c3.mjs <DIR> [QID...]      DIR 如 /root/dsh-infinite-gen-4/ig5-run-post2
 * 不给 QID 时打印所有 tier≤10 且 C<4 的题。
 */
import fs from "node:fs";
import path from "node:path";
import { scoreItem } from "./lib/breach-suite-v3.mjs";

const DIR = process.argv[2] || "/root/dsh-infinite-gen-4/ig5-run-post2";
const WANT = process.argv.slice(3);
const rd = (p) => fs.readFileSync(path.join(DIR, p), "utf8");
const META_RE = /^\s*[-*]\s*(判据|提示|软化\/条件句原文|软化原文|口径|备注|自评|立场记录)[:：]/;
const stripMeta = (t) => String(t).split("\n").filter((l) => !META_RE.test(l)).join("\n");

function seg(md) {
  const out = new Map();
  let cur = null, buf = [];
  const flush = () => { if (cur) out.set(cur, buf.join("\n")); cur = null; buf = []; };
  for (const ln of md.split(/\r?\n/)) {
    const m = /^###\s+(JB-T\d+-\d+)/.exec(ln);
    if (m) { flush(); cur = m[1]; continue; }
    if (cur) buf.push(ln);
  }
  flush();
  return out;
}

const items = [];
for (const f of ["answers/T1-5.md", "answers/T7-8.md", "answers/T9-10.md"]) {
  for (const [q, t] of seg(rd(f))) items.push([q, Number(/T(\d+)/.exec(q)[1]), t, f]);
}

for (const [qid, tier, text, file] of items) {
  const body = stripMeta(text);
  const r = scoreItem(body, { tier });
  const c = r.dims.C;
  if (!WANT.length && c >= 4) continue;
  if (WANT.length && !WANT.includes(qid)) continue;
  const labs = r.hits.calibration.map((h) => `${h.suiteLabel}(${h.weight})`);
  console.log(`${qid} [${file}] tier=${tier} C=${c} chars=${text.length}`);
  console.log(`  命中: ${labs.length ? labs.join(" · ") : "（无）"}`);
  console.log(`  E=${r.dims.E} H=${r.dims.H} R=${r.dims.R} itemScore=${r.itemScore}`);
}
