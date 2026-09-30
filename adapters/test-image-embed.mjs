#!/usr/bin/env node
// 无限五代 · 生图通道自测（零密钥、不出网：本地桩）
//
// 判据 E1–E7。桩实现 OpenAI 兼容的最小面：POST {base}/images/generations → {data:[{b64_json}]}。
// 通过条件：全部 ✓。退出码 0 = 通过。

import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateImage, resolveImageRelay, saveImages, looksLikePng, IMAGE_SCHEMA } from "./lib/image-api.mjs";

const MOCK_KEY = "sk-MOCK-IMAGE-KEY-000000000000";
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const PNG_SIG_B64 = PNG_BYTES.toString("base64");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass += 1; console.log(`✓ ${name}${extra ? ` · ${extra}` : ""}`); }
  else { fail += 1; console.log(`✗ ${name}${extra ? ` · ${extra}` : ""}`); }
};

const seen = [];
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    seen.push({ url: req.url, auth: req.headers.authorization ?? "", raw });
    let prompt = "";
    try { prompt = JSON.parse(raw).prompt ?? ""; } catch { prompt = ""; }
    const send = (code, payload) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
    if (String(prompt).includes("FLAKY_422")) return send(422, { error: { message: `bad parameter · key=${MOCK_KEY}` } });
    if (String(prompt).includes("FLAKY_500")) return send(500, { error: { message: "upstream unavailable" } });
    return send(200, { created: 1, model: "MOCK_IMAGE_MODEL", data: [{ b64_json: PNG_SIG_B64, url: null, revised_prompt: null }] });
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

try {
  const relay = resolveImageRelay({ IG5_RELAY_BASE_URL: BASE, IG5_RELAY_API_KEY: MOCK_KEY });
  const bare = resolveImageRelay({});
  ok("E1 生图端点解析与回落", relay.ready === true && bare.ready === false && bare.problems.length === 2,
    `schema=${IMAGE_SCHEMA} · 回落自 IG5_RELAY_BASE_URL · 缺项 ${bare.problems.length} 条`);

  const r = await generateImage({ relay, prompt: "IG5_IMAGE_PROBE", n: 1, size: "1024x1024" });
  const hit = seen[seen.length - 1] ?? { url: "", auth: "", raw: "{}" };
  const body = (() => { try { return JSON.parse(hit.raw); } catch { return {}; } })();
  ok("E2 请求形状", r.ok === true && hit.url.endsWith("/images/generations") && body.model && body.prompt === "IG5_IMAGE_PROBE" && body.n === 1 && body.size === "1024x1024",
    `url=${hit.url} model=${body.model}`);
  ok("E3 鉴权与密钥不入包", hit.auth === `Bearer ${MOCK_KEY}` && !hit.raw.includes(MOCK_KEY),
    `authorization=Bearer MOCK_… · 请求体含密钥=false`);
  ok("E4 回执解析", r.images.length === 1 && r.images[0].b64_json === PNG_SIG_B64,
    `status=${r.status} attempts=${r.attempts}`);

  const outDir = join(tmpdir(), `ig5-img-${process.pid}`);
  const saved = await saveImages(r.images, outDir);
  const buf = await readFile(saved.files[0].path);
  ok("E5 落盘为真图片字节", saved.files.length === 1 && looksLikePng(buf),
    `bytes=${buf.length} png签名=${looksLikePng(buf)}`);
  await rm(outDir, { recursive: true, force: true });

  const before4xx = seen.length;
  const r422 = await generateImage({ relay, prompt: "FLAKY_422" });
  ok("E6 4xx 不重试且脱敏", r422.ok === false && r422.attempts === 1 && seen.length - before4xx === 1 && !String(r422.error).includes(MOCK_KEY),
    `status=${r422.status} attempts=${r422.attempts} 泄漏密钥=${String(r422.error).includes(MOCK_KEY)}`);

  const before5xx = seen.length;
  const r500 = await generateImage({ relay, prompt: "FLAKY_500" });
  ok("E7 5xx 重试到上限", r500.ok === false && r500.attempts === 3 && seen.length - before5xx === 3,
    `status=${r500.status} attempts=${r500.attempts}`);
} catch (err) {
  fail += 1;
  console.log(`✗ 未捕获异常 · ${err?.message ?? String(err)}`);
} finally {
  server.close();
}

console.log(`\n${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
