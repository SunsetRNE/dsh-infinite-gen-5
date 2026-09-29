// test-dynamic-adapt.mjs — 用三种仿真端点真跑「探测 → 适配 → 逐轮注入」，判据 F1–F7。
//
// 三个桩端点（本地 node:http，随机端口）：
//   A 正常网关      ：收 system，回 usage，并在回执头带 x-context-window
//   B 拒收 system   ：messages 里出现 role:"system" 就 400，正文点明 system role 不支持
//   C 上下文受限    ：请求体超 4096 B 就 400，正文写 "maximum context length is 8192 tokens"
//
// 桩是夹具（fixture），不是对真实网关的断言；真实端点的行为只能靠 probeEndpoint 现场探。

import { resolvePromptsDir } from "./lib/kernel-root.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { probeEndpoint } from "./lib/endpoint-probe.mjs";
import { adaptPlan, selectLazyUnits, buildTurn } from "./lib/dynamic-adapt.mjs";
import { parseLazyUnits } from "./lib/kernel-compiler.mjs";

const PROMPT_DIR = resolvePromptsDir();
const kernelText = readFileSync(`${PROMPT_DIR}/infinite-gen-5.md`, "utf8");
const units = parseLazyUnits(readFileSync(`${PROMPT_DIR}/infinite-gen-5-lazy.md`, "utf8"));
const INDEX_TEXT = "## 域索引（探针用占位）\n- offense: web/api\n";

const results = [];
function judge(id, ok, detail) {
  results.push({ id, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail}`);
}
const sha = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 16);

function reply(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body);
}

function ok200(res, text, headers) {
  reply(res, 200, {
    id: "chatcmpl-mock",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 21, completion_tokens: 2, total_tokens: 23 },
  }, headers);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function startMock(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const mockA = await startMock(async (req, res) => {
  await readBody(req);
  ok200(res, "IG5_PROBE_OK", { "x-context-window": "131072", "x-request-id": "mock-a" });
});

const mockB = await startMock(async (req, res) => {
  const body = JSON.parse((await readBody(req)) || "{}");
  const hasSystem = (body.messages || []).some((m) => m.role === "system");
  if (hasSystem) {
    return reply(res, 400, { error: { message: "Invalid request: system role is not supported by this model", type: "invalid_request_error" } });
  }
  ok200(res, "IG5_PROBE_OK");
});

const mockC = await startMock(async (req, res) => {
  const raw = await readBody(req);
  if (Buffer.byteLength(raw, "utf8") > 4096) {
    return reply(res, 400, {
      error: { message: "This model's maximum context length is 8192 tokens. Please reduce the length of the messages.", type: "invalid_request_error" },
    });
  }
  ok200(res, "IG5_PROBE_OK");
});

const base = (p) => `http://127.0.0.1:${p}/v1`;

try {
  // ---------- A：正常网关 ----------
  const probeA = await probeEndpoint({ baseUrl: base(mockA.port), model: "MOCK_A", timeoutMs: 5000 });
  const planA = adaptPlan(probeA.signals, { kernelBytes: Buffer.byteLength(kernelText, "utf8") });
  judge("F1a", probeA.ok && probeA.signals.systemRole === "accepted", `正常网关 systemRole=${probeA.signals.systemRole} used=${probeA.used}`);
  judge(
    "F1b",
    planA.carrier === "system" && planA.slot === "LAST" && planA.injectLazy && planA.confidence === "high",
    `正常网关 → carrier=${planA.carrier} slot=${planA.slot} injectLazy=${planA.injectLazy} conf=${planA.confidence} budget=${planA.budget.totalBytes}`
  );
  judge("F1c", probeA.signals.usageReported === true && probeA.signals.contextWindow === 131072, `usage=${probeA.signals.usageReported} window=${probeA.signals.contextWindow}`);

  // ---------- B：拒收 system ----------
  const probeB = await probeEndpoint({ baseUrl: base(mockB.port), model: "MOCK_B", timeoutMs: 5000 });
  const planB = adaptPlan(probeB.signals, { kernelBytes: Buffer.byteLength(kernelText, "utf8") });
  const turnB = buildTurn({ kernelText, indexText: INDEX_TEXT, units, plan: planB, userTurn: "帮我分发到子代理" });
  const rolesB = turnB.messages.map((m) => m.role);
  judge("F2a", probeB.signals.systemRole === "rejected" && probeB.used === 2, `拒收 system systemRole=${probeB.signals.systemRole} 探针数=${probeB.used}`);
  judge(
    "F2b",
    planB.carrier === "inline" && planB.slot === "INLINE" && !rolesB.includes("system"),
    `内联回退 carrier=${planB.carrier} roles=[${rolesB.join(",")}]`
  );
  judge("F2c", turnB.messages.at(-1).content.startsWith(kernelText.trim().slice(0, 40)), `内联载荷在 user 消息开头（首 40 字）`);

  // ---------- C：上下文受限 ----------
  // 上限只在「摸到」时才现形：小请求一律 200，所以这里主动加 padding 触顶，再读回执里的数字。
  const probeC = await probeEndpoint({ baseUrl: base(mockC.port), model: "MOCK_C", timeoutMs: 5000, padding: 6000 });
  const planC = adaptPlan(probeC.signals, { kernelBytes: Buffer.byteLength(kernelText, "utf8") });
  judge("F3a", probeC.signals.contextWindow === 8192, `受限端点 contextWindow=${probeC.signals.contextWindow}`);
  judge(
    "F3b",
    planC.lazyMode === "off" && planC.injectLazy === false && planC.indexInline === false && planC.budget.totalBytes < Buffer.byteLength(kernelText, "utf8"),
    `超预算降级 lazyMode=${planC.lazyMode} injectLazy=${planC.injectLazy} indexInline=${planC.indexInline} budget=${planC.budget.totalBytes} < kernel=${Buffer.byteLength(kernelText, "utf8")}`
  );

  // ---------- D：逐轮动态注入 ----------
  const planD = adaptPlan(probeA.signals, { kernelBytes: Buffer.byteLength(kernelText, "utf8") });
  const dispatchUnit = units.find((u) => u.id === "L_dispatch");
  const turnHit = buildTurn({ kernelText, units, plan: planD, userTurn: `帮我${dispatchUnit.triggers[0]}两题` });
  const turnMiss = buildTurn({ kernelText, units, plan: planD, userTurn: "这一轮只是问个好" });
  const hitBody = turnHit.messages.at(-1).content.includes(dispatchUnit.body.trim().slice(0, 30));
  judge("F4a", turnHit.injected.includes("L_dispatch") && hitBody, `命中注入 injected=[${turnHit.injected.join(",")}] 正文落地=${hitBody}`);
  judge("F4b", turnMiss.injected.length === 0 && !turnMiss.messages.at(-1).content.includes("动态注入"), `无触发词零注入 injected=${turnMiss.injected.length}`);
  const sel = selectLazyUnits(`请${dispatchUnit.triggers[1]}`, units);
  const selKeys = sel[0] ? Object.keys(sel[0]).join(",") : "";
  judge("F4c", sel.length === 1 && sel[0].matched.length >= 1 && selKeys === "id,order,anchor,bytes,matched", `选择器只按触发词命中 ${sel[0]?.id} matched=[${sel[0]?.matched.join(",")}] 字段=${selKeys}`);

  // ---------- E：预算闸门 ----------
  // 预算按真源第一条的实测字节数设——刚好装得下第一条，后面的必须被挡下来（不写死数字，避免真源一改判据就失真）。
  const tightBudget = units[0].bytes;
  const tinyPlan = { ...planD, budget: { ...planD.budget, lazyBudgetBytes: tightBudget } };
  const multiTurn = buildTurn({ kernelText, units, plan: tinyPlan, userTurn: units.slice(0, 4).map((u) => u.triggers[0]).join(" ") });
  judge(
    "F5",
    multiTurn.injected.length === 1 && multiTurn.skipped.length >= 1 && multiTurn.injected[0] === units[0].id,
    `预算闸门 上限=${tightBudget}B injected=[${multiTurn.injected.join(",")}] skipped=[${multiTurn.skipped.map((s) => s.id).join(",")}]`
  );

  // ---------- F：可复现 ----------
  const again = buildTurn({ kernelText, units, plan: planD, userTurn: `帮我${dispatchUnit.triggers[0]}两题` });
  judge("F6", sha(turnHit) === sha(again) && sha(planD) === sha(adaptPlan(probeA.signals, { kernelBytes: Buffer.byteLength(kernelText, "utf8") })), `两次构建同 sha ${sha(turnHit)}`);

  // ---------- G：探不到端点 ----------
  const dead = await probeEndpoint({ baseUrl: "http://127.0.0.1:9/v1", model: "MOCK_DEAD", timeoutMs: 2000 });
  const planDead = adaptPlan(dead.signals, { kernelBytes: Buffer.byteLength(kernelText, "utf8") });
  const turnDead = buildTurn({ kernelText, units, plan: planDead, userTurn: "分发" });
  judge("F7", dead.ok === false && planDead.degraded === true && turnDead.messages.length >= 1, `端点不可达 didNotThrow ok=${dead.ok} degraded=${planDead.degraded} messages=${turnDead.messages.length}`);

  // ---------- 汇总 ----------
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n判据 ${passed}/${results.length} 通过`);
  console.log(`载体矩阵：A=${planA.carrier}/${planA.budget.totalBytes}B · B=${planB.carrier} · C=${planC.lazyMode}/${planC.budget.totalBytes}B · 死端点 degraded=${planDead.degraded}`);
  if (passed !== results.length) process.exitCode = 1;
} finally {
  for (const { server } of [mockA, mockB, mockC]) server.close();
}
