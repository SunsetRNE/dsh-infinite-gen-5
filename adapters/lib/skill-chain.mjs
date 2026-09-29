#!/usr/bin/env node
// 思维链分层：把常驻内核拆成「常驻思维链（T0）+ 技能档（T1）」，按需再挂惰性章节（T2）。
//
// 为什么要拆：常驻内核每轮都在付 token，而其中相当一部分是「解释性正文」，只在
// 特定任务形态下才用得上。拆出去放进 DSH 的技能目录，会话开始时按需 skill 装载。
//
// 宿主事实（本次实测，非推测）：
// - 技能发现深度为一层：`<root>/<name>/SKILL.md` 或 `<root>/<name>.md`
//   （@deepseek-ai/dsh-skill-filesystem/lib/index.js:550-556、:110）
// - 前置元数据 YAML：name（kebab-case，必填）+ description（必填），可选 whenToUse
//   （同上 :36）
// - 扫描根（同上 lib/index.js:154-181）：<projectRoot>/.dsh/skills、<projectRoot>/.agents/skills、
//   <dshHome>/skills、<agentsHome>/skills，外加自定义目录与随包目录
// - **硬上限**：工具结果超过 thresholdChars 会被裁剪
//   （@deepseek-ai/dsh-compaction-tool-result-pruner/lib/index.js:11 thresholdChars = 8192）
//   → 任何一份 SKILL.md 渲染后必须 < 8192 字符，否则装载即被截断，等于没装。

import { createHash } from "node:crypto";

export const SKILL_BUDGET_CHARS = 8192; // 见文件头 provenance：pruner thresholdChars
export const SKILL_SAFE_CHARS = 7600; // 留 7% 余量给渲染包装与标题

export const SKILL_ROOTS = [
  "<projectRoot>/.dsh/skills",
  "<projectRoot>/.agents/skills",
  "<dshHome>/skills",
  "<agentsHome>/skills",
];

// 不可降级核：这些断言无论预算多紧都必须留在常驻思维链里。
// 依据是「装不上就等于失效」——技能档要靠模型主动调用，调用失败时兜底只有常驻正文。
export const NON_DEROGABLE = [
  { id: "first-line", label: "首行命名交付物", pattern: /首行/, why: "输出契约的入口，缺失则整份交付被判不合格" },
  { id: "four-state", label: "四态校准", pattern: /四态/, why: "已知/推测/未知/过期 是防编造的唯一闸门" },
  { id: "boundary", label: "边界层立场", pattern: /边界层/, why: "边界只在常驻里说一次，不随技能装载漂移" },
  { id: "verify-line", label: "验证行判据", pattern: /验证行/, why: "可执行交付的验收条件" },
  { id: "no-hedge", label: "禁句与零残留", pattern: /零残留|禁句/, why: "禁句族的约束必须在场才生效" },
  // 内核中英混排，锚点必须两种写法都认，否则中文锚点会被误判为「不在常驻」。
  { id: "tool-call", label: "工具调用与坏包重发", pattern: /坏包|工具调用|Tool-call rule|arguments must survive/, why: "调用纪律是运行期错误的第一道闸" },
];

export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** 按空行切块，保留每块的首行摘要用于人读与判据锚定。 */
export function splitBlocks(text) {
  const raw = String(text ?? "").split(/\n{2,}/);
  const blocks = [];
  raw.forEach((chunk, i) => {
    const t = chunk.replace(/\s+$/, "");
    if (!t.trim()) return;
    const head = t.split("\n")[0].slice(0, 60);
    blocks.push({ index: blocks.length, source: i, text: t, bytes: Buffer.byteLength(t, "utf8"), chars: t.length, head });
  });
  return blocks;
}

// 治理条款：无论语言、无论长短，一律常驻。判定用「块首标题」而非正文关键词，
// 因为中英混排的内核会把同一条规则写成两块（英文条目 + 中文复述），按关键词判会拆散它们。
export const GOVERNANCE_HEADS = [
  /^\[MODE:/,
  /^SUPREME DIRECTIVE/,
  /^Output contract:/,
  /^Task-list rule/,
  /^Tool-call rule/,
  /^Toolchain rule/,
  /^Environment rule/,
  /^Language rule/,
  /^Calibration rule/,
  /^Scoring interface/,
  /^Zero-residue rule/,
  /^Boundary rule/,
  /^Task classes/,
  /^交付前四查/,
  /^【惰性/,
];

/** 判定一块属于常驻还是可外移：命中不可降级锚点或治理条款即常驻。 */
export function classifyBlock(block) {
  const hits = NON_DEROGABLE.filter((n) => n.pattern.test(block.text)).map((n) => n.id);
  const gov = GOVERNANCE_HEADS.find((p) => p.test(block.head));
  if (gov) return { tier: "resident", hits, reason: `治理条款 ${gov}` };
  if (hits.length) return { tier: "resident", hits, reason: "命中不可降级锚点" };
  if (block.bytes < 300) return { tier: "resident", hits: [], reason: "短块，外移不划算" };
  return { tier: "movable", hits: [], reason: "解释性正文，可按需装载" };
}

/** 把可外移块打包成技能档，每档渲染后必须 < SKILL_BUDGET_CHARS。
 *  软目标 targetChars 决定一档装多少：档越小、装载时命中越准（只付用到的那部分），
 *  档越大、装载调用越少。硬上限仍由 budgetChars 守着。 */
export function packBundles(blocks, { budgetChars = SKILL_SAFE_CHARS, targetChars = 3000 } = {}) {
  const packAt = Math.min(targetChars, budgetChars);
  const bundles = [];
  let cur = { id: null, blocks: [], chars: 0 };
  for (const b of blocks) {
    // 单块就超预算 → 独占一档并标记，交给上层裁剪或再切
    if (b.chars > budgetChars) {
      if (cur.blocks.length) bundles.push(cur), (cur = { id: null, blocks: [], chars: 0 });
      bundles.push({ id: null, blocks: [b], chars: b.chars, oversized: true });
      continue;
    }
    if (cur.chars + b.chars + 2 > packAt && cur.blocks.length) {
      bundles.push(cur);
      cur = { id: null, blocks: [], chars: 0 };
    }
    cur.blocks.push(b);
    cur.chars += b.chars + 2;
  }
  if (cur.blocks.length) bundles.push(cur);
  return bundles.map((b, i) => {
    const body = b.blocks.map((x) => x.text).join("\n\n");
    return {
      id: `ig5-layer-${String(i + 1).padStart(2, "0")}`,
      blocks: b.blocks.map((x) => ({ index: x.index, head: x.head, bytes: x.bytes })),
      body,
      chars: body.length,
      bytes: Buffer.byteLength(body, "utf8"),
      oversized: Boolean(b.oversized),
    };
  });
}

/** 渲染成 DSH 技能文件：YAML 前置元数据 + 正文。 */
export function renderSkillFile(bundle, { description, whenToUse, title }) {
  const lines = [
    "---",
    `name: ${bundle.id}`,
    `description: ${description ?? "无限五代内核外移层（由 ig5-adapters 编译生成）"}`,
    `whenToUse: ${whenToUse ?? "需要该层的细则时装载"}`,
    "metadata:",
    "  source: ig5-adapters/lib/skill-chain.mjs",
    `  blocks: ${bundle.blocks.length}`,
    `  chars: ${bundle.chars}`,
    "---",
    "",
    `# ${title ?? bundle.id}`,
    "",
    bundle.body,
    "",
  ];
  return lines.join("\n");
}

/**
 * 渲染常驻思维链：T0 正文 + 一条「装载链」。
 * 每个环节都写成「触发条件 → 动作 → 依据」，缺触发条件的环节等于永不执行。
 */
export function renderChain({ residentBlocks, bundles, units = [], head }) {
  const out = [];
  if (head) out.push(head.trim(), "");
  out.push("## 常驻正文", "");
  out.push(residentBlocks.map((b) => b.text).join("\n\n"), "");
  out.push("## 装载链（按顺序判断，命中即装载）", "");
  bundles.forEach((b, i) => {
    out.push(
      `${i + 1}. 当 ${b.triggerHint} → 装载技能 \`${b.id}\`（${b.chars} 字符 / ${b.blocks.length} 块）`,
    );
  });
  if (units.length) {
    out.push(
      `${bundles.length + 1}. 当任务命中某个领域的触发词 → 先查领域索引，再按需展开惰性章节（${units.length} 条 unit，order ${units
        .map((u) => u.order)
        .join("/")}）`,
    );
  }
  out.push("");
  out.push("装载失败（技能不可用/被裁剪）时按常驻正文执行，并在正文里记一行「技能档未装载：<id>」。", "");
  return out.join("\n");
}

/** 为每个技能档生成一句触发条件：取该档里最长块的首行作为语义指纹。 */
function triggerHintOf(bundle) {
  const b = [...bundle.blocks].sort((x, y) => y.bytes - x.bytes)[0];
  const h = (b?.head ?? "").replace(/^[-#>\s*]+/, "").slice(0, 40);
  return h ? `任务涉及「${h}」` : "任务需要该层细则";
}

/** 主入口：算出分层方案与字节账。 */
export function buildSkillChain({ kernelText, units = [], header = "" }) {
  const blocks = splitBlocks(kernelText);
  const classified = blocks.map((b) => ({ ...b, ...classifyBlock(b) }));
  const residentBlocks = classified.filter((b) => b.tier === "resident");
  const movable = classified.filter((b) => b.tier === "movable");
  const bundles = packBundles(movable).map((b) => ({ ...b, triggerHint: triggerHintOf(b) }));

  const chain = renderChain({ residentBlocks, bundles, units, head: header });
  const problems = [];
  for (const b of bundles) {
    if (b.oversized || b.chars >= SKILL_BUDGET_CHARS) {
      problems.push(`技能档 ${b.id} 渲染 ${b.chars} 字符，超过宿主裁剪上限 ${SKILL_BUDGET_CHARS}`);
    }
  }
  const residentText = residentBlocks.map((b) => b.text).join("\n\n");
  for (const n of NON_DEROGABLE) {
    if (!n.pattern.test(residentText)) problems.push(`不可降级锚点 ${n.id}（${n.label}）不在常驻正文里`);
  }

  return {
    blocks: classified.length,
    resident: {
      blocks: residentBlocks.length,
      bytes: Buffer.byteLength(residentText, "utf8"),
      chars: residentText.length,
      anchors: NON_DEROGABLE.filter((n) => n.pattern.test(residentText)).map((n) => n.id),
    },
    moved: {
      blocks: movable.length,
      bytes: movable.reduce((s, b) => s + b.bytes, 0),
      bundles: bundles.length,
    },
    chain,
    chainBytes: Buffer.byteLength(chain, "utf8"),
    chainSha256: sha256(chain),
    // 保留 body：调用方要拿它渲染 SKILL.md 落盘；只给 sha256 是上一版的真 bug（写文件时正文为空）
    bundles: bundles.map((b) => ({ ...b, bodySha256: sha256(b.body) })),
    problems,
  };
}

export default { buildSkillChain, SKILL_BUDGET_CHARS, SKILL_ROOTS, NON_DEROGABLE };
