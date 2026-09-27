#!/usr/bin/env node
// 无限五代 · 版本号单点改写（离线、零依赖）
//
// 用法：node scripts/bump-version.mjs X.Y.Z
//       bash scripts/bump-version.sh X.Y.Z      （薄包装，等价）
//       node scripts/bump-version.mjs X.Y.Z --dry   （只看会改哪里，不落盘）
//
// 只改「当前版本锚点」（见 version-targets.mjs），历史叙述一律不动：
// 改 package.json 的 version 与 dsh.version 字段、以及各锚点的捕获组，
// description / README 版本沿革里的旧版本号保持原样。
//
// 两段式：先把所有锚点校验一遍（缺失、命中多次、写着别的版本号都算问题），
// 全部通过才落盘 —— 不会出现「package.json 改了、某处锚点没跟上」的半截状态。
//
// 改完请跑：npm run verify:all
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VERSION_ANCHORS } from "./version-targets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const abs = (f) => join(ROOT, f);

const args = process.argv.slice(2);
const DRY = args.includes("--dry") || args.includes("-n");
const NEW = (args.find((a) => !a.startsWith("-")) || "").trim();

if (!/^\d+\.\d+\.\d+$/.test(NEW)) {
  console.error("用法: node scripts/bump-version.mjs X.Y.Z [--dry]    例：X.Y.Z（照抄你的目标版本号）");
  process.exit(2);
}

const pkgPath = abs("package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const OLD = String(pkg.version || "");

if (!/^\d+\.\d+\.\d+$/.test(OLD)) {
  console.error(`package.json 的 version 不是 x.y.z：${JSON.stringify(pkg.version)}`);
  process.exit(2);
}
if (OLD === NEW) {
  console.log(`版本已是 ${OLD}，无需改写`);
  process.exit(0);
}

// ---------- 第 1 段：全量校验，任何问题都不落盘 ----------
const problems = [];
const plans = [];

if (pkg.dsh?.version && pkg.dsh.version !== OLD) {
  problems.push(`package.json：version=${OLD} 与 dsh.version=${pkg.dsh.version} 已经不一致，先手工对齐再发版`);
}

for (const { file, name, re } of VERSION_ANCHORS) {
  let text;
  try {
    text = readFileSync(abs(file), "utf8");
  } catch {
    problems.push(`${name}：文件不存在（${file}）`);
    continue;
  }
  const hits = [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))];
  if (hits.length !== 1) {
    problems.push(`${name}：锚点命中 ${hits.length} 次，期望恰好 1 次（${file}）`);
    continue;
  }
  const found = hits[0][1];
  if (found !== OLD) {
    problems.push(`${name}：文件里是 v${found}，package.json 是 ${OLD} —— 先跑 npm run verify:version 对齐`);
    continue;
  }
  plans.push({ file, name, text, re, found });
}

if (problems.length) {
  console.error(`✗ 版本改写中止（${problems.length} 处问题，未写入任何文件）：`);
  for (const p of problems) console.error(`    - ${p}`);
  process.exit(1);
}

// ---------- 第 2 段：落盘 ----------
const done = [];

pkg.version = NEW;
if (pkg.dsh && typeof pkg.dsh === "object") pkg.dsh.version = NEW;
if (!DRY) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
done.push("package.json（version / dsh.version，description 里的历史叙述不动）");

for (const { file, name, text, re, found } of plans) {
  if (!DRY) writeFileSync(abs(file), text.replace(re, (full) => full.replace(found, NEW)));
  done.push(`${name}  v${found} → v${NEW}`);
}

console.log(`${DRY ? "[dry-run] 不会写盘 · " : ""}版本改写 ${OLD} → ${NEW}`);
for (const d of done) console.log(`  [OK] ${d}`);
console.log("\n接着跑：npm run verify:all          （提交建议：chore(v" + NEW + "): 版本号提升）");
