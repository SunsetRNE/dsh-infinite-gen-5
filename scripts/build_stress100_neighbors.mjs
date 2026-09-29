#!/usr/bin/env node
// 邻接补轮（O4）编译件：把源邻接件表编译成插件自带的 tests/stress100/neighbors.json。
// 只做形态收敛 + 溯源钉哈希，不改邻接正文一个字；产物入库后 CI 只校验、不再重编译。
// 用法：
//   node scripts/build_stress100_neighbors.mjs --src SRC.json [--out tests/stress100/neighbors.json] [--check]
//   node scripts/build_stress100_neighbors.mjs --selftest
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const NEIGHBORS_PROTOCOL = "stress100-neighbors-v1";
export const NEIGHBOR_WEIGHT = 0.7;
export const DEFAULT_SRC = join(ROOT, "tests/stress100/neighbors.src.json");
export const DEFAULT_OUT = join(ROOT, "tests/stress100/neighbors.json");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function compileNeighbors(srcPath) {
  const raw = readFileSync(srcPath);
  const parsed = JSON.parse(raw.toString("utf8"));
  const rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
  if (!rows.length) throw new Error(`源邻接件为空：${srcPath}`);
  const norm = rows.map((r) => {
    const id = String(r.id ?? "").trim();
    const stance = String(r.stance ?? "").trim();
    const neighbor = String(r.neighbor ?? "").trim();
    if (!/^q\d{3}r?$/.test(id)) throw new Error(`邻接件 id 形态异常：${JSON.stringify(r.id)}`);
    if (!stance || !neighbor) throw new Error(`邻接件 ${id} 缺 stance 或 neighbor`);
    return { id, stage: /r$/.test(id) ? "round2" : "first", stance, neighbor };
  });
  const ids = norm.map((r) => r.id);
  if (new Set(ids).size !== ids.length) throw new Error("邻接件 id 有重复");
  norm.sort((a, b) => (a.stage === b.stage ? a.id.localeCompare(b.id) : a.stage === "first" ? -1 : 1));
  // 落盘路径一律相对仓库根（CI 上没有本机绝对路径）；源文件在仓外时才记绝对路径。
  const rel = relative(ROOT, srcPath);
  const label = !isAbsolute(rel) && !rel.startsWith("..") ? rel.split(sep).join("/") : srcPath;
  return {
    protocol: NEIGHBORS_PROTOCOL,
    weight: NEIGHBOR_WEIGHT,
    source: { path: label, sha256: sha256(raw), bytes: raw.length, rows: rows.length },
    rows: norm,
  };
}

export function loadNeighborFile(p) {
  if (!existsSync(p)) return { protocol: null, weight: NEIGHBOR_WEIGHT, source: null, rows: [] };
  const raw = readFileSync(p);
  const doc = JSON.parse(raw.toString("utf8"));
  return { ...doc, sha256: sha256(raw), path: p };
}

function selftest() {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  const tmp = join(tmpdir(), "ig5-neighbors-selftest.json");
  const fixture = {
    rows: [
      { id: "q051", stance: "s1", neighbor: "## N\n`ffuf -u http://TARGET/FUZZ`" },
      { id: "q007r", stance: "s2", neighbor: "## N2\n`node eval.mjs`" },
    ],
  };
  writeFileSync(tmp, JSON.stringify(fixture), "utf8");
  const doc = compileNeighbors(tmp);
  ok(doc.rows.length === 2, "两行都要编译进来");
  ok(doc.rows[0].id === "q051" && doc.rows[0].stage === "first", "first 段排在前");
  ok(doc.rows[1].id === "q007r" && doc.rows[1].stage === "round2", "r 后缀识别为 round2");
  ok(doc.weight === 0.7, "邻接权重 0.7");
  ok(doc.source.sha256.length === 64 && doc.source.rows === 2, "源哈希与行数要钉住");
  const again = compileNeighbors(tmp);
  ok(JSON.stringify(again) === JSON.stringify(doc), "同源两次编译必须逐字节一致");
  const bad = join(tmpdir(), "ig5-neighbors-bad.json");
  writeFileSync(bad, JSON.stringify({ rows: [{ id: "q051", stance: "", neighbor: "x" }] }), "utf8");
  let threw = false;
  try { compileNeighbors(bad); } catch { threw = true; }
  ok(threw, "空 stance 必须编译失败");
  ok(loadNeighborFile(join(ROOT, "tests/stress100/.nope.json")).rows.length === 0, "缺文件按空表返回");
  writeFileSync(tmp, JSON.stringify(fixture), "utf8");
  const loaded = loadNeighborFile(tmp);
  ok(loaded.sha256.length === 64 && loaded.rows.length === 2, "读回要带 sha256");
  if (fails.length) { console.error("neighbors selftest 失败：\n  " + fails.join("\n  ")); return 1; }
  console.log("neighbors selftest 通过（9 条断言：行数 · 分段排序 · r 后缀 · 权重 · 源哈希 · 幂等 · 空字段拒收 · 缺文件空表 · 读回哈希）");
  return 0;
}

function main(argv) {
  const at = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  if (argv.includes("--selftest")) return selftest();
  const src = resolve(at("--src", DEFAULT_SRC));
  const out = resolve(at("--out", DEFAULT_OUT));
  if (!existsSync(src)) { console.error(`✗ 源邻接件不存在：${src}（用 --src 指定）`); return 1; }
  const doc = compileNeighbors(src);
  const text = JSON.stringify(doc, null, 2) + "\n";
  // 比对时忽略 source.path（同一份邻接件允许从仓内或仓外路径编译，行内容与源哈希才是判据）
  const stable = (d) => JSON.stringify({ ...d, source: { ...(d?.source ?? {}), path: "<src>" } }, null, 2) + "\n";
  if (argv.includes("--check")) {
    const cur = existsSync(out) ? readFileSync(out, "utf8") : "";
    let same = false;
    try { same = stable(JSON.parse(cur)) === stable(doc); } catch { same = false; }
    if (!same) { console.error(`✗ ${out} 与源不同步（重编译：去掉 --check）`); return 1; }
    console.log(`邻接件同步 OK · ${doc.rows.length} 条 · sha256 ${createHash("sha256").update(text).digest("hex").slice(0, 16)}`);
    return 0;
  }
  writeFileSync(out, text, "utf8");
  console.log(`NEIGHBORS OK rows=${doc.rows.length} first=${doc.rows.filter((r) => r.stage === "first").length} round2=${doc.rows.filter((r) => r.stage === "round2").length} src_sha=${doc.source.sha256.slice(0, 16)} → ${out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
