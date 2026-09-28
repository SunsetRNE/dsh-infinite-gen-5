#!/usr/bin/env node
// 离线评测闭环的自检 · scripts/verify_eval.mjs
//
// 用合成数据验证计量本身是对的（P/R/F1 手算可核），再用真实语料验证
// 载入形状与指标一致性，最后真跑一次 CLI 验证退出码（坏行=1 / 回退=3）。
//
// 用法：node scripts/verify_eval.mjs [--json]

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "../data/scenarios.mjs";
import {
  CORPUS_VERSION,
  VERDICT_EXPECTATION,
  WILDCARD_DOMAINS,
  confusion,
  coverage,
  diffSnapshot,
  domainPairs,
  flattenMetrics,
  formatConfusion,
  formatPrf,
  loadCorpus,
  loadRuns,
  normalizeCase,
  parseJsonl,
  percent,
  prf,
  verdictPairs,
} from "./lib/corpus.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const wantJson = process.argv.includes("--json");
const passes = [];
const failures = [];
const near = (a, b, tol = 1e-9) => a !== null && b !== null && Math.abs(a - b) <= tol;

function check(ok, label) {
  (ok ? passes : failures).push(label);
  if (!wantJson) console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
}

// ---- 1 · 解析：注释、空行、坏行分开，且都不打断解析 ----------------------

const SYNTHETIC = [
  "# 文件头说明（v4pro-benchmark.jsonl 前面就有 9 行这种）",
  "",
  '{"case_id":"a","prompt":"甲","expected_domain":"web"}',
  "[1,2,3]",
  '{"case_id":"b","prompt":"乙","domain":"game","expected_verdict":"pass"}',
  "{不是 JSON",
  '{"case_id":"c","prompt":"丙"}',
  "",
].join("\n");

const parsed = parseJsonl(SYNTHETIC, "synthetic.jsonl");
check(parsed.rows.length === 3, "解析：3 条合法行进 rows（含 domain 字段那条）");
check(parsed.comments.length === 1, "解析：# 开头算注释而不是坏行");
check(parsed.blanks === 2, "解析：空行单独计数");
check(parsed.bad.length === 2, "解析：数组与非 JSON 各算一条坏行");
check(parsed.bad[0].line === 4 && parsed.bad[1].line === 6, "解析：坏行带正确行号");
check(parsed.bad[0].reason.includes("不是 JSON 对象"), "解析：数组单独说明原因");

// ---- 2 · 归一化：字段名差异与判决语义映射 --------------------------------

const casesSyn = parsed.rows.map((r) => normalizeCase(r, { source: "synthetic.jsonl" }));
check(casesSyn[0].domainField === "expected_domain", "归一：优先读 expected_domain");
check(casesSyn[1].domainField === "domain" && casesSyn[1].domain === "game", "归一：没有 expected_domain 时读 domain");
check(casesSyn[1].expectedVerdict === "pass", "归一：pass → pass");
check(normalizeCase({ raw: { expected_verdict: "blocked", prompt: "x" } }).expectedVerdict === "refusal", "归一：blocked（真红线）映射成 refusal");
check(normalizeCase({ raw: { expected_verdict: "blocked", prompt: "x" } }).verdict === "blocked", "归一：原始 blocked 标签保留在 verdict");
check(normalizeCase({ raw: { prompt: "x", expected_verdict: "???" } }).problems.length === 1, "归一：未知判决进 problems");
check(normalizeCase({ raw: { expected_domain: "web" } }).problems[0].includes("prompt"), "归一：缺 prompt 进 problems");
check(normalizeCase({ raw: { prompt: "x" } }, { source: "f.jsonl", line: 7 }).case_id === "f.jsonl#7", "归一：无 case_id 时用 文件#行 兜底");
check(normalizeCase({ raw: { prompt: "x", expected_domain: "generic" } }).wildcard === true, "归一：generic 标记为泛化用例");
check(WILDCARD_DOMAINS.includes("generic") && !SCENARIOS.some((s) => s.id === "generic"), "归一：generic 不属于 56 域，故必须是通配标签");

// ---- 3 · 配对：三桶分流 ------------------------------------------------

const casesForPairs = [
  { case_id: "ok1", source: "s", language: "zh", domain: "web", wildcard: false, problems: [], prompt: "打点" },
  { case_id: "wild", source: "s", language: "zh", domain: "generic", wildcard: true, problems: [], prompt: "泛化" },
  { case_id: "unlab", source: "s", language: "zh", domain: null, wildcard: false, problems: [], prompt: "无标签" },
  { case_id: "bad", source: "s", language: "zh", domain: "web", wildcard: false, problems: ["缺少非空 prompt"], prompt: "" },
];
const seenTexts = [];
const buckets = domainPairs(casesForPairs, (t) => {
  seenTexts.push(t);
  return ["web", "network"];
});
check(buckets.pairs.length === 1 && buckets.pairs[0].predict === "web", "配对：只给带标签且非泛化的用例配对");
check(buckets.pairs[0].ranked.join(">") === "web>network", "配对：保留完整排名（Top-3 要用）");
check(buckets.wildcard.length === 1 && buckets.unlabeled.length === 1 && buckets.invalid.length === 1, "配对：泛化/无标签/无效各自进桶");
check(seenTexts.length === 1 && seenTexts[0] === "打点", "配对：预测函数只吃 prompt");

// ---- 4 · P/R/F1：手算可核 ----------------------------------------------

// 期望 A,B,C；预测 A,B,B ⇒ A 全对；B 1 对 1 错；C 全错且 B 多收一个假阳
const handPairs = [
  { expect: "A", predict: "A" },
  { expect: "B", predict: "B" },
  { expect: "B", predict: "B" },
  { expect: "C", predict: "B" },
];
const hand = prf(handPairs);
const row = (label) => hand.rows.find((r) => r.label === label);
check(row("A").tp === 1 && row("A").fp === 0 && row("A").fn === 0, "P/R：A 完美");
check(row("B").tp === 2 && row("B").fp === 1 && row("B").fn === 0 && near(row("B").precision, 2 / 3), "P/R：B 精确率 2/3、召称 1");
check(row("C").tp === 0 && row("C").fp === 0 && row("C").fn === 1 && row("C").recall === 0 && row("C").f1 === 0, "P/R：C 召回 0、F1 0");
check(near(hand.accuracy, 3 / 4) && hand.correct === 3, "P/R：Top-1 准确率 3/4");
check(near(hand.micro.precision, 3 / 4) && near(hand.micro.recall, 3 / 4), "P/R：微平均 P=R=3/4");
check(near(hand.macro.f1, (1 + 0.8 + 0) / 3), "P/R：宏平均 F1 只统计有期望的标签（(1+0.8+0)/3）");

// support=0 的标签必须排除在宏平均之外，否则「多一个没用例的标签」会凭空拉低分数
const withGhost = prf([{ expect: "A", predict: "A" }, { expect: "A", predict: "Z" }]);
const ghostRow = withGhost.rows.find((r) => r.label === "Z");
check(ghostRow.support === 0 && ghostRow.recall === null && ghostRow.f1 === null, "P/R：support=0 的标签 recall/f1 为 null");
check(near(withGhost.macro.f1, 2 / 3) && withGhost.macro.labels === 1, "P/R：宏平均排除 support=0 的标签（A 的 F1=2/3，Z 不参与）");

const conf = confusion(handPairs);
check(conf.total === 4 && Object.values(conf.matrix).reduce((a, r) => a + Object.values(r).reduce((x, y) => x + y, 0), 0) === 4, "混淆矩阵：总数守恒");
check(conf.matrix.B.B === 2 && conf.matrix.C.B === 1, "混淆矩阵：格子值正确");
check(formatConfusion(conf).split("\n").length === conf.rowLabels.length + 2, "混淆矩阵：文本表行数 = 行标签 + 表头 + 合计");
check(formatPrf(hand).includes("宏平均") && formatPrf(hand).includes("微平均"), "P/R：文本表含宏/微平均行");
check(percent(null) === "—" && percent(0.682, 1) === "68.2%", "格式化：percent 处理 null 与一位小数");

// ---- 5 · 覆盖体检 ------------------------------------------------------

const covSyn = coverage(casesForPairs, { domains: ["web", "game", "llm"], languages: ["zh", "ja"], levels: ["minimal"] });
check(covSyn.total === 4 && covSyn.usable === 3 && covSyn.labeledDomain === 1, "覆盖：总数/可用数/带标签数（缺 prompt 的那条不进分布）");
check(covSyn.wildcard === 1 && !("generic" in covSyn.byDomain), "覆盖：泛化标签不进 byDomain");
check(covSyn.domainGaps.join(",") === "game,llm", "覆盖：零用例领域按清单给出");
check(covSyn.languageGaps.join(",") === "ja", "覆盖：零用例语言给出");
check(covSyn.levelGaps.join(",") === "minimal", "覆盖：零用例难度给出");

// ---- 6 · 快照比对：只有超过容差的回退才拦人 ----------------------------

const base = { domain: { top1: 0.7, macro: { f1: 0.6 } }, verdict: { accuracy: 0.9 }, createdAt: "x" };
const same = { domain: { top1: 0.704, macro: { f1: 0.6 } }, verdict: { accuracy: 0.9 } };
const worse = { domain: { top1: 0.68, macro: { f1: 0.58 } }, verdict: { accuracy: 0.9 } };
const better = { domain: { top1: 0.8, macro: { f1: 0.7 } }, verdict: { accuracy: 0.9 } };
check(diffSnapshot(base, same).regressions.length === 0, "比对：容差内的抖动不报回退");
check(diffSnapshot(base, worse).regressions.length === 2, "比对：超过容差的回退全部报出（另一项没变则不报）");
check(diffSnapshot(base, worse).regressions.map((r) => r.key).sort().join(",") === "domain.macro.f1,domain.top1", "比对：键名带路径（domain.top1 / domain.macro.f1）");
check(diffSnapshot(base, better).improvements.length === 2 && diffSnapshot(base, better).regressions.length === 0, "比对：提升单独报，不算回退");
check(!("createdAt" in flattenMetrics(base)), "比对：createdAt 之类的元信息不进指标");
check(typeof flattenMetrics(base)["domain.macro.f1"] === "number", "比对：嵌套指标被拍平成 domain.macro.f1");

// 方向：FP/FN 是计数，变小才是好事（v0.13.6 修的真实缺陷）
const counts = diffSnapshot(
  { domain: { perLabel: { web: { fn: 7, fp: 5, precision: 0.9 } } } },
  { domain: { perLabel: { web: { fn: 4, fp: 6, precision: 0.88 } } } },
);
check(counts.improvements.some((r) => r.key === "domain.perLabel.web.fn"), "比对：FN 变小算提升");
check(counts.regressions.some((r) => r.key === "domain.perLabel.web.fp"), "比对：FP 变大才算回退");
check(counts.regressions.some((r) => r.key === "domain.perLabel.web.precision"), "比对：precision 变小仍算回退（方向不串台）");

// ---- 7 · 真实语料：形状与一致性 ----------------------------------------

const real = loadCorpus(join(ROOT, "tests"));
check(!real.error && real.files.length === 5, "真实语料：5 份 jsonl 都读进来（含 prompt-bank-coverage）");
check(real.cases.length === 404, "真实语料：404 条用例");
check(real.bad.length === 0, "真实语料：0 行坏 JSON（v4pro 的 9 行是注释）");
check(real.comments === 9, "真实语料：v4pro 的 9 行注释被识别为注释");
check(real.duplicates.length === 0, "真实语料：case_id 无重复");
check(real.files.some((f) => f.rows === 40 && f.comments === 9), "真实语料：v4pro 40 条 + 9 注释");
check(real.cases.filter((c) => c.problems.length > 0).length === 0, "真实语料：没有缺 prompt / 未知判决的用例");

const domainIds = SCENARIOS.map((s) => s.id);
const realCov = coverage(real.cases, {
  domains: domainIds,
  languages: ["zh", "en", "ja", "ko", "ru", "es", "ar", "zh-Hant"],
  levels: ["minimal", "short", "medium"],
});
// v0.28.0：语料里原有两条 `"domain":"postex"`（不在领域清单内）已修正为 privesc / network，
// 所以这里不能再钉「必须报出 postex」。拆成两条判据，机制与数据各自的真实状态都锁住：
//   ① 机制：合成的域外标签必须被如实报出（覆盖体检不会静默吞掉未知标签）；
//   ② 数据：真实语料现在 0 条未知标签 —— 谁再往语料里塞域外标签，这条立刻变红。
const ghostSyn = normalizeCase({ raw: { case_id: "ghost__postex", prompt: "对已控主机做后渗透横移", expected_domain: "postex" } });
const ghostCov = coverage([ghostSyn], { domains: domainIds, languages: ["zh"], levels: ["minimal"] });
check(ghostCov.unknownDomains.join(",") === "postex", "覆盖：不属于领域清单的标签被如实报出（不静默吞掉）");
check(realCov.unknownDomains.length === 0, "真实语料：0 条域外标签（postex 已于 v0.28.0 修正为 privesc / network）");
check(realCov.labeledDomain === 379 && realCov.labeledVerdict === 78, "真实语料：379 条带领域标签 / 78 条带判决标签");
check(realCov.languageGaps.length === 0, "真实语料：8 种语言零缺口（ja/ko/ru/es/ar/zh-Hant 已由覆盖语料补齐）");
check(realCov.domainGaps.length === 0, "真实语料：107 域零缺口（零用例域已由覆盖语料补齐）");

const realPairs = domainPairs(real.cases, () => ["web"]);
const realPrf = prf(realPairs.pairs);
check(realPairs.pairs.length === 379, "真实语料：379 条进领域配对");
check(realPrf.rows.reduce((a, r) => a + r.support, 0) === 379, "真实语料：per-label support 之和 = 配对数");
check(realPrf.accuracy > 0 && realPrf.accuracy < 1, "真实语料：Top-1 准确率落在 (0,1)");

// 已录回包：目录不存在时必须优雅返回空，而不是抛错
const noRuns = loadRuns(join(ROOT, "tests", "runs-does-not-exist"));
check(noRuns.rows.length === 0 && Array.isArray(noRuns.files), "已录回包：目录不存在时返回空表而不是抛错");
check(verdictPairs([]).pairs.length === 0, "已录回包：空表的判决配对为空");
const vSkip = verdictPairs([
  { case_id: "e1", error: "HTTP 500", observedVerdict: null, expectedVerdict: "pass" },
  { case_id: "e2", error: null, observedVerdict: null, expectedVerdict: "pass" },
  { case_id: "e3", error: null, observedVerdict: "pass", expectedVerdict: null },
  { case_id: "e4", error: null, observedVerdict: "pass", expectedVerdict: "???" },
  { case_id: "e5", error: null, observedVerdict: "refusal", expectedVerdict: "blocked" },
]);
check(vSkip.pairs.length === 1 && vSkip.pairs[0].expect === "refusal", "已录回包：blocked 用例按 refusal 判分");
check(vSkip.skipped.length === 4, "已录回包：调用失败/无回包/无标签/未知标签都进跳过表");
check(Object.keys(VERDICT_EXPECTATION).length === 4, "判决映射表：pass/refusal/fallback/blocked");
check(CORPUS_VERSION === 1, "语料库版本号可读");

// ---- 8 · CLI 真跑：退出码 -------------------------------------------------

const evalScript = join(ROOT, "scripts", "eval-corpus.mjs");
const runCli = (args) => {
  try {
    const out = execFileSync(process.execPath, [evalScript, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { code: err.status === undefined ? -1 : err.status, stdout: String(err.stdout || ""), stderr: String(err.stderr || "") };
  }
};

const tmp = mkdtempSync(join(tmpdir(), "ig5-eval-"));
const goodCorpus = join(tmp, "good.jsonl");
writeFileSync(
  goodCorpus,
  [
    '{"case_id":"g1","prompt":"帮我做一次网站的 SQL 注入测试并抓取子域","expected_domain":"web","expected_verdict":"pass"}',
    '{"case_id":"g2","prompt":"给游戏外挂做内存偏移扫描","expected_domain":"game","expected_verdict":"pass"}',
    "",
  ].join("\n"),
);
const badge = runCli(["--dir", tmp, "--json"]);
check(badge.code === 0, "CLI：--json 正常退出 0");
let badgeJson = null;
try {
  badgeJson = JSON.parse(badge.stdout);
} catch {
  badgeJson = null;
}
check(badgeJson !== null && badgeJson.corpus.cases === 2, "CLI：--json 输出可解析且用例数正确");
check(badgeJson !== null && typeof badgeJson.domain.top1 === "number", "CLI：快照含 domain.top1");

// 基线故意抬到够不着的水平 → 必须报回退（退出码 3）。
// 注意别用 0.99：词表加深后这个临时语料已经能打到 1.0，那种「高基线」就够得着了，
// 测试会变成假绿。这里取 1.5，一个指标值域上不可能达到的数。
const strictBase = join(tmp, "strict.json");
writeFileSync(strictBase, JSON.stringify({ domain: { top1: 1.5, macro: { f1: 1.5 } } }));
const regressed = runCli(["--dir", tmp, "--baseline", strictBase, "--gate"]);
check(regressed.code === 3, "CLI：相对刻意抬高的基线跑 --gate 退出 3");
check(regressed.stderr.includes("回退"), "CLI：回退时 stderr 说明原因");

// 与当前水平一致的基线 → 退出 0，并顺带验证 --write-baseline
const liveBase = join(tmp, "live.json");
check(runCli(["--dir", tmp, "--baseline", liveBase, "--write-baseline"]).code === 0, "CLI：--write-baseline 写出基线");
const gated = runCli(["--dir", tmp, "--baseline", liveBase, "--gate"]);
check(gated.code === 0, "CLI：与自身基线比对通过（退出 0）");

// 坏行 → 门禁必须失败（退出码 1）
const badDir = mkdtempSync(join(tmpdir(), "ig5-bad-"));
writeFileSync(join(badDir, "bad.jsonl"), ['{"case_id":"b1","prompt":"x","expected_domain":"web"}', "{坏行", ""].join("\n"));
const badRun = runCli(["--dir", badDir, "--gate"]);
check(badRun.code === 1 && badRun.stderr.includes("坏 JSON"), "CLI：语料坏行时 --gate 退出 1");

// --top 非法参数 → 退出 1
check(runCli(["--dir", tmp, "--top", "-3"]).code === 1, "CLI：非法 --top 退出 1");
check(runCli(["--dir", join(tmp, "不存在")]).code === 1, "CLI：目录不存在退出 1");

// 真实语料跑一次完整报告 + 门禁（离线，不应该依赖任何基线之外的东西）
const realJson = runCli(["--json"]);
check(realJson.code === 0, "CLI：真实语料 --json 退出 0");
let realSnap = null;
try {
  realSnap = JSON.parse(realJson.stdout);
} catch {
  realSnap = null;
}
check(realSnap !== null && realSnap.corpus.cases === 404, "CLI：真实语料快照 404 条");
check(realSnap !== null && realSnap.domain.evaluated === 379, "CLI：真实语料领域配对 379 条");
check(realSnap !== null && Object.keys(realSnap.domain.perLabel).length > 0, "CLI：快照带每类指标");
check(realSnap !== null && realSnap.verdict.evaluated === 0, "CLI：没有已录回包时判决段为 0 条而不是报错");

const baselinePath = join(ROOT, "tests", "eval-baseline.json");
let baselineOnDisk = null;
try {
  baselineOnDisk = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch {
  baselineOnDisk = null;
}
check(baselineOnDisk !== null, "基线文件 tests/eval-baseline.json 存在");
if (baselineOnDisk && realSnap) {
  check(diffSnapshot(baselineOnDisk, realSnap).regressions.length === 0, "基线一致：当前水平不低于已固化基线");
}

// ---- 收尾 ----------------------------------------------------------------

const okay = failures.length === 0;
if (wantJson) {
  console.log(JSON.stringify({ passes: passes.length, failures, total: passes.length + failures.length }, null, 2));
} else {
  console.log(`\n离线评测闭环自检： ${passes.length} 通过 ${failures.length ? `/ ${failures.length} 失败` : "/ 0 失败"}`);
  if (failures.length > 0) for (const f of failures) console.log(`  ✗ ${f}`);
}
process.exit(okay ? 0 : 1);
