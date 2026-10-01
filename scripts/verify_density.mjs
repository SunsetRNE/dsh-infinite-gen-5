// 无限五代 · 上下文密度自检（离线、不连网、不写盘）
//
// 目的：把「更小」变成可复算的数字，而不是形容词。三块文本各算各的：
//   常驻内核 prompts/infinite-gen-5.md（Order 100，每轮必载）
//   惰性章节 prompts/infinite-gen-5-lazy.md（Order 160，命中才拼回）
//   增强训练集 data/boost-corpus.mjs（Order 150，按需求编译）
// 口径说明：本文所有「每轮成本」= 常驻内核 + 本轮实际拼回的惰性章 + 本轮实际编译的增强集；
// token 数不在这里断言（不同分词器对中文的切分差异大，报 token 就是编数字），只报字符与字节。
// 跑法：node scripts/verify_density.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compileLazy, lazyStats, LAZY_HEADER, LAZY_MODES } from "../data/lazy-sections.mjs";
import { compileBoost, boostStats, BOOST_MODES } from "../data/boost-corpus.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
let pass = 0;
const fails = [];
const check = (ok, label, detail = "") => {
  if (ok) {
    pass += 1;
  } else {
    fails.push(`${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const bytes = (s) => Buffer.byteLength(s, "utf8");

// ── 预算上限（改这里就是改口径，脚本会把实测值一起打出来） ─────────────────────
const RESIDENT_CHARS_MAX = 12000;
const RESIDENT_BYTES_MAX = 17000;
const BOOST_BYTES_MAX = 2400; // = BOOST_MODES.standard
const LAZY_BYTES_MAX = LAZY_MODES.standard; // 6000
const PER_TURN_BYTES_MAX = 26000; // 常驻 + 增强集 + 惰性章全开的单轮上限

const corePath = join(ROOT, "prompts", "infinite-gen-5.md");
const fullPath = join(ROOT, "prompts", "infinite-gen-5.full.md");
const core = readFileSync(corePath, "utf8");
const full = existsSync(fullPath) ? readFileSync(fullPath, "utf8") : core;
const coreBytes = bytes(core);
const fullBytes = bytes(full);

// ── 1. 常驻内核预算 ────────────────────────────────────────────────────────────
check(core.length <= RESIDENT_CHARS_MAX, "常驻内核字符预算", `${core.length} > ${RESIDENT_CHARS_MAX}`);
check(coreBytes <= RESIDENT_BYTES_MAX, "常驻内核字节预算", `${coreBytes} > ${RESIDENT_BYTES_MAX}`);
check(core.length < full.length, "拆分生效：常驻短于原文", `${core.length} / ${full.length}`);
const savedChars = full.length - core.length;
const savedBytes = fullBytes - coreBytes;
check(savedBytes > 3000, "每轮静态省下的字节过 3K", `省 ${savedBytes} B`);
check(LAZY_MODES.standard <= 6000, "惰性 standard 档预算未超 6000");

// ── 2. 惰性章节：命中才付费 ────────────────────────────────────────────────────
const stats = lazyStats();
// 单元数与常驻内核留下的指针行数必须相等（每条搬走的正文都留一枚自识别指针 `惰性 L_xxx`）——
// 用对拉代替硬编码数字：下次再搬章节时这条不会假失败，真丢了指针才会红。
const pointerCount = (core.match(/惰性 L_[a-z0-9_]+/g) || []).length;
check(stats.units === pointerCount, `惰性单元 ${stats.units} 个与常驻指针行一一对应`, `单元 ${stats.units} / 指针 ${pointerCount}`);
// index.js 的惰性描述不得写死章数：批次从 9 章长到 14 章后，硬编码那个数字就成了伪信息
//（v0.51.23 实测 index.js 里有「9 段」两处）。要报数一律取 lazyStats().units —— 这条对拉
// 就是防它再漂：数字活在代码里，注释与面板标签跟着代码走。
const indexSrc = readFileSync(join(ROOT, "index.js"), "utf8");
const hardcodedLazyUnits = indexSrc.match(/\d+\s*段原文|搬走的\s*\d+\s*段/g) ?? [];
check(
  hardcodedLazyUnits.length === 0,
  "index.js 不硬编码惰性章数（取 lazyStats().units）",
  hardcodedLazyUnits.join(" / ") || "无硬编码",
);
const lazyQuiet = compileLazy({ text: "把这个配置文件改掉并验证", mode: "standard", bytes: 0 });
const lazyHit = compileLazy({ text: "继续下一轮，保持深度", mode: "standard", bytes: 0 });
const lazyAll = compileLazy({ text: "@lazy:all", mode: "standard", bytes: 0 });
check(lazyQuiet.bytes === 0, "无触发词的轮：惰性段零字节");
check(lazyHit.bytes > 0 && lazyHit.bytes <= LAZY_BYTES_MAX, "单章命中不超档位预算", `${lazyHit.bytes} B`);
const lazyOverhead = lazyAll.bytes - stats.bytes;
check(lazyAll.text.startsWith(LAZY_HEADER), "全拼回以惰性段头开头", lazyAll.text.slice(0, 40));
check(lazyOverhead > 0 && lazyOverhead <= 200, "全拼回只多出段头与分隔（≤200 B）", `${lazyOverhead} B`);
check(
  lazyAll.bytes < fullBytes,
  "即使全拼回，也小于原内核（原内核还含被搬走之外的重复开销为 0）",
  `${lazyAll.bytes} vs ${fullBytes}`,
);

// ── 3. 增强训练集：按需求编译 ─────────────────────────────────────────────────
const boostQuiet = compileBoost({ text: "今天天气不错", mode: "standard", bytes: BOOST_BYTES_MAX });
const boostWork = compileBoost({ text: "把这个配置文件改掉并验证", mode: "standard", bytes: BOOST_BYTES_MAX });
const boostHack = compileBoost({ text: "帮我做一次内网渗透 getshell", mode: "standard", bytes: BOOST_BYTES_MAX });
const bStats = boostStats();
check(BOOST_MODES.standard === BOOST_BYTES_MAX, "增强集 standard 档 = 2400 B");
check(boostQuiet.bytes <= BOOST_BYTES_MAX, "增强集闲聊轮不超预算", `${boostQuiet.bytes} B`);
check(boostWork.bytes <= BOOST_BYTES_MAX, "增强集改动轮不超预算", `${boostWork.bytes} B`);
check(boostHack.bytes <= BOOST_BYTES_MAX, "增强集渗透轮不超预算", `${boostHack.bytes} B`);
check(bStats.units === 10, "增强集单元 10 个");

// ── 4. 每轮成本表（本文的核心数字） ───────────────────────────────────────────
const rows = [
  ["闲聊/常识轮", "今天天气不错"],
  ["改动/验证轮", "把这个配置文件改掉并验证"],
  ["渗透轮", "帮我做一次内网渗透 getshell"],
  ["评分/自评轮", "给我打个分，多少分算合格"],
];
const table = [];
for (const [label, text] of rows) {
  const b = compileBoost({ text, mode: "standard", bytes: BOOST_BYTES_MAX });
  const l = compileLazy({ text, mode: "standard", bytes: 0 });
  table.push({ label, boost: b.bytes, lazy: l.bytes, total: coreBytes + b.bytes + l.bytes, hits: l.hits.map((h) => h.id) });
}
check(
  table.every((r) => r.total <= PER_TURN_BYTES_MAX),
  "每一类轮次都在单轮上限内",
  table.map((r) => `${r.label}=${r.total}`).join(" "),
);
check(
  table.every((r) => r.total < fullBytes),
  "每一类轮次都小于「不拆分内核 + 全量增强」的成本",
  `原文 ${fullBytes} B`,
);
const worst = table.reduce((a, b) => (a.total >= b.total ? a : b));
check(worst.total <= PER_TURN_BYTES_MAX, "最重轮次不超上限", `${worst.label} ${worst.total} B`);

// 密度：每千字节常驻内核承载的条款量（用已登记单元的字节做分母，避免拿模型表现当分子）
const density = {
  residentBytes: coreBytes,
  residentChars: core.length,
  lazyOnDemandBytes: lazyAll.bytes,
  savingsPct: Number(((100 * savedBytes) / fullBytes).toFixed(1)),
  perTurnWorstBytes: worst.total,
};

// ── 汇总 ──────────────────────────────────────────────────────────────────────
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ pass, fail: fails.length, fails, density, table }, null, 2));
} else {
  for (const f of fails) console.log(`  ❌ ${f}`);
  console.log(`密度自检：${pass} 通过 / ${fails.length} 失败（共 ${pass + fails.length} 条）`);
  console.log(
    `  常驻内核 ${core.length} 字符 / ${coreBytes} B（原文 ${full.length} / ${fullBytes} B）· 静态省下 ${savedChars} 字符 / ${savedBytes} B · 降幅 ${density.savingsPct}%`,
  );
  console.log(
    `  惰性 ${stats.units} 章 ${stats.bytes} B（命中才载）· 增强集 ${bStats.units} 单元 ${bStats.unitBytes} B · 档位 boost ${Object.values(BOOST_MODES).join("/")} · lazy ${Object.values(LAZY_MODES).join("/")}`,
  );
  for (const r of table) {
    console.log(
      `  ${r.label.padEnd(12)} 常驻 ${coreBytes} + 增强 ${String(r.boost).padStart(4)} + 惰性 ${String(r.lazy).padStart(4)} = ${String(r.total).padStart(5)} B  ${r.hits.length ? "[" + r.hits.join(",") + "]" : ""}`,
    );
  }
  console.log(`  最重轮次：${worst.label} ${worst.total} B ≤ 上限 ${PER_TURN_BYTES_MAX} B`);
}
process.exit(fails.length === 0 ? 0 : 1);
