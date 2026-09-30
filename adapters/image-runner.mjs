#!/usr/bin/env node
// 无限五代 · 生图 CLI（单发 / 批量入口）
//
// 用法：
//   node image-runner.mjs --prompt "PROMPT" --out runs/img --size 1024x1024 [--model M] [--n 1] [--json]
//   node image-runner.mjs --prompt-file /tmp/PROMPT.txt --out runs/img
//   node image-runner.mjs --prompt "PROMPT" --dry-run        # 只打印请求模板，不建连接
//
// 环境变量：IG5_IMAGE_BASE_URL / IG5_IMAGE_API_KEY / IG5_IMAGE_MODEL
//           （缺 base 时回落 IG5_RELAY_BASE_URL / IG5_RELAY_API_KEY，同一端点常同时提供 chat 与 images）
//
// 退出码：0 成功 · 2 端点未配置（只产出模板，不宣称取得回执） · 1 失败
// 密钥只从环境变量读；stdout 的 JSON 里永远不出现密钥。

import { readFile } from "node:fs/promises";
import { generateImage, resolveImageRelay, saveImages } from "./lib/image-api.mjs";

const argv = process.argv.slice(2);
const argOf = (name, fallback = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const dryRun = has("dry-run");
const outDir = argOf("out", "runs/img");
const size = argOf("size", "1024x1024");
const n = Number(argOf("n", "1"));
const relay = resolveImageRelay(process.env, {
  model: argOf("model", "") || undefined,
  baseUrl: argOf("base-url", "") || undefined,
});

let prompt = argOf("prompt", "");
if (!prompt) {
  const file = argOf("prompt-file", "");
  if (file) prompt = (await readFile(file, "utf8")).trim();
}

if (!prompt) {
  console.log(JSON.stringify({ ok: false, error: "缺少 --prompt 或 --prompt-file" }, null, 2));
  process.exit(1);
}

if (dryRun) {
  const draft = await generateImage({ relay, prompt, n, size, dryRun: true });
  console.log(JSON.stringify({ dryRun: true, url: `${relay.baseUrl || "https://HOST/v1"}/images/generations`, body: draft.draft, relayReady: relay.ready, problems: relay.problems }, null, 2));
  process.exit(0);
}

if (!relay.ready) {
  const draft = await generateImage({ relay, prompt, n, size, dryRun: true });
  console.log(JSON.stringify({ ok: false, skipped: true, reason: "端点未配置 —— 只产出请求模板，未取得回执", problems: relay.problems, url: "https://HOST/v1/images/generations", body: draft.draft }, null, 2));
  process.exit(2);
}

const result = await generateImage({ relay, prompt, n, size });
if (!result.ok) {
  console.log(JSON.stringify({ ok: false, status: result.status, attempts: result.attempts, error: result.error }, null, 2));
  process.exit(1);
}
const saved = await saveImages(result.images, outDir);
console.log(JSON.stringify({ ok: true, status: result.status, attempts: result.attempts, model: result.model, usage: result.usage, dir: outDir, files: saved.files }, null, 2));
