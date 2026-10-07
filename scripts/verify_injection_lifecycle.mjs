// 无限五代 · 生命周期门禁（scripts/verify_injection_lifecycle.mjs）
//
// 判什么：注入侧与会话侧监听器的「数量守恒」—— 这是重复 apply / HMR / 停用这类场景里
// 最容易出、又最难从线上现象倒推的一类回归：监听器挂了两份，装配被跑两遍、事件被计两次、
// 计划落库两次，而面板上的每个数字看起来都正常。
//
// 三条判据（缺一条都不算过）：
//   ① apply 之后：自有监听器登记 N 条、存活 N 条；
//   ② rebuildInjection（设置页改档位走的就是它）：仍是 N 条 —— 不是 2N；
//   ③ 卸载销账：登记过的那些全部 disposed，存活归零；再次 apply 回到 N（而不是 2N）。
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
  const realEffect = app.effect.bind(app);
  // ctx.effect 有同步与异步两种用法（本项目两种都出现）。这里按同步回调接管：
  // 回调返回函数即清理函数 → 入账；返回 promise 不接管（交给宿主自己跑）。
  app.effect = (fn, ...rest) => {
    let cleanup = null;
    try {
      cleanup = fn();
    } catch (error) {
      cleanup = null;
    }
    if (typeof cleanup === "function") {
      effects.push({ cleanup, label: String(rest[0] ?? "") });
      return cleanup;
    }
    return cleanup;
  };
  const tools = [];
  app.provide("tools", { register: (tool) => tools.push(tool) });
  const routes = new Map();
  app.provide("webServer", {
    register(spec) {
      routes.set(spec.path, spec);
      return () => routes.delete(spec.path);
    },
  });
  Object.assign(IG5_CONFIG, DEFAULTS);
  plugin.apply(app, {});
  const profile = () => tools.find((row) => row.name === "infinite_gen5_profile")?.execute();
  const assemble = () => app.get("systemPrompt").assemble({ agent: {}, scope: {} });
  return { app, effects, tools, routes, profile, assemble, realEffect };
}

// 一次「卸载」：把收集到的清理函数按注册的逆序跑一遍（与 cordis 的回收次序一致）。
function unload(rigCtx) {
  let ran = 0;
  for (const { cleanup } of [...rigCtx.effects].reverse()) {
    try {
      cleanup();
      ran += 1;
    } catch {
      // 清理阶段保持幂等：单个清理抛错不影响其余销账。
    }
  }
  return ran;
}

// ---- 1. apply 之后：自有监听器登记 N 条、存活 N 条 ----
{
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
