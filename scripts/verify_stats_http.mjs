// Stats HTTP/SSE 请求级门禁：真实 dsh-host-webserver + 真实插件路由。
// 不启动 DSH GUI；只在 loopback 临时端口装载真实 WebServer 与插件，跑完销毁。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findPackageDir, reportHostMiss, resolveHost } from "./lib/host-resolve.mjs";
import { statsServiceSnapshot } from "../services/stats-service.mjs";

const WORK = mkdtempSync(join(tmpdir(), "ig5-stats-http-"));
process.env.IG5_HOME = WORK;
process.env.IG5_STATS_FILE = join(WORK, "stats.json");
process.env.IG5_TUNING_FILE = join(WORK, "tuning.json");
process.env.IG5_ADAPT_CACHE = join(WORK, "adapt-cache.json");

const passes = [];
const failures = [];
const check = (ok, label, detail = "") => (ok ? passes : failures).push(`${label}${!ok && detail ? ` — ${detail}` : ""}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, timeoutMs = 1500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(10);
  }
  return Boolean(predicate());
};
const tokenOf = (rows) => {
  for (const row of rows) {
    const text = row && typeof row.text === "string" ? row.text : "";
    const match = text.match(/"token":"([0-9a-f]+)"/);
    if (match) return match[1];
  }
  return null;
};
const parseBody = (text) => {
  try { return JSON.parse(text); } catch { return text; }
};
const readChunk = async (reader, timeoutMs) => {
  let timer;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("SSE read timeout")), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
const readUntil = async (reader, predicate, timeoutMs) => {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let chunk;
    try {
      chunk = await readChunk(reader, Math.max(1, deadline - Date.now()));
    } catch (error) {
      return { ok: false, text, error: String(error?.message ?? error) };
    }
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
    if (predicate(text)) return { ok: true, text, error: null };
  }
  return { ok: false, text, error: "SSE predicate timeout" };
};

const { host, candidates, explicit } = resolveHost();
if (!host) {
  reportHostMiss({
    script: "verify_stats_http.mjs",
    what: "Stats HTTP/SSE 请求级门禁",
    reason: "no dsh-system-prompt",
    candidates,
    explicit,
    json: process.argv.includes("--json"),
  });
}

const webserverDir = findPackageDir("dsh-host-webserver");
if (!webserverDir) {
  console.log(JSON.stringify({ skipped: true, reason: "no dsh-host-webserver", passed: 0, failed: 0 }, null, 1));
  rmSync(WORK, { recursive: true, force: true });
  process.exit(0);
}

const { Context } = await import(pathToFileURL(host.cordis).href);
const SystemPrompt = (await import(pathToFileURL(host.prompt).href)).default;
const { default: WebServer } = await import(pathToFileURL(join(webserverDir, "lib/index.js")).href);
const plugin = await import(new URL("../index.js", import.meta.url).href);
const { statsSinkOf } = plugin;

let app = null;
let firstPlugin = null;
let secondPlugin = null;
let sseController = null;
try {
  app = new Context();
  await app.plugin(SystemPrompt, {});
  const tools = [];
  app.provide("tools", { register: (tool) => tools.push(tool) });
  const webFiber = app.plugin(WebServer, { host: "127.0.0.1", port: 0 });
  await webFiber;
  const webServer = app.get("webServer");
  check(!!webServer && Number(webServer.port) > 0, "真实 dsh-host-webserver 在临时 loopback 端口监听", JSON.stringify({ port: webServer?.port, host: webServer?.host }));
  const baseUrl = `http://127.0.0.1:${webServer.port}`;
  const paths = [
    "/infinite-gen-5/tuning",
    "/infinite-gen-5/stats",
    "/infinite-gen-5/tasks",
    "/infinite-gen-5/events",
  ];
  const beforeStats = statsServiceSnapshot();

  firstPlugin = app.plugin(plugin, {});
  await firstPlugin;
  const mounted = await waitFor(() => webServer.exact?.size === paths.length);
  const injectionRows = webServer.collectIndexInjections();
  const token = tokenOf(injectionRows);
  check(mounted, "第一次 apply 后真实 WebServer 精确路由数为 4", JSON.stringify([...webServer.exact?.keys?.() ?? []]));
  check(JSON.stringify([...webServer.exact?.keys?.() ?? []].sort()) === JSON.stringify([...paths].sort()), "真实 WebServer 路由集合与四条目标路径完全一致", JSON.stringify([...webServer.exact?.keys?.()]));
  check(!!token, "真实 index injection 提供面板 token", JSON.stringify(injectionRows.map((row) => row?.kind)));
  const afterFirstStats = statsServiceSnapshot();
  check(afterFirstStats.registered === beforeStats.registered + 1 && afterFirstStats.live === beforeStats.live + 1, "真实 Host apply 后 Stats Service 存活 1 份", JSON.stringify({ before: beforeStats, after: afterFirstStats }));

  const getJson = async (path, headers = {}) => {
    const response = await fetch(`${baseUrl}${path}`, { headers });
    const text = await response.text();
    return { status: response.status, headers: Object.fromEntries(response.headers), body: parseBody(text) };
  };
  const authHeaders = { "x-ig5-token": token };
  for (const path of paths.slice(0, 3)) {
    const result = await getJson(path, authHeaders);
    check(result.status === 200 && result.body?.ok === true, `真实 HTTP ${path} 带 header token 返回 200 + ok:true`, `${result.status} ${JSON.stringify(result.body).slice(0, 180)}`);
  }
  const strictQuery = await getJson("/infinite-gen-5/stats?token=" + encodeURIComponent(token));
  check(strictQuery.status === 401, "非 SSE 路由不接受 query token（仍要求 x-ig5-token）", String(strictQuery.status));
  const noToken = await getJson("/infinite-gen-5/stats");
  check(noToken.status === 401, "真实 HTTP 缺少 header token 返回 401", String(noToken.status));

  sseController = new AbortController();
  const sseResponse = await fetch(`${baseUrl}/infinite-gen-5/events?token=${encodeURIComponent(token)}`, { signal: sseController.signal });
  check(sseResponse.status === 200, "真实 SSE query token 握手返回 200", String(sseResponse.status));
  check(String(sseResponse.headers.get("content-type")).startsWith("text/event-stream"), "真实 SSE 返回 text/event-stream", String(sseResponse.headers.get("content-type")));
  check(sseResponse.headers.get("cache-control") === "no-store", "真实 SSE 返回 no-store", String(sseResponse.headers.get("cache-control")));
  const reader = sseResponse.body?.getReader();
  check(!!reader, "真实 SSE 响应提供可读 body", String(Boolean(reader)));
  if (reader) {
    const hello = await readUntil(reader, (text) => text.includes("retry: 2000") && text.includes('"type":"hello"'), 1500);
    check(hello.ok, "真实 SSE 首帧包含 retry 与 hello", hello.error || hello.text.slice(0, 240));
    const stats = statsSinkOf();
    check(!!stats && typeof stats.count === "function" && typeof stats.flush === "function", "真实插件暴露可写 Stats Service 句柄", String(Boolean(stats)));
    if (stats) {
      stats.count("counters.httpProbe");
      stats.flush(true);
      const update = await readUntil(reader, (text) => text.includes('"type":"stats"'), 1500);
      check(update.ok, "真实 Stats 落盘后 SSE 收到 stats 通知帧", update.error || update.text.slice(-300));
    }
  }
  sseController.abort();
  sseController = null;
  const badSse = await fetch(`${baseUrl}/infinite-gen-5/events?token=bad-token`);
  check(badSse.status === 401, "真实 SSE 错误 query token 返回 401", String(badSse.status));

  await firstPlugin.dispose();
  firstPlugin = null;
  const firstDisposed = await waitFor(() => webServer.exact?.size === 0);
  const afterFirstDispose = statsServiceSnapshot();
  check(firstDisposed, "第一次真实 Host unload 后四条路由全部移除", JSON.stringify([...webServer.exact?.keys?.() ?? []]));
  check(afterFirstDispose.disposed === beforeStats.disposed + 1 && afterFirstDispose.live === beforeStats.live, "第一次真实 Host unload 后 Stats Service 恰好销账一次", JSON.stringify({ before: beforeStats, after: afterFirstDispose }));

  secondPlugin = app.plugin(plugin, {});
  await secondPlugin;
  const remounted = await waitFor(() => webServer.exact?.size === paths.length);
  const secondRows = webServer.collectIndexInjections();
  const secondToken = tokenOf(secondRows);
  check(remounted, "第二次真实 Host apply 后恢复 4 条路由", JSON.stringify([...webServer.exact?.keys?.() ?? []]));
  check(!!secondToken && secondToken !== token, "第二次 apply 重新注入新的面板 token", JSON.stringify({ first: token, second: secondToken }));
  const afterSecondStats = statsServiceSnapshot();
  check(afterSecondStats.registered === beforeStats.registered + 2 && afterSecondStats.disposed === beforeStats.disposed + 1 && afterSecondStats.live === beforeStats.live + 1, "跨真实 apply 为 2 次登记 / 1 次销账 / 1 份存活", JSON.stringify({ before: beforeStats, after: afterSecondStats }));
  const remountStats = await getJson("/infinite-gen-5/stats", { "x-ig5-token": secondToken });
  check(remountStats.status === 200 && remountStats.body?.ok === true, "第二次 apply 后真实 /stats 仍可读", `${remountStats.status} ${JSON.stringify(remountStats.body).slice(0, 180)}`);
} catch (error) {
  check(false, "请求级门禁执行未抛出异常", String(error?.stack ?? error));
} finally {
  sseController?.abort();
  if (secondPlugin) {
    try { await secondPlugin.dispose(); } catch {}
  }
  if (firstPlugin) {
    try { await firstPlugin.dispose(); } catch {}
  }
  if (app) {
    try { await app.fiber.dispose(); } catch {}
  }
  rmSync(WORK, { recursive: true, force: true });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ host: host.root, passed: passes.length, failed: failures.length, passes, failures }, null, 1));
} else {
  console.log(`Stats HTTP/SSE 请求级检查：${passes.length} 通过 / ${failures.length} 失败（共 ${passes.length + failures.length} 条）`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
}
process.exit(failures.length === 0 ? 0 : 1);
