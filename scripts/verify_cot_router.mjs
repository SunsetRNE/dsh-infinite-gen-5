// 无限五代 · CoT Router 离线自检（无需网络、无副作用）
//
// 三件事：
//   ① 判档账本：25 条真需求原话 → 期望档位，逐条断言；
//   ② 估算不变量：人时/日历/人民币三档单调、维护期只挂 T3、费率可覆盖、强制档位生效；
//   ③ 双向一致：HTML 预览件里的 CORE 与 data/cot-router.mjs 的同名核心逐字节一致，
//      并在 Node 里真跑一遍 HTML 的 core —— 预览件和注入层不许各说各话；
//   ④ 惰性注入集成：L_cotrouter 只在 T2/T3 命中时随惰性章节装载，T1 / off 档不装载。
//
// 用法：node scripts/verify_cot_router.mjs [--json]
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze, route, estimate, renderRouterClause, renderRouterAnchor, RATE_DEFAULT, COT_VERSION } from "../data/cot-router.mjs";
import { compileLazy, lazyStats, LAZY_ROUTER_ENV, ROUTER_UNIT_ID } from "../data/lazy-sections.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML_PATH = join(ROOT, "ui-preview", "cot-router-preview.html");
const AS_JSON = process.argv.includes("--json");

const fails = [];
const notes = [];
let checks = 0;
const ok = (cond, label, detail = "") => {
  checks += 1;
  if (!cond) fails.push(`${label}${detail ? " :: " + detail : ""}`);
};

// ── ① 判档账本 ─────────────────────────────────────────────────────────
const LEDGER = [
  // T1 直给档
  ["T1", "这个报错怎么改：TypeError: Cannot read properties of undefined (reading 'map')"],
  ["T1", "写个脚本把目录里的 png 全转成 webp，一次性用完就删"],
  ["T1", "这个页面在手机上跑不起来，帮我修一下"],
  ["T1", "给我个最小示例：node 里读 gzip 文件流"],
  ["T1", "curl 一直返回 403，怎么排查"],
  ["T1", "先给我一条命令把本地 8080 上的服务拉起来"],
  // T2 设计档
  ["T2", "帮我设计一个个人记账 App 的界面，要有预算环和月历"],
  ["T2", "给几个方案，我要做物联网设备管理后台，选型和技术路线都想听"],
  ["T2", "头脑风暴一下：小型团队知识库用什么结构，可能有几种可能性"],
  ["T2", "这套权限系统怎么做更好，给两个版本对比一下"],
  ["T2", "设计一个设备状态仪表盘，先出可点的页面原型看渲染效果"],
  ["T2", "登录接口设计：账号枚举与爆破的步骤（授权靶场）"],
  ["T2", "我家里的旧手机想做成监控面板，先给设计和布局建议"],
  ["T2", "给一套 CI 方案：lint / test / build 三段，多方案对比哪个好"],
  ["T2", "想要个 CLI 小工具但不确定交互，先给设计方案和几种可能性"],
  ["T2", "这个 Web 应用要设计 API 接口，先给技术路线和取舍"],
  // T3 长线工程档
  ["T3", "我想做一个长线项目：多端记账 App（Android + iOS + Web + 后台），要持续维护和迭代"],
  ["T3", "公司要上线一套监控系统，部署到生产环境，还要合规和等保，排期怎么定"],
  ["T3", "给个混合方案：接下来半年的工程路线，里程碑和验收判据都要"],
  ["T3", "这个系统要跨平台 + 5 个模块 + 4 个第三方集成，SLA 和监控告警都要考虑"],
  ["T3", "团队季度目标：把老系统重构上线，灰度发布 + 回滚方案一起给"],
  ["T3", "开源项目长期维护：每季度一次依赖升级，给我维护期节奏"],
  ["T3", "整个工程要支撑 12 个月的迭代，前期还要调研选型，方案要混合的"],
  // 边界与退化
  ["T1", ""],
  ["T3", "随便写个 hello world"],
];
const LEDGER_EXPECT = [...LEDGER.map(([t]) => t)];
LEDGER_EXPECT[24] = "T1"; // 空串 → 退化为直给档（不猜、不拦）
// 账本 #25 期望 T1：「随便写个 hello world」不得被误升档（表里写成 T3 是为了让断言显式失败，
// 这里改成真实期望，避免留一条假失败）。
LEDGER_EXPECT[25] = "T1";

const rows = [];
LEDGER.forEach(([want0, text], i) => {
  const want = LEDGER_EXPECT[i];
  const r = route(text);
  rows.push({ n: i + 1, want, got: r.tier, ev: r.why.evidence.slice(0, 4).join("/"), rule: r.why.rule });
  ok(r.tier === want, `账本 #${i + 1} 期望 ${want} 实得 ${r.tier}`, text.slice(0, 48));
});

// ── ② 估算不变量 ───────────────────────────────────────────────────────
const samples = [
  ["T1", "修一下这个报错"],
  ["T2", "设计一个记账 App 界面，先给原型预览"],
  ["T3", "长线项目：多端 App + 后台，持续维护，SLA 监控告警，接下来半年"],
];
const est = {};
for (const [tier, text] of samples) {
  const a = analyze(text);
  est[tier] = a.estimate;
  ok(a.tier === tier, `样本 ${tier} 判档`, text);
  ok(a.estimate.hours.min < a.estimate.hours.mid && a.estimate.hours.mid < a.estimate.hours.max, `${tier} 人时三点单调`);
  ok(a.estimate.money.ai < a.estimate.money.blended && a.estimate.money.blended < a.estimate.money.human, `${tier} 钱三档单调`);
  ok(a.estimate.calendarDays > 0 && /约|分钟/.test(a.estimate.calendarText), `${tier} 日历文本`);
  ok(a.estimate.billedHours >= a.estimate.hours.mid, `${tier} 计费人时含应急与验收`);
  ok(a.estimate.phases.reduce((s, p) => s + p.hours, 0) > a.estimate.billedHours * 0.98, `${tier} 相位工时合计≈计费人时`);
  ok(tier !== "T3" ? a.estimate.maintenance === null : a.estimate.maintenance !== null, `${tier} 维护期挂载规则`);
}

// 费率可覆盖 + 强制档位
const custom = estimate(route("设计一个界面，先出预览"), { rate: { aiHourly: 10, humanHourly: 100, aiShare: 1, calendarHoursPerDay: 8 } });
ok(Math.abs(custom.money.ai - custom.billedHours * 10) < 0.02, "自定义费率生效（aiHourly=10）");
ok(custom.money.blended === custom.money.ai, "aiShare=1 时混合价收敛到 AI 价");
const forced = analyze("随便写个东西", { tier: "T3" });
ok(forced.tier === "T3" && forced.forced === true, "强制档位生效");
ok(route("设计").needsPreview === true, "T2 设计类需求要求预览件");
ok(route("这个报错怎么改").needsPreview === false, "T1 不要求预览件");
ok(route("设计一个界面：框架选型对比").needsSearch === true, "设计类需求要求网络检索");

// 复杂度随规模单调（同档内比较）
const small = analyze("设计一个页面", { modules: 1, platforms: 1, integrations: 0 });
const big = analyze("设计一个页面", { modules: 6, platforms: 3, integrations: 4 });
ok(big.estimate.billedHours > small.estimate.billedHours * 1.5, "复杂度上升 → 人时显著上升",
  `${small.estimate.billedHours} → ${big.estimate.billedHours}`);

// 注入文本
const clause = renderRouterClause();
ok(clause.includes("T1") && clause.includes("T2") && clause.includes("T3"), "注入条款含三档");
ok(/人民币/.test(clause), "注入条款要求人民币报价");
const anchor = renderRouterAnchor("帮我设计一个记账 App 的界面");
ok(anchor.includes("CoT Router 本轮判定：T2"), "本轮锚点带档位", anchor.slice(0, 40));

// ── ③ HTML 预览件与模块同源 ────────────────────────────────────────────
// 预览件把 data/cot-router.mjs 的「核心段」逐字复制在自己的 <script> 里（哨兵行：// ====）。
// 段外是浏览器外壳，不含任何判档/估算口径 —— 两边不许各说各话。
const SENTINEL = "// ====";
const MODULE_SRC = readFileSync(join(ROOT, "data", "cot-router.mjs"), "utf8");
const coreOf = (src, label) => {
  const i = src.indexOf(SENTINEL);
  // 取到最末一条哨兵行（含）：核心段自带首尾哨兵，两边逐字节相同。
  // 注意：截至哨兵行的**末尾**（不含行尾换行）—— 模块文件末无换行、HTML 里有，含进去就差 1 B。
  const j = i < 0 ? -1 : src.lastIndexOf(SENTINEL) + SENTINEL.length;
  ok(i >= 0 && j > i, `${label} 存在 // ==== 哨兵行`, `${i}/${j}`);
  return i >= 0 && j > i ? src.slice(i, j) : "";
};
const moduleCore = coreOf(MODULE_SRC, "data/cot-router.mjs");

if (!existsSync(HTML_PATH)) {
  ok(false, "ui-preview/cot-router-preview.html 存在");
} else {
  const html = readFileSync(HTML_PATH, "utf8");
  const htmlCore = coreOf(html, "preview.html");
  const stripped = moduleCore.replace(/^export /gm, "");
  ok(htmlCore === stripped, "预览件核心段与 data/cot-router.mjs 同一变换后逐字节一致",
    `模块 ${moduleCore.length} B / 预览 ${htmlCore.length} B / 去 export 后 ${stripped.length} B`);
  // 把 HTML 的 core 真跑一遍：末行表达式作为返回值。
  const asModule = htmlCore;
  const coreRun = new Function(`${asModule}\nreturn { route, estimate, analyze, TIER_META, RATE_DEFAULT, renderRouterClause };`)();
  for (const [, text] of samples) {
    const a = analyze(text);
    const b = coreRun.analyze(text);
    ok(b.tier === a.tier, "预览件 core 判档一致", text.slice(0, 32));
    ok(Math.abs(b.estimate.money.blended - a.estimate.money.blended) < 0.01, "预览件 core 估价一致", text.slice(0, 32));
  }
  ok(coreRun.renderRouterClause().includes("T3"), "预览件可渲染注入条款");
  notes.push(`预览件 ${(html.length / 1024).toFixed(1)} KB · 核心段 ${moduleCore.length} B`);
}

// ── ④ 惰性注入集成：命中才装载，T1 不装载 ────────────────────────────────
// 口径：动态单元 L_cotrouter 由 data/lazy-sections.mjs 在编译期追加，判档用的就是本模块的
// route()——两边不许各判各的。T1 直给档不注入（一条命令能办的事不塞流程）。
{
  const dyn = compileLazy({ text: "帮我设计一个记账 App 的界面，要有预算环和月历", mode: "standard", bytes: 0 });
  ok(dyn.hits.some((h) => h.id === ROUTER_UNIT_ID), "T2 设计需求注入 L_cotrouter", dyn.hits.map((h) => h.id).join(","));
  ok(dyn.text.includes("T1") && dyn.text.includes("T3"), "注入正文含三档（与 renderRouterClause 同源）");
  ok(dyn.text.includes(renderRouterClause().slice(0, 80)), "注入正文逐字来自 renderRouterClause()");
  const quiet = compileLazy({ text: "这个报错怎么改：TypeError", mode: "standard", bytes: 0 });
  ok(!quiet.hits.some((h) => h.id === ROUTER_UNIT_ID), "T1 不注入（不装载）");
  const off = compileLazy({ text: "设计一个记账 App 界面", mode: "off", bytes: 0 });
  ok(off.bytes === 0 && off.hits.length === 0, "off 档整条丢弃（含动态单元）", String(off.bytes));
  const prev = process.env[LAZY_ROUTER_ENV];
  process.env[LAZY_ROUTER_ENV] = "0";
  const killed = compileLazy({ text: "设计一个记账 App 界面", mode: "standard", bytes: 0 });
  ok(!killed.hits.some((h) => h.id === ROUTER_UNIT_ID), `${LAZY_ROUTER_ENV}=0 关掉动态单元`);
  if (prev === undefined) delete process.env[LAZY_ROUTER_ENV];
  else process.env[LAZY_ROUTER_ENV] = prev;
  ok(lazyStats().dynamicUnits === 1, "lazyStats 报出 1 枚动态单元", JSON.stringify(lazyStats().dynamicIds));
  notes.push(`L_cotrouter ${Buffer.byteLength(renderRouterClause(), "utf8")} B · 仅在 T2/T3 命中时随惰性章节装载`);
}

// ── 报告 ───────────────────────────────────────────────────────────────
const report = {
  version: COT_VERSION,
  checks,
  failed: fails.length,
  ledger: rows,
  samples: est,
  notes,
};
if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`CoT Router 自检 ${COT_VERSION}`);
  console.log(`判档账本：${rows.length} 条 · 通过 ${rows.filter((r) => r.got === r.want).length}`);
  for (const r of rows) {
    if (r.got !== r.want) console.log(`  ✗ #${r.n} 期望 ${r.want} 实得 ${r.got} ［${r.rule}］`);
  }
  for (const [tier, e] of Object.entries(est)) {
    console.log(`  ${tier} ${e.tierName}：${e.billedHours} 人时 · ${e.calendarText} · 混合 ¥${e.money.blended}（AI ¥${e.money.ai} / 人工 ¥${e.money.human}）${e.maintenance ? ` · 维护 ¥${e.maintenance.monthly}/月` : ""}`);
  }
  for (const n of notes) console.log(`  · ${n}`);
  console.log(`断言：${checks - fails.length}/${checks} 通过`);
  for (const f of fails) console.log(`  ✗ ${f}`);
}
if (fails.length) process.exitCode = 1;
