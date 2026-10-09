#!/usr/bin/env node
/**
 * 无限五代 · 发版助手（release）
 *
 * 把「打 annotated tag → 推送 tag → 发布正文 / GitHub Release」收成一条命令。
 * 默认只预览（不改动仓库）；--yes 才真打 tag。发版正文取自 CHANGELOG 里该版本那一段，
 * 但**只留最近更新**（scripts/lib/release-notes.mjs 压缩），全量叙述在仓库内《更新文档》UPDATE.md。
 *
 * 用法:
 *   node scripts/release.mjs                      # 预览：前置检查 + 正文
 *   node scripts/release.mjs --notes-out=/tmp/v0.12.0.md
 *   node scripts/release.mjs --yes                # 打 tag 并 push origin <tag>
 *   node scripts/release.mjs --yes --release      # 再发 GitHub Release（gh 优先，缺 gh 走 REST + ~/.local-gh/.token）
 *   node scripts/release.mjs --yes --release-only --release   # tag 已推送，只补 GitHub Release
 *   node scripts/release.mjs --yes --release --token-file /path/.token   # 临时指定凭据文件
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { releaseNotes } from "./lib/release-notes.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const yes = argv.includes("--yes");
const releaseOnly = argv.includes("--release-only");
const wantRelease = argv.includes("--release") || releaseOnly;
// 两种写法都收：--flag=value 与 --flag value。
// 旧实现只认等号形式，而本文件自己的帮助/报错文案推荐的是空格形式 ——
// 照着文案敲 --token-file /path/.token 会静默拿到默认值（空），发布凭据因此被判「没有」。
const argOf = (n, d) => {
  const eq = argv.find((a) => a.startsWith(n + "="));
  if (eq) return eq.slice(n.length + 1);
  const i = argv.indexOf(n);
  const next = i >= 0 ? argv[i + 1] : undefined;
  return next && !next.startsWith("--") ? next : d;
};
const notesOut = argOf("--notes-out", "");
const tokenFileArg = argOf("--token-file", "");

// ---------- 凭据发现（不装 gh 也能发 Release）----------
// 约定：通用凭据目录 ~/.local-gh/.token（可被 GH_TOKEN_FILE / --token-file 覆盖）。
// 只读、绝不回显内容；找不到就降级打印怎么准备。
const HOME = process.env.HOME || "/root";
const expand = (p) => resolve(p.replace(/^~(?=\/|$)/, HOME));
function readToken() {
  const direct = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (direct && direct.trim()) return { token: direct.trim(), from: "环境变量 GH_TOKEN/GITHUB_TOKEN" };
  for (const p of [process.env.GH_TOKEN_FILE, tokenFileArg, join(HOME, ".local-gh", ".token")].filter(Boolean)) {
    try {
      const t = readFileSync(expand(p), "utf8").trim();
      if (t) return { token: t, from: expand(p) };
    } catch {}
  }
  return null;
}
function originSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const m = git(["remote", "get-url", "origin"]).match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : "";
  } catch {
    return "";
  }
}

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
if (existing && !releaseOnly) {
  fail(`tag ${tag} 已存在（要重打先 git tag -d ${tag} 并删远端；只想补 GitHub Release 就加 --release-only）`);
}
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const sync = git(["rev-list", "--left-right", "--count", `${branch}...origin/${branch}`]).split(/\s+/);
if (sync[0] !== "0" || sync[1] !== "0") fail(`本地 ${branch} 与 origin 不同步（领先 ${sync[0]} / 落后 ${sync[1]}），先 push/pull`);
const head = git(["log", "-1", "--format=%h %s"]);

// ---------- 发布正文 = CHANGELOG 里这一段，但只留最近更新（压缩）----------
const changelog = execFileSync(process.execPath, [join(REPO, "scripts", "changelog.mjs"), "--stdout"], {
  cwd: REPO,
  encoding: "utf8",
});
const section = releaseNotes(changelog, tag);

console.log(`无限五代发版：${tag}（分支 ${branch}，HEAD ${head}）`);
console.log(`发布正文 ${section.length} 字符（压缩版：只留最近更新，全文见 UPDATE.md）：\n`);
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
if (releaseOnly) {
  if (!existing) fail(`--release-only 要求 tag ${tag} 已存在；要打新 tag 就去掉这个开关`);
  console.log(`✓ tag ${tag} 已存在，跳过打 tag（只补 GitHub Release）`);
} else {
  git(["tag", "-a", tag, "-m", `无限五代 ${tag}`]);
  console.log(`✓ 已创建 annotated tag ${tag}`);
  git(["push", "origin", tag]);
  console.log(`✓ 已推送 tag 到 origin`);
}

// ---------- GitHub Release：gh 优先，缺 gh 则用 REST + 通用凭据 ----------
if (!wantRelease) process.exit(0);
const notesFile = join(tmpdir(), `ig5-release-${tag}.md`);
writeFileSync(notesFile, section);
const slug = originSlug();

let hasGh = false;
try {
  execFileSync("gh", ["--version"], { stdio: "ignore" });
  execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
  hasGh = true;
} catch {}
if (hasGh) {
  execFileSync("gh", ["release", "create", tag, "--title", `无限五代 ${tag}`, "--notes-file", notesFile], {
    cwd: REPO,
    stdio: "inherit",
  });
  console.log(`✓ 已用 gh 创建 GitHub Release ${tag}`);
  process.exit(0);
}

const cred = readToken();
if (!cred || !slug) {
  console.log(
    [
      "⚠ 没有可用的发布凭据，跳过 GitHub Release（tag 已推送，源码包已可用）",
      "  三条路任选：",
      "    装 gh：apt install -y gh && gh auth login",
      `    备通用凭据：把 token 写到 ~/.local-gh/.token（chmod 600），再跑 node scripts/release.mjs --release-only --release`,
      `    临时指定：node scripts/release.mjs --release-only --release --token-file /path/to/.token`,
      !slug ? "  （另外：从 git remote 里没解析出 owner/repo）" : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  process.exit(0);
}

console.log(`凭据来源：${cred.from}（内容不回显）→ 仓库 ${slug}`);
const res = await fetch(`https://api.github.com/repos/${slug}/releases`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${cred.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "dsh-infinite-gen-5-release",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ tag_name: tag, name: `无限五代 ${tag}`, body: section, draft: false, prerelease: false }),
});
const text = await res.text();
let json = {};
try {
  json = JSON.parse(text);
} catch {}
if (res.ok) {
  console.log(`✓ 已创建 GitHub Release ${tag} → ${json.html_url}`);
} else if (res.status === 422 && /already_exists/.test(text)) {
  console.log(`⚠ Release ${tag} 已存在，未改动（要改就去网页删掉或改用 gh release edit）`);
} else {
  console.error(`✗ 创建 Release 失败：HTTP ${res.status} ${String(json.message || text).slice(0, 200)}`);
  process.exit(1);
}

