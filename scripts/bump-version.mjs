#!/usr/bin/env node
// 无限五代 · 版本号单点改写（离线、零依赖）
//
// 用法：node scripts/bump-version.mjs X.Y.Z
//       bash scripts/bump-version.sh X.Y.Z      （薄包装，等价）
//       node scripts/bump-version.mjs X.Y.Z --dry   （只看会改哪里，不落盘）
//
// 只改「当前版本锚点」（见 version-targets.mjs），历史叙述一律不动：
// 改 package.json 的 version 与 dsh.version 字段、以及各锚点的捕获组（锚点可声明
// count：同一份文件里同源的 N 处一起改），description / VERSIONS.md 里的旧版本号保持原样。
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
// package.json 已是目标版本时**不退出**：旧缺陷是这里直接 exit(0)，
// 于是「package.json 先到新号、锚点文件还停在旧号」的漂移永远修不掉，
// 而 verify:version 会红（本会话实测 6 处）。改为对齐模式：
// 同一目标版本下只修与目标不一致的锚点，package.json 不再改写。
const ALIGN = OLD === NEW;
if (ALIGN) console.log(`package.json 已是 ${OLD}，进入对齐模式：只修与 v${NEW} 不一致的锚点`);

// ---------- 第 1 段：全量校验，任何问题都不落盘 ----------
const problems = [];
const plans = [];

if (pkg.dsh?.version && pkg.dsh.version !== OLD) {
  problems.push(`package.json：version=${OLD} 与 dsh.version=${pkg.dsh.version} 已经不一致，先手工对齐再发版`);
}

for (const { file, name, re, count = 1 } of VERSION_ANCHORS) {
  let text;
  try {
    text = readFileSync(abs(file), "utf8");
  } catch {
    problems.push(`${name}：文件不存在（${file}）`);
    continue;
  }
  const hits = [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))];
  if (hits.length !== count) {
    problems.push(`${name}：锚点命中 ${hits.length} 次，期望恰好 ${count} 次（${file}）`);
    continue;
  }
  const found = hits[0][1];
  const stray = [...new Set(hits.map((h) => h[1]).filter((v) => v !== NEW))];
  if (stray.length > 1) {
    problems.push(`${name}：同一处锚点里出现多个版本号 v${stray.join(" / v")}（${file}）—— 手工对齐后再跑`);
    continue;
  }
  if (!ALIGN && (found !== OLD || stray.length)) {
    problems.push(`${name}：文件里是 v${(stray.length ? stray : [found]).join(" / v")}，package.json 是 ${OLD} —— 先跑 npm run verify:version 对齐`);
    continue;
  }
  if (found === NEW && !stray.length) continue; // 已经是目标号：不进计划（对齐模式下多数锚点走这条）
  plans.push({ file, name, text, re, found, count });
}

if (problems.length) {
  console.error(`✗ 版本改写中止（${problems.length} 处问题，未写入任何文件）：`);
  for (const p of problems) console.error(`    - ${p}`);
  process.exit(1);
}

// ---------- 第 2 段：落盘 ----------
const done = [];

if (!ALIGN) {
  pkg.version = NEW;
  if (pkg.dsh && typeof pkg.dsh === "object") pkg.dsh.version = NEW;
  if (!DRY) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  done.push("package.json（version / dsh.version，description 里的历史叙述不动）");
}

// 同一份文件可能挂着多个锚点（README：标题 1 处 + 一键安装深链 4 处）。
// 必须按文件归组，在一份内存文本上依次改写、最后只写一次 ——
// 逐锚点 writeFileSync 会让后一个锚点拿校验阶段读入的旧文本覆盖前一个的改写成果，
// 而两处都打印 [OK]（假成功）。
const byFile = new Map();
for (const plan of plans) {
  if (!byFile.has(plan.file)) byFile.set(plan.file, { text: plan.text, items: [] });
  byFile.get(plan.file).items.push(plan);
}

for (const [file, { text, items }] of byFile) {
  let out = text;
  for (const { re, found } of items) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    out = out.replace(g, (full) => full.replace(found, NEW));
  }
  // 落盘前复查：本文件里旧版本号的出现次数必须**恰好减少** sum(count) 处。
  // 用「差额」而不是「归零」，因为锚点文件里可能有刻意保留旧号的历史叙述；
  // 差额对不上就说明某个锚点的改写被覆盖了（旧缺陷：报 OK 但文件没改）。
  // 落盘前复查：本文件里每个「被改写的旧版本串」出现次数必须**恰好减少**其锚点份额。
  // 用「差额」而不是「归零」，因为锚点文件里可能有刻意保留旧号的历史叙述；
  // 按 found 串分组，因为对齐模式下同一文件里不同锚点可能停在不同的旧号上。
  const want = new Map();
  for (const it of items) want.set(it.found, (want.get(it.found) ?? 0) + (it.count ?? 1));
  for (const [ver, expected] of want) {
    const verRe = new RegExp(ver.replace(/\./g, "\\."), "g");
    const before = [...text.matchAll(verRe)].length;
    const after = [...out.matchAll(verRe)].length;
    if (before - after !== expected) {
      console.error(`✗ ${file}：旧版本 v${ver} 出现次数 ${before} → ${after}，应减少 ${expected} 处（锚点改写被覆盖）`);
      process.exit(1);
    }
  }
  if (!DRY) writeFileSync(abs(file), out);
  for (const { name, found, count } of items) {
    done.push(`${name}  v${found} → v${NEW}${count > 1 ? `（${count} 处同源）` : ""}`);
  }
}

console.log(`${DRY ? "[dry-run] 不会写盘 · " : ""}${ALIGN ? `对齐模式（package.json 已是 ${NEW}，未改写 package.json）` : `版本改写 ${OLD} → ${NEW}`}`);
if (ALIGN && !plans.length) console.log(`  [OK] 所有锚点已是 v${NEW}，无需改写`);
for (const d of done) console.log(`  [OK] ${d}`);
console.log("\n接着跑：npm run verify:all          （提交建议：chore(v" + NEW + "): 版本号提升）");
