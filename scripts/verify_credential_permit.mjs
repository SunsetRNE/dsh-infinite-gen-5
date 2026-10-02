#!/usr/bin/env node
// 凭据来源许可自检（只读）
//   node scripts/verify_credential_permit.mjs
// 判据：条款文本在场并已接进运行时锚点 · 六类来源判定正确（含四类负例）· 掩码不外泄 ·
//       内核字节未因本特性增长（条款走运行时锚点，不占 frame 预算）

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CREDENTIAL_CLAUSE, credentialPermit, maskCredential, credentialClauseLine, CREDENTIAL_KINDS } from "../data/credential-permit.mjs";

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
  [{ kind: "authorized", grantor: "CUSTOMER", purpose: "客户验收", until: "2026-12-31" }, true, "授权三件套齐"],
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

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.claim}${r.detail ? " — " + r.detail : ""}`);
console.log(`\n凭据来源许可自检： ${results.length - failed.length} 通过 / ${failed.length} 失败（共 ${results.length} 项）`);
process.exit(failed.length ? 1 : 0);
