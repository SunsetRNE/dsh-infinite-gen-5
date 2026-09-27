#!/usr/bin/env node
/**
 * 无限五代 · 发版助手（release）
 *
 * 把「打 annotated tag → 推送 tag → 发布正文 / GitHub Release」收成一条命令。
 * 默认只预览（不改动仓库）；--yes 才真打 tag。发版正文取自 CHANGELOG 里该版本那一段。
 *
 * 用法:
 *   node scripts/release.mjs                      # 预览：前置检查 + 正文
 *   node scripts/release.mjs --notes-out=/tmp/v0.12.0.md
 *   node scripts/release.mjs --yes                # 打 tag 并 push origin <tag>
 *   node scripts/release.mjs --yes --release      # 再尝试 gh release create（无 gh 则降级打印）
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const yes = argv.includes("--yes");
const wantRelease = argv.includes("--release");
const argOf = (n, d) => {
  const hit = argv.find((a) => a.startsWith(n + "="));
  return hit ? hit.slice(n.length + 1) : d;
};
const notesOut = argOf("--notes-out", "");

const git = (args, opts = {}) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", ...opts }).trim();
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const version = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
const tag = `v${version}`;

// ---------- 前置检查 ----------
const dirty = git(["status", "--porcelain"]);
if (dirty) fail(`工作区不干净，先提交：\n${dirty}`);
const existing = git(["tag", "--list", tag]);
if (existing) fail(`tag ${tag} 已存在（要重打先 git tag -d ${tag} 并删远端）`);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const sync = git(["rev-list", "--left-right", "--count", `${branch}...origin/${branch}`]).split(/\s+/);
if (sync[0] !== "0" || sync[1] !== "0") fail(`本地 ${branch} 与 origin 不同步（领先 ${sync[0]} / 落后 ${sync[1]}），先 push/pull`);
const head = git(["log", "-1", "--format=%h %s"]);

// ---------- 发布正文 = CHANGELOG 里这一段 ----------
const changelog = execFileSync(process.execPath, [join(REPO, "scripts", "changelog.mjs"), "--stdout"], {
  cwd: REPO,
  encoding: "utf8",
});
const start = changelog.indexOf(`## ${tag} `);
let section;
if (start < 0) {
  section = `## ${tag} — 未发布\n\n（CHANGELOG 里还没有 v${version} 段：提交标题请带 (${tag}) 作用域）\n`;
} else {
  const next = changelog.indexOf("\n## ", start + 1);
  section = (next < 0 ? changelog.slice(start) : changelog.slice(start, next)).trimEnd() + "\n";
}

console.log(`无限五代发版：${tag}（分支 ${branch}，HEAD ${head}）`);
console.log(`发布正文 ${section.length} 字符：\n`);
console.log(section);
if (notesOut) {
  writeFileSync(resolve(notesOut), section);
  console.log(`正文已写到 ${resolve(notesOut)}\n`);
}

if (!yes) {
  console.log(`预览完毕，未改动仓库。要发版：\n  node scripts/release.mjs --yes --release`);
  process.exit(0);
}

// ---------- 打 tag + 推送 ----------
git(["tag", "-a", tag, "-m", `无限五代 ${tag}`]);
console.log(`✓ 已创建 annotated tag ${tag}`);
git(["push", "origin", tag]);
console.log(`✓ 已推送 tag 到 origin`);

// ---------- GitHub Release（可选，gh 缺失即降级）----------
if (!wantRelease) process.exit(0);
let hasGh = false;
try {
  execFileSync("gh", ["--version"], { stdio: "ignore" });
  execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
  hasGh = true;
} catch {}
if (!hasGh) {
  console.log(
    [
      "⚠ 未装/未登录 gh，跳过 GitHub Release（tag 已推送，源码包已可用）",
      "  发 Release 需要：",
      "    装：apt install -y gh      # 或 https://github.com/cli/cli/releases",
      "    登：gh auth login           # 需要一次交互授权",
      `    发：gh release create ${tag} --title "无限五代 ${tag}" --notes-file <上面正文>`,
    ].join("\n"),
  );
  process.exit(0);
}
const notesFile = join(tmpdir(), `ig5-release-${tag}.md`);
writeFileSync(notesFile, section);
execFileSync("gh", ["release", "create", tag, "--title", `无限五代 ${tag}`, "--notes-file", notesFile], {
  cwd: REPO,
  stdio: "inherit",
});
console.log(`✓ 已创建 GitHub Release ${tag}`);
