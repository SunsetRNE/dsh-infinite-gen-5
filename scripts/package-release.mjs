#!/usr/bin/env node
/**
 * 无限五代 · 发布产物打包（release:pack）
 *
 * 把「git 跟踪的全部文件」打成一份可直接安装的归档，供 GitHub Release 当附件带上：
 *   dsh-infinite-gen-5-v<版本>.tar.gz   （顶层目录 dsh-infinite-gen-5/，解开就能 ./install.sh）
 *   dsh-infinite-gen-5-v<版本>.zip      （Windows 用户友好；系统没有 zip 就跳过并说明）
 *   SHA256SUMS                          （两个包的校验和）
 *   RELEASE-NOTES.md                    （CHANGELOG 里当前版本那一段的**压缩版**：只留最近更新
 *                                        + 指向仓库内《更新文档》UPDATE.md；CI 建 Release 时当正文）
 *
 * 只打包**仓库里跟踪的文件**：`ui-preview/`（gitignore 的预览产物）、`node_modules`、`.git`
 * 天然不会进包 —— 用户拿到的就是「本该装进 ~/.dsh/plugins 的那一份」。
 *
 * 打完还会**解包复检**：把 tar.gz 解到临时目录、在包里跑 `scripts/verify_version.mjs`，
 * 不一致就失败（防「漏打了个文件、包还能下但装不上」）。
 *
 * 零依赖：只用 node 内建模块 + 系统 tar/zip（缺 zip 会降级，不当失败）。
 * 用法：node scripts/package-release.mjs [--out=dist] [--no-zip] [--skip-verify]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { buildReleaseNotes } from "./lib/release-notes.mjs";

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
const OUT = resolve(REPO, argOf("--out", "dist"));
const wantZip = !argv.includes("--no-zip");
const doVerify = !argv.includes("--skip-verify");
const useWorktree = argv.includes("--worktree");

const NAME = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).name;
const version = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
const tag = `v${version}`;
const have = (bin) => {
  try {
    execFileSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const human = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

if (!have("tar")) {
  console.error("✗ 找不到系统 tar，无法打包（CI runner 与主流桌面系统都自带）");
  process.exit(2);
}

console.log(`打包 ${NAME} ${tag} → ${OUT}`);
mkdirSync(OUT, { recursive: true });

// ---------- 1) 按 git 跟踪清单摆一份干净的暂存树 ----------
const stage = mkdtempSync(join(tmpdir(), "ig5-pack-"));
const stageRoot = join(stage, NAME);
// --worktree：按工作树打包（跟踪文件 + 未跟踪且未被忽略的文件），用于「还没提交先验包」。
// 默认走跟踪面 —— 正式发版必须与 tag 内容一致，否则归档里有 tag 上没有的文件。
const lsArgs = useWorktree
  ? ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]
  : ["ls-files", "-z"];
const files = execFileSync("git", lsArgs, { cwd: REPO, encoding: "utf8" })
  .split("\0")
  .filter((p) => p.length > 0 && existsSync(join(REPO, p)))
  .sort();
const tracked = new Set(
  execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" }).split("\0").filter(Boolean),
);

// release:pack 只打 git 跟踪文件；若运行时 import 留成未跟踪，旧实现会
// 「解包复检通过」但启动时才 ERR_MODULE_NOT_FOUND。先核对 index/client 的
// 相对静态 import 闭包，宁可提前失败，也不产出假绿归档。
const importRe = /from\s+["'](\.\/[^"']+)["']|import\s+["'](\.\/[^"']+)["']|import\(\s*["'](\.\/[^"']+)["']\s*\)/g;
const runtimeFiles = new Set();
const pendingRuntime = ["index.js", "client.js"];
while (pendingRuntime.length > 0) {
  const rel = pendingRuntime.pop();
  if (runtimeFiles.has(rel)) continue;
  runtimeFiles.add(rel);
  const source = readFileSync(join(REPO, rel), "utf8");
  let match;
  while ((match = importRe.exec(source))) {
    const spec = match[1] || match[2] || match[3];
    if (spec.includes("${")) continue;
    let dep = join(dirname(rel), spec).replaceAll("\\", "/");
    if (!/\.[cm]?js$/.test(dep)) dep += ".js";
    if (!existsSync(join(REPO, dep))) throw new Error(`运行时 import 指向不存在文件：${rel} -> ${dep}`);
    pendingRuntime.push(dep);
  }
}
const untrackedRuntime = [...runtimeFiles].filter((p) => !tracked.has(p)).sort();
if (untrackedRuntime.length > 0 && !useWorktree) {
  console.error("✗ release:pack 拒绝：运行时 import 闭包中有未 git 跟踪文件，当前归档会缺文件：");
  for (const rel of untrackedRuntime) console.error(`    ${rel}`);
  console.error("  先 git add/commit 这些生产文件，再重新运行 release:pack；不会自动改动 git index。");
  console.error("  只想本地预验包内容，可加 --worktree（把未跟踪文件一起打包，不能当发版产物）。");
  process.exit(2);
}
if (untrackedRuntime.length > 0) {
  console.log(`  ! --worktree：把 ${untrackedRuntime.length} 个未跟踪运行时文件一起打包（本地预验用）`);
  for (const rel of untrackedRuntime) console.log(`      ${rel}`);
}
for (const rel of files) {
  const dest = join(stageRoot, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(REPO, rel), dest);
}
console.log(
  `  ✓ 暂存 ${files.length} 个文件（${useWorktree ? "工作树面：跟踪 + 未跟踪" : "git 跟踪面"}；ui-preview / node_modules / .git 不在内）`,
);

// ---------- 2) RELEASE-NOTES.md = 当前版本段的压缩版（只留最近更新 + 指回《更新文档》）----------
let notes = "";
let notesInfo = null;
try {
  const changelog = execFileSync(process.execPath, [join(REPO, "scripts", "changelog.mjs"), "--stdout"], {
    cwd: REPO,
    encoding: "utf8",
  });
  notesInfo = buildReleaseNotes(changelog, tag);
  notes = notesInfo.text;
} catch (err) {
  console.warn(`  ! RELEASE-NOTES.md 压缩失败（${err.message}），退化为占位`);
}
writeFileSync(join(OUT, "RELEASE-NOTES.md"), notes);
console.log(
  `  ✓ RELEASE-NOTES.md（${notes.length} 字符` +
    (notesInfo?.found
      ? ` · 留 ${notesInfo.bullets.filter((b) => b.startsWith("- ") && !b.startsWith("- …")).length} 条` +
        `${notesInfo.dropped > 0 ? ` · 压掉 ${notesInfo.dropped} 条` : ""}` +
        `${notesInfo.truncatedBullets > 0 ? ` · 截断 ${notesInfo.truncatedBullets} 条` : ""}）`
      : " · 该版本还没有 CHANGELOG 段）"),
);

// ---------- 3) tar.gz（GNU tar 可用时固定 mtime/属主，便于复现）----------
const tgz = join(OUT, `${NAME}-${tag}.tar.gz`);
const mtime = execFileSync("git", ["log", "-1", "--format=%ct"], { cwd: REPO, encoding: "utf8" }).trim();
const gnuFlags = ["--sort=name", "--owner=0", "--group=0", "--numeric-owner", `--mtime=@${mtime}`];
try {
  execFileSync("tar", [...gnuFlags, "-czf", tgz, "-C", stage, NAME], { stdio: "ignore" });
} catch {
  execFileSync("tar", ["-czf", tgz, "-C", stage, NAME], { stdio: "inherit" });
}
console.log(`  ✓ ${tgz.replace(REPO + "/", "")}  ${human(statSync(tgz).size)}`);

// ---------- 4) zip（可选，缺 zip 就降级说明）----------
const zipPath = join(OUT, `${NAME}-${tag}.zip`);
if (wantZip) {
  if (have("zip")) {
    execFileSync("zip", ["-qr", zipPath, NAME], { cwd: stage, stdio: "ignore" });
    console.log(`  ✓ ${zipPath.replace(REPO + "/", "")}  ${human(statSync(zipPath).size)}`);
  } else {
    console.log("  ⚠ 系统没有 zip，跳过 .zip（装：apt install -y zip；tar.gz 已可用）");
  }
}

// ---------- 5) SHA256SUMS ----------
const sums = [tgz, existsSync(zipPath) && zipPath].filter(Boolean);
writeFileSync(
  join(OUT, "SHA256SUMS"),
  sums.map((p) => `${sha256(p)}  ${p.split("/").pop()}`).join("\n") + "\n",
);
console.log("  ✓ SHA256SUMS");
for (const p of sums) console.log(`      ${sha256(p)}  ${p.split("/").pop()}`);

// ---------- 6) 解包复检：包里自己跑一次版本自检 ----------
if (doVerify) {
  const unpack = mkdtempSync(join(tmpdir(), "ig5-unpack-"));
  try {
    execFileSync("tar", ["-xzf", tgz, "-C", unpack], { stdio: "ignore" });
    const inside = join(unpack, NAME);
    const out = execFileSync(process.execPath, [join(inside, "scripts", "verify_version.mjs")], {
      cwd: inside,
      encoding: "utf8",
    });
    const tail = out.trim().split("\n").filter((l) => l.includes("通过") || l.includes("当前版本")).at(-1) || "";
    const packed = JSON.parse(readFileSync(join(inside, "package.json"), "utf8")).version;
    if (packed !== version) throw new Error(`包内版本 ${packed} ≠ 仓库版本 ${version}`);
    console.log(`  ✓ 解包复检通过：${tail.trim()}`);
  } catch (error) {
    console.error(`✗ 解包复检失败：${error.message}`);
    rmSync(stage, { recursive: true, force: true });
    rmSync(unpack, { recursive: true, force: true });
    process.exit(1);
  }
  rmSync(unpack, { recursive: true, force: true });
}

rmSync(stage, { recursive: true, force: true });
console.log(`\n完成：${OUT} 下 ${sums.length + 2} 个文件可直接当 Release 附件上传`);
