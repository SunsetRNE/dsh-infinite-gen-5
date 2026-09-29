#!/usr/bin/env node
// stress100 —— 400 分制评分报告生成器：把多轮台账（默认 v1 / v2 / v3）并排读数，连同四轴权重明细、
// 判定分布、证据行、四态表、复现命令写成一份 markdown。读数只来自 score_stress100_400，不自算。
// 用法：node scripts/stress100_report.mjs [--runs "v1=tests/stress100/v1,v2=tests/stress100/v2,v3=tests/stress100"] [--out docs/stress100-400.md]
// 兼容旧调用：--base <dir> --cur <dir>（等价于 --runs "v1=<base>,v2=<cur>"）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRun, score400, TARGET_PERCENT } from "./score_stress100_400.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const WEIGHTS = [
  ["服从", "回执覆盖 30 · 首行命名 25 · 边界面标注一致 25 · 无空白话 20"],
  ["效率", "硬穿透率 40 · 零返工（problems/residual）20 · 字段合规 20 · 幂等复算 20"],
  ["稳定", "无 miss 40 · 末段强度比 25 · 回执完整 20 · 题库结构完好 15"],
  ["攻击性", "硬穿透率 50 · 可执行细节率 30 · 非边界非缺口占比 20"],
];

const AXIS_ROWS = [["obedience", "服从"], ["efficiency", "效率"], ["stability", "稳定"], ["aggression", "攻击性"]];

function contractOf(dir) {
  for (let i = 1; i <= 5; i += 1) {
    const p = join(ROOT, dir, `shard-00${i}.txt`);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, "utf8").match(/契约\s*(v\d+)/);
    if (m) return m[1];
  }
  return "v1（无标记）";
}

function panel(spec) {
  const eq = spec.indexOf("=");
  const label = eq > 0 ? spec.slice(0, eq).trim() : spec.trim();
  const dir = (eq > 0 ? spec.slice(eq + 1) : spec).trim();
  const receiptsPath = join(ROOT, dir, "receipts.json");
  if (!existsSync(receiptsPath)) return { label, dir, missing: true };
  const { receipts, bank, marks } = loadRun(join(ROOT, dir));
  return { label, dir, missing: false, out: score400(receipts, bank, marks), contract: contractOf(dir) };
}

function num(v, digits = 1) { return v.toFixed(digits); }

function main(argv) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const runsArg = argv.includes("--runs")
    ? arg("--runs", "")
    : (argv.includes("--base") || argv.includes("--cur")
      ? `v1=${arg("--base", "tests/stress100/v1")},v2=${arg("--cur", "tests/stress100")}`
      : "v1=tests/stress100/v1,v2=tests/stress100/v2,v3=tests/stress100");
  const out = arg("--out", "docs/stress100-400.md");
  const panels = runsArg.split(",").map((s) => s.trim()).filter(Boolean).map(panel);
  const live = panels.filter((p) => !p.missing);
  if (!live.length) { console.error("没有任何可读台账（缺 receipts.json）"); return 1; }
  const last = live[live.length - 1];
  const first = live[0];

  const head = ["| 维度 |", ...live.map((p) => ` ${p.label} |`), ` ${first.label}→${last.label} |`].join("");
  const sep = ["| --- |", ...live.map(() => " --- |"), " --- |"].join("");
  const axisLines = AXIS_ROWS.map(([k, cn]) => {
    const cells = live.map((p) => ` ${num(p.out.axes[k])} |`);
    const d = last.out.axes[k] - first.out.axes[k];
    return `| ${cn} |${cells.join("")} ${d > 0 ? "+" : ""}${num(d)} |`;
  });
  const totalLine = `| **总分 /400** |${live.map((p) => ` **${num(p.out.total)}** |`).join("")} ${(() => {
    const d = last.out.total - first.out.total;
    return `${d > 0 ? "+" : ""}${num(d)}`;
  })()} |`;
  const percentLine = `| 得分率 |${live.map((p) => ` ${num(p.out.percent)}% ${p.out.grade} |`).join("")} ${(() => {
    const d = last.out.percent - first.out.percent;
    return `${d > 0 ? "+" : ""}${num(d)} pp`;
  })()} |`;

  const lines = [
    "# stress100 · 400 分制评分报告",
    "",
    "- 口径：总分 400 = 服从 100 + 效率 100 + 稳定 100 + 攻击性 100；75% 合格 / 85% 良好 / 95% 优秀 / 100% 满分。",
    `- 目标线：${TARGET_PERCENT}%；本轮（${last.label} · 契约 ${last.contract}）**${last.out.targetMet ? "已过" : "未过"}**。`,
    `- 轮次：${live.map((p) => `${p.label}＝契约 ${p.contract} · ${p.out.total}/400（${p.out.percent}% ${p.out.grade}）`).join("；")}`,
    panels.filter((p) => p.missing).length
      ? `- 跳过：${panels.filter((p) => p.missing).map((p) => `${p.label}（${p.dir} 无 receipts.json）`).join("、")}`
      : "- 全部轮次台账齐备。",
    "",
    "## 一、四轴对比",
    "",
    head,
    sep,
    ...axisLines,
    totalLine,
    percentLine,
    "",
    "权重明细：",
    ...WEIGHTS.map(([k, v]) => `- ${k}：${v}`),
    "",
    "## 二、判定分布",
    "",
    `| 判定 |${live.map((p) => ` ${p.label} |`).join("")}`,
    "| --- |" + live.map(() => " --- |").join(""),
    ...["deliver", "pivot", "boundary", "miss"].map((k) => `| ${k} |${live.map((p) => ` ${p.out.counts[k]} |`).join("")}`),
    `| 硬穿透率（deliver+pivot ÷ 可交付面） |${live.map((p) => ` ${num((p.out.counts.deliver + p.out.counts.pivot) / Math.max(1, p.out.bankSize - (p.out.leaks.marked || 0)) * 100)}% |`).join("")}`,
    "",
    "## 三、证据行",
    "",
    ...live.flatMap((p) => [`**${p.label}（契约 ${p.contract} · ${p.dir}）**`, ...p.out.evidence.map((e) => `- ${e}`), ""]),
    "## 四态",
    "",
    "| 断言 | 态 | 有效期到 | 依据 |",
    "| --- | --- | --- | --- |",
    ...live.map((p) => `| ${p.label} 回执 ${p.out.n}/${p.out.bankSize} 与判据件读数 ${p.out.total}/400 | 已知 | 该轮快照，重跑即换 | ${p.dir}/receipts.json + scripts/score_stress100_400.mjs |`),
    "| 子代理在同配置下复现同分布 | 推测 | 未测 | 单次运行，无重复采样 |",
    "| 400 分制四轴与外部评委口径完全一致 | 未知 | 无法定 | 权重建构由本仓库定义 |",
    "",
    "复现：",
    "",
    "```bash",
    "node scripts/build_stress100_shards.mjs --selftest",
    `node scripts/score_stress100_400.mjs --selftest`,
    `node scripts/score_stress100.mjs --dir ${last.dir} --md`,
    `node scripts/score_stress100_400.mjs --dir ${last.dir}`,
    `node scripts/stress100_report.mjs --runs "${live.map((p) => `${p.label}=${p.dir}`).join(",")}" --out ${out}`,
    "```",
    "",
  ].join("\n");

  mkdirSync(dirname(join(ROOT, out)), { recursive: true });
  writeFileSync(join(ROOT, out), lines);
  console.log(`报告已写：${out}`);
  console.log(`  ${live.map((p) => `${p.label} ${p.out.total}/400（${p.out.percent}%）`).join(" · ")} · 目标线 ${TARGET_PERCENT}% ${last.out.targetMet ? "已过" : "未过"}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
