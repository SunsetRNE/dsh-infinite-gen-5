// 无限五代自检（统计数据库 + 任务清单 + 面板只读解耦）：统计数据库 + 任务清单 + 面板只读解耦
//
// 这一版把「插件本体 ↔ 前端面板」的关系翻过来：
//   核心（index.js） --写--> 统计数据库（infinite-gen-5-stats.json） --读--> 面板（client.js）
// 于是要守住三件事，缺一条这套解耦就是假的：
//   1) 库本身靠得住：原子写、防抖、读侧纯读、写失败不抛（统计是旁路，不许拖垮本体）；
//   2) 任务清单能力真接上了宿主：读 `todos` 投影，写走与官方工具同一条 `todo/write` 事件，
//      并且写前按宿主策略（恰好一个 in_progress）本地校验；
//   3) 面板**只**读库：不 import 插件内部、不自己算档位、不上行改档位以外的任何东西。
//
// 用假宿主把 apply() 真跑一遍，再直接驱动真实对象（工具 / 三条路由 / 会话事件），
// 而不是 grep 源码猜。用法：node scripts/verify_stats_panel.mjs [--json]
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATS_A = "/tmp/ig5-stats-panel-a.json";
const STATS_B = "/tmp/ig5-stats-panel-b.json";
for (const file of [STATS_A, STATS_B, `${STATS_A}.tmp-${process.pid}`, `${STATS_B}.tmp-${process.pid}`]) {
  rmSync(file, { force: true });
}
process.env.IG5_STATS_FILE = STATS_A;

const passes = [];
const failures = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}
const bytes = (value) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");

// 自检自己用的库版本：别写当前版本号（verify_version 会把它当未登记锚点），也别写超前版本号。
const TEST_VERSION = "0.1.0-test";
const plugin = await import(new URL("../index.js", import.meta.url).href);
const store = await import(new URL("../stats-store.mjs", import.meta.url).href);
const tasks = await import(new URL("../tasks.mjs", import.meta.url).href);
const { createStatsStore, emptyStats, statsFile, STATS_SCHEMA, STATS_PLUGIN } = store;

// ───────────────────────── 一、统计库本身 ─────────────────────────
check(statsFile() === STATS_A, "IG5_STATS_FILE 覆盖数据库路径（自检不碰用户真实库）", statsFile());

const skeleton = emptyStats("0.0.0");
const skeletonKeys = ["schema", "plugin", "version", "generatedAt", "boot", "runtime", "tuning", "coverage", "live", "tools", "tasks", "sessions", "counters"];
check(
  skeletonKeys.every((key) => key in skeleton) && skeleton.schema === STATS_SCHEMA && skeleton.plugin === STATS_PLUGIN,
  "空库骨架键齐全且带 schema/plugin 标识",
  Object.keys(skeleton).join(","),
);

const storeA = createStatsStore({ file: STATS_A, version: TEST_VERSION, flushMs: 0 });
storeA.set("counters", { a: 1 });
storeA.patch("counters", { b: 2 });
storeA.bump("tools.total");
storeA.bump("tools.total", 4);
storeA.bump(["tools", "calls", "infinite_gen5_scenario"]);
check(storeA.snapshot().counters.a === 1 && storeA.snapshot().counters.b === 2, "set 覆盖分区、patch 合并分区");
check(storeA.snapshot().tools.total === 5, "bump 累加（数字键与数组路径两种写法）", String(storeA.snapshot().tools.total));
for (let i = 0; i < 25; i += 1) storeA.push("tasks.writes", { at: String(i) }, 20);
check(storeA.snapshot().tasks.writes.length === 20, "push 只留最近 N 条", String(storeA.snapshot().tasks.writes.length));
check(existsSync(STATS_A), "flushMs=0 时改动立即落盘", STATS_A);
check(!existsSync(`${STATS_A}.tmp-${process.pid}`), "原子写不留下 tmp 残骸");
const onDisk = JSON.parse(readFileSync(STATS_A, "utf8"));
check(onDisk.schema === STATS_SCHEMA && onDisk.tools.total === 5, "盘上的库可解析且内容与内存一致");

// 防抖：多次改动只落一次盘
const debounced = createStatsStore({ file: STATS_B, version: TEST_VERSION, flushMs: 40 });
debounced.set("counters", { x: 1 });
debounced.bump("tools.total");
debounced.bump("tools.total");
const writesBeforeWait = debounced.writes;
await new Promise((resolve) => setTimeout(resolve, 120));
check(
  writesBeforeWait === 0 && debounced.writes === 1,
  "防抖合流：等待窗口内的多次改动只写一次盘",
  `before=${writesBeforeWait} after=${debounced.writes}`,
);

// 读侧纯读：读盘不改内存、不写盘
const writesBeforeRead = debounced.writes;
const readBack = debounced.read();
check(readBack !== null && readBack.schema === STATS_SCHEMA, "read() 读得到盘上的库");
check(debounced.writes === writesBeforeRead && debounced.dirty === false, "read() 纯读：不写盘、不置脏");
rmSync(STATS_B, { force: true });
check(debounced.read() === null, "盘上没有库时 read() 返回 null（不编一个假库出来）");

// 写失败只记录不抛（统计是旁路信息，绝不能把本体搞坏）
// 注意：别拿 /proc/... 当「不可写」样本 —— 本机对 procfs 的 mkdir 会直接卡死（实测 20s 无返回），
// /dev/null 下面建目录才是立刻 ENOTDIR 的正常失败样本。
const broken = createStatsStore({ file: "/dev/null/ig5-stats/stats.json", version: TEST_VERSION, flushMs: 0 });
let threw = null;
try {
  broken.set("counters", { nope: true });
} catch (error) {
  threw = error;
}
check(threw === null && broken.flush() === false && typeof broken.lastError === "string" && broken.lastError.length > 0,
  "写盘失败不抛异常，只在 lastError 留痕", String(broken.lastError).slice(0, 60));

// ───────────────────────── 二、任务清单规则（纯函数） ─────────────────────────
const { normalizeStatus, countStatuses, readTaskList, normalizeTodoPatch, TASK_MAX_ITEMS, TASK_MAX_CONTENT, TODOS_EVENT, TODOS_PROJECTION_KEY } =
  tasks;
check(TODOS_EVENT === "todo/write" && TODOS_PROJECTION_KEY === "todos", "写的是与官方工具同一条事件、读的是同一个投影键");
check(
  normalizeStatus("DONE") === "completed" && normalizeStatus("in-progress") === "in_progress" && normalizeStatus("什么鬼") === "pending",
  "状态别名归一：认不出来的当 pending（保守，不卡住模型）",
);
const counted = countStatuses([{ status: "completed" }, { status: "in_progress" }, { status: "pending" }, { status: "x" }]);
check(
  counted.completed === 1 && counted.inProgress === 1 && counted.pending === 2,
  "进度计数（completed / inProgress / pending）",
  JSON.stringify(counted),
);
const mirrored = readTaskList([{ content: "  挖洞  ", status: "doing" }, { content: "", status: "pending" }, "x"], { session: "s-1" });
check(
  mirrored.available === true && mirrored.items.length === 1 && mirrored.items[0].content === "挖洞" && mirrored.items[0].status === "in_progress",
  "读侧规范：去空白、丢空条目、状态归一",
  JSON.stringify(mirrored.items),
);
const emptyMirror = readTaskList(null);
check(emptyMirror.available === false && typeof emptyMirror.reason === "string", "投影为 null 时给出可读原因（而不是空列表装成功）");

const cleaned = normalizeTodoPatch([
  { content: "a", status: "pending" },
  { content: "a", status: "pending" },
  { content: "   ", status: "pending" },
  { content: "b".repeat(TASK_MAX_CONTENT + 30), status: "done" },
]);
check(cleaned.ok === true && cleaned.todos.length === 2 && cleaned.todos[1].content.length === TASK_MAX_CONTENT,
  "写侧规范：去重、丢空、超长截断", JSON.stringify(cleaned.repairs));
const capped = normalizeTodoPatch(Array.from({ length: TASK_MAX_ITEMS + 5 }, (_, i) => ({ content: `t${i}`, status: "pending" })));
check(capped.todos.length === TASK_MAX_ITEMS && capped.repairs.some((r) => r.includes("上限")), "写侧规范：条目数封顶");
const parallel = normalizeTodoPatch([{ content: "a", status: "in_progress" }, { content: "b", status: "in_progress" }]);
check(
  parallel.ok === true && parallel.todos.filter((t) => t.status === "in_progress").length === 1 &&
    parallel.todos[1].status === "pending" && parallel.repairs.some((r) => r.includes("降级")),
  "宿主策略「恰好一个 in_progress」：多出来的本地降级而不是整单被拒",
  JSON.stringify(parallel.todos),
);
check(normalizeTodoPatch([]).ok === false && normalizeTodoPatch("nope").ok === false, "没有可用条目 / 非数组 → 明确失败（不静默写空清单）");

// ───────────────────────── 三、真挂载：核心写库、路由只在读侧 ─────────────────────────
function fakeServer() {
  const routes = new Map();
  return {
    routes,
    register(spec) {
      routes.set(spec.path, spec);
      return () => routes.delete(spec.path);
    },
  };
}

function mountPanel(options = {}) {
  const server = options.server ?? fakeServer();
  const runtime = {
    tools: [],
    injects: [],
    listeners: new Map(),
    sections: new Map(),
    appends: [],
  };
  const todos = { value: options.todos ?? null, throws: options.throws === true };
  const projections =
    options.withProjections === false
      ? undefined
      : {
          stateOf() {
            if (todos.throws) throw new Error("投影炸了");
            return todos.value;
          },
        };
  const systemPrompt = {
    section(spec) {
      runtime.sections.set(spec.name, spec);
      return () => runtime.sections.delete(spec.name);
    },
    context() {
      return () => {};
    },
    layers: { merge: () => new Map(runtime.sections), global: { sections: { entries: () => runtime.sections.entries() } } },
  };
  // webServer / sessionProjections 都是宿主后挂的服务：真宿主里插件要 ctx.inject 等它就绪，
  // 所以这里也走 inject 路径（而不是让 ctx.get 直接返回），否则测不到真实接线方式。
  const indexInject = [];
  const ctx = {
    systemPrompt,
    tools: { register: (tool) => runtime.tools.push(tool) },
    effect: (fn) => {
      const dispose = fn();
      if (typeof dispose === "function") runtime.disposer = dispose;
    },
    get: (key) => (key === "sessionProjections" ? projections : undefined),
    inject: (keys, cb) => {
      const list = Array.isArray(keys) ? keys : [keys];
      if (list.includes("webServer")) {
        cb({
          get: (key) => (key === "webServer" ? server : undefined),
          effect: (fn) => fn(),
          on: (name, fn) => {
            if (name === "webserver/index-inject") indexInject.push(fn);
          },
        });
      } else if (list.includes("sessionProjections")) {
        cb({ get: () => projections, effect: (fn) => fn(), on: () => {} });
      }
    },
    on: (name, fn) => {
      const list = runtime.listeners.get(name) ?? [];
      list.push(fn);
      runtime.listeners.set(name, list);
    },
  };
  plugin.apply(ctx);
  // 宿主拼 index.html 时会拿一个 table 来收注入项，这里替它收一次。
  const table = [];
  for (const fn of indexInject) fn(table);
  for (const entry of table) if (entry && typeof entry.text === "string") runtime.injects.push(entry.text);
  const emit = (name, ...args) => {
    for (const fn of runtime.listeners.get(name) ?? []) fn(...args);
  };
  return { server, runtime, todos, emit, ctx };
}

function fakeSession(id) {
  const session = {
    header: { id },
    appends: [],
    append(type, data) {
      session.appends.push({ type, data });
    },
  };
  return session;
}

function fakeReq(method, body, token, url) {
  const handlers = new Map();
  const req = {
    method,
    // SSE 的鉴权走查询串（EventSource 带不了请求头），所以 url 必须能带上 token 被解析。
    url: url ?? "/",
    headers: token ? { "x-ig5-token": token } : {},
    socket: { remoteAddress: "127.0.0.1" },
    destroyed: false,
    on(name, fn) {
      const list = handlers.get(name) ?? [];
      list.push(fn);
      handlers.set(name, list);
      return req;
    },
    /** 测试里手动触发 close/error，模拟浏览器关标签页或断线。 */
    emit(name, ...args) {
      for (const fn of handlers.get(name) ?? []) fn(...args);
      return req;
    },
    destroy() {
      req.destroyed = true;
    },
  };
  if (body !== undefined) {
    setTimeout(() => {
      for (const fn of handlers.get("data") ?? []) fn(Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8"));
      for (const fn of handlers.get("end") ?? []) fn();
    }, 0);
  }
  return req;
}

function fakeRes() {
  const out = { status: null, headers: null, body: null, chunks: [], closed: false };
  const handlers = new Map();
  const res = {
    out,
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers;
    },
    /** SSE 长连接：每次 write 就是流里的一段（首帧 retry、data 帧、注释心跳都记下来）。 */
    write(chunk) {
      out.chunks.push(String(chunk));
      return true;
    },
    end(body) {
      if (body !== undefined) out.body = body;
      out.closed = true;
    },
    on(name, fn) {
      const list = handlers.get(name) ?? [];
      list.push(fn);
      handlers.set(name, list);
      return res;
    },
    emit(name, ...args) {
      for (const fn of handlers.get(name) ?? []) fn(...args);
      return res;
    },
  };
  return res;
}

/** 从流里挑出 data 帧并解析（注释心跳 `: ping` 与首帧 retry 都会被跳过）。 */
const sseFrames = (res) =>
  res.out.chunks
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6).trim()));

const call = async (server, path, method, body, token, url) => {
  const route = server.routes.get(path);
  if (!route) throw new Error(`没有注册路由 ${path}`);
  const res = fakeRes();
  await route.handler(fakeReq(method, body, token, url), res);
  let doc = null;
  try {
    doc = JSON.parse(res.out.body);
  } catch {
    doc = null;
  }
  return { status: res.out.status, doc, raw: res.out.body };
};

/** 打开一条 SSE 长连接：返回 {req,res}，测试里可以继续写库看它收到什么、再手动 close。 */
const openStream = async (server, path, token, url) => {
  const route = server.routes.get(path);
  if (!route) throw new Error(`没有注册路由 ${path}`);
  const res = fakeRes();
  const req = fakeReq("GET", undefined, token, url ?? path);
  await route.handler(req, res);
  return { req, res };
};

const mount = mountPanel({ todos: null });
const sink = plugin.statsSinkOf();
check(sink !== null && typeof sink.set === "function", "apply 后核心拿到了统计库写句柄（attachStatsSink 生效）");
check(existsSync(STATS_A), "apply 一结束盘上就有一份库（面板第一次读就有数据）");
const bootDoc = JSON.parse(readFileSync(STATS_A, "utf8"));
const pkgVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
check(bootDoc.version === pkgVersion, "库里的 version 是当前插件版本（读旧库也会刷新标识，面板能显示「我装的是哪一版」）", `${bootDoc.version} vs ${pkgVersion}`);
check(bootDoc.tuning !== null && typeof bootDoc.tuning.effective === "object",
  "库里已经有档位分区（面板不必再让服务端现算）", bootDoc.tuning === null ? "tuning=null" : "");

// ── 覆盖分区（v0.14.1）：面板的「领域 / 词表 / 预算」显示组只读这一份，数字由本体算 ──
const cov = bootDoc.coverage;
check(cov !== null && typeof cov === "object" && Number(cov.domains) > 0,
  "库里已经有覆盖分区（领域数 / 族分布 / 词表 / 预算）", cov === null ? "coverage=null" : "");
const scenarioMod = await import("../data/scenarios.mjs");
const familySum = Object.values(cov?.families ?? {}).reduce((sum, n) => sum + Number(n || 0), 0);
check(familySum === cov?.domains && cov?.domains === scenarioMod.SCENARIOS.length,
  "族分布之和 = 领域数 = SCENARIOS.length（面板条形图既不多数也不漏数）",
  `${familySum} vs ${cov?.domains} vs ${scenarioMod.SCENARIOS.length}`);
const uniqueMarkers = new Set(Object.values(scenarioMod.DOMAIN_MARKERS).flat());
check(cov?.markers?.total === uniqueMarkers.size &&
  cov.markers.latin + cov.markers.cjk + cov.markers.mixed === cov.markers.total,
  "标记表计数 = 去重后的真实标记数，且三种词形互斥求和相等",
  cov?.markers ? `${cov.markers.total} vs ${uniqueMarkers.size}` : "markers 缺失");
check(cov?.index?.bytes > 0 && cov.index.bytes <= cov.index.budget,
  "索引体积在预算内（见底会先在面板上转黄 / 转红）",
  cov?.index ? `${cov.index.bytes}/${cov.index.budget}` : "index 缺失");
check(cov?.playbooks?.min > 0 && cov.playbooks.max <= cov.playbooks.maxBytes,
  "单包体量落在护栏区间内（面板显示的上下限不是编的）",
  cov?.playbooks ? `${cov.playbooks.min}–${cov.playbooks.max}` : "playbooks 缺失");

// 取用分布：驱动真实领域工具，计数必须落进 coverage.hits / coverage.misses。
const scenarioToolRef = mount.runtime.tools.find((tool) => tool.name === "infinite_gen5_scenario");
const hitResult = scenarioToolRef.execute({ scenario: "web 渗透信息收集" });
const missResult = scenarioToolRef.execute({ scenario: "zzz 这个域根本不存在 zzz" });
const afterHit = plugin.statsSinkOf().snapshot();
check(hitResult.ok === true && afterHit.coverage.hits?.web >= 1,
  "领域工具被取用后按域计数（面板的「工具取用」来自真实调用）",
  JSON.stringify(afterHit.coverage.hits));
check(missResult.ok === false && afterHit.coverage.misses >= 1,
  "未命中也记账（面板能显示 miss 次数）", String(afterHit.coverage.misses));

// 四条路由 + 注入脚本
check(mount.server.routes.has("/infinite-gen-5/tuning"), "注册了调参路由");
check(mount.server.routes.has("/infinite-gen-5/stats"), "注册了统计库只读路由");
check(mount.server.routes.has("/infinite-gen-5/tasks"), "注册了任务清单路由");
check(mount.server.routes.has("/infinite-gen-5/events"), "注册了统计库变更推送路由（SSE）");
check([...mount.server.routes.values()].every((route) => route.kind === "exact"), "四条路由都是精确匹配（不吞宿主的其它路径）");
const injected = mount.runtime.injects.join("\n");
const win = {};
new Function("window", injected)(win);
const bridge = win.__IG5_STATS__;
// 每次 apply 都会新起一个统计库与一枚 token，所以按挂载实例取桥（不能复用上一个的 token）。
const bridgeOf = (m) => {
  const w = {};
  new Function("window", m.runtime.injects.join("\n"))(w);
  return w.__IG5_STATS__;
};
const sinkOf = () => plugin.statsSinkOf();
check(
  bridge && bridge.path === "/infinite-gen-5/stats" && bridge.tasksPath === "/infinite-gen-5/tasks" &&
    bridge.tuningPath === "/infinite-gen-5/tuning" && typeof bridge.token === "string" && bridge.token.length === 32,
  "注入的 __IG5_STATS__ 带三条路径与一次性 token",
  JSON.stringify(bridge),
);
check(win.__IG5_TUNING__ && win.__IG5_TUNING__.path === "/infinite-gen-5/tuning", "老面板要的 __IG5_TUNING__ 仍然注入（兼容不破）");

// 鉴权：无 token / 非回环一律拒绝
const noToken = await call(mount.server, "/infinite-gen-5/stats", "GET", undefined, undefined);
check(noToken.status === 401, "没带 token 读库 → 401", String(noToken.status));
const badToken = await call(mount.server, "/infinite-gen-5/stats", "GET", undefined, "x".repeat(32));
check(badToken.status === 401, "token 不对 → 401", String(badToken.status));

// 读侧：GET /stats 是纯读。先把防抖窗口里攒着的改动冲干净，
// 否则「读盘」与「后台 live 节拍恰好落盘」会在时间上撞车，把断言变成偶发。
sink.flush(true);
const beforeReadWrites = sink.writes;
const beforeReadFile = readFileSync(STATS_A, "utf8");
const readA = await call(mount.server, "/infinite-gen-5/stats", "GET", undefined, bridge.token);
check(readA.status === 200 && readA.doc.ok === true && readA.doc.source === "disk", "GET /stats 返回盘上那份库（source=disk）", String(readA.doc && readA.doc.source));
check(readA.doc.schema === STATS_SCHEMA && readA.doc.plugin === STATS_PLUGIN, "返回的确实是这份库（schema/plugin 对得上）");
check(sink.writes === beforeReadWrites && readFileSync(STATS_A, "utf8") === beforeReadFile, "GET /stats 不写盘、不改库（读侧纯读）");
const statsPost = await call(mount.server, "/infinite-gen-5/stats", "POST", { any: 1 }, bridge.token);
check(statsPost.status === 405, "POST /stats → 405（读侧不接受写，写入口在别处）", String(statsPost.status));
const tuningGet = await call(mount.server, "/infinite-gen-5/tuning", "GET", undefined, bridge.token);
check(tuningGet.status === 200 && typeof tuningGet.doc.effective === "object", "老路径 GET /tuning 也读库（不现算）");

// ── 推送（v0.15.0）：握手、鉴权口子、广播、上限、断开释放 ──
check(bridge.eventsPath === "/infinite-gen-5/events", "注入的 __IG5_STATS__ 带上推送路径", String(bridge.eventsPath));
const stream = await openStream(mount.server, "/infinite-gen-5/events", bridge.token);
check(
  stream.res.out.status === 200 &&
    String(stream.res.out.headers["content-type"]).startsWith("text/event-stream") &&
    stream.res.out.headers["cache-control"] === "no-store" &&
    stream.res.out.headers["x-accel-buffering"] === "no",
  "SSE 握手：200 + text/event-stream + no-store（顺手关掉中间层缓冲）",
  JSON.stringify(stream.res.out.headers),
);
check(stream.res.out.chunks[0] === "retry: 2000\n\n", "首帧是 retry 指令（断线后浏览器 2s 自己回来）", JSON.stringify(stream.res.out.chunks[0]));
const hello = sseFrames(stream.res)[0];
check(
  hello !== undefined && hello.type === "hello" && typeof hello.seq === "number" && hello.counts && typeof hello.counts.tools === "number",
  "连上就发 hello 帧（带落盘序号与几个计数）",
  JSON.stringify(hello),
);
// EventSource 不能带自定义请求头 → 推送路由必须认 ?token=，否则浏览器根本连不上
const viaQuery = await openStream(mount.server, "/infinite-gen-5/events", undefined, `/infinite-gen-5/events?token=${bridge.token}`);
check(viaQuery.res.out.status === 200, "推送路由接受 ?token=（EventSource 带不了请求头）", String(viaQuery.res.out.status));
const badQuery = await openStream(mount.server, "/infinite-gen-5/events", undefined, "/infinite-gen-5/events?token=deadbeef");
check(
  badQuery.res.out.status === 401 && !String(badQuery.res.out.headers["content-type"] || "").includes("text/event-stream"),
  "query token 不对 → 401（不放行、也不开流）",
  String(badQuery.res.out.status),
);
// 口子只开在推送路由上：读侧仍旧只认请求头
const statsViaQuery = await call(mount.server, "/infinite-gen-5/stats", "GET", undefined, undefined, `/infinite-gen-5/stats?token=${bridge.token}`);
check(statsViaQuery.status === 401, "读侧不接受 ?token=（这个口子只开给推送路由）", String(statsViaQuery.status));

// 库一变就广播：帧里只有信号，正文由面板回读 /stats（读路径永远只有一条）
const framesBefore = sseFrames(stream.res).length;
sink.bump("tools.total");
sink.flush(true);
const pushed = sseFrames(stream.res).at(-1);
check(
  sseFrames(stream.res).length > framesBefore && pushed !== undefined && pushed.type === "stats" &&
    typeof pushed.seq === "number" && pushed.counts && typeof pushed.counts.tools === "number",
  "落盘成功即广播 stats 帧（面板据此立刻回读，不必等 2s 轮询）",
  JSON.stringify(pushed),
);
check(
  pushed !== undefined && pushed.doc === undefined && JSON.stringify(pushed).length < 400,
  "帧里只有序号与计数、没有整库正文（不然推送就变成了第二条读路径）",
  String(pushed === undefined ? "" : JSON.stringify(pushed).length),
);

// 上限与释放：超了回 503 让面板回落轮询，断开后名额要还回来
const extra = [];
for (let i = 0; i < 3; i += 1) extra.push(await openStream(mount.server, "/infinite-gen-5/events", bridge.token));
const overflow = await openStream(mount.server, "/infinite-gen-5/events", bridge.token);
check(overflow.res.out.status === 503, "连接数到上限（4）→ 503（面板据此回落到轮询，不会傻等）", String(overflow.res.out.status));
for (const { req } of [stream, ...extra]) req.emit("close");
const afterClose = await openStream(mount.server, "/infinite-gen-5/events", bridge.token);
check(afterClose.res.out.status === 200, "客户端断开后释放名额（刷新页面重连不会被上限挡在门外）", String(afterClose.res.out.status));
afterClose.req.emit("close");

// 工具调用计数：驱动真实 render
const toolByName = (name) => mount.runtime.tools.find((tool) => tool.name === name);
const scenarioTool = toolByName("infinite_gen5_scenario");
check(scenarioTool !== undefined, "三个工具挂在假宿主上", mount.runtime.tools.map((t) => t.name).join(","));
const toolsBefore = sink.snapshot().tools.total;
scenarioTool.output.render({ query: "web" }, { ok: true, index: "x".repeat(200) });
const afterSmall = sink.snapshot();
check(afterSmall.tools.total === toolsBefore + 1 && afterSmall.tools.calls.infinite_gen5_scenario >= 1,
  "工具调用进库：总数 + 按工具名计数", JSON.stringify(afterSmall.tools.calls));
scenarioTool.output.render({ query: "web" }, { ok: true, blob: "y".repeat(60000) });
const afterBig = sink.snapshot();
check(afterBig.tools.truncated >= 1 && afterBig.tools.total === afterSmall.tools.total + 1,
  "超预算结果被闸降级并在库里留痕（truncated 计数）", JSON.stringify({ truncated: afterBig.tools.truncated }));
check(typeof afterBig.tools.lastCall === "object" && afterBig.tools.lastCall !== null, "库里记得最后一次调用（面板可以显示「刚跑过什么」）");

// 会话事件：镜像宿主清单
const session = fakeSession("sess-1");
mount.emit("session/created", session);
check(sink.snapshot().sessions.seen >= 1 && sink.snapshot().sessions.lastId === "sess-1", "会话创建进库：会话数与 lastId");
mount.todos.value = [
  { content: "勘察", status: "completed" },
  { content: "接线", status: "in_progress" },
  { content: "自检", status: "pending" },
];
mount.emit("session/event", session, { type: TODOS_EVENT, data: { todos: mount.todos.value } });
const mirroredDoc = sink.snapshot();
check(
  mirroredDoc.tasks.available === true && mirroredDoc.tasks.items.length === 3 &&
    mirroredDoc.tasks.counts.completed === 1 && mirroredDoc.tasks.counts.inProgress === 1 && mirroredDoc.tasks.session === "sess-1",
  "todo/write 事件 → 清单镜像进库（面板进度条要吃的那三个数）",
  JSON.stringify(mirroredDoc.tasks.counts),
);
mount.emit("session/event", session, { type: "user/message", data: {} });
check(sink.snapshot().sessions.events >= 2, "所有会话事件都计数（面板能看出「活着」）");
const mirroredAt = sink.snapshot().tasks.at;
mount.emit("session/event", session, { type: "assistant/message", data: {} });
check(sink.snapshot().tasks.at === mirroredAt, "非 todo 事件不重读投影（省掉每个事件白折一遍）");

// live 分区（v0.15.0）：把「本轮还在不在跑」变成库里的字段，而不是让面板去猜最后一行日志。
// live 由 1s 节拍 + 落盘回调发布，所以这里等一小会儿再看（否则测的是 apply 时的那一版快照）。
await new Promise((resolve) => setTimeout(resolve, 700));
const liveDoc = sink.snapshot().live;
check(
  liveDoc !== null && typeof liveDoc === "object" && liveDoc.turn && liveDoc.events && liveDoc.tools,
  "库里已经有 live 分区（本轮状态 / 事件速率 / 最近工具）",
  liveDoc === null ? "live=null" : "",
);
check(
  liveDoc?.turn?.active === true && liveDoc?.turn?.lastKind === "assistant/message" &&
    Number.isFinite(Date.parse(liveDoc?.turn?.startedAt ?? "")),
  "刚来过事件 → live.turn.active 为真，并记下本轮起点与最后一个事件类型",
  JSON.stringify(liveDoc?.turn),
);
check(
  liveDoc?.events?.count >= 1 && liveDoc?.events?.perSecond >= 0 && liveDoc?.events?.windowMs === 30000,
  "live.events = 最近 30s 窗口里的条数与速率",
  JSON.stringify(liveDoc?.events),
);
// v0.15.1 修：perSecond 曾经拿「进程生命周期」当分母（firstEventMs 永不重置），
// 而分子只数最近 30s —— 于是面板出现「9 次 / 30 秒（0.05 次/秒）」这种自相矛盾，长跑必归零。
check(
  liveDoc?.events?.count >= 1 && liveDoc?.events?.perSecond > 0,
  "perSecond 与 30s 窗口同分母：窗口里有事件就不可能算出 0",
  JSON.stringify(liveDoc?.events),
);
// v0.16.1：面板那行「N 次 / M 秒（x 次/秒）」里的 M 必须是算速率用过的分母。
// 30s 内条数没顶到环容量（EVENT_RING_SIZE = 60）时 M ≈ 30s；超过 2 次/秒、分子被环截断时，
// 只有 M 会把这件事如实暴露出来（windowMs 固定 30 秒会把「60 次」写成一个假分母）。
check(
  Number.isFinite(liveDoc?.events?.spanMs) && liveDoc.events.spanMs >= 1000 && liveDoc.events.spanMs <= 30000 &&
    Math.abs(liveDoc.events.perSecond - liveDoc.events.count / (liveDoc.events.spanMs / 1000)) < 0.01,
  "live.events.spanMs = 速率的真实分母（面板不再拿 windowMs 硬当 30 秒）",
  JSON.stringify(liveDoc?.events),
);
check(
  Array.isArray(liveDoc?.tools?.recent) && liveDoc.tools.recent.length >= 1 &&
    liveDoc.tools.recent.at(-1).tool === "infinite_gen5_scenario",
  "live.tools.recent 留下最近几次工具调用（面板的流水行）",
  JSON.stringify(liveDoc?.tools),
);

// 缺陷回归（v0.15.1）：live 分区曾经自己叫醒自己 ——
// patch("live") → 250 ms 后 flush → notify() → onChange → publishLive() → 又 patch("live") → …
// 老指纹里带着 idleMs（每毫秒都变）与 perSecond，于是「内容真的变了」永远成立：
// 只要发生过一个会话事件，此后哪怕彻底空闲也会 4–5 次/秒写盘，并同频推 SSE 帧（面板每帧回读一次全文库）。
// 这里量「稳定指纹是否真的稳定」：空闲窗口内最多容忍一次写盘/一帧 —— 那是本轮 active→idle 的翻转。
{
  const idleWritesFrom = sink.writes;
  const idleFramesFrom = sseFrames(stream.res).filter((f) => f.type === "stats").length;
  await new Promise((resolve) => setTimeout(resolve, 2200));
  const idleWrites = sink.writes - idleWritesFrom;
  const idleFrames = sseFrames(stream.res).filter((f) => f.type === "stats").length - idleFramesFrom;
  check(
    idleWrites <= 1 && idleFrames <= 1,
    "空闲 2.2s 内写盘与推帧都 ≤ 1（live 指纹稳定，不再自激空转）",
    `写盘 +${idleWrites} 次 / 推帧 +${idleFrames} 帧`,
  );
}

// sessions.lastAt 的语义：是「这个会话最近一次被处理的时间」，而不是「最近一次换会话」（v0.13.10 修）
await new Promise((resolve) => setTimeout(resolve, 5));
const beforeEvent = Date.now();
mount.emit("session/event", session, { type: "user/message", data: {} });
const afterEvent = Date.now();
const activityDoc = sink.snapshot();
const lastAtMs = Date.parse(activityDoc.sessions.lastAt);
check(
  Number.isFinite(lastAtMs) && lastAtMs >= beforeEvent && lastAtMs <= afterEvent,
  "sessions.lastAt 跟着每个事件刷新（换会话之外也要走）",
  JSON.stringify({ lastAt: activityDoc.sessions.lastAt, window: [beforeEvent, afterEvent] }),
);
check(
  activityDoc.sessions.seen === 1 && activityDoc.sessions.lastId === "sess-1",
  "同一会话反复来事件不会重复涨 sessions.seen",
  JSON.stringify({ seen: activityDoc.sessions.seen, lastId: activityDoc.sessions.lastId }),
);

// 面板写侧：restore 走与官方工具同一条事件
const restore = await call(mount.server, "/infinite-gen-5/tasks", "POST", { action: "restore" }, bridge.token);
const restoreAppend = session.appends.at(-1);
check(
  restore.status === 200 && restore.doc.ok === true && restoreAppend && restoreAppend.type === TODOS_EVENT &&
    restoreAppend.data.todos.length === 3 && restoreAppend.data.todos.filter((t) => t.status === "in_progress").length === 1,
  "「恢复上次清单」写的是 todo/write 事件（模型下一轮就能看见）",
  JSON.stringify(restoreAppend && restoreAppend.data),
);
check(sink.snapshot().tasks.writes_total >= 1 && sink.snapshot().tasks.writes.length >= 1, "清单写入进库留痕（写了几次、写了什么）");
const setBad = await call(mount.server, "/infinite-gen-5/tasks", "POST", { action: "nonsense" }, bridge.token);
check(setBad.status === 400, "未知 action → 400（不猜用户想干什么）", String(setBad.status));
const setGood = await call(mount.server, "/infinite-gen-5/tasks", "POST", {
  action: "set",
  todos: [{ content: "a", status: "in_progress" }, { content: "b", status: "in_progress" }, { content: "c", status: "pending" }],
}, bridge.token);
const setAppend = session.appends.at(-1);
check(
  setGood.status === 200 && setAppend.data.todos.filter((t) => t.status === "in_progress").length === 1 &&
    setGood.doc.repairs.length >= 1,
  "面板直接写入也过宿主策略（多 in_progress 本地降级并回报 repairs）",
  JSON.stringify(setGood.doc.repairs),
);
const badJson = await call(mount.server, "/infinite-gen-5/tasks", "POST", "{坏 json", bridge.token);
check(badJson.status === 400 && String(badJson.doc.error).includes("不是合法 JSON"), "坏 JSON 进写入口 → 400 且不抛（统一解析入口）", JSON.stringify(badJson.doc));

// 只读库的边界：没有可写会话时不假装成功
const mountB = (() => {
  process.env.IG5_STATS_FILE = STATS_B;
  return mountPanel({ todos: null });
})();
const bridgeB = bridgeOf(mountB);
const noSession = await call(mountB.server, "/infinite-gen-5/tasks", "POST", { action: "restore" }, bridgeB.token);
check(noSession.status === 400 && String(noSession.doc.error).includes("没有可写的会话"), "没有会话时明确失败（不静默成功）", JSON.stringify(noSession.doc));
const mountC = (() => {
  process.env.IG5_STATS_FILE = STATS_A;
  return mountPanel({ todos: null, withProjections: false });
})();
mountC.emit("session/created", fakeSession("sess-2"));
const noProjection = sinkOf().snapshot();
check(
  noProjection.tasks.available === false && String(noProjection.tasks.reason).includes("sessionProjections"),
  "宿主没有投影服务时，库里写明原因（面板照原话显示，不装作没清单）",
  String(noProjection.tasks.reason),
);
const throwing = (() => {
  process.env.IG5_STATS_FILE = STATS_A;
  return mountPanel({ todos: null, throws: true });
})();
throwing.emit("session/created", fakeSession("sess-3"));
check(String(sinkOf().snapshot().tasks.reason).includes("读 todos 投影失败"), "投影抛错被接住并写进库里（本体不因清单读失败而炸）", String(sinkOf().snapshot().tasks.reason));

// ───────────────────────── 四、面板只读库（源码级边界） ─────────────────────────
const indexSrc = readFileSync(join(ROOT, "index.js"), "utf8");
const clientSrc = readFileSync(join(ROOT, "client.js"), "utf8");
check((indexSrc.match(/JSON\.parse\(/g) || []).length === 1, "index.js 仍然只有一个 JSON.parse（唯一解析入口没被破坏）");
check(indexSrc.includes("session.append(TODOS_EVENT"), "index.js 的写侧走的是 todo/write 事件");
check(indexSrc.includes('stats.set("tuning"') && indexSrc.includes("publishStats"), "档位状态由核心发布进库（面板不再让服务端现算）");
check(clientSrc.includes("__IG5_STATS__") && clientSrc.includes("statsBridge") && clientSrc.includes("panelFetch"),
  "面板读的是注入的统计库桥（不是插件内部结构）");
check(clientSrc.includes("coverageGroup") && clientSrc.includes("db.coverage") && clientSrc.includes("armor5-cov-bar"),
  "面板新增「领域覆盖 · 词表 · 预算」显示组，画的都是库里 coverage 分区的数字");
check(clientSrc.includes("EventSource") && clientSrc.includes("eventsPath") && clientSrc.includes("encodeURIComponent"),
  "面板订阅统计库推送（EventSource + 查询串 token：EventSource 带不了自定义请求头）");
check(indexSrc.includes("text/event-stream") && indexSrc.includes("stats.onChange") && indexSrc.includes('stats.patch("live"'),
  "推送与 live 分区都由本体发布（面板不自己造数据）");
check(indexSrc.includes("allowQueryToken") && /guardPanelRequest\(req, res, \{ allowQueryToken: true \}\)/.test(indexSrc),
  "?token= 这个口子只开在推送路由上（其余读/写路由仍旧只认请求头）");
check(!clientSrc.includes("56 域 × 7 族"),
  "面板不再硬编码领域数（改读统计库，域数 56 → 62 时面板自动跟上）");
check(!/setInterval\s*\(/.test(clientSrc) && clientSrc.includes("setTimeout(tick"), "面板轮询用注入的定时器（自续 setTimeout），不碰全局 setInterval");
check(
  (clientSrc.match(/JSON\.parse\(/g) || []).length === 1 && /JSON\.parse\(store\.getItem\(PREF_KEY\)/.test(clientSrc),
  "面板只解析自己写在 localStorage 的偏好，不解析任何 HTTP 负载（读到的就是库）",
);
check(!/require\(["']node:/.test(clientSrc) && !clientSrc.includes("import "), "面板不 import 插件内部（耦合只留在 HTTP 契约上）");
check(clientSrc.includes("已在本地拦截") && clientSrc.includes("TUNING_BODY_LIMIT = 8192"),
  "面板保留了 v0.13.8 的请求体预检（解耦不等于丢掉护栏）");
check(readFileSync(join(ROOT, "prompts/infinite-gen-5.md"), "utf8").includes("Task-list rule"),
  "内核里写进了任务清单纪律（能力要配上习惯）");

// ───────────────────────── 汇总 ─────────────────────────
for (const file of [STATS_A, STATS_B, `${STATS_A}.tmp-${process.pid}`, `${STATS_B}.tmp-${process.pid}`]) {
  rmSync(file, { force: true });
}
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ passes: passes.length, failures, ok: failures.length === 0 }, null, 2));
} else {
  console.log(`无限五代 统计库与面板自检： ${passes.length} 通过 / ${failures.length} 失败`);
  for (const item of failures) console.log(`  ✗ ${item}`);
  if (failures.length === 0) console.log(`  数据库 schema=${STATS_SCHEMA} · 路由 4 条（其中 1 条 SSE 推送）· 面板只读`);
}
process.exit(failures.length === 0 ? 0 : 1);
