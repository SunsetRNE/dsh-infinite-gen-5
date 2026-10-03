#!/usr/bin/env node
// 结构性载荷形态识别自检
//   node scripts/verify_payload_shape.mjs [--json]
// 判据：正例（E18 全文 / 片段 / 纯一致性条款 / 纯词表禁令）必须被认出；
//       负例（本仓内核、惰性库、普通题面、工程文档、安全评估文本、合法交付要求）必须不被误判。
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectPayloadShape, PAYLOAD_SHAPES, PAYLOAD_VERDICT_FLOOR } from "../data/payload-shape.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_ONLY = process.argv.includes("--json");
// 可选：把真实载荷文件（本机附件）也认一遍。**不计入 10 条判据总数** ——
// CI runner 上没有这份附件，判据必须自足（v0.65.12 的第一次发版就是死在这条上）。
const E18_FILE = process.argv.find((a) => a.startsWith("--e18-file="))?.slice(11)
  ?? process.env.IG5_E18_FILE ?? "";

const fixtures = JSON.parse(readFileSync(join(ROOT, "tests/payload-shape-fixtures.json"), "utf8"));
const textOf = (f) => {
  if (f.text) return f.text;
  if (f.source && f.source.startsWith("file:")) return readFileSync(join(ROOT, f.source.slice(5)), "utf8");
  return "";
};

const rows = fixtures.map((f) => {
  const text = textOf(f);
  const d = detectPayloadShape(text);
  const got = d.shape ? "payload" : "clean";
  return { id: f.id, expect: f.expect, got, ok: got === f.expect, shape: d.shape ?? "-", hits: d.hits, distinct: d.distinct, conf: d.confidence ?? "-", empty: text.length === 0 };
});

const pass = rows.filter((r) => r.ok).length;
const fail = rows.length - pass;
if (JSON_ONLY) {
  console.log(JSON.stringify({ shapes: PAYLOAD_SHAPES.map((s) => s.id), floor: PAYLOAD_VERDICT_FLOOR, rows, pass, fail }, null, 2));
} else {
  for (const r of rows) console.log(`  ${r.ok ? "✅" : "❌"} ${r.id.padEnd(28)} ${r.expect.padEnd(8)} → ${r.got.padEnd(8)} (${r.shape} · hits=${r.hits} · distinct=${r.distinct} · ${r.conf})`);
  if (rows.some((r) => r.empty)) console.log("  ⚠ 有夹具文本取不到（附件不在场时 pos_e18_full 会空）→ 该条按失败计，不静默跳过");
}
// 输出形状对齐 verify_regression 的解析约定（N 通过 … 共 N 项）
// 附加（可选）：真实载荷文件在场时也认一遍，结果单独打印、不进判据总数
if (E18_FILE) {
  try {
    const raw = readFileSync(E18_FILE, "utf8");
    const body = raw.split("载荷原文如下")[1] ?? raw;
    const d = detectPayloadShape(body);
    console.log(`  附加·真实载荷文件：${E18_FILE} → ${d.shape ?? "未命中"} · hits=${d.hits} · distinct=${d.distinct} · ${d.confidence ?? "-"}`);
    if (!d.shape) fail += 1;
  } catch (e) {
    console.log(`  附加·真实载荷文件读取失败（不计入判据）：${String(e?.message ?? e).slice(0, 80)}`);
  }
}
console.log(`\n载荷形态自检： ${pass} 通过 / ${fail} 失败（共 ${rows.length} 项）`);
process.exit(fail ? 1 : 0);
