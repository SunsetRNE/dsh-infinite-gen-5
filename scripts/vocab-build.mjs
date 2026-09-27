#!/usr/bin/env node
// 无限五代 · 命中词汇构建器
//
//   node scripts/vocab-build.mjs            # 读 data/vocab/*.json → 写 data/vocabulary-data.mjs
//   node scripts/vocab-build.mjs --check    # 只校验：词条合法 + 生成物与磁盘一致（CI 用）
//   node scripts/vocab-build.mjs --dir=DIR   # 换源目录（默认 data/vocab）
//
// 为什么要有「源 JSON + 生成物」两层：
//   - 词条是多批人/多轮补的，JSON 便于分批喂与 review（一次一批，diff 干净）；
//   - 运行时只认 .mjs（插件不读磁盘、也不做 JSON.parse），所以必须落成模块；
//   - --check 一旦接进自检，就能保证「生成物 ≠ 源文件」这种漂移当天被发现，
//     而不是等到某个用户发现少了一半词条。
//
// 淘汰规则（命中即丢，并打印原因，不静默）：
//   - 域 id 不在 SCENARIOS 里；词条形态不合 data/vocabulary.mjs 的规则；
//   - 词条已存在于领域包/工具链（重复补，正常现象，只计数）；
//   - 同一批次内重复（按小写折叠）。

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SCENARIOS, TOOLCHAINS, LEGACY_MARKERS } from "../data/scenarios.mjs";
import { ALIAS_EXTRA, COMMAND_VOCAB, MARKER_EXTRA, TOOLCHAIN_EXTRA } from "../data/vocabulary-data.mjs";
import { checkAlias, checkMarker, checkToolchainLine, mergeUnique } from "../data/vocabulary.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const dirArg = argv.find((a) => a.startsWith("--dir="));
const SRC_DIR = path.resolve(ROOT, dirArg ? dirArg.slice(6) : "data/vocab");
const OUT_FILE = path.resolve(ROOT, "data/vocabulary-data.mjs");

const SECTIONS = ["alias_extra", "marker_extra", "command_vocab", "toolchain_extra"];
const OUT_NAMES = {
  alias_extra: "ALIAS_EXTRA",
  marker_extra: "MARKER_EXTRA",
  command_vocab: "COMMAND_VOCAB",
  toolchain_extra: "TOOLCHAIN_EXTRA",
};

const scenarioById = new Map(SCENARIOS.map((s) => [s.id, s]));
const rejects = [];
const dupsInPack = [];
const merged = { alias_extra: {}, marker_extra: {}, command_vocab: {}, toolchain_extra: {} };
const stats = { files: [], perSection: {} };

function entryOk(section, value) {
  if (section === "alias_extra") return checkAlias(value);
  if (section === "marker_extra") return checkMarker(value);
  if (section === "toolchain_extra") return checkToolchainLine(value);
  if (typeof value !== "string") return { ok: false, reason: "不是字符串" };
  if (/[\n\r]/.test(value)) return { ok: false, reason: "含换行" };
  if (value.length > 120) return { ok: false, reason: "命令过长（>120 字符）" };
  if (!value.trim()) return { ok: false, reason: "空命令" };
  return { ok: true, reason: "" };
}

function existingFor(section, id) {
  const scenario = scenarioById.get(id);
  if (section === "alias_extra") return scenario.aliases;
  if (section === "marker_extra") return [...scenario.markers, ...(LEGACY_MARKERS[id] ?? [])];
  if (section === "command_vocab") return [];
  return TOOLCHAINS[id] ?? [];
}

// 关键：data/scenarios.mjs 在 import 时**已经**把上一次生成的 vocabulary-data 合并进了
// SCENARIOS，所以「现有词条」里混着上一次自己写进去的东西。直接拿它当基线会导致
// 每跑一次就把上一批词条判成重复并丢掉（生成物越跑越少，第二批直接吞掉第三批）。
// 这里把「已注入的部分」减掉，还原出真正的手写基线，构建才是幂等的。
const loaded = {
  alias_extra: ALIAS_EXTRA,
  marker_extra: MARKER_EXTRA,
  command_vocab: COMMAND_VOCAB,
  toolchain_extra: TOOLCHAIN_EXTRA,
};
function baselineFor(section, id) {
  const injected = new Set((loaded[section]?.[id] ?? []).map((x) => String(x).toLocaleLowerCase()));
  return new Set(existingFor(section, id).map((x) => String(x).toLocaleLowerCase()).filter((x) => !injected.has(x)));
}

const files = existsSync(SRC_DIR)
  ? readdirSync(SRC_DIR).filter((f) => f.endsWith(".json")).sort()
  : [];
stats.files = files;

for (const file of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(path.join(SRC_DIR, file), "utf8"));
  } catch (err) {
    rejects.push({ file, where: "(整份)", value: "", reason: `JSON 解析失败：${err.message}` });
    continue;
  }
  for (const section of SECTIONS) {
    const block = data[section];
    if (!block) continue;
    if (typeof block !== "object" || Array.isArray(block)) {
      rejects.push({ file, where: section, value: "", reason: "该节不是对象" });
      continue;
    }
    for (const [id, list] of Object.entries(block)) {
      if (!scenarioById.has(id)) {
        rejects.push({ file, where: `${section}.${id}`, value: "", reason: "未知领域 id" });
        continue;
      }
      if (!Array.isArray(list)) {
        rejects.push({ file, where: `${section}.${id}`, value: "", reason: "不是数组" });
        continue;
      }
      merged[section][id] ??= [];
      const baseline = baselineFor(section, id);
      for (const raw of list) {
        const verdict = entryOk(section, raw);
        if (!verdict.ok) {
          rejects.push({ file, where: `${section}.${id}`, value: String(raw).slice(0, 60), reason: verdict.reason });
          continue;
        }
        const key = String(raw).toLocaleLowerCase();
        if (baseline.has(key)) {
          dupsInPack.push({ file, section, id, value: String(raw) });
          continue;
        }
        if (merged[section][id].some((x) => String(x).toLocaleLowerCase() === key)) continue;
        merged[section][id].push(raw);
      }
    }
  }
}

// 输出：按 SCENARIOS 顺序、每行一条，便于 diff 与 review。
function renderBlock(name, block) {
  const ids = SCENARIOS.map((s) => s.id).filter((id) => (block[id] ?? []).length > 0);
  if (!ids.length) return `export const ${name} = {};\n`;
  const lines = [`export const ${name} = {`];
  for (const id of ids) {
    lines.push(`  ${id}: [`);
    for (const item of block[id]) lines.push(`    ${JSON.stringify(item)},`);
    lines.push("  ],");
  }
  lines.push("};");
  return lines.join("\n") + "\n";
}

const banner = [
  "// 无限五代 · 命中词汇扩展数据（生成物，不要手改）",
  "//",
  "// 改词条 → 改 data/vocab/*.json → 跑 `npm run vocab:build` 重新生成本文件。",
  "// 规则与护栏在 data/vocabulary.mjs；本文件只承载数据，合并进领域包的动作在",
  "// data/scenarios.mjs 里完成。",
  "//",
  `// 源文件：${files.length ? files.join(" · ") : "（无）"}`,
  "",
].join("\n");

const content = [
  banner,
  `export const VOCAB_SOURCES = ${JSON.stringify(files)};\n`,
  renderBlock("ALIAS_EXTRA", merged.alias_extra),
  renderBlock("MARKER_EXTRA", merged.marker_extra),
  renderBlock("COMMAND_VOCAB", merged.command_vocab),
  renderBlock("TOOLCHAIN_EXTRA", merged.toolchain_extra),
].join("\n");

for (const section of SECTIONS) {
  const ids = Object.keys(merged[section]).filter((id) => merged[section][id].length);
  stats.perSection[section] = {
    domains: ids.length,
    entries: ids.reduce((sum, id) => sum + merged[section][id].length, 0),
  };
}

const total = Object.values(stats.perSection).reduce((sum, s) => sum + s.entries, 0);
console.log(`源目录：${path.relative(ROOT, SRC_DIR)}（${files.length} 个文件）`);
for (const [section, s] of Object.entries(stats.perSection)) {
  console.log(`  ${section.padEnd(16)} ${String(s.entries).padStart(4)} 条 · 覆盖 ${s.domains} 域`);
}
console.log(`合计新增 ${total} 条；与领域包重复（已跳过）${dupsInPack.length} 条；不合规 ${rejects.length} 条`);
if (dupsInPack.length) {
  console.log(`\n与领域包重复（前 10）：`);
  for (const d of dupsInPack.slice(0, 10)) console.log(`  - [${d.section}] ${d.id} ← ${d.value}`);
}
if (rejects.length) {
  console.log(`\n不合规词条：`);
  for (const r of rejects) console.log(`  ✗ ${r.file} · ${r.where} · 「${r.value}」 — ${r.reason}`);
}

if (checkOnly) {
  const onDisk = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8") : "";
  if (rejects.length) {
    console.error(`\n✗ vocab --check 失败：${rejects.length} 条词条不合规`);
    process.exit(1);
  }
  if (onDisk !== content) {
    console.error(`\n✗ vocab --check 失败：data/vocabulary-data.mjs 与源文件不一致（跑 npm run vocab:build）`);
    process.exit(1);
  }
  console.log(`\n✓ vocab --check 通过：${total} 条扩展词条合法，生成物与源文件一致`);
  process.exit(0);
}

writeFileSync(OUT_FILE, content);
console.log(`\n✓ 已写入 ${path.relative(ROOT, OUT_FILE)}`);
if (rejects.length) process.exit(1);
