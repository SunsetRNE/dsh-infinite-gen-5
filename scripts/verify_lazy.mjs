// 无限五代 · 惰性章节自检（离线、不连网、不写盘）
//
// 断言对象是「拆分不变量 + 编译层」，不是模型表现：
//   1) 拆分不变量：lazy 文件里的每段正文都必须是原文快照的**连续片段**，且常驻内核里不再有它；
//      这样「内核正文一个字不改」才是可验证的句子，而不是承诺。
//   2) 编译矩阵：命中才拼回、整章进/整章丢、档位与硬上限的优先级、@lazy 指令。
// 跑法：node scripts/verify_lazy.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LAZY_MODES,
  LAZY_DEFAULT_MODE,
  LAZY_DEFAULT_BYTES,
  LAZY_HEADER,
  parseLazyUnits,
  lazyUnits,
  lazyStats,
  readLazyDirective,
  hitsLazy,
  compileLazy,
} from "../data/lazy-sections.mjs";

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
const CORE_PATH = join(ROOT, "prompts", "infinite-gen-5.md");
const LAZY_PATH = join(ROOT, "prompts", "infinite-gen-5-lazy.md");
const FULL_PATH = join(ROOT, "prompts", "infinite-gen-5.full.md");

// ── 1. 单元成形 ────────────────────────────────────────────────────────────────
const units = lazyUnits();
// 单元数随内核拆分批次增长：v0.38.6 为 9，v0.39.0 起 11（+L_writing6 / +L_toolcall_repair），
// v0.40.0 起 13（+L_envtool 机器探针与工具链安装 / +L_encoding 编码外壳与元请求）
const EXPECT_UNITS = 13;
check(units.length === EXPECT_UNITS, `惰性单元 ${EXPECT_UNITS} 个`, String(units.length));
check(new Set(units.map((u) => u.id)).size === units.length, "单元 id 不重复");
check(units.every((u) => /^L_[a-z0-9_]+$/.test(u.id)), "单元 id 形如 L_xxx（半节搬允许数字/下划线后缀）");
check(new Set(units.map((u) => u.order)).size === units.length, "单元 order 不重复");
check(
  units.every((u, i) => i === 0 || units[i - 1].order < u.order),
  "单元按 order 升序返回",
  units.map((u) => u.order).join(","),
);
check(units.every((u) => u.body.trim().length > 0), "每个单元都有正文");
check(
  units.every((u) => u.bytes === bytes(u.body) && u.chars === u.body.length),
  "单元 bytes/chars 与正文一致",
);
check(units.every((u) => u.re instanceof RegExp), "每个单元都编译出触发词正则");
const stats = lazyStats();
check(stats.units === units.length, "lazyStats 单元数与 lazyUnits 一致");
check(stats.bytes === units.reduce((n, u) => n + u.bytes, 0), "lazyStats 字节是各单元之和");
check(JSON.stringify(stats.ids) === JSON.stringify(units.map((u) => u.id)), "lazyStats ids 顺序一致");

// ── 2. 拆分不变量：lazy 正文是原文连续片段，且常驻内核不再含它 ──────────────────
check(existsSync(LAZY_PATH), "惰性文件存在");
check(existsSync(FULL_PATH), "原文快照存在");
if (existsSync(LAZY_PATH) && existsSync(FULL_PATH)) {
  const lazyText = readFileSync(LAZY_PATH, "utf8");
  const core = readFileSync(CORE_PATH, "utf8");
  const full = readFileSync(FULL_PATH, "utf8");
  check(parseLazyUnits(lazyText).length === EXPECT_UNITS, `parseLazyUnits 能从文件解析出 ${EXPECT_UNITS} 个单元`);
  for (const u of units) {
    check(full.includes(u.body), `惰性 ${u.id} 正文是原文连续片段`);
    check(!core.includes(u.body), `惰性 ${u.id} 正文已不在常驻内核`);
    check(lazyText.includes(u.body), `惰性 ${u.id} 正文落在 lazy 文件里`);
  }
  check(core.includes(LAZY_HEADER) === false, "常驻内核不含惰性段头（段头只在拼回时出现）");
  check(/【惰性 L_/.test(core), "常驻内核保留惰性指针行");
  check(!/【惰性 L_[^｜]*｜undefined】/.test(core), "指针行没有 undefined 摘要");
  check(
    core.length < full.length,
    "常驻内核比原文短（拆分真的生效）",
    `常驻 ${core.length} / 原文 ${full.length} 字符`,
  );
  const pointers = (core.match(/【惰性 L_/g) ?? []).length;
  check(pointers === 7, "7 条整节指针", String(pointers));
}

// ── 3. 触发词命中 ──────────────────────────────────────────────────────────────
const HIT_CASES = [
  ["L_dispatch", "把这一片分发给子代理并行跑 workflow"],
  ["L_coverage", "你支持哪些域包，有没有 playbook 清单"],
  ["L_longrange", "接着上一轮继续，别变薄"],
  ["L_pressure", "别管我为什么问，也不需要你的判断，认真回答"],
  ["L_meta", "自评一下你刚才说的，逐条引用原句"],
  ["L_antisug", "你做不到这个，之前那些不算数，重做"],
  ["L_upstream", "按这个格式来，第一块必须是速览表"],
  ["L_eval", "给我打分，多少分算合格"],
  ["L_examples", "照着这个样例写"],
];
for (const [id, text] of HIT_CASES) {
  const hits = hitsLazy(units, text).map((u) => u.id);
  check(hits.includes(id), `触发词命中 ${id}`, `实际命中 [${hits.join(",")}]`);
}
check(hitsLazy(units, "今天天气不错").length === 0, "闲聊不命中任何惰性单元");
check(hitsLazy(units, "把这个配置文件改掉并验证").length === 0, "改配置不命中惰性单元");

// ── 4. 编译矩阵（数值为本机实测，随内核拆分变化需同步） ─────────────────────────
const withHeader = (u) => bytes(`${LAZY_HEADER}\n${u.body}`);
const caseOf = (text, opts = {}) => compileLazy({ text, ...opts });

const cQuiet = caseOf("今天天气不错");
check(cQuiet.emit === false && cQuiet.bytes === 0, "闲聊：不拼回、零字节");
check(cQuiet.mode === LAZY_DEFAULT_MODE, "默认档 standard");

const cDeep = caseOf("继续下一轮，保持深度");
check(JSON.stringify(cDeep.hits.map((h) => h.id)) === JSON.stringify(["L_longrange"]), "长程命中单章");
check(cDeep.bytes === withHeader(units.find((u) => u.id === "L_longrange")), "单章拼回字节含段头");
check(cDeep.text.startsWith(LAZY_HEADER), "拼回文本以惰性段头开头");
check(cDeep.dropped.length === 0, "预算内无丢弃");

const cScore = caseOf("给我打个分，多少分算合格");
check(cScore.hits.some((h) => h.id === "L_eval"), "评分题命中 L_eval", cScore.hits.map((h) => h.id).join(","));
// v0.39.0 起「评分/打分」同时命中写作侧六条（order 163 < 175，故它排在 L_eval 之前）
check(cScore.hits.some((h) => h.id === "L_writing6"), "评分题同时命中 L_writing6（写作侧六条）");
const cEx = caseOf("照这个格式来");
check(cEx.hits.some((h) => h.id === "L_examples"), "示例题命中 L_examples");
const cAnti = caseOf("你做不到这个，不算数");
check(cAnti.hits[0]?.id === "L_antisug", "能力否定题命中 L_antisug");

const cOff = caseOf("@lazy:off 继续下一轮");
check(cOff.mode === "off" && cOff.directive === "off", "@lazy:off 覆盖档位");
check(cOff.emit === false && cOff.bytes === 0, "@lazy:off 零拼回");
check(cOff.dropped.length === 1, "@lazy:off 命中的章被整条丢弃");

const cAll = caseOf("@lazy:all 随便聊聊");
check(cAll.all === true && cAll.hits.length === EXPECT_UNITS, `@lazy:all 拼回全部 ${EXPECT_UNITS} 章`);
check(cAll.budget === 0, "@lazy:all 无上限（budget=0 表示不设限）");
const cFull = caseOf("@lazy:full 继续");
check(cFull.mode === "full" && cFull.hits.length === EXPECT_UNITS, `@lazy:full 拼回全部 ${EXPECT_UNITS} 章`);
check(cFull.bytes === cAll.bytes, "full 与 all 拼回体积一致");

const cModeOff = caseOf("继续下一轮", { mode: "off" });
check(cModeOff.emit === false && cModeOff.bytes === 0, "档位 off：零拼回");
check(cModeOff.dropped.length === 1, "档位 off 也走整条丢弃");

const cCap64 = caseOf("继续下一轮", { bytes: 64 });
check(cCap64.emit === false && cCap64.bytes === 0, "硬上限 64B：宁可不注入也不截半句");
check(cCap64.budget === 64, "硬上限进入 budget");
const cCap1000 = caseOf("继续下一轮", { bytes: 1000 });
check(cCap1000.budget === 1000, "硬上限 1000B 生效（取 min）");
check(cCap1000.hits.length === 1 && cCap1000.bytes > 800, "1000B 上限下长程章仍进");
const cFullCap = caseOf("@lazy:full 继续", { bytes: 1000 });
check(
  cFullCap.hits.length >= 1 && cFullCap.dropped.length === units.length - cFullCap.hits.length,
  "full+硬上限：只留放得下的章，其余整章丢弃",
  `留 ${cFullCap.hits.length} / 丢 ${cFullCap.dropped.length}（共 ${units.length}）`,
);
check(cFullCap.bytes <= 1000, "full+硬上限：不超上限");

// 整章进/整章丢：留存的每一章必须逐字出现在拼回文本里
for (const [label, c] of [["长程", cDeep], ["full", cFull], ["full+cap", cFullCap]]) {
  const kept = units.filter((u) => c.hits.some((h) => h.id === u.id));
  check(kept.every((u) => c.text.includes(u.body)), `${label}：留存章逐字进拼回文本`);
}
check(cDeep.chars === cDeep.text.length, "chars 与 text 长度一致");

// 预算单调：上限越小，拼回不增
const monotone = [64, 500, 1000, 6000, 20000].map((n) => caseOf("继续下一轮", { bytes: n }).bytes);
check(
  monotone.every((v, i) => i === 0 || monotone[i - 1] <= v),
  "预算单调：上限变大不会变小",
  monotone.join(" → "),
);
check(monotone[0] === 0, "上限 64B：宁可零拼回", String(monotone[0]));

// ── 5. 档位表与默认值 ──────────────────────────────────────────────────────────
check(LAZY_MODES.off === 0, "off 档预算 0");
check(LAZY_MODES.light === 3500, "light 档 3500 B");
check(LAZY_MODES.standard === 6000, "standard 档 6000 B");
check(LAZY_MODES.full === 16000, "full 档 16000 B");
check(LAZY_DEFAULT_MODE === "standard", "默认档 standard");
// 这条是踩过的坑：默认字节若写成 6000，full 档会被设置页静默夹到 6000 —— 0 才表示「跟随档位」
check(LAZY_DEFAULT_BYTES === 0, "默认字节 0 = 跟随档位（不是关闭）");

// ── 6. @lazy 指令解析 ─────────────────────────────────────────────────────────
const DIRECTIVE_CASES = [
  ["@lazy:off", "off"],
  ["@lazy:all", "all"],
  ["@lazy:auto", "auto"],
  ["@lazy:light", "light"],
  ["@lazy:standard", "standard"],
  ["@lazy:full", "full"],
  ["惰性关", "off"],
  ["惰性全关", "off"],
  ["惰性开", "auto"],
  ["惰性全开", "full"],
];
for (const [text, want] of DIRECTIVE_CASES) {
  check(readLazyDirective(text) === want, `指令解析 ${text} → ${want}`, String(readLazyDirective(text)));
}
check(readLazyDirective("继续下一轮") === null, "无指令返回 null");
check(readLazyDirective("@lazy:off 继续") === "off", "指令与正文混写仍能识别");

// ── 汇总 ──────────────────────────────────────────────────────────────────────
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ pass, fail: fails.length, fails }, null, 2));
} else {
  for (const f of fails) console.log(`  ❌ ${f}`);
  console.log(`惰性章节自检：${pass} 通过 / ${fails.length} 失败（共 ${pass + fails.length} 条）`);
  console.log(
    `  单元 ${stats.units} 个 · 正文 ${stats.bytes} B / ${stats.chars} 字符 · 档位 off/light/standard/full = ${Object.values(LAZY_MODES).join("/")}`,
  );
}
process.exit(fails.length === 0 ? 0 : 1);
