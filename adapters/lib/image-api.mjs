// 无限五代 · 生图直连层（image generation relay）
//
// 这一层只做一件事：把一条最终提示词按 OpenAI 兼容的 /images/generations 形态发到目标端点，
// 把回执（b64_json / url）取回来并按需落盘。它不认识内核，也不认识题库 —— 纯传输。
//
// 三条硬约束（与 provider-api.mjs 同源）：
//   1) 密钥只从环境变量读，返回值 / 日志 / 错误信息里永远不出现（redact() 兜底）。
//   2) 重试只对「可能自己好」的失败：429 / 5xx / 网络层。4xx（除 429）直接返回 —— 重试不会让参数错自己变对。
//   3) dryRun 不建连接；模拟回执带 _dryRun:true，调用方不得当成真实回执。
//
// 端点形态依据：OpenAI 兼容 images 端点的公开文档形态（model / prompt / n / size，
// 回执 data[].b64_json | data[].url）。具体模型支持哪些 size、是否接受 response_format，
// 本文件不做猜测：默认值只是可被覆盖的起点，真实可用集在目标端点上核。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RETRY, redact } from "./provider-api.mjs";

export const IMAGE_SCHEMA = "ig5-image/1";
export const DEFAULT_IMAGE_SIZE = "1024x1024";

/** 从环境变量解析生图端点。缺 base 时回落到 IG5_RELAY_BASE_URL（同一端点常同时提供 chat 与 images）。 */
export function resolveImageRelay(env = process.env, overrides = {}) {
  const baseUrl = overrides.baseUrl ?? env.IG5_IMAGE_BASE_URL ?? env.IG5_RELAY_BASE_URL ?? "";
  const apiKey = overrides.apiKey ?? env.IG5_IMAGE_API_KEY ?? env.IG5_RELAY_API_KEY ?? "";
  const model = overrides.model ?? env.IG5_IMAGE_MODEL ?? "TARGET_IMAGE_MODEL";
  const problems = [];
  if (!baseUrl) problems.push("缺少 IG5_IMAGE_BASE_URL（或 IG5_RELAY_BASE_URL）");
  else if (!/^https?:\/\//.test(baseUrl)) problems.push("base 必须是 http(s) 绝对地址");
  if (!apiKey) problems.push("缺少 IG5_IMAGE_API_KEY（或 IG5_RELAY_API_KEY）");
  return Object.freeze({
    schema: IMAGE_SCHEMA,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model,
    timeoutMs: Number(overrides.timeoutMs ?? env.IG5_IMAGE_TIMEOUT_MS ?? 120_000),
    problems,
    ready: problems.length === 0,
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 发一次生图请求。永不抛异常 —— 失败也返回 {ok:false, ...}，调用方按 ok 分流。
 * 返回：{ ok, status, attempts, model, images:[{b64_json?|url?, revised_prompt?}], usage, error? }
 */
export async function generateImage({
  relay,
  prompt,
  n = 1,
  size = DEFAULT_IMAGE_SIZE,
  responseFormat = "",
  fetchImpl = globalThis.fetch,
  dryRun = false,
  signal = null,
  onAttempt = null,
} = {}) {
  const body = { model: relay?.model ?? "TARGET_IMAGE_MODEL", prompt: String(prompt ?? ""), n, size };
  if (responseFormat) body.response_format = responseFormat;

  if (dryRun) {
    return { ok: true, skipped: true, _dryRun: true, status: 0, attempts: 0, model: body.model, images: [], usage: null, draft: body };
  }
  if (!relay?.ready) {
    return { ok: false, status: 0, attempts: 0, images: [], error: `端点未就绪：${(relay?.problems ?? ["relay 未提供"]).join("；")}` };
  }
  if (!prompt) {
    return { ok: false, status: 0, attempts: 0, images: [], error: "prompt 为空" };
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, status: 0, attempts: 0, images: [], error: "运行时没有 fetch（需要 Node 18+ 或显式注入 fetchImpl）" };
  }

  const url = `${relay.baseUrl}/images/generations`;
  let last = null;

  for (let attempt = 1; attempt <= RETRY.attempts; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error("timeout")), Number(relay.timeoutMs ?? 120_000));
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
        last = { ok: false, status: res.status, attempts: attempt, images: [], error: redact(raw.slice(0, 400), relay.apiKey) };
        if (!RETRY.retryableStatus(res.status)) return last;
        const retryAfter = Number(res.headers?.get?.("retry-after") ?? 0);
        const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(RETRY.maxDelayMs, RETRY.baseDelayMs * 2 ** (attempt - 1));
        if (attempt < RETRY.attempts) await sleep(delay);
        continue;
      }
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      const images = Array.isArray(parsed?.data)
        ? parsed.data.map((d) => ({ b64_json: d?.b64_json ?? null, url: d?.url ?? null, revised_prompt: d?.revised_prompt ?? null }))
        : [];
      return {
        ok: images.length > 0,
        status: res.status,
        attempts: attempt,
        model: parsed?.model ?? relay.model,
        images,
        usage: parsed?.usage ?? null,
        error: images.length > 0 ? undefined : "回执里没有 data[]（形状不符）",
      };
    } catch (err) {
      last = { ok: false, status: 0, attempts: attempt, images: [], error: redact(err?.message ?? String(err), relay.apiKey) };
      if (attempt < RETRY.attempts) await sleep(Math.min(RETRY.maxDelayMs, RETRY.baseDelayMs * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abort);
    }
  }
  return last ?? { ok: false, status: 0, attempts: RETRY.attempts, images: [], error: "未知失败" };
}

/**
 * 把回执落盘。b64_json 写字节；只有 url 的条目不改写、只登记（下载是另一个决定，不在这一层做）。
 * 返回 { files:[{kind:"b64"|"url", path|null, url|null, bytes}], skipped }
 */
export async function saveImages(images, outDir, { prefix = "ig5-img", ext = "png" } = {}) {
  await mkdir(outDir, { recursive: true });
  const files = [];
  let i = 0;
  for (const img of images ?? []) {
    i += 1;
    if (img?.b64_json) {
      const buf = Buffer.from(String(img.b64_json), "base64");
      const path = join(outDir, `${prefix}-${String(i).padStart(2, "0")}.${ext}`);
      await writeFile(path, buf);
      files.push({ kind: "b64", path, url: null, bytes: buf.length });
    } else {
      files.push({ kind: "url", path: null, url: img?.url ?? null, bytes: 0 });
    }
  }
  return { files, skipped: (images?.length ?? 0) - files.length };
}

/** PNG 签名（89 50 4E 47）—— 落盘后用它是「真图片字节」的最小判据。 */
export function looksLikePng(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}
