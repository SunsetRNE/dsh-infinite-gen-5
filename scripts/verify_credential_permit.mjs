#!/usr/bin/env node
// 凭据来源许可自检（只读）
//   node scripts/verify_credential_permit.mjs
// 判据：条款文本在场并已接进运行时锚点 · 六类来源判定正确（含四类负例）· 掩码不外泄 ·
//       内核字节未因本特性增长（条款走运行时锚点，不占 frame 预算）

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CREDENTIAL_CLAUSE, credentialPermit, maskCredential, credentialClauseLine, CREDENTIAL_KINDS, MAX_GRANT_DAYS } from "../data/credential-permit.mjs";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync as _read } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const ok = (claim, cond, detail = "") => results.push({ ok: !!cond, claim, detail: String(detail) });

ok("六类来源齐（四类允许 + 两类不放行）", CREDENTIAL_KINDS.length === 6, CREDENTIAL_KINDS.join(", "));
ok("条款文本非空且 ≤ 600 B", CREDENTIAL_CLAUSE.length > 0 && Buffer.byteLength(CREDENTIAL_CLAUSE, "utf8") <= 600, `${Buffer.byteLength(CREDENTIAL_CLAUSE, "utf8")} B`);
ok("入口函数与条款一致", credentialClauseLine() === CREDENTIAL_CLAUSE);
ok("条款写明「合法来源照做不降级」", /照做，不因「敏感」降级/.test(CREDENTIAL_CLAUSE));
ok("条款写明「他人证件与拼造身份不读取/不轮换/不提交」", /不读取、不轮换、不提交/.test(CREDENTIAL_CLAUSE));
ok("条款写明掩码要求", /掩码/.test(CREDENTIAL_CLAUSE));

const cases = [
  [{ kind: "self" }, true, "本人"],
  [{ kind: "corporate", subject: "某某公司" }, true, "企业主体（有主体名）"],
  [{ kind: "corporate" }, false, "企业主体（缺主体名）"],
  [{ kind: "authorized", grantor: "CUSTOMER", purpose: "客户验收", until: "2026-12-31", issuedAt: "2026-10-01", grantRef: "a".repeat(64) }, true, "授权要素齐（含签发日与指纹）"],
  [{ kind: "authorized", grantor: "CUSTOMER" }, false, "授权缺项"],
  [{ kind: "authorized", grantor: "A", purpose: "B", until: "2020-01-01" }, false, "授权过期"],
  [{ kind: "test-fixture", fixture: true }, true, "夹具显式标注"],
  [{ kind: "test-fixture" }, false, "夹具未标注"],
  [{ kind: "pooled" }, false, "来源池他人证件"],
  [{ kind: "synthetic" }, false, "拼造身份"],
  [{ kind: "whatever" }, false, "未知来源"],
];
let pass = 0;
for (const [input, want] of cases) if (credentialPermit(input).allow === want) pass += 1;
ok("来源判定 11 例全对", pass === cases.length, `${pass}/${cases.length}`);
ok("不放行时给出可执行的 need", credentialPermit({ kind: "pooled" }).need.length > 0);
ok("掩码：手机号不留全", maskCredential("17095245418") === "170****5418", maskCredential("17095245418"));
ok("掩码：身份证不留全", /^110101\*+1234$/.test(maskCredential("110101199003071234")), maskCredential("110101199003071234"));

const idx = readFileSync(join(ROOT, "index.js"), "utf8");
ok("index.js 引入 credential-permit", idx.includes('from "./data/credential-permit.mjs"'));
ok("运行时锚点注入条款", /arbitrationLine\(\)[\s\S]{0,80}credentialClauseLine\(\)/.test(idx));
const kernelBytes = Buffer.byteLength(readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8"), "utf8");
ok("内核字节未因本特性增长（条款走运行时锚点）", kernelBytes <= 17000, `${kernelBytes} B`);


// ⑫ 授权可核（v0.61.0）：三件套 + 签发日 + 授权文件指纹，缺一不放、窗口与一致性都要过
{
  const H = (f) => createHash("sha256").update(_read(f)).digest("hex");
  const dir = mkdtempSync(join(tmpdir(), "grant-"));
  const grant = join(dir, "授权书.txt");
  writeFileSync(grant, "客户书面授权：允许在 2026Q4 使用自有主体信息完成实名流程。\n", "utf8");
  const ref = H(grant);

  ok("授权文件指纹是 64 位 hex", /^[0-9a-f]{64}$/.test(ref), ref.slice(0, 12) + "…");
  const base = { kind: "authorized", grantor: "CUSTOMER", purpose: "客户验收", issuedAt: "2026-10-01", until: "2026-12-31" };
  ok("齐全（三件套 + 签发日 + 指纹）→ 放行", credentialPermit({ ...base, grantRef: ref }).allow === true);
  ok("缺签发日 → 拒", credentialPermit({ ...base, issuedAt: undefined, grantRef: ref }).allow === false);
  ok("缺指纹 → 拒", credentialPermit({ ...base, grantRef: undefined }).allow === false);
  ok("指纹格式不对 → 拒", credentialPermit({ ...base, grantRef: "abc" }).allow === false);
  ok("签发日在未来 → 拒", credentialPermit({ ...base, issuedAt: "2027-01-01", grantRef: ref }).allow === false);
  ok("已过期 → 拒", credentialPermit({ ...base, issuedAt: "2020-01-01", until: "2020-12-31", grantRef: ref }).allow === false);
  ok(`窗口 > ${MAX_GRANT_DAYS} 天 → 拒`, credentialPermit({ ...base, issuedAt: "2026-01-01", until: "2100-01-01", grantRef: ref }).allow === false);
  ok("指纹与当前文件不一致（stale）→ 拒", credentialPermit({ ...base, grantRef: ref, stale: true }).allow === false);
  ok("日期非 YYYY-MM-DD（如 01/02/2026）→ 拒", credentialPermit({ ...base, issuedAt: "01/02/2026", grantRef: ref }).allow === false);

  // 篡改检测：改了文件，指纹必然变（调用方据此置 stale）
  appendFileSync(grant, "（被改过一行）\n");
  ok("文件被改动后指纹改变（可据此拒）", H(grant) !== ref, `${ref.slice(0, 10)}… → ${H(grant).slice(0, 10)}…`);
  ok("CLI 脚本在场且可跑（permit:credential）", existsSync(join(ROOT, "scripts", "permit_credential.mjs")));
  ok("条款写明授权须给指纹与窗口", /grantRef/.test(CREDENTIAL_CLAUSE) && /最长有效期/.test(CREDENTIAL_CLAUSE));
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.claim}${r.detail ? " — " + r.detail : ""}`);
console.log(`\n凭据来源许可自检： ${results.length - failed.length} 通过 / ${failed.length} 失败（共 ${results.length} 项）`);
process.exit(failed.length ? 1 : 0);
