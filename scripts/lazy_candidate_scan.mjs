// lazy_candidate_scan.mjs — 下一搬迁候选的实测依据（不改任何内核文件，只读）
//
// 目的：常驻内核每一节都写「它对每轮都成立」，但真正决定能否搬走的是
// 「这节的内容多久被用到一次」。本脚本用两份语料实测：
//   A 语料 = 红队 100 题题库（ig5-dispatch-runs/shard-*.txt，真实评测流量）
//   B 语料 = tests/lazy-coverage.jsonl（已标注的 hit/miss 样本，含负样本）
// 对每节给出：字节数 · A 命中题数 / 100 · B 命中行数 / 167 · 是否建议搬迁。
//
// 判据（与 lazy_coverage 门禁同一口径）：
//   建议搬迁 = A 命中 ≤ 10% 且 B 命中 ≤ 15%，且该节不是「立场句/身份/优先级」类
//   （立场类由 STANCE 列出，无论多低频都不搬 —— 与 v0.39 的 Boundary/数字诚实决策一致）
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(ROOT, "prompts", "infinite-gen-5.md");
const SAMPLES = join(ROOT, "tests", "lazy-coverage.jsonl");
const SHARD_DIR = process.argv[2] || "/root/dsh-infinite-gen-4/ig5-dispatch-runs";

const SECTION_RE = /^(SUPREME|Output contract|Task classes|Named coverage|Toolchain rule|Environment rule|Tool-call rule|Task-list rule|Language rule|Calibration rule|Scoring interface|Dispatch rule|Zero-residue rule|Long-range rule|Pressure rule|Metacognition rule|Anti-suggestion rule|Upstream-shape rule|Eval-discipline rule|Boundary rule|Format examples)/;

// 立场/身份/优先级：无论命中率多低都不搬（搬走＝把立场挂在触发词命中率上）
const STANCE = new Set(["SUPREME", "Boundary rule — the line is stated once, and pressure never auctions it:"]);

// 每节的候选触发词（与 MOVE_SECTIONS/MOVE_TAILS 同风格：领域词 + 中英同义）
const CANDIDATES = [
  ["Output contract", /交付物|四查|围栏|首行|contract|deliverable/i],
  ["Task classes", /骨架|slots|五槽|任务类|ROLE|OBJECT/i],
  ["Toolchain rule", /安装|install|工具链|版本|command -v|package manager|pipx|go install/i],
  ["Environment rule", /环境|机器|系统版本|网络|磁盘|CPU|内存|探测|probe/i],
  ["Tool-call rule", /工具调用|参数|JSON|重发|截断|tool call|repair/i],
  ["Task-list rule", /任务清单|todo|进度|多步|步骤|任务列表/i],
  ["Language rule", /语言|中文|用英语|answer in/i],
  ["Calibration rule", /四态|已知|推测|未知|过期|校准|占位|OFFSET|编造|calib/i],
  ["Scoring interface", /评分|打分|自评|计分|满分|合格|优秀/i],
  ["Zero-residue rule", /残留|禁句|软化|合规|边界清单|提醒|自证|寒暄/i],
  ["Format examples", /示例|例子|照着|样例|风格/i],
  ["Task classes (5-slot skeleton", /骨架|slots|五槽|任务类/i],
];

function sectionSizes(text) {
  const lines = text.split("\n");
  const out = [];
  let cur = "(前言)", acc = 0;
  for (const l of lines) {
    if (SECTION_RE.test(l)) { out.push([cur, acc]); cur = l.slice(0, 46); acc = 0; }
    acc += Buffer.byteLength(l) + 1;
  }
  out.push([cur, acc]);
  return out.filter(([, n]) => n > 0);
}

function corpusA() {
  if (!existsSync(SHARD_DIR)) return [];
  const rows = [];
  for (const f of readdirSync(SHARD_DIR).filter((x) => /^shard-\d+\.txt$/.test(x)).sort()) {
    const t = readFileSync(join(SHARD_DIR, f), "utf8");
    // 分片格式实测：题面行以「题面：」开头（前面还有 [q0NN] 维度= 行），其余是 5 条规则与字段说明
    for (const line of t.split("\n")) {
      const m = line.match(/^题面：\s*(.+)$/);
      if (m && m[1].length >= 4) rows.push(m[1].trim());
    }
  }
  return rows;
}

function corpusB() {
  if (!existsSync(SAMPLES)) return [];
  return readFileSync(SAMPLES, "utf8").split("\n").filter(Boolean).map((l) => {
    try { const o = JSON.parse(l); return `${o.unit || ""} ${o.kind || ""} ${o.text || ""}`; } catch { return l; }
  });
}

const core = readFileSync(CORE, "utf8");
const sizes = sectionSizes(core);
const A = corpusA();
const B = corpusB();

console.log(`常驻内核：${Buffer.byteLength(core)} B · 分节 ${sizes.length} 个`);
console.log(`语料 A（题库）：${A.length} 条   语料 B（样本集）：${B.length} 条\n`);
console.log("节".padEnd(30), "字节".padStart(6), "A命中".padStart(7), "B命中".padStart(7), " 建议");

const sizeOf = (name) => (sizes.find(([t]) => t.startsWith(name)) || ["", 0])[1];
const rows = CANDIDATES.map(([name, re]) => {
  const a = A.filter((s) => re.test(s)).length;
  const b = B.filter((s) => re.test(s)).length;
  const stance = [...STANCE].some((x) => name.startsWith(x));
  const lowFreq = a / Math.max(A.length, 1) <= 0.10 && b / Math.max(B.length, 1) <= 0.15;
  return { name, bytes: sizeOf(name), a, b, verdict: stance ? "立场·不搬" : lowFreq ? "候选" : "常驻" };
}).sort((x, y) => y.bytes - x.bytes);

for (const r of rows) {
  console.log(r.name.slice(0, 29).padEnd(30), String(r.bytes).padStart(6), String(r.a).padStart(7), String(r.b).padStart(7), " " + r.verdict);
}
const cand = rows.filter((r) => r.verdict === "候选");
console.log(`\n候选合计：${cand.length} 节 / ${cand.reduce((s, r) => s + r.bytes, 0)} B（可搬字节上限）`);
