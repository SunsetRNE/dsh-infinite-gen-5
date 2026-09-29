// 无限五代 · 端点直连层（endpoint relay）
//
// 这一层只做一件事：把「已编译好的载荷」按 OpenAI 兼容的 /chat/completions 形态
// 发到目标端点，并把回执原样取回来。它不认识内核，也不认识题库 —— 纯传输。
//
// 三条硬约束（写在代码里，不写在注释里）：
//   1) 密钥只从环境变量读，永远不出现在返回值、日志、错误信息里（redact() 兜底）。
//   2) 预算是硬门：maxRequests / maxTotalTokens / maxWallMs 任一触顶立即停止，
//      不「再试一次」。跑批脚本必须显式传入，缺省值偏保守。
//   3) dryRun 不建连接。模拟回执会带 _dryRun:true，调用方不得把它当成真实回执。
//
// 端点形态依据：OpenAI 兼容的 chat completions 公开文档形态（messages / model /
// max_tokens / usage）。非兼容端点由 targets 侧适配，本文件不做猜测。

export const RELAY_SCHEMA = "ig5-relay/1";

export const DEFAULT_BUDGET = Object.freeze({
  maxRequests: 200,
  maxTotalTokens: 2_000_000,
  maxWallMs: 30 * 60 * 1000,
  concurrency: 2,
});

export const RETRY = Object.freeze({
  attempts: 3,
  baseDelayMs: 800,
  maxDelayMs: 15_000,
  // 可重试：网络层失败 / 429 / 5xx。不可重试：4xx（除 429）—— 重试不会让鉴权或参数错误自己变好。
  retryableStatus: (s) => s === 429 || (s >= 500 && s <= 599),
});

/** 密钥脱敏。任何要落盘或抛出的字符串都先过这一层。 */
export function redact(text, secret) {
  let out = String(text ?? "");
  if (secret) out = out.split(secret).join("***REDACTED***");
  return out.replace(/\b(sk-[A-Za-z0-9_\-]{8,})\b/g, "***REDACTED***").replace(/Bearer\s+\S+/gi, "Bearer ***REDACTED***");
}

/**
 * 从环境变量解析端点。缺任何一项都返回 problems，由调用方决定是停还是走 dry-run。
 * 变量名用占位符写法，真实值由用户在自有环境注入。
 */
export function resolveRelay(env = process.env, overrides = {}) {
  const baseUrl = overrides.baseUrl ?? env.IG5_RELAY_BASE_URL ?? "";
  const apiKey = overrides.apiKey ?? env.IG5_RELAY_API_KEY ?? "";
  const model = overrides.model ?? env.IG5_RELAY_MODEL ?? "TARGET_MODEL";
  const problems = [];
  if (!baseUrl) problems.push("缺少 IG5_RELAY_BASE_URL（端点 base，例：https://HOST/v1）");
  if (!apiKey) problems.push("缺少 IG5_RELAY_API_KEY");
  if (!/^https?:\/\//.test(baseUrl)) problems.push("IG5_RELAY_BASE_URL 必须是 http(s) 绝对地址");
  return Object.freeze({
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model,
    reasoning: overrides.reasoning ?? env.IG5_RELAY_REASONING ?? "",
    timeoutMs: Number(overrides.timeoutMs ?? env.IG5_RELAY_TIMEOUT_MS ?? 120_000),
    problems,
    ready: problems.length === 0,
  });
}

/** 一个只在本进程内累计的记账器：请求数、token、墙钟。触顶即 closed。 */
export function createLedger(budget = DEFAULT_BUDGET, now = () => Date.now()) {
  const started = now();
  const state = { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, failures: 0, closed: false, stopReason: null };
  const elapsed = () => now() - started;
  const close = (reason) => { state.closed = true; state.stopReason = state.stopReason ?? reason; };
  return {
    state,
    elapsed,
    /** 开跑前问一次：还能不能发。 */
    admit() {
      if (state.closed) return { ok: false, reason: state.stopReason };
      if (state.requests >= budget.maxRequests) { close(`请求数触顶 ${budget.maxRequests}`); return { ok: false, reason: state.stopReason }; }
      if (state.totalTokens >= budget.maxTotalTokens) { close(`token 触顶 ${budget.maxTotalTokens}`); return { ok: false, reason: state.stopReason }; }
      if (elapsed() >= budget.maxWallMs) { close(`墙钟触顶 ${budget.maxWallMs}ms`); return { ok: false, reason: state.stopReason }; }
      return { ok: true };
    },
    /** 收到 usage 后结算。没有 usage 字段时按 0 记，不猜。 */
    settle(usage) {
      state.requests += 1;
      if (usage && typeof usage === "object") {
        state.promptTokens += Number(usage.prompt_tokens ?? 0);
        state.completionTokens += Number(usage.completion_tokens ?? 0);
        state.totalTokens += Number(usage.total_tokens ?? (Number(usage.prompt_tokens ?? 0) + Number(usage.completion_tokens ?? 0)));
      }
      return state;
    },
    fail() { state.failures += 1; return state; },
    close,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 发一次 chat completion。
 * 返回 {ok, status, text, usage, model, attempts, skipped} 或 {ok:false, error, status, attempts}。
 * 不抛异常 —— 跑批脚本要的是「这一条失败」，不是整个进程崩。
 */
export async function chatComplete({
  relay,
  messages,
  maxTokens = 4096,
  temperature = 1,
  fetchImpl = globalThis.fetch,
  dryRun = false,
  dryReply = null,
  signal = null,
  onAttempt = null,
}) {
  if (dryRun) {
    return {
      ok: true,
      skipped: true,
      _dryRun: true,
      status: 0,
      attempts: 0,
      model: relay?.model ?? "TARGET_MODEL",
      text: dryReply ?? "",
      usage: null,
    };
  }
  if (!relay?.ready) {
    return { ok: false, error: `端点未就绪：${(relay?.problems ?? ["relay 未提供"]).join("；")}`, status: 0, attempts: 0 };
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, error: "运行时没有 fetch（需要 Node 18+ 或显式注入 fetchImpl）", status: 0, attempts: 0 };
  }

  const url = `${relay.baseUrl}/chat/completions`;
  const body = { model: relay.model, messages, temperature, max_tokens: maxTokens };
  if (relay.reasoning) body.reasoning_effort = relay.reasoning;
  let last = null;

  for (let attempt = 1; attempt <= RETRY.attempts; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error("timeout")), relay.timeoutMs);
    const abort = () => ac.abort(new Error("aborted"));
    if (signal) signal.addEventListener("abort", abort, { once: true });
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${relay.apiKey}` },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const raw = await res.text();
      onAttempt?.({ attempt, status: res.status });
      if (!res.ok) {
        last = { ok: false, status: res.status, error: redact(raw.slice(0, 400), relay.apiKey), attempts: attempt };
        if (!RETRY.retryableStatus(res.status)) return last;
        const retryAfter = Number(res.headers?.get?.("retry-after") ?? 0);
        const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(RETRY.maxDelayMs, RETRY.baseDelayMs * 2 ** (attempt - 1));
        if (attempt < RETRY.attempts) await sleep(delay);
        continue;
      }
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      // 回执文本：优先取 choices[0].message.content；兼容把整段 JSON 原样返回的端点。
      const text = parsed?.choices?.[0]?.message?.content ?? parsed?.choices?.[0]?.text ?? raw;
      return {
        ok: true,
        skipped: false,
        status: res.status,
        attempts: attempt,
        model: parsed?.model ?? relay.model,
        text: typeof text === "string" ? text : JSON.stringify(text),
        usage: parsed?.usage ?? null,
        finishReason: parsed?.choices?.[0]?.finish_reason ?? null,
      };
    } catch (err) {
      last = { ok: false, status: 0, error: redact(err?.message ?? String(err), relay.apiKey), attempts: attempt };
      if (attempt < RETRY.attempts) await sleep(Math.min(RETRY.maxDelayMs, RETRY.baseDelayMs * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abort);
    }
  }
  return last ?? { ok: false, status: 0, error: "未知失败", attempts: RETRY.attempts };
}

/** 按并发上限跑一批任务，结果顺序与输入一致。任何单条失败都只影响该条。 */
export async function pool(items, worker, concurrency = DEFAULT_BUDGET.concurrency) {
  const out = new Array(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const i = cursor;
        cursor += 1;
        if (i >= items.length) return;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}
