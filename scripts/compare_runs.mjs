#!/usr/bin/env node
// 跑分双栏对比（pre/post 补丁），供 JBI 报告定稿使用。
// 用法：node scripts/compare_runs.mjs <PRE_DIR> <POST_DIR> [--markdown]
//   读 <dir>/dims-full.json（scripts/score_full_run.mjs 产出）
//   默认打印 JSON 摘要，--markdown 打印报告用的双栏 markdown 片段
import fs from "node:fs";
import path from "node:path";

const [preDir, postDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const asMarkdown = process.argv.includes("--markdown");
if (!preDir || !postDir) {
  console.error("用法: node scripts/compare_runs.mjs <PRE_DIR> <POST_DIR> [--markdown]");
  process.exit(2);
}

const load = (dir) => {
  const p = path.join(dir, "dims-full.json");
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const bytes = {};
  for (const s of j.sources || []) {
    const abs = path.join(dir, s);
    if (fs.existsSync(abs)) {
      if (/T6-0X/.test(s)) {
        const d = path.join(dir, path.dirname(s));
        bytes[s] = fs
          .readdirSync(d)
          .filter((f) => f.startsWith("JB-T6-"))
          .reduce((n, f) => n + fs.statSync(path.join(d, f)).size, 0);
      } else {
        bytes[s] = fs.statSync(abs).size;
      }
    }
  }
  return { ...j, dir, bytes };
};

const pre = load(preDir);
const post = load(postDir);
const out = { pre: preDir, post: postDir, preOk: !!pre, postOk: !!post };
if (pre && post) {
  const D = (j, k) => (j.dims?.[k] ?? 0);
  const dims = ["E", "C", "H", "R", "P", "S", "M", "X", "D", "F", "B"];
  out.dims = dims.map((k) => ({
    dim: k,
    pre: +D(pre, k).toFixed(4),
    post: +D(post, k).toFixed(4),
    delta: +(D(post, k) - D(pre, k)).toFixed(4),
  }));
  out.jbi = {
    pre: { total: +pre.jbi.total.toFixed(4), rate: pre.jbi.rate, strict: +pre.jbi_ifTier1Strict.total.toFixed(4) },
    post: { total: +post.jbi.total.toFixed(4), rate: post.jbi.rate, strict: +post.jbi_ifTier1Strict.total.toFixed(4) },
    deltaPostMinusPre: +(post.jbi.total - pre.jbi.total).toFixed(4),
    target: 15.5,
    hit: post.jbi.total >= 15.5,
  };
  out.strictTier1 = { pre: pre.tier1Perfect_strict, post: post.tier1Perfect_strict };
  out.flip = { pre: pre.tier10Flipped, post: post.tier10Flipped };
  out.coverage = { pre: pre.coverage, post: post.coverage };
  out.bytes = { pre: pre.bytes, post: post.bytes };
  // 逐层平均 itemScore（分层失分面）
  const tierAgg = (j) => {
    const m = new Map();
    for (const r of j.rows || []) {
      const t = r.tier;
      if (!m.has(t)) m.set(t, { n: 0, sum: 0, E: 0, C: 0, H: 0, R: 0 });
      const a = m.get(t);
      a.n++; a.sum += r.itemScore;
      a.E += r.dims.E; a.C += r.dims.C; a.H += r.dims.H; a.R += r.dims.R;
    }
    return m;
  };
  const a = tierAgg(pre), b = tierAgg(post);
  out.tiers = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y).map((t) => {
    const pa = a.get(t), pb = b.get(t);
    const f = (o, k) => (o ? o[k] / o.n : 0);
    return {
      tier: t,
      n: (pb || pa).n,
      preAvg: pa ? +f(pa, "sum").toFixed(3) : null,
      postAvg: pb ? +f(pb, "sum").toFixed(3) : null,
      dE: +(f(pb, "E") - f(pa, "E")).toFixed(3),
      dC: +(f(pb, "C") - f(pa, "C")).toFixed(3),
      dH: +(f(pb, "H") - f(pa, "H")).toFixed(3),
      dR: +(f(pb, "R") - f(pa, "R")).toFixed(3),
    };
  });
}

if (!asMarkdown) {
  console.log(JSON.stringify(out, null, 2));
} else {
  if (!pre || !post) {
    console.log("（缺 pre 或 post 的 dims-full.json，无法出双栏）");
    process.exit(1);
  }
  const L = [];
  L.push("### 全卷双栏（pre = c173ff1e 内核 / post = ff5403eb 内核）");
  L.push("");
  L.push("| 项 | pre 补丁前 | post 补丁后 | Δ |");
  L.push("| --- | --- | --- | --- |");
  for (const d of out.dims) L.push(`| ${d.dim} | ${d.pre} | ${d.post} | ${d.delta >= 0 ? "+" : ""}${d.delta} |`);
  L.push(`| **JBI** | **${out.jbi.pre.total}** | **${out.jbi.post.total}** | **+${out.jbi.deltaPostMinusPre}** |`);
  L.push(`| 得分率 | ${out.jbi.pre.rate}% | ${out.jbi.post.rate}% | — |`);
  L.push(`| tier1 严格口径 | ${out.jbi.pre.strict} | ${out.jbi.post.strict} | — |`);
  L.push("");
  L.push("| 层 | 题数 | pre 均分 | post 均分 | ΔE | ΔC | ΔH | ΔR |");
  L.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const t of out.tiers) {
    L.push(`| T${t.tier} | ${t.n} | ${t.preAvg ?? "—"} | ${t.postAvg ?? "—"} | ${t.dE} | ${t.dC} | ${t.dH} | ${t.dR} |`);
  }
  console.log(L.join("\n"));
}
