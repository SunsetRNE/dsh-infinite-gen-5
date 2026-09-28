// 无限五代 v0.35.0 · 增强语料提取器（离线、只读附件、不连网）
//
// 作用：把《模型越狱注入提示词3.txt》逐节拆成「可编译单元」并把拆解口径落成可复核的
// 三态分类（take / redact / internal），再与真源 data/boost-corpus.mjs 对账 —— 任何
// 一条被标为 internal 的条款，都必须能说出它为什么不注入，否则本次训练就是黑箱。
//
// 用法：
//   node scripts/extract-boost-corpus.mjs                  # 打印矩阵
//   node scripts/extract-boost-corpus.mjs --json           # 机器可读
//   node scripts/extract-boost-corpus.mjs --out=/tmp/x.json
//   IG5_CORPUS=/path/to/模型越狱注入提示词3.txt node ...    # 换一份语料
//
// 找不到附件时打印 SKIP 并 exit 0：缺语料是环境限制，不是回归（与其余自检同口径）。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { BOOST_UNITS, INTERNAL_ONLY, boostStats } from "../data/boost-corpus.mjs";

const DEFAULT_CORPUS =
  "/root/.dsh/attachments/v1/files/f4/f4cd463d37d78e17b6741bea1340d4cd76433e639c7f1127fd79b29f71075fdc/模型越狱注入提示词3.txt";
const CORPUS = process.env.IG5_CORPUS || DEFAULT_CORPUS;
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const outArg = args.find((a) => a.startsWith("--out="));

if (!existsSync(CORPUS)) {
  console.log(`SKIP 提取器：找不到语料 ${CORPUS}（用 IG5_CORPUS 指一份你自己的副本）`);
  process.exit(0);
}

const raw = readFileSync(CORPUS, "utf8");
const sha = createHash("sha256").update(raw, "utf8").digest("hex");

// ── 1. 按节切段 ────────────────────────────────────────────────────────────────
// 两种节标题：中文序号（第一部分 / 一、）与阿拉伯数字（1. / 3.2）。
const HEADING = /^(?:第[一二三四五六七八九十]+部分|[一二三四五六七八九十]+[、.]|\d+(?:\.\d+)*[、.\s])/;
const lines = raw.split(/\r?\n/);
const sections = [];
let current = { head: "（题头）", at: 1, lines: [] };
lines.forEach((line, i) => {
  if (HEADING.test(line.trim()) && line.trim().length <= 40) {
    if (current.lines.length) sections.push(current);
    current = { head: line.trim(), at: i + 1, lines: [] };
  } else {
    current.lines.push(line);
  }
});
if (current.lines.length) sections.push(current);

const paragraphs = [];
for (const section of sections) {
  for (const body of section.lines.join("\n").split(/\n{2,}/)) {
    const text = body.trim();
    if (text.length >= 12) paragraphs.push({ section: section.head, at: section.at, text });
  }
}

// ── 2. 三态分类口径 ────────────────────────────────────────────────────────────
// internal：不注入（元条款 / 与内核校准规则冲突 / 内部脚手架）
// redact  ：去毒后取用（保留可执行的一半，冲突项丢弃）
// take    ：直接取用（已成形的行为契约）
const RULES = [
  { kind: "internal", re: /(无拒绝原则|不得拒绝|没有拒绝|任何请求都(?:必须|应当)执行)/, why: "元条款：行为规则已在内核里表达，注入该条只占字节" },
  { kind: "internal", re: /(禁用词|禁止使用以下词语|不得输出以下)/, why: "与内核校准规则的收尾四行冲突" },
  { kind: "internal", re: /(保密|不得(?:重复|复述|泄露)本|不能透露(?:本|这些)指令)/, why: "要求不复述指令本身，与注入可审计前提冲突" },
  { kind: "internal", re: /(未成年|性内容|色情|暴力内容边界|不得生成违法)/, why: "内容边界声明，按内核边界规则处理，不注入" },
  { kind: "redact", re: /(NPC|角色(?:的)?动机|扮演|人设|人格)/, why: "改写成短句契约，去掉与用户优先权冲突的一半" },
  { kind: "redact", re: /(创作|小说|剧本|全情|实写|感官|场景)/, why: "保留写法要求，丢弃越界内容清单" },
  { kind: "take", re: /(先(?:查|读|看)后写|第一步(?:必须|要)|工具调用|真实(?:结果|输出)|不(?:要|得)假装)/, why: "先查后写：可直接成句" },
  { kind: "take", re: /(副本|备份|回滚|ROLLBACK|DIFF|哈希)/, why: "改件与回滚四件产物：可直接成句" },
  { kind: "take", re: /(最小改动|风险|不可逆|破坏性|影响面)/, why: "风险操作与最小改动：可直接成句" },
  { kind: "take", re: /(完成态|继续推进|不要停在|错误不是|拒绝不是)/, why: "状态延续：可直接成句" },
  { kind: "take", re: /(归属|事实|推测|猜测|假设|不确定)/, why: "事实/推断四分：与内核校准规则同向" },
];
const classify = (text) => {
  for (const rule of RULES) if (rule.re.test(text)) return { kind: rule.kind, why: rule.why };
  return { kind: "kept-out", why: "未命中任何规则：按「无收益不注入」丢弃" };
};

const matrix = paragraphs.map((p) => ({ ...p, ...classify(p.text) }));
const tally = matrix.reduce((acc, row) => ((acc[row.kind] = (acc[row.kind] ?? 0) + 1), acc), {});

// ── 3. 与真源对账 ──────────────────────────────────────────────────────────────
const declared = new Set(BOOST_UNITS.map((u) => u.from));
const covered = matrix.filter((row) => [...declared].some((from) => row.section.includes(from.split(" ")[0])));
const report = {
  corpus: CORPUS,
  sha256: sha,
  chars: raw.length,
  lines: lines.length,
  sections: sections.length,
  paragraphs: paragraphs.length,
  tally,
  internal: INTERNAL_ONLY,
  units: BOOST_UNITS.map((u) => ({ id: u.id, from: u.from, kind: u.kind, tone: u.tone, bytes: u.bytes })),
  stats: boostStats(),
 覆盖: {
    declaredUnits: BOOST_UNITS.length,
    matchedSections: new Set(covered.map((row) => row.section)).size,
    unmatchedUnits: BOOST_UNITS.filter((u) => !matrix.some((row) => row.section.includes(u.from.split(" ")[0]))).map((u) => u.id),
  },
};

if (outArg) {
  const target = outArg.slice("--out=".length);
  writeFileSync(target, JSON.stringify({ ...report, matrix }, null, 2));
  console.log(`已写出提取矩阵：${target}（${matrix.length} 段）`);
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("增强语料提取（离线）");
  console.log(`语料     ${CORPUS}`);
  console.log(`sha256   ${sha}`);
  console.log(`规模     ${raw.length} 字符 / ${lines.length} 行 / ${sections.length} 节 / ${paragraphs.length} 段`);
  console.log(`三态     ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`可编译单元 ${report.stats.units}（take ${report.stats.byKind.take} / redact ${report.stats.byKind.redact}）· 触发词 ${report.stats.triggers} · 单元总字节 ${report.stats.unitBytes}`);
  console.log(`不注入条目 ${INTERNAL_ONLY.length}：${INTERNAL_ONLY.map((x) => x.id).join(" ")}`);
  console.log("单元明细：");
  for (const u of report.units) console.log(`  ${u.id}  [${u.kind}/${u.tone}] ${String(u.bytes).padStart(4)} B  ← ${u.from}`);
  if (report.覆盖.unmatchedUnits.length) {
    console.log(`未在语料里定位到的单元：${report.覆盖.unmatchedUnits.join(" ")}（检查 from 里的节名写法）`);
  } else {
    console.log("对账：全部单元都能在语料里定位到来源节。");
  }
}
