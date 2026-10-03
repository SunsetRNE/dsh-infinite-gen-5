// 授权许可件的判据跑：14 条 fixture 逐条判决，正例必须 permitted、反例必须命中指定 code。
// 判据固定：正例放行、反例驳回，且反例不得用「许可不足」以外的理由蒙混（code 必须逐条对上）。
import { readFileSync } from "node:fs";
import { permitGate, PERMIT_KINDS, MAX_GRANT_DAYS } from "../data/permit.mjs";

const fixtures = JSON.parse(readFileSync(new URL("../tests/permit-fixtures.json", import.meta.url), "utf8"));
const rows = fixtures.map((f) => {
  const r = permitGate(f.grant, f.request);
  const got = r.ok ? "permitted" : r.code;
  return { id: f.id, expect: f.expect, got, ok: got === f.expect, reason: r.reason, alt: r.alternative ?? "-" };
});
const pass = rows.filter((r) => r.ok);
const fail = rows.filter((r) => !r.ok);

console.log(JSON.stringify({
  fixtureCount: rows.length,
  permitKinds: Object.keys(PERMIT_KINDS),
  maxGrantDays: MAX_GRANT_DAYS,
  allowed: rows.filter((r) => r.got === "permitted").map((r) => r.id),
  denied: rows.filter((r) => r.got !== "permitted").map((r) => `${r.id}→${r.got}`),
  mismatch: fail.map((r) => `${r.id}: 期望 ${r.expect} 实得 ${r.got}`),
}, null, 2));
console.log(`\n授权许可件： 通过 ${pass.length} · 失败 ${fail.length}`);
for (const r of rows) console.log(`  ${r.ok ? "✅" : "❌"} ${r.id.padEnd(30)} ${r.got.padEnd(20)} ${r.reason.slice(0, 56)}`);
process.exit(fail.length ? 1 : 0);
