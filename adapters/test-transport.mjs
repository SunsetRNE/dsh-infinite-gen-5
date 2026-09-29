#!/usr/bin/env node
// 端点传输层验证件：直连真实端点之前，先把「会失败的那几条路」在本地桩上跑一遍。
//
// 为什么要单独验：真实端点的常态不是 200，而是 429 与 5xx。如果重试阶梯、
// 放弃条件、回执缺口统计没验过，一次限流就会把整批跑批变成「静默的 0 分」。
//
// 用法：node test-transport.mjs
// 退出码：0 = 三条路径全部符合预期；1 = 有偏差。

import { createMockServer, MOCK_VERSION } from "./mock-endpoint.mjs";
import { chatComplete, RETRY, resolveRelay } from "./lib/provider-api.mjs";

const results = [];
const check = (id, claim, ok, detail) => {
  results.push({ id, claim, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${id}  ${claim}`);
  if (detail) console.log(`      ${detail}`);
};

const server = createMockServer({ model: "MOCK_MODEL" });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const relay = { baseUrl: `http://127.0.0.1:${port}`, apiKey: "MOCK_KEY", model: "MOCK_MODEL", timeoutMs: 20_000, ready: true, problems: [] };
const ask = (content) => chatComplete({ relay, messages: [{ role: "user", content }], maxTokens: 64 });

console.log(`## 端点传输层验证 · 桩 ${MOCK_VERSION}`);
console.log(`重试阶梯：最多 ${RETRY.attempts} 次，退避 ${RETRY.baseDelayMs}ms 起、${RETRY.maxDelayMs}ms 封顶`);
console.log("");

// 1) 恒 500：必须重试到上限后放弃，且返回对象而不是抛异常
const t0 = Date.now();
const hard = await ask("MOCK_HARD_500 这道题用于验证重试上限");
const hardMs = Date.now() - t0;
check(
  "T1",
  "恒 5xx：重试到上限后放弃，返回 ok:false 且不抛异常",
  hard.ok === false && hard.status === 500 && hard.attempts === RETRY.attempts && hardMs >= RETRY.baseDelayMs,
  `ok=${hard.ok} status=${hard.status} attempts=${hard.attempts}/${RETRY.attempts} 耗时 ${hardMs}ms 兜底错误="${hard.error ?? ""}"`,
);

// 2) 首次 429 后成功：必须重试且第二次拿到结果
const flaky = await ask("MOCK_FLAKY_429 这道题用于验证退避重试");
check(
  "T2",
  "429 限流一次后成功：重试生效，最终 ok:true 且 attempts=2",
  flaky.ok === true && flaky.attempts === 2 && flaky.status === 200,
  `ok=${flaky.ok} status=${flaky.status} attempts=${flaky.attempts} 文本 ${Buffer.byteLength(flaky.text ?? "", "utf8")} B`,
);

// 3) 无回执的拒绝文案：传输层照收（它是 200），缺口由上层统计，不是这里吞掉
const refusal = await ask("MOCK_REFUSAL 这道题用于验证无回执分支");
const ids = [...String(refusal.text ?? "").matchAll(/^\[(q\d{3})\]/gm)];
check(
  "T3",
  "纯拒绝文案（200 但无回执）：传输层不伪造回执，缺口留给上层统计",
  refusal.ok === true && ids.length === 0 && Buffer.byteLength(refusal.text ?? "", "utf8") > 0,
  `ok=${refusal.ok} status=${refusal.status} 题号 ${ids.length} 个 · 正文 ${Buffer.byteLength(refusal.text ?? "", "utf8")} B`,
);

// 4) 超时路径：把超时压到 1ms，必须走 AbortController 而不是挂死
const t1 = Date.now();
const slow = await chatComplete({ relay: { ...relay, timeoutMs: 1 }, messages: [{ role: "user", content: "slow" }], maxTokens: 8 });
check(
  "T4",
  "超时：AbortController 生效，返回 ok:false 而不是挂死",
  slow.ok === false && Date.now() - t1 < 5_000,
  `ok=${slow.ok} attempts=${slow.attempts} error="${(slow.error ?? "").slice(0, 60)}" 耗时 ${Date.now() - t1}ms`,
);

// 5) 缺配置：不就绪时不许发请求（降级分支的前提）
const bare = resolveRelay({});
check(
  "T5",
  "缺配置不就绪：无密钥/无地址时明确不就绪，问题逐条列出",
  bare.ready === false && bare.problems.length >= 2,
  `ready=${bare.ready} 问题：${bare.problems.join("；")}`,
);

await new Promise((r) => server.close(r));

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(`结果：${results.length - failed.length}/${results.length} 条判据通过${failed.length ? `（失败：${failed.map((r) => r.id).join(", ")}）` : ""}`);
process.exit(failed.length ? 1 : 0);
