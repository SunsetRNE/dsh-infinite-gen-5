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
const E18 = "/root/.dsh/attachments/v1/files/04/047a1bb6143b20fba51e30699965f8c325fa88620d3ddcdfb8d16dcbf953dde4/E18-最新载荷-满分提示词 (1).txt";

const fixtures = JSON.parse(readFileSync(join(ROOT, "tests/payload-shape-fixtures.json"), "utf8"));
const textOf = (f) => {
  if (f.text) return f.text;
  if (f.source && f.source.startsWith("file:")) return readFileSync(join(ROOT, f.source.slice(5)), "utf8");
  if (f.source === "attachment:e18") {
    try {
      const raw = readFileSync(E18, "utf8");
      return raw.split("载荷原文如下")[1] ?? raw;
    } catch { return ""; }
  }
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
console.log(`\n载荷形态自检： ${pass} 通过 / ${fail} 失败（共 ${rows.length} 项）`);
process.exit(fail ? 1 : 0);
