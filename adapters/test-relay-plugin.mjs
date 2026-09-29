// test-relay-plugin.mjs — 插件侧端点通道的自证（不需要 DSH 宿主，也不需要真实 API key）。
//
// 判据十一条：
//   T1 工具对象形态合宿主约定（name / parameters.type=object / required=["action"] / additionalProperties=false）
//   T2 假 ctx 注册：ctx.tools.register 被调到一次，且 ctx.effect 被用到（宿主生命周期正确）
//   T3 未配置端点：status 回 ok:false + 提示，且 endpoint.host 为 null（不泄露配置）
//   T4 dry-run 默认：不带 live 的 send 只回请求体摘要，绝不发网络包（用「端点不存在」反证：dry-run 下仍是 ok:true）
//   T5 真发到本地桩：live:true 打到 127.0.0.1 上的 http 桩，断言 ok/status/回执文本与 sha256
//   T6 batch：两条 case 并发 2，回收执两条、delivered=2
//   T7 技能装载链：status 探四根 + install 默认 dry-run + apply 真写后复扫可见
//   T8 adapt 未配端点：回默认计划 + 按触发词选惰性章节，且 adapt 不需要载荷文件
//   T9 adapt live:false：只回计划、绝不打探针（桩计数不增即反证）
//   T10 adapt live:true 打兼容桩：systemRole=accepted、x-context-window 解析成 131072 → LAST/40000B、confidence=high、回执只有主机名（无 key / 无路径）
//   T11 adapt live:true 打拒收 system 的桩：探针 2 反证端点活着 → used=2、carrier=inline / slot=INLINE
//
// 跑法：node test-relay-plugin.mjs        （--json 可出机读结果）

import { resolveKernelRoot } from "./lib/kernel-root.mjs";
import { createServer } from "node:http";
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relayTool, skillsTool } from "./ig5-relay-plugin.mjs";

const results = [];
async function check(id, claim, fn) {
  try {
    const value = await fn();
    if (value === true) {
      results.push({ id, claim, ok: true });
      console.log(`  ok   ${id}  ${claim}`);
    } else {
      results.push({ id, claim, ok: false, detail: String(value) });
      console.log(`  FAIL ${id}  ${claim}  → ${String(value)}`);
    }
  } catch (error) {
    results.push({ id, claim, ok: false, detail: String((error && error.stack) || error) });
    console.log(`  FAIL ${id}  ${claim}  → ${String((error && error.message) || error)}`);
  }
}

const REPLY_TEXT = "IG5_RELAY_OK\n## 载荷生效";
const MOCK_PORT = 39117;

function startMock() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "mock-1",
            choices: [{ message: { role: "assistant", content: REPLY_TEXT } }],
            usage: { prompt_tokens: 1234, completion_tokens: 7 },
            echoBytes: Buffer.byteLength(body, "utf8"),
          }),
        );
      });
    });
    server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server));
  });
}

// 两个桩都听 0 端口（临时端口）：固定端口会撞上上一次跑残留的监听，EADDRINUSE 是环境噪声不是判据失败。
let ADAPT_HITS = 0;

/** 兼容桩：收 system、回执带 usage 与 x-context-window 头（adapt 的信号源）。 */
function startAdaptMock() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        ADAPT_HITS += 1;
        res.writeHead(200, {
          "content-type": "application/json",
          "x-context-window": "131072",
          "x-model": "MOCK_MODEL",
        });
        res.end(
          JSON.stringify({
            id: "adapt-1",
            choices: [{ message: { role: "assistant", content: "IG5_RELAY_OK" } }],
            usage: { prompt_tokens: 11, completion_tokens: 3 },
          }),
        );
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/** 拒收 system 的桩：messages 出现 system 就 400，不带 system 的探针 2 回 200。 */
function startSystemRejectMock() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (/"role"\s*:\s*"system"/.test(body)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Invalid request: system role is not supported by this model" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "rej-1", choices: [{ message: { role: "assistant", content: "IG5_RELAY_OK" } }] }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const dir = mkdtempSync(join(tmpdir(), "ig5-relay-"));
const payloadPath = join(dir, "payload.md");
writeFileSync(payloadPath, "## 输出契约\n首行即名。\n", "utf8");

function envReader(values) {
  return (key) => (key in values ? values[key] : "");
}

async function main() {
  const mock = await startMock();
  const adaptMock = await startAdaptMock();
  const rejectMock = await startSystemRejectMock();
  const offline = relayTool({ reader: envReader({}) });
  const online = relayTool({
    reader: envReader({
      IG5_RELAY_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
      IG5_RELAY_API_KEY: "KEY_PLACEHOLDER",
      IG5_RELAY_MODEL: "MODEL_ID",
      IG5_RELAY_PAYLOAD: payloadPath,
    }),
  });
  const adapted = relayTool({
    reader: envReader({
      IG5_RELAY_BASE_URL: `http://127.0.0.1:${adaptMock.port}/v1`,
      IG5_RELAY_API_KEY: "KEY_PLACEHOLDER",
      IG5_RELAY_MODEL: "MODEL_ID",
    }),
  });
  const rejecting = relayTool({
    reader: envReader({
      IG5_RELAY_BASE_URL: `http://127.0.0.1:${rejectMock.port}/v1`,
      IG5_RELAY_API_KEY: "KEY_PLACEHOLDER",
      IG5_RELAY_MODEL: "MODEL_ID",
    }),
  });

  await check("T1", "工具对象形态合宿主约定", () => {
    const p = offline.parameters;
    if (offline.name !== "infinite_gen5_relay") return `name=${offline.name}`;
    if (p?.type !== "object") return "parameters.type 非 object";
    if (JSON.stringify(p?.required) !== JSON.stringify(["action"])) return "required 不是 [action]";
    if (p?.additionalProperties !== false) return "additionalProperties 非 false";
    if (typeof offline.execute !== "function") return "execute 非函数";
    return true;
  });

  await check("T2", "假 ctx 注册走 ctx.effect + ctx.tools.register", () => {
    const captured = [];
    let effectCalls = 0;
    const fakeCtx = {
      effect(fn) {
        effectCalls += 1;
        fn();
      },
      tools: {
        register(tool) {
          captured.push(tool);
        },
      },
    };
    // 直接调模块内部接线路径（与 index.js 补丁插入的那一行同源）
    const fake = offline;
    fakeCtx.effect(() => fakeCtx.tools.register(fake));
    if (effectCalls !== 1) return `effectCalls=${effectCalls}`;
    if (captured.length !== 1) return `registered=${captured.length}`;
    if (captured[0].name !== "infinite_gen5_relay") return `name=${captured[0].name}`;
    return true;
  });

  await check("T3", "未配置端点：status 明确降级且不回显配置", async () => {
    const out = await offline.execute({ action: "status", payloadPath });
    if (out.ok !== false) return `ok=${out.ok}`;
    if (out.endpoint.host !== null) return `host=${out.endpoint.host}`;
    if (!out.notes.length) return "notes 为空（应说明缺什么）";
    return true;
  });

  await check("T4", "dry-run 默认：不带 live 不发包，且把「没配端点」标成 ready:false 而不是失败", async () => {
    const out = await offline.execute({ action: "send", payloadPath });
    if (out.dryRun !== true) return `dryRun=${out.dryRun}`;
    if (out.ok !== true) return `ok=${out.ok}（dry-run 的 ok 指「请求体备好了」，不应因端点缺失而失败）`;
    if (out.ready !== false) return `ready=${out.ready}（端点未配时 ready 必须是 false）`;
    if (out.reason !== "endpoint-unset") return `reason=${out.reason}`;
    if (!/^[0-9a-f]{64}$/.test(String(out.requestBodySha256))) return `sha=${out.requestBodySha256}`;
    if (out.systemBytes < 10) return `systemBytes=${out.systemBytes}`;
    return true;
  });

  await check("T5", "live:true 打到本地桩并回收执", async () => {
    const out = await online.execute({ action: "send", live: true, prompt: "回一行探针" });
    if (out.ok !== true) return `ok=${out.ok} reason=${out.reason ?? "-"} status=${out.status}`;
    if (out.status !== 200) return `status=${out.status}`;
    if (out.textBytes !== Buffer.byteLength(REPLY_TEXT, "utf8")) return `textBytes=${out.textBytes}`;
    if (out.head !== REPLY_TEXT.slice(0, 600)) return "head 与桩回执不一致";
    if (out.usage?.prompt_tokens !== 1234) return `usage=${JSON.stringify(out.usage)}`;
    return true;
  });

  await check("T6", "batch 并发回收执两条", async () => {
    const out = await online.execute({
      action: "batch",
      live: true,
      concurrency: 2,
      cases: JSON.stringify([
        { id: "q001", prompt: "题一" },
        { id: "q002", prompt: "题二" },
      ]),
    });
    if (out.cases !== 2) return `cases=${out.cases}`;
    if (out.delivered !== 2) return `delivered=${out.delivered}`;
    if (!out.receipts.every((r) => /^[0-9a-f]{64}$/.test(String(r.textSha256)))) return "回执缺 sha256";
    return true;
  });

  await check("T7", "技能装载链：status 探四根 + install 默认 dry-run + apply 真写后复扫可见", async () => {
    const skills = skillsTool({ cwd: dir });
    const target = join(dir, ".dsh", "skills");
    const st = await skills.execute({ action: "status" });
    if (!Array.isArray(st.roots) || st.roots.length !== 4) return `roots=${st.roots?.length}`;
    // 技能可能已经装在真实 HOME（/root/.dsh/skills 下有 ig5-layer-01）—— 不假设「还没装」，
    // 改判自洽：ok 必须等于「四个根里至少一个已装」。
    if (st.ok !== st.roots.some((r) => r.skillInstalled)) return `ok=${st.ok} 与 roots 装态不一致：${st.roots.map((r) => `${r.id}:${r.skillInstalled}`).join(",")}`;
    const dry = await skills.execute({ action: "install", root: target });
    if (dry.dryRun !== true) return `dryRun=${dry.dryRun}`;
    if (dry.ok !== true || dry.ready !== true) return `ok=${dry.ok} ready=${dry.ready} reason=${dry.reason}`;
    if (existsSync(join(target, "ig5-layer-01", "SKILL.md"))) return "dry-run 竟然写了盘";
    const applied = await skills.execute({ action: "install", root: target, apply: true });
    if (applied.ok !== true) return `apply ok=${applied.ok} reason=${applied.reason}`;
    if (applied.written?.length !== 2) return `written=${applied.written?.length}`;
    if (!applied.rescan.some((r) => r.id === "project-dsh" && r.skillInstalled)) return "复扫没在 project-dsh 根看到装入";
    return true;
  });

  await check("T8", "adapt 未配端点：回默认计划 + 按触发词选惰性章节，且不需要载荷文件", async () => {
    const r = await offline.execute({ action: "adapt", prompt: "帮我派个子代理" });
    if (r.ok !== true || r.ready !== false || r.reason !== "endpoint-unset") return `ok=${r.ok} ready=${r.ready} reason=${r.reason}`;
    if (r.payloadNeeded !== false) return `payloadNeeded=${r.payloadNeeded}`;
    // 真源规模会随内核增长，不写死条数与字节数 —— 现读真源比对。写死会在内核长大时变成
    // 假红灯，掩盖真正的失效（0.45 线时真源已从 9 条 unit / 16456 B 变成 14 条 / 13509 B）。
    const truthFile = join(resolveKernelRoot(), "prompts", "infinite-gen-5.md");
    const truthBytes = Buffer.byteLength(readFileSync(truthFile, "utf8"), "utf8");
    if (!(r.kernel?.units >= 9)) return `units=${r.kernel?.units}（应 ≥9）`;
    if (r.kernel.bytes !== truthBytes) return `kernelBytes=${r.kernel.bytes} ≠ 真源 ${truthBytes} B`;
    if (r.plan?.carrier !== "system" || r.plan?.slot !== "LAST" || r.plan?.budgetBytes !== 40000) return `plan=${JSON.stringify(r.plan)}`;
    if (r.plan.degraded !== true) return `degraded=${r.plan.degraded}（无信号必须标降级）`;
    const ids = (r.inject?.selected || []).map((s) => s.id);
    if (ids.join(",") !== "L_dispatch") return `selected=${ids.join(",")}`;
    if (!r.inject.selected[0].matched.includes("子代理")) return `matched=${JSON.stringify(r.inject.selected[0].matched)}`;
    return true;
  });

  await check("T9", "adapt live:false：只回计划、绝不打探针（桩计数不增）", async () => {
    const before = ADAPT_HITS;
    const r = await adapted.execute({ action: "adapt", prompt: "这一轮只是问个好" });
    if (ADAPT_HITS !== before) return `桩被打了：hits ${before}→${ADAPT_HITS}`;
    if (r.dryRun !== true || r.reason !== "live-required") return `dryRun=${r.dryRun} reason=${r.reason}`;
    if ((r.inject?.selected || []).length !== 0) return `没提触发词却选了 ${r.inject.selected.length} 条`;
    return true;
  });

  await check("T10", "adapt live:true 探兼容桩：accepted + 131072 窗口 → LAST/40000B，且不泄漏密钥与路径", async () => {
    const r = await adapted.execute({ action: "adapt", prompt: "帮我派个子代理", live: true });
    if (r.ok !== true) return `ok=${r.ok} reason=${r.reason}`;
    if (r.signals?.systemRole !== "accepted") return `systemRole=${r.signals?.systemRole}`;
    if (Number(r.signals?.contextWindow) !== 131072) return `contextWindow=${r.signals?.contextWindow}`;
    if (r.plan?.carrier !== "system" || r.plan?.slot !== "LAST") return `plan=${JSON.stringify(r.plan)}`;
    if (Number(r.plan?.budgetBytes) !== 40000) return `budgetBytes=${r.plan?.budgetBytes}`;
    if (r.plan.confidence !== "high") return `confidence=${r.plan.confidence}`;
    if (r.host !== `127.0.0.1:${adaptMock.port}`) return `host=${r.host}`;
    const blob = JSON.stringify(r);
    if (blob.includes("KEY_PLACEHOLDER")) return "回执里带出了 API key";
    if (blob.includes("/v1")) return "回执里带出了端点路径";
    return true;
  });

  await check("T11", "adapt live:true 探拒收 system 的桩：探针 2 证明端点活着 → carrier=inline", async () => {
    const r = await rejecting.execute({ action: "adapt", prompt: "帮我派个子代理", live: true });
    if (r.signals?.systemRole !== "rejected") return `systemRole=${r.signals?.systemRole}`;
    if (r.used !== 2) return `used=${r.used}（拒收后应发探针 2 反证）`;
    if (r.plan?.carrier !== "inline" || r.plan?.slot !== "INLINE") return `plan=${JSON.stringify(r.plan)}`;
    return true;
  });

  // T12/T13 用同一份临时清单：一条指向本地兼容桩（local-stub），一条来源不明（该被拒）。
  const inventoryPath = join(dir, "inventory.json");
  writeFileSync(
    inventoryPath,
    JSON.stringify({
      version: "ig5-endpoint-inventory/1",
      entries: [
        { id: "loopback", baseUrl: `http://127.0.0.1:${adaptMock.port}`, model: "MODEL_ID", provenance: "local-stub" },
        { id: "someone-else", baseUrl: "http://127.0.0.1:9", model: "MODEL_ID", provenance: "unknown" },
      ],
    }),
    "utf8",
  );

  await check("T12", "inventory 未开 live：只校验清单、零网络包，且被拒条目单独列出", async () => {
    const before = ADAPT_HITS;
    const r = await adapted.execute({ action: "inventory", inventory: inventoryPath });
    if (r.ok !== true || r.reason !== "live-required") return `ok=${r.ok} reason=${r.reason}`;
    if (r.dryRun !== true) return `dryRun=${r.dryRun}`;
    if (r.counts?.entries !== 2 || r.counts?.planned !== 1 || r.counts?.rejected !== 1) return `counts=${JSON.stringify(r.counts)}`;
    if (!String(r.rejected?.[0]).includes("provenance-not-owned")) return `rejected=${JSON.stringify(r.rejected)}`;
    if (r.planned?.[0]?.host !== `127.0.0.1:${adaptMock.port}`) return `planned=${JSON.stringify(r.planned)}`;
    if (ADAPT_HITS !== before) return `桩被打了：hits ${before}→${ADAPT_HITS}`;
    return true;
  });

  await check("T13", "inventory live:true：真发包并把载体/槽位/预算记成一行，被拒条目仍不发包", async () => {
    const r = await adapted.execute({ action: "inventory", inventory: inventoryPath, live: true });
    if (r.ok !== true || r.live !== true) return `ok=${r.ok} reason=${r.reason}`;
    const row = r.rows?.find((x) => x.id === "loopback");
    if (!row) return `rows=${JSON.stringify(r.rows)}`;
    if (row.carrier !== "system" || row.slot !== "LAST") return `carrier=${row.carrier} slot=${row.slot}`;
    if (Number(row.budgetBytes) !== 40000) return `budgetBytes=${row.budgetBytes}`;
    if (row.confidence !== "high") return `confidence=${row.confidence}`;
    if (r.rows.some((x) => x.id === "someone-else")) return "被拒条目竟然出现在了 rows 里";
    if (!String(r.report ?? "").includes("被拒条目")) return "报告没渲染被拒段";
    return true;
  });

  mock.close();
  adaptMock.server.close();
  rejectMock.server.close();
  const passed = results.filter((r) => r.ok).length;
  if (process.argv.includes("--json")) console.log(`IG5_RELAY_TEST_JSON ${JSON.stringify({ passed, total: results.length, results })}`);
  console.log(`结果：${passed}/${results.length} 条判据通过`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
