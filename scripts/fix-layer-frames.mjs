#!/usr/bin/env node
/**
 * 无限五代 · 层帧触发词去重与 description 断句修复（v0.52.1）
 *
 * 起因：16 层帧的 whenToUse 是手工累加出来的，跑一遍全树发现 8 层带重复触发词
 * （最狠的 ig5-layer-13-crypto：`DRM · PKI · HSM` 连写三遍），另有 ig5-layer-04b
 * 的 description 被逗号截断成「在一台陌生/残缺的 Linux 主机上， 层：命中 whenToUse 触发词即装载」。
 * 这两样都会被宿主每轮当作技能目录（name + description）发给模型，重复词直接占宽度。
 *
 * 用法：
 *   node scripts/fix-layer-frames.mjs            # dry-run：只报要改什么
 *   node scripts/fix-layer-frames.mjs --apply    # 真写盘（逐文件只换 frontmatter 两行）
 *   node scripts/fix-layer-frames.mjs --check    # 门禁：仍有重复词或断句不合规则退出码 1
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "skills");
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const CHECK = argv.includes("--check");
const MAX_TRIGGERS = 12;

/**
 * 触发词去重：按 · 或 / 切，trim，丢空；后出现的词若已被前面的词包含就丢掉
 * （「Codex」被前面的「Codex 技能」包含、「Linux」被散文里的「残缺的 Linux 主机」包含），保序、留上限。
 */
export function dedupeTriggers(line) {
  const out = [];
  for (const raw of String(line).split(/[·/]/)) {
    const t = raw.trim();
    if (!t) continue;
    if (out.some((p) => p.includes(t))) continue;
    out.push(t);
    if (out.length >= MAX_TRIGGERS) break;
  }
  return out;
}

/**
 * 规范化 whenToUse：这批帧的病因是「/ → ·」替换跑过了整行（也吃掉了收尾的 「 与“或出现”），
 * 于是句子断在半空、尾部再挂一遍重复词。两种形态分别重建，唯一词一个不丢。
 * 已成句且带英文串的（ig5-layer-01）不动 —— 那一行是 verify:gen5 的断言对象。
 */
export function normalizeWhenToUse(line) {
  if (/英文串/.test(line)) return line;
  const s = String(line).trim();
  const isProse = /[，。；]/.test(s) && !/^任务涉及|「/.test(s);
  if (!isProse) {
    const body = s.replace(/^任务涉及\s*/, "").replace(/「/g, "").replace(/」[\s\S]*$/, "").replace(/等场景词[\s\S]*$/, "");
    return `任务涉及「${dedupeTriggers(body).join(" · ")}」时装载`;
  }
  // 散文式：还原被替换坏的分隔符，并丢掉尾部与散文重复的词
  const head = dedupeTriggers(s).join(" / ");
  return head.replace(/\s*\/\s*$/, "");
}

/** 该行是否需要规范化：有被包含的重复词，或「」不闭合，或以分隔符收尾。 */
export function needsWhenFix(line) {
  if (line === null || /英文串/.test(line)) return false;
  const unbalanced = (line.match(/「/g) || []).length !== (line.match(/」/g) || []).length;
  const parts = String(line).split(/[·/]/).map((t) => t.trim()).filter(Boolean);
  const dup = parts.some((t, i) => parts.slice(0, i).some((p) => p.includes(t)));
  return unbalanced || dup || /[·/]\s*$/.test(String(line));
}

/** description 断句修复：把「……， 层：」这种被逗号截断的拼接缝补成完整短语。 */
export function fixDescription(line) {
  return String(line)
    .replace(/\s*，\s*层：/g, " 层：")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function frameLine(text, key) {
  const m = new RegExp(`^${key}: (.*)$`, "m").exec(text);
  return m ? m[1] : null;
}

function main() {
  if (!existsSync(SRC)) throw new Error(`没有源目录：${SRC}`);
  const dirs = readdirSync(SRC, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("ig5-layer-"));
  const rows = [];
  for (const d of dirs) {
    const file = join(SRC, d.name, "SKILL.md");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const when = frameLine(text, "whenToUse");
    const desc = frameLine(text, "description");
    const whenFixed = when === null ? null : normalizeWhenToUse(when);
    const descFixed = desc === null ? null : fixDescription(desc);
    const whenChanged = when !== null && needsWhenFix(when);
    const descChanged = desc !== null && descFixed !== desc;
    rows.push({ dir: d.name, file, text, when, whenFixed, desc, descFixed, whenChanged, descChanged });
  }

  const changed = rows.filter((r) => r.whenChanged || r.descChanged);
  console.log(`扫描 ${rows.length} 层：触发词需去重 ${rows.filter((r) => r.whenChanged).length} 层 · description 需修 ${rows.filter((r) => r.descChanged).length} 层\n`);
  for (const r of changed) {
    console.log(`- ${r.dir}`);
    if (r.whenChanged) {
      const dups = r.when.split("·").map((s) => s.trim()).filter((t, i, a) => t && a.indexOf(t) !== i);
      console.log(`    whenToUse：去掉重复 [${[...new Set(dups)].join(", ")}]`);
      console.log(`      → ${r.whenFixed}`);
    }
    if (r.descChanged) console.log(`    description → ${r.descFixed}`);
  }

  if (CHECK) {
    const bad = rows.filter((r) => r.whenChanged || r.descChanged);
    console.log(`\n层帧规范检查：${bad.length === 0 ? "通过" : `失败（${bad.length} 层待修）`}`);
    process.exit(bad.length === 0 ? 0 : 1);
  }

  if (!APPLY) {
    console.log("\n（dry-run，未写盘；加 --apply 执行）");
    return;
  }

  for (const r of changed) {
    let next = r.text;
    if (r.whenChanged) next = next.replace(/^whenToUse: .*$/m, `whenToUse: ${r.whenFixed}`);
    if (r.descChanged) next = next.replace(/^description: .*$/m, `description: ${r.descFixed}`);
    writeFileSync(r.file, next);
  }
  console.log(`\n已写盘：${changed.length} 层 → ${SRC}`);
  console.log("下一步：node scripts/ig5-install-layers.mjs --root <宿主技能根> --force --apply");
}

main();
