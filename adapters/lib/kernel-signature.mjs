// 无限五代 · 内核签名（Kernel Signature）
//
// 为什么要单独一份签名：版本号是**漂移源**。内核正文里写过「无限五代 · 运行时锚点 R#1848」，
// 这个 R# 每轮注入都会变（节拍器），把它的原始字节算进指纹，等于每轮都判「内核变了」。
// 所以签名分两段：
//   semantic  —— 抹掉易变标记后的正文哈希，用于兼容层判定「宿主里那份是不是同源载荷」
//   volatility —— 记录被抹掉的标记种类与数量，只用于解释「为什么两份正文不同」
//
// 判据（verify_adapters.mjs 会断言）：
//   1) 抹除只发生在标记行上，正文字节只允许在这些行内被替换；
//   2) 抹除后 semantic 指纹对同一版内核稳定，对任一语义改动敏感。

import { createHash } from "node:crypto";

// 易变标记：注入轮次号 / 会话 id / 时间戳 / 运行时进程号。
// 这些值由宿主每轮生成，不是内核语义的一部分。
export const VOLATILE_PATTERNS = Object.freeze([
  { id: "beat", re: /R#\d+/g, note: "注入节拍序号（宿主每轮递增）" },
  { id: "session", re: /\bpfa-[0-9a-f]{8,}\b/g, note: "会话 id（宿主生成）" },
  { id: "isoDate", re: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, note: "ISO 时间戳" },
  { id: "epochMs", re: /\b1[6-9]\d{11}\b/g, note: "毫秒时间戳" },
]);

/** 抹掉易变标记，返回规范化正文与抹除统计。 */
export function normalizeKernel(text) {
  let out = text;
  const hits = [];
  for (const { id, re } of VOLATILE_PATTERNS) {
    const found = out.match(re);
    if (!found) continue;
    hits.push({ id, count: found.length });
    out = out.replace(re, (m) => `\u0000${id}\u0000`.padEnd(m.length, "·"));
  }
  return { text: out, volatility: hits };
}

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * 计算内核签名。
 * @param {{primary:string, lazy:string, full?:string}} sources 三份盘上真源正文
 */
export function kernelSignature(sources) {
  const primary = normalizeKernel(sources.primary);
  const lazy = normalizeKernel(sources.lazy);
  const full = sources.full ? normalizeKernel(sources.full) : null;
  const units = parseSelfChecks(sources.primary);
  return Object.freeze({
    version: 1,
    primarySha256: sha256(sources.primary),
    primarySemanticSha256: sha256(primary.text),
    lazySha256: sha256(sources.lazy),
    lazySemanticSha256: sha256(lazy.text),
    fullSemanticSha256: full ? sha256(full.text) : null,
    semanticSha256: sha256(`${primary.text}\u0001${lazy.text}\u0001${full ? full.text : ""}`),
    volatility: { primary: primary.volatility, lazy: lazy.volatility },
    selfChecks: units,
    bytes: {
      primary: Buffer.byteLength(sources.primary, "utf8"),
      lazy: Buffer.byteLength(sources.lazy, "utf8"),
      full: sources.full ? Buffer.byteLength(sources.full, "utf8") : 0,
    },
  });
}

// 内核里的惰性指针行有两种形态（真源随 unit 数量增长后两种并存，勿只认一种）：
//   ① 独占一行：`【惰性 L_x｜摘要】`
//   ② 嵌在正文括号里：`（惰性 L_x：摘要）`
// 两种都必须在惰性章节文件里找到同名 unit，否则「命中才装载」的整条链路会在
// 运行期静默失效 —— 这一条正是历史事故点（v0.45 真源增到 14 条 unit 时漏认形态②）。
const POINTER_RES = [
  /^【惰性\s+(L_[A-Za-z0-9_]+)｜/gm,
  /（惰性\s+(L_[A-Za-z0-9_]+)[:：]/g,
];

export function parseSelfChecks(primaryText) {
  const pointers = new Set();
  for (const re of POINTER_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(primaryText)) !== null) pointers.add(m[1]);
  }
  return [...pointers].sort();
}

/**
 * 校验内核与惰性章节是否自洽：
 *  - 每条常驻指针都要有对应的惰性 unit；
 *  - 每个惰性 unit 的 order 必须唯一（重复 order 会让装载顺序不确定）。
 */
export function checkKernelIntegrity(primaryText, lazyText) {
  const problems = [];
  const units = [...lazyText.matchAll(/^@@unit:([A-Za-z0-9_]+)\|order:(\d+)\|anchor:([^|\n]+)\|triggers:([^\n]+)\n([\s\S]*?)\n@@end:\1$/gm)]
    .map(([, id, order, anchor, triggers, body]) => ({
      id,
      order: Number(order),
      anchor: anchor.trim(),
      triggers: triggers.split("|").map((t) => t.trim()).filter(Boolean),
      bytes: Buffer.byteLength(body, "utf8"),
    }));

  const seen = new Map();
  for (const unit of units) {
    if (seen.has(unit.order)) problems.push(`order 重复：${unit.order}（${seen.get(unit.order)} / ${unit.id}）`);
    seen.set(unit.order, unit.id);
    if (!unit.triggers.length) problems.push(`${unit.id} 没有触发词，永远装不上`);
  }
  const ids = new Set(units.map((u) => u.id));
  const pointers = parseSelfChecks(primaryText);
  for (const pointer of pointers) {
    if (!ids.has(pointer)) problems.push(`常驻指针 ${pointer} 在惰性章节文件里没有对应 unit`);
  }
  // 反向也要查：unit 存在但常驻里没有指针 → 这条惰性规则永远不会被触发（静默失效）。
  // 全量档（full/lazy 合体交付）允许没有指针，所以只报「孤儿」不算问题，单独统计。
  const orphanUnits = units.filter((u) => !pointers.includes(u.id)).map((u) => u.id);
  for (const unit of units) {
    if (unit.bytes < 200) problems.push(`${unit.id} 只有 ${unit.bytes} B，疑似被截断`);
  }
  return { problems, units, pointers, orphanUnits };
}

/** 同源判定：宿主里那份载荷和本项目这份是不是同一份内核（去重 / 让位用）。 */
export function sameKernel(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const na = normalizeKernel(a).text;
  const nb = normalizeKernel(b).text;
  if (na === nb) return true;
  // 前缀同源：宿主里可能是同一内核的旧版本（多出一段历史锚点）
  const shortLen = Math.min(na.length, nb.length);
  if (shortLen < 1500) return false;
  return na.slice(0, 1500) === nb.slice(0, 1500);
}
