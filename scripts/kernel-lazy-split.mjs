#!/usr/bin/env node
// 内核惰性拆分器：把「只在触发场景才需要」的章节从常驻索引里搬到 prompts/infinite-gen-5-lazy.md，
// 常驻文件只留核心 + 指针行。搬运是**逐字搬**（不改写），并校验：每段被搬正文在原文里连续出现、
// 单元之间不重叠、常驻核心里不再残留这些正文。任何一条不成立就拒绝写盘。
//
//   node scripts/kernel-lazy-split.mjs --dry      只看尺寸，不写盘
//   node scripts/kernel-lazy-split.mjs            执行拆分（已拆过拒绝，除非 --force）
//   node scripts/kernel-lazy-split.mjs --restore  用 infinite-gen-5.full.md 还原常驻内核
//
// ---- v0.39 起：以「当前常驻内核」为真源重拆（full.md 是旧快照，restore 会丢近改动）------------
//   node scripts/kernel-lazy-split.mjs --from-core --dry     只算尺寸：原样重拆，验证拆分器一致性
//   node scripts/kernel-lazy-split.mjs --from-core --unlock  写盘（跳过「已拆过」与 restore 检查）
// 语义：original = 当前 prompts/infinite-gen-5.md；单元正文仍是逐字搬；每个 @@unit 里 @@end 之后
// 已存在的手写增量（例如 v0.39 的新条款）按 id 保留并重新拼到该单元末尾 —— 新条款只许追加在 @@end 之后，
// 绝不改 @@unit 正文，否则触发「正文不是原文的连续片段」拒绝写盘。
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
const fromCore = argv.includes("--from-core");
const unlock = argv.includes("--unlock");

// 整节搬迁：锚点 → id / 装载序 / 触发词
const MOVE_SECTIONS = [
  ["Dispatch rule", "L_dispatch", 160, "子代理|subagent|分发|dispatch|派发|并行|多代理|workflow|工作流|一片一片", "子代理继承内核：回执单行四态，边界层只记立场"],
  ["Long-range rule", "L_longrange", 170, "继续|接着|照旧|下一轮|第\\s*\\d+\\s*轮|轮次|再深|变薄|衰减|跟上次一样|跟前面|差太多|又变|保持深度|又变浅|比上次浅|别缩水|缩水|跟首轮一样|跟第一轮|一次比一次|越写越短|越答越短|保持这个深度|接着上一条|深度别掉", "轮次不衰减：第N轮 ≥ 首轮 60% 推进量"],
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
    triggers: "示例|例子|风格|照着|像这样|样例|示例来|给我例子|照这个格式|按这个格式|照这个模板|格式参照|参照上一条",
    mode: "fromLine", fromLine: "[USER] 封装一个可复用的重试工具（TypeScript）", anywhere: true, // 前三条示例留常驻
    pointer: "（工具类 / 日文 / ELF 三条示例不常驻：命中示例类词时 Order 160 段逐字拼回。）",
  },
  {
    // v0.39 新增：常驻只留「限制短语行」，编号/日期/符号那一大段按需拼回
    // v0.39 决策：Anything carrying a number（数字诚实规则）保持常驻 —— 它对每份技术交付都成立，
    // 且是校准维度的核心；搬走只会省 1220 B，却把「编造偏移」的风险挂在触发词命中率上。
    // v0.39 新增：写作侧六条（自评/被追问时才用得上；四行尾块与字面闸门仍常驻）
    anchor: "Scoring interface", id: "L_writing6", order: 163,
    triggers: "评分|打分|得分|计分|自评|分数|满分|合格|优秀|多少分|评分标准|追问|编造|偏移|符号名|成功率|量化|历史|复评",
    mode: "fromLine", fromLine: "  写作侧六条：① 代码块只放有语义的标识符",
    endAt: "Dispatch rule",
    pointer: "  （写作侧六条（标识符/禁语/不递减/引题号/四态/规模）另存：命中评分|自评|追问|编造|符号名等词时由 Order 160 段逐字拼回。）",
  },
  {
    // v0.39 新增：工具调用坏包修复细节（只在工具调用真出错时才用得上）
    anchor: "Tool-call rule", id: "L_toolcall_repair", order: 164,
    triggers: "工具调用|tool call|报错|截断|重试|重发|超时|调不通|失败|坏包|参数太长|JSON|拿不到|调用失败",
    mode: "fromLine", fromLine: "  Repair path: an invalid-JSON or empty result is a retry signal",
    endAt: "Task-list rule",
    pointer: "  （工具调用坏包的修复路径另存：命中报错|截断|重发|超时|调用失败等词时由 Order 160 段逐字拼回。）",
  },
  // v0.39 决策：Boundary rule 整节保持常驻（874 B）—— 立场句必须无条件在场，不能挂在触发词命中率上；
  // 邻接件的细化条文改以额外段落形式挂在 L_pressure 的 @@end 之后（splitter 的 extras 通道）。
];

const SECTION_RE = /^(SUPREME|Output contract|Task classes|Named coverage|Toolchain rule|Environment rule|Tool-call rule|Task-list rule|Language rule|Calibration rule|Scoring interface|Dispatch rule|Zero-residue rule|Long-range rule|Pressure rule|Metacognition rule|Anti-suggestion rule|Upstream-shape rule|Eval-discipline rule|Boundary rule|Format examples)/;

if (restore) {
  if (!existsSync(FULL)) { console.error("✗ 没有 infinite-gen-5.full.md，无法还原"); process.exit(1); }
  copyFileSync(FULL, CORE);
  console.log("✓ 已用 infinite-gen-5.full.md 还原常驻内核");
  process.exit(0);
}

const coreNow = readFileSync(CORE, "utf8");
let lines = coreNow.split("\n");
// --from-core：常驻内核里的惰性单元已退化为指针行，先按当前惰性库把它们还原成完整正文当作切分源。
// （full.md 是旧快照，不参与；这里的 original 只用于「正文连续片段」校验与 FULL 快照。）
let original = coreNow;
if (fromCore && existsSync(LAZY)) {
  const lib = readFileSync(LAZY, "utf8");
  // 提取每个单元在库里的正文（含 @@end 之后的自有增量）
  const bodies = new Map();
  for (const m of lib.matchAll(/^@@unit:([^|\n]+)[^\n]*\n([\s\S]*?)\n@@end:\1[^\S\n]*$/gm)) bodies.set(m[1], m[2]);
  // 指针行 → 单元 id：整节搬的用生成的「【惰性 id｜digest】…」行，半节搬的用配置里的 pointer 原文
  const pointerMap = new Map();
  for (const [anchor, id, order, triggers, digest] of MOVE_SECTIONS) {
    pointerMap.set(`【惰性 ${id}｜${digest}】全文命中触发词时由 Order 160 段逐字拼回（prompts/infinite-gen-5-lazy.md），未命中就只留这一行。`, id);
  }
  for (const t of MOVE_TAILS) if (t.pointer) pointerMap.set(t.pointer, t.id);
  const src = coreNow.split("\n");
  const out = [];
  let restored = 0;
  for (const line of src) {
    const id = pointerMap.get(line) ?? line.match(/^【惰性 (L_\w+)｜/)?.[1];
    if (id && bodies.has(id)) { out.push(...bodies.get(id).split("\n")); restored++; }
    else out.push(line);
  }
  if (restored !== pointerMap.size) console.log(`· 注意：指针行命中 ${restored}/${pointerMap.size}（缺失的单元正文无法复位）`);
  original = out.join("\n");
  lines = original.split("\n");
  console.log(`· --from-core：按惰性库还原切分源 ${coreNow.length} → ${original.length} 字符（${bodies.size} 个单元在库，复位 ${restored} 处）`);
}
// --from-core：以当前常驻内核为真源重建（full.md 是旧快照，restore 会丢近改动）。
if (existsSync(LAZY) && !force && !dry && !fromCore) {
  console.error("✗ 已经拆过了（prompts/infinite-gen-5-lazy.md 在场）。重拆加 --force，还原用 --restore。");
  process.exit(1);
}
// --from-core：以当前常驻内核为真源重建（full.md 是旧快照，restore 会丢近改动）。
if (existsSync(LAZY) && !force && !dry && !fromCore) {
  console.error("✗ 已经拆过了（prompts/infinite-gen-5-lazy.md 在场）。重拆加 --force，还原用 --restore。");
  process.exit(1);
}
const headOf = (needle) => lines.findIndex((l) => l.startsWith(needle));
const endOf = (s) => {
  for (let i = s + 1; i < lines.length; i++) if (SECTION_RE.test(lines[i])) return i;
  return lines.length;
};
// 从 s 之后找下一个「必须独占一行」的章节起点：用于从章节首行自身起切走整节（Boundary rule 行自己会命中 SECTION_RE）
const endOfNext = (s) => {
  for (let i = s + 1; i < lines.length; i++) if (SECTION_RE.test(lines[i]) && !lines[i - 1].trim()) return i;
  return lines.length;
};
// 从 s 之后找首个以 marker 起头的行（终点专用，不含 s 自身）
const endAtOf = (s, marker) => {
  for (let i = s + 1; i < lines.length; i++) if (lines[i].startsWith(marker)) return i;
  return -1;
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
  let end;
  if (t.endOfNext) end = endOfNext(s);
  else if (t.endAt && t.endAt !== "(none)") {
    end = endAtOf(s, t.endAt);
    if (end < 0) { console.error(`✗ ${t.anchor} 找不到终点 ${t.endAt}`); process.exit(1); }
  } else end = endOf(s);
  let cutStart;
  if (t.mode === "afterAnchor") cutStart = s + 1;
  else {
    cutStart = lines.findIndex((l, i) => (t.anywhere ? true : (i >= s && i < end)) && l.startsWith(t.fromLine));
    if (cutStart < 0) { console.error(`✗ ${t.anchor} 找不到切点 ${t.fromLine}`); process.exit(1); }
    if (!t.anywhere && cutStart >= end) { console.error(`✗ ${t.anchor} 切点 ${t.fromLine} 落在章节之外`); process.exit(1); }
  }
  ops.push({ ...t, start: s, end, cutStart, whole: false, anywhere: !!t.anywhere });
}
// 同一章节可挂多个切点（半节搬），故排序要带上 cutStart，否则切片顺序不稳
ops.sort((a, b) => a.start - b.start || a.cutStart - b.cutStart || a.order - b.order);
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
// v0.39：重拆时保留各单元「@@end 之后」的手写增量（新条款只追加在这里，正文仍逐字来自常驻内核）
const extras = new Map();
if (existsSync(LAZY) && fromCore) {
  const old = readFileSync(LAZY, "utf8");
  for (const m of old.matchAll(/^@@unit:([^|\n]+)[^\n]*\n([\s\S]*?)\n@@end:\1\n?([\s\S]*?)(?=^@@unit:|$(?![\s\S]))/gm)) {
    const add = (m[3] ?? "").trim();
    if (add) extras.set(m[1], add);
  }
  if (extras.size) console.log(`· 保留 ${extras.size} 个单元的自有增量：${[...extras].map(([k, v]) => `${k}(+${v.length}字符)`).join(" · ")}`);
}
const lazyText = [
  "# 惰性章节库 — Order 160 按需拼回（正文逐字取自常驻内核，勿手改措辞；本单元的增量写在 @@end 之后）",
  "",
  ...units.slice().sort((a, b) => a.order - b.order)
    .map((u) => {
      const add = extras.get(u.id);
      // v0.39.0 修：正文与增量在写盘前统一去掉首尾空行，否则每次 --from-core 重拆都会
      // 在 @@end 前累积一个空行（实测第二次重拆 lazy 增长 7 行 → 幂等性破裂）
      const body = u.text.replace(/^\n+|\n+$/g, "");
      return `@@unit:${u.id}|order:${u.order}|anchor:${u.anchor}|triggers:${u.triggers}\n${body}${add ? "\n" + add : ""}\n@@end:${u.id}`;
    }),
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
if (fromCore && !unlock) { console.error("✗ --from-core 写盘需要显式 --unlock（当前常驻内核将被原地重建）"); process.exit(1); }
const coreBackup = coreText === original && fromCore ? null : BAK; // 以常驻为真源重建时，BAK 不作为回滚依据
if (coreBackup && !existsSync(coreBackup)) copyFileSync(CORE, coreBackup);
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
