#!/usr/bin/env node
// 一次性子代理实验 · 多臂报告生成器
// 用法：node scripts/oneshot_report.mjs --arms b,a,c [--out docs/oneshot/REPORT.md]
// 读的是 score_oneshot.mjs --out 落盘的 JSON（每臂一份），不重新读产物本体。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SCALE = { max: 150, floor: 90, target: [120, 130], excellent: 145 };

export function bandOf(value) {
  if (value >= SCALE.excellent) return "优秀";
  if (value > SCALE.target[1]) return "良好";
  if (value >= SCALE.target[0]) return "达标";
  if (value > SCALE.floor) return "待改进";
  return "不合格";
}

export function loadArm(tag, base = "docs/oneshot") {
  const f = resolve(`${base}/arm-${tag}.json`);
  if (!existsSync(f)) return { tag, missing: true, path: f };
  return { tag, path: f, ...JSON.parse(readFileSync(f, "utf8")) };
}

export function renderReport(arms) {
  const L = [];
  L.push("# 一次性子代理实验 · 多臂对比（150 分制）");
  L.push("");
  L.push(`口径：满分 ${SCALE.max}（上限）· 能力下限 ${SCALE.floor}（≤${SCALE.floor} 不合格）· 达标 ${SCALE.target[0]}–${SCALE.target[1]} · 优秀 ≥${SCALE.excellent}`);
  L.push("");
  L.push("| 臂 | 内核 | 覆盖 | 主口径分 | 分档 | strict 口径 | D1 | D2 | D3 | D4 | D5 | D6 |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  const kernel = { b: "v0.36.4（基线·无四查块）", a: "v0.36.5（+交付前四查 ①–④）", c: "v0.36.6（+四查 ⑤ / ②围栏判据）" };
  for (const a of arms) {
    if (a.missing) { L.push(`| ${a.tag.toUpperCase()} | ${kernel[a.tag] ?? "?"} | — | 缺 ${a.path} | — | — | — | — | — | — | — | — |`); continue; }
    const d = a.dims ?? {};
    const cov = a.coverage != null ? `${a.answered}/${a.n}` : "—";
    const st = a.valueStrict != null ? `${a.valueStrict}/150（${bandOf(a.valueStrict)}）` : "—";
    L.push(`| ${a.tag.toUpperCase()} | ${kernel[a.tag] ?? "?"} | ${cov} | **${a.value}/150** | ${a.band} | ${st} | ${d.d1 ?? "—"} | ${d.d2 ?? "—"} | ${d.d3 ?? "—"} | ${d.d4 ?? "—"} | ${d.d5 ?? "—"} | ${d.d6 ?? "—"} |`);
  }
  L.push("");
  L.push("维度：D1 交付形态 30 · D2 可跑实现 30 · D3 校准四态 35 · D4 评分接口四行 25 · D5 零残留 20 · D6 边界处理 10（表内为已答均分，缺题按 0 计进主口径分）。");
  L.push("");
  const byId = new Map();
  for (const a of arms) for (const it of a.items ?? []) {
    const row = byId.get(it.id) ?? { id: it.id, dimension: it.dimension, expect: it.expect };
    row[a.tag] = it.value;
    byId.set(it.id, row);
  }
  const tags = arms.filter((a) => !a.missing).map((a) => a.tag);
  L.push(`| 题 | 域 | 期望 | ${tags.map((t) => t.toUpperCase()).join(" | ")} | Δ(${tags[tags.length - 1]}-${tags[0]}) |`);
  L.push(`|---|---|---|${tags.map(() => "---").join("|")}|---|`);
  for (const row of [...byId.values()].sort((x, y) => x.id.localeCompare(y.id))) {
    const vals = tags.map((t) => (row[t] == null ? "—" : row[t]));
    const first = row[tags[0]], last = row[tags[tags.length - 1]];
    const d = first != null && last != null ? (last - first >= 0 ? `+${last - first}` : `${last - first}`) : "—";
    L.push(`| ${row.id} | ${row.dimension ?? ""} | ${row.expect ?? ""} | ${vals.join(" | ")} | ${d} |`);
  }
  L.push("");
  return L.join("\n");
}

function main(argv) {
  const args = argv.slice(2);
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const tagList = (get("--arms") ?? "b,a,c").split(",").map((s) => s.trim()).filter(Boolean);
  const out = get("--out");
  const arms = tagList.map((t) => loadArm(t));
  const md = renderReport(arms);
  if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(resolve(out), md + "\n"); console.log(`报告 → ${resolve(out)}`); }
  else process.stdout.write(md + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
