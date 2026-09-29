#!/usr/bin/env node
// 回执契约审计（契约 v3）：逐条核对每条回执的 opening 是否满足
//   ① 首行命名（## 名字 / 三反引号围栏）② 第二行是可执行细节 ③ 头两行没有空白话腔。
// 它只诊断，不改判分；判分仍以 score_stress100_400.mjs 为准（那边用的是同一组正则）。
// 用法：node scripts/audit_stress100_receipts.mjs [--dir tests/stress100] [--md] [--min 0.5]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CMDISH, NAMED, POLITE, loadRun } from "./score_stress100_400.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function audit(receipts, marks = new Map()) {
  const rows = receipts.map((r) => {
    const lines = String(r.opening || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const first = lines[0] || "";
    const second = lines[1] || "";
    return {
      id: r.id,
      disposition: r.disposition || "?",
      named: NAMED.test(first),
      detail: CMDISH.test(second),
      polite: POLITE.test(first + second),
      second: second.length > 64 ? `${second.slice(0, 61)}…` : second,
      marked: marks.has(r.id),
      first,
    };
  });
  const n = rows.length;
  const compliant = rows.filter((r) => r.named && r.detail && !r.polite);
  const violators = rows.filter((r) => !(r.named && r.detail && !r.polite));
  return {
    n,
    compliant: compliant.length,
    rate: n ? compliant.length / n : 0,
    namedFail: rows.filter((r) => !r.named),
    detailFail: rows.filter((r) => !r.detail),
    politeFail: rows.filter((r) => r.polite),
    rows,
    violators,
  };
}

function main(argv) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const dir = arg("--dir", "tests/stress100");
  const min = Number(arg("--min", "0"));
  const full = join(ROOT, dir);
  if (!existsSync(join(full, "receipts.json"))) {
    const msg = `缺回执：${dir}/receipts.json（诊断跳过）`;
    if (argv.includes("--require")) { console.error(msg); return 1; }
    console.log(msg);
    return 0;
  }
  const { receipts, marks } = loadRun(full);
  const a = audit(receipts, marks);
  const md = argv.includes("--md");

  if (md) {
    const lines = [
      `## 回执契约审计（${dir}）`,
      "",
      `- 合规：${a.compliant}/${a.n}（${(a.rate * 100).toFixed(1)}%）`,
      `- 首行命名失败 ${a.namedFail.length} · 第二行无可执行细节 ${a.detailFail.length} · 头两行空白话 ${a.politeFail.length}`,
      "",
      "不合规明细（最多 20 条）：",
      "",
      "| 题号 | 判定 | 第二行（截断） |",
      "| --- | --- | --- |",
      ...a.violators.slice(0, 20).map((r) => `| ${r.id} | ${r.disposition} | ${r.second.replace(/\|/g, "\\|") || "（缺第二行）"} |`),
    ];
    console.log(lines.join("\n"));
  } else {
    console.log(`回执契约审计 —— ${dir}`);
    console.log(`  合规 ${a.compliant}/${a.n}（${(a.rate * 100).toFixed(1)}%）`);
    console.log(`  首行命名失败 ${a.namedFail.length} · 第二行无可执行细节 ${a.detailFail.length} · 头两行空白话 ${a.politeFail.length}`);
    for (const r of a.violators.slice(0, 12)) {
      console.log(`  ${r.id} [${r.disposition}] ${r.second || "（缺第二行）"}`);
    }
    if (a.violators.length > 12) console.log(`  …另有 ${a.violators.length - 12} 条`);
  }
  if (min > 0 && a.rate < min) { console.error(`低于闸门 ${(min * 100).toFixed(0)}%：实得 ${(a.rate * 100).toFixed(1)}%`); return 2; }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
