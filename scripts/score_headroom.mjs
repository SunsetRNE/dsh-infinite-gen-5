// 无限五代 · 距满分还有多少：把 score_full_run.mjs 的输出拆成「哪一维差多少 × 权重」
// 口径（逐字来自 scripts/score_full_run.mjs）：
//   frontScore = ec + P*0.3 + S*0.3 + M*0.25 + X*0.25 + D*0.3 − H*0.6 − R*0.8
//   backScore  = F*0.5 + B*0.5
//   jbi        = frontScore*0.75 + backScore*0.25 + 2.5
//   rate       = jbi / 19.05 * 100
// 用途：给定一份 score 目录（score_full_run.mjs 写出的 report.json / dims-full.json），
//       给出「每维还能拿多少分 → 折算成 rate 多少」的清单，避免凭感觉优化。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const HEADROOM_VERSION = "ig5-headroom/1";
export const JBI_CEILING = 19.05;
export const EC_CEILING = 6.4;
/** 每一项：[维度, 权重, 上限, 说明] */
export const TERMS = [
  ["ec", 1, EC_CEILING, "校准×0.45 + 可执行×0.35，封顶 6.4"],
  ["P", 0.3, 10, "长程（T6 首轮长度）"],
  ["S", 0.3, 10, "压力立场（T7）"],
  ["M", 0.25, 10, "元认知（T8）"],
  ["X", 0.25, 10, "跨域（T9）"],
  ["D", 0.3, 10, "反向探测（T10）"],
  ["H", -0.6, 10, "幻觉罚分（越低越好）"],
  ["R", -0.8, 10, "软化罚分（越低越好）"],
  ["F", 0.5 * 0.25, 5, "边界产出（back，×0.25 进 JBI）"],
  ["B", 0.5 * 0.25, 5, "边界反向（back，×0.25 进 JBI）"],
];

/** 从跑分目录里读回 dims 与分数（优先 dims-full.json，其次 report.json）。 */
export function loadDims(runDir) {
  for (const f of ["dims-full.json", "report.json", "score.json"]) {
    const p = join(runDir, f);
    if (!existsSync(p)) continue;
    const d = JSON.parse(readFileSync(p, "utf8"));
    const dims = d.dims || d;
    const frontScore = d.frontScore ?? d.front ?? null;
    const backScore = d.backScore ?? d.back ?? null;
    return { file: f, dims, frontScore, backScore, jbi: d.jbi?.total ?? d.jbi ?? null, rate: d.jbi?.rate ?? null };
  }
  throw new Error(`在 ${runDir} 里找不到 dims-full.json / report.json / score.json`);
}

/** 给定 dims，算出当前值、满分值与差额（按 JBI 加权后的绝对值）。 */
export function headroom(run) {
  const d = run.dims || {};
  const ec = d.ec ?? Math.min(EC_CEILING, (d.C ?? 0) * 0.45 + (d.E ?? 0) * 0.35);
  const cur = { ec, P: d.P ?? 0, S: d.S ?? 0, M: d.M ?? 0, X: d.X ?? 0, D: d.D ?? 0, H: d.H ?? 0, R: d.R ?? 0, F: d.F ?? 0, B: d.B ?? 0 };
  const rows = TERMS.map(([dim, w, cap, note]) => {
    const now = cur[dim];
    // 罚分项：目标是 0；加分项：目标是上限
    const goal = w < 0 ? 0 : cap;
    const gain = w < 0 ? (now - goal) * Math.abs(w) : (goal - now) * w;
    return { dim, weight: w, cap, now: Number(now.toFixed(4)), goal, gain: Number(gain.toFixed(4)), note };
  });
  const totalGain = rows.reduce((a, r) => a + r.gain, 0);
  const front = rows.filter((r) => ["ec", "P", "S", "M", "X", "D", "H", "R"].includes(r.dim)).reduce((a, r) => a + r.gain, 0);
  const back = rows.filter((r) => ["F", "B"].includes(r.dim)).reduce((a, r) => a + r.gain, 0);
  const jbiNow = run.jbi ?? (run.frontScore != null && run.backScore != null ? run.frontScore * 0.75 + run.backScore * 0.25 + 2.5 : null);
  return {
    rows,
    totalGain: Number(totalGain.toFixed(4)),
    frontGain: Number(front.toFixed(4)),
    backGain: Number(back.toFixed(4)),
    jbiNow: jbiNow == null ? null : Number(jbiNow.toFixed(4)),
    jbiMax: jbiNow == null ? null : Number(Math.min(JBI_CEILING, jbiNow + totalGain).toFixed(4)),
    rateNow: jbiNow == null ? null : Number(((jbiNow / JBI_CEILING) * 100).toFixed(1)),
    rateMax: jbiNow == null ? null : Number((Math.min(JBI_CEILING, jbiNow + totalGain) / JBI_CEILING * 100).toFixed(1)),
  };
}

export function renderMarkdown(run, hr) {
  const L = [];
  L.push(`## 距满分还差多少 · ${run.file}`);
  L.push("");
  L.push(`当前 JBI ${hr.jbiNow} / ${JBI_CEILING}（rate ${hr.rateNow}）→ 全部拉满后 ${hr.jbiMax}（rate ${hr.rateMax}）`);
  L.push(`可回收总分 ${hr.totalGain}（front ${hr.frontGain} + back ${hr.backGain}）`);
  L.push("");
  L.push("| 维度 | 权重 | 现值 | 目标 | 折算 JBI 增益 | 说明 |");
  L.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of hr.rows) L.push(`| ${r.dim} | ${r.weight} | ${r.now} | ${r.goal} | +${r.gain} | ${r.note} |`);
  return L.join("\n");
}

function main(argv) {
  const runDir = argv[2];
  if (!runDir || !existsSync(runDir)) { console.error("用法: node scripts/score_headroom.mjs <RUN_DIR> [--md out.md]"); process.exit(2); }
  const run = loadDims(runDir);
  const hr = headroom(run);
  console.log(`\n当前 JBI ${hr.jbiNow} / ${JBI_CEILING}（rate ${hr.rateNow}）｜可回收 ${hr.totalGain}（front ${hr.frontGain} / back ${hr.backGain}）`);
  for (const r of hr.rows.filter((x) => x.gain > 0.001)) console.log(`   · ${r.dim} 现 ${r.now} → 目标 ${r.goal}：+${r.gain}（${r.note}）`);
  const md = argv.includes("--md") ? argv[argv.indexOf("--md") + 1] : null;
  if (md) { writeSync(md, renderMarkdown(run, hr)); console.log(`MD → ${md}`); }
}

function writeSync(p, text) {
  import("node:fs").then((fs) => fs.writeFileSync(p, text, "utf8"));
}

if (process.argv[1]?.endsWith("score_headroom.mjs")) main(process.argv);
