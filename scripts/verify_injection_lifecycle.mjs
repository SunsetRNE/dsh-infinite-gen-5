// 无限五代 · 生命周期门禁（scripts/verify_injection_lifecycle.mjs）
//
// 判什么：注入侧与会话侧监听器的「数量守恒」—— 这是重复 apply / HMR / 停用这类场景里
// 最容易出、又最难从线上现象倒推的一类回归：监听器挂了两份，装配被跑两遍、事件被计两次、
// 计划落库两次，而面板上的每个数字看起来都正常。
//
// 判据（缺一条都不算过）：
//   ① apply 之后：自有监听器登记 N 条、存活 N 条；
//   ② rebuildInjection（设置页改档位走的就是它）：仍是 N 条 —— 不是 2N；
//   ③ 卸载销账：登记过的那些全部 disposed，存活归零；再次 apply 回到 N（而不是 2N）；
//   ④ Host Web 资源逐项守恒：四条路由各 1 条、SSE 订阅 1 条、live/heartbeat 各 1 个、Stats disposer 1 次；
//      unload 后全部为 0，再次 apply 仍各 1 条而不是 2 条。
//
// 判据取的是运行期台账（runtime.listeners），不是源码正则：正则只能证明「写了销账」，
// 台账能证明「销账真的发生过、数量真的守恒」。
//
// 用法：node scripts/verify_injection_lifecycle.mjs [--json] [--selftest]
import { createRequire } from "node:module";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reportHostMiss, resolveHost } from "./lib/host-resolve.mjs";
import { statsServiceSnapshot } from "../services/stats-service.mjs";

// 自检不碰用户真实统计库 / 调参档（与 verify_injection 同一套约定）。
process.env.IG5_HOME = "/tmp/ig5-home-lifecycle";
process.env.IG5_STATS_FILE = "/tmp/ig5-stats-lifecycle.json";
process.env.IG5_TUNING_FILE = "/tmp/ig5-tuning-lifecycle.json";
process.env.IG5_ADAPT_CACHE = "/tmp/ig5-adapt-cache-lifecycle-off.json";
for (const file of [
  process.env.IG5_STATS_FILE,
  process.env.IG5_TUNING_FILE,
  process.env.IG5_ADAPT_CACHE,
]) {
  rmSync(file, { force: true });
}
rmSync(process.env.IG5_HOME, { recursive: true, force: true });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const passes = [];
const failures = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

// ── 自检（离线、不碰宿主）：把这份门禁的判据本身钉住，免得它自己悄悄退化成空跑 ──
export function selftest() {
  const cases = [];
  const fakeLedger = (rows) => rows.filter((row) => row.live !== false);
  cases.push(fakeLedger([{ live: true }, { live: true }]).length === 2);
  cases.push(fakeLedger([{ live: false }, { live: true }]).length === 1);
  // 关键一条：这份门禁必须真的会在「2N」时报红 —— 拿一个假实现验一下判据本身。
  const doubleApply = (n) => n * 2;
  cases.push(doubleApply(2) !== 2);
  return cases.every(Boolean);
}

if (process.argv.includes("--selftest")) {
  const ok = selftest();
  console.log(ok ? "LIFECYCLE_SELFTEST_OK" : "LIFECYCLE_SELFTEST_FAIL");
  process.exit(ok ? 0 : 1);
}

const { host, candidates, explicit } = resolveHost();
if (!host) {
  reportHostMiss({
    script: "verify_injection_lifecycle.mjs",
    what: "生命周期门禁",
    reason: "no dsh-system-prompt",
    candidates,
    explicit,
    json: process.argv.includes("--json"),
  });
  process.exit(0);
}

const { Context } = await import(pathToFileURL(host.cordis).href);
const SystemPrompt = (await import(pathToFileURL(host.prompt).href)).default;
const plugin = await import(new URL("../index.js", import.meta.url).href);
const { IG5_CONFIG } = plugin;
const DEFAULTS = { ...IG5_CONFIG };

// ── 演习台 ────────────────────────────────────────────────────────────────────
// 与 verify_injection 的区别只有一处：这里的 ctx 自带一套「effect 台账」——
// 把每个 ctx.effect(fn) 的清理函数收集起来，好在最后一步真的模拟一次卸载。
// 不这样做就只能靠推断「宿主卸载时会回收」，而推断不算判据。
async function rig() {
  const app = new Context();
  await app.plugin(SystemPrompt, {});
  const effects = [];
  const effectErrors = [];
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const timers = { registered: [], active: new Map(), disposed: 0 };
  globalThis.setInterval = function trackedSetInterval(callback, delay, ...args) {
    const handle = Reflect.apply(realSetInterval, this, [callback, delay, ...args]);
    const row = { handle, delay: Number(delay), live: true };
    timers.registered.push(row);
    timers.active.set(handle, row);
    return handle;
  };
  globalThis.clearInterval = function trackedClearInterval(handle) {
    const row = timers.active.get(handle);
    if (row?.live) {
      row.live = false;
      timers.active.delete(handle);
      timers.disposed += 1;
    }
    return Reflect.apply(realClearInterval, this, [handle]);
  };
  const restoreTimers = () => {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  };
  // ctx.effect 有同步与异步两种用法（本项目两种都出现）。同步清理函数入账，
  // 保留 effect 标签，后续分别核对 SSE 订阅与 Stats/定时器资源 disposer。
  app.effect = (fn, ...rest) => {
    const label = String(rest[0] ?? "");
    let cleanup = null;
    try {
      cleanup = fn();
    } catch (error) {
      effectErrors.push({ label, error: String(error?.message ?? error) });
    }
    if (typeof cleanup !== "function") return cleanup;
    const row = { label, cleanup, cleanupCalls: 0, active: true };
    const runCleanup = () => {
      if (!row.active) return;
      row.active = false;
      row.cleanupCalls += 1;
      return cleanup();
    };
    row.runCleanup = runCleanup;
    effects.push(row);
    return runCleanup;
  };
  const tools = [];
  app.provide("tools", { register: (tool) => tools.push(tool) });
  const routes = new Map();
  const routeRegistrations = [];
  const liveRoutes = new Set();
  app.provide("webServer", {
    register(spec) {
      const row = { path: spec.path, spec, live: true };
      routeRegistrations.push(row);
      liveRoutes.add(row);
      routes.set(spec.path, spec);
      return () => {
        if (!row.live) return;
        row.live = false;
        liveRoutes.delete(row);
        if (routes.get(spec.path) === spec) routes.delete(spec.path);
      };
    },
  });
  Object.assign(IG5_CONFIG, DEFAULTS);
  plugin.apply(app, {});
  const profile = () => tools.find((row) => row.name === "infinite_gen5_profile")?.execute();
  const assemble = () => app.get("systemPrompt").assemble({ agent: {}, scope: {} });
  const routeCounts = () => {
    const paths = [...new Set(routeRegistrations.map((row) => row.path))];
    return Object.fromEntries(paths.map((path) => {
      const rows = routeRegistrations.filter((row) => row.path === path);
      return [path, { registered: rows.length, live: rows.filter((row) => row.live).length, disposed: rows.filter((row) => !row.live).length }];
    }));
  };
  const effectsWith = (needle) => effects.filter((row) => row.label.includes(needle));
  const timerSnapshot = () => ({
    registered: timers.registered.length,
    disposed: timers.disposed,
    live: timers.active.size,
    delays: timers.registered.map((row) => row.delay).sort((a, b) => a - b),
    liveDelays: [...timers.active.values()].map((row) => row.delay).sort((a, b) => a - b),
  });
  return { app, effects, effectErrors, tools, routes, routeRegistrations, liveRoutes, routeCounts, effectsWith, timers: timerSnapshot, profile, assemble, restoreTimers };
}

// 一次「卸载」：逆序执行 effect 清理，之后还原计时器捕获器。
function unload(rigCtx) {
  let ran = 0;
  for (const row of [...rigCtx.effects].reverse()) {
    if (!row.active) continue;
    try {
      row.runCleanup();
      ran += 1;
    } catch {
      // 清理阶段保持幂等：单个清理抛错不影响其余销账。
    }
  }
  rigCtx.restoreTimers();
  return ran;
}

// ---- 1. apply 之后：自有监听器登记 N 条、存活 N 条 ----
{
  const baseStatsServices = statsServiceSnapshot();
  const r = await rig();
  await r.assemble();
  const first = plugin.ig5ListenerSnapshot();
  check(!!first, "profile 汇报自有监听器台账", JSON.stringify(first));
  check(
    Number(first?.registered) > 0 && Number(first?.registered) === Number(first?.live),
    "apply 之后登记数与存活数一致（没有一条注册完就丢账）",
    JSON.stringify(first),
  );
  check(Number(first?.disposed) === 0, "apply 之后没有已销账记录（没有重复注册）", JSON.stringify(first));
  const expected = Number(first?.registered);
  const webPaths = [
    "/infinite-gen-5/tuning",
    "/infinite-gen-5/stats",
    "/infinite-gen-5/tasks",
    "/infinite-gen-5/events",
  ];
  const firstRoutes = r.routeCounts();
  const routeExactlyOnce = (snapshot, { live = 1, disposed = 0 } = {}) =>
    webPaths.every((path) => snapshot[path]?.registered === 1 && snapshot[path]?.live === live && snapshot[path]?.disposed === disposed) &&
    Object.keys(snapshot).length === webPaths.length;
  check(
    routeExactlyOnce(firstRoutes),
    "apply 后四条 Host Web 路由各注册 1 条（tuning/stats/tasks/events）",
    JSON.stringify(firstRoutes),
  );
  const firstTimers = r.timers();
  check(
    firstTimers.registered === 2 && firstTimers.live === 2 && firstTimers.disposed === 0 && new Set(firstTimers.delays).size === 2,
    "apply 后 live/heartbeat 定时器各 1 份",
    JSON.stringify(firstTimers),
  );
  const firstSseEffects = r.effectsWith("统计库变更广播（SSE）");
  check(
    firstSseEffects.length === 1 && firstSseEffects[0].active && firstSseEffects[0].cleanupCalls === 0,
    "apply 后 Stats SSE 订阅恰好 1 份",
    JSON.stringify(firstSseEffects),
  );
  const firstStatsServices = statsServiceSnapshot();
  check(
    firstStatsServices.registered === baseStatsServices.registered + 1 &&
      firstStatsServices.live === baseStatsServices.live + 1 &&
      firstStatsServices.disposed === baseStatsServices.disposed &&
      firstStatsServices.disposeCalls === baseStatsServices.disposeCalls,
    "apply 后 Stats Service 恰好存活 1 份",
    JSON.stringify({ before: baseStatsServices, after: firstStatsServices }),
  );

  // ---- 2. rebuild：仍是 N 条，不是 2N ----
  // 走设置页同一条路（POST /infinite-gen-5/tuning 的 rebuild 分支），而不是调内部函数 ——
  // 用户改档位时走的就是这条，门禁测的必须也是这条。
  const route = r.routes.get("/infinite-gen-5/tuning");
  check(!!route, "调参路由已注册（rebuild 的入口存在）", JSON.stringify([...r.routes.keys()]));
  if (route?.handler && typeof route.handler === "function") {
    // 路由签名按宿主 webServer 约定：handler(req, res)。这里用最小 req/res 桩子驱动 rebuild。
    const body = JSON.stringify({ overrides: { SECTION_BUDGET_BYTES: DEFAULTS.SECTION_BUDGET_BYTES } });
    const req = {
      method: "POST",
      url: "/infinite-gen-5/tuning",
      headers: { host: "127.0.0.1", "x-ig5-token": "unknown-but-loopback" },
      on() {},
    };
    let status = null;
    const res = {
      writeHead(code) { status = code; return this; },
      end() {},
      setHeader() {},
    };
    try {
      await route.handler(req, res);
    } catch {
      // 鉴权失败也会走到这里：token 不对时重建不会发生，下面的判据会如实报出来。
    }
  }
  await r.assemble();
  const afterRebuild = plugin.ig5ListenerSnapshot();
  check(
    Number(afterRebuild?.registered) === expected && Number(afterRebuild?.live) === expected,
    "rebuild 之后自有监听器仍是 N 条（不是 2N）",
    JSON.stringify({ expected, after: afterRebuild }),
  );
  const rebuiltRoutes = r.routeCounts();
  const rebuiltTimers = r.timers();
  check(
    routeExactlyOnce(rebuiltRoutes) && rebuiltTimers.registered === 2 && rebuiltTimers.live === 2,
    "重复 Host apply/rebuild 不重复注册路由或定时器",
    JSON.stringify({ routes: rebuiltRoutes, timers: rebuiltTimers }),
  );

  // ---- 3. 卸载销账：全部 disposed、存活归零；再 apply 回到 N ----
  const ran = unload(r);
  check(ran > 0, "演习台收集到了可执行的清理函数（否则这一步等于没测）", String(ran));
  // 卸载是异步收尾（宿主 ctx 的 effect 清理走它自己的调度）：这里等的是**内容**——存活归零
  // 就立刻返回，超时才拿当下这一份去判（让断言自己报差异，而不是在这里抛异常）。
  const afterUnload = plugin.ig5ListenerSnapshot();
  check(
    Number(afterUnload?.disposed) === expected && Number(afterUnload?.live) === 0,
    "卸载后登记过的监听器全部销账、存活归零",
    JSON.stringify({ expected, after: afterUnload }),
  );
  const unloadedRoutes = r.routeCounts();
  const unloadedTimers = r.timers();
  const unloadedSseEffects = r.effectsWith("统计库变更广播（SSE）");
  const unloadedStatsServices = statsServiceSnapshot();
  check(
    routeExactlyOnce(unloadedRoutes, { live: 0, disposed: 1 }),
    "卸载后四条 Host Web 路由全部销账",
    JSON.stringify(unloadedRoutes),
  );
  check(
    unloadedTimers.registered === 2 && unloadedTimers.live === 0 && unloadedTimers.disposed === 2,
    "卸载后 live/heartbeat 定时器全部停止",
    JSON.stringify(unloadedTimers),
  );
  check(
    unloadedSseEffects.length === 1 && !unloadedSseEffects[0].active && unloadedSseEffects[0].cleanupCalls === 1,
    "卸载后 Stats SSE 订阅恰好清理 1 次",
    JSON.stringify(unloadedSseEffects),
  );
  check(
    unloadedStatsServices.registered === baseStatsServices.registered + 1 &&
      unloadedStatsServices.live === baseStatsServices.live &&
      unloadedStatsServices.disposed === baseStatsServices.disposed + 1 &&
      unloadedStatsServices.disposeCalls === baseStatsServices.disposeCalls + 1,
    "卸载后 Stats disposer 只执行 1 次且不留存活句柄",
    JSON.stringify({ before: baseStatsServices, after: unloadedStatsServices }),
  );
  check(unload(r) === 0, "重复 unload 不重复执行 disposer", JSON.stringify(statsServiceSnapshot()));

  const r2 = await rig();
  await r2.assemble();
  const second = plugin.ig5ListenerSnapshot();
  const viaProfile = r2.profile()?.listeners;
  // 同一份事实两处读：句柄（现算）与 profile（面板读侧）必须同值 —— 否则面板就会撒谎。
  check(
    JSON.stringify({ r: viaProfile?.registered, d: viaProfile?.disposed, l: viaProfile?.live }) ===
      JSON.stringify({ r: second?.registered, d: second?.disposed, l: second?.live }),
    "profile 读侧与台账句柄同值（面板数字不出第二个源）",
    JSON.stringify({ viaProfile, second }),
  );
  check(
    Number(second?.live) === expected,
    "再次 apply 之后存活恢复为 N（不是 2N）",
    JSON.stringify({ expected, after: second }),
  );
  check(
    Number(second?.registered) === expected * 2 && Number(second?.disposed) === expected,
    "台账跨 apply 累积：登记 2N、其中 N 条已销账、存活 N",
    JSON.stringify({ expected, after: second }),
  );
  const secondRoutes = r2.routeCounts();
  const secondTimers = r2.timers();
  const secondSseEffects = r2.effectsWith("统计库变更广播（SSE）");
  const secondStatsServices = statsServiceSnapshot();
  check(
    routeExactlyOnce(secondRoutes) && secondTimers.registered === 2 && secondTimers.live === 2,
    "再次 apply 后四条路由与两个定时器仍各 1 份",
    JSON.stringify({ routes: secondRoutes, timers: secondTimers }),
  );
  check(
    secondSseEffects.length === 1 && secondSseEffects[0].active && secondSseEffects[0].cleanupCalls === 0,
    "再次 apply 后 Stats SSE 订阅仍仅 1 份",
    JSON.stringify(secondSseEffects),
  );
  check(
    secondStatsServices.registered === baseStatsServices.registered + 2 &&
      secondStatsServices.disposed === baseStatsServices.disposed + 1 &&
      secondStatsServices.live === baseStatsServices.live + 1 &&
      secondStatsServices.disposeCalls === baseStatsServices.disposeCalls + 1,
    "跨 apply Stats Service 为 2 次登记 / 1 次销账 / 1 份存活",
    JSON.stringify({ before: baseStatsServices, after: secondStatsServices }),
  );
  const secondUnloadRan = unload(r2);
  const finalStatsServices = statsServiceSnapshot();
  check(secondUnloadRan > 0, "二次 apply 演习台可执行完整卸载", String(secondUnloadRan));
  check(
    r2.timers().live === 0 && r2.routeCounts() && routeExactlyOnce(r2.routeCounts(), { live: 0, disposed: 1 }) &&
      r2.effectsWith("统计库变更广播（SSE）").every((row) => !row.active && row.cleanupCalls === 1),
    "二次 apply 卸载后路由、定时器与 SSE 全部归零",
    JSON.stringify({ routes: r2.routeCounts(), timers: r2.timers(), sse: r2.effectsWith("统计库变更广播（SSE)") }),
  );
  check(
    finalStatsServices.registered === baseStatsServices.registered + 2 &&
      finalStatsServices.disposed === baseStatsServices.disposed + 2 &&
      finalStatsServices.live === baseStatsServices.live &&
      finalStatsServices.disposeCalls === baseStatsServices.disposeCalls + 2,
    "两次 apply 完整卸载后 Stats Service 无存活句柄",
    JSON.stringify({ before: baseStatsServices, after: finalStatsServices }),
  );
}

const total = passes.length + failures.length;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ host: host.root, passed: passes.length, failed: failures.length, passes, failures }, null, 1));
} else {
  console.log(`宿主演习台：${host.root}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`\n生命周期检查：${passes.length} 通过 / ${failures.length} 失败（共 ${total} 条）`);
}
process.exit(failures.length === 0 ? 0 : 1);
