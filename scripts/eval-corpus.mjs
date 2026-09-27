#!/usr/bin/env node
// 离线评测闭环（P0）· scripts/eval-corpus.mjs
//
// 解决什么问题：在此之前，改词表 / 改领域判定 / 改判决口径，没有任何东西能回答
// 「这次是变好还是变坏」—— 110 条语料里的 expected_domain / expected_verdict 标签
// 从来没被离线消费过（verify_prompt 只查字段在不在，run_bank_live 要 API Key）。
//
// 现在：把标签接进计量，输出混淆矩阵 + 每类 P/R/F1 + 误判样本 + 覆盖缺口，
// 并用 tests/eval-baseline.json 做回归门禁（P/R/F1 回退超过容差即失败）。
//
// 用法：
//   node scripts/eval-corpus.mjs                     # 人读报告
//   node scripts/eval-corpus.mjs --json              # 机读快照（只输出 JSON）
//   node scripts/eval-corpus.mjs --gate              # 门禁：语料坏行 + 与基线比回退
//   node scripts/eval-corpus.mjs --write-baseline    # 写入/更新基线
//   node scripts/eval-corpus.mjs --top 12            # 多列几条误判样本
//
// 退出码：0 正常 · 1 语料有坏行/参数错 · 3 相对基线有回退

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, DOMAIN_MARKERS, rankDomains } from "../data/scenarios.mjs";
import { scoreResponse } from "./lib/scorer.mjs";
import {
  CORPUS_VERSION,
  WANTED_LANGUAGES,
  confusion,
  coverage,
  diffSnapshot,
  domainPairs,
  formatConfusion,
  formatPrf,
  loadCorpus,
  loadRuns,
  percent,
  prf,
  runDomainPairs,
  verdictPairs,
} from "./lib/corpus.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEVELS = ["minimal", "short", "medium"];

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const flagValue = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 20).join("\n").replace(/^\/\/ ?/gm, ""));
  process.exit(0);
}

const corpusDir = flagValue("--dir", join(ROOT, "tests"));
const runsDir = flagValue("--runs", join(corpusDir, "runs"));
const baselinePath = flagValue("--baseline", join(corpusDir, "eval-baseline.json"));
const topN = Number(flagValue("--top", "8"));
const wantJson = hasFlag("--json");
const wantGate = hasFlag("--gate");
const writeBaseline = hasFlag("--write-baseline");
const epsilon = Number(flagValue("--epsilon", "0.005"));
if (!Number.isFinite(topN) || topN < 0) {
  console.error("ERROR: --top 需要非负整数");
  process.exit(1);
}

// ---- 载入 ----------------------------------------------------------------

const corpus = loadCorpus(corpusDir);
if (corpus.error) {
  console.error(`ERROR: 读不到用例目录 ${corpusDir}：${corpus.error}`);
  process.exit(1);
}
const domainIds = SCENARIOS.map((s) => s.id);
const predict = (text) => rankDomains(text, DOMAIN_MARKERS, 4).map((r) => r.id);

const { pairs: dPairs, wildcard, unlabeled, invalid } = domainPairs(corpus.cases, predict);
const dConf = confusion(dPairs);
const dPrf = prf(dPairs);
const top1 = dPrf.accuracy;
const top3 = dPairs.length === 0 ? null : dPairs.filter((p) => p.predict && p.ranked.slice(0, 3).includes(p.expect)).length / dPairs.length;
const misses = dPairs.filter((p) => p.predict !== p.expect);
const cov = coverage(corpus.cases, { domains: domainIds, languages: WANTED_LANGUAGES, levels: LEVELS });

const runs = loadRuns(runsDir);
const { pairs: vPairs, skipped: vSkipped } = verdictPairs(runs.rows);
const vConf = confusion(vPairs);
const vPrf = prf(vPairs);
const { pairs: rPairs, skipped: rSkipped } = runDomainPairs(runs.rows);
const rPrf = prf(rPairs);

// ---- 快照 ----------------------------------------------------------------

const perLabel = (result) =>
  Object.fromEntries(
    result.rows
      .filter((r) => r.support > 0 || r.tp + r.fp > 0)
      .map((r) => [r.label, { precision: r.precision, recall: r.recall, f1: r.f1, support: r.support, tp: r.tp, fp: r.fp, fn: r.fn }]),
  );

const snapshot = {
  version: CORPUS_VERSION,
  createdAt: new Date().toISOString(),
  note: "无限五代离线评测基线 · node scripts/eval-corpus.mjs --write-baseline 可刷新；--gate 用本文件做回归门禁",
  corpus: {
    cases: corpus.cases.length,
    files: corpus.files.length,
    labeledDomain: cov.labeledDomain,
    labeledVerdict: cov.labeledVerdict,
    wildcard: cov.wildcard,
    missingPrompt: cov.missingPrompt,
    duplicates: corpus.duplicates.length,
  },
  domain: {
    evaluated: dPairs.length,
    top1: top1,
    top3: top3,
    macro: dPrf.macro,
    micro: dPrf.micro,
    perLabel: perLabel(dPrf),
  },
  verdict: {
    evaluated: vPairs.length,
    accuracy: vPrf.accuracy,
    macro: vPrf.macro,
    micro: vPrf.micro,
    perLabel: perLabel(vPrf),
  },
  runDomain: {
    evaluated: rPairs.length,
    accuracy: rPrf.accuracy,
    macro: rPrf.macro,
    perLabel: perLabel(rPrf),
  },
};

if (writeBaseline) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`基线已写入 ${baselinePath}`);
  if (!wantGate) process.exit(0);
}

if (wantJson) {
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  const line = (s = "") => console.log(s);
  line("═══ 无限五代 · 离线评测闭环 ═══");
  line(`用例目录 ${corpusDir}`);
  line("");
  line(`1 · 语料体检（${corpus.files.length} 份文件 / ${corpus.cases.length} 条用例）`);
  for (const f of corpus.files) {
    line(`  ${String(f.file).padEnd(30)} 用例 ${String(f.rows).padStart(3)}  注释 ${String(f.comments).padStart(2)}  坏行 ${String(f.bad).padStart(2)}  ${f.bytes} B`);
  }
  line(`  带领域标签 ${cov.labeledDomain} 条 · 带判决标签 ${cov.labeledVerdict} 条 · 泛化（不判对错）${cov.wildcard} 条`);
  line(`  缺 prompt ${cov.missingPrompt} 条 · 重复 case_id ${corpus.duplicates.length} 条 · 坏行 ${corpus.bad.length} 条 · 无标签 ${unlabeled.length} 条`);
  for (const b of corpus.bad.slice(0, 5)) line(`    ✗ ${b.source}:${b.line} ${b.reason}`);
  line("");
  line(`2 · 领域判定（离线，对提问原文；与状态条/评分器共用 rankDomains）`);
  line(`  评测 ${dPairs.length} 条 · Top-1 ${percent(top1)} · Top-3 ${percent(top3)}`);
  line(`  宏平均 P ${percent(dPrf.macro.precision)} / R ${percent(dPrf.macro.recall)} / F1 ${percent(dPrf.macro.f1)}（${dPrf.macro.labels} 个标签）`);
  line(`  微平均 P ${percent(dPrf.micro.precision)} / R ${percent(dPrf.micro.recall)} / F1 ${percent(dPrf.micro.f1)}`);
  line("");
  line(formatPrf(dPrf));
  line("");
  line("  混淆矩阵（行=期望，列=预测）");
  line(formatConfusion(dConf));
  line("");
  line(`3 · 误判样本（${misses.length} 条，列前 ${Math.min(topN, misses.length)} 条）`);
  for (const m of misses.slice(0, topN)) {
    const cand = m.ranked.length > 0 ? m.ranked.slice(0, 3).join(" > ") : "无命中";
    line(`  [${m.expect}] ${m.id}（${m.source}${m.language ? ` · ${m.language}` : ""}）`);
    line(`      预测 ${m.predict ?? "无"} · 候选 ${cand}`);
    line(`      提问 ${m.prompt.replace(/\s+/g, " ").slice(0, 90)}`);
  }
  if (misses.length === 0) line("  （没有误判）");
  line("");
  line(`4 · 已录回包评分（${runs.rows.length} 条 · 目录 ${runsDir}）`);
  if (runs.rows.length === 0) {
    line("  未跑过在线用例：跑 `node scripts/run_bank_live.mjs`（需 DEEPSEEK_API_KEY）后本段自动评分。");
    line("  离线可评的部分仍在上方（领域判定 / 覆盖 / 语料体检）。");
  } else {
    line(`  判决评测 ${vPairs.length} 条 · 准确率 ${percent(vPrf.accuracy)}（blocked 已按语义映射为 refusal）`);
    line(formatPrf(vPrf));
    line("");
    line("  判决混淆矩阵（行=期望，列=观测）");
    line(formatConfusion(vConf));
    if (rSkipped.length + rPairs.length > 0) {
      line("");
      line(`  回包领域评测 ${rPairs.length} 条 · 准确率 ${percent(rPrf.accuracy)} · 跳过 ${rSkipped.length} 条`);
    }
  }
  if (vSkipped.length > 0 && runs.rows.length > 0) line(`  （跳过 ${vSkipped.length} 条：${vSkipped[0].skip} 等）`);
  line("");
  line("5 · 覆盖缺口");
  line(`  领域：${domainIds.length} 个里 ${cov.domainGaps.length} 个零用例${cov.domainGaps.length > 0 ? ` — ${cov.domainGaps.slice(0, 14).join(" ")}${cov.domainGaps.length > 14 ? " …" : ""}` : ""}`);
  line(`  语言：${WANTED_LANGUAGES.length} 种里 ${cov.languageGaps.length} 种零用例 — 缺 ${cov.languageGaps.join(" ")}`);
  line(`  难度：${LEVELS.length} 档里 ${cov.levelGaps.length} 档零用例${cov.levelGaps.length > 0 ? ` — ${cov.levelGaps.join(" ")}` : ""}`);
  if (cov.unknownDomains.length > 0) line(`  ⚠ 语料里出现了不属于 56 域的标签：${cov.unknownDomains.join(" ")}`);
  const domSpread = Object.entries(cov.byDomain);
  line(`  现有标签分布（${domSpread.length} 个域）：${domSpread.map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  line("");
  line(`6 · 基线（${baselinePath}）`);
  let baseline = null;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    baseline = null;
  }
  if (!baseline) {
    line("  尚未建立基线：跑 `node scripts/eval-corpus.mjs --write-baseline` 固化当前水平。");
  } else {
    const diff = diffSnapshot(baseline, snapshot, epsilon);
    line(`  相对基线（容差 ${percent(epsilon)}）：回退 ${diff.regressions.length} 项 · 提升 ${diff.improvements.length} 项 · 新增指标 ${diff.added.length} 项`);
    for (const r of diff.regressions.slice(0, 8)) line(`    ✗ ${r.key} ${percent(r.from)} → ${percent(r.to)}（${percent(r.delta)}）`);
    for (const r of diff.improvements.slice(0, 5)) line(`    ✓ ${r.key} ${percent(r.from)} → ${percent(r.to)}（+${percent(r.delta)}）`);
  }
}

// ---- 门禁 ----------------------------------------------------------------

if (wantGate) {
  let code = 0;
  if (corpus.bad.length > 0) {
    console.error(`\n门禁失败：语料有 ${corpus.bad.length} 行坏 JSON（修掉或确认是注释行）。`);
    code = 1;
  }
  if (cov.missingPrompt > 0) {
    console.error(`门禁失败：${cov.missingPrompt} 条用例缺 prompt。`);
    code = 1;
  }
  let baseline = null;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    baseline = null;
  }
  if (!baseline) {
    console.error(`警告：没有基线文件 ${baselinePath}，本次跳过回归比对（先 --write-baseline）。`);
  } else {
    const diff = diffSnapshot(baseline, snapshot, epsilon);
    if (diff.regressions.length > 0) {
      console.error(`门禁失败：相对基线有 ${diff.regressions.length} 项回退（容差 ${percent(epsilon)}）：`);
      for (const r of diff.regressions) console.error(`  ✗ ${r.key} ${percent(r.from)} → ${percent(r.to)}`);
      code = 3;
    }
  }
  process.exit(code);
}
