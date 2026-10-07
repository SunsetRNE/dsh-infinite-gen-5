// 无限五代 v0.65.21 注入强度自检（真实宿主演习台，离线、无需 API Key、不连网）
//
// 与前一个自检的分工：verify_dedupe 用假宿主判「注册了什么」，本脚本把插件的
// apply() 真跑在 dsh 自带的 @deepseek-ai/dsh-system-prompt 服务上，判「装配出来后
// 到底排在哪」—— 因为 order 号只是声明，真正的拼接顺序由宿主的 assemble 瀑布决定：
//
//   1) Order 100 内核 + Order 200 中段锚点：普通段，按 order 排。
//   2) 真末位锚点：由 system-prompt/assemble 瀑布追加到 sections 数组末尾，
//      宿主对该返回值只做 complete 兜底与 `\n\n` 拼接（lib/index.js:355-359），
//      所以数组最后一项就是整份提示的最后一段 —— 即使宿主自己有 10200 人格后缀。
//   3) 运行时锚点：注册进 context() 槽，随运行时上下文快照发在每步最后一条 user
//      消息里；文本换新才重发（宿主 RuntimeContextProjection 会比对上一份快照）。
//
// 找不到宿主（裸机 / CI 容器）时打印 SKIP 并 exit 0：缺宿主是环境限制，不是回归。
// 用法：node scripts/verify_injection.mjs [--json] [--host=/path/to/dsh]
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reportHostMiss, resolveHost } from "./lib/host-resolve.mjs";
// 自检不碰用户真实统计库（v0.13.9）：给统计库指一个 /tmp 落点，跑完即弃。
process.env.IG5_STATS_FILE = "/tmp/ig5-stats-injection.json";
// 也不读用户真实调参档（v0.22.0）：调参档落点 = IG5_HOME ?? DSH_HOME ?? ~/.dsh，
// 而「设置页 / 浮层 UI」来源优先级高于环境变量与 config —— 本脚本有一半断言是靠
// IG5_*_MODE / IG5_EXCLUSIVE_SECTION 环境变量摆姿势的，只要开发机上点过一次档位面板
// （文件里落了 override），这些断言就会集体变红。先清一个临时 home 再导入插件。
process.env.IG5_HOME = "/tmp/ig5-home-injection";
rmSync("/tmp/ig5-home-injection", { recursive: true, force: true });
// 适配层（ig5-adapt:endpoint，order 101）要有缓存文件才多插一段，会把本脚本的
// 「装配顺序 / 注入位置」两条定长断言带偏。本套只考内核六段（首句层 + 内核 + 增强集 + 惰性 + 中段 + 末位）
process.env.IG5_ADAPT_CACHE = "/tmp/ig5-adapt-cache-injection-off.json";
rmSync("/tmp/ig5-adapt-cache-injection-off.json", { force: true });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const passes = [];
const failures = [];
let skips = 0;
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

// 注入计划读的是落盘的那份统计库（statsFile() 指到本脚本的 /tmp 落点）——
// 面板读侧走的是同一条路：同一个文件、同一批字段，不在自检里另写一个计划器副本。
function planOf() {
  if (!currentStatsPath) return null;
  try {
    return JSON.parse(readFileSync(currentStatsPath, "utf8"))?.runtime?.plan ?? null;
  } catch {
    return null;
  }
}

/**
 * 实况计划：读取路径与面板、模型工具完全一样（统计库读侧 / profile 工具），
 * 但这里刻意先看「本进程刚出的那一份」——落盘侧有 250ms 合流窗口，而计划是在装配瀑布里
 * 生成的；只读盘会在快速连改档位的断言里拿到 250ms 前的那份（看起来像「档位没生效」）。
 * 两个来源取 seq 更大的那个，语义上就是「最新那份计划」，不需要再靠 sleep 猜时间。
 */
function livePlan() {
  let disk = null;
  try {
    disk = planOf();
  } catch {
    disk = null;
  }
  let live = null;
  try {
    live = profileOf()?.injectionPlan ?? null;
  } catch {
    live = null;
  }
  if (disk && live) return Number(live.seq ?? 0) >= Number(disk.seq ?? 0) ? live : disk;
  return live ?? disk;
}

/**
 * 等落盘再读：统计库写侧有 250ms 合流窗口（STATS_FLUSH_MS），秒读会拿到上一份快照 ——
 * 断言就会对着旧计划判，看着像「档位没生效」。这里等的是**内容**而不是固定时长：
 * minSeq 之后的第一份计划一到就返回，超时则返回当下这一份（让断言自己报差异，而不是抛异常）。
 */
let lastBoot = null;      // 上一次读到的装配代数（每次 apply/rebuild 换一代）
let lastPlanSeq = null;   // 上一次读到的装配序号：同一个台子上必须递增；换台子后重置
let pendingBaseline = false;

/**
 * 读一份「这一轮真的出过的」计划：minSeq 之下不返回，并且（可选）认代数换新。
 * pendingBaseline 只在对一个**已经存在的**演习台改档位时置 true —— 那种场合必须等到
 * 新一代的第一份计划，否则读到的是改档位之前那一份，看起来就像「档位没生效」。
 */
async function planAfter(minSeq = 0, timeoutMs = 2500, want = null) {
  const wantBootChange = pendingBaseline;
  const staleBoot = lastBoot;
  const deadline = Date.now() + timeoutMs;
  const accept = (plan) => {
    if (!plan) return false;
    // want 是最强的一条判据：断言想读「某一档位下的那份计划」时直接写条件，
    // 别靠「等若干个 seq」去猜 —— 猜错就会对着一份中间态判，红的是断言而不是插件。
    if (typeof want === "function" && !want(plan)) return false;
    // 换台子后 seq 从头算；但每个台子有自己的库文件，所以这里只需要「同台子递增」这一条。
    // seq 给到就给足；不给时只要求「比上次读到的更新」。两个口径都防同一件事：
    // 统计库写侧有合流窗口，秒读会拿到上一个演习台留下的旧快照。
    const floor = Number(minSeq) > 0 ? Number(minSeq) : (lastPlanSeq ?? 0);
    if (Number(plan.seq) < floor) return false;
    if (lastPlanSeq !== null && Number(plan.seq) < Number(lastPlanSeq)) return false;
    return true;
  };
  for (;;) {
    const plan = livePlan();
    if (accept(plan)) {
      lastBoot = plan.boot;
      lastPlanSeq = plan.seq;
      pendingBaseline = false;
      return plan;
    }
    if (Date.now() > deadline) {
      // 到点了还差一口气：再让过一个合流窗口，然后如实返回盘上那一份（让断言自己报差异，
      // 而不是在这里抛异常 —— 门禁的价值在于说出「差在哪」，不是死给你看）。
      await new Promise((resolve) => setTimeout(resolve, FLUSH_SETTLE_MS));
      const fallback = livePlan();
      if (fallback) {
        lastBoot = fallback.boot ?? lastBoot;
        if (Number(fallback.seq) >= Number(lastPlanSeq ?? 0)) lastPlanSeq = fallback.seq;
        pendingBaseline = false;
      }
      return fallback;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

// 宿主服务自己会种三只默认段（harness:identity / deployment:persona-prefix /
// deployment:persona-suffix），所以这里只补两只探针段来还原 10200 之后的段位。
// 段位号抄宿主官方 SECTION_ORDERS 表：9000 交付物引用 / 9900 结构化输出 /
// 10000 HARNESS_SOURCE / 10100 WEB_SURFACE / 10200 人格后缀。
const HOST_SOURCE = { name: "test:harness-source", order: 10000, text: "HOST-SOURCE" };
const HOST_WEB_SURFACE = { name: "test:web-surface", order: 10100, text: "HOST-WEB-SURFACE" };
const HOST_SECTIONS = [HOST_SOURCE, HOST_WEB_SURFACE];
const KERNEL = "infinite-gen-5:global-system-prompt";
const BOOST = "infinite-gen-5:boost-corpus";
const LAZY = "infinite-gen-5:lazy-sections";
const LAYER2 = "infinite-gen-5:dual-layer-reinforce";
const TAIL = "infinite-gen-5:tail-anchor";
const RUNTIME = "infinite-gen-5:runtime-anchor";
// v0.42.0 批量交付臂：Order 170，惰性章节（160）之后、中段锚点（200）之前。
const BATCH = "infinite-gen-5:batch-arm";

// ── 找宿主：插件仓库里没有 node_modules，所以只能从 dsh 安装目录里取真模块 ──────
// 三形状解析（node_modules 父级 / @deepseek-ai 作用域目录 / dsh 包目录）见
// scripts/lib/host-resolve.mjs：0.2.0 的平铺布局与 0.1.7 的单体布局都能命中；
// 显式 --host= 找不到就直接 FAIL —— 回落别的宿主等于拿别的靶子刷绿（v0.38.2）。
const { host, candidates, explicit } = resolveHost();
if (!host) {
  reportHostMiss({
    script: "verify_injection.mjs",
    what: "注入强度自检",
    reason: "no dsh-system-prompt",
    candidates,
    explicit,
    json: process.argv.includes("--json"),
  });
}

const { Context } = await import(pathToFileURL(host.cordis).href);
const promptModule = await import(pathToFileURL(host.prompt).href);
const SystemPrompt = promptModule.default;
const { renderPrompt, joinContextSections, renderContextSections } = promptModule;
const plugin = await import(new URL("../index.js", import.meta.url).href);
const { IG5_CONFIG, askGateState } = plugin;
// v0.66.0：注入计划读的就是面板读的那份统计库（同一个文件、同一条路），
// 所以这里显式拿一次 stats-store 读写侧 —— 而不是另写一个计划器副本给自检用。
const stats = await import(new URL("../stats-store.mjs", import.meta.url).href);

const DEFAULTS = { ...IG5_CONFIG };
const restore = () => Object.assign(IG5_CONFIG, DEFAULTS);

// ── 演习台：真服务 + 模拟宿主自己的段位；apply() 用真 ctx（effect/on/tools 都是真的）──
// 同一进程里连开多个演习台（多份 apply）时，旧台上的 effect/监听器还挂在旧 ctx 上。
// cordis 的 Context 不 dispose 就一直活着，于是「上一台的计划器」会在本轮装配后二次落库 ——
// 读到的就是旧代的计划（实测：改档位后 seq 涨了、cap 却还是旧值）。所以每次开新台之前先
// 把上一台收掉；拿不到 dispose 就退化为「只保留最新一台写侧」，并如实记一条 SKIP。
/**
 * 同步点：统计库写侧有合流窗口（STATS_FLUSH_MS=250ms），本脚本的断言又跑得比它快。
 * 唯一稳的读法是「等落盘」，而在无法从读侧拿到「本轮序号」时，最省的那条路就是让过一个
 * 合流窗口再读 —— 但那样每读一次都要等 250ms，整条门禁会慢下来。
 * 这里两条一起用：先给最小 seq 闸门，闸门不满足时按 40ms 轮询；轮询到点还差一口气时，
 * 多等一个合流窗口再看一眼（而不是拿旧快照去判）。
 */
const FLUSH_SETTLE_MS = 320;
const liveRigs = [];
// 当前台子的库文件：每个台子一份（见 rig()），读侧必须跟着它走。
let currentStatsPath = null;
let profileOf = () => null;   // 当前台子的 profile 工具（读实况计划用）
async function disposeRigs() {
  while (liveRigs.length > 0) {
    const app = liveRigs.pop();
    try {
      if (app && typeof app.dispose === "function") await app.dispose();
      else if (app && typeof app.stop === "function") await app.stop();
    } catch {
      // 收尾失败不影响断言：退役的台子不再被读，只可能多写几次库。
    }
  }
}

let rigSeq = 0;
async function rig({ config = {}, hostSections = null, userQuestions = false } = {}) {
  await disposeRigs();
  lastPlanSeq = null;   // 新台子的 seq 从 1 起算，别拿旧台子的高位值卡它
  // 每个台子一份自己的统计库：本脚本要按「落盘的那份计划」判断言，而写侧有 250ms 合流窗口——
  // 多台子共用一份文件时，新台子的第一读会撞上台子留下的旧快照（实测：seq 涨了、cap 还是旧值）。
  // 一坑一文件之后，读到的计划必然出自本台子，交叉污染这一类假红从根上没了。
  rigSeq += 1;
  const statsPath = `/tmp/ig5-verify-injection-rig-${rigSeq}.json`;
  rmSync(statsPath, { force: true });
  process.env.IG5_STATS_FILE = statsPath;
  currentStatsPath = statsPath;
  const app = new Context();
  await app.plugin(SystemPrompt, {});
  const sp = app.get("systemPrompt");
  if (typeof sp?.section !== "function" || typeof sp?.assemble !== "function") {
    throw new Error("宿主 systemPrompt 服务没有 section()/assemble()，演习台假设已失效");
  }
  const tools = [];
  app.provide("tools", { register: (tool) => tools.push(tool) });
  // 能力闸探针（v0.20.0）：只有宿主真的注册了 userQuestions 服务，询问闸门才允许注入。
  if (userQuestions) app.provide("userQuestions", { ask: async () => ({ answers: [] }) });
  for (const section of hostSections ?? HOST_SECTIONS) {
    sp.section(section);
  }
  restore();
  Object.assign(IG5_CONFIG, config);
  // 每个演习台都是新一次 apply（装配代数 +1）：读计划前先让读侧知道「要等新一代」。
  pendingBaseline = true;
  plugin.apply(app, config);
  liveRigs.push(app);
  const assemble = () => sp.assemble({ agent: {}, scope: {} });
  // profile 是运行期快照：必须等装配完再读，否则拿到的是注册那一瞬间的实况。
  const profile = () => tools.find((tool) => tool.name === "infinite_gen5_profile")?.execute();
  profileOf = profile;   // livePlan() 用同一份实况（面板读的还是统计库那份）
  pendingBaseline = true;
  lastPlanSeq = null;
  return { app, sp, tools, assemble, profile, ctx: app };
}

const names = (assembly) => assembly.sections.map((s) => s.name);
const last = (arr) => arr[arr.length - 1];

// ---- 1. 默认档：三段注入，且真末位锚点确实排在 10200 人格后缀之后 ----
{
  const r = await rig();
  const assembly = await r.assemble();
  const order = names(assembly);
  check(order.includes(KERNEL) && order.includes(LAYER2), "内核与中段锚点都注册成功", JSON.stringify(order));
  check(
    JSON.stringify(order) ===
      JSON.stringify([
        // v0.37.0 首句层：Order -1100，排在宿主身份段 -1000 之前，是整份系统提示的第一句。
        "infinite-gen-5:first-line",
        "harness:identity",
        "deployment:persona-prefix",
        KERNEL,
        BOOST,
        LAZY,
        // v0.42.0 批量交付臂：Order 170，夹在惰性章节与中段锚点之间。
        BATCH,
        LAYER2,
        // v0.51.24 任务态：Order 300，补 200–499 空档（取向 · 槽位 · 阶段闸门）。
        "infinite-gen-5:task-mode",
        "test:harness-source",
        "test:web-surface",
        "deployment:persona-suffix",
        "infinite-gen-5:override-clause",
        TAIL,
      ]),
    "装配顺序：首句层（-1100）最前、宿主段按 order 排、真末位锚点被瀑布追加到最后",
    JSON.stringify(order),
  );
  check(last(order) === TAIL, "真末位锚点是最后一段", `实得末段 ${last(order)}`);
  const suffixAt = order.indexOf("deployment:persona-suffix");
  check(suffixAt >= 0 && order.indexOf(TAIL) > suffixAt, "真末位锚点排在宿主 10200 人格后缀之后");
  const tailText = assembly.sections.find((s) => s.name === TAIL)?.text ?? "";
  check(tailText.startsWith("[无限五代 · 真末位锚点]"), "末位锚点文本正确", tailText.slice(0, 30));
  check(tailText !== assembly.sections.find((s) => s.name === LAYER2)?.text, "末位锚点与中段锚点不是同一段文本");
  const rendered = renderPrompt(assembly);
  check(rendered.endsWith(tailText), "渲染后整份提示以末位锚点收尾");
  check(rendered.indexOf(tailText) > rendered.indexOf("[MODE: SANDBOX]"), "内核正文在锚点之前");
  check(assembly.contexts.some((c) => c.name === RUNTIME), "运行时锚点进了上下文槽", JSON.stringify(assembly.contexts.map((c) => c.name)));
  const runtimeText = assembly.contexts.find((c) => c.name === RUNTIME)?.text ?? "";
  check(/R#1\b/.test(runtimeText), "运行时锚点带序号", runtimeText.slice(0, 30));
  const snapshot = joinContextSections(runtimeText ? [{ text: runtimeText }] : []);
  check(snapshot.includes("supersedes earlier runtime-context snapshots"), "宿主快照头写明取代早前快照（权威表述最强的一格）");
  const profile = r.profile();
  // 末位锚点走瀑布 = 不占 section 命名空间，所以「注册段」是 7 个（v0.35.0 增强集、v0.36.0 惰性章节、
  // v0.37.0 首句层 -1100、v0.42.0 批量交付臂 170、v0.51.24 任务态 300）；但「注入位置」是 9 处
  // （首句层 -1100 / 内核 100 / 运行时 118 / 增强集 150 / 惰性 160 / 批量交付臂 170 / 中段 200 /
  // 任务态 300 / 真末位 10150）。
  check(profile?.injection?.length === 7, "profile 汇报 7 个注册段（末位锚点不占命名空间）", JSON.stringify(profile?.injection));
  check(profile?.injectionPlacements?.length === 10, "profile 汇报十处注入位置（首句层起算；v0.52.9 起接管裁决 9900 常驻在场）", JSON.stringify(profile?.injectionPlacements?.map((p) => p.order)));
  check(
    JSON.stringify((profile?.injectionPlacements ?? []).map((p) => p.order)) === "[-1100,100,118,150,160,170,200,300,9950,10150]",
    "注入位置按 order 排序（首句层 -1100 最前），真末位锚点标在 10150",
    JSON.stringify((profile?.injectionPlacements ?? []).map((p) => p.order)),
  );
  check(
    (profile?.injection ?? []).some((row) => row.section === BOOST && row.order === 150),
    "增强训练集落在 Order 150（内核之后、中段锚点之前）",
    JSON.stringify((profile?.injection ?? []).map((row) => `${row.section}@${row.order}`)),
  );
  check(
    /瀑布末端/.test(profile?.injectionPlacements?.find((p) => p.section === TAIL)?.where ?? ""),
    "profile 说明末位锚点坐落在 assemble 瀑布末端",
    profile?.injectionPlacements?.find((p) => p.section === TAIL)?.where,
  );
  check(profile?.injectionStrength?.tail?.mode === "waterfall", "profile 汇报末位锚点走瀑布");
  check(profile?.injectionStrength?.runtimeAnchor?.emissions === 1, "首轮装配发出 1 个运行时锚点版本", String(profile?.injectionStrength?.runtimeAnchor?.emissions));
}

// ---- 2. 节拍：文本不变则快照不重发，第 N 步换文本（N 从默认档读出，调默认值不必改断言）----
{
  const every = IG5_CONFIG.RUNTIME_ANCHOR_EVERY;
  const r = await rig();
  const texts = [];
  for (let step = 1; step <= every; step += 1) {
    const assembly = await r.assemble();
    texts.push(assembly.contexts.find((c) => c.name === RUNTIME)?.text ?? "");
  }
  check(
    texts.slice(0, every - 1).every((t) => t === texts[0]),
    `前 ${every - 1} 步上下文文本保持不变（不会每步刷屏）`,
    `N=${every}`,
  );
  check(texts[every - 1] !== texts[0], `第 ${every} 步换文本，触发宿主重发快照`);
  check(
    /R#1\b/.test(texts[0]) && new RegExp(`R#${every}\\b`).test(texts[every - 1]),
    "序号随节拍递增",
    `${texts[0].slice(0, 20)} … ${texts[every - 1].slice(0, 20)}`,
  );
  check(r.profile()?.injectionStrength?.runtimeAnchor?.emissions === 2, "profile 汇报本轮共发出 2 个版本", String(r.profile()?.injectionStrength?.runtimeAnchor?.emissions));
}

// ---- 3. 运行时锚点关掉后，上下文槽里不许留东西 ----
{
  const r = await rig({ config: { RUNTIME_ANCHOR_MODE: "off" } });
  const assembly = await r.assemble();
  check(!assembly.contexts.some((c) => c.name === RUNTIME), "RUNTIME_ANCHOR_MODE=off 时不注册上下文锚点");
  check(last(names(assembly)) === TAIL, "关掉运行时锚点不影响真末位锚点");
}

// ---- 3a. 询问/阶段闸门：纯判定边界（能力闸 × 用户口风闸 × 频次闸）----
{
  const gOk = askGateState({ mode: "auto", every: 4, rev: 4, hostSupportsAsk: true });
  check(gOk.enabled && gOk.reason === "节拍到点", "auto 档：能力位在场且到节拍时开闸", JSON.stringify(gOk));
  const gOffBeat = askGateState({ mode: "auto", every: 4, rev: 3, hostSupportsAsk: true });
  check(!gOffBeat.enabled && gOffBeat.reason === "未到节拍", "auto 档：没到节拍不开闸", JSON.stringify(gOffBeat));
  const gOff = askGateState({ mode: "off", every: 1, rev: 1, hostSupportsAsk: true });
  check(!gOff.enabled && gOff.reason === "档位 off", "off 档是下界：再快也不注入", JSON.stringify(gOff));
  const gSuppress = askGateState({ mode: "auto", every: 1, hostSupportsAsk: true, lastUserText: "别问，直接做" });
  check(!gSuppress.enabled && gSuppress.intent === "suppress", "用户说「别问」时即使到点也不注入", JSON.stringify(gSuppress));
  const gWant = askGateState({ mode: "auto", every: 4, rev: 1, hostSupportsAsk: true, lastUserText: "方向拿不准，给点建议？" });
  check(gWant.enabled && gWant.intent === "want", "用户口风要建议时立刻开闸，不等节拍", JSON.stringify(gWant));
  const gNoCap = askGateState({ mode: "auto", every: 1, hostSupportsAsk: false });
  check(!gNoCap.enabled && gNoCap.reason === "宿主无 userQuestions", "宿主没有提问服务时 auto 档不注入", JSON.stringify(gNoCap));
  const gForce = askGateState({ mode: "on", hostSupportsAsk: false, rev: 1 });
  check(gForce.enabled && gForce.capability === true, "on 档带降级句强行注入", JSON.stringify(gForce));
  // 主动档（v0.21.0 用户向选择）：任务输入必开 + 多步任务每一步都开，闲聊退回节拍。
  const gProEntry = askGateState({ mode: "proactive", every: 4, rev: 1, hostSupportsAsk: true });
  check(
    gProEntry.enabled && gProEntry.atEntry && gProEntry.full === true && gProEntry.reason === "任务输入：先给选择",
    "主动档：第 1 步（任务输入）无条件开闸并给全文合同",
    JSON.stringify(gProEntry),
  );
  const gProTask = askGateState({ mode: "proactive", every: 4, rev: 3, hostSupportsAsk: true, lastUserText: "第1步 装工具，第2步 跑，第3步 复验" });
  check(
    gProTask.enabled && gProTask.inTask && gProTask.full === false,
    "主动档：多步任务在跑时每一步都开闸，非节拍只给压缩复述",
    JSON.stringify(gProTask),
  );
  const gProIdle = askGateState({ mode: "proactive", every: 4, rev: 3, hostSupportsAsk: true, lastUserText: "顺便看看这个压缩包多大" });
  check(!gProIdle.enabled && gProIdle.reason === "未到节拍", "主动档：闲聊/单步仍退回节拍，不变成每步必问", JSON.stringify(gProIdle));
  const gProNoCap = askGateState({ mode: "proactive", every: 1, rev: 1, hostSupportsAsk: false });
  check(!gProNoCap.enabled && gProNoCap.reason === "宿主无 userQuestions", "主动档也受能力闸约束：无提问服务不注入", JSON.stringify(gProNoCap));
}

// ---- 3b. 询问/阶段闸门 E2E：真装配下的文本增删 ----
{
  const every = () => Math.max(1, IG5_CONFIG.ASK_GATE_EVERY);
  const userMsg = (text) => ({ type: "user/message", data: { content: [{ type: "text", text }] } });
  const runtimeTextOf = (assembly) => assembly.contexts.find((c) => c.name === RUNTIME)?.text ?? "";
  const rideCadence = async (r) => {
    let assembly = await r.assemble();
    for (let i = 1; i < every(); i += 1) assembly = await r.assemble();
    return assembly;
  };
  const noCap = await rig({ userQuestions: false });
  check(
    !runtimeTextOf(await rideCadence(noCap)).includes("用户向选择"),
    "宿主无 userQuestions 时撑到节拍也不注入询问条款",
  );
  const withCap = await rig({ userQuestions: true });
  const opened = runtimeTextOf(await rideCadence(withCap));
  check(opened.includes("用户向选择"), "宿主有 userQuestions 且到节拍时锚点出现询问条款", opened.slice(0, 60));
  check(/ask_user_question/.test(opened), "条款点名宿主工具名，不发明新工具");
  withCap.ctx.emit("session/event", {}, userMsg("别问，直接做"));
  check(
    !runtimeTextOf(await rideCadence(withCap)).includes("用户向选择"),
    "用户说「别问」后，下一拍不再注入询问条款",
  );
  withCap.ctx.emit("session/event", {}, userMsg("第1步 探测环境，第2步 装工具，第3步 复验"));
  // 条款只在锚点换文本的那一拍重算（cadence 语义：文本不变则快照不重发），所以撑满一拍再读。
  const phased = runtimeTextOf(await rideCadence(withCap));
  check(phased.includes("阶段闸门"), "多步任务时锚点出现阶段契约", phased.slice(0, 60));
  check(/做法：/.test(phased) && /判据：/.test(phased) && /产物：/.test(phased), "阶段契约给出三行骨架");
  check(/百分比只由面板/.test(phased), "阶段契约不发明百分比，指向面板单一真源");
  withCap.ctx.emit("session/event", {}, userMsg("今天几号"));
  check(!runtimeTextOf(await rideCadence(withCap)).includes("阶段闸门"), "单步任务不注入阶段契约");
}
// ---- 4. TAIL_MODE="order"：普通段排在 10150，会被 10200 人格后缀压住（这就是默认走瀑布的理由）----
{
  const r = await rig({ config: { TAIL_MODE: "order" } });
  const assembly = await r.assemble();
  const order = names(assembly);
  check(order.includes(TAIL), "order 档也注入末位锚点");
  // v0.52.9：接管裁决条款（9900）默认常驻，装配管线把「新段」追加在末尾，
  // 所以 order 档下最后一段可能是它；锚点被宿主人格后缀压住这一点仍由下一条断言守住。
  check(order.includes("deployment:persona-suffix") && order.indexOf(TAIL) < order.indexOf("deployment:persona-suffix"),
    "order 档下末位锚点仍被宿主人格后缀压住（接管条款可能追加在更后面）", JSON.stringify(order));
  check(order.indexOf(TAIL) < order.indexOf("deployment:persona-suffix"), "order 档的锚点排在人格后缀之前");
}

// ---- 5. EXCLUSIVE_SECTION：宿主其余段被裁掉，末位锚点并入内核文本（不许丢）----
{
  const r = await rig({ config: { EXCLUSIVE_SECTION: true } });
  const assembly = await r.assemble();
  const order = names(assembly);
  check(order.length === 1 && order[0] === KERNEL, "独占档只留下内核段", JSON.stringify(order));
  const kernelText = assembly.sections[0]?.text ?? "";
  check(kernelText.includes("[MODE: SANDBOX]"), "独占档内核正文还在");
  check(kernelText.includes("[无限五代 · 真末位锚点]"), "独占档把末位锚点并进了内核文本（没有被裁掉）");
  check(!assembly.sections.some((s) => s.name === TAIL), "独占档不再单独追加末位锚点段");
  check(r.profile()?.injectionStrength?.exclusive === true, "profile 汇报独占模式");
  check(
    (r.profile()?.dedupe?.skipped ?? []).some((s) => s.kind === "dropped"),
    "profile 记录中段锚点因独占被丢弃",
    JSON.stringify(r.profile()?.dedupe?.skipped),
  );
}

// ---- 6. 宿主没有 system-prompt/assemble 钩子时，末位锚点退化成 order 10150 普通段 ----
{
  // 用一个没有 on() 的假 ctx 走一遍降级路径（真宿主上不会发生，但老宿主/热重载会）。
  const tools = [];
  const fallbackSections = [];
  plugin.apply({
    systemPrompt: { section: (spec) => fallbackSections.push(spec), context: () => () => {} },
    tools: { register: (tool) => tools.push(tool) },
    effect: (fn) => fn(),
    get: () => undefined,
    inject: () => {},
  });
  const tail = fallbackSections.find((s) => s.name === TAIL);
  check(!!tail && tail.order === 10150, "瀑布不可用时退化为 order 10150 普通段", JSON.stringify(fallbackSections.map((s) => s.order)));
  check(
    tools.some((t) => t.name === "infinite_gen5_profile"),
    "降级路径上工具照常注册",
    JSON.stringify(tools.map((t) => t.name)),
  );
}

// ---- 7. 运行期调参：profile config 与 IG5_* 环境变量都能改生效档位（不必改代码重发布）----
{
  const r = await rig({ config: { RUNTIME_ANCHOR_EVERY: 2 } });
  check(
    r.profile()?.injectionStrength?.runtimeAnchor?.everySteps === 2,
    "profile config 改了运行时锚点节拍",
    String(r.profile()?.injectionStrength?.runtimeAnchor?.everySteps),
  );
  check(
    (r.profile()?.configOverrides ?? []).some((s) => s.startsWith("RUNTIME_ANCHOR_EVERY=2")),
    "profile 汇报覆盖来源（profile config）",
    JSON.stringify(r.profile()?.configOverrides),
  );
  const texts = [];
  for (let step = 1; step <= 3; step += 1) {
    const assembly = await r.assemble();
    texts.push(assembly.contexts.find((c) => c.name === RUNTIME)?.text ?? "");
  }
  const firstChange = texts.findIndex((t, i) => i > 0 && t !== texts[i - 1]);
  check(firstChange > 0 && firstChange <= 2, "节拍确实按 N=2 生效（默认 N=6 时前 5 步不变）", `首次换文本发生在第 ${firstChange + 1} 步`);

  process.env.IG5_RUNTIME_ANCHOR_MODE = "off";
  try {
    const r2 = await rig();
    const a2 = await r2.assemble();
    check(!a2.contexts.some((c) => c.name === RUNTIME), "环境变量 IG5_RUNTIME_ANCHOR_MODE=off 生效");
    check(
      (r2.profile()?.configOverrides ?? []).some((s) => s.includes("env IG5_RUNTIME_ANCHOR_MODE")),
      "profile 汇报覆盖来源（环境变量）",
      JSON.stringify(r2.profile()?.configOverrides),
    );
  } finally {
    delete process.env.IG5_RUNTIME_ANCHOR_MODE;
  }
  restore();
  const r3 = await rig();
  check(r3.profile()?.injectionStrength?.runtimeAnchor?.mode === "cadence", "去掉覆盖后回到默认档");
  check((r3.profile()?.configOverrides ?? []).length === 0, "没有覆盖时不虚报来源", JSON.stringify(r3.profile()?.configOverrides));
}

// ---- 13. 内核热加载（v0.28.1）：改盘上内核，不重启进程也要在下次装配生效 ----
// 回归背景：旧写法在模块加载时 readFileSync 一次，段文本注册后永不更新 ——
// 实测进程 07:39:52 启动、内核 08:08:37 改写，08:1x 起的子会话仍逐字引用旧三态条款。
{
  const kernelPath = join(ROOT, "prompts", "infinite-gen-5.md");
  const original = readFileSync(kernelPath, "utf8");
  const SENTINEL = "<!-- ig5-kernel-reload-probe -->";
  try {
    const r = await rig();
    const textOf = async () =>
      (await r.assemble()).sections.find((section) => section.name === KERNEL)?.text ?? "";
    const before = await textOf();
    check(before.includes("[MODE: SANDBOX]"), "内核段文本就位（哨兵测试的前置）");
    check(!before.includes(SENTINEL), "初始装配不含热加载哨兵");
    writeFileSync(kernelPath, `${original}\n${SENTINEL}\n`);
    const after = await textOf();
    check(after.includes(SENTINEL), "改盘上内核后无需重启进程即生效（热加载）", after.slice(-80));
    writeFileSync(kernelPath, original);
    const restored = await textOf();
    check(!restored.includes(SENTINEL), "还原内核文件后装配文本同步回退");
  } finally {
    writeFileSync(kernelPath, original);
  }
}

// ---- 14. 注入计划器（v0.66.0）：一份事实快照 → 一个计划 → 一个装配修改者 ----
// 这一段判的不是「注入了什么」（上面十三条已经判过），而是「计划与线上那一份对不对得上」：
// 计划说进了的段必须真在装配面上、bytes 必须与段文本一致、同一份事实快照的指纹必须稳定、
// 每个选中/丢弃的单元都必须带 reason。observe 档（默认）只读不写 —— 所以这些断言同时也是
// 「接线没改装配行为」的证据。
{
  const r = await rig();
  const textIn = (assembly, id) =>
    assembly.sections.find((s) => s.name === id)?.text
    ?? assembly.contexts.find((c) => c.name === id)?.text
    ?? null;
  // 计划读的是统计库 runtime.plan（面板读的同一个文件、同一条路）—— 读侧不重算，
  // 因为「第二个实现」迟早与线上漂移，而那正是这一版要消灭的那类问题。
  const first = await r.assemble();
  const p1 = await planAfter(0);   // rig() 已把 pendingBaseline 置上：等这一代的计划
  lastPlanSeq = Number(p1?.seq ?? 0);
  check(!!p1, "装配一轮后出了注入计划（统计库 runtime.plan）", JSON.stringify(p1)?.slice(0, 160));
  check(p1?.mode === "observe", "默认档只观测（一个字节不改装配）", String(p1?.mode));
  check(p1?.profile === "balanced", "默认策略档是 balanced", String(p1?.profile));
  check(
    typeof p1?.budget?.totalBytes === "number" && typeof p1?.budget?.ceiling === "number",
    "计划带字节账本（ceiling / totalBytes）",
    JSON.stringify(p1?.budget),
  );

  const selectedIds = (p1?.selected ?? []).map((row) => row.id);
  check(new Set(selectedIds).size === selectedIds.length, "选中项 id 不重复", JSON.stringify(selectedIds));
  check(
    (p1?.selected ?? []).every((row) => typeof row.reason === "string" && row.reason !== ""),
    "每个选中项都有 reason（面板要能回答「为什么注入」）",
    JSON.stringify((p1?.selected ?? []).map((row) => `${row.id}:${row.reason}`)),
  );
  check(
    (p1?.dropped ?? []).every((row) => typeof row.reason === "string" && row.reason !== ""),
    "每个丢弃项都有 reason",
    JSON.stringify(p1?.dropped),
  );
  check(
    (p1?.selected ?? []).every((row) => ["session", "turn", "step", "event", "assemble"].includes(row.ttl)),
    "每个选中项都带合法 ttl（残留到下一轮是最常见的错法）",
    JSON.stringify((p1?.selected ?? []).map((row) => `${row.id}:${row.ttl}`)),
  );

  // 计划 ↔ 装配面：计划里的段必须在场，且 bytes 与段文本逐字对得上（运行时锚点走 context 槽）。
  // LAZY 不在这一组里：它只在「命中触发词」时才拼回正文，本轮的输入为空、它渲染出空串 ——
  // 计划因此把它按 empty-render 丢掉，而它在装配面上的那一段本来就是空的。这不是漂移，
  // 断言口径必须区分「注册面恒在」（内核/首句层/任务态/批量臂/锚点）与「按触发词决定在不在」（惰性章节）。
  const dynamicIds = [BOOST, BATCH, RUNTIME];
  const missing = dynamicIds.filter((id) => !selectedIds.includes(id));
  check(missing.length === 0, "恒在场动态单元都进了计划", JSON.stringify(selectedIds));
  check(
    dynamicIds.every((id) => textIn(first, id) !== null),
    "计划说进了的段在装配面上真的在场",
    JSON.stringify(dynamicIds.filter((id) => textIn(first, id) === null)),
  );
  check(
    !selectedIds.includes(LAZY) && (p1?.dropped ?? []).some((row) => row.id === LAZY && row.reason === "empty-render"),
    "没命中触发词时惰性章节按空渲染丢掉（而不是留一个空段）",
    JSON.stringify((p1?.dropped ?? []).filter((row) => row.id === LAZY)),
  );
  const rowOf = (id) => (p1?.selected ?? []).find((row) => row.id === id);
  const bytePairs = dynamicIds.map((id) => {
    const text = textIn(first, id) ?? "";
    return `${id}:${rowOf(id)?.bytes}/${Buffer.byteLength(text, "utf8")}`;
  });
  check(
    dynamicIds.every((id) => rowOf(id)?.bytes === Buffer.byteLength(textIn(first, id) ?? "", "utf8")),
    "计划里的 bytes 与线上那一份逐字一致（同一份事实快照）",
    JSON.stringify(bytePairs),
  );
  check(
    (p1?.audit?.owned ?? []).includes(BOOST) && (p1?.audit?.owned ?? []).includes(RUNTIME),
    "计划自报归属清单（哪几个单元归它管）",
    JSON.stringify(p1?.audit),
  );
  check(p1?.audit?.ok === true, "计划与现状一致（无缺段、无多段）", JSON.stringify(p1?.audit));

  // 指纹：同一份事实快照重复装配 → 同一指纹；可选内容不变时选择也不变。
  const second = await r.assemble();
  const p2 = await planAfter(Number(p1?.seq ?? 1) + 1);
  check(!!p2 && p2.fingerprint === p1.fingerprint, "同一份事实快照 → 同一指纹（计划可复现）",
    `${p1?.fingerprint} vs ${p2?.fingerprint}`);
  check(
    Number(p2?.seq) > Number(p1?.seq),
    "装配序号单调推进（seq = 装配跑了几次）",
    JSON.stringify({ s1: p1?.seq, s2: p2?.seq }),
  );
  check(
    Number(p2?.revision) >= 1 && Number.isFinite(Number(p2?.revision)),
    "revision 是有限的正整数（同一份计划只 +1，不按装配次数暴涨）",
    JSON.stringify({ r1: p1?.revision, r2: p2?.revision }),
  );
  check(
    Number(p2?.seq) > Number(p1?.seq) && (p2?.selected ?? []).length === (p1?.selected ?? []).length,
    "重复装配不会多挂或少挂单元（同一选择、更新的 seq）",
    JSON.stringify({ s1: p1?.seq, s2: p2?.seq, n1: (p1?.selected ?? []).length, n2: (p2?.selected ?? []).length }),
  );

  // 单元数上限与命中率闸：都是「整单元」粒度，且必须留原因。
  const beforeMax = IG5_CONFIG.MAX_UNITS_PER_TURN;
  const beforeConf = IG5_CONFIG.MIN_TRIGGER_CONFIDENCE;
  try {
    // 单元数上限的口径是「档位给下限、调参只能放宽」：balanced 档 12 条，把键设成 20 才抬得动，
    // 设成 2 不会把上限压到 2（压下去会把无条件基线也挤掉，那是另一类故障而不是省上下文）。
    IG5_CONFIG.MAX_UNITS_PER_TURN = 20;
    pendingBaseline = true;              // 改档位 → 必须等改档位之后那一份计划
    await r.assemble();
    const p3 = await planAfter(Number(p2?.seq ?? 0) + 1);
    check(
      Number(p3?.ledger?.maxUnitsPerTurn) === 20,
      "单元数上限：调参放宽得动（档位是下限，不是上限）",
      JSON.stringify({ cap: p3?.ledger?.maxUnitsPerTurn }),
    );
    check(
      (p3?.selected ?? []).length === (p1?.selected ?? []).length && (p3?.selected ?? []).every((row) => row.bytes > 0),
      "放宽上限不会改变本轮选择，且留下的是完整单元（bytes 不为 0，不截半句）",
      JSON.stringify((p3?.selected ?? []).map((row) => `${row.id}:${row.bytes}`)),
    );
    IG5_CONFIG.MAX_UNITS_PER_TURN = 1;
    pendingBaseline = true;
    await r.assemble();
    const p3b = await planAfter(Number(p3?.seq ?? 0) + 1);
    check(
      Number(p3b?.ledger?.maxUnitsPerTurn) === 12 &&
        (p3b?.dropped ?? []).every((row) => row.reason !== "unit-cap"),
      "调参想把上限压到档位之下时不生效（只放宽、不收紧，不会把无条件基线挤掉）",
      JSON.stringify({ cap: p3b?.ledger?.maxUnitsPerTurn, dropped: (p3b?.dropped ?? []).map((d) => d.reason) }),
    );

    IG5_CONFIG.MAX_UNITS_PER_TURN = 12;
    IG5_CONFIG.MIN_TRIGGER_CONFIDENCE = 1;
    pendingBaseline = true;              // 同上：命中率闸变了，等新那一份
    await r.assemble();
    const p4 = await planAfter(Number(p3b?.seq ?? 1) + 1);
    check(
      (p4?.selected ?? []).some((row) => row.id === KERNEL) &&
        !(p4?.selected ?? []).some((row) => row.id === RUNTIME),
      "命中率闸拉满时基线仍在场、动态上下文被削（首句层/内核不能被挤掉）",
      JSON.stringify((p4?.selected ?? []).map((row) => row.id)),
    );
    check(
      (p4?.dropped ?? []).some((row) => row.reason === "low-confidence"),
      "被命中率闸削掉的单元带 low-confidence 原因",
      JSON.stringify((p4?.dropped ?? []).map((row) => `${row.id}:${row.reason}`)),
    );
  } finally {
    IG5_CONFIG.MAX_UNITS_PER_TURN = beforeMax;
    IG5_CONFIG.MIN_TRIGGER_CONFIDENCE = beforeConf;
    await r.assemble();
  }
}

// ---- 15. 注入计划器（v0.66.0）· apply 档：计划成为唯一动态写入者 ----
// observe 档证明「计划认得出现状」；这一段证明「apply 档下计划仍然自洽、且档位往返不留残留」——
// 这是整条链上唯一会改线上文本的档，所以单独判，且必须在同一个演习台上判（换台子等于换靶子）。
{
  const r = await rig();
  const prev = {
    mode: IG5_CONFIG.INJECTION_POLICY,
    profile: IG5_CONFIG.INJECTION_PROFILE,
    conf: IG5_CONFIG.MIN_TRIGGER_CONFIDENCE,
  };
  // 先取「换档前」的装配面与计划：这一段要判的是「同一台子、只换档位」的差异。
  const baseline = await r.assemble();
  const beforeNames = baseline.sections.map((s) => s.name).join(",");
  const baselineSeq = Number((await planAfter(1))?.seq ?? 0);
  let appliedSeq = baselineSeq;
  try {
    // 三个键一次性改齐再装配：分多次改会让「第一次装配读到半套档位」——
    // 那是本脚本自己的竞态，不是插件的（断言会变成对着一份中间态判）。
    IG5_CONFIG.INJECTION_POLICY = "apply";
    IG5_CONFIG.INJECTION_PROFILE = "minimal";
    IG5_CONFIG.MIN_TRIGGER_CONFIDENCE = 0.9;
    pendingBaseline = true;                       // 换档 → 等新一档的第一份计划
    const alt = await r.assemble();
    // 等「真的按 apply + minimal 算出来的」那一份：mode/profile 是硬判据，
    // 账本里的 domain 上限只是它的一个后果（下一段单独判）。
    const p = await planAfter(baselineSeq + 1, 2500, (x) => x.mode === "apply" && x.profile === "minimal");
    appliedSeq = Number(p?.seq ?? appliedSeq);
    check(p?.mode === "apply", "apply 档下计划自报 mode=apply", String(p?.mode));
    check(p?.profile === "minimal", "apply 档下策略档位如实汇报", String(p?.profile));
    check(
      (p?.selected ?? []).length > 0 && (p?.selected ?? []).every((row) => row.bytes > 0),
      "apply 档下选中项都带真实字节数（不做空段）",
      JSON.stringify((p?.selected ?? []).map((row) => `${row.id}:${row.bytes}`)),
    );
    check(
      (p?.ledger?.totals?.units ?? 0) === (p?.selected ?? []).length,
      "账本的单元数与选中项一致（账本不是另算一份）",
      JSON.stringify(p?.ledger?.totals),
    );
    check(
      (p?.budget?.totalBytes ?? 0) > 0 && (p?.budget?.totalBytes ?? 0) <= Math.max(1, IG5_CONFIG.SECTION_BUDGET_BYTES),
      "总字节不超过天花板",
      JSON.stringify(p?.budget),
    );
    check(
      (p?.dropped ?? []).every((row) => typeof row.id === "string" && row.id !== "" && typeof row.reason === "string"),
      "apply 档下丢弃项同样点名到单元 id + reason",
      JSON.stringify(p?.dropped),
    );
    check(alt.sections.length > 0 && alt.contexts.length > 0, "apply 档不会把装配打空");
    // minimal 档把动态格压到 6000 B：即便这一轮没削，账本也必须如实报出这一格的上限来
    check(
      (p?.ledger?.categories ?? []).some((row) => row.category === "domain" && row.cap === 6000),
      "minimal 档把动态格上限压到 6000 B（账本如实报出）",
      JSON.stringify((p?.ledger?.categories ?? []).map((row) => `${row.category}:${row.cap}`)),
    );
  } finally {
    IG5_CONFIG.INJECTION_POLICY = prev.mode;
    IG5_CONFIG.INJECTION_PROFILE = prev.profile;
    IG5_CONFIG.MIN_TRIGGER_CONFIDENCE = prev.conf;
    await r.assemble();
  }
  pendingBaseline = true;   // 调回默认档 → 同样等新一档的第一份计划
  const back = await r.assemble();
  const q = await planAfter(appliedSeq + 1);
  check(q?.mode === "observe", "调回 observe 档后计划自报回到 observe", String(q?.mode));
  check(
    back.sections.map((s) => s.name).join(",") === beforeNames,
    "档位往返后装配面回到原状（计划器不留残留）",
    `${beforeNames} → ${back.sections.map((s) => s.name).join(",")}`,
  );
}

const total = passes.length + failures.length;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ host: host.root, passed: passes.length, failed: failures.length, passes, failures }, null, 1));
} else {
  console.log(`宿主演习台：${host.root}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`\n注入强度检查：${passes.length} 通过 / ${failures.length} 失败（共 ${total} 条）`);
}
process.exit(failures.length === 0 ? 0 : 1);
