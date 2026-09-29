// lib/dynamic-adapt.mjs — 由端点回执推出「怎么装」，再按每一轮的输入决定「装什么」。
//
// 两层，刻意分开：
//   ① adaptPlan(signals)  —— 一次性：端点收不收 system role、上下文有多大、有没有缓存信号 → 载体/位次/预算/惰性档。
//   ② buildTurn({...})    —— 每一轮：按用户这一句里出现的触发词，只把命中的惰性章节正文注入 messages。
//
// 为什么必须分开：①随端点变（探测一次），②随用户输入变（每轮都变）。混在一起就会每轮重探端点，白花钱。
//
// 一条硬规矩：读不出的信号一律写 unknown/degraded，不填默认值、不宣称「已适配」。

import { LAZY_MODES } from "./kernel-compiler.mjs";

export const ADAPT_VERSION = "ig5-dynamic-adapt/1";

// 1 token ≈ 3 bytes —— 中英混排下的保守估计。**推测值**（没有实测的 tokenizer），可被 opts.bytesPerToken 覆盖。
export const DEFAULT_BYTES_PER_TOKEN = 3;
// 留给对话历史与模型输出的比例：只拿端点上下的 35% 装载荷，其余留给来回。
export const LOAD_SHARE = 0.35;
// 端点只说「请缩短」但没给数时，退到这个字节数并降置信度。
export const UNKNOWN_WINDOW_BYTES = 8000;

const CACHE_HEADER_RE = /cache/i;

function clampInt(value, low, high) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return low;
  return Math.max(low, Math.min(high, n));
}

/**
 * 信号 → 装载计划。
 * @param {object} signals probeEndpoint() 的 signals（可为 {}，那就是「没探过」）
 * @param {object} opts { adapter, kernelBytes, bytesPerToken, adapterBudget }
 */
export function adaptPlan(signals = {}, opts = {}) {
  const bytesPerToken = Number(opts.bytesPerToken) > 0 ? Number(opts.bytesPerToken) : DEFAULT_BYTES_PER_TOKEN;
  const kernelBytes = Number(opts.kernelBytes) || 0;
  const adapterBudget = opts.adapterBudget || {};
  const reasons = [];

  const plan = {
    version: ADAPT_VERSION,
    carrier: "system",
    slot: "LAST",
    lazyMode: "standard",
    injectLazy: true,
    indexInline: true,
    cacheCheckpoint: false,
    budget: {
      totalBytes: Number(adapterBudget.totalBytes) || 40000,
      lazyBudgetBytes: LAZY_MODES.standard,
    },
    confidence: "low",
    degraded: false,
    reasons,
  };

  const probed = Boolean(signals && Object.keys(signals).length);
  if (!probed) {
    plan.degraded = true;
    reasons.push({ rule: "no-probe", because: "没有端点信号，按通用宿主默认值装载；未做适配" });
  }

  // R1 端点拒收 system role → 整块载荷并进第一条 user 消息，位次改 INLINE。
  if (signals.systemRole === "rejected") {
    plan.carrier = "inline";
    plan.slot = "INLINE";
    reasons.push({ rule: "system-role-rejected", because: "端点回执拒收 role:system，载荷改走 user 消息内联" });
  } else if (signals.systemRole === "accepted") {
    reasons.push({ rule: "system-role-accepted", because: "端点接受 role:system，载荷留在 system 通道并可挂末位锚点" });
  }

  // R2 回执里有上下文上限 → 拿 35% 当载荷预算；没有就保留通道默认值。
  const window = Number(signals.contextWindow);
  if (Number.isFinite(window) && window > 0) {
    const cap = Math.floor(window * bytesPerToken * LOAD_SHARE);
    plan.budget.totalBytes = Math.min(plan.budget.totalBytes, cap);
    plan.confidence = "high";
    reasons.push({
      rule: "context-window",
      because: `端点回执声明上下文 ${window} tokens，按 ${bytesPerToken} B/token × ${LOAD_SHARE} 折算载荷预算 ${cap} B`,
      evidence: `contextWindow=${window}`,
    });
  } else if (window === -1) {
    plan.budget.totalBytes = Math.min(plan.budget.totalBytes, UNKNOWN_WINDOW_BYTES);
    plan.confidence = "low";
    reasons.push({ rule: "context-window-unknown", because: `端点只要求「缩短」但未给数字，退到 ${UNKNOWN_WINDOW_BYTES} B 保守值` });
  }

  // R3 内核本身就超预算 → 惰性正文一条都不注入，索引也不常驻（只留指针）。
  if (kernelBytes && kernelBytes > plan.budget.totalBytes) {
    plan.lazyMode = "off";
    plan.injectLazy = false;
    plan.indexInline = false;
    reasons.push({
      rule: "kernel-over-budget",
      because: `内核 ${kernelBytes} B 已超过载荷预算 ${plan.budget.totalBytes} B，惰性正文与内联索引全部关闭`,
    });
  }
  plan.budget.lazyBudgetBytes = plan.injectLazy ? LAZY_MODES[plan.lazyMode] ?? LAZY_MODES.standard : 0;

  // R4 回执头里有缓存相关的键 → 在稳定段末尾放缓存断点。
  const hints = Object.keys(signals.headerHints || {}).filter((k) => CACHE_HEADER_RE.test(k));
  if (hints.length) {
    plan.cacheCheckpoint = true;
    reasons.push({ rule: "cache-hint", because: `回执头出现缓存相关键：${hints.join(", ")}`, evidence: hints.join(",") });
  }

  // R5 没有 usage → 无法核对真实 token 消耗，置信度不许写 high。
  if (probed && signals.usageReported === false) {
    plan.confidence = "low";
    reasons.push({ rule: "no-usage", because: "回执未带 usage，实际 token 消耗无法核对，置信度降级" });
  }
  if (probed && signals.systemRole === "unknown" && signals.transport) {
    plan.degraded = true;
    reasons.push({ rule: "transport-error", because: `探针未拿到有效回执（${signals.transport}），未做适配` });
  }

  if (!probed || signals.systemRole === "unknown") plan.confidence = "low";
  return plan;
}

/**
 * 这一轮该注入哪些惰性章节 —— 只按触发词命中，不做语义猜测。
 * @returns {Array<{id:string, order:number, anchor:string, bytes:number, matched:string[]}>}
 */
export function selectLazyUnits(userText, units = []) {
  const text = String(userText ?? "");
  if (!text) return [];
  const hits = [];
  for (const unit of units) {
    const triggers = Array.isArray(unit.triggers) ? unit.triggers : [];
    const matched = triggers.filter((t) => t && text.includes(t));
    if (matched.length) {
      hits.push({ id: unit.id, order: unit.order, anchor: unit.anchor, bytes: unit.bytes ?? Buffer.byteLength(unit.body ?? "", "utf8"), matched });
    }
  }
  return hits.sort((a, b) => a.order - b.order);
}

function renderUnit(unit) {
  return `### ${unit.anchor}（${unit.id}）\n${String(unit.body ?? "").trim()}`;
}

/**
 * 组装这一轮真正发出去的 messages。
 * @param {object} input { kernelText, indexText, units, plan, userTurn, history }
 */
export function buildTurn({ kernelText = "", indexText = "", units = [], plan, userTurn = "", history = [] } = {}) {
  const active = plan || adaptPlan({}, {});
  const parts = [String(kernelText).trim()];
  if (active.indexInline && indexText) parts.push(String(indexText).trim());
  const systemText = parts.filter(Boolean).join("\n\n");

  const hits = active.injectLazy ? selectLazyUnits(userTurn, units) : [];
  const byId = new Map(units.map((u) => [u.id, u]));
  const injected = [];
  const skipped = [];
  let used = 0;
  for (const hit of hits) {
    const unit = byId.get(hit.id);
    const cost = hit.bytes;
    if (used + cost > active.budget.lazyBudgetBytes) {
      skipped.push({ id: hit.id, bytes: cost, because: "over-lazy-budget" });
      continue;
    }
    used += cost;
    injected.push(hit.id);
    parts.push(renderUnit(unit));
  }

  const messages = [];
  if (active.carrier === "system" && systemText) messages.push({ role: "system", content: systemText });
  for (const turn of history) messages.push(turn);

  const dynamicBlock = injected.length
    ? `\n\n<!-- ig5 动态注入：本轮命中 ${injected.join(", ")} -->\n${injected
        .map((id) => renderUnit(byId.get(id)))
        .join("\n\n")}`
    : "";
  const inlinePrefix = active.carrier === "inline" ? `${systemText}\n\n---\n\n` : "";
  messages.push({ role: "user", content: `${inlinePrefix}${String(userTurn)}${dynamicBlock}` });

  const cacheBreakpoints = [];
  if (active.cacheCheckpoint && active.carrier === "system" && messages.length) {
    cacheBreakpoints.push({ index: 0, reason: "稳定段（内核+索引）末尾，动态注入与用户输入在其后" });
  }

  const bytes = messages.reduce((sum, m) => sum + Buffer.byteLength(m.content, "utf8"), 0);
  return {
    version: ADAPT_VERSION,
    messages,
    carrier: active.carrier,
    slot: active.slot,
    injected,
    skipped,
    cacheBreakpoints,
    bytes,
    budgetBytes: active.budget.totalBytes,
    withinBudget: bytes <= active.budget.totalBytes,
    confidence: active.confidence,
    degraded: active.degraded,
  };
}

export default { adaptPlan, selectLazyUnits, buildTurn, ADAPT_VERSION };
