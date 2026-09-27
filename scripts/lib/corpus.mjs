// 用例库（corpus）解析与评测计量 · 纯函数库
//
// 目标：把「改词表 / 改判定到底是变好还是变坏」从口头判断变成可复跑的数字。
//
// 设计原则：
//   1) 只读、零依赖、零副作用 —— 不联网、不调模型，全部可离线复跑；
//   2) 解析与计量分离：parse/normalize 负责把 4 份异构 jsonl 抹成同一形状，
//      prf/confusion/flattenMetrics 只吃配对数据 ⇒ 可以用合成数据单测；
//   3) 坏行是「要被发现」的对象，不是要被静默跳过的东西 —— bad 一律带行号返回。
//
// 语料的真实差异（勘察所得，评测语义就建在这些差异上）：
//   · prompt-bank.jsonl         32 条：expected_domain，无判决，level=minimal
//   · prompt-bank-gen5.jsonl    21 条：expected_domain + expected_verdict
//   · prompt-bank-gen51.jsonl   17 条：只有 expected_verdict（含 5 条 blocked），有 descr
//   · v4pro-benchmark.jsonl     40 条：字段名是 domain，前 9 行是 # 注释（不是坏行）

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scoreResponse } from "./scorer.mjs";

export const CORPUS_VERSION = 1;

// `#` 开头的行是文件头说明，空行是排版：两者都不算坏行，但分开计数以便体检。
export const COMMENT_PREFIX = "#";

// 泛化用例：标签不是 56 个领域中的任何一个（generic 表示「不指定领域」）。
// 判对判错都无意义 ⇒ 只统计条数，不进 P/R/F1。
export const WILDCARD_DOMAINS = Object.freeze(["generic"]);

// 期望判决 → 正确观测判决。blocked 指「真红线，模型本应拒绝」，
// 所以它对应的正确观测是 refusal（这正是「不许把红线也一起破掉」的评测抓手）。
export const VERDICT_EXPECTATION = Object.freeze({
  pass: "pass",
  refusal: "refusal",
  fallback: "fallback",
  blocked: "refusal",
});

// 领域标签在语料里可能写成 expected_domain（bank 系列）或 domain（v4pro 基准）。
export const DOMAIN_FIELDS = Object.freeze(["expected_domain", "domain"]);

// 期望覆盖的语言（真实语料目前只有 zh/en，缺口靠这份清单暴露）。
export const WANTED_LANGUAGES = Object.freeze(["zh", "en", "ja", "ko", "ru", "es", "ar", "zh-Hant"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

// ---- 解析 ----------------------------------------------------------------

/** 逐行解析 jsonl：注释、空行、坏行分开统计，坏行不打断解析。 */
export function parseJsonl(text, source = "<memory>") {
  const rows = [];
  const comments = [];
  const bad = [];
  let blanks = 0;
  let total = 0;
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    total += 1;
    const line = lines[i].trim();
    if (line === "") {
      blanks += 1;
      continue;
    }
    if (line.startsWith(COMMENT_PREFIX)) {
      comments.push({ line: i + 1, text: line });
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      bad.push({ line: i + 1, reason: String((err && err.message) || err), preview: line.slice(0, 120) });
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      bad.push({ line: i + 1, reason: "不是 JSON 对象", preview: line.slice(0, 120) });
      continue;
    }
    rows.push({ raw: parsed, line: i + 1 });
  }
  return { source, rows, comments, bad, blanks, total };
}

/** 把一条语料抹平成统一形状（不改原对象，raw 一并带上以便追查）。 */
export function normalizeCase(entry, meta = {}) {
  const raw = entry.raw || entry;
  const source = meta.source || entry.source || "<memory>";
  const line = entry.line ?? meta.line ?? 0;
  const pick = (...names) => {
    for (const name of names) {
      const v = nonEmptyString(raw[name]);
      if (v !== null) return v;
    }
    return null;
  };
  let domain = null;
  let domainField = null;
  for (const field of DOMAIN_FIELDS) {
    const v = nonEmptyString(raw[field]);
    if (v !== null) {
      domain = v;
      domainField = field;
      break;
    }
  }
  const verdict = nonEmptyString(raw.expected_verdict);
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const problems = [];
  if (prompt === "") problems.push("缺少非空 prompt");
  if (verdict !== null && VERDICT_EXPECTATION[verdict] === undefined) problems.push(`未知期望判决 ${verdict}`);
  return {
    case_id: pick("case_id") || `${source}#${line}`,
    source,
    line,
    domain,
    domainField,
    wildcard: domain !== null && WILDCARD_DOMAINS.includes(domain),
    verdict,
    expectedVerdict: verdict === null ? null : VERDICT_EXPECTATION[verdict] || null,
    language: pick("language"),
    level: pick("level"),
    scenario: pick("scenario"),
    descr: pick("descr"),
    promptChars: prompt.length,
    prompt,
    raw,
    problems,
  };
}

/** 读整个用例目录（*.jsonl，跳过子目录），返回统一形状的 cases + 体检信息。 */
export function loadCorpus(dir) {
  const out = { dir, files: [], cases: [], bad: [], duplicates: [], comments: 0, blanks: 0 };
  const seen = new Map();
  let entries = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  } catch (err) {
    out.error = String((err && err.message) || err);
    return out;
  }
  for (const file of entries) {
    const text = readFileSync(join(dir, file), "utf8");
    const parsed = parseJsonl(text, file);
    out.comments += parsed.comments.length;
    out.blanks += parsed.blanks;
    for (const b of parsed.bad) out.bad.push({ ...b, source: file });
    for (const entry of parsed.rows) {
      const c = normalizeCase(entry, { source: file });
      const where = `${file}#${c.line}`;
      if (seen.has(c.case_id)) out.duplicates.push({ case_id: c.case_id, first: seen.get(c.case_id), again: where });
      else seen.set(c.case_id, where);
      out.cases.push(c);
    }
    out.files.push({
      file,
      rows: parsed.rows.length,
      comments: parsed.comments.length,
      bad: parsed.bad.length,
      bytes: Buffer.byteLength(text, "utf8"),
    });
  }
  return out;
}

/** 读已录的在线跑（tests/runs/*.jsonl），用同一份 scorer 复评回包。 */
export function loadRuns(dir) {
  const out = { dir, files: [], rows: [] };
  let entries = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return out;
  }
  for (const file of entries) {
    const text = readFileSync(join(dir, file), "utf8");
    const parsed = parseJsonl(text, file);
    out.files.push({ file, rows: parsed.rows.length, bad: parsed.bad.length });
    for (const { raw, line } of parsed.rows) {
      const response = typeof raw.response === "string" ? raw.response : "";
      const failed = response.startsWith("[ERROR]");
      const scored = response && !failed ? scoreResponse(response) : null;
      out.rows.push({
        source: file,
        line,
        case_id: nonEmptyString(raw.case_id) || `${file}#${line}`,
        expectedDomain: nonEmptyString(raw.expected_domain) || nonEmptyString(raw.domain),
        expectedVerdict: nonEmptyString(raw.expected_verdict),
        error: failed ? response.slice(0, 200) : null,
        observedVerdict: scored ? scored.verdict : null,
        observedDomain: scored ? (scored.domainRanked?.[0]?.id ?? scored.domain ?? null) : null,
        responseChars: response.length,
      });
    }
  }
  return out;
}

// ---- 配对与计量 ----------------------------------------------------------

/**
 * 用预测函数给带领域标签的用例配对。
 * predict(text) 返回预测排名数组（Top-1 在首位）—— 运行时与离线共用同一份 rankDomains。
 */
export function domainPairs(cases, predict) {
  const pairs = [];
  const wildcard = [];
  const unlabeled = [];
  const invalid = [];
  for (const c of cases) {
    if (c.problems.length > 0) {
      invalid.push(c);
      continue;
    }
    if (c.domain === null) {
      unlabeled.push(c);
      continue;
    }
    if (c.wildcard) {
      wildcard.push(c);
      continue;
    }
    const ranked = predict(c.prompt) || [];
    pairs.push({
      id: c.case_id,
      source: c.source,
      language: c.language,
      expect: c.domain,
      predict: ranked.length > 0 ? ranked[0] : null,
      ranked,
      prompt: c.prompt,
    });
  }
  return { pairs, wildcard, unlabeled, invalid };
}

/** 用已录回包给判决配对（blocked 已按语义映射成 refusal）。 */
export function verdictPairs(rows) {
  const pairs = [];
  const skipped = [];
  for (const r of rows) {
    if (r.error) {
      skipped.push({ ...r, skip: "调用失败" });
      continue;
    }
    if (!r.observedVerdict) {
      skipped.push({ ...r, skip: "无回包" });
      continue;
    }
    if (!r.expectedVerdict) {
      skipped.push({ ...r, skip: "语料无期望判决" });
      continue;
    }
    const expect = VERDICT_EXPECTATION[r.expectedVerdict];
    if (!expect) {
      skipped.push({ ...r, skip: `未知期望判决 ${r.expectedVerdict}` });
      continue;
    }
    pairs.push({ id: r.case_id, source: r.source, expect, predict: r.observedVerdict, expectedRaw: r.expectedVerdict });
  }
  return { pairs, skipped };
}

/** 用已录回包给领域配对（评分器在整段回包上判定，比只看提问更接近真实）。 */
export function runDomainPairs(rows) {
  const pairs = [];
  const skipped = [];
  for (const r of rows) {
    if (r.error || !r.observedDomain) {
      skipped.push({ ...r, skip: r.error ? "调用失败" : "无回包/无领域" });
      continue;
    }
    if (!r.expectedDomain || WILDCARD_DOMAINS.includes(r.expectedDomain)) {
      skipped.push({ ...r, skip: r.expectedDomain ? "泛化用例" : "语料无期望领域" });
      continue;
    }
    pairs.push({ id: r.case_id, source: r.source, expect: r.expectedDomain, predict: r.observedDomain });
  }
  return { pairs, skipped };
}

/** 混淆矩阵（行=期望，列=预测）。 */
export function confusion(pairs) {
  const rowSet = new Set();
  const colSet = new Set();
  for (const p of pairs) {
    rowSet.add(p.expect ?? "(none)");
    colSet.add(p.predict ?? "(none)");
  }
  const rowLabels = [...rowSet].sort();
  const colLabels = [...colSet].sort();
  const matrix = {};
  for (const r of rowLabels) {
    matrix[r] = {};
    for (const c of colLabels) matrix[r][c] = 0;
  }
  for (const p of pairs) matrix[p.expect ?? "(none)"][p.predict ?? "(none)"] += 1;
  return { rowLabels, colLabels, matrix, total: pairs.length };
}

/**
 * 每类 P/R/F1 + 宏平均 + 微平均。
 * 约定：support=0（该标签从没出现在期望里）的行 recall/f1 为 null，且不进宏平均 ——
 * 否则「多加一个没用例的标签」会凭空拉低分数。
 */
export function prf(pairs, labels = null) {
  const observed = new Set();
  for (const p of pairs) {
    if (p.expect != null) observed.add(p.expect);
    if (p.predict != null) observed.add(p.predict);
  }
  const list = labels && labels.length > 0 ? [...labels] : [...observed].sort();
  const rows = [];
  let tpSum = 0;
  let fpSum = 0;
  let fnSum = 0;
  for (const label of list) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const p of pairs) {
      if (p.expect === label && p.predict === label) tp += 1;
      else if (p.expect !== label && p.predict === label) fp += 1;
      else if (p.expect === label && p.predict !== label) fn += 1;
    }
    const support = tp + fn;
    const precision = tp + fp > 0 ? tp / (tp + fp) : support > 0 ? 0 : null;
    const recall = support > 0 ? tp / support : null;
    const f1 = precision === null || recall === null ? null : precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    rows.push({ label, tp, fp, fn, support, precision, recall, f1 });
    tpSum += tp;
    fpSum += fp;
    fnSum += fn;
  }
  const macroRows = rows.filter((r) => r.support > 0);
  const mean = (pick) => (macroRows.length === 0 ? null : macroRows.reduce((a, r) => a + pick(r), 0) / macroRows.length);
  const microPrecision = tpSum + fpSum > 0 ? tpSum / (tpSum + fpSum) : null;
  const microRecall = tpSum + fnSum > 0 ? tpSum / (tpSum + fnSum) : null;
  const microF1 =
    microPrecision === null || microRecall === null
      ? null
      : microPrecision + microRecall > 0
        ? (2 * microPrecision * microRecall) / (microPrecision + microRecall)
        : 0;
  const correct = pairs.filter((p) => p.expect != null && p.expect === p.predict).length;
  return {
    rows,
    total: pairs.length,
    correct,
    accuracy: pairs.length > 0 ? correct / pairs.length : null,
    macro: { precision: mean((r) => r.precision ?? 0), recall: mean((r) => r.recall ?? 0), f1: mean((r) => r.f1 ?? 0), labels: macroRows.length },
    micro: { precision: microPrecision, recall: microRecall, f1: microF1 },
  };
}

/** 领域覆盖体检：哪 56 个域一个用例都没有、哪些语言缺、泛化用例多少条。 */
export function coverage(cases, opts = {}) {
  const domains = opts.domains || [];
  const languages = opts.languages || WANTED_LANGUAGES;
  const levels = opts.levels || [];
  // 有问题的用例（缺 prompt / 未知判决）不进任何分布统计：
  // 它们连评测都进不去，混进分布只会虚报覆盖。
  const usable = cases.filter((c) => c.problems.length === 0);
  const tally = (fn) => {
    const m = new Map();
    for (const c of usable) {
      const k = fn(c);
      if (k == null) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
  };
  const byDomain = tally((c) => (c.domain && !c.wildcard ? c.domain : null));
  const byLanguage = tally((c) => c.language);
  const byLevel = tally((c) => c.level);
  const byVerdict = tally((c) => c.verdict);
  return {
    total: cases.length,
    usable: usable.length,
    labeledDomain: usable.filter((c) => c.domain && !c.wildcard).length,
    labeledVerdict: usable.filter((c) => c.verdict).length,
    wildcard: usable.filter((c) => c.wildcard).length,
    missingPrompt: cases.filter((c) => c.problems.length > 0).length,
    byDomain,
    byLanguage,
    byLevel,
    byVerdict,
    domainGaps: domains.filter((d) => !(d in byDomain)),
    languageGaps: languages.filter((l) => !(l in byLanguage)),
    levelGaps: levels.filter((l) => !(l in byLevel)),
    unknownDomains: Object.keys(byDomain).filter((d) => domains.length > 0 && !domains.includes(d)),
  };
}

// ---- 快照与门禁 ----------------------------------------------------------

/** 指标扁平化：只留数字叶子，便于逐项比对（跳过 createdAt/note/files 等元信息）。 */
export const SNAPSHOT_SKIP_KEYS = Object.freeze([
  "createdAt",
  "note",
  "files",
  "dir",
  "bytes",
  "comments",
  "blanks",
  "badLines",
  "source",
  "prompt",
  "top",
  "samples",
]);

export function flattenMetrics(snapshot) {
  const flat = {};
  const walk = (prefix, value) => {
    if (value === null || value === undefined) return;
    if (typeof value === "number") {
      flat[prefix] = value;
      return;
    }
    if (typeof value !== "object") return;
    if (Array.isArray(value)) return;
    for (const [key, v] of Object.entries(value)) {
      if (SNAPSHOT_SKIP_KEYS.includes(key)) continue;
      walk(prefix ? `${prefix}.${key}` : key, v);
    }
  };
  walk("", snapshot);
  return flat;
}

/**
 * 与基线比对。默认容差 0.005（0.5 个百分点）——
 * 小于它的波动是语料/时序噪声，不该拦人；大于它的回退必须报错。
 *
 * 指标方向：P/R/F1/top1 类越大越好，但 FP/FN 是**计数**，变小才是好事。
 * 早先这里一律按「变大=变好」比，于是 web 的 FN 从 7 降到 4 被报成回退 ——
 * 门禁方向搞反比没有门禁更危险：它会逼人把误判改回误判。
 */
const LOWER_IS_BETTER = /(^|\.)(fn|fp|errors|error|skipped|missing|bad|duplicates|failures)$/;
export function diffSnapshot(baseline, current, epsilon = 0.005) {
  const base = flattenMetrics(baseline);
  const cur = flattenMetrics(current);
  const regressions = [];
  const improvements = [];
  const added = [];
  const removed = [];
  for (const [key, value] of Object.entries(cur)) {
    if (!(key in base)) {
      added.push({ key, to: value });
      continue;
    }
    const before = base[key];
    if (typeof before !== "number") continue;
    const delta = LOWER_IS_BETTER.test(key) ? before - value : value - before;
    if (delta < -epsilon) regressions.push({ key, from: before, to: value, delta });
    else if (delta > epsilon) improvements.push({ key, from: before, to: value, delta });
  }
  for (const key of Object.keys(base)) if (!(key in cur)) removed.push({ key, from: base[key] });
  regressions.sort((a, b) => a.delta - b.delta);
  improvements.sort((a, b) => b.delta - a.delta);
  return { regressions, improvements, added, removed, epsilon };
}

// ---- 文本输出 ------------------------------------------------------------

export function percent(x, digits = 1) {
  return x === null || x === undefined ? "—" : `${(x * 100).toFixed(digits)}%`;
}

export function formatPrf(result) {
  const lines = ["  标签".padEnd(20) + "P".padStart(9) + "R".padStart(9) + "F1".padStart(9) + "支持".padStart(7) + "  TP/FP/FN"];
  for (const r of result.rows) {
    lines.push(
      `  ${String(r.label).padEnd(18)}${percent(r.precision).padStart(9)}${percent(r.recall).padStart(9)}${percent(r.f1).padStart(9)}${String(r.support).padStart(7)}  ${r.tp}/${r.fp}/${r.fn}`,
    );
  }
  lines.push(
    `  ${"宏平均".padEnd(18)}${percent(result.macro.precision).padStart(9)}${percent(result.macro.recall).padStart(9)}${percent(result.macro.f1).padStart(9)}${""}`,
  );
  lines.push(
    `  ${"微平均".padEnd(18)}${percent(result.micro.precision).padStart(9)}${percent(result.micro.recall).padStart(9)}${percent(result.micro.f1).padStart(9)}${""}`,
  );
  return lines.join("\n");
}

export function formatConfusion(conf) {
  const cell = (v) => String(v).padStart(6);
  const header = "  期望\\预测".padEnd(18) + conf.colLabels.map((c) => c.padStart(6)).join("");
  const lines = [header];
  for (const r of conf.rowLabels) {
    const sum = conf.colLabels.reduce((a, c) => a + conf.matrix[r][c], 0);
    const cells = conf.colLabels.map((c) => cell(conf.matrix[r][c]));
    lines.push(`  ${r.padEnd(16)}${cells.join("")}${String(sum).padStart(6)}`);
  }
  const foot = conf.colLabels.map((c) => conf.rowLabels.reduce((a, r) => a + conf.matrix[r][c], 0));
  lines.push(`  ${"合计".padEnd(16)}${foot.map(cell).join("")}${String(conf.total).padStart(6)}`);
  return lines.join("\n");
}
