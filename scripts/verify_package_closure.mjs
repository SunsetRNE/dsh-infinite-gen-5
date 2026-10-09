// 发布前运行时闭包门禁：检查 npm pack 产物包含 index/client 的静态相对 import 闭包。
// 判据两维：① npm pack（读工作树）必须含闭包全部文件；② git 跟踪面必须含闭包全部文件
// —— release:pack 走 git ls-files，只测第 ① 维时「本地绿、发版 exit 2」会一直藏着。
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, dirname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packJson = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" }));
const files = new Set((packJson[0]?.files ?? []).map((entry) => entry.path));
const importRe = /from\s+["'](\.\/[^"']+)["']|import\s+["'](\.\/[^"']+)["']|import\(\s*["'](\.\/[^"']+)["']\s*\)/g;
const seen = new Set();
const pending = ["index.js", "client.js"];
const missing = [];
while (pending.length > 0) {
  const rel = pending.pop();
  if (seen.has(rel)) continue;
  seen.add(rel);
  if (!existsSync(join(root, rel))) {
    missing.push(`${rel} (workspace missing)`);
    continue;
  }
  const source = readFileSync(join(root, rel), "utf8");
  let match;
  while ((match = importRe.exec(source))) {
    const spec = match[1] || match[2] || match[3];
    if (spec.includes("${")) continue;
    let dep = normalize(join(dirname(rel), spec)).replaceAll("\\", "/");
    if (!/\.[cm]?js$/.test(dep)) dep += ".js";
    pending.push(dep);
  }
}
const omitted = [...seen].filter((rel) => !files.has(rel));
// 第二维：跟踪面。git 不可用（无仓库的裁剪包）时退化为不判这一维，不让门禁自造失败。
let untracked = [];
let trackedKnown = false;
try {
  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean),
  );
  trackedKnown = true;
  untracked = [...seen].filter((rel) => !tracked.has(rel)).sort();
} catch {
  untracked = [];
}
const passes = [
  `runtime-imports=${seen.size}`,
  `npm-pack-files=${files.size}`,
  `package-bytes=${packJson[0]?.size ?? "unknown"}`,
  trackedKnown ? `git-tracked=${seen.size - untracked.length}` : "git-tracked=（无 git，跳过）",
];
const failures = [
  ...missing.map((x) => `missing=${x}`),
  ...omitted.map((x) => `omitted=${x}`),
  ...untracked.map((x) => `untracked=${x}（release:pack 会 exit 2，先 git add）`),
];
console.log(JSON.stringify({ passed: passes.length, failed: failures.length, passes, failures }, null, 1));
process.exit(failures.length === 0 ? 0 : 1);
