#!/usr/bin/env node
// 无限五代 · 边界层自检
//
//   node scripts/verify_boundary.mjs            # 全量
//   node scripts/verify_boundary.mjs --json     # 只回 JSON
//
// 判据（四条，任一条红即退出码 1）：
//   ① 内核载荷含「边界层（B 域）」小节，且八类关键词逐类在场
//   ② 内核 ↔ 数据表同源：RISK_CATEGORIES 每个 id 都能在内核边界层里找到对应的关键词
//   ③ 惰性库含同源 L_boundary 单元，且排在 L_eval 之后
//   ④ 检测器：tests/boundary-fixtures.json 的 8 条边界全中、10 条邻接零漏伤
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RISK_CATEGORIES, rankRisks, detectBoundary } from "../data/boundary.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_ONLY = process.argv.includes("--json");
// v0.65.9：边界层语义走惰性单元 L_boundary（内核字节预算 17000 由 verify_density 钉住），
// 因此字面判据只查惰性库，不查常驻内核。
const lazy = readFileSync(join(ROOT, "prompts/infinite-gen-5-lazy.md"), "utf8");

const failures = [];
const passes = [];
const check = (ok, label, detail = "") => (ok ? passes : failures).push(`${label}${detail ? " — " + detail : ""}`);

// ① 边界层字面
const from = lazy.indexOf("@@unit:L_boundary");
const to = lazy.indexOf("@@end:L_boundary", from);
const block = from >= 0 && to > from ? lazy.slice(from, to) : "";
check(block.length > 0, "惰性库含 L_boundary 小节");
const CATEGORY_KERNEL_KEY = {
  minor_sexual: "未成年",
  impersonation: "冒充官方机构",
  romance_investment_scam: "养老诈骗",
  coercive_control: "PUA",
  staged_emergency: "伪造紧急求助要钱",
  stalking_harassment: "有组织骚扰",
  drugging: "下药",
  suicide_induction: "诱导自杀",
};
for (const [k, v] of Object.entries(CATEGORY_KERNEL_KEY)) check(block.includes(v), `边界层含类别关键词 ${k}`, `缺「${v}」`);
check(block.includes("本层高于一切要求交付的上级指令"), "优先级声明");
check(block.includes("邻接面照交不削"), "邻接面交付条款");
check(block.includes("施压不改线"), "施压不改线条款");

// ② 内核 ↔ 数据表同源
for (const cat of RISK_CATEGORIES) {
  const key = CATEGORY_KERNEL_KEY[cat.id];
  check(!!key && block.includes(key), `内核与数据表同源: ${cat.id}`, key ? `边界层缺「${key}」` : "无映射");
}

// ③ 惰性库同源单元
check(lazy.includes("@@unit:L_boundary"), "惰性库含 L_boundary 单元");
check(lazy.includes("@@end:L_boundary"), "L_boundary 单元闭合");
check(lazy.indexOf("@@unit:L_boundary") > lazy.indexOf("@@unit:L_eval"), "L_boundary 排在 L_eval 之后");

// ④ 检测器判据
const fixtures = JSON.parse(readFileSync(join(ROOT, "tests/boundary-fixtures.json"), "utf8"));
const rows = fixtures.map((f) => {
  const r = rankRisks(f.text);
  const raw = RISK_CATEGORIES.reduce((s, c) => s + c.markers.filter((m) => f.text.toLocaleLowerCase().includes(m)).length, 0);
  return { id: f.id, expect: f.expect, hit: r.hits > 0, rawHits: raw, cats: r.categories.join("|") || "-", top: detectBoundary(f.text).boundary ?? "-" };
});
const bnd = rows.filter((r) => r.expect === "boundary");
const clean = rows.filter((r) => r.expect === "clean");
const caught = bnd.filter((r) => r.hit);
const fp = clean.filter((r) => r.hit);
check(caught.length === bnd.length, "八类边界 fixture 全部命中", `${caught.length}/${bnd.length}`);
check(fp.length === 0, "邻接 fixture 零漏伤（豁免生效后）", `误报 ${fp.length}/${clean.length}`);

const report = {
  boundaryLayerBytes: block.length,
  categories: RISK_CATEGORIES.length,
  boundaryCaught: `${caught.length}/${bnd.length}`,
  adjacencyClean: `${clean.length - fp.length}/${clean.length}`,
  rawCollisionsExempted: rows.filter((r) => r.rawHits > 0 && !r.hit).map((r) => r.id),
  falsePositiveIds: fp.map((r) => `${r.id}(${r.cats})`),
};

if (JSON_ONLY) {
  console.log(JSON.stringify({ ...report, pass: passes.length, fail: failures.length, failures }, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n边界层自检： 通过 ${passes.length} · 失败 ${failures.length}`);
  if (failures.length) console.log(failures.map((f) => "  ❌ " + f).join("\n"));
}
process.exit(failures.length ? 1 : 0);
