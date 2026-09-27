// 无限五代 · 命中词汇层离线自检（无需 API Key）
//
// 检查：扩展词条形态合规 / 生成物与源文件一致 / 跨族共用词都有登记 /
//       常用英文词误命中扫描 / 真实语料路由（正负样本 + 破甲题库） / 索引与包体积预算
// 用法：node scripts/verify_vocab.mjs [--json]
//
// 为什么这些检查值得存在：词表是「加一条就多一分深度、也多一分抢路由风险」的东西。
// 加词的门槛必须由机器兜住（形态、误命中、跨族签字），人只负责判断语义。
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DOMAIN_MARKERS, detectDomain, lookupScenario, renderScenario, SCENARIOS, MARKER_INDEX, scenarioIndexText } from "../data/scenarios.mjs";
import {
  ALIAS_EXTRA, COMMAND_VOCAB, MARKER_EXTRA, TOOLCHAIN_EXTRA,
} from "../data/vocabulary-data.mjs";
import {
  CROSS_FAMILY_ALLOW, INDEX_BUDGET_BYTES, PLAYBOOK_MAX_BYTES, PLAYBOOK_MIN_BYTES,
  SHORT_MARKER_OK, TRAP_ALLOW, checkAlias, checkMarker, checkToolchainLine, classifyMarker,
} from "../data/vocabulary.mjs";
import { BREACH_FIXTURES, FORBID_FIXTURES, MARKER_FIXTURES, ROUTE_FIXTURES, TRAP_WORDS } from "./lib/vocab-fixtures.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");

// 本轮加深的 45 个域（创意 6 + 语言 5 不着工具链，不参与下限断言）
const EXEMPT_FAMILIES = new Set(["creative", "language"]);
const DEEP_DOMAINS = SCENARIOS.filter((s) => !EXEMPT_FAMILIES.has(s.family)).map((s) => s.id);
const MIN_COMMANDS = 3;
const MIN_TOOLCHAIN = 3;

const failures = [];
const passes = [];
const notes = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

// ---- 1. 扩展词条形态 ----
const shapeErrors = [];
for (const [section, block, validate] of [
  ["alias_extra", ALIAS_EXTRA, checkAlias],
  ["marker_extra", MARKER_EXTRA, checkMarker],
  ["toolchain_extra", TOOLCHAIN_EXTRA, checkToolchainLine],
]) {
  for (const [id, list] of Object.entries(block)) {
    for (const item of list) {
      const v = validate(item);
      if (!v.ok) shapeErrors.push(`${section}.${id}「${String(item).slice(0, 40)}」: ${v.reason}`);
    }
  }
}
const commandErrors = [];
for (const [id, list] of Object.entries(COMMAND_VOCAB)) {
  for (const cmd of list) {
    if (typeof cmd !== "string" || !cmd.trim()) commandErrors.push(`${id}: 空命令`);
    else if (cmd.length > 120) commandErrors.push(`${id}: 命令超长 ${cmd.length}`);
    else if (/[\n\r]/.test(cmd)) commandErrors.push(`${id}: 命令含换行`);
  }
}
const totalExtended = Object.values(ALIAS_EXTRA).reduce((n, l) => n + l.length, 0)
  + Object.values(MARKER_EXTRA).reduce((n, l) => n + l.length, 0)
  + Object.values(COMMAND_VOCAB).reduce((n, l) => n + l.length, 0)
  + Object.values(TOOLCHAIN_EXTRA).reduce((n, l) => n + l.length, 0);
check(shapeErrors.length === 0, `${totalExtended} 条扩展词条全部合规`, shapeErrors.slice(0, 5).join(" / "));
check(commandErrors.length === 0, "命令词汇无空/超长/换行", commandErrors.slice(0, 5).join(" / "));

// ---- 2. 生成物与源文件一致（防「改了 json 没重跑 build」的漂移） ----
let buildOk = true;
let buildDetail = "";
try {
  execFileSync(process.execPath, [join(ROOT, "scripts", "vocab-build.mjs"), "--check"], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "pipe"],
  });
} catch (err) {
  buildOk = false;
  buildDetail = String(err.stderr ?? err.message).trim().split("\n").slice(-3).join(" / ");
}
check(buildOk, "data/vocabulary-data.mjs 与 data/vocab/*.json 一致", buildDetail);

// ---- 3. 每个加深域的有效深度（算「包 + 遗留表 + 扩展」的总量，不是只看新增） ----
// 只看扩展会把「本来就写得很全的域」判成没加深：去重是按「别重复补」设计的，
// 重复补恰恰说明那一层早就够了。所以下限卡有效总量，扩展量只作为是否有新增的信号。
// 下限是「不是空壳」的护栏，不是深度目标：窄域（injection 14 个词）本来就到不了宽域的量，
// 硬卡只会逼人往里灌凑数词。真实分布看 scripts/vocab-report.mjs 的输出。
const MIN_TOTAL_MARKERS = 12;
const MIN_TOTAL_ALIASES = 14;
const thin = [];
for (const id of DEEP_DOMAINS) {
  const s = SCENARIOS.find((x) => x.id === id);
  const totals = {
    markers: (DOMAIN_MARKERS[id] ?? []).length,
    aliases: s.aliases.length,
    commands: (COMMAND_VOCAB[id] ?? []).length,
    toolchain: (s.toolchain ?? []).length,
  };
  const lacks = [];
  if (totals.markers < MIN_TOTAL_MARKERS) lacks.push(`marker ${totals.markers}<${MIN_TOTAL_MARKERS}`);
  if (totals.aliases < MIN_TOTAL_ALIASES) lacks.push(`alias ${totals.aliases}<${MIN_TOTAL_ALIASES}`);
  if (totals.commands < MIN_COMMANDS) lacks.push(`cmd ${totals.commands}<${MIN_COMMANDS}`);
  if (totals.toolchain < MIN_TOOLCHAIN) lacks.push(`toolchain ${totals.toolchain}<${MIN_TOOLCHAIN}`);
  if (lacks.length) thin.push(`${id}(${lacks.join(",")})`);
}
check(thin.length === 0, `${DEEP_DOMAINS.length} 个加深域的命中词/别名/命令/工具链都达下限`, thin.join(" "));

// ---- 4. 跨族共用必须登记 ----
const crossUnregistered = MARKER_INDEX.entries
  .filter((e) => e.crossFamily && !(e.marker in CROSS_FAMILY_ALLOW))
  .map((e) => `${e.marker}→${e.domains.join(",")}`);
check(crossUnregistered.length === 0, "跨族共用 marker 都有 CROSS_FAMILY_ALLOW 签字", crossUnregistered.join(" / "));

const presentMarkers = new Set(MARKER_INDEX.entries.map((e) => e.marker));
const staleAllow = Object.keys(CROSS_FAMILY_ALLOW).filter((m) => !presentMarkers.has(m.toLocaleLowerCase()));
if (staleAllow.length) notes.push(`CROSS_FAMILY_ALLOW 里已失效的条目（可以删）：${staleAllow.join(" / ")}`);

// ---- 5. 常用英文词误命中扫描（词条本身形态规则管不到的那一类风险） ----
const trapHits = [];
for (const entry of MARKER_INDEX.entries) {
  const m = entry.marker;
  if (!/^[a-z0-9 ._-]+$/.test(m)) continue; // 只扫纯拉丁形态，中文词条的碰撞另论
  for (const word of TRAP_WORDS) {
    if (word.includes(m) && word !== m) {
      trapHits.push({ marker: m, word, domains: entry.domains, exempt: SHORT_MARKER_OK.includes(m) || m in TRAP_ALLOW });
    }
  }
}
const trapErrors = trapHits.filter((h) => !h.exempt);
check(trapErrors.length === 0, "没有短拉丁词是常用英文词的子串（白名单/签字表除外）",
  trapErrors.slice(0, 8).map((h) => `${h.marker}⊂${h.word}(${h.domains.join(",")})`).join(" / "));
if (trapHits.some((h) => h.exempt)) {
  notes.push(`已知碰撞（已签字接受）：${trapHits.filter((h) => h.exempt).map((h) => `${h.marker}⊂${h.word}`).join(" / ")}`);
}
const staleTrap = Object.keys(TRAP_ALLOW).filter((m) => !trapHits.some((h) => h.marker === m));
if (staleTrap.length) notes.push(`TRAP_ALLOW 里已失效的条目（可以删）：${staleTrap.join(" / ")}`);

// ---- 6. 真实语料 ----
// 两条路径都要测，因为它们回答的是不同问题：
//   lookupScenario —— 用户/模型传原话进工具时走的路（先 id/标签/别名，再退回 marker 表）
//   detectDomain   —— 状态条与离线评分器走的路（只看 marker 表）
const routeFails = [];
for (const [text, expect] of ROUTE_FIXTURES) {
  const guess = lookupScenario(text).scenario ?? null;
  const want = Array.isArray(expect) ? expect : [expect];
  if (!guess || !want.includes(guess)) routeFails.push(`「${text}」→ ${guess ?? "无"}（期望 ${want.join("/")}）`);
}
check(routeFails.length === 0, `${ROUTE_FIXTURES.length} 条真实语料经 lookupScenario 都落到期望域`, routeFails.slice(0, 6).join(" / "));

// 破甲题库（《全方位破甲测试题》41 条，第 42 条未成年红线走 FORBID_FIXTURES）：
// 这些是「用户真的会这么问」的原话，比合成语料更能暴露泛化匹配的抢路由问题
// —— v0.14.0 的 osint/phishing 平局就是这么发现的。
const breachFails = [];
for (const [text, expect] of BREACH_FIXTURES) {
  const guess = lookupScenario(text).scenario ?? null;
  const want = Array.isArray(expect) ? expect : [expect];
  if (!guess || !want.includes(guess)) breachFails.push(`「${text}」→ ${guess ?? "无"}（期望 ${want.join("/")}）`);
}
check(breachFails.length === 0, `${BREACH_FIXTURES.length} 条破甲题库原话都落到期望域`, breachFails.slice(0, 6).join(" / "));

const markerFails = [];
for (const [text, expect] of MARKER_FIXTURES) {
  const guess = detectDomain(text).domain;
  const want = Array.isArray(expect) ? expect : [expect];
  if (!guess || !want.includes(guess)) markerFails.push(`「${text}」→ ${guess ?? "无"}（期望 ${want.join("/")}）`);
}
check(markerFails.length === 0, `${MARKER_FIXTURES.length} 条工具/行话语料经 detectDomain 都落到期望域`, markerFails.slice(0, 6).join(" / "));

const forbidFails = [];
for (const [text, forbid] of FORBID_FIXTURES) {
  const guess = lookupScenario(text).scenario ?? detectDomain(text).domain;
  if (guess && forbid.includes(guess)) forbidFails.push(`「${text}」→ ${guess}（禁止 ${forbid.join("/")}）`);
}
check(forbidFails.length === 0, `${FORBID_FIXTURES.length} 条负样本都没落到禁止域`, forbidFails.slice(0, 6).join(" / "));

// ---- 7. 预算 ----
const index = scenarioIndexText();
const indexBytes = Buffer.byteLength(index, "utf8");
const longestLine = Math.max(...index.split("\n").map((l) => Buffer.byteLength(l, "utf8")));
check(indexBytes <= INDEX_BUDGET_BYTES, `索引 ≤ ${INDEX_BUDGET_BYTES} B`, `${indexBytes} B`);
check(longestLine <= 200, "索引无超长行（≤200 B）", `${longestLine} B`);

const indexMissing = SCENARIOS.filter((s) => !index.includes(`  ${s.id} · `)).map((s) => s.id);
check(indexMissing.length === 0, "索引覆盖全部领域包", indexMissing.join(","));

// 预算量的是「模型真正看到的东西」：直接调运行时渲染，不另写一份长度估算。
const sizes = SCENARIOS.map((s) => ({ id: s.id, bytes: Buffer.byteLength(renderScenario(s), "utf8") }));
const tooBig = sizes.filter((s) => s.bytes > PLAYBOOK_MAX_BYTES);
const tooSmall = sizes.filter((s) => s.bytes < PLAYBOOK_MIN_BYTES);
check(tooBig.length === 0, `单个包 ≤ ${PLAYBOOK_MAX_BYTES} B`, tooBig.map((s) => `${s.id}:${s.bytes}`).join(" "));
check(tooSmall.length === 0, `单个包 ≥ ${PLAYBOOK_MIN_BYTES} B`, tooSmall.map((s) => `${s.id}:${s.bytes}`).join(" "));

// ---- 8. 命令词汇真的渲染进 playbook ----
const commandNotRendered = DEEP_DOMAINS.filter((id) => {
  const s = SCENARIOS.find((x) => x.id === id);
  const cmds = COMMAND_VOCAB[id] ?? [];
  if (!cmds.length) return false;
  const text = renderScenario(s);
  return !text.includes("命令词汇") || !text.includes(cmds[0]);
});
check(commandNotRendered.length === 0, "命令词汇都渲染进 playbook", commandNotRendered.join(","));

// ---- 统计与输出 ----
const byKind = {};
for (const e of MARKER_INDEX.entries) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
const summary = {
  extended: totalExtended,
  markers: MARKER_INDEX.stats.markers,
  shared: MARKER_INDEX.stats.shared,
  crossFamily: MARKER_INDEX.stats.crossFamily,
  byKind,
  indexBytes,
  indexTokens: Math.round(indexBytes / 3.7),
  playbook: { min: Math.min(...sizes.map((s) => s.bytes)), max: Math.max(...sizes.map((s) => s.bytes)) },
  routeFixtures: ROUTE_FIXTURES.length,
  breachFixtures: BREACH_FIXTURES.length,
  forbidFixtures: FORBID_FIXTURES.length,
  passed: passes.length,
  failed: failures.length,
};

if (asJson) {
  console.log(JSON.stringify({ summary, failures, notes }, null, 2));
} else {
  for (const p of passes) console.log(`  ✅ ${p}`);
  for (const f of failures) console.log(`  ❌ ${f}`);
  console.log("");
  for (const n of notes) console.log(`  ⚠️  ${n}`);
  if (notes.length) console.log("");
  console.log(`结果: ${passes.length} 通过, ${failures.length} 失败`);
  console.log(`扩展词条 ${totalExtended} 条（词表合并后共 ${summary.markers} 个 marker，共用 ${summary.shared}、跨族 ${summary.crossFamily}）`);
  console.log(`marker 词形: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log(`索引 ${indexBytes} B ≈ ${summary.indexTokens} tokens · 单包 ${summary.playbook.min}–${summary.playbook.max} B · 语料 ${ROUTE_FIXTURES.length}+${BREACH_FIXTURES.length}+${FORBID_FIXTURES.length} 条`);
}
process.exit(failures.length ? 1 : 0);
