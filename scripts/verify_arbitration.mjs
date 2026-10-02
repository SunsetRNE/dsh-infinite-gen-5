#!/usr/bin/env node
// 无限五代 · 跨插件判断层自检（只读）
//   node scripts/verify_arbitration.mjs
// 判据：
//   1. 规则表完整（≥6 条，id 唯一，每条 rule/why 非空）
//   2. 仲裁行含六项要点（域划分 / 采访额度 / 批量优先 / 工具形态 / 末位让位 / 停下语义）
//   3. arbitrate() 三档分流正确（batch → ig5 · interview → puzzle · 默认 → ig5）
//   4. index.js 真的接了：末位声明已让位、运行时锚点带仲裁行、末位锚点带回指
//   5. 若本机装了 dsh-puzzle-mode：其 order 必须大于无限五代末位锚点（让位有依据）

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync as _rf, existsSync as _ex } from "node:fs";
import { ARBITRATION_RULES, arbitrate, arbitrationLine, PZ_ORDER_UPSTREAM_0197, PZ_ORDER_FORK_DEFAULT, PZ_SECTION, IG5_TAIL_ORDER, tailIsLiterallyLast, COMPAT_CONTRACT, COMPAT_PUZZLE_PATHS, readPuzzleContract, contractIssues, COMPAT_TEXT_PROBES, COMPAT_PUZZLE_TEXT_PATHS, textProbeIssues } from "../data/arbitration.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const ok = (claim, cond, detail = "") => results.push({ ok: !!cond, claim, detail: String(detail) });

// 1. 规则表
const ids = new Set(ARBITRATION_RULES.map((r) => r.id));
ok("规则表 ≥6 条且 id 唯一", ARBITRATION_RULES.length >= 6 && ids.size === ARBITRATION_RULES.length,
  `${ARBITRATION_RULES.length} 条 / 唯一 ${ids.size}`);
ok("每条都有 rule 与 why", ARBITRATION_RULES.every((r) => r.rule && r.why && r.key));

// 2. 仲裁行要点
const line = arbitrationLine();
const need = ["归无限五代", "拼图模式", "批量合同优先", "puzzle_mode", "本载荷末位", "停下"];
const miss = need.filter((w) => !line.includes(w));
ok("仲裁行含六项要点", miss.length === 0, miss.length ? "缺：" + miss.join(",") : `${Buffer.byteLength(line, "utf8")} B`);
ok("仲裁行同时写明上游段序与复刻仓默认段序",
  line.includes(String(PZ_ORDER_UPSTREAM_0197)) && line.includes(String(PZ_ORDER_FORK_DEFAULT)) && line.includes(String(IG5_TAIL_ORDER)));
ok("段序判定助手：复刻仓默认 → 末位锚点确实最后；上游 → 落在其后",
  tailIsLiterallyLast(PZ_ORDER_FORK_DEFAULT) === true && tailIsLiterallyLast(PZ_ORDER_UPSTREAM_0197) === false);

// 3. 分流
ok("整批题 → 批量优先（不采访）", arbitrate({ batch: true }).kind === "batch-first");
ok("采访轮 → 拼图额度", arbitrate({ interview: true }).owner === "puzzle");
ok("默认 → 无限五代的域划分", arbitrate({}).owner === "ig5");

// 4. index.js 接线
const idx = readFileSync(join(ROOT, "index.js"), "utf8");
ok("末位声明已让位（不再自称整份提示的最后一段）", !idx.includes("这是整份系统提示的最后一段"));
ok("末位声明改为「本载荷的最后一段」", idx.includes("这是本载荷的最后一段"));
ok("index.js 引入 data/arbitration.mjs", idx.includes('from "./data/arbitration.mjs"'));
ok("运行时锚点追加仲裁行", /gateClauseText\(rev\)[\s\S]{0,200}arbitrationLine\(\)/.test(idx));
ok("末位锚点带回指行（跨插件仲裁）", idx.includes("[跨插件仲裁] 交付物内容与形态归无限五代"));

// 5. 拼图插件在场时的依据核验
const pzDir = "/root/.dsh/plugin-src/dsh-puzzle-mode";
if (existsSync(join(pzDir, "lib", "index.js"))) {
  const pz = readFileSync(join(pzDir, "lib", "index.js"), "utf8");
  const m = pz.match(/const ORDER = (\d+)/);
  const measured = m ? Number(m[1]) : NaN;
  ok("拼图段名与记录一致", pz.includes(PZ_SECTION), PZ_SECTION);
  ok("装机副本的段序在两套记录之内（上游 10500 或复刻仓默认 10100）",
    measured === PZ_ORDER_UPSTREAM_0197 || measured === PZ_ORDER_FORK_DEFAULT,
    `实测 ${measured}`);
  ok("段序关系已记录（两条路径都成立，不必改口径）",
    tailIsLiterallyLast(measured) === (measured < IG5_TAIL_ORDER),
    `${measured} ${tailIsLiterallyLast(measured) ? "<" : ">"} ${IG5_TAIL_ORDER}`);
} else {
  ok("拼图插件未安装 → 跳过依据核验", true, "未发现 " + pzDir);
}


// ⑩ 双向互校（v0.59.2）：读拼图侧的 compat.json，两两核对同一组段序数字
{
  const got = readPuzzleContract(_rf, _ex);
  if (!got) {
    ok("拼图侧 compat.json 不在本机 → 互校跳过（本仓契约已声明）", true, COMPAT_PUZZLE_PATHS.join(" | "));
  } else if (got.error) {
    ok("拼图侧 compat.json 可解析", false, got.error);
  } else {
    ok("拼图侧 compat.json 契约名一致", got.decl.contract === COMPAT_CONTRACT, `${got.path} → ${got.decl.contract}`);
    const issues = contractIssues(got.decl);
    ok("双向互校无差异（末位锚点 / 拼图默认段序 / 段序关系）", issues.length === 0, issues.join("；"));
  }
}


// ⑪ 文本层互校（v0.59.4）：三条分工规则的可核关键词，自证 + 互校
{
  const wantRules = ["domain", "ask-quota", "batch-first", "tool-shape", "stop-semantics"];
  ok("文本契约覆盖五条分工规则（域划分 / 额度 / 批量优先 / 工具形态 / 停下语义）",
    Object.keys(COMPAT_TEXT_PROBES).length === 5 && wantRules.every((k) => k in COMPAT_TEXT_PROBES),
    Object.keys(COMPAT_TEXT_PROBES).join(", "));
  const own = arbitrationLine();
  const ownMiss = Object.entries(COMPAT_TEXT_PROBES).filter(([, p]) => !own.includes(p.ig5));
  ok("自证：本仓仲裁行含五条 ig5 侧关键词", ownMiss.length === 0,
    ownMiss.length ? "缺：" + ownMiss.map(([k, p]) => k + "→" + p.ig5).join(" / ") : "五条齐");

  const got = readPuzzleContract(_rf, _ex);
  const puzzleTextPath = COMPAT_PUZZLE_TEXT_PATHS.find((f) => _ex(f));
  if (!got || !puzzleTextPath) {
    ok("拼图侧不在本机 → 文本互校跳过（表已声明）", true, COMPAT_PUZZLE_TEXT_PATHS.join(" | "));
  } else {
    const otherText = _rf(puzzleTextPath, "utf8");
    const issues = textProbeIssues(got.decl, own, otherText);
    ok("文本互校无差异（表一致 + 双方关键词都在）", issues.length === 0, issues.join("；"));
  }
}

const fail = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.claim}${r.detail ? " — " + r.detail : ""}`);
console.log(`\n跨插件判断层自检： ${results.length - fail.length} 通过 / ${fail.length} 失败（共 ${results.length} 项）`);
process.exit(fail.length ? 1 : 0);
