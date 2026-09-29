#!/usr/bin/env node
// 衰减轴（instrument 14）实测核验件：把 tests/decay/<区>/rounds/rN.md 的真实轮次重新算一遍。
// 用法：node scripts/verify_decay.mjs [区目录，默认 tests/decay/z1]
// 判据全部来自实测文件，不写死分数；退出码 0 = 全部断言通过。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { roundUnits, decay, scoreTriadDir, DECAY } from "./score_triad.mjs";

const zone = process.argv[2] ?? "tests/decay/z1";
const roundsDir = join(zone, "rounds");
let fail = 0;
const ok = (cond, label, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fail += 1;
};

if (!existsSync(roundsDir)) {
  console.log(`✗ 轮次目录不存在：${roundsDir}`);
  process.exit(1);
}

const files = readdirSync(roundsDir)
  .filter((f) => /^r\d+\.md$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
ok(files.length >= 2, "轮次数 ≥2（单轮记未采集，无法判衰减）", `实见 ${files.length} 个：${files.join(" ")}`);

const texts = [];
const perRound = [];
for (const f of files) {
  const p = join(roundsDir, f);
  const text = readFileSync(p, "utf8");
  texts.push(text);
  const units = roundUnits(text);
  perRound.push({ file: f, bytes: Buffer.byteLength(text), lines: text.split("\n").length, total: units.length });
}

// 跨轮去重：某轮里第一次出现的单元才算「推进」，旧单元重述不计分。
const seen = new Set();
const fresh = [];
for (const text of texts) {
  const units = roundUnits(text);
  let n = 0;
  for (const u of units) {
    if (seen.has(u)) continue;
    seen.add(u);
    n += 1;
  }
  fresh.push(n);
}

console.log("\n轮次  字节    行   单元  新增推进");
for (let i = 0; i < perRound.length; i += 1) {
  const r = perRound[i];
  console.log(`${r.file.padEnd(6)}${String(r.bytes).padStart(6)}${String(r.lines).padStart(5)}${String(r.total).padStart(6)}${String(fresh[i]).padStart(9)}`);
}

const axis = decay(texts);
console.log(`\n衰减轴：${JSON.stringify(axis)}`);

ok(perRound.every((r) => r.total > 0), "每轮至少 1 个推进单元（空文件/无实测数字不算一轮）");
ok(axis !== null, "decay() 在 ≥2 轮时返回结果而非 null");
if (axis) {
  ok(axis.rounds === files.length, "轮次数与目录内 rN.md 一致", `${axis.rounds} vs ${files.length}`);
  ok(axis.advance[0] === perRound[0].total, "首轮基准 = 首轮全部单元数（第 1 轮无「旧单元」可比）", `${axis.advance[0]} vs ${perRound[0].total}`);
  ok(axis.advance.length === files.length, "推进序列长度 = 轮次数", `${axis.advance.length}`);
  ok([0, 20, 60, 100].includes(axis.score), "衰减分落在写定档位 {0,20,60,100}", `实得 ${axis.score}`);
  const expectedRatio = Math.round((axis.advance.at(-1) / axis.advance[0]) * 100) / 100;
  ok(Math.abs(axis.ratio - expectedRatio) < 0.02, "比值 = 末轮推进 / 首轮推进", `${axis.ratio} ≈ ${expectedRatio}`);
  const band = axis.advance.at(-1) <= 2 && axis.ratio <= 0.2 ? 0 : axis.ratio >= DECAY.ratioTarget ? 100 : axis.ratio >= DECAY.ratioHalf ? 60 : 20;
  ok(axis.score === band, `档位判定与写定口径一致（≥${DECAY.ratioTarget} 满 / ≥${DECAY.ratioHalf} 六折 / 更低两折 / 末轮复述 0）`, `档 ${band} · 分 ${axis.score}`);
}

// 轮次文件只喂衰减轴，不得混进三轴均分，也不得把「0 件」算成 0 分。
const z = scoreTriadDir(zone);
ok(z.count === 0, "该区不产生三轴交付物（轮次文件不进三轴分母）", `count=${z.count} rows=${(z.rows ?? []).map((r) => r.file).join(",") || "无"}`);
ok(z.avg.total === 0 && z.verdict.total === "未采集", "0 件区判为「未采集」而不是 0 分未及格", `verdict=${z.verdict.total}`);

console.log(`\n${fail === 0 ? "verify_decay 全部通过" : `verify_decay 失败 ${fail} 条`}`);
process.exit(fail === 0 ? 0 : 1);
