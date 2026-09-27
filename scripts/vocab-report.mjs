#!/usr/bin/env node
// 无限五代 · 命中词汇表报告（人看的）
//
//   node scripts/vocab-report.mjs            # 终端里看：逐域深度表 + 共用词 + 歧义词
//   node scripts/vocab-report.mjs --md       # Markdown 表格（可以直接贴进文档）
//   node scripts/vocab-report.mjs --domain=web  # 只看一个域（列它的命中词全表）
//
// 这份报告回答的是自检回答不了的问题：「词表现在长什么样、哪个域薄、哪些词会抢路由」。
// verify_vocab.mjs 管对错，这份管可读。
import { DOMAIN_FAMILIES, DOMAIN_LABELS, DOMAIN_MARKERS, MARKER_INDEX, SCENARIOS, scenarioIndexText } from "../data/scenarios.mjs";
import { COMMAND_VOCAB, MARKER_EXTRA } from "../data/vocabulary-data.mjs";
import { CROSS_FAMILY_ALLOW, TRAP_ALLOW } from "../data/vocabulary.mjs";

const argv = process.argv.slice(2);
const asMd = argv.includes("--md");
const only = argv.find((a) => a.startsWith("--domain="))?.slice(9) ?? "";

const rows = SCENARIOS.map((s) => ({
  id: s.id,
  label: s.label,
  family: s.family,
  markers: (DOMAIN_MARKERS[s.id] ?? []).length,
  extra: (MARKER_EXTRA[s.id] ?? []).length,
  aliases: s.aliases.length,
  commands: (COMMAND_VOCAB[s.id] ?? []).length,
  toolchain: (s.toolchain ?? []).length,
}));

if (only) {
  const row = rows.find((r) => r.id === only);
  if (!row) {
    console.error(`未知领域 id：${only}`);
    process.exit(1);
  }
  const markers = DOMAIN_MARKERS[only] ?? [];
  if (asMd) {
    console.log(`### ${row.label}（${row.id}）命中词全表（${markers.length} 条）\n`);
    console.log(markers.map((m) => `\`${m}\``).join(" · "));
  } else {
    console.log(`${row.label}（${row.id} · ${row.family}）`);
    console.log(`命中词 ${markers.length} 条（其中扩展 ${row.extra} 条）· 别名 ${row.aliases} · 命令 ${row.commands} · 工具链 ${row.toolchain}\n`);
    for (const m of markers) {
      const shared = MARKER_INDEX.byMarker.get(m)?.domains ?? [];
      const tag = shared.length > 1 ? `  ← 共用: ${shared.join(",")}` : "";
      console.log(`  ${m}${tag}`);
    }
  }
  process.exit(0);
}

const index = scenarioIndexText();
const indexBytes = Buffer.byteLength(index, "utf8");
const perFamily = {};
for (const r of rows) (perFamily[r.family] ??= []).push(r);

if (asMd) {
  console.log(`## 命中词表深度（${rows.length} 域）\n`);
  console.log("| 域 | 族 | 命中词 | 其中扩展 | 别名 | 命令 | 工具链 |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows.slice().sort((a, b) => a.family.localeCompare(b.family) || b.markers - a.markers)) {
    console.log(`| ${r.id} · ${r.label} | ${r.family} | ${r.markers} | ${r.extra} | ${r.aliases} | ${r.commands} | ${r.toolchain} |`);
  }
  console.log(`\n合计：命中词 ${MARKER_INDEX.stats.markers} 个（共用 ${MARKER_INDEX.stats.shared} · 跨族 ${MARKER_INDEX.stats.crossFamily}）· 索引 ${indexBytes} B ≈ ${Math.round(indexBytes / 3.7)} tokens\n`);
  console.log("### 跨族共用词（都已在 CROSS_FAMILY_ALLOW 签字）\n");
  for (const e of MARKER_INDEX.entries.filter((x) => x.crossFamily)) {
    console.log(`- \`${e.marker}\` → ${e.domains.join(" / ")}：${CROSS_FAMILY_ALLOW[e.marker] ?? "（缺签字！）"}`);
  }
  if (Object.keys(TRAP_ALLOW).length) {
    console.log("\n### 已签字接受的英文词碰撞\n");
    for (const [m, why] of Object.entries(TRAP_ALLOW)) console.log(`- \`${m}\`：${why}`);
  }
  process.exit(0);
}

console.log(`无限五代 · 命中词表报告（${rows.length} 域 · ${MARKER_INDEX.stats.markers} 个 marker）\n`);
for (const [family, list] of Object.entries(perFamily)) {
  console.log(`[${family}]`);
  for (const r of list.slice().sort((a, b) => b.markers - a.markers)) {
    const bar = "█".repeat(Math.max(1, Math.round(r.markers / 8)));
    console.log(`  ${r.id.padEnd(17)} ${String(r.markers).padStart(3)} ${bar}`);
  }
  console.log("");
}

const thin = rows.slice().sort((a, b) => a.markers - b.markers).slice(0, 6);
console.log(`最薄的 6 个域（含扩展量）：${thin.map((r) => `${r.id}:${r.markers}(+${r.extra})`).join(" ")}`);
const noTool = rows.filter((r) => r.toolchain === 0).map((r) => r.id);
console.log(`无工具链的域（${noTool.length}）：${noTool.join(" ")}`);

console.log(`\n跨族共用词（${MARKER_INDEX.stats.crossFamily}）：`);
for (const e of MARKER_INDEX.entries.filter((x) => x.crossFamily)) {
  console.log(`  ${e.marker.padEnd(14)} → ${e.domains.join(" / ")}  ｜ ${CROSS_FAMILY_ALLOW[e.marker] ?? "缺签字"}`);
}

const collisions = [];
for (const e of MARKER_INDEX.entries) {
  if (e.marker in TRAP_ALLOW) collisions.push(`${e.marker}（${TRAP_ALLOW[e.marker]}）`);
}
if (collisions.length) console.log(`\n已签字接受的英文碰撞：${collisions.join(" ｜ ")}`);

console.log(`\n索引 ${indexBytes} B ≈ ${Math.round(indexBytes / 3.7)} tokens（每域两行：别名行 + 命中行）`);
console.log(`词形分布：${Object.entries(MARKER_INDEX.stats.byKind).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
console.log(`族标签：${Object.entries(DOMAIN_FAMILIES).length} 域已归属；例 ${DOMAIN_LABELS.web} / ${DOMAIN_LABELS.re}`);
