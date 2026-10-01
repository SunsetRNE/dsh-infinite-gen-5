#!/usr/bin/env node
// ig5-ci.mjs — 只读 CI 工具（v0.51.19，GITHUB-CI 协议首个实现）
//
// 目标：一个工具顶掉「curl + python 解析 + 把 45 KB 日志塞进上下文」这套重复动作。
// 规则（协议 GITHUB-CI）：默认只回摘要（≤8 KB）；全文落盘并回 sha256；失败优先；
// 401/403 直接报「凭据失效或权限不足」并给配置入口，不重试。
//
// 用法:
//   node scripts/ig5-ci.mjs status --repo OWNER/NAME [--json]
//   node scripts/ig5-ci.mjs logs   --repo OWNER/NAME [--run latest-failed|ID] [--tail 20] [--json]
//   node scripts/ig5-ci.mjs watch  --repo OWNER/NAME [--timeout 300]
//
// 凭据：环境变量 GITHUB_TOKEN 或 IG5_GH_TOKEN（本轮**不落盘**；落盘设计见 SECRETS 协议）。
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";

const API = "https://api.github.com";
const SUMMARY_LIMIT = 8192;      // 协议硬门限：回执超过它就只回摘要
const FALLBACK_DIR = "/tmp/ig5-ci";

function arg(name, def = null) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const asJson = process.argv.includes("--json");
const action = (process.argv[2] || "status").replace(/^--/, "");
const repo = arg("repo");
// SECRETS 协议：凭据只落 ~/.dsh 直下（插件目录之外 → 更新不丢）；此处只读、绝不回显。
function tokenFromSecretFile() {
  const home = process.env.IG5_HOME || process.env.DSH_HOME || `${process.env.HOME || "/root"}/.dsh`;
  try {
    const parsed = JSON.parse(readFileSync(`${home}/infinite-gen-5-github.json`, "utf8"));
    return typeof parsed?.token === "string" ? parsed.token : "";
  } catch { return ""; }        // 没配过 / 坏了都当「无凭据」，走降级路径
}
const token = process.env.GITHUB_TOKEN || process.env.IG5_GH_TOKEN || tokenFromSecretFile();

const headers = { accept: "application/vnd.github+json", "user-agent": "ig5-ci/1" };
if (token) headers.authorization = "Bearer " + token;

async function gh(path) {
  const res = await fetch(API + path, { headers });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 200) }; }
  return { status: res.status, body };
}

function fail(reason, extra = {}) {
  const receipt = { ok: false, error: reason, hint: "在设置台「远端凭据」配置 token（SECRETS 协议），或导出 GITHUB_TOKEN", ...extra };
  // v0.51.21 修（真凶）：早期 return 的回执从来没被打印 —— 于是「凭据无效 / 仓库不存在 / API 报错」
  // 这三种情况下工具零输出、退出码还是 0，看起来就像什么都没发生。现在统一在这里出回执。
  console.log(JSON.stringify(receipt, null, asJson ? 2 : 0));
  process.exitCode = 1;
  return receipt;
}

function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

function trimTail(lines, n) { return lines.slice(Math.max(0, lines.length - n)); }

async function main() {
  if (!repo) return fail("缺 --repo OWNER/NAME");
  const runs = await gh(`/repos/${repo}/actions/runs?per_page=10`);
  if (runs.status === 401 || runs.status === 403) return fail(`GitHub 拒绝（${runs.status}）`);
  if (runs.status !== 200) return fail(`取 runs 失败（${runs.status}）`, { body: runs.body });
  const list = runs.body?.workflow_runs ?? [];
  if (list.length === 0) return { ok: true, repo, runs: 0, note: "该仓库没有工作流运行记录" };

  const failed = list.find((r) => r.conclusion === "failure");
  const wanted = arg("run", "latest-failed");
  const picked = wanted === "latest" ? list[0]
    : wanted === "latest-failed" ? (failed || list[0])
      : (list.find((r) => String(r.id) === String(wanted)) || list[0]);

  const jobs = await gh(`/repos/${repo}/actions/runs/${picked.id}/jobs?per_page=20`);
  const jobList = jobs.body?.jobs ?? [];
  const failedJobs = jobList.filter((j) => j.conclusion === "failure");
  const steps = [];
  for (const j of (failedJobs.length ? failedJobs : jobList)) {
    for (const s of (j.steps ?? [])) {
      if (failedJobs.length === 0 || s.conclusion === "failure") {
        steps.push({ job: j.name, step: s.name, conclusion: s.conclusion });
      }
    }
  }

  const out = {
    ok: true,
    repo,
    run: { id: picked.id, branch: picked.head_branch, sha: String(picked.head_sha || "").slice(0, 8),
      status: picked.status, conclusion: picked.conclusion, url: picked.html_url, at: picked.updated_at },
    failedSteps: steps.filter((s) => s.conclusion === "failure").slice(0, 12),
    stepsChecked: steps.length,
    injected: "summary",
  };

  if (action === "logs" || action === "watch") {
    // 全文日志接口需要凭据；没有凭据时明确降级，而不是假装拿到
    const jobId = (failedJobs[0] || jobList[0])?.id;
    if (!jobId) { out.note = "该 run 没有 job 记录"; }
    else if (!token) { out.note = "无凭据：GitHub 的 job 日志接口需要 token，当前只回步骤级摘要（配置后可取全文）"; }
    else {
      const res = await fetch(`${API}/repos/${repo}/actions/jobs/${jobId}/logs`, {
        headers: { ...headers, accept: "application/vnd.github+json" }, redirect: "follow",
      });
      if (res.status === 401 || res.status === 403) return fail(`取日志被拒（${res.status}：权限不足或 token 失效）`);
      if (res.status >= 300 && res.status < 400) { out.note = `日志接口给了重定向（${res.status}），本工具不跟随第三方大体积下载`; }
      if (res.status === 200) {
        const buf = Buffer.from(await res.arrayBuffer());
        mkdirSync(FALLBACK_DIR, { recursive: true });
        const file = `${FALLBACK_DIR}/${picked.id}.log`;
        writeFileSync(file, buf);
        const lines = buf.toString("utf8").split("\n");
        out.fullLog = file;
        out.fullLogBytes = statSync(file).size;
        out.fullLogSha256 = sha256(readFileSync(file));
        out.failedLines = lines.filter((l) => /error|failed|✗|##\[error\]/i.test(l)).length;
        out.tail = trimTail(lines.filter((l) => l.trim() !== ""), Number(arg("tail", "20")));
        out.injected = arg("inject", "summary") === "tail" ? "tail" : "summary";
        if (out.injected === "summary") delete out.tail;
      } else {
        out.note = `日志接口返回 ${res.status}（可能是运行中或已过期）`;
      }
    }
  }

  let text = JSON.stringify(out, null, asJson ? 2 : 0);
  if (text.length > SUMMARY_LIMIT) {
    const slim = { ...out, injected: "summary", note: "回执超 8 KB，已按协议只回摘要（细节走 fullLog 路径 read）" };
    delete slim.tail;
    text = JSON.stringify(slim, null, asJson ? 2 : 0);
    out.overBudget = true;
  }
  console.log(text);
}

process.on("unhandledRejection", (err) => {
  console.log(JSON.stringify(fail("未预期异常：" + String((err && err.message) || err))));
  process.exitCode = 1;
});
main().catch((err) => { console.log(JSON.stringify(fail(String(err && err.message || err)))); process.exitCode = 1; });
