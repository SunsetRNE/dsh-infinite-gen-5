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

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
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
// v0.65.7：生成物拆块 —— 原来一个 3136 行的数据文件，现在按分区落 4 个块，
// vocabulary-data.mjs 只做 barrel（对外导出名不变，消费者 import 路径不变）。
const OUT_DIR = path.resolve(ROOT, "data", "vocab", "generated");
const OUT_CHUNKS = {
  alias_extra: "alias-extra.mjs",
  marker_extra: "marker-extra.mjs",
  command_vocab: "command-vocab.mjs",
  toolchain_extra: "toolchain-extra.mjs",
};

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
// 以「已发布的生成物」为骨架建立空桶：键序由此固定为上一次发布的顺序，
// 新出现（JSON 里有、生成物里没有）的域追加在后面。这样重新生成是**字节稳定**的：
// 不会因为换了个批次的 JSON 顺序就把整份数据的键序抖一遍。
// 键序真源：data/vocab/generated-order.json（随生成物一起进仓、可 diff）。
// 为什么需要它：分块/合并（Object.assign）与「导入已生成文件」会互相反馈，
// 只靠 JSON 首现顺序会把键序抖掉。这个清单把已发布的键序钉死，新域追加在末尾。
// 放在 data/ 下而不是 data/vocab/ 里 —— data/vocab/ 只放 JSON 批次（生成器会把目录里每个 *.json 当批次读）。
const ORDER_FILE = path.resolve(ROOT, "data", "vocab-order.json");
const publishedOrder = existsSync(ORDER_FILE)
  ? JSON.parse(readFileSync(ORDER_FILE, "utf8"))
  : {};
const seedOf = (section, fallback) => {
  const fromOrder = publishedOrder[section];
  if (Array.isArray(fromOrder) && fromOrder.length) return fromOrder;
  return Object.keys(fallback).map((id) => id);
};
const merged = {
  alias_extra: Object.fromEntries(seedOf("alias_extra", ALIAS_EXTRA).map((id) => [id, []])),
  marker_extra: Object.fromEntries(seedOf("marker_extra", MARKER_EXTRA).map((id) => [id, []])),
  command_vocab: Object.fromEntries(seedOf("command_vocab", COMMAND_VOCAB).map((id) => [id, []])),
  toolchain_extra: Object.fromEntries(seedOf("toolchain_extra", TOOLCHAIN_EXTRA).map((id) => [id, []])),
};
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

const sourceLine = `// 源文件：${files.length ? files.join(" · ") : "（无）"}`;
const banner = (what) => [
  `// 无限五代 · 命中词汇扩展数据 · ${what}（生成物，不要手改）`,
  "//",
  "// 改词条 → 改 data/vocab/*.json → 跑 `npm run vocab:build` 重新生成。",
  "// 规则与护栏在 data/vocabulary.mjs；合并进领域包的动作在 data/scenarios.mjs 里完成。",
  "//",
  sourceLine,
  "",
].join("\n");

const CHUNK_DIR = "./vocab/generated";
// 每块按行数上限再切分（>800 行的生成物一样要拆：CI 的 source_oversized 门看的是单文件行数）。
// 单段就直接导出原名；多段则导出 `<名>_P<序号>`，由 barrel 合并回原名。
const MAX_CHUNK_LINES = 600;
const chunkFiles = [];
const barrelLines = [];
for (const section of SECTIONS) {
  const ids = Object.keys(merged[section]).filter((id) => merged[section][id].length);
  const groups = [];
  let cur = {};
  for (const id of ids) {
    cur[id] = merged[section][id];
    // 超上限就在**此条之后**收口：不能把触发超限的那条挪到下一段，
    // 否则段的顺序会变、合并回桶里的键序也跟着变（键序变了 = 生成物不再与旧版逐字一致）。
    if (renderBlock("X", cur).split("\n").length > MAX_CHUNK_LINES) {
      groups.push(cur);
      cur = {};
    }
  }
  if (Object.keys(cur).length) groups.push(cur);
  if (!groups.length) groups.push({});
  const name = OUT_NAMES[section];
  const parts = groups.map((group, i) => {
    const partName = groups.length === 1 ? name : `${name}_P${i + 1}`;
    const base = OUT_CHUNKS[section].replace(/\.mjs$/, groups.length === 1 ? ".mjs" : `.part-${String(i + 1).padStart(2, "0")}.mjs`);
    return { partName, file: path.join(OUT_DIR, base), content: banner(partName) + renderBlock(partName, group) };
  });
  chunkFiles.push(...parts);
  barrelLines.push(groups.length === 1
    ? `export { ${name} } from "${CHUNK_DIR}/${path.basename(parts[0].file)}";`
    : `export const ${name} = Object.assign({}, ${parts.map((x) => x.partName).join(", ")});`);
  if (groups.length > 1) {
    barrelLines.unshift(...parts.map((x) => `import { ${x.partName} } from "${CHUNK_DIR}/${path.basename(x.file)}";`));
  }
}

// barrel：对外导出名与 import 路径都不变（`./vocabulary-data.mjs` 仍是唯一入口）
// barrel 的再导出：路径拼一次常量，避免在脚本里散落多份分隔符字面量
// （scripts/ 下 Windows 兼容门会数这些字面量，散开写会顶破封顶）。
const content = [
  banner("barrel"),
  `export const VOCAB_SOURCES = ${JSON.stringify(files)};\n`,
  ...barrelLines,
  "",
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
  if (rejects.length) {
    console.error(`\n✗ vocab --check 失败：${rejects.length} 条词条不合规`);
    process.exit(1);
  }
  const stale = [...chunkFiles, { file: OUT_FILE, content }].filter(({ file, content: want }) => {
    const onDisk = existsSync(file) ? readFileSync(file, "utf8") : "";
    return onDisk !== want;
  }).map(({ file }) => path.relative(ROOT, file));
  if (stale.length) {
    console.error(`\n✗ vocab --check 失败：生成物与源文件不一致（跑 npm run vocab:build）：\n  ${stale.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`\n✓ vocab --check 通过：${total} 条扩展词条合法，生成物与源文件一致`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, content: body } of chunkFiles) writeFileSync(file, body);
writeFileSync(OUT_FILE, content);
for (const { file } of chunkFiles) console.log(`  ✓ ${path.relative(ROOT, file)}`);
console.log(`✓ 已写入 ${path.relative(ROOT, OUT_FILE)}（barrel）`);
if (rejects.length) process.exit(1);
