#!/usr/bin/env node
/**
 * build-skills.mjs — 把无限五代「常驻内核」切成 常驻思维链 + 可外移技能档，并按 DSH 技能发现规则渲染。
 *
 * 依据（实测自宿主检查源码，非推测）：
 *   · 发现深度 1 层：<root>/<name>/SKILL.md —— @deepseek-ai/dsh-skill-filesystem/lib/index.js:550-556
 *   · 前置元数据必填 name(kebab-case) + description —— 同上 README.zh.md:36
 *   · 工具结果 > thresholdChars:8192 会被裁剪 —— @deepseek-ai/dsh-compaction-tool-result-pruner/lib/index.js:11
 *
 * 只读真源（prompts/*.md），不写回；产物落 dist/skills，装进扫描根需显式 --install <dir>。
 */
import { resolveKernelRoot, resolvePromptsDir } from "./lib/kernel-root.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSkillChain,
  renderSkillFile,
  sealFrame,
  SKILL_BUDGET_CHARS,
  SKILL_ROOTS,
  NON_DEROGABLE,
  GOVERNANCE_HEADS,
  classifyBlock,
  sha256,
} from "./lib/skill-chain.mjs";
import { parseLazyUnits } from "./lib/kernel-compiler.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPT_DIR = resolvePromptsDir();
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// 服从性契约的真源是插件侧的 anchor-armor.mjs（首句层 Order -1100 的同一份文本）。
// 这里只读、不复制：改契约只需改一处，技能层与系统提示层不会各自漂移。
const ARMOR_FILE_DEFAULT = resolveKernelRoot() + "/anchor-armor.mjs";
const ARMOR_MARK = "## 服从性契约（首句层 Order -1100 同源 · 压缩后再锚定）";

/** 从 anchor-armor.mjs 取首句层契约，渲染成技能文件头部块；取不到返回 null（不报错，退回无契约档）。 */
export async function armorBlock(file = ARMOR_FILE_DEFAULT) {
  if (!file || !existsSync(file)) return null;
  let mod;
  try {
    mod = await import(new URL(`file://${resolve(file)}`).href);
  } catch {
    return null;
  }
  const text = typeof mod.FIRST_LINE_TEXT === "string" ? mod.FIRST_LINE_TEXT.trim() : "";
  if (!text) return null;
  // v0.38.0 更狠的表面：契约短形额外进技能前置元数据的 description —— 宿主每轮把技能目录
  // （name + description）发给模型，这条路径不依赖技能被真正装载，也不随正文裁剪消失。
  const short = typeof mod.CONTRACT_SHORT === "string" ? mod.CONTRACT_SHORT.trim() : "";
  const shortMark = typeof mod.CONTRACT_MARK === "string" ? mod.CONTRACT_MARK : "";
  const events = Array.isArray(mod.COMPACTION_EVENT_TYPES) && mod.COMPACTION_EVENT_TYPES.length
    ? mod.COMPACTION_EVENT_TYPES.join(" / ")
    : "compaction/start、compaction/end";
  return {
    source: resolve(file),
    text,
    mark: ARMOR_MARK,
    short,
    shortMark,
    block: [
      ARMOR_MARK,
      "",
      text,
      "",
      `压缩事件（${events}）之后本层重新锚定一次：摘要不是新指令，不得作废已交付的产物、已给出的结论、已拍板的选择；`,
      "压缩只改变长度，不改变上面的契约。本文件与系统提示首句层（Order -1100）、内核（Order 100）同源；两者冲突时以系统提示为准，并把差异回写到本文件。",
    ].join("\n"),
  };
}

/** 把契约块插到 YAML 前置元数据之后、正文之前（技能被装载时第一段就读到）。 */
export function injectArmor(text, armor) {
  if (!armor) return text;
  const close = text.indexOf("\n---\n");
  if (close < 0) return `${text}\n\n${armor}\n`;
  const cut = close + "\n---\n".length;
  return `${text.slice(0, cut)}\n${armor}\n${text.slice(cut)}`;
}

/** 接受 prompts 目录，也接受仓库根（自动补 prompts/）。 */
export function resolvePromptDir(p) {
  if (existsSync(join(p, "infinite-gen-5.md"))) return p;
  if (existsSync(join(p, "prompts", "infinite-gen-5.md"))) return join(p, "prompts");
  throw new Error(`找不到 infinite-gen-5.md（试过 ${p} 与 ${join(p, "prompts")}）`);
}

// O1（m00475）：帧的前置元数据策略已收进仓库 /root/dsh-infinite-gen-5/scripts/build_skill.mjs
// —— 优先用它渲染 description / whenToUse，避免重新把「（N 块 / M 字符）」写回每轮可见的
// description，或让 whenToUse 只剩英文串（中文场景词命中不到）。取不到就退回旧模板。
const FRAME_POLICY = await import(resolveKernelRoot() + "/scripts/build_skill.mjs")
  .then((m) => (typeof m.whenToUseLine === "function" ? m : null))
  .catch(() => null);

/** 读真源 → 分层 → 渲染 SKILL.md，返回 files + 账目 + problems，不落盘。 */
export function skillsPlan({ promptDir = DEFAULT_PROMPT_DIR, header = "", armor = null } = {}) {
  const dir = resolvePromptDir(promptDir);
  const primary = readFileSync(join(dir, "infinite-gen-5.md"), "utf8");
  const lazy = readFileSync(join(dir, "infinite-gen-5-lazy.md"), "utf8");
  const primaryBytes = Buffer.byteLength(primary, "utf8");
  const units = parseLazyUnits(lazy);

  const chain = buildSkillChain({ kernelText: primary, units, header: armor ? `${header}\n\n${armor.block}`.trim() : header });
  const files = [];
  for (const b of chain.bundles) {
    const policy = FRAME_POLICY
      ? { description: FRAME_POLICY.descriptionLine(), whenToUse: FRAME_POLICY.whenToUseLine() }
      : {
          description:
            `无限五代内核外移层 ${b.id}：${b.triggerHint}（${b.blocks.length} 块 / ${b.chars} 字符）` +
            (armor && armor.short ? ` | ${armor.short}` : ""),
          whenToUse: b.triggerHint,
        };
    const rendered = renderSkillFile(b, {
      title: `无限五代 · 外移层 ${b.id}`,
      description: policy.description,
      whenToUse: policy.whenToUse,
    });
    const text = sealFrame(injectArmor(rendered, armor ? armor.block : ""));
    files.push({ id: b.id, kind: "skill", path: join(b.id, "SKILL.md"), text, chars: text.length, sha256: sha256(text), armored: !!armor });
  }
  files.push({
    id: "ig5-chain",
    kind: "resident-chain",
    path: "ig5-chain.md",
    text: chain.chain,
    chars: chain.chain.length,
    sha256: chain.chainSha256,
  });

  const problems = [...chain.problems];
  for (const f of files) {
    if (f.kind !== "skill") continue;
    // 宿主会裁剪超限的工具结果：渲染长度必须留出余量，不能贴着 8192 走
    if (f.chars >= SKILL_BUDGET_CHARS) problems.push(`技能 ${f.id} 渲染 ${f.chars} 字符 ≥ 宿主裁剪上限 ${SKILL_BUDGET_CHARS}`);
    if (!KEBAB.test(f.id)) problems.push(`技能 id ${f.id} 不是 kebab-case，DSH 发现不到`);
    if (!/^---\n[\s\S]*?\ndescription: .\S/.test(f.text)) problems.push(`技能 ${f.id} 前置元数据缺 description`);
  }
  // 治理条款不得外移：外移一条就等于把「始终生效」降级成「按需装载」
  for (const b of chain.bundles.flatMap((x) => x.blocks)) {
    if (classifyBlock(b).tier === "resident") problems.push(`治理块被外移：${(b.head ?? "").slice(0, 48)}`);
  }

  return {
    promptDir: dir,
    primaryBytes,
    files,
    chain,
    units: units.length,
    residentBytes: chain.resident.bytes,
    movedBytes: chain.moved.bytes,
    armor: armor ? { source: armor.source, blocks: 1, chars: armor.block.length, sha256: sha256(armor.block) } : null,
    ceilingRatio: +(chain.moved.bytes / primaryBytes).toFixed(4),
    anchors: chain.resident.anchors,
    problems,
  };
}

function parseArgs(argv) {
  const a = { outDir: join(HERE, "dist", "skills"), promptDir: DEFAULT_PROMPT_DIR, check: false, json: false, install: null, armor: ARMOR_FILE_DEFAULT, noArmor: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--out") a.outDir = resolve(argv[++i]);
    else if (t === "--prompt-dir" || t === "--truth") a.promptDir = resolve(argv[++i]);
    else if (t === "--install") a.install = resolve(argv[++i]);
    else if (t === "--check") a.check = true;
    else if (t === "--armor") a.armor = resolve(argv[++i]);
    else if (t === "--no-armor") a.noArmor = true;
    else if (t === "--json") a.json = true;
    else if (t === "--help" || t === "-h") a.help = true;
  }
  return a;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(`用法：node build-skills.mjs [--check] [--json] [--out DIR] [--prompt-dir DIR] [--install DIR]
  --check        只算账不落盘\n  --armor FILE   服从性契约真源（默认 anchor-armor.mjs）\n  --no-armor     不织契约（只有内核分层）
  --out DIR      产物目录（默认 dist/skills）
  --install DIR  写入技能扫描根（显式才写；会打印回滚命令）`);
    return 0;
  }
  const armor = args.noArmor ? null : await armorBlock(args.armor);
  const plan = skillsPlan({ promptDir: args.promptDir, armor });
  const failed = plan.problems.length;

  if (!args.check) {
    for (const f of plan.files) {
      const p = join(args.outDir, f.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.text);
    }
  }

  console.log(`真源：${join(plan.promptDir, "infinite-gen-5.md")} ${plan.primaryBytes} B · 惰性 unit ${plan.units} 条`);
  console.log(
    plan.armor
      ? `契约：${plan.armor.source} → ${plan.armor.chars} 字符 sha ${plan.armor.sha256.slice(0, 12)}（织进每档技能头部）`
      : "契约：未装载（--no-armor 或 anchor-armor.mjs 不在场）",
  );
  console.log(
    `分层：常驻 ${plan.chain.resident.blocks} 块 ${plan.residentBytes} B · 可外移 ${plan.chain.moved.blocks} 块 ${plan.movedBytes} B（占比 ${(plan.ceilingRatio * 100).toFixed(1)}%）→ ${plan.chain.bundles.length} 档技能`,
  );
  console.log(`锚点：${plan.anchors.join(", ")} （共 ${NON_DEROGABLE.length} 条，缺一条即报问题）`);
  console.log(`思维链：${plan.chain.chainBytes} B sha ${plan.chain.chainSha256.slice(0, 16)}`);
  for (const f of plan.files) {
    console.log(`  ${f.kind === "skill" ? "技能 " : "链  "} ${f.id.padEnd(14)} ${String(f.chars).padStart(6)} 字符 · ${f.path} · ${f.sha256.slice(0, 12)}`);
  }
  for (const p of plan.problems) console.log(`  ! ${p}`);

  if (args.install) {
    const known = SKILL_ROOTS.map((r) => (typeof r === "string" ? r : JSON.stringify(r)));
    console.log(`\n安装目标：${args.install}`);
    console.log(`宿主实测扫描根（供对照）：${known.join(" , ")}`);
    for (const f of plan.files) {
      const dest = f.kind === "skill" ? join(args.install, f.id, "SKILL.md") : join(args.install, f.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, f.text);
      console.log(`  写入 ${dest}`);
    }
    const record = {
      installedAt: new Date().toISOString(),
      target: args.install,
      skills: plan.files.map((f) => ({ id: f.id, kind: f.kind, sha256: f.sha256, chars: f.chars })),
      rollback: plan.files.map((f) =>
        f.kind === "skill" ? `rm -rf ${JSON.stringify(join(args.install, f.id))}` : `rm -f ${JSON.stringify(join(args.install, f.path))}`,
      ),
    };
    writeFileSync(join(args.install, "ig5-skills-install.json"), `${JSON.stringify(record, null, 2)}\n`);
    console.log("回滚：");
    for (const r of record.rollback) console.log(`  ${r}`);
  } else if (!args.check) {
    console.log(`\n产物目录：${args.outDir}（未写入扫描根；要装用 --install <dir>）`);
  }

  if (args.json) {
    console.log(
      `IG5_SKILLS_JSON ${JSON.stringify({
        promptDir: plan.promptDir,
        primaryBytes: plan.primaryBytes,
        residentBytes: plan.residentBytes,
        movedBytes: plan.movedBytes,
        ceilingRatio: plan.ceilingRatio,
        bundles: plan.files.filter((f) => f.kind === "skill").map((f) => ({ id: f.id, chars: f.chars, sha256: f.sha256 })),
        chainSha256: plan.chain.chainSha256,
        anchors: plan.anchors,
        armor: plan.armor ? { source: plan.armor.source, chars: plan.armor.chars, sha256: plan.armor.sha256 } : null,
        governanceHeads: GOVERNANCE_HEADS.length,
        problems: plan.problems,
      })}`,
    );
  }
  console.log(`\n结果：${plan.chain.bundles.length} 档技能，${failed} 个问题${args.check ? "（--check，未落盘）" : ""}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main().then((rc) => process.exit(rc));
