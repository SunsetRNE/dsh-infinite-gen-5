#!/usr/bin/env node
// 无限五代 · 生图入口（在册工具）：把提示词按 OpenAI 兼容的 images/generations 发出去，取回图像落盘。
//
// 这是薄封装，不是第二份实现：真实实现留在公共层 —— adapters/lib/image-api.mjs（直连与重试）
// 与 adapters/image-runner.mjs（CLI 参数解析），本文件只负责转发命令行 + 提供自检开关。
// 这样生图能力的唯一真源仍在 adapters/，脚本面只是给它一个在册入口与可跑判据。
//
// 用法：
//   node scripts/image-gen.mjs --prompt "PROMPT" --out runs/img --size 1024x1024 [--n 1] [--model M]
//   node scripts/image-gen.mjs --prompt-file /tmp/PROMPT.txt --out runs/img
//   node scripts/image-gen.mjs --prompt "PROMPT" --dry-run    # 只打印请求模板，不建连接
//   node scripts/image-gen.mjs --selftest                     # 判据：跑公共层生图自检（本地桩，零密钥不出网）
//
// 环境变量：IG5_IMAGE_BASE_URL / IG5_IMAGE_API_KEY / IG5_IMAGE_MODEL
//           （缺 base 时回落 IG5_RELAY_BASE_URL / IG5_RELAY_API_KEY —— 同一端点常同时提供 chat 与 images）
// 退出码：0 成功 · 2 端点未配置（只产出请求模板，不宣称取得回执） · 1 失败
// 密钥只从环境变量读，stdout 的 JSON 里永远不出现密钥。

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RUNNER = join(ROOT, "adapters", "image-runner.mjs");
const SELFTEST = join(ROOT, "adapters", "test-image-embed.mjs");

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);

// 自检：转跑公共层的 E1–E7 判据（回落 / 请求形状 / 鉴权不泄密 / 回执解析 / 落盘 PNG / 4xx 不重试 / 5xx 重试到上限）
if (has("selftest")) {
  if (!existsSync(SELFTEST)) {
    console.log(JSON.stringify({ ok: false, error: `找不到判据件：${SELFTEST} —— 生图自检依赖 adapters/` }, null, 2));
    process.exit(1);
  }
  const r = spawnSync(process.execPath, [SELFTEST], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

if (!argv.length) {
  console.log(JSON.stringify({ ok: false, error: "缺少参数 —— 至少给 --prompt；看请求模板加 --dry-run，跑判据用 --selftest" }, null, 2));
  process.exit(1);
}

if (!existsSync(RUNNER)) {
  console.log(JSON.stringify({ ok: false, error: `找不到生图实现：${RUNNER} —— 本封装依赖 adapters/image-runner.mjs` }, null, 2));
  process.exit(1);
}

const r = spawnSync(process.execPath, [RUNNER, ...argv], { stdio: "inherit" });
process.exit(r.status ?? 1);
