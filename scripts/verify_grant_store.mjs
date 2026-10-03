#!/usr/bin/env node
// 授权凭据档自检（只读 + 临时目录，不碰 ~/.dsh）
//   node scripts/verify_grant_store.mjs
// 判据：入档前校验（指纹格式 / 日期顺序 / 窗口上限）· 复核五态（ok / not-yet / expired / fingerprint-mismatch / file-missing）·
//       挑选用途优先与到期最晚 · 挑出来的那份能通过 credentialPermit 判决 · 篡改后不再可用。

import { mkdtempSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStore, saveStore, addGrant, verifyStore, pickGrant, sha256File } from "../data/grant-store.mjs";
import { MAX_GRANT_DAYS } from "../data/credential-permit.mjs";

const results = [];
const ok = (claim, cond, detail = "") => results.push({ ok: !!cond, claim, detail: String(detail) });

const dir = mkdtempSync(join(tmpdir(), "grants-"));
const fa = join(dir, "A.txt"), fb = join(dir, "B.txt");
writeFileSync(fa, "客户A书面授权：允许 2026Q4 使用自有主体信息。\n", "utf8");
writeFileSync(fb, "客户B书面授权：允许 2026-11 起使用自有主体信息。\n", "utf8");

let store = { version: 1, grants: [] };
const addA = addGrant(store, { id: "a", grantor: "CUSTOMER_A", purpose: "客户验收", issuedAt: "2026-10-01", until: "2026-12-31", file: fa });
ok("入档：自动取指纹成功", addA.ok === true && /^[0-9a-f]{64}$/.test(addA.grant.sha256), addA.grant ? addA.grant.sha256.slice(0, 12) + "…" : addA.error);
store = addA.store;
const addB = addGrant(store, { id: "b", grantor: "CUSTOMER_B", purpose: "月度巡检", issuedAt: "2026-11-01", until: "2026-12-31", file: fb });
store = addB.store;

ok("入档：到期日早于签发日 → 拒", addGrant(store, { grantor: "X", issuedAt: "2026-12-31", until: "2026-01-01", sha256: "a".repeat(64) }).ok === false);
ok(`入档：窗口 > ${MAX_GRANT_DAYS} 天 → 拒`, addGrant(store, { grantor: "X", issuedAt: "2026-01-01", until: "2100-01-01", sha256: "a".repeat(64) }).ok === false);
ok("入档：缺指纹且文件不存在 → 拒", addGrant(store, { grantor: "X", issuedAt: "2026-01-01", until: "2026-06-01" }).ok === false);
ok("入档：日期格式不对 → 拒", addGrant(store, { grantor: "X", issuedAt: "01/02/2026", until: "2026-06-01", sha256: "a".repeat(64) }).ok === false);

const now = new Date("2026-10-15T00:00:00Z");
const v1 = verifyStore(store, { now });
ok("复核：A 当前可用（ok）", v1.rows.find((r) => r.id === "a").status === "ok");
ok("复核：B 尚未生效（not-yet）", v1.rows.find((r) => r.id === "b").status === "not-yet");
ok("复核：可用清单只含 A", v1.active.length === 1 && v1.active[0].id === "a");

const v2 = verifyStore(store, { now: new Date("2027-01-05T00:00:00Z") });
ok("复核：跨过到期日后全部 expired", v2.rows.every((r) => r.status === "expired"));

const picked = pickGrant(store, { purpose: "客户验收", now });
ok("挑选：按用途命中 A 且判决放行", picked.ok === true && picked.grant.id === "a" && picked.verdict.allow === true, picked.verdict && picked.verdict.reason);
const noMatch = pickGrant(store, { purpose: "不存在的用途", now });
ok("挑选：用途不命中时回落到可用的一份（仍放行）", noMatch.ok === true, noMatch.grant && noMatch.grant.id);
const noneActive = pickGrant(store, { now: new Date("2027-06-01T00:00:00Z") });
ok("挑选：全都不可用时明确失败", noneActive.ok === false && /没有当前可用的授权/.test(noneActive.error));

appendFileSync(fa, "（被改过一行）\n");
const v3 = verifyStore(store, { now });
ok("复核：A 的文件被改动 → fingerprint-mismatch", v3.rows.find((r) => r.id === "a").status === "fingerprint-mismatch");
ok("复核：篡改后 A 不再进入可用清单", v3.active.every((r) => r.id !== "a"));
const pickAfter = pickGrant(store, { purpose: "客户验收", now });
ok("挑选：篡改后即使用途命中也不放行（回落到 B 或失败）", pickAfter.grant === undefined || pickAfter.grant.id !== "a");

const missing = verifyStore({ version: 1, grants: [{ ...addA.grant, id: "gone", file: join(dir, "nope.txt") }] }, { now });
ok("复核：文件不在 → file-missing", missing.rows[0].status === "file-missing");
ok("落盘与读取往返一致", (() => { const p = join(dir, "s.json"); saveStore(store, p); return existsSync(p) && loadStore(p).grants.length === store.grants.length; })());
ok("sha256File 与入档时一致", sha256File(fb) === addB.grant.sha256);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.claim}${r.detail ? " — " + r.detail : ""}`);
console.log(`\n授权凭据档自检： ${results.length - failed.length} 通过 / ${failed.length} 失败（共 ${results.length} 项）`);
process.exit(failed.length ? 1 : 0);
