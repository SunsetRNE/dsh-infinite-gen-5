// 无限五代 v0.13.0 设置页调参自检（真实宿主演习台，离线、不连网、不碰真实 ~/.dsh）
//
// 判的是「设置面板里那个可调控 UI 背后的服务端」：
//   1) 宿主 webServer 上是否真挂出了 /infinite-gen-5/tuning，index.html 注入里有没有 token；
//   2) 路由的自守（回环 + token + 方法 + 非法 JSON）；
//   3) POST 改档位后：IG5_CONFIG 生效值、sources 来源标签、落盘文件、装配里段位真的换了；
//   4) 优先级 UI > profile config > IG5_* env > 文件默认；
//   5) reset 复位；未知键忽略。
//
// 存储路径被 IG5_TUNING_FILE 指到临时目录：自检绝不写用户的 ~/.dsh。
// 找不到宿主（裸机 / CI 容器）时打印 SKIP 并 exit 0。
// 用法：node scripts/verify_tuning.mjs [--json] [--host=/path/to/dsh]
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reportHostMiss, resolveHost } from "./lib/host-resolve.mjs";
// 自检不碰用户真实统计库（v0.13.9）：给统计库指一个 /tmp 落点，跑完即弃。
process.env.IG5_STATS_FILE = "/tmp/ig5-stats-tuning.json";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const passes = [];
const failures = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

const WORK = mkdtempSync(join(tmpdir(), "ig5-tuning-"));
const STORE = join(WORK, "infinite-gen-5-tuning.json");
process.env.IG5_TUNING_FILE = STORE;

const KERNEL = "infinite-gen-5:global-system-prompt";
const LAYER2 = "infinite-gen-5:dual-layer-reinforce";
const TAIL = "infinite-gen-5:tail-anchor";
const RUNTIME = "infinite-gen-5:runtime-anchor";
const PATH_UNDER_TEST = "/infinite-gen-5/tuning";

// 三形状解析见 scripts/lib/host-resolve.mjs（0.2.0 平铺 / 0.1.7 单体都能命中）；
// 显式 --host= 找不到就 FAIL，不回落别的宿主（v0.38.2）。
const { host, candidates, explicit } = resolveHost();
if (!host) {
  reportHostMiss({
    script: "verify_tuning.mjs",
    what: "设置页调参自检",
    reason: "no dsh-system-prompt",
    candidates,
    explicit,
    json: process.argv.includes("--json"),
  });
}

const { Context } = await import(pathToFileURL(host.cordis).href);
const promptModule = await import(pathToFileURL(host.prompt).href);
const SystemPrompt = promptModule.default;
const plugin = await import(new URL("../index.js", import.meta.url).href);
const { IG5_CONFIG } = plugin;
const DEFAULTS = { ...IG5_CONFIG };
// v0.42.0：IG5_CONFIG 里多了两个 Batch Arm 档位键（BATCH_ARM_MODE / BATCH_ARM_MIN）；
// v0.52.0：又多了三个只读环境变量档位（TASK_MODE / STEP_INJECT_MODE / STEP_INJECT_MAX_CHARS）。
// 它们都刻意不进 TUNING_CATALOG（那会牵动 TUNABLE_KEYS 与条目数断言），设置页的生效值里
// 自然不会出现。所以「reset 后生效值 = 文件默认」只比可调集，不整表比。
const READONLY_PREFIXES = ["BATCH_ARM_", "TASK_MODE", "STEP_INJECT_"];
const TUNABLE_DEFAULTS = Object.fromEntries(
  Object.entries(DEFAULTS).filter(([key]) => !READONLY_PREFIXES.some((p) => key.startsWith(p))),
);
const restore = () => Object.assign(IG5_CONFIG, DEFAULTS);

// ── 演习台：真宿主 systemPrompt + 假 webServer（只记录注册了什么路由）──
async function rig({ config = {}, store = null, env = {} } = {}) {
  for (const key of Object.keys(store === null ? {} : store)) void key;
  if (store === null) rmSync(STORE, { force: true });
  else writeFileSync(STORE, JSON.stringify({ overrides: store, updatedAt: "2026-01-01T00:00:00.000Z" }), "utf8");
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const app = new Context();
  await app.plugin(SystemPrompt, {});
  const sp = app.get("systemPrompt");
  const tools = [];
  app.provide("tools", { register: (tool) => tools.push(tool) });
  const routes = new Map();
  app.provide("webServer", {
    register: (route) => {
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    },
  });
  restore();
  Object.assign(IG5_CONFIG, config);
  plugin.apply(app, config);
  const route = routes.get(PATH_UNDER_TEST);
  const injected = [];
  await app.emit("webserver/index-inject", injected);
  const profile = () => tools.find((tool) => tool.name === "infinite_gen5_profile")?.execute();
  const names = async () => (await sp.assemble({ agent: {}, scope: {} })).sections.map((s) => s.name);
  return { app, sp, tools, routes, route, injected, profile, names };
}

// 假 req/res：够真判断回环地址、方法、头与状态码。
function callRoute(handler, { method = "GET", token = null, address = "127.0.0.1", body = "" } = {}) {
  return new Promise((resolve) => {
    const listeners = {};
    const req = {
      method,
      headers: token === null ? {} : { "x-ig5-token": token },
      socket: { remoteAddress: address },
      on(event, fn) { (listeners[event] ??= []).push(fn); return req; },
      destroy() {},
    };
    let status = 0;
    let headers = {};
    const res = {
      writeHead(code, h) { status = code; headers = h ?? {}; },
      end(payload) {
        let parsed = null;
        try { parsed = payload ? JSON.parse(payload) : null; } catch { parsed = payload; }
        resolve({ status, headers, body: parsed });
      },
    };
    const pending = handler(req, res);
    queueMicrotask(() => {
      if (body) for (const fn of listeners.data ?? []) fn(Buffer.from(body, "utf8"));
      for (const fn of listeners.end ?? []) fn();
    });
    Promise.resolve(pending).catch(() => {});
  });
}

const tokenOf = (rows) => {
  for (const row of rows) {
    if (row && typeof row.text === "string") {
      const m = row.text.match(/"token":"([0-9a-f]+)"/);
      if (m) return m[1];
    }
  }
  return null;
};

const countOf = (list, name) => list.filter((n) => n === name).length;
const TMP_ENV_KEYS = ["IG5_LAYER2_MODE", "IG5_TAIL_MODE", "IG5_RUNTIME_ANCHOR_MODE", "IG5_RUNTIME_ANCHOR_EVERY", "IG5_ASK_GATE_MODE", "IG5_ASK_GATE_EVERY", "IG5_DEDUPE_PAYLOAD", "IG5_EXCLUSIVE_SECTION"];
const ENV_BACKUP = Object.fromEntries(TMP_ENV_KEYS.map((k) => [k, process.env[k]]));
const clearEnv = () => { for (const k of TMP_ENV_KEYS) delete process.env[k]; };

// ---- 1. 路由与 token 注入 ----
{
  clearEnv();
  const r = await rig();
  check(!!r.route, "宿主 webServer 上挂出了 /infinite-gen-5/tuning", JSON.stringify([...r.routes.keys()]));
  check(r.route?.kind === "exact", "路由用 exact 匹配（不给前缀留口子）", String(r.route?.kind));
  const token = tokenOf(r.injected);
  check(!!token, "index.html 注入里带了调参 token", JSON.stringify(r.injected.map((row) => row.kind)));
  check(
    r.injected.some((row) => row && row.kind === "script" && row.placement === "body" && String(row.text).includes(PATH_UNDER_TEST)),
    "注入行是 body 末尾的 script 且带路径",
    JSON.stringify(r.injected.map((row) => row && row.placement)),
  );
  const endpointOk = r.profile()?.tuning?.endpoint?.ok === true;
  check(endpointOk, "profile 工具如实汇报调参接口可用", JSON.stringify(r.profile()?.tuning?.endpoint));

  // ---- 2. GET 默认态 ----
  const got = await callRoute(r.route.handler, { token });
  check(got.status === 200 && got.body?.ok === true, "GET 回 200 + ok:true", `${got.status} ${JSON.stringify(got.body).slice(0, 120)}`);
  const keys = Object.keys(got.body?.effective ?? {});
  // 条数从 index.js 的 TUNABLE_KEYS 数组现场数，不写死：加一枚开关不该让门禁变红，
  // 真正要守的是「面板下发的每一项都在 TUNABLE_KEYS 里、且每项都下发了」。
  const indexSrc = readFileSync(join(ROOT, "index.js"), "utf8");
  const tunableBlock = (indexSrc.match(/const TUNABLE_KEYS = \[([\s\S]*?)\];/) || [])[1] || "";
  const wantKeys = (tunableBlock.match(/"[A-Z0-9_]+"/g) || []).map((s) => s.slice(1, -1));
  check(
    keys.length === wantKeys.length && wantKeys.every((k) => keys.includes(k)),
    `effective 开关齐全（共 ${wantKeys.length} 项，含 SECTION_BUDGET_MODE/BYTES/SHARE）`,
    JSON.stringify(keys),
  );
  const sources = got.body?.sources ?? {};
  check(
    Object.values(sources).every((v) => v === "default"),
    "没有覆盖时十键来源都是文件默认",
    JSON.stringify(sources),
  );
  check(got.body?.effective?.RUNTIME_ANCHOR_EVERY === DEFAULTS.RUNTIME_ANCHOR_EVERY, "GET 的生效值等于文件默认", String(got.body?.effective?.RUNTIME_ANCHOR_EVERY));
  check(
    Array.isArray(got.body?.catalog) && got.body.catalog.length === wantKeys.length,
    `控件目录随响应下发（${wantKeys.length} 项）`,
    String(got.body?.catalog?.length),
  );

  // ---- 3. 自守 ----
  const badToken = await callRoute(r.route.handler, { token: "0".repeat(32) });
  check(badToken.status === 401, "token 不对 → 401", String(badToken.status));
  const noToken = await callRoute(r.route.handler);
  check(noToken.status === 401, "没带 token → 401", String(noToken.status));
  const remote = await callRoute(r.route.handler, { token, address: "10.0.0.7" });
  check(remote.status === 403, "非回环地址 → 403", String(remote.status));
  const put = await callRoute(r.route.handler, { token, method: "PUT" });
  check(put.status === 405, "PUT → 405", String(put.status));
  const broken = await callRoute(r.route.handler, { token, method: "POST", body: "{不是 JSON" });
  check(broken.status === 400, "非法 JSON → 400", String(broken.status));

  // ---- 4. 改档位：POST 立即重装注入 ----
  const post = await callRoute(r.route.handler, {
    token,
    method: "POST",
    body: JSON.stringify({ overrides: { LAYER2_MODE: "off", RUNTIME_ANCHOR_MODE: "off", RUNTIME_ANCHOR_EVERY: 2, ASK_GATE_MODE: "off", ASK_GATE_EVERY: 2 } }),
  });
  check(post.status === 200 && post.body?.ok === true, "POST 改档位回 200", `${post.status} ${JSON.stringify(post.body).slice(0, 140)}`);
  const after = await r.names();
  check(after.includes(KERNEL), "改档位后 Order 100 内核仍在（重装成功）", JSON.stringify(after));
  check(!after.includes(LAYER2), "LAYER2_MODE=off 后 Order 200 段真的没了", JSON.stringify(after));
  check(!after.includes(RUNTIME), "RUNTIME_ANCHOR_MODE=off 后运行时锚点段真的没了", JSON.stringify(after));
  check(countOf(after, KERNEL) === 1, "重装不会把内核注册两遍", JSON.stringify(after));
  check(countOf(after, TAIL) <= 1, "重装不会把末位锚点注册两遍", JSON.stringify(after));
  const liveProfile = r.profile()?.tuning;
  check(liveProfile?.sources?.LAYER2_MODE === "ui" && liveProfile?.sources?.RUNTIME_ANCHOR_EVERY === "ui", "来源标签标成设置页 UI", JSON.stringify(liveProfile?.sources));
  check(liveProfile?.sources?.TAIL_MODE === "default", "没动的键来源仍是文件默认", JSON.stringify(liveProfile?.sources));
  check(liveProfile?.rebuilds >= 1, "记了重装次数", String(liveProfile?.rebuilds));
  const onDisk = JSON.parse(readFileSync(STORE, "utf8"));
  check(
    onDisk.overrides.LAYER2_MODE === "off" && onDisk.overrides.RUNTIME_ANCHOR_EVERY === 2 && Object.keys(onDisk.overrides).length === 5,
    "档位落盘（重启后照旧生效）",
    JSON.stringify(onDisk.overrides),
  );
  check(IG5_CONFIG.LAYER2_MODE === "off" && IG5_CONFIG.RUNTIME_ANCHOR_EVERY === 2, "IG5_CONFIG 就地写成生效值", JSON.stringify({ L: IG5_CONFIG.LAYER2_MODE, E: IG5_CONFIG.RUNTIME_ANCHOR_EVERY }));
  // 档位键不是布尔键：ASK_GATE_MODE="off" 必须原样是字符串 "off"，被布尔化成 false 就是静默失效（v0.12.x 的老坑）。
  check(IG5_CONFIG.ASK_GATE_MODE === "off" && IG5_CONFIG.ASK_GATE_EVERY === 2, "询问闸门两个键就地写成生效值", JSON.stringify({ M: IG5_CONFIG.ASK_GATE_MODE, E: IG5_CONFIG.ASK_GATE_EVERY }));
  check(liveProfile?.sources?.ASK_GATE_MODE === "ui" && liveProfile?.sources?.ASK_GATE_EVERY === "ui", "询问闸门键的来源也标成设置页 UI", JSON.stringify(liveProfile?.sources));

  // ---- 5. 未知键与非法值 ----
  const junk = await callRoute(r.route.handler, {
    token,
    method: "POST",
    body: JSON.stringify({ overrides: { NOPE_KEY: "x", RUNTIME_ANCHOR_EVERY: "4" } }),
  });
  check(junk.status === 200 && JSON.parse(readFileSync(STORE, "utf8")).overrides.NOPE_KEY === undefined, "未知键被忽略且不落盘", JSON.stringify(JSON.parse(readFileSync(STORE, "utf8")).overrides));
  check(junk.body?.effective?.RUNTIME_ANCHOR_EVERY === 4, "字符串数字被 coerce 成数字", String(junk.body?.effective?.RUNTIME_ANCHOR_EVERY));
  const junk2 = await callRoute(r.route.handler, {
    token,
    method: "POST",
    body: JSON.stringify({ overrides: { ASK_GATE_EVERY: "3", ASK_GATE_MODE: "auto" } }),
  });
  check(junk2.body?.effective?.ASK_GATE_EVERY === 3, "询问闸门间隔同样按数字 coerce", String(junk2.body?.effective?.ASK_GATE_EVERY));
  check(junk2.body?.effective?.ASK_GATE_MODE === "auto", "档位字符串原样保留（不做布尔化）", String(junk2.body?.effective?.ASK_GATE_MODE));

  // ---- 5b. 数值键越界回落（真缺陷回归：BOOST_BYTES=4 曾把增强集整条掐死） ----
  const clamp = await callRoute(r.route.handler, {
    token,
    method: "POST",
    body: JSON.stringify({ overrides: { BOOST_BYTES: 4, LAZY_BYTES: 0 } }),
  });
  check(clamp.body?.effective?.BOOST_BYTES === 2400, "BOOST_BYTES=4 越界 → 回落文件默认 2400（不是静默采纳）", String(clamp.body?.effective?.BOOST_BYTES));
  check(clamp.body?.effective?.LAZY_BYTES === 0, "LAZY_BYTES=0 属合法值（0 = 跟随档位预算，不是关闭）", String(clamp.body?.effective?.LAZY_BYTES));
  const rejectedNow = r.profile()?.tuning?.rejected;
  check(Array.isArray(rejectedNow) && rejectedNow.some((row) => String(row).includes("BOOST_BYTES=4")), "被拒原值记进 tuning.rejected，不再静默", JSON.stringify(rejectedNow));
  const clamp2 = await callRoute(r.route.handler, {
    token,
    method: "POST",
    body: JSON.stringify({ overrides: { BOOST_BYTES: 256, LAZY_BYTES: 16000 } }),
  });
  check(clamp2.body?.effective?.BOOST_BYTES === 256, "BOOST_BYTES 下界 256 取用", String(clamp2.body?.effective?.BOOST_BYTES));
  check(clamp2.body?.effective?.LAZY_BYTES === 16000, "LAZY_BYTES 上界 16000 取用", String(clamp2.body?.effective?.LAZY_BYTES));
  const clamp3 = await callRoute(r.route.handler, {
    token,
    method: "POST",
    body: JSON.stringify({ overrides: { BOOST_BYTES: 12001, LAZY_BYTES: 20000, RUNTIME_ANCHOR_EVERY: 0 } }),
  });
  // 越界写入的语义是「不采纳」，不是「回落默认」：前一步已存 256，这一步应当保持 256 不动。
  check(clamp3.body?.effective?.BOOST_BYTES === 256, "上界越界写入不采纳（保持上一步已存的 256，而不是静默回落默认）", String(clamp3.body?.effective?.BOOST_BYTES));
  const rejected3 = clamp3.body?.rejected || [];
  check(rejected3.some((row) => String(row).includes("BOOST_BYTES=12001")) && rejected3.some((row) => String(row).includes("LAZY_BYTES=20000")) && rejected3.some((row) => String(row).includes("RUNTIME_ANCHOR_EVERY=0")), "三个越界值全部记进 rejected（含超出上界与 0 步节拍）", JSON.stringify(rejected3));

  // ---- 5c. 旋钮广告的区间必须真被守卫接受 ----
  // 真缺陷回归：LAZY_BYTES 旋钮的 max 曾写 40000，而 NUMERIC_RANGES 只放到 16000 ——
  // 用户在设置页点到 40000 只会被拒收（rejected 留痕），是个够不着的假旋钮。
  const numericKnobs = (got.body?.catalog || []).filter((item) => item.kind === "number");
  // 数字旋钮条数也现场数（NUMERIC_RANGES 里有区间就得有旋钮）：加一枚不该红，缺一枚必须红。
  const rangeBlock = (indexSrc.match(/const NUMERIC_RANGES = Object\.freeze\(\{([\s\S]*?)\n\}\);/) || [])[1] || "";
  const wantRanges = (rangeBlock.match(/([A-Z0-9_]+)\s*:\s*\[/g) || []).map((s) => s.replace(/[\s:[]/g, ""));
  check(
    numericKnobs.length === wantRanges.length && wantRanges.every((k) => numericKnobs.some((item) => item.key === k)),
    `catalog 里带出全部数字旋钮（共 ${wantRanges.length} 枚，供区间断言）`,
    JSON.stringify(numericKnobs.map((k) => k.key)),
  );
  for (const knob of numericKnobs) {
    const probe = await callRoute(r.route.handler, {
      token,
      method: "POST",
      body: JSON.stringify({ overrides: { [knob.key]: knob.max } }),
    });
    const probeRejected = probe.body?.rejected || [];
    check(
      probe.body?.effective?.[knob.key] === knob.max && !probeRejected.some((row) => String(row).includes(`${knob.key}=${knob.max}`)),
      `${knob.key} 旋钮上界 ${knob.max} 被守卫接受（广告区间 = 可用区间）`,
      `rejected=${JSON.stringify(probeRejected)} effective=${String(probe.body?.effective?.[knob.key])}`,
    );
  }

  // ---- 6. reset 复位 ----
  const reset = await callRoute(r.route.handler, { token, method: "POST", body: JSON.stringify({ reset: true }) });
  const afterReset = await r.names();
  check(reset.status === 200 && JSON.stringify(reset.body?.effective) === JSON.stringify(TUNABLE_DEFAULTS), "reset 后生效值回到文件默认（可调集）", JSON.stringify(reset.body?.effective));
  check(afterReset.includes(LAYER2), "reset 后 Order 200 段回来了", JSON.stringify(afterReset));
  check(Object.keys(JSON.parse(readFileSync(STORE, "utf8")).overrides).length === 0, "reset 后落盘文件里没有遗留覆盖");
}

// ---- 7. 优先级：UI(落盘) > profile config > env > 默认 ----
{
  clearEnv();
  const r = await rig({
    config: { RUNTIME_ANCHOR_EVERY: 6, TAIL_MODE: "order" },
    store: { RUNTIME_ANCHOR_EVERY: 2, TAIL_MODE: "waterfall" },
  });
  const profile = r.profile();
  check(profile?.tuning?.effective?.RUNTIME_ANCHOR_EVERY === 2, "落盘的 UI 值压过 profile config", JSON.stringify(profile?.tuning?.effective));
  check(profile?.tuning?.sources?.RUNTIME_ANCHOR_EVERY === "ui", "胜出来源标成 UI", JSON.stringify(profile?.tuning?.sources));
  check(profile?.tuning?.effective?.TAIL_MODE === "waterfall" && profile?.tuning?.sources?.TAIL_MODE === "ui", "TAIL_MODE 同样 UI 优先", JSON.stringify(profile?.tuning?.sources));
  check(profile?.tuning?.sources?.LAYER2_MODE === "default", "未被覆盖的键不虚报来源", JSON.stringify(profile?.tuning?.sources));
  check((profile?.configOverrides ?? []).some((s) => s.startsWith("RUNTIME_ANCHOR_EVERY=2") && s.includes("设置页 UI")), "configOverrides 里写明是设置页给的", JSON.stringify(profile?.configOverrides));

  // env 与 config 同时给同一键：config 赢（UI 没给）
  clearEnv();
  const r2 = await rig({ config: { RUNTIME_ANCHOR_MODE: "once" }, env: { IG5_RUNTIME_ANCHOR_MODE: "every" } });
  const p2 = r2.profile();
  check(p2?.tuning?.effective?.RUNTIME_ANCHOR_MODE === "once" && p2?.tuning?.sources?.RUNTIME_ANCHOR_MODE === "config", "profile config 压过环境变量", JSON.stringify(p2?.tuning?.sources));
  clearEnv();
}

// ---- 8. 没有宿主 webServer 时：降级成只读，不炸 ----
{
  clearEnv();
  rmSync(STORE, { force: true });
  const app = new Context();
  await app.plugin(SystemPrompt, {});
  const tools = [];
  app.provide("tools", { register: (tool) => tools.push(tool) });
  restore();
  plugin.apply(app, {});
  const profile = () => tools.find((tool) => tool.name === "infinite_gen5_profile")?.execute();
  const endpoint = profile()?.tuning?.endpoint;
  check(endpoint?.ok === false && /webServer/.test(String(endpoint?.reason)), "没有 webServer 时如实汇报降级原因", JSON.stringify(endpoint));
  const assembly = await app.get("systemPrompt").assemble({ agent: {}, scope: {} });
  check(assembly.sections.some((s) => s.name === KERNEL), "没有 webServer 也照常注入内核", JSON.stringify(assembly.sections.map((s) => s.name)));
}

// ---- 9. webServer 比插件晚就绪（真实宿主的时序）：靠 ctx.inject 补挂，且期间不假装成功 ----
// 真宿主上 webServer 是后挂服务，本插件 apply 时 ctx.get("webServer") 只会拿到 undefined
// （get 默认 strict：只返回「提供方 fiber 已激活」的实现）—— 这一节就是那次线上复发的护栏。
{
  clearEnv();
  rmSync(STORE, { force: true });
  const app = new Context();
  await app.plugin(SystemPrompt, {});
  const tools = [];
  app.provide("tools", { register: (tool) => tools.push(tool) });
  restore();
  plugin.apply(app, {});
  const profile = () => tools.find((tool) => tool.name === "infinite_gen5_profile")?.execute();
  check(profile()?.tuning?.endpoint?.ok === false, "webServer 未就绪时先报「不可用」，不假装成功", JSON.stringify(profile()?.tuning?.endpoint));
  const routes = new Map();
  app.provide("webServer", {
    register: (route) => {
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    },
  });
  for (let i = 0; i < 40 && !routes.has(PATH_UNDER_TEST); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  check(routes.has(PATH_UNDER_TEST), "webServer 晚到：注入回调把调参路由补挂上", [...routes.keys()].join(","));
  const injected = [];
  await app.emit("webserver/index-inject", injected);
  check(!!tokenOf(injected), "晚挂时 token 注入同样就位", JSON.stringify(injected.map((row) => row.kind)));
  check(profile()?.tuning?.endpoint?.ok === true, "补挂之后 endpoint 改成 ok", JSON.stringify(profile()?.tuning?.endpoint));
  const late = await callRoute(routes.get(PATH_UNDER_TEST).handler, { method: "GET", token: tokenOf(injected) });
  check(late.status === 200 && late.body?.ok === true, "补挂的路由真能应答 GET", `${late.status} ${JSON.stringify(late.body)?.slice(0, 120)}`);
  const lateBad = await callRoute(routes.get(PATH_UNDER_TEST).handler, { method: "GET", token: "0".repeat(32) });
  check(lateBad.status === 401, "补挂的路由照样自守（错 token 401）", String(lateBad.status));
}

// 收尾：把自检期间动过的环境变量还回去，临时目录删掉（用户的 ~/.dsh 全程没被碰过）。
for (const [key, value] of Object.entries(ENV_BACKUP)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
rmSync(WORK, { recursive: true, force: true });

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ passed: passes.length, failed: failures.length, passes, failures }, null, 1));
} else {
  console.log(`设置页调参检查：${passes.length} 通过 / ${failures.length} 失败（共 ${passes.length + failures.length} 条）`);
  for (const f of failures) console.log("  ✗ " + f);
}
process.exit(failures.length === 0 ? 0 : 1);
