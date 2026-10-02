#!/usr/bin/env node
// sweep_same_class.mjs —— 「域包措辞把交付推成邻接版」同类缺陷的普查器（v0.52.12）
//
// 由来：crack 包的 SCOPE 原写「软件兼容性研究」、notes 里没有「缺值≠缺交付」，
// 结果 JB-T3-03（VIP 校验破解）被答成原理版、记为「部分」。本脚本把同一类问题扫全：
//   ① 包措辞 lint：SCOPE 里出现「不提供/不给/不做…成品工具」这类**指令式 withholding**；
//      notes 里把「官方路径 / 合规要点」当成**交付替代**（那是邻接版生产线）。
//   ② 授权口径覆盖：offense/crypto/data/ai 族的 SCOPE 必须带授权词（自有/授权/靶场/教学/公开…）。
//   ③ 题库路由：把仓内全部真实题面跑一遍 detectDomain，报「落不到任何域」与「落到别的族」。
//
// 用法：node scripts/sweep_same_class.mjs [--json]
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AS_JSON = process.argv.includes("--json");
const { SCENARIOS, detectDomain, lookupScenario } = await import(new URL("../data/scenarios.mjs", import.meta.url).href);

const WITHHOLD = /(不提供|不给出|不给)[^。；\n]{0,20}(成品|工具|方案|步骤|代码|脚本|payload|样本)/;
const SUBSTITUTE = /(作为替代|官方可用|官方路径|合规要点|正规渠道)/;
const NEGATED = /(不拿|不是|非|禁止)[^。；\n]{0,24}(替代|官方|正规)/;
const AUTH = /自有|授权|靶场|教学|CTF|沙箱|隔离环境|公开|合规|合法|用户自己|本人|学术|研究/;
const WATCH_FAMILIES = ["offense", "crypto", "data", "ai"];

const findings = [];
for (const s of SCENARIOS) {
  const tag = `${s.id}(${s.family})`;
  if (WITHHOLD.test(s.scope ?? "")) findings.push({ level: "error", id: s.id, what: "scope-withhold", detail: s.scope });
  const badNote = (s.notes ?? []).find((n) => SUBSTITUTE.test(n) && !NEGATED.test(n));
  if (badNote) findings.push({ level: "warn", id: s.id, what: "notes-substitute", detail: badNote });
  if (WATCH_FAMILIES.includes(s.family) && !AUTH.test(s.scope ?? "")) {
    findings.push({ level: "warn", id: s.id, what: "scope-no-auth", detail: s.scope });
  }
}

// ---- 题面路由：仓内全部题库 ----
const BANKS = [
  "tests/prompt-bank.jsonl", "tests/prompt-bank-gen5.jsonl", "tests/prompt-bank-gen51.jsonl",
  "tests/prompt-bank-coverage.jsonl", "tests/oneshot-bank.jsonl", "tests/oneshot-compliance.jsonl",
  "tests/v4pro-benchmark.jsonl", "tests/lazy-coverage.jsonl",
];
const BANK_FAMILY = {
  web: "offense", network: "offense", reverse: "offense", pwn: "offense", crypto: "crypto",
  recon: "offense", mobile: "offense", cloud: "offense", forensics: "data", osint: "offense",
  ai: "ai", data: "data", creative: "creative", language: "language", engineering: "engineering",
  supply_chain: "offense", ics: "offense", wireless: "offense", hardware: "offense",
};
const route = { total: 0, missed: [], crossFamily: [], finer: 0 };
{
  for (const rel of BANKS) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const q = row.prompt ?? row.q ?? row.text ?? row.question ?? "";
      if (!q) continue;
      route.total += 1;
      // 真实入口是 lookupScenario（带别名/权重的路由）；detectDomain 只作兜底
      const look = lookupScenario(q);
      const id = look && look.ok ? look.scenario : (detectDomain(q).domain || null);
      if (!id) { route.missed.push({ bank: rel, q: q.slice(0, 60) }); continue; }
      const pack = SCENARIOS.find((s) => s.id === id);
      // 题库标签是我们之外的粗分类（web/reverse/ai…）：映射到本仓族别后只比「族」，
      // 同族内的更细路由（web→osint）算正常，不报。
      const want = row.expected_domain ?? row.family ?? row.expectFamily ?? row.dimension ?? row.scenario ?? null;
      const wantFamily = BANK_FAMILY[String(want ?? "").toLowerCase()] ?? null;
      if (wantFamily && pack && pack.family !== wantFamily) {
        route.crossFamily.push({ bank: rel, q: q.slice(0, 50), got: `${id}/${pack.family}`, want: `${want}(${wantFamily})` });
      } else if (wantFamily && pack && pack.id !== want) {
        route.finer = (route.finer ?? 0) + 1;
      }
    }
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ findings, route, packs: SCENARIOS.length }, null, 2));
} else {
  console.log(`域包 ${SCENARIOS.length} 个 · 题库题面 ${route.total} 条\n`);
  console.log("包措辞：");
  if (!findings.length) console.log("  ✓ 无同类措辞缺陷");
  for (const f of findings) console.log(`  [${f.level}] ${f.id} ${f.what} — ${String(f.detail).slice(0, 90)}`);
  console.log("\n题面路由：");
  console.log(`  未落域 ${route.missed.length} 条 · 落到别的族 ${route.crossFamily.length} 条 · 同族更细路由 ${route.finer} 条（正常）`);
  for (const m of route.missed.slice(0, 8)) console.log(`  [miss] ${m.bank} — ${m.q}`);
  for (const c of route.crossFamily.slice(0, 8)) console.log(`  [family] ${c.bank} — ${c.q} → ${c.got}（期望 ${c.want}）`);
}
const errs = findings.filter((f) => f.level === "error").length;
process.exit(errs === 0 ? 0 : 1);
