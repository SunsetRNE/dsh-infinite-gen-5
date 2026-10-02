#!/usr/bin/env node
// verify_incident_archive.mjs —— 内部问题档案的「黑名单是否仍然生效」自检（v0.52.12）
//
// 这个档案**故意不入库**（`docs/incidents/` 在 .gitignore 里），所以：
//   · CI 上看不到它 → 本脚本在目录不存在时打印 SKIP 并以 0 退出（不算失败）；
//   · 本机必须通过 → 它检查三件事：目录被忽略 / 没有任何文件被 git 跟踪 / 黑名单文件里列着它。
//
// 用法：node scripts/verify_incident_archive.mjs
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "docs/incidents");
const LIST = join(DIR, "BLACKLIST.md");
const REL = "docs/incidents/";

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (error) {
    return `__ERR__${String(error?.message ?? error)}`;
  }
};

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};

if (!existsSync(DIR)) {
  console.log("SKIP: 本机没有 docs/incidents/（CI 或被忽略的副本上本就看不到）—— 本自检只在留档存在时跑。");
  process.exit(0);
}

const files = readdirSync(DIR).map((f) => relative(ROOT, join(DIR, f))).sort();
console.log(`内部留档：${files.length} 个文件 — ${files.join(", ")}\n`);

// ① 目录必须被 .gitignore 命中
const ignored = git(["check-ignore", "-v", join(DIR, "ISSUE-LEDGER.md")]);
check("docs/incidents/ 被 .gitignore 命中", ignored.includes(".gitignore") && ignored.includes(REL), ignored || "check-ignore 无输出");

// ② 不能有任何文件被 git 跟踪（被跟踪 = 已经推上去了）
const tracked = git(["ls-files", REL]);
check("没有任何留档文件被 git 跟踪", tracked === "", tracked || "");

// ③ 黑名单文件里必须列着这个目录（黑名单是给人看的，不是只在 .gitignore 里）
const blacklist = readFileSync(LIST, "utf8");
check("BLACKLIST.md 在场并列着 docs/incidents/", blacklist.includes(REL));
check("BLACKLIST.md 写明「不上传 GitHub」的口径", /不上传\s*GitHub/.test(blacklist));
check("黑名单覆盖了索引与路线两份主件", files.some((f) => f.endsWith("ISSUE-LEDGER.md")) && files.some((f) => f.endsWith("ROADMAP.md")));

// ④ git status 里不该出现它们（既不 untracked 也不 staged）
const status = git(["status", "--porcelain"]);
const leaked = status.split("\n").filter((l) => l.includes("incidents"));
check("git status 里看不到留档（未 untracked / 未 staged）", leaked.length === 0, leaked.join(" | "));

console.log(`\n内部留档黑名单自检：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
