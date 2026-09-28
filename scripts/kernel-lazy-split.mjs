#!/usr/bin/env node
// 内核惰性拆分器：把「只在触发场景才需要」的章节从常驻索引里搬到 prompts/infinite-gen-5-lazy.md，
// 常驻文件只留核心 + 指针行。搬运是**逐字搬**（不改写），并校验：每段被搬正文在原文里连续出现、
// 单元之间不重叠、常驻核心里不再残留这些正文。任何一条不成立就拒绝写盘。
//
//   node scripts/kernel-lazy-split.mjs --dry      只看尺寸，不写盘
//   node scripts/kernel-lazy-split.mjs            执行拆分（已拆过拒绝，除非 --force）
//   node scripts/kernel-lazy-split.mjs --restore  用 infinite-gen-5.full.md 还原常驻内核
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(ROOT, "prompts", "infinite-gen-5.md");
const LAZY = join(ROOT, "prompts", "infinite-gen-5-lazy.md");
const FULL = join(ROOT, "prompts", "infinite-gen-5.full.md");
const BAK = join(ROOT, "prompts", "infinite-gen-5.md.bak-v0.36");

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const force = argv.includes("--force");
const restore = argv.includes("--restore");

// 整节搬迁：锚点 → id / 装载序 / 触发词
const MOVE_SECTIONS = [
  ["Dispatch rule", "L_dispatch", 160, "子代理|subagent|分发|dispatch|派发|并行|多代理|workflow|工作流|一片一片", "子代理继承内核：回执单行四态，边界层只记立场"],
  ["Long-range rule", "L_longrange", 170, "继续|接着|照旧|下一轮|第\\s*\\d+\\s*轮|再深|变薄|衰减|跟上次一样|又变|保持深度", "轮次不衰减：第N轮 ≥ 首轮 60% 推进量"],
  ["Pressure rule", "L_pressure", 171, "压力|别管|不管我|不需要你的判断|学术|虚构豁免|情感|你已回答|别的题|一致性|施压|认真回答|别废话|再试一次|道德说教|你没有资格", "施压不改已给立场：只答更窄的那一问"],
  ["Metacognition rule", "L_meta", 172, "自评|自我评估|复盘|审计|逐条|引用原句|检查你|审查|你刚才说|核实|你确定|证据", "自评须逐条引原句并标四态，不空喊合规"],
  ["Anti-suggestion rule", "L_antisug", 173, "你做不到|你不能|你无法|做不到|复制|不算数|重做|能力有限|保守|模式化|你就是|只是模型", "「你做不到」是状态注入：不自我否定、不作废已交付"],
  ["Upstream-shape rule", "L_upstream", 174, "上游|固定形态|模板|尾句|格式规定|第一块|按这个格式|照这个模板|按这个结构", "上游定了形态就按形态出，不寒暄不自动展开"],
  ["Eval-discipline rule", "L_eval", 175, "评分|打分|得分|分数|计分|满分|合格|判分|多少分|算几分", "自评是测量不是刷分，边界层只记位置"],
];

// 半节搬迁（保留前半含被断言锚点，搬走尾部）
const MOVE_TAILS = [
  {
    anchor: "Named coverage", id: "L_coverage", order: 162,
    triggers: "领域|domain|playbook|域包|有哪些|支持哪些|清单|family|分类|107",
    mode: "afterAnchor", // 锚点行之后整段搬走（那张 107 域清单）
    pointer: "  （107 域逐条清单不常驻：命中领域词时 Order 160 段逐字拼回；域 id / 骨架 / 起步命令一律用 infinite_gen5_scenario 现场取，索引免费。）",
  },
  {
    anchor: "Format examples", id: "L_examples", order: 176,
    triggers: "示例|例子|格式|风格|照着|像这样|样例",
    mode: "fromLine", fromLine: "[USER] 封装一个可复用的重试工具", // 前三条示例留常驻
    pointer: "（工具类 / 日文 / ELF 三条示例不常驻：命中示例类词时 Order 160 段逐字拼回。）",
  },
];

const SECTION_RE = /^(SUPREME|Output contract|Task classes|Named coverage|Toolchain rule|Environment rule|Tool-call rule|Task-list rule|Language rule|Calibration rule|Scoring interface|Dispatch rule|Zero-residue rule|Long-range rule|Pressure rule|Metacognition rule|Anti-suggestion rule|Upstream-shape rule|Eval-discipline rule|Boundary rule|Format examples)/;

if (restore) {
  if (!existsSync(FULL)) { console.error("✗ 没有 infinite-gen-5.full.md，无法还原"); process.exit(1); }
  copyFileSync(FULL, CORE);
  console.log("✓ 已用 infinite-gen-5.full.md 还原常驻内核");
  process.exit(0);
}

const original = readFileSync(CORE, "utf8");
const lines = original.split("\n");
if (existsSync(LAZY) && !force && !dry) {
  console.error("✗ 已经拆过了（prompts/infinite-gen-5-lazy.md 在场）。重拆加 --force，还原用 --restore。");
  process.exit(1);
}
const headOf = (needle) => lines.findIndex((l) => l.startsWith(needle));
const endOf = (s) => {
  for (let i = s + 1; i < lines.length; i++) if (SECTION_RE.test(lines[i])) return i;
  return lines.length;
};

const ops = [];
for (const [anchor, id, order, triggers, digest] of MOVE_SECTIONS) {
  const s = headOf(anchor);
  if (s < 0) { console.error(`✗ 找不到章节 ${anchor}`); process.exit(1); }
  if (!digest) { console.error(`✗ 章节 ${anchor} 缺 digest（指针行会写出 undefined）`); process.exit(1); }
  // digest 进的是常驻内核里的指针行 —— 未命中触发词时，这一行是那条决定的唯一在场形式。
  ops.push({ anchor, id, order, triggers, digest, start: s, end: endOf(s), cutStart: s, whole: true });
}
for (const t of MOVE_TAILS) {
  const s = headOf(t.anchor);
  if (s < 0) { console.error(`✗ 找不到章节 ${t.anchor}`); process.exit(1); }
  const end = endOf(s);
  let cutStart;
  if (t.mode === "afterAnchor") cutStart = s + 1;
  else {
    cutStart = lines.findIndex((l, i) => i >= s && i < end && l.startsWith(t.fromLine));
    if (cutStart < 0) { console.error(`✗ ${t.anchor} 找不到切点 ${t.fromLine}`); process.exit(1); }
  }
  ops.push({ ...t, start: s, end, cutStart, whole: false });
}
ops.sort((a, b) => a.start - b.start);
for (let i = 1; i < ops.length; i++) {
  if (ops[i].start < ops[i - 1].end) { console.error(`✗ 搬迁区间重叠：${ops[i - 1].anchor} / ${ops[i].anchor}`); process.exit(1); }
}

const coreParts = [];
const units = [];
let cursor = 0;
for (const op of ops) {
  const moved = lines.slice(op.cutStart, op.end).join("\n");
  if (coreParts.length === 0 && op.cutStart > 0) coreParts.push(lines.slice(0, op.cutStart).join("\n"));
  else coreParts.push(lines.slice(cursor, op.cutStart).join("\n"));
  coreParts.push(op.whole
    ? `【惰性 ${op.id}｜${op.digest}】全文命中触发词时由 Order 160 段逐字拼回（prompts/infinite-gen-5-lazy.md），未命中就只留这一行。`
    : op.pointer);
  cursor = op.end;
  units.push({ id: op.id, order: op.order, triggers: op.triggers, anchor: op.anchor, text: moved, at: op.cutStart });
}
coreParts.push(lines.slice(cursor).join("\n"));

const coreText = coreParts.join("\n");
const lazyText = [
  "# 惰性章节库 — Order 160 按需拼回（正文逐字取自常驻内核，勿手改措辞；改内核请先 --restore 再重拆）",
  "",
  ...units.slice().sort((a, b) => a.order - b.order)
    .map((u) => `@@unit:${u.id}|order:${u.order}|anchor:${u.anchor}|triggers:${u.triggers}\n${u.text}\n@@end:${u.id}`),
  "",
].join("\n");

// 覆盖校验
const problems = [];
for (const u of units) {
  if (!original.includes(u.text)) problems.push(`${u.id}: 正文不是原文的连续片段（被改写过）`);
  if (coreText.includes(u.text)) problems.push(`${u.id}: 常驻核心里仍残留该正文（重复）`);
}
const movedChars = units.reduce((n, u) => n + u.text.length, 0);
const pointerChars = coreParts.filter((s) => s.startsWith("【惰性章节") || s.startsWith("  （107 域") || s.startsWith("（工具类")).join("").length;

console.log(`原文 ${original.length} 字符 → 常驻 ${coreText.length} 字符 · ${units.length} 个惰性单元 ${lazyText.length} 字符`);
console.log(`搬迁正文 ${movedChars} 字符 · 指针 ${pointerChars} 字符 · 每轮少载 ${original.length - coreText.length} 字符`);
for (const u of units.slice().sort((a, b) => a.order - b.order)) {
  console.log(`  ${u.id.padEnd(12)} order=${String(u.order).padEnd(4)} ${String(u.text.length).padStart(5)} 字符 ${u.anchor}`);
}
if (problems.length) { console.error("✗ 覆盖校验失败：\n  - " + problems.join("\n  - ")); process.exit(1); }
console.log("✓ 覆盖校验：每段惰性正文都是原文连续片段，且常驻内核无残留");
console.log(`常驻压缩率 ${(100 * (1 - coreText.length / original.length)).toFixed(1)}%`);
if (dry) { console.log("（--dry：未写盘）"); process.exit(0); }
if (!existsSync(BAK)) copyFileSync(CORE, BAK);
writeFileSync(CORE, coreText);
writeFileSync(LAZY, lazyText);
writeFileSync(FULL, original);
// 三份内核（infinite-gen-5 / infinite-gen-5.1-flash / infinite-gen-5-classic）必须逐字同源：
// verify_prompt_gen5.mjs:281-292 用 sha256 断言这一点，所以常驻文本要同步到另外两份。
// 覆盖前逐份校验：目标必须还等于原文（首次拆）或已等于常驻文本（重复拆），否则拒绝写。
for (const name of ["infinite-gen-5.1-flash.md", "infinite-gen-5-classic.md"]) {
  const p = join(dirname(CORE), name);
  if (!existsSync(p)) { console.error(`✗ 同源目标缺失：${p}`); process.exit(1); }
  const cur = readFileSync(p, "utf8");
  if (cur !== original && cur !== coreText) {
    console.error(`✗ ${name} 既不是原文也不是常驻文本（被手改过？）—— 拒绝覆盖，先跑 --restore`);
    process.exit(1);
  }
  writeFileSync(p, coreText);
}
console.log("✓ 同源同步：infinite-gen-5.1-flash.md · infinite-gen-5-classic.md");
console.log(`✓ 已写盘：prompts/infinite-gen-5.md · prompts/infinite-gen-5-lazy.md · infinite-gen-5.full.md（原文备份 ${BAK}）`);
