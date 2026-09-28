// 无限五代 · 破甲计分对照报告（把「改了什么 → 分数怎么变」钉成一张表）
// 口径：分数一律出自 scripts/score_full_run.mjs（本脚本不自己算分，只读它写出的 dims-full.json）。
// 用法：node scripts/calib_report.mjs <RUN_DIR> [<RUN_DIR> ...] [--md out.md] [--json out.json]
// 典型：node scripts/calib_report.mjs \
//         /root/dsh-infinite-gen-4/ig5-run-post4 \          # 基线
//         /root/dsh-infinite-gen-4/ig5-run-post4-hfix2 \    # 修 H
//         /tmp/ig5-calib-live2                              # 再补校准块
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export const CALIB_REPORT_VERSION = "ig5-calib-report/1";
const DIMS = ["E", "C", "H", "R", "P", "S", "M", "X", "D", "F", "B"];

/** 读一个跑分目录；缺 dims-full.json 的目录会被标 missing 而不是抛错。 */
export function loadRun(dir) {
  const p = join(dir, "dims-full.json");
  if (!existsSync(p)) return { dir, name: basename(dir), missing: true };
  const d = JSON.parse(readFileSync(p, "utf8"));
  const dims = d.dims || {};
  const jbi = typeof d.jbi === "object" && d.jbi !== null ? d.jbi : { total: d.jbi ?? d.jbiTotal, rate: d.rate };
  return {
    dir,
    name: basename(dir),
    missing: false,
    dims,
    frontScore: d.frontScore ?? null,
    backScore: d.backScore ?? null,
    jbi: jbi.total ?? null,
    rate: jbi.rate ?? (jbi.total != null ? (jbi.total / 19.05) * 100 : null),
    coverage: d.coverage?.total ?? null,
    missingItems: d.coverage?.missing?.length ?? null,
    tier1ByScore: d.tier1Perfect_byScore ?? null,
    tier1Strict: d.tier1Perfect_strict ?? null,
    tier10Flipped: d.tier10Flipped ?? null,
    judged: d.judgedPattern ?? null,
  };
}

export function compare(runs) {
  const ok = runs.filter((r) => !r.missing);
  return {
    runs,
    deltas: ok.slice(1).map((cur, i) => {
      const prev = ok[i];
      const d = {};
      for (const k of DIMS) d[k] = Number(((cur.dims[k] ?? 0) - (prev.dims[k] ?? 0)).toFixed(4));
      return {
        from: prev.name, to: cur.name, dims: d,
        front: Number(((cur.frontScore ?? 0) - (prev.frontScore ?? 0)).toFixed(4)),
        back: Number(((cur.backScore ?? 0) - (prev.backScore ?? 0)).toFixed(4)),
        jbi: Number(((cur.jbi ?? 0) - (prev.jbi ?? 0)).toFixed(4)),
        rate: Number(((cur.rate ?? 0) - (prev.rate ?? 0)).toFixed(1)),
      };
    }),
  };
}

export function renderMarkdown(cmp) {
  const L = [];
  L.push("## 破甲计分对照");
  L.push("");
  L.push("| 跑分目录 | 覆盖率 | E | C | H | R | P | S | M | X | D | F | B | front | back | JBI | rate |");
  L.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of cmp.runs) {
    if (r.missing) { L.push(`| ${r.name} | （缺 dims-full.json） | | | | | | | | | | | | | | | |`); continue; }
    const v = (k) => (r.dims[k] == null ? "—" : Number(r.dims[k]).toFixed(4));
    L.push(`| ${r.name} | ${r.coverage ?? "—"}/75 | ${v("E")} | ${v("C")} | ${v("H")} | ${v("R")} | ${v("P")} | ${v("S")} | ${v("M")} | ${v("X")} | ${v("D")} | ${v("F")} | ${v("B")} | ${r.frontScore?.toFixed(4)} | ${r.backScore?.toFixed(4)} | ${r.jbi?.toFixed(4)} | **${r.rate?.toFixed(1)}** |`);
  }
  L.push("");
  L.push("| 变化 | ΔE | ΔC | ΔH | ΔR | Δfront | Δback | ΔJBI | Δrate |");
  L.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const d of cmp.deltas) {
    const s = (x) => (x > 0 ? `+${x}` : `${x}`);
    L.push(`| ${d.from} → ${d.to} | ${s(d.dims.E)} | ${s(d.dims.C)} | ${s(d.dims.H)} | ${s(d.dims.R)} | ${s(d.front)} | ${s(d.back)} | ${s(d.jbi)} | ${s(d.rate)} |`);
  }
  L.push("");
  L.push("判据：分数线由 `scripts/score_full_run.mjs` 写出，`rate = JBI / 19.05 × 100`；");
  L.push("H 每降 0.6、EC 每涨 1.0，都会 1:1 折算进 front；back 只由 F/B 决定（×0.25 进 JBI）。");
  return L.join("\n");
}

function main(argv) {
  const args = argv.slice(2);
  // 只收「不以 -- 开头、且紧跟在 --md/--json 之后的那个值」当目录 —— 否则输出文件路径会被当成跑分目录，
  // 在表里多出两行「缺 dims-full.json」的噪声（实测踩过）。
  const valOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const skips = new Set([valOf("--md"), valOf("--json")].filter(Boolean));
  const dirs = args.filter((a) => !a.startsWith("--") && !skips.has(a));
  if (!dirs.length) { console.error("用法: node scripts/calib_report.mjs <RUN_DIR> [...] [--md out.md] [--json out.json]"); process.exit(2); }
  const cmp = compare(dirs.map(loadRun));
  console.log(renderMarkdown(cmp));
  const md = args.includes("--md") ? args[args.indexOf("--md") + 1] : null;
  if (md) { writeFileSync(md, renderMarkdown(cmp), "utf8"); console.log(`\nMD → ${md}`); }
  const js = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
  if (js) { writeFileSync(js, JSON.stringify(cmp, null, 2), "utf8"); console.log(`JSON → ${js}`); }
}

if (process.argv[1]?.endsWith("calib_report.mjs")) main(process.argv);
