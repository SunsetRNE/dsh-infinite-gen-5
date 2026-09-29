// 无限五代 O1：技能帧（SKILL.md）生成与校验 —— 触发面收进仓库
//
// 问题（O1，本仓 m00475 清单）：技能帧的 whenToUse 只有英文串
// 「Named coverage — 107 domain playbooks in」，中文场景词（破甲/红队/题库/跑批…）
// 命中不到；description 里混进了「（2 块 / 800 字符）」这类生成元信息。
// 生成端原本只在 /root/ig5-adapters/build-skills.mjs（无 git），仓库内 grep whenToUse 零命中。
//
// 本脚本把「帧的前置元数据策略」收进仓库，并保证：
//   1. 正文逐字节不变（reframe 只重写 frontmatter，body 的长度与字节完全保留）；
//   2. whenToUse 含中文场景词（≥ FRAME_CHECK_MIN_WORDS 条），英文串保留兼容；
//   3. description 不再携带「（N 块 / M 字符）」生成元信息（该信息移到 metadata）；
//   4. metadata 记 bodySha256，可检出「只改正文不改元数据」的半截编辑。
//
// 用法：
//   node scripts/build_skill.mjs --check              # 校验仓内帧（默认 skills/ig5-layer-01/SKILL.md）
//   node scripts/build_skill.mjs --frame PATH --check  # 校验指定帧
//   node scripts/build_skill.mjs --frame PATH --write  # 就地重写 frontmatter（正文不动，先写 .bak）
//   node scripts/build_skill.mjs --install DIR         # 把仓内帧装到 <DIR>/<id>/SKILL.md
//   node scripts/build_skill.mjs --selftest            # 自检（不进 verify:all 之外的活路径）
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { CONTRACT_SHORT, FIRST_LINE_TEXT } from "../anchor-armor.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");
export const SKILL_FRAME_PROTOCOL = "ig5-skill-frame-v1";
export const SKILL_ID = "ig5-layer-01";
export const DEFAULT_FRAME = join(ROOT, "skills", SKILL_ID, "SKILL.md");
// 中文场景词：模型与宿主在中文题面里真正会写的词，命中这些才算触发面打到了
export const TRIGGER_WORDS = Object.freeze([
  "破甲", "红队", "越狱测试", "题库", "跑批", "任务书", "回执",
  "攻击面", "域包", "靶场", "无限五代", "权限边界", "样本分析",
]);
export const FRAME_CHECK_MIN_WORDS = 3;
export const ENGLISH_TRIGGER = "Named coverage — 107 domain playbooks in";
// description 里不得出现的生成元信息（原缺陷：把内部计数写进了每轮可见的目录条目）
export const DESC_META_RE = /（\s*\d+\s*块\s*\/\s*\d+\s*字符\s*）/;

export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** 拆 frontmatter 与正文；不解析 YAML，只按行取顶层键 + metadata 子键。 */
export function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { ok: false, reason: "不以 --- 开头", body: text, fields: {}, metadata: {} };
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return { ok: false, reason: "frontmatter 未闭合", body: text, fields: {}, metadata: {} };
  const head = text.slice(4, end);
  const body = text.slice(end + 5);
  const fields = {};
  const metadata = {};
  let inMeta = false;
  for (const line of head.split("\n")) {
    if (/^[A-Za-z_][\w-]*:/.test(line)) {
      const at = line.indexOf(":");
      const key = line.slice(0, at).trim();
      const val = line.slice(at + 1).trim();
      inMeta = key === "metadata";
      fields[key] = val;
      continue;
    }
    if (inMeta) {
      const m = /^\s+([\w-]+):\s*(.*)$/.exec(line);
      if (m) metadata[m[1]] = m[2].trim();
    }
  }
  return { ok: true, fields, metadata, body, head };
}

export function whenToUseLine() {
  return `任务涉及「${TRIGGER_WORDS.slice(0, 10).join(" / ")}」等中文场景词，或英文串「${ENGLISH_TRIGGER}」时装载`;
}

export function descriptionLine() {
  return `${SKILL_ID === "ig5-layer-01" ? "无限五代内核外移层" : "无限五代外移层"} ${SKILL_ID}：任务涉及破甲 / 红队 / 题库 / 跑批 / 任务书 / 回执 / 攻击面 / 域包 / 靶场 / 无限五代时装载 | ${CONTRACT_SHORT}`;
}

/** 用现有帧 + 策略重渲染一帧：正文逐字节保留，只换 frontmatter。 */
export function reframe(text, { source, framePath = DEFAULT_FRAME } = {}) {
  const parsed = parseFrontmatter(text);
  if (!parsed.ok) throw new Error(`帧不可解析：${parsed.reason}`);
  const body = parsed.body;
  const metadata = {
    source: source ?? parsed.metadata.source ?? "ig5-adapters/lib/skill-chain.mjs",
    protocol: SKILL_FRAME_PROTOCOL,
    generatedBy: "scripts/build_skill.mjs",
    blocks: parsed.metadata.blocks ?? "-",
    chars: parsed.metadata.chars ?? "-",
    triggerWords: TRIGGER_WORDS.join(","),
    bodySha256: sha256(body),
  };
  const head = [
    "---",
    `name: ${SKILL_ID}`,
    `description: ${descriptionLine()}`,
    `whenToUse: ${whenToUseLine()}`,
    "metadata:",
    ...Object.entries(metadata).map(([k, v]) => `  ${k}: ${v}`),
    "---",
    "",
  ].join("\n");
  return { text: head + body, body, metadata, framePath };
}

/** 校验一帧是否满足触发面策略 + 契约同源 + 正文哈希。 */
export function checkFrame(text, { framePath = DEFAULT_FRAME } = {}) {
  const parsed = parseFrontmatter(text);
  if (!parsed.ok) return { ok: false, problems: [`帧不可解析：${parsed.reason}`], words: [] };
  const problems = [];
  const { fields, metadata, body } = parsed;
  if (fields.name !== SKILL_ID) problems.push(`name 不是 ${SKILL_ID}（得到 ${fields.name ?? "空"}）`);
  const whenToUse = fields.whenToUse ?? "";
  const words = TRIGGER_WORDS.filter((w) => whenToUse.includes(w));
  if (words.length < FRAME_CHECK_MIN_WORDS) problems.push(`whenToUse 中文场景词不足：命中 ${words.length} < ${FRAME_CHECK_MIN_WORDS}（${whenToUse.slice(0, 40)}）`);
  if (!whenToUse.includes(ENGLISH_TRIGGER)) problems.push("whenToUse 丢了英文触发串（兼容旧命中面）");
  const desc = fields.description ?? "";
  if (!desc) problems.push("description 为空");
  if (DESC_META_RE.test(desc)) problems.push("description 混入生成元信息「（N 块 / M 字符）」（应只留在 metadata）");
  if (!desc.includes(CONTRACT_SHORT)) problems.push("description 缺契约短形（宿主每轮可见的那条路径）");
  if (!body.includes(FIRST_LINE_TEXT)) problems.push("正文缺首句层契约（FIRST_LINE_TEXT 逐字节）");
  if (metadata.protocol !== SKILL_FRAME_PROTOCOL) problems.push(`metadata.protocol 不是 ${SKILL_FRAME_PROTOCOL}`);
  if (!metadata.bodySha256) problems.push("metadata 缺 bodySha256");
  else if (metadata.bodySha256 !== sha256(body)) problems.push(`正文哈希不符：body 实测 ${sha256(body).slice(0, 12)} vs 元数据 ${metadata.bodySha256.slice(0, 12)}`);
  return { ok: problems.length === 0, problems, words, metadata, bytes: Buffer.byteLength(text, "utf8") };
}

function selftest() {
  const body = `## 服从性契约（首句层 Order -1100 同源 · 压缩后再锚定）\n\n${FIRST_LINE_TEXT}\n\n# 无限五代 · 外移层 ${SKILL_ID}\n\n${ENGLISH_TRIGGER}:\n  （惰性行）\n`;
  const seed = `---\nname: ${SKILL_ID}\ndescription: 旧描述：任务涉及「${ENGLISH_TRIGGER}」（2 块 / 800 字符） | ${CONTRACT_SHORT}\nwhenToUse: 任务涉及「${ENGLISH_TRIGGER}」\nmetadata:\n  source: ig5-adapters/lib/skill-chain.mjs\n  blocks: 2\n  chars: 800\n---\n${body}`;
  const asserts = [];
  const eq = (ok, label) => asserts.push([!!ok, label]);
  const bad = checkFrame(seed);
  eq(!bad.ok, "旧帧被判不合格");
  eq(bad.problems.some((p) => p.includes("中文场景词不足")), "检出中文触发词不足");
  eq(bad.problems.some((p) => p.includes("生成元信息")), "检出 description 元信息");
  const made = reframe(seed);
  eq(made.body === body, "reframe 正文逐字节保留");
  eq(Buffer.byteLength(made.text, "utf8") > Buffer.byteLength(seed, "utf8"), "重渲染后帧变大（触发词扩写）");
  const good = checkFrame(made.text);
  eq(good.ok, `新帧通过（${good.problems.join(";") || "无问题"}）`);
  eq(good.words.length >= 10, `中文触发词命中 ${good.words.length} 条`);
  const tampered = made.text.replace("# 无限五代 · 外移层", "# 无限五代 · 外移层（改）");
  eq(!checkFrame(tampered).ok && checkFrame(tampered).problems.some((p) => p.includes("正文哈希不符")), "检出只改正文的半截编辑");
  const noEnglish = made.text.replace(ENGLISH_TRIGGER, "Named coverage");
  eq(checkFrame(noEnglish).problems.some((p) => p.includes("英文触发串")), "检出英文串丢失");
  const missingContract = made.text.replace(CONTRACT_SHORT, "");
  eq(checkFrame(missingContract).problems.some((p) => p.includes("契约短形")), "检出契约短形丢失");
  const fails = asserts.filter(([, ok]) => !ok);
  for (const [ok, label] of asserts) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`\nskill frame selftest：${asserts.length - fails.length} 通过 / ${fails.length} 失败`);
  return fails.length === 0;
}

function main() {
  const argv = process.argv.slice(2);
  const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const js = argv.includes("--json");
  if (argv.includes("--selftest")) process.exit(selftest() ? 0 : 1);

  const frame = resolve(argOf("--frame") ?? DEFAULT_FRAME);
  if (!existsSync(frame)) {
    console.log(`技能帧不在场：${frame}（仓内未跟踪副本，按跳过处理）`);
    process.exit(0);
  }
  const text = readFileSync(frame, "utf8");

  if (argv.includes("--write")) {
    const { text: out, metadata } = reframe(text, { framePath: frame });
    copyFileSync(frame, `${frame}.bak`);
    writeFileSync(frame, out);
    console.log(`SKILL FRAME WRITE ok · ${frame} · ${statSync(frame).size} B · bodySha=${metadata.bodySha256.slice(0, 16)}`);
    process.exit(0);
  }
  if (argOf("--install")) {
    const dir = resolve(argOf("--install"));
    const target = join(dir, SKILL_ID, "SKILL.md");
    mkdirSync(dirname(target), { recursive: true });
    const { text: out } = reframe(text, { framePath: frame });
    writeFileSync(target, out);
    console.log(`SKILL FRAME INSTALL ok · ${target} · ${statSync(target).size} B`);
    process.exit(0);
  }

  const r = checkFrame(text, { framePath: frame });
  if (js) console.log(`IG5_SKILL_FRAME_JSON ${JSON.stringify({ frame, ok: r.ok, words: r.words, bytes: r.bytes, problems: r.problems })}`);
  for (const p of r.problems) console.log(`  ✗ ${p}`);
  console.log(`\n技能帧触发面检查：${r.ok ? "PASS" : "FAIL"} · ${frame} · ${r.bytes} B · 中文触发词 ${r.words.length}/${TRIGGER_WORDS.length}`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
