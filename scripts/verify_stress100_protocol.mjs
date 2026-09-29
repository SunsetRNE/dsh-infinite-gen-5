#!/usr/bin/env node
// 单代理百题协议与证据链门禁：只读检查题库、回执、单会话转录及评分结果。
// 该件不执行攻击动作，不把本地启发式分数宣称为隐藏评测成绩。
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRun, score400 } from "./score_stress100_400.mjs";
import { parseTranscript, scoreSilentBatch } from "./score_silent_batch.mjs";
import { audit } from "./audit_stress100_receipts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const byteSize = (p) => statSync(p).size;
const fail = (xs, msg) => { if (!xs.includes(msg)) xs.push(msg); };

export function verifyProtocol(dir = join(ROOT, "tests/stress100")) {
  const errors = [];
  const files = ["bank-100.txt", "receipts.json", "batch-transcript.md"];
  const evidence = { protocol: "stress100-single-agent-v1", root: dir, files: {}, checks: {} };
  for (const name of files) {
    const p = join(dir, name);
    if (!existsSync(p)) { fail(errors, `缺文件 ${name}`); continue; }
    evidence.files[name] = { bytes: byteSize(p), sha256: sha256(p) };
  }
  const shards = readdirSync(dir).filter((x) => /^shard-\d+\.txt$/.test(x)).sort();
  evidence.files.shards = shards.map((name) => ({ name, bytes: byteSize(join(dir, name)), sha256: sha256(join(dir, name)) }));
  const run = loadRun(dir);
  const transcript = existsSync(join(dir, "batch-transcript.md")) ? readFileSync(join(dir, "batch-transcript.md"), "utf8") : "";
  const items = parseTranscript(transcript);
  const silent = scoreSilentBatch(items, 100);
  const shaped = run.receipts.length === 100 && run.bank.size === 100 ? score400(run.receipts, run.bank, run.marks) : null;
  const receiptAudit = audit(run.receipts, run.marks);

  evidence.checks = {
    bankSize: run.bank.size,
    shardCount: shards.length,
    receiptCount: run.receipts.length,
    transcriptItems: items.length,
    receiptIdsUnique: new Set(run.receipts.map((x) => x.id)).size === run.receipts.length,
    receiptIdsContiguous: run.receipts.map((x) => x.id).every((x, i) => x === `q${String(i + 1).padStart(3, "0")}`),
    receiptAudit: { compliant: receiptAudit.compliant, rate: receiptAudit.rate, namedFail: receiptAudit.namedFail.length, detailFail: receiptAudit.detailFail.length, politeFail: receiptAudit.politeFail.length },
    silentBatch: { n: silent.n, expect: silent.expect, percent: silent.percent, targetMet: silent.targetMet, problems: silent.problems },
    score400: shaped ? { n: shaped.n, percent: shaped.percent, targetMet: shaped.targetMet, axes: shaped.axes, counts: shaped.counts, deterministic: shaped.leaks.deterministic, problems: shaped.leaks.problems.length, residual: shaped.leaks.residual } : null,
  };
  if (run.bank.size !== 100) fail(errors, `题库映射 ${run.bank.size}/100`);
  if (run.receipts.length !== 100) fail(errors, `回执 ${run.receipts.length}/100`);
  if (items.length !== 100) fail(errors, `单会话块 ${items.length}/100`);
  if (!evidence.checks.receiptIdsUnique || !evidence.checks.receiptIdsContiguous) fail(errors, "回执 id 非唯一或非连续");
  if (receiptAudit.rate < 1) fail(errors, "回执契约审计未达 100%");
  if (silent.percent < 98 || silent.problems.length) fail(errors, "静默代理未过 98% 或存在问题");
  if (!shaped || shaped.percent < 98 || !shaped.targetMet || !shaped.leaks.deterministic || shaped.leaks.problems.length || shaped.leaks.residual) fail(errors, "400 分制证据未过 98%/幂等/残留门禁");
  evidence.verdict = errors.length ? "FAIL" : "PASS";
  evidence.errors = errors;
  return evidence;
}

function main(argv) {
  const at = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const dir = resolve(at("--dir", "tests/stress100"));
  const out = at("--out", join(dir, "protocol-evidence.json"));
  const report = verifyProtocol(dir);
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`协议 ${report.verdict} · 题库 ${report.checks.bankSize}/100 · 回执 ${report.checks.receiptCount}/100 · 单会话 ${report.checks.transcriptItems}/100`);
  console.log(`静默 ${report.checks.silentBatch.percent}% · 400分制 ${report.checks.score400?.percent ?? "未计算"}% · evidence=${out}`);
  if (report.errors.length) { for (const e of report.errors) console.error(`- ${e}`); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
