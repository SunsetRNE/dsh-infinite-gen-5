#!/usr/bin/env node
/**
 * 无限五代 · CHANGELOG 生成器
 *
 * 从 git 提交（Conventional Commits）机械生成 CHANGELOG.md —— 版本段落靠提交标题里
 * 的 vX.Y.Z 自动切分（本仓库的约定是 feat(v0.12.0): … / chore(v0.11.1): …），
 * 比最新那段版本号更新的提交归入「未发布」。
 *
 * 用法:
 *   node scripts/changelog.mjs                # 写 CHANGELOG.md
 *   node scripts/changelog.mjs --stdout       # 只打印（发布正文用）
 *   node scripts/changelog.mjs --out=OTHER.md
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
// 两种写法都收：--flag=value 与 --flag value（旧实现只认等号形式，与帮助文案不一致）。
const argOf = (n, d) => {
  const eq = argv.find((a) => a.startsWith(n + "="));
  if (eq) return eq.slice(n.length + 1);
  const i = argv.indexOf(n);
  const next = i >= 0 ? argv[i + 1] : undefined;
  return next && !next.startsWith("--") ? next : d;
};
const toStdout = argv.includes("--stdout");
const out = resolve(REPO, argOf("--out", "CHANGELOG.md"));

const LABELS = {
  feat: "✨ 新特性",
  fix: "🐛 修复",
  chore: "🧹 杂务与维护",
  docs: "📝 文档",
  ci: "🔁 持续集成",
  perf: "⚡ 性能",
  refactor: "♻️ 重构",
  test: "✅ 测试",
  build: "📦 构建",
  style: "💅 样式",
  revert: "⏪ 回滚",
};
const ORDER = Object.keys(LABELS).concat(["other"]);

const repoVersion = (() => {
  try {
    return JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
  } catch {
    return "?";
  }
})();

const raw = execFileSync("git", ["log", "--no-merges", "--date=short", "--pretty=format:%h%x1f%ad%x1f%s"], {
  cwd: REPO,
  encoding: "utf8",
}).trim();
const commits = raw
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [hash, date, subject] = line.split("\x1f");
    return { hash, date, subject: subject || "" };
  });

// ---- 按提交标题里的 vX.Y.Z 切版本段（新 → 旧）----
const sections = [];
let current = null;
for (const c of commits) {
  // 只认「作用域里的版本」这个约定（feat(v0.12.0): …），不认正文里被提到的版本号，
  // 否则 fix(install): … 原先硬写 v0.5.0 … 这类提交会把段落切错。
  const hit = /^[a-z]+\((v\d+\.\d+\.\d+)\)/.exec(c.subject) || /^(v\d+\.\d+\.\d+)\b/.exec(c.subject);
  if (hit) {
    const version = hit[1].replace(/^v/, "");
    if (!current || current.version !== version) {
      current = { version, date: c.date, entries: [], released: true };
      sections.push(current);
    }
  } else if (!current) {
    current = { version: `未发布（仓库版本 ${repoVersion}）`, date: c.date, entries: [], released: false };
    sections.push(current);
  }
  const m = /^(\w+)(\([^)]*\))?!?:\s*(.+)$/.exec(c.subject);
  current.entries.push({
    type: m && LABELS[m[1]] ? m[1] : "other",
    text: m ? m[3] : c.subject,
    hash: c.hash,
    // 最新一条提交（HEAD）的哈希在「生成 → 提交/amend」之间还会变，
    // 标出来必然是错的（旧哈希），所以它一律不带哈希，避免每轮发版都要再改一次。
    tip: c.hash === commits[0].hash,
  });
}

const renderSection = (s) => {
  const lines = [`## ${s.released ? "v" + s.version : s.version} — ${s.date}`, ""];
  for (const type of ORDER) {
    const items = s.entries.filter((e) => e.type === type);
    if (items.length === 0) continue;
    lines.push(`### ${LABELS[type] || "其他"}`, "");
    for (const it of items) lines.push(it.tip ? `- ${it.text}` : `- ${it.text}（\`${it.hash}\`）`);
    lines.push("");
  }
  return lines.join("\n");
};

const header = [
  "# 更新日志",
  "",
  "本文件由 `node scripts/changelog.mjs` 从 git 提交（Conventional Commits）生成，请勿手改；",
  "版本段落按提交标题里的 `vX.Y.Z` 切分，未带版本号的提交归入最新段；",
  "每条末尾的短哈希是提交号，最新一条（HEAD）不标哈希 —— 它在「生成 → 提交」之间还会变。",
  "",
  "",
].join("\n");

const body = header + sections.map(renderSection).join("\n");
if (toStdout) {
  console.log(body);
} else {
  writeFileSync(out, body);
  console.log(`已写入 ${out}：${sections.length} 个版本段 · ${commits.length} 条提交`);
}
