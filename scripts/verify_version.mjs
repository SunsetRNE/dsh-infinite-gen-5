// 无限五代 · 版本一致性自检（离线、确定性、零依赖）
//
// 针对的缺陷：版本号曾手写在 8 个文件里（README 16 处、package.json 3 处、client.js 3 处…），
// 发版靠人肉 grep，漏一处就出现「状态条显示旧版本 / patch 头注释过期 / 标题对不上」。
//
// 断言四件事：
//   1) package.json 的 version 形如 x.y.z，且与 dsh.version 同源；
//   2) 每个「当前版本锚点」（见 version-targets.mjs）恰好命中一次、且等于当前版本
//      —— 断言写成「字面量 == package.json」而不是「代码里有这个字符串」，重构掉字面量也不会假绿；
//   3) 文档里不存在比当前版本更新的 0.x.y（防止 README 提前写下一版）；
//   4) 全仓没有「未登记的版本号字面量」—— 新文件里硬写当前版本号会被抓住，
//      提醒你把它登记成锚点或改成引用常量。
//
// 历史版本号（README 的「v0.9.0 起…」、description 的历代特性、ENV_PROBE 的「随插件 v0.8.0 引入」）
// 刻意允许存在，不算失败 —— 它们记录的是当时。
//
// 用法：node scripts/verify_version.mjs [--json]
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { VERSION_ANCHORS, PROSE_ALLOWED_FILES, SCAN_SKIP_DIRS, SCAN_EXTENSIONS } from "./version-targets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const abs = (f) => join(ROOT, f);
const passes = [];
const failures = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

const pkg = JSON.parse(readFileSync(abs("package.json"), "utf8"));
const V = String(pkg.version || "");

// 版本号逐段按数字比大小，而不是字符串比较
function cmpVersion(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- 1. package.json 单点 ----
check(/^\d+\.\d+\.\d+$/.test(V), "package.json 的 version 形如 x.y.z", V);
check(pkg.dsh?.version === V, "package.json 的 dsh.version 与 version 一致", `dsh.version=${pkg.dsh?.version} version=${V}`);

// ---- 2. 当前版本锚点恰好命中一次且等于当前版本 ----
for (const { file, name, re } of VERSION_ANCHORS) {
  let text = null;
  try {
    text = readFileSync(abs(file), "utf8");
  } catch {
    check(false, `锚点 ${name}`, `文件不存在：${file}`);
    continue;
  }
  const hits = [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))];
  check(hits.length === 1, `锚点唯一性 · ${name}`, `命中 ${hits.length} 次，期望 1 次（${file}）`);
  if (hits.length === 1) {
    check(hits[0][1] === V, `锚点版本 · ${name}`, `文件里是 ${hits[0][1]}，package.json 是 ${V}`);
  }
}

// ---- 3. 文档不得宣称比当前版本更新的版本号 ----
const DOC_FILES = ["README.md", "HARNESS_PLUGIN.md", "ENV_PROBE.md", "UPDATE.md", "package.json"];
for (const file of DOC_FILES) {
  let text;
  try {
    text = readFileSync(abs(file), "utf8");
  } catch {
    continue;
  }
  const tokens = [...new Set([...text.matchAll(/\bv?(0\.\d+\.\d+)\b/g)].map((m) => m[1]))];
  const ahead = tokens.filter((t) => cmpVersion(t, V) > 0);
  check(ahead.length === 0, `无超前版本号 · ${file}`, ahead.length ? `出现 v${ahead.join(" / v")}，比当前 ${V} 新（文档里举例请用 X.Y.Z 占位符）` : "");
}

// ---- 4. 全仓无未登记的当前版本字面量 ----
const known = new Set([...VERSION_ANCHORS.map((a) => a.file), ...PROSE_ALLOWED_FILES]);
const literal = new RegExp(`\\b${escapeRe(V)}\\b`);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SCAN_SKIP_DIRS.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      acc.push(full);
    }
  }
  return acc;
}

const unregistered = [];
const scanned = walk(ROOT);
for (const full of scanned) {
  const rel = relative(ROOT, full).split("\\").join("/");
  if (known.has(rel)) continue;
  let text;
  try {
    text = readFileSync(full, "utf8");
  } catch {
    continue;
  }
  if (literal.test(text)) unregistered.push(rel);
}
check(
  unregistered.length === 0,
  "无未登记的版本号字面量",
  unregistered.length ? `${unregistered.join(" / ")} 里硬写了 ${V} —— 请登记为锚点（version-targets.mjs）或改为引用常量` : "",
);
check(scanned.length > 5, "扫描到了仓库文件", `只扫到 ${scanned.length} 个文件，可能路径不对`);

// ---- 输出 ----
const total = passes.length + failures.length;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ version: V, passed: passes.length, failed: failures.length, passes, failures }, null, 1));
} else {
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`\n无限五代版本一致性自检： ${passes.length} 通过 / ${failures.length} 失败（共 ${total} 条）`);
  console.log(`当前版本=${V} · 锚点 ${VERSION_ANCHORS.length} 处 · 扫描 ${scanned.length} 个文件`);
}
process.exit(failures.length === 0 ? 0 : 1);
