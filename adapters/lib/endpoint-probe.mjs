// lib/endpoint-probe.mjs — 端点能力探针：真发两条小请求，把「端点能吃什么」变成可判读的信号。
//
// 为什么必须实测：同一句 `POST /chat/completions`，不同网关的行为差得很远 ——
//   有的拒收 role:"system"（只认 user/assistant）、有的在上下文超限时回 400 并在正文里点明 token 上限、
//   有的把 max_tokens 静默削掉、有的不回 usage。这些都是**回执里能读到的字面事实**，不是猜的。
//
// 探针只花两条最小请求（system+user 各一条），失败也不重试：
//   探针 1：messages=[system, user]，max_tokens=16   → 判 systemRole 收不收
//   探针 2：只在探针 1 被拒时发 → messages=[user]（把 system 文本并进 user）→ 证明端点本身活着
//
// 信号只有三态：accepted / rejected / unknown。读不出来的就写 unknown，绝不填默认值。

const PROBE_TOKEN = "IG5_PROBE_OK";

const SYSTEM_ROLE_PATTERNS = [
  /system role/i,
  /role["'\s:]+system/i,
  /unsupported role/i,
  /invalid role/i,
  /messages\[\d+\]\.role/i,
  /does not support.*system/i,
];

const LIMIT_PATTERNS = [
  { id: "context-window", re: /maximum context length is\s+(\d+)\s*tokens/i },
  { id: "context-window", re: /context length(?: of| is)?\s*(\d+)/i },
  { id: "context-window", re: /(?:max|maximum)\s+(?:context|prompt)[^\d]{0,24}(\d{3,})/i },
  { id: "context-window", re: /reduce the length of the (?:messages|prompt)/i },
  { id: "max-output", re: /max_tokens[^\d]{0,24}(\d+)/i },
];

export const PROBE_VERSION = "ig5-endpoint-probe/1";

function chatUrl(baseUrl) {
  if (!baseUrl) return "";
  return /\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function errorText(status, text) {
  // 网关的报错常塞在 JSON 里（error.message / message / detail），三种都试着取。
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.error?.message ?? parsed?.message ?? parsed?.detail ?? text);
  } catch {
    return String(text ?? "");
  }
}

function matchSystemRole(message) {
  return SYSTEM_ROLE_PATTERNS.some((re) => re.test(message));
}

function extractLimits(message) {
  const found = { contextWindow: null, maxOutput: null };
  for (const { id, re } of LIMIT_PATTERNS) {
    const hit = re.exec(message);
    if (!hit) continue;
    if (id === "context-window" && found.contextWindow === null && hit[1]) found.contextWindow = Number(hit[1]);
    if (id === "max-output" && found.maxOutput === null && hit[1]) found.maxOutput = Number(hit[1]);
    if (id === "context-window" && found.contextWindow === null && !hit[1]) found.contextWindow = -1; // 「请缩短」但没给数
  }
  return found;
}

async function post(url, { apiKey, timeoutMs }, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const headers = {};
    for (const key of ["x-ratelimit-limit-tokens", "x-context-window", "x-model", "x-request-id"]) {
      const value = res.headers.get(key);
      if (value) headers[key] = value;
    }
    return { status: res.status, ok: res.ok, text, parsed, headers, ms: Date.now() - startedAt };
  } catch (error) {
    const name = String((error && error.name) || "");
    return {
      status: 0,
      ok: false,
      text: "",
      parsed: null,
      headers: {},
      ms: Date.now() - startedAt,
      transport: name === "AbortError" ? "timeout" : `transport: ${String((error && error.message) || error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function bodyOf({ model, messages, maxTokens }) {
  return { model, messages, max_tokens: maxTokens, temperature: 0 };
}

/**
 * 探测端点能力。只发 1–2 条最小请求；任何失败都落成信号，不抛。
 * @returns {Promise<{ok:boolean, signals:object, probes:Array, version:string}>}
 */
export async function probeEndpoint({ baseUrl, apiKey = "", model = "MODEL_ID", timeoutMs = 20000, confirm = 1, padding = 0 } = {}) {
  const url = chatUrl(baseUrl);
  const probes = [];
  const signals = {
    systemRole: "unknown",
    contextWindow: null,
    maxOutput: null,
    usageReported: false,
    emptyContent: false,
    headerHints: {},
    transport: null,
  };
  if (!url) return { ok: false, signals, probes, version: PROBE_VERSION, reason: "endpoint-unset" };

  const first = await post(url, { apiKey, timeoutMs }, bodyOf({
    model,
    messages: [
      { role: "system", content: "只回一个词。" },
      { role: "user", content: `请回：${PROBE_TOKEN}${Number(padding) > 0 ? "\n" + "x".repeat(Math.floor(Number(padding))) : ""}` },
    ],
    maxTokens: 16,
  }));
  const firstMessage = first.transport ?? errorText(first.status, first.text);
  probes.push({ probe: "system-role", status: first.status, ok: first.ok, ms: first.ms, message: firstMessage.slice(0, 240) });
  signals.headerHints = first.headers;

  if (first.ok) {
    signals.systemRole = "accepted";
  } else if (first.status >= 400 && first.status < 500 && matchSystemRole(firstMessage)) {
    signals.systemRole = "rejected";
  } else if (first.status) {
    signals.systemRole = "unknown";
  }

  const observed = extractLimits(firstMessage);
  signals.contextWindow = observed.contextWindow ?? (first.headers["x-context-window"] ? Number(first.headers["x-context-window"]) : null);
  signals.maxOutput = observed.maxOutput;

  if (signals.systemRole === "rejected") {
    const second = await post(url, { apiKey, timeoutMs }, bodyOf({
      model,
      messages: [{ role: "user", content: `只回一个词。请回：${PROBE_TOKEN}` }],
      maxTokens: 16,
    }));
    const secondMessage = second.transport ?? errorText(second.status, second.text);
    probes.push({ probe: "user-only", status: second.status, ok: second.ok, ms: second.ms, message: secondMessage.slice(0, 240) });
    if (!second.ok) {
      const more = extractLimits(secondMessage);
      signals.contextWindow = more.contextWindow ?? signals.contextWindow;
      signals.maxOutput = more.maxOutput ?? signals.maxOutput;
    }
  }

  const lastOk = probes.some((p) => p.ok);
  const usage = first.parsed?.usage ?? null;
  signals.usageReported = Boolean(usage && typeof usage === "object");
  if (first.ok) signals.emptyContent = !String(first.parsed?.choices?.[0]?.message?.content ?? "").trim();
  signals.transport = first.transport ?? probes.find((p) => p.transport)?.transport ?? null;

  // confirm 表示「这一轮允许打几条真实请求」，探针绝不超过它。
  const used = probes.length;
  return {
    ok: lastOk,
    version: PROBE_VERSION,
    url,
    model,
    confirm,
    padding: Number(padding) || 0,
    used,
    signals,
    probes,
    confidence: first.ok && signals.usageReported ? "high" : "low",
  };
}

export default probeEndpoint;
