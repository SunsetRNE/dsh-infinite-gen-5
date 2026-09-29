#!/usr/bin/env node
// 一次性子代理实验 · 多臂报告生成器
// 用法：node scripts/oneshot_report.mjs --arms b,a,c [--out docs/oneshot/REPORT.md]
// 读的是 score_oneshot.mjs --out 落盘的 JSON（每臂一份），不重新读产物本体。
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

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
  // 注意：不能拿 `missing` 当「文件不存在」的哨兵 —— 臂 JSON 自己带一个数字字段
  // `missing`（未交题数），两个含义撞名会让「9/12 有缺题」的臂在报告里显示成「缺文件」。
  if (!existsSync(f)) return { tag, absent: true, path: f };
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
  const kernel = {
    b: "v0.36.4（基线·无四查块）",
    a: "v0.36.5（+交付前四查 ①–④）",
    c: "v0.36.6（+四查 ⑤ / ②围栏判据）",
    d: "v0.36.6+（运行态同步门禁 · 活版本头 · 覆盖计分 12/12）",
    e: "v0.36.7+（A1 禁句引用 · A2 标题对象+动作 · A3 形态压缩 · 题库 22 题）",
  };
  for (const a of arms) {
    if (a.absent || a.missing === true) { L.push(`| ${a.tag.toUpperCase()} | ${kernel[a.tag] ?? "?"} | — | 缺 ${a.path} | — | — | — | — | — | — | — | — |`); continue; }
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
  const tags = arms.filter((a) => !a.absent && a.missing !== true).map((a) => a.tag);
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

// --selftest：报告器自身的固定判据（供 verify:oneshot 调用）。
// 盯的是一个真实踩过的坑：loadArm 的「文件不存在」哨兵曾经也叫 missing，
// 与臂 JSON 自带的数字字段 missing（未交题数）撞名 → 9/12 有缺题的臂被渲染成「缺文件」。
export function selftest() {
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };
  const dir = mkdtempSync(join(tmpdir(), "oneshot-report-"));
  mkdirSync(dir, { recursive: true });

  const gone = loadArm("x", dir);
  ok(gone.absent === true && gone.missing === undefined, "缺文件臂：应带 absent 哨兵，且不得带 missing 字段");
  ok(renderReport([gone]).includes("缺 "), "缺文件臂：报告应显式写「缺 <path>」");

  writeFileSync(join(dir, "arm-y.json"), JSON.stringify({
    tag: "y", n: 3, answered: 2, missing: 1, coverage: 0.667, value: 100, valueStrict: 98,
    band: "待改进", dims: { d1: 30, d2: 30, d3: 35, d4: 25, d5: 20, d6: 10 }, items: [],
  }), "utf8");
  const partial = loadArm("y", dir);
  ok(partial.missing === 1 && !partial.absent, "有缺题臂：missing=1 且不得带 absent");
  const md = renderReport([partial]);
  ok(!md.includes("缺 /") && md.includes("100/150"), "有缺题臂：应出分数行，不得渲染成缺文件");
  ok(md.includes("2/3"), "有缺题臂：覆盖列应为 2/3");

  if (fails.length) { console.log(`oneshot_report selftest 失败 ${fails.length} 条：\n  - ${fails.join("\n  - ")}`); return 1; }
  console.log("oneshot_report selftest 通过（缺文件哨兵 / missing 撞名 / 覆盖列 共 5 条）");
  return 0;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === "--selftest") process.exit(selftest());
  main(process.argv);
}
