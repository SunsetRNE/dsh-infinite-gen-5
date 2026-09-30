#!/usr/bin/env node
// 无限五代 · 生图端点参数探针（真靶联调用）：把「这个端点到底收哪些 size / response_format / n」问出来，
// 输出一份端点画像 JSON，用来替代猜测。探针本身可离线自证：--mock 起本地桩，桩只认 1024x1024 + b64_json + n=1。
//
// 用法：
//   node adapters/image-probe.mjs --mock                                  # 桩上自证探针（零密钥、不出网）
//   node adapters/image-probe.mjs                                         # 读 IG5_IMAGE_*（缺省回落 IG5_RELAY_*）
//   node adapters/image-probe.mjs --base-url https://HOST/v1 --model MODEL_ID --out /tmp/ig5-probe
//   node adapters/image-probe.mjs --dry-run                               # 只列探针计划，不发请求
// 退出码：0 = 全部探针成功 · 1 = 有探针失败（画像仍会打印） · 2 = 端点未配置
import { createServer } from "node:http";
import { resolveImageRelay, generateImage, looksLikePng } from "./lib/image-api.mjs";

export const PROBE_SCHEMA = "ig5-image-probe/1";
const PROBE_PROMPT = "IG5 探针：一枚蓝色圆点，纯白背景";
const PNG_SIG_B64 = "iVBORw0KGgo="; // 12 字节，只够判签名，不是真图

export function buildCases() {
  return [
    { id: "P1", what: "最小出图（默认尺寸 · 单张 · 不带 response_format）", size: "1024x1024", n: 1, responseFormat: "" },
    { id: "P2", what: "显式 response_format=b64_json", size: "1024x1024", n: 1, responseFormat: "b64_json" },
    { id: "P3", what: "显式 response_format=url", size: "1024x1024", n: 1, responseFormat: "url" },
    { id: "P4", what: "小尺寸 256x256", size: "256x256", n: 1, responseFormat: "" },
    { id: "P5", what: "横版 1792x1024", size: "1792x1024", n: 1, responseFormat: "" },
    { id: "P6", what: "多张 n=2", size: "1024x1024", n: 2, responseFormat: "" },
  ];
}

export async function runProbe({ relay, cases = buildCases(), prompt = PROBE_PROMPT, fetchImpl = globalThis.fetch, dryRun = false, onAttempt = null } = {}) {
  const results = [];
  for (const c of cases) {
    const r = await generateImage({ relay, prompt, n: c.n, size: c.size, responseFormat: c.responseFormat, fetchImpl, dryRun, onAttempt });
    const first = (r.images && r.images[0]) || {};
    const b64 = first.b64_json || null;
    const bytes = b64 ? Buffer.from(b64, "base64").length : 0;
    results.push({
      id: c.id,
      what: c.what,
      request: { size: c.size, n: c.n, response_format: c.responseFormat || null },
      ok: !!r.ok,
      status: r.status ?? null,
      attempts: r.attempts ?? 0,
      returned: { count: (r.images && r.images.length) || 0, hasB64: !!b64, hasUrl: !!first.url, bytes, png: b64 ? looksLikePng(Buffer.from(b64, "base64")) : false },
      error: r.error ?? null,
    });
  }
  const supportedSizes = [];
  for (const r of results) if (r.ok && (r.id === "P1" || r.id === "P4" || r.id === "P5") && !supportedSizes.includes(r.request.size)) supportedSizes.push(r.request.size);
  const responseFormats = [];
  for (const r of results) if (r.ok && r.request.response_format && !responseFormats.includes(r.request.response_format)) responseFormats.push(r.request.response_format);
  const p6 = results.find((r) => r.id === "P6");
  const maxObservedN = p6 && p6.ok ? p6.returned.count : 1;
  return {
    schema: PROBE_SCHEMA,
    relay: { baseUrl: (relay && relay.baseUrl) || null, model: (relay && relay.model) || null, ready: !!(relay && relay.ready) },
    keyPresent: !!(relay && relay.apiKey),
    dryRun: !!dryRun,
    results,
    summary: {
      supportedSizes,
      responseFormats,
      multiImage: maxObservedN > 1,
      maxObservedN,
      failed: results.filter((r) => !r.ok).map((r) => r.id),
    },
  };
}

// ---------- 本地桩：一个「受限端点」的画像，用来自证探针的分辨力 ----------
export function createMockImageServer() {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const send = (code, payload) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { /* 保持空体 */ }
      if (!req.url.includes("/images/generations")) return send(404, { error: { code: "not_found", message: "unsupported path" } });
      if (body.size && body.size !== "1024x1024") return send(400, { error: { code: "invalid_size", message: "unsupported size" } });
      if (body.response_format === "url") return send(400, { error: { code: "invalid_response_format", message: "response_format=url is not supported" } });
      if ((body.n || 1) > 1) return send(400, { error: { code: "invalid_n", message: "n must be 1" } });
      const n = body.n || 1;
      const data = Array.from({ length: n }, () => ({ b64_json: PNG_SIG_B64 }));
      send(200, { created: Math.floor(Date.now() / 1000), model: body.model || "MOCK_IMAGE_MODEL", data });
    });
  });
  return {
    server,
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// ---------- CLI ----------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const argv = process.argv.slice(2);
  const argOf = (name, dflt) => {
    const hit = argv.find((a) => a.startsWith(name + "="));
    if (hit) return hit.slice(name.length + 1);
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
  };
  const useMock = argv.includes("--mock");
  const dryRun = argv.includes("--dry-run");

  let relay;
  let mock = null;
  if (useMock) {
    mock = createMockImageServer();
    const port = await mock.listen();
    relay = { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "sk-MOCK-PROBE-KEY", model: "MOCK_IMAGE_MODEL", timeoutMs: 30_000, ready: true };
  } else {
    relay = resolveImageRelay(process.env, { baseUrl: argOf("--base-url", undefined), model: argOf("--model", undefined) });
    if (!relay.ready && !dryRun) {
      console.log(JSON.stringify({ schema: PROBE_SCHEMA, ok: false, reason: "端点未配置 —— 只列出探针计划，未发任何请求", problems: relay.problems, planned: buildCases().map((c) => c.id) }, null, 2));
      process.exit(2);
    }
  }

  const report = await runProbe({ relay, dryRun });
  if (useMock) {
    const expect = ["P3", "P4", "P5", "P6"];
    report.selfCheck = {
      expect,
      failedMatches: JSON.stringify(report.summary.failed) === JSON.stringify(expect),
      sizesMatch: report.summary.supportedSizes.join(",") === "1024x1024",
      formatMatch: report.summary.responseFormats.join(",") === "b64_json",
      maxNMatch: report.summary.maxObservedN === 1,
    };
    report.ok = report.selfCheck.failedMatches && report.selfCheck.sizesMatch && report.selfCheck.formatMatch && report.selfCheck.maxNMatch;
  } else {
    report.ok = report.summary.failed.length === 0;
  }
  console.log(JSON.stringify(report, null, 2));
  if (mock) await mock.close();
  process.exit(report.ok || dryRun ? 0 : 1);
}
