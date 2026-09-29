// 惰性章节编译器（Order 160）—— 内核常驻索引只留核心，重量级但「只在特定场景才需要」的章节
// 由本模块按**本轮用户文本**现场拼回：命中触发词才装载，整条进/整条丢，绝不截半句。
//
// 与 data/boost-corpus.mjs 的分工：
//   boost  —— 追加条款（附件语料训练出来的增强集），按需求编译；
//   lazy   —— 内核自己的章节（语言/压力/自审/长程/分发/清单/示例），命中才回到系统提示词里。
// 两者都不改内核正文一个字：lazy 的正文是 scripts/kernel-lazy-split.mjs 从内核**逐字搬出来**的，
// 覆盖校验在那支脚本里（正文必须是原文的连续片段 + 常驻内核无残留）。
import { readFileSync, statSync } from "node:fs";

const LAZY_URL = new URL("../prompts/infinite-gen-5-lazy.md", import.meta.url);

export const LAZY_MODES = Object.freeze({ off: 0, light: 3500, standard: 6000, full: 16000 });
export const LAZY_DEFAULT_MODE = "standard";
// 0 = 跟随档位预算（light/standard/all 各自的额度）；>0 时是硬上限，取 min(档位预算, 本值)。
// 用 0 而不是 6000 当默认值：否则设置页的 LAZY_BYTES 会把 full 档（16000）静默夹到 6000。
export const LAZY_DEFAULT_BYTES = 0;
export const LAZY_HEADER = "[无限五代 · 惰性章节 · 命中触发词按需拼回]";

// 触发词解析：`@@unit:L_pressure|order:171|anchor:Pressure rule|triggers:a|b|c`
export function parseLazyUnits(text) {
  const units = [];
  const re = /^@@unit:([A-Za-z0-9_]+)\|order:(\d+)\|anchor:([^|\n]+)\|triggers:([^\n]+)\n([\s\S]*?)\n@@end:\1$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, id, order, anchor, triggers, body] = m;
    units.push({
      id, order: Number(order), anchor: anchor.trim(), body,
      bytes: Buffer.byteLength(body, "utf8"),
      chars: body.length,
      re: new RegExp(triggers, "i"),
    });
  }
  return units.sort((a, b) => a.order - b.order);
}

let CACHE = { sig: "", units: [] };
export function lazyUnits() {
  const st = statSync(LAZY_URL);
  const sig = `${st.mtimeMs}:${st.size}`;
  if (CACHE.sig !== sig) CACHE = { sig, units: parseLazyUnits(readFileSync(LAZY_URL, "utf8")) };
  return CACHE.units;
}

// `@lazy:off` / `@lazy:all` / `@lazy:auto`（也可写 惰性开 / 惰性关）
export function readLazyDirective(lastUserText = "") {
  const t = String(lastUserText || "");
  const m = t.match(/@lazy:(off|all|auto|light|standard|full)\b/i) || t.match(/惰性(开|关|全开|全关)/);
  if (!m) return null;
  const v = String(m[1]).toLowerCase();
  if (v === "关" || v === "全关") return "off";
  if (v === "开") return "auto";
  if (v === "全开") return "full";
  return v;
}

export function hitsLazy(units, lastUserText) {
  const t = String(lastUserText || "");
  return units.filter((u) => u.re.test(t));
}

export function compileLazy({ text = "", mode = LAZY_DEFAULT_MODE, bytes = LAZY_DEFAULT_BYTES } = {}) {
  const units = lazyUnits();
  const directive = readLazyDirective(text);
  const effectiveMode = directive && LAZY_MODES[directive] !== undefined ? directive : mode;
  const all = directive === "all" || effectiveMode === "all" || effectiveMode === "full";
  // 预算来源：档位表（light/standard/full 各自额度）＋ 设置页硬上限（bytes>0 时取 min）。
  // off 档的档位预算是 0，所以整条丢弃；all/full 不受档位表限制，但仍受显式上限约束。
  const modeBudget = LAZY_MODES[effectiveMode] ?? LAZY_MODES[LAZY_DEFAULT_MODE];
  const cap = Number.isFinite(bytes) && bytes > 0 ? bytes : Infinity;
  const budget = all ? cap : Math.min(modeBudget, cap);
  const hits = all ? units.slice() : hitsLazy(units, text);

  const kept = [];
  const dropped = [];
  // v0.41 修正：预算必须把抬头行与 join("\n") 的分隔符算进去 —— 否则 emitted.bytes 可以
  // 超出档位预算最多 headerBytes + kept.length 字节（设置页把 light 档调到 3500 时可见）。
  const headerBytes = Buffer.byteLength(`${LAZY_HEADER}\n`, "utf8");
  let used = 0;
  for (const u of hits) {
    const overhead = kept.length > 0 ? 1 : headerBytes; // 首章付抬头，其余章付分隔符
    if (used + overhead + u.bytes <= budget) { kept.push(u); used += overhead + u.bytes; }
    else dropped.push(u);
  }
  const header = kept.length ? `${LAZY_HEADER}\n` : "";
  const body = kept.map((u) => u.body).join("\n");
  const out = kept.length ? `${header}${body}` : "";
  return {
    emit: kept.length > 0,
    mode: effectiveMode,
    requestedMode: mode,
    directive,
    all,
    budget: Number.isFinite(budget) ? budget : 0, // 0 = 无上限（full / @lazy:all 且未设硬上限）
    bytes: Buffer.byteLength(out, "utf8"),
    chars: out.length,
    text: out,
    hits: kept.map((u) => ({ id: u.id, anchor: u.anchor, bytes: u.bytes, chars: u.chars })),
    dropped: dropped.map((u) => ({ id: u.id, bytes: u.bytes })),
  };
}

export function lazyStats() {
  const units = lazyUnits();
  return {
    units: units.length,
    bytes: units.reduce((n, u) => n + u.bytes, 0),
    chars: units.reduce((n, u) => n + u.chars, 0),
    ids: units.map((u) => u.id),
    modes: { ...LAZY_MODES },
    defaultMode: LAZY_DEFAULT_MODE,
    defaultBytes: LAZY_DEFAULT_BYTES,
  };
}
