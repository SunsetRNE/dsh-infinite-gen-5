#!/usr/bin/env node
// ci-mock.mjs — GITHUB-CI 协议的离线 mock：让 logs 全文路径（落盘/哈希/门限）可被确定性地验。
// 起法：node scripts/fixtures/ci-mock.mjs [port]  → 打印 "MOCK_READY <port>"
import { createServer } from "node:http";

const port = Number(process.argv[2] || 8799);
const LINES = 200;
const body = Array.from({ length: LINES }, (_, i) =>
  i === LINES - 3 ? "##[error] step failed: 全量自检（不带病发布）" : `line ${i + 1}: noise`).join("\n");

const server = createServer((req, res) => {
  const url = req.url || "";
  if (url.includes('/actions/runs') && !url.includes('/jobs')) {   // jobs 列表也含 /actions/runs，必须排除
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ workflow_runs: [{
      id: 424242, head_branch: "main", head_sha: "abcdef1234567890", status: "completed",
      conclusion: "failure", html_url: "http://127.0.0.1/mock/424242", updated_at: "2026-10-01T09:00:00Z" }] }));
  }
  if (url.includes("/jobs/") && url.endsWith("/logs")) {
    res.setHeader("content-type", "text/plain");
    return res.end(body);
  }
  if (url.includes("/jobs")) {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ jobs: [{ id: 777, name: "package", conclusion: "failure",
      steps: [{ name: "全量自检（不带病发布）", conclusion: "failure" }, { name: "打包", conclusion: "skipped" }] }] }));
  }
  res.statusCode = 404; res.end("{}");
});
server.listen(port, "127.0.0.1", () => console.log("MOCK_READY " + port));
