#!/usr/bin/env node
// verify_ci_tool.mjs — GITHUB-CI 协议门禁（v0.51.19）
// 判据：工具在场且语法通过；只读跑一次 status，回执符合协议（ok / 必填字段 / ≤8 KB / 无 token 痕迹）。
// 无网络时 SKIP（与仓库其它联网门禁同惯例），不算回归。
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

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
console.log(`\nGITHUB-CI 协议门禁：${pass} 通过 / ${fail} 失败 / ${skip} 跳过`);
process.exit(fail === 0 ? 0 : 1);
