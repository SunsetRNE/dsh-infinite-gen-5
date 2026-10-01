#!/usr/bin/env node
// verify_ci_tool.mjs — GITHUB-CI 协议门禁（v0.51.19）
// 判据：工具在场且语法通过；只读跑一次 status，回执符合协议（ok / 必填字段 / ≤8 KB / 无 token 痕迹）。
// 无网络时 SKIP（与仓库其它联网门禁同惯例），不算回归。
import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";

const REPO = "SunsetRNE/dsh-infinite-gen-5";
const FILES = ["scripts/ig5-ci.mjs"];
let pass = 0, fail = 0, skip = 0;
const ok = (m) => { pass += 1; console.log("  ✅ " + m); };
const bad = (m) => { fail += 1; console.log("  ❌ " + m); };
const sk = (m) => { skip += 1; console.log("  -（跳过）" + m); };

for (const f of FILES) {
  try { readFileSync(f, "utf8"); ok("工具在场 " + f); } catch { bad("缺工具 " + f); }
}
try { execFileSync("node", ["--check", "scripts/ig5-ci.mjs"], { stdio: "pipe" }); ok("工具语法通过"); }
catch { bad("工具语法错误"); }

let out = "";
try {
  out = execFileSync("node", ["scripts/ig5-ci.mjs", "status", "--repo", REPO, "--json"],
    { stdio: "pipe", timeout: 30000 }).toString();
} catch (e) {
  out = String(e.stdout || "");
}
if (!out.trim()) { sk("无网络或工具未返回 —— 跳过协议判据"); }
else {
  let doc = null;
  try { doc = JSON.parse(out); } catch { bad("回执不是合法 JSON"); }
  if (doc) {
    ok("回执可解析") ;
    const bytes = Buffer.byteLength(out);
    bytes <= 8192 ? ok(`回执在 8 KB 门限内（${bytes} B）`) : bad(`回执超门限（${bytes} B）`);
    doc.ok === true ? ok("ok=true") : bad("ok 不是 true：" + JSON.stringify(doc).slice(0, 120));
    doc.repo === REPO ? ok("repo 回填正确") : bad("repo 字段不对");
    doc.run && doc.run.id ? ok("带回 run 摘要") : bad("缺 run 摘要");
    ("failedSteps" in doc) ? ok("带回 failedSteps 字段（成功时为 0 条）") : bad("缺 failedSteps");
    /ghp_|github_pat_/.test(out) ? bad("回执里出现 token 明文痕迹") : ok("回执无 token 痕迹");
  }
}
// ── v0.51.21：静默失败回归锁（早期 return 的回执必须被打印出来）─────────────
{
  const SOURCE = readFileSync("scripts/ig5-ci.mjs", "utf8");
  /function fail\(reason, extra = \{\}\) \{[\s\S]{0,500}console\.log\(JSON\.stringify\(receipt/.test(SOURCE)
    ? ok("fail() 自己出回执（不再静默 return）")
    : bad("fail() 仍是静默 return");
  let out = "";
  try {
    out = execFileSync("node", ["scripts/ig5-ci.mjs", "status", "--repo", REPO],
      { stdio: "pipe", timeout: 30000, env: { ...process.env, IG5_GH_TOKEN: "github_pat_INVALID_FOR_TEST", IG5_HOME: "/tmp/ig5-no-such-home" } }).toString();
  } catch (e) { out = String(e.stdout || ""); }
  if (!out.trim()) bad("无效凭据下零输出（静默失败的形状）");
  else {
    let doc = null;
    try { doc = JSON.parse(out); } catch { doc = null; }
    doc && doc.ok === false ? ok("无效凭据 → 有回执且 ok=false（错误可见）") : bad("无效凭据的回执形状不对");
    /github_pat_INVALID_FOR_TEST/.test(out) ? bad("回执里回显了凭据！") : ok("回执不回显凭据");
  }
}

// ── v0.51.23：离线全文路径（用自建 mock，不依赖网络与凭据）──────────────
{
  const PORT = 8813;
  const mock = spawn("node", ["scripts/fixtures/ci-mock.mjs", String(PORT)], { stdio: "ignore" });
  try {
    execFileSync("node", ["-e", `setTimeout(()=>{},700)`], { stdio: "ignore" });
    const out2 = execFileSync("node", ["scripts/ig5-ci.mjs", "logs", "--repo", "MOCK/REPO", "--run", "latest", "--inject", "tail", "--tail", "4"],
      { stdio: "pipe", timeout: 30000, env: { ...process.env, IG5_CI_API: `http://127.0.0.1:${PORT}`, IG5_GH_TOKEN: "x", IG5_HOME: "/tmp/ig5-no-such-home" } }).toString();
    const d = JSON.parse(out2);
    d.ok === true ? ok("mock：logs 走通（ok=true）") : bad("mock：logs 未走通");
    (d.failedSteps || []).length > 0 ? ok("mock：定位到失败步骤") : bad("mock：没定位到失败步骤");
    d.fullLog && existsSync(d.fullLog) ? ok("mock：全文已落盘 " + d.fullLog) : bad("mock：全文没落盘");
    if (d.fullLog && existsSync(d.fullLog)) {
      createHash("sha256").update(readFileSync(d.fullLog)).digest("hex") === d.fullLogSha256
        ? ok("mock：落盘哈希与回执一致") : bad("mock：落盘哈希不一致");
      statSync(d.fullLog).size === d.fullLogBytes ? ok("mock：字节数一致") : bad("mock：字节数不一致");
    }
    (d.tail || []).length > 0 ? ok("mock：--inject tail 带回尾部行") : bad("mock：tail 为空");
    Buffer.byteLength(out2) <= 8192 ? ok("mock：回执仍在 8 KB 内") : bad("mock：回执超门限");
  } catch (e) {
    bad("mock 离线判据异常：" + String((e && e.message) || e).slice(0, 60));
  } finally {
    try { mock.kill(); } catch { /* 已退出 */ }
  }
}

console.log(`\nGITHUB-CI 协议门禁：${pass} 通过 / ${fail} 失败 / ${skip} 跳过`);
process.exit(fail === 0 ? 0 : 1);
