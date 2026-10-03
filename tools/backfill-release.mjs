#!/usr/bin/env node
// backfill-release.mjs —— 一键补发：tag 已推但 Release 缺失/不齐时，手工派一次 release workflow 并等到出结果。
//
// 由来：v0.65.0 的 tag 触发了 release workflow，但因为当时的自检过严而红，Release 没被创建；
// 手工补发要「取 workflow id → POST dispatches → 轮询 run → 核资产」四步 —— 这里收成一条命令。
//
//   node tools/backfill-release.mjs --tag=v0.65.0                  # 缺失才补，齐了就直接报「无需补发」
//   node tools/backfill-release.mjs --tag=v0.65.0 --skip-selfcheck # 历史 tag：跳该 tag 树的「全量自检」
//   node tools/backfill-release.mjs --tag=v0.65.0 --dry-run        # 只看会做什么，不发任何请求
//   node tools/backfill-release.mjs --tag=v0.65.0 --force          # 已有 Release 也再派一次（谨慎）
//
// 令牌：只读 GH_TOKEN；未设时回落到 /root/.dsh/infinite-gen-5-github.json 的 token 字段。**任何情况下不回显令牌**。
//
// 退出码：0 成功或无需补发 · 1 补发失败/资产不齐 · 2 用法或鉴权问题

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v === undefined ? true : v];
}));

const tag = typeof argv.tag === "string" ? argv.tag : "";
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error("用法：node tools/backfill-release.mjs --tag=vX.Y.Z [--skip-selfcheck] [--dry-run] [--force]");
  process.exit(2);
}
const DRY = argv["dry-run"] === true;
const FORCE = argv.force === true;
const SKIP_SELFCHECK = argv["skip-selfcheck"] === true;
const EXPECTED_ASSETS = 4;

const token = process.env.GH_TOKEN || (() => {
  const p = "/root/.dsh/infinite-gen-5-github.json";
  try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).token : ""; } catch { return ""; }
})();
if (!token) { console.error("没有可用令牌：设 GH_TOKEN，或提供 /root/.dsh/infinite-gen-5-github.json"); process.exit(2); }

const repo = (() => {
  if (typeof argv.repo === "string") return argv.repo;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" }).trim();
    const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)(\.git)?$/);
    if (m) return m[1];
  } catch { /* 落回默认 */ }
  return "SunsetRNE/dsh-infinite-gen-5";
})();

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "ig5-backfill-release",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body };
};

const log = (...a) => console.log(...a);

// ① 这个 tag 上现在的 Release 是什么状态
const rel = await api(`/repos/${repo}/releases/tags/${tag}`);
const assets = rel.status === 200 && Array.isArray(rel.body.assets) ? rel.body.assets : [];
log(`仓库：${repo}`);
log(`tag ：${tag}`);
log(`Release：${rel.status === 200 ? `已存在，资产 ${assets.length} 个（${assets.map((a) => a.name).join(", ") || "无"}）` : `不存在（HTTP ${rel.status}）`}`);

if (rel.status === 200 && assets.length >= EXPECTED_ASSETS && !FORCE) {
  log("结论：资产已齐（≥4），无需补发。想强制重派用 --force。");
  process.exit(0);
}

// ② 找 release workflow
const wfs = await api(`/repos/${repo}/actions/workflows`);
if (wfs.status !== 200) { console.error(`取 workflow 列表失败：HTTP ${wfs.status}`); process.exit(1); }
const wf = (wfs.body.workflows || []).find((w) => w.name === "release");
if (!wf) { console.error("没找到名为 release 的 workflow"); process.exit(1); }
log(`workflow：${wf.name} id=${wf.id}`);

const payload = { ref: "main", inputs: { tag, skip_selfcheck: SKIP_SELFCHECK } };
if (DRY) {
  log(`[dry-run] 将 POST /repos/${repo}/actions/workflows/${wf.id}/dispatches`);
  log(`[dry-run] body ${JSON.stringify(payload)}`);
  log("[dry-run] 未发出任何请求。");
  process.exit(0);
}

// ③ 派发
const since = new Date(Date.now() - 5000).toISOString();
const disp = await api(`/repos/${repo}/actions/workflows/${wf.id}/dispatches`, { method: "POST", body: JSON.stringify(payload) });
log(`派发：HTTP ${disp.status}${disp.status === 204 ? "（已受理）" : " · " + JSON.stringify(disp.body)}`);
if (disp.status !== 204) process.exit(1);

// ④ 轮询这次派发产生的 run
const pickRun = async () => {
  const { status, body } = await api(`/repos/${repo}/actions/runs?event=workflow_dispatch&per_page=10`);
  if (status !== 200) return null;
  return (body.workflow_runs || []).find((r) => r.created_at >= since && r.name === "release") || null;
};

let run = null;
for (let i = 0; i < 60; i++) {           // 最多 ~5 分钟
  await new Promise((r) => setTimeout(r, 5000));
  run = await pickRun();
  if (run && run.status === "completed") break;
  if (i % 6 === 5) log(`  等待中…（${(i + 1) * 5}s）`);
}
if (!run) { console.error("没找到刚派发的 run（去 Actions 页面确认）"); process.exit(1); }
log(`run ${run.id}：${run.status}${run.conclusion ? " / " + run.conclusion : ""} · ${run.html_url}`);

// ⑤ 核资产
const after = await api(`/repos/${repo}/releases/tags/${tag}`);
const got = after.status === 200 && Array.isArray(after.body.assets) ? after.body.assets : [];
const ok = run.conclusion === "success" && got.length >= EXPECTED_ASSETS;
log(`补发后 Release：${after.status === 200 ? `资产 ${got.length} 个（${got.map((a) => a.name).join(", ") || "无"}）` : `仍不存在（HTTP ${after.status}）`}`);
if (after.status === 200) log(`正文含补发标注：${/补发|dispatch/i.test(after.body.body || "")}`);
log(ok ? "结论：补发成功（资产齐、run success）。" : `结论：未达标（run=${run.conclusion} · 资产 ${got.length}/${EXPECTED_ASSETS}）。`);
process.exit(ok ? 0 : 1);
