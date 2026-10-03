#!/usr/bin/env node
// 无限五代 · 技能目录帧预算门禁（只读）
//
// 技能层「零 token」只对技能正文成立：技能目录帧（name + description + whenToUse）
// 由宿主每轮发给模型，与技能有没有被真正装载无关。这部分字节此前不在任何预算常量里，
// 所以「常驻内核 15026 B」并不是每轮真实底价 —— 真实底价还要加上目录帧。
// 本门禁把这一项钉住：帧不会悄悄长回去，也不会因为加层而把每轮底价抬高而不被看见。
//
// 用法：
//   node scripts/verify_frame_budget.mjs          # 逐帧读数 + 判据，全过 exit 0
//   node scripts/verify_frame_budget.mjs --json   # 末尾一行机器可读摘要
//
// 判据（四项）：
//   1. 技能层在场：帧数 ≥ MIN_FRAMES（技能层被整个删掉要报出来，而不是静默 0 帧通过）
//   2. 每帧带非空 description（宿主发现规则的最低要求）
//   3. 单帧 ≤ FRAME_MAX_BYTES
//   4. 目录帧总量 ≤ FRAME_TOTAL_MAX_BYTES，且 常驻内核 + 目录帧 ≤ FLOOR_MAX_BYTES

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 预算：按 2026-10-01 实测（帧 4109 B / 真实底价 19135 B）留余量定，涨预算必须与
// 「加帧或加常驻」出现在同一个 diff 里，并写明理由 —— 与 INDEX_BUDGET_BYTES 同一规矩。
export const FRAME_MAX_BYTES = 900;        // 单帧上限（实测最大 660 B：ig5-layer-01）
export const FRAME_TOTAL_MAX_BYTES = 4600; // 目录帧总量（实测 4109 B，余 491 B）
export const FLOOR_MAX_BYTES = 22500;      // 常驻 + 目录帧（v0.65.7 边界层入库后实测 20717 B）
// v0.65.7 上调 20000 → 21000：内核新增「边界层（B 域）」小节（八类 + 优先级声明），
// 常驻内核 16811 B（仍在 ≤17000 内核预算内）。按本文件规矩，加常驻必须与涨预算同 diff 并写明理由。
export const MIN_FRAMES = 8;               // 技能层在场的下限

const results = [];
function check(ok, claim, detail = "") {
  results.push({ ok, claim, detail });
  return ok;
}

const kernel = readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8");
const residentBytes = Buffer.byteLength(kernel, "utf8");

const skillsDir = join(ROOT, "skills");
const frames = [];
if (existsSync(skillsDir)) {
  for (const d of readdirSync(skillsDir).sort()) {
    const p = join(skillsDir, d, "SKILL.md");
    if (!existsSync(p)) continue;
    const t = readFileSync(p, "utf8");
    const fm = (/^---\n([\s\S]*?)\n---/.exec(t) || [, ""])[1];
    const desc = (/^description:\s*(.*)$/m.exec(fm) || [, ""])[1].trim();
    const when = (/^whenToUse:\s*(.*)$/m.exec(fm) || [, ""])[1].trim();
    const line = `name: ${d}\ndescription: ${desc}\nwhenToUse: ${when}`;
    frames.push({ id: d, desc, bytes: Buffer.byteLength(line, "utf8") });
  }
}
const frameTotal = frames.reduce((a, f) => a + f.bytes, 0);
const floor = residentBytes + frameTotal;

check(frames.length >= MIN_FRAMES, `技能层在场（帧 ≥ ${MIN_FRAMES}）`, `实得 ${frames.length}`);
const noDesc = frames.filter((f) => !f.desc).map((f) => f.id);
check(noDesc.length === 0, "每帧带非空 description（宿主发现规则）", noDesc.join(",") || "全部有");
const over = frames.filter((f) => f.bytes > FRAME_MAX_BYTES);
check(over.length === 0, `单帧 ≤ ${FRAME_MAX_BYTES} B`, over.map((f) => `${f.id}=${f.bytes}`).join(" ") || "全部在额");
check(frameTotal <= FRAME_TOTAL_MAX_BYTES, `目录帧总量 ≤ ${FRAME_TOTAL_MAX_BYTES} B`, `${frameTotal} B`);
check(floor <= FLOOR_MAX_BYTES, `常驻 + 目录帧 ≤ ${FLOOR_MAX_BYTES} B`, `${floor} B`);

const failed = results.filter((r) => !r.ok);
const asJson = process.argv.includes("--json");
const summary = {
  residentBytes,
  frames: frames.length,
  frameTotalBytes: frameTotal,
  floorBytes: floor,
  checks: results.length,
  failed: failed.map((r) => r.claim),
};

if (asJson) {
  console.log(`IG5_FRAME_BUDGET_JSON ${JSON.stringify(summary)}`);
} else {
  console.log(`技能目录帧预算 · ${ROOT}`);
  console.log(`  每帧（字节降序）：`);
  [...frames].sort((a, b) => b.bytes - a.bytes)
    .forEach((f) => console.log(`    ${String(f.bytes).padStart(5)} B  ${f.id}`));
  console.log(`  常驻内核 ${residentBytes} B + 目录帧 ${frameTotal} B = ${floor} B（每轮真实底价）`);
  console.log(`---`);
  for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.claim}${r.detail ? ` — ${r.detail}` : ""}`);
  console.log(`结果：${results.length - failed.length}/${results.length} 条通过`);
}
process.exit(failed.length ? 1 : 0);
