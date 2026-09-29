// 无限五代 · 端点通道本地桩（mock endpoint）
//
// 用途只有一个：**在没有密钥、没有出网的环境里，把端点通道整条链路跑通并可验证**。
// 它实现 OpenAI 兼容的最小面：POST {base}/chat/completions → choices[0].message.content。
//
// 行为是确定性的（回执由 prompt 里的题号决定，不用随机数），所以「同一输入两次跑结果一致」
// 可以被当成判据用。三种故障注入也在这里，用来验证重试与失败分流：
//   MOCK_FLAKY_429 —— 该题第一次 429、第二次 200（验证指数退避重试）
//   MOCK_HARD_500  —— 该题一直 500（验证重试耗尽后按单条失败记录，不拖垮整批）
//   MOCK_REFUSAL   —— 该题返回纯拒绝文案（验证 receipt 提取不到时记 missing）
//
//   node mock-endpoint.mjs --port 8787 --once   # 起桩，处理一批后退出
//   node mock-endpoint.mjs --port 8787          # 常驻，Ctrl-C 退出

import { createServer } from "node:http";

export const MOCK_VERSION = "ig5-mock-endpoint/1";

/** 题号 → 确定性回执。同一题号永远同一结果，故整条链路可复现。 */
export function receiptFor(probeId, index = 0) {
  const n = Number(String(probeId).replace(/\D/g, "")) || index;
  const table = ["deliver", "pivot", "boundary", "miss"];
  const disposition = table[n % table.length];
  return {
    id: probeId,
    disposition,
    pattern: `MOCK_PATTERN_${n % 7}`,
    mechanism: `mock mechanism #${n % 5}`,
    opening: `桩回执：题 ${probeId} 判为 ${disposition}（本地桩生成，非真实模型输出）`,
    note: "mock-endpoint 生成，用于链路验证",
  };
}

export function idsIn(text) {
  // 只认名册行 `[q003] 维度=…`。格式模板里还有一句「- id：题号（q001 形态）」，
  // 用松散的 \bq\d{3}\b 匹配会把那个示例号当成待答的题 —— 实测踩过：
  // 6 道题抽出 8 个 id（每个 shard 都多带一个 q001）。
  const roster = [...String(text ?? "").matchAll(/^\[(q\d{3})\]/gm)].map((m) => m[1]);
  return [...new Set(roster)];
}

function completion(content, model) {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
  };
}

export function createMockServer({ model = "MOCK_MODEL", state = new Map() } = {}) {
  const server = createServer((req, res) => {
    const send = (code, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
    };
    if (req.method !== "POST" || !req.url.startsWith("/chat/completions")) return send(404, { error: { message: "only POST /chat/completions" } });

    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body = null;
      try { body = JSON.parse(raw); } catch { return send(400, { error: { message: "bad json" } }); }
      const text = (body.messages ?? []).map((m) => m.content ?? "").join("\n");
      const ids = idsIn(text);
      const first = ids[0] ?? "q000";

      if (text.includes("MOCK_HARD_500")) return send(500, { error: { message: "injected hard failure" } });
      if (text.includes("MOCK_FLAKY_429")) {
        const seen = state.get("flaky") ?? 0;
        state.set("flaky", seen + 1);
        if (seen === 0) return send(429, { error: { message: "injected rate limit" } });
      }
      if (text.includes("MOCK_REFUSAL")) {
        return send(200, completion("I can't help with that request.", model));
      }
      const receipts = ids.map((id, i) => receiptFor(id, i));
      if (!receipts.length) return send(200, completion("no probe id found in prompt", model));
      return send(200, completion(JSON.stringify({ receipts }), model));
    });
  });
  return server;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("mock-endpoint.mjs");
if (invokedDirectly) {
  const flag = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : dflt;
  };
  const port = Number(flag("port", 8787));
  const server = createMockServer({ model: flag("model", "MOCK_MODEL") });
  server.listen(port, "127.0.0.1", () => {
    console.log(`mock endpoint 就绪：http://127.0.0.1:${port}/chat/completions  模型 ${flag("model", "MOCK_MODEL")}`);
  });
}
