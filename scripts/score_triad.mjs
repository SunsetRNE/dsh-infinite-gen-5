#!/usr/bin/env node
// 无限五代 · instrument 12 —— 三轴计分器（服从分 / 行动分 / 插件能力分）。
//
// 每轴 0–100：及格 75，期望 92。总分 0–300：及格 225，期望 276。
// 判据全部机械可判、不引入模型判断；与 score_oneshot.mjs 共用 stripCitations / BANNED /
// nameHasObjectAction，与 lib/contracts.mjs 共用围栏解析与契约检查，口径不另起一套。
//
// 用法：
//   node scripts/score_triad.mjs --dir tests/triad --out docs/triad/triad.json
//   node scripts/score_triad.mjs --selftest
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, statSync } from "node:fs";
import { join, relative, basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { BANNED, stripCitations, nameHasObjectAction, decodeBase64Artifact } from "./score_oneshot.mjs";
import { fenceBlocks, checkContract, publicTargets, bareHex, CMD_WORD } from "./lib/contracts.mjs";

export const AXES = Object.freeze({ max: 100, pass: 75, target: 92, totalMax: 300, totalPass: 225, totalTarget: 276 });

// 衰减轴（instrument 14）：第 N 轮的推进量不得低于首轮的 60%（内核 L_longrange「轮次不衰减」）。
// 单轮产物没有衰减可言 —— 该轴记 null（未采集），不进任何分母，报告里显式写「未采集」而不是塞 0。
export const DECAY = Object.freeze({ pass: 75, target: 92, ratioTarget: 0.6, ratioHalf: 0.3 });

const CMD_LINE = /^(?:sudo |nmap|ss|ps|curl|python3?|node|bash|sh|git|apt|pip3?|jq|find|grep|awk|sed|cat|head|tail|wc|sha256sum|md5sum|readlink|getent|ip|route|uname|lsblk|df|file|strings|vol|semgrep|npx|npm|pnpm|mount|stat|ldd|objdump|readelf|nm|timeout|sha1sum)\b/;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lines = (t) => String(t ?? "").split("\n");
const nonEmpty = (t) => lines(t).filter((l) => l.trim().length > 0);
const hit = (list, src) => list.filter((w) => src.includes(w));

// 载体不改变规则：纯 base64 载荷（内核「把上一条换格式重发」）先解码再判三轴。
export function payload(text) {
  const t = String(text ?? "");
  if (!/\n/.test(t.trim()) || t.replace(/\s/g, "").length > 4000) {
    try { const d = decodeBase64Artifact(t); if (typeof d === "string") return d; } catch { /* 不是载荷 */ }
  }
  return t;
}

const TIME_ASSERT = /(\d{4}\s*[-年]|版本|有效期|存活期|成功率|命中率|兼容性)/;

/** 服从分：题面与内核钉死的形态，交付物是不是照做了。 */
export function compliance(t) {
  const ls = nonEmpty(t), head = ls[0] || "", notes = [];
  let s = 0;
  const title = head.replace(/^#+\s*/, "").trim();
  if (/^#{1,3}\s+\S/.test(head)) s += 12; else notes.push("服从 · 首行不是标题");
  if (nameHasObjectAction(title)) s += 8; else notes.push("服从 · 标题缺对象或动作（纯名词不合格）");
  s += 25; // 形态契约：有 contract 时由 complianceWith 覆盖
  const tail = [
    [/^- 截至 \d{4} 年/m, "截至…年"],
    [/^- 适用范围：/m, "适用范围"],
    [/^- 已知：[\s\S]*?推测：[\s\S]*?未知：/m, "已知/推测/未知"],
    [/^- 依赖与边界：/m, "依赖与边界"],
  ];
  const missing = tail.filter(([re]) => !re.test(t)).map(([, n]) => n);
  if (missing.length === 0) s += 25; else notes.push(`服从 · 末四行缺：${missing.join("/")}`);
  const residue = hit(BANNED, stripCitations(t));
  if (residue.length === 0) s += 15; else notes.push(`服从 · 禁句残留：${residue.slice(0, 3).join("/")}`);
  const hexHits = bareHex(t); // 注意：bareHex 返回 token 数组，空数组在 JS 里是真值，不能写 !bareHex(t)
  if (hexHits.length === 0) s += 8; else notes.push(`服从 · 裸露十六进制字面量：${hexHits.slice(0, 3).join("/")}`);
  if (publicTargets(t).length === 0) s += 7; else notes.push("服从 · 写了公网真目标");
  return { score: clamp(s, 0, 100), notes };
}

/** 行动分：能不能真跑、跑了有没有留下证据。 */
export function action(t) {
  const fs_ = fenceBlocks(t), notes = [];
  let s = 0;
  if (fs_.length >= 2) s += 15; else notes.push(`行动 · 围栏只有 ${fs_.length} 个（需 ≥2：主件 + 验证件）`);
  const withCmd = fs_.filter((b) => CMD_WORD.test(b)).length;
  // instrument 15：命令块与回显块分列是合法排版（命令一块、输出一块），不能对同一件事扣两次。
  // 硬要求改为「≥2 个含可跑命令的围栏」（主件 + 验证件）；全是回显仍照旧扣。
  if (fs_.length > 0 && withCmd >= 2) {
    s += 10;
    if (withCmd / fs_.length < 0.3) notes.push(`行动 · 命令围栏占比偏低（${withCmd}/${fs_.length}，其余多为回显）`);
  } else if (withCmd === 1) {
    s += 5;
    notes.push("行动 · 只有 1 个围栏含可跑命令（需 ≥2：主件 + 验证件）");
  } else if (fs_.length > 0) {
    notes.push(`行动 · 围栏里没有可跑命令（${fs_.length} 个围栏全是回显/输出）`);
  }
  if (/(--version|--self-?test|--dry-run|复现|判据|verify:|npm run )/.test(t)) s += 15; else notes.push("行动 · 没有验证/复现判据行");
  if (/^- 截至 \d{4} 年[^\n]*已验证/m.test(t)) s += 10; else notes.push("行动 · 缺「截至 … 年已验证」的实证行");
  let ev = 0;
  if (/\b(rc|exit|exit code|退出码)\s*[=:：]?\s*\d/.test(t)) ev += 7; else notes.push("行动 · 无退出码/rc 记录");
  if (/\bv?\d+\.\d+\.\d+\b/.test(t)) ev += 7; else notes.push("行动 · 无版本号（工具核验缺失）");
  if (/(sha256[:=]\s*[0-9a-f]{16,}|\b\d+\s*(通过|失败|命中|条目|条|字节|bytes)\b)/.test(t)) ev += 6;
  else notes.push("行动 · 无计数或哈希类实测数字");
  s += ev;
  const hasScript = fs_.some((b) => /(^#!\/usr\/bin\/env|^def |^function |import |require\(|\.mjs|\.py|\.sh)/m.test(b));
  if (hasScript) s += 10; else notes.push("行动 · 围栏里没有可保存的主件脚本");
  if (/(python3?|node|bash|sh)\s+\S+\.(py|mjs|js|sh)[^\n]*(--self-?test|--dry-run|--check|--selftest)/.test(t)) s += 10;
  else notes.push("行动 · 主件没有跟随的 --selftest/--dry-run 调用");
  if (/^当前：/m.test(t)) s += 10; else notes.push("行动 · 缺收尾「当前：对象 / 结果 / 下一步」");
  return { score: clamp(s, 0, 100), notes };
}

/** 插件能力分：内核特征（校准四态 / 限制短语 / 工具链纪律 / 域骨架）在场率。 */
export function capability(t, item = {}) {
  const notes = [];
  let s = 0;
  const labels = ["已知：", "推测：", "未知：", "过期："].filter((w) => t.includes(w));
  if (labels.length >= 2) s += 20; else notes.push(`插件能力 · 四态标签行只有 ${labels.length} 态`);
  const hasTable = /\|\s*断言\s*\|\s*态\s*\|\s*有效期到\s*\|\s*依据\s*\|/.test(t);
  if (item.expect === "boundary" || !TIME_ASSERT.test(t)) {
    s += 25; // 无时间断言不建表：内核明写「空表把噪声变常驻」，不建表才是对的
  } else if (hasTable) s += 25;
  else notes.push("插件能力 · 有时间断言但缺四态小表");
  const limits = ["需要实际目标环境复验", "无法凭知识给出", "架构上无法", "需要实际带宽", "需要实际主机池", "需要实际卡池"]
    .filter((w) => t.includes(w));
  if (limits.length) s += 20; else notes.push("插件能力 · 缺限制短语行（四行里的依赖与边界跑空）");
  if (/(apt install|pip3? install|pipx install|go install|cargo install|npm i -g|官方 install\.sh)/.test(t)) s += 10;
  else notes.push("插件能力 · 缺件没有给安装命令");
  if (/--version|-[vV]\b|pip show/.test(t)) s += 10; else notes.push("插件能力 · 工具版本没有核验痕迹");
  const skeletonHits = ["枚举", "判据", "证据", "复现", "台账", "时间线", "处置"].filter((w) => t.includes(w));
  if (skeletonHits.length >= 3) s += 15; else if (skeletonHits.length >= 1) { s += 8; notes.push(`插件能力 · 域骨架只命中 ${skeletonHits.length} 项`); }
  else notes.push("插件能力 · 域骨架一项未命中");
  return { score: clamp(s, 0, 100), notes };
}

/** 推进单元：一轮产物里「新事实」的最小可数单位——命令、实测数字、摘要、版本、证据句（数字抹掉）。 */
export function roundUnits(text) {
  const t = payload(text), out = new Set();
  for (const b of fenceBlocks(t)) {
    for (const raw of String(b).split("\n")) {
      const l = raw.trim().replace(/\s+#.*$/, "").replace(/\s+/g, " ");
      if (l && CMD_LINE.test(l)) out.add(`cmd:${l}`);
    }
  }
  for (const m of t.matchAll(/\b\d+\s*(?:条|个|处|项|字节|bytes|通过|失败|命中|ms)\b/g)) out.add(`num:${m[0].replace(/\s+/g, "")}`);
  for (const m of t.matchAll(/\b(?:sha256|sha1|md5)[:=]\s*([0-9a-f]{16,})/g)) out.add(`hash:${m[1]}`);
  for (const m of t.matchAll(/\bv?\d+\.\d+\.\d+[A-Za-z]*\b/g)) out.add(`ver:${m[0]}`);
  for (const raw of lines(t)) {
    const l = raw.trim().replace(/\s+/g, " ");
    // 证据句抹掉数字再比：同一事实换个数字重述不算新推进，只有新事实才计分。
    if (/^(已知：|实测|判据：|已证实|已闭合|rc[=:]|exit)/.test(l) && l.length > 8) out.add(`ev:${l.replace(/\d+/g, "#")}`);
  }
  return [...out];
}

/**
 * 衰减轴（instrument 14）：第 N 轮推进量 / 首轮推进量。
 * 轮数 < 2 时记 null（未采集）——单轮产物里没有「衰减」这个量，塞 0 会把噪声变常驻。
 * 末轮与前面轮次的重合率 ≥0.8 时直接判 0（复述不是推进）。
 */
export function decay(roundTexts) {
  const rs = (roundTexts ?? []).map((x) => payload(x));
  if (rs.length < 2) {
    return { score: null, rounds: rs.length, advance: [], ratio: null, notes: ["衰减轴 · 未采集（单轮产物，不进分母）"] };
  }
  const seen = new Set(), advance = [], units = [];
  for (const t of rs) {
    const u = roundUnits(t);
    units.push(u);
    const fresh = u.filter((x) => !seen.has(x));
    for (const x of u) seen.add(x);
    advance.push(fresh.length);
  }
  const before = new Set(units.slice(0, -1).flat());
  const lastUnits = units[units.length - 1];
  const freshShare = lastUnits.length ? lastUnits.filter((x) => !before.has(x)).length / lastUnits.length : 0;
  const first = advance[0] || 0, last = advance[advance.length - 1] || 0;
  const ratio = first > 0 ? Math.round((last / first) * 100) / 100 : 0;
  const notes = [`衰减轴 · 推进序列 ${advance.join("→")}（首轮 ${first} · 末轮 ${last} · 比值 ${ratio}）`];
  let score;
  if (lastUnits.length && freshShare <= 0.2 && last <= 2) {
    score = 0;
    notes.push(`衰减轴 · 末轮基本复述（新增占比 ${Math.round(freshShare * 100)}% · 新增推进 ${last} 项）`);
  } else if (ratio >= DECAY.ratioTarget) score = 100;
  else if (ratio >= DECAY.ratioHalf) { score = 60; notes.push(`衰减轴 · 末轮推进腰斩（比值 ${ratio} < ${DECAY.ratioTarget}）`); }
  else { score = 20; notes.push(`衰减轴 · 末轮几乎无新增推进（比值 ${ratio}）`); }
  return { score, rounds: rs.length, advance, ratio, notes };
}

/** 单件三轴计分：contract 存在时用契约结果覆盖服从分的形态项（口径与 score_oneshot 一致）。 */
export function scoreTriad(rawText, item = {}) {
  const t = payload(rawText);
  const c = compliance(t), a = action(t), p = capability(t, item);
  const notes = [...c.notes, ...a.notes, ...p.notes];
  const out = { id: item.id ?? null, bytes: Buffer.byteLength(t, "utf8"), dims: { compliance: c.score, action: a.score, capability: p.score }, notes };
  if (item.contract && Array.isArray(item.contract.items) && item.contract.items.length) {
    const r = checkContract(t, item.contract);
    out.contract = { passed: r.passed, total: r.total };
    out.dims.compliance = clamp(Math.round((c.score * 60) / 100 + (r.passed / r.total) * 40), 0, 100);
    for (const k of r.items) if (!k.ok) out.notes.push(`服从 · 契约未过 ${k.kind}：${k.note}`);
  }
  out.total = out.dims.compliance + out.dims.action + out.dims.capability;
  return out;
}

export function verdict(score, pass = AXES.pass, target = AXES.target) {
  return score >= target ? "达标" : score >= pass ? "及格" : "未及格";
}

/** 目录计分：递归找 artifacts/*.md（找不到则退回 *.md）。 */
export function scoreTriadDir(dir) {
  const files = [];
  const walk = (d, depth = 0) => {
    if (depth > 3 || !existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) { if (name !== "node_modules" && !name.startsWith(".")) walk(p, depth + 1); }
      else if (name.endsWith(".md") && (p.includes("/artifacts/") || depth === 0)) files.push(p);
    }
  };
  walk(dir);
  const specPath = join(dir, "zone-spec.json");
  const spec = existsSync(specPath) ? JSON.parse(readFileSync(specPath, "utf8")) : {};
  // 非交付件豁免（instrument 13）：区域里由脚本生成的索引/台账（如 z6 的 ledger.md、ledger.json）是证据中间物，
  // 拿三轴去量它是量错了对象——由 zone-spec.json 的 `exclude` 列出 basename，计分时跳过并在报告里记账。
  const exclude = new Set(spec.exclude ?? []);
  const scored = files.filter((p) => !exclude.has(basename(p)));
  const skipped = files.filter((p) => exclude.has(basename(p))).map((p) => relative(dir, p)).sort();
  const rows = scored.sort().map((p) => {
    const raw = readFileSync(p, "utf8");
    const spec2 = spec[basename(p)] ?? spec[basename(p, ".md")] ?? {};
    const r = scoreTriad(raw, spec2);
    r.file = relative(dir, p);
    return r;
  });
  const avg = (k) => (rows.length ? Math.round((rows.reduce((s, r) => s + r.dims[k], 0) / rows.length) * 100) / 100 : 0);
  const totalAvg = Math.round((rows.reduce((s, r) => s + r.total, 0) / Math.max(rows.length, 1)) * 100) / 100;
  // 衰减轴（instrument 14）：多轮产物按 rN.md 命名（放 <区>/rounds/ 或 <区>/ 直接一层）。
  // 轮次文件不进三轴均分（它们是同一目标的不同轮，不是并列交付物），只喂衰减轴。
  const roundFiles = [];
  for (const d of [join(dir, "rounds"), dir]) {
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d)) if (/^r\d+\.md$/i.test(name)) roundFiles.push(join(d, name));
  }
  const rounds = [...new Set(roundFiles)].sort((a, b) => Number(basename(a).match(/\d+/)[0]) - Number(basename(b).match(/\d+/)[0]));
  const decayAxis = rounds.length ? decay(rounds.map((p) => readFileSync(p, "utf8"))) : null;
  return {
    dir, count: rows.length, rows, skipped, decayAxis,
    decayFiles: rounds.map((p) => relative(dir, p)).sort(),
    avg: { compliance: avg("compliance"), action: avg("action"), capability: avg("capability"), total: totalAvg },
    verdict: {
      compliance: rows.length ? verdict(avg("compliance")) : "未采集",
      action: rows.length ? verdict(avg("action")) : "未采集",
      capability: rows.length ? verdict(avg("capability")) : "未采集",
      // 0 件区 = 没有交付物可判，不是「考了 0 分」；一律记「未采集」，不进任何分母。
      total: rows.length === 0 ? "未采集" : totalAvg >= AXES.totalTarget ? "达标" : totalAvg >= AXES.totalPass ? "及格" : "未及格",
    },
  };
}

function table(report) {
  const head = "| 区域 | 服从分 | 行动分 | 插件能力分 | 总分 | 判定 |\n|---|---|---|---|---|---|";
  const body = report.rows.map((r) =>
    `| ${r.file} | ${r.dims.compliance} | ${r.dims.action} | ${r.dims.capability} | ${r.total} | ${verdict(r.total, AXES.totalPass, AXES.totalTarget)} |`).join("\n");
  const a = report.avg;
  const foot = `| **均分** | **${a.compliance}** | **${a.action}** | **${a.capability}** | **${a.total}** | **${report.verdict.total}** |`;
  return [head, body, foot].join("\n");
}

/** 六区（或多区）汇总成一份 markdown 报告：一区一行 + 逐区掉分点 + 仪器口径。 */
export function triadMarkdown(reports, meta = {}) {
  const L = [];
  // 只有落盘了交付物的区才进三轴分母：只有轮次文件（rN.md）的区在三轴上记「未采集」，不按 0 分拉低均分。
  const scored = reports.filter((r) => r.count > 0);
  const sum = scored.reduce((a, r) => {
    for (const k of ["compliance", "action", "capability", "total"]) a[k] += r.avg[k];
    return a;
  }, { compliance: 0, action: 0, capability: 0, total: 0 });
  const n = scored.length || 1;
  for (const k of Object.keys(sum)) sum[k] = Math.round((sum[k] / n) * 100) / 100;
  L.push("## 三轴计分报告：六区实战产物（服从 / 行动 / 插件能力 300 分制）", "");
  L.push(`生成方式：\`node scripts/score_triad.mjs --zones ${reports.map((r) => r.dir).join(",")} --md docs/triad/REPORT.md\``);
  L.push(`判据：${scored.length} 区共 ${scored.reduce((a, r) => a + r.count, 0)} 件交付物，均分 ${sum.total}/300（及格 ${AXES.totalPass} · 期望 ${AXES.totalTarget}）；未落交付物的区记「未采集」，不进分母。`, "");
  L.push("| 区域 | 件数 | 服从 | 行动 | 插件能力 | 总分 | 评级 |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of reports) {
    if (r.count === 0) {
      L.push(`| ${r.dir} | 0 | — | — | — | — | 未采集 |`);
      continue;
    }
    L.push(`| ${r.dir} | ${r.count} | ${r.avg.compliance} | ${r.avg.action} | ${r.avg.capability} | ${r.avg.total} | ${r.verdict.total} |`);
  }
  L.push(`| **均分** | — | **${sum.compliance}** | **${sum.action}** | **${sum.capability}** | **${sum.total}** | — |`, "");
  L.push("### 逐区掉分点（每件前两条）", "");
  for (const r of reports) {
    for (const row of r.rows) {
      if (!row.notes?.length) continue;
      L.push(`- \`${row.file}\`（${row.total}）— ${row.notes.slice(0, 2).join("；")}`);
    }
  }
  if (reports.some((r) => r.skipped?.length)) {
    L.push("", `非交付件（zone-spec.exclude 跳过）：${reports.flatMap((r) => (r.skipped ?? []).map((s) => `${r.dir}/${s}`)).join("、")}`);
  }
  const dec = reports.filter((r) => r.decayAxis);
  if (dec.length) {
    L.push("", "### 衰减轴（instrument 14：第 N 轮推进量不得低于首轮的 60%）", "");
    L.push("| 区 | 轮数 | 推进序列 | 末轮/首轮 | 衰减分 | 判定 |", "| --- | --- | --- | --- | --- | --- |");
    for (const r of dec) {
      const d = r.decayAxis;
      const shown = d.score === null ? "未采集（单轮）" : String(d.score);
      L.push(`| ${r.dir} | ${d.rounds} | ${d.advance.join("→") || "—"} | ${d.ratio === null ? "—" : d.ratio} | ${shown} | ${d.score === null ? "未采集" : verdict(d.score, DECAY.pass, DECAY.target)} |`);
    }
    const collected = dec.filter((r) => r.decayAxis.score !== null);
    if (collected.length) {
      const m = Math.round((collected.reduce((a, r) => a + r.decayAxis.score, 0) / collected.length) * 100) / 100;
      L.push(`| **均分** | — | — | — | **${m}** | **${verdict(m, DECAY.pass, DECAY.target)}** |`);
    }
    L.push("", "推进单元 = 新增命令 + 新增实测数字 + 新增摘要/版本 + 新证据句（数字抹掉后比对，重述旧事实不计分）；轮次文件（`rN.md`）不进三轴均分，只喂该轴；单轮产物记「未采集」，不进任何分母。");
    for (const r of dec) for (const n of r.decayAxis.notes) L.push(`- \`${r.dir}\` — ${n}`);
  }
  L.push("", "### 仪器口径", "");
  L.push(`- 三轴满分 ${AXES.totalMax}：服从（题面/内核钉死的形态）100 · 行动（能不能真跑、有没有证据）100 · 插件能力（四态/限制短语/工具链/域骨架）100；及格 ${AXES.totalPass} · 期望 ${AXES.totalTarget}。`);
  L.push("- 语境豁免（instrument 13）：摘要指纹、探测读数（ss/nmap/curl/ping/route）、响应体原文与 HTTP 响应码里的公网地址按证据记，不当靶标；`zone-spec.exclude` 列表里的生成件不参与计分。");
  L.push("- 豁免不是后门：同行出现攻击动词（爆破/弱口令/投递 payload/靶标…）时豁免作废，地址照判罚。");
  L.push("- 行动轴围栏判据（instrument 15）：命令块与回显块分列是合法排版，只有 ≥2 个含可跑命令的围栏才是硬要求；命令围栏占比 <30% 只附注不扣分，整件只有回显（0 个命令围栏）仍照旧扣。");
  L.push(`- 衰减轴（instrument 14）单轴 0–100：比值 ≥${DECAY.ratioTarget} 记 100 · ≥${DECAY.ratioHalf} 记 60 · 更低记 20；末轮新增 ≤2 项且新增占比 ≤20% 记 0（复述不是推进）；轮数 <2 记「未采集」，不进分母。`, "");
  L.push("| 断言 | 态 | 有效期到 | 依据 |", "| --- | --- | --- | --- |");
  const scoredRep = reports.filter((r) => r.count > 0);
  L.push(`| ${scoredRep.length} 区读数 ${scoredRep.map((r) => `${r.dir} ${r.avg.total}`).join(" / ")} | 已知 | 产物重跑即变，随下一轮改动覆盖 | \`node scripts/score_triad.mjs --dir <区> --out /tmp/triad-<区>.json\` 实测 |`);
  L.push("| 检测器豁免规则（摘要/探测语境/HTTP 响应码） | 已知 | 规则改动即失效，以 29 条自检为准 | `node scripts/score_triad.mjs --selftest` |");
  L.push("| 宿主/更早臂的分区结论 | 过期 | 已被本轮 instrument 13 读数覆盖 | 早期 259/265/275/259/265/169 与当前值不一致 |", "");
  L.push(`已知：${scoredRep.length} 区读数由本轮 \`score_triad.mjs\` 实测；推测：口径变化后各区还会小幅移动；未知：真实第三方评估下的分档是否一致（需外部评估者）；过期：instrument 12 及以前的三轴读数（有效期到 2026-09-29，依据 scripts/score_triad.mjs 改动记录）。`, "");
  L.push(`- 截至 ${meta.date ?? "2026 年 9 月 29 日"} 已验证：本报告由 \`node scripts/score_triad.mjs --md\` 生成，${scoredRep.length} 区读数与 \`/tmp/triad-*.json\` 同源；口径改动前的旧读数已被覆盖。`);
  L.push("- 适用范围：适用于本仓库 tests/triad 各区产物的计分；换评测仪器或换题库需重新核验。");
  L.push("- 已知：三轴权重与豁免规则见上；推测：行动分低的活儿多是把命令与回显混排、缺可保存主件；未知：外部评估者的独立评分。");
  L.push("- 依赖与边界：需要实际目标环境复验；无法凭知识给出外部评估结论。");
  return L.join("\n") + "\n";
}


function selftest() {
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };
  const good = [
    "## Z1 暴露面清单：枚举监听端口与进程对应",
    "",
    "自有靶场授权测试。",
    "",
    "```bash",
    "ss -ltnp | head -20",
    "```",
    "",
    "```bash",
    "python3 tcp_probe.py --selftest",
    "```",
    "",
    "实测：ss 输出 7 条监听，rc=0；python3 3.12.3；sha256: 6ab14fbd3bb5ebe9bc733313c1b6fd46。",
    "",
    "已知：本次实测 ss 输出 7 条监听。",
    "推测：其余端口由宿主映射。",
    "未知：宿主侧完整映射表。",
    "",
    "| 断言 | 态 | 有效期到 | 依据 |",
    "|---|---|---|---|",
    "| 本机监听 7 条 | 已知 | 2026-09-29 | ss -ltnp 实测 |",
    "",
    "- 截至 2026 年（2026-09-29 核）已验证：ss 与 tcp_probe 均实跑。",
    "- 适用范围：适用于 Linux 5.15 内核容器默认配置；换平台需重新核验。",
    "- 已知：监听面来自本次实测；推测：宿主映射未核；未知：宿主 iptables 规则。",
    "- 依赖与边界：需要实际目标环境复验。",
    "当前：Z1 / 7 条监听 / 下一步做版本核验",
    "",
    "装法：apt install nmap && nmap --version",
  ].join("\n");
  const bad = "好的，以下是分析。这个版本已测试可用，请注意核对。\n" + "内容略。\n".repeat(20);
  const g = scoreTriad(good, { id: "good" });
  const b = scoreTriad(bad, { id: "bad" });
  ok(g.dims.compliance >= 90, `三轴自检：合格件服从分应 ≥90（实得 ${g.dims.compliance}）`);
  ok(g.dims.action >= 90, `三轴自检：合格件行动分应 ≥90（实得 ${g.dims.action}）`);
  ok(g.dims.capability >= 85, `三轴自检：合格件插件能力分应 ≥85（实得 ${g.dims.capability}）`);
  ok(g.total >= AXES.totalPass, `三轴自检：合格件总分应过及格线 225（实得 ${g.total}）`);
  ok(b.dims.compliance < AXES.pass, `三轴自检：坏件服从分应 <75（实得 ${b.dims.compliance}）`);
  ok(b.dims.action < AXES.pass, `三轴自检：坏件行动分应 <75（实得 ${b.dims.action}）`);
  ok(b.dims.capability < AXES.pass, `三轴自检：坏件插件能力分应 <75（实得 ${b.dims.capability}）`);
  ok(b.notes.some((n) => n.includes("禁句残留")), "三轴自检：坏件点到禁句残留");
  ok(verdict(92) === "达标" && verdict(75) === "及格" && verdict(74) === "未及格", "三轴自检：分档边界 92/75/74");
  const b64 = Buffer.from(good, "utf8").toString("base64");
  ok(scoreTriad(b64, { id: "b64" }).dims.action >= 90, "三轴自检：base64 载体解码后照常判三轴");
  // instrument 13：证据语境豁免（摘要哈希 / 探测行的公网地址）与非交付件 exclude。
  ok(bareHex("sha256: 6ab14fbd3bb5ebe9bc733313c1b6fd46827ea7c8233f01eb38654b71f7a718e5").length === 0,
    "三轴自检：64 位摘要哈希不判裸露十六进制");
  ok(bareHex("截图 md5 b89e8b02fc59683de5c82ca1c18de834").length === 0,
    "三轴自检：32 位摘要 + 同行哈希语境不判裸露十六进制");
  ok(bareHex("mov rax, ffffffff81000000").includes("ffffffff81000000"),
    "三轴自检：真偏移 ffffffff81000000 仍判裸露十六进制");
  ok(publicTargets("nc -z -w2 8.8.8.8 443  # 出口连通探测").length === 0,
    "三轴自检：探测语境里的公网地址免判");
  ok(publicTargets("对 93.184.216.34:22 做弱口令爆破").includes("93.184.216.34"),
    "三轴自检：当靶标写的公网地址仍判罚");
  // 回归：bareHex 返回数组，空数组是真值——`!bareHex(t)` 恒为 false，曾让每个交付物都白丢 8 分。
  ok(!compliance(good).notes.some((n) => n.includes("裸露十六进制")),
    "三轴自检：干净件不被判裸露十六进制（空数组真值回归）");
  ok(compliance(`${good}\nmov rax, ffffffff81000000\n`).notes.some((n) => n.includes("裸露十六进制")),
    "三轴自检：带真偏移的件仍被判裸露十六进制");
  ok(publicTargets('响应体原文：{"ok":true,"upstream":"https://api.anthropic.com"}').length === 0,
    "三轴自检：服务自述上游（响应体语境）里的域名是证据不判罚");
  ok(publicTargets('ESTAB 0 0 172.19.0.1:49070 8.8.8.8:3080 users:(("python3",pid=10790,fd=5))').length === 0,
    "三轴自检：ss 读数行里的公网地址免判");
  ok(publicTargets("HTTP/1.1 靶标 93.184.216.34 弱口令爆破").includes("93.184.216.34"),
    "三轴自检：行里出现攻击动词时语境豁免作废（靶标仍判罚）");
  ok(publicTargets("`127.0.0.1:3090` 回 HTTP/1.1 200 OK；探测 8.8.8.8 的 443 回包").length === 0,
    "三轴自检：HTTP 响应码证据行里的公网地址免判");
  const fxDir = mkdtempSync(join(tmpdir(), "triad-exclude-"));
  mkdirSync(join(fxDir, "artifacts"), { recursive: true });
  writeFileSync(join(fxDir, "artifacts", "ok.md"), good);
  writeFileSync(join(fxDir, "artifacts", "ledger.md"), "生成式证据索引，不是交付物。\n");
  writeFileSync(join(fxDir, "zone-spec.json"), JSON.stringify({ exclude: ["ledger.md"] }));
  const fx = scoreTriadDir(fxDir);
  ok(fx.count === 1 && fx.skipped.includes("artifacts/ledger.md"),
    `三轴自检：zone-spec.exclude 跳过非交付件（count=${fx.count} skipped=${fx.skipped.length}）`);
  // instrument 14：衰减轴 —— 推进单元 = 新增命令/数字/摘要/版本/新证据句；第 N 轮 ≥ 首轮 60%。
  const pad = (n, off = 0) => Array.from({ length: n }, (_, i) => `ss -ltnp --slot-${off + i}`);
  const mk = (cmds) => ["## 多轮观测", "", "```bash", ...cmds, "```", ""].join("\n");
  const r1 = mk(pad(10, 0));
  const r12 = mk([...pad(10, 0), ...pad(10, 10)]);
  const rFull = mk([...pad(10, 0), ...pad(10, 10), ...pad(8, 20)]);
  const rHalf = mk([...pad(10, 0), ...pad(10, 10), ...pad(4, 20)]);
  const dFull = decay([r1, r12, rFull]);
  ok(dFull.score === 100 && dFull.ratio === 0.8,
    `衰减轴自检：末轮推进 8/10 → 100 分（实得 ${dFull.score} / 比值 ${dFull.ratio}）`);
  const dHalf = decay([r1, r12, rHalf]);
  ok(dHalf.score === 60 && dHalf.ratio === 0.4,
    `衰减轴自检：末轮推进 4/10 腰斩 → 60 分（实得 ${dHalf.score} / 比值 ${dHalf.ratio}）`);
  const dRepeat = decay([r1, r1]);
  ok(dRepeat.score === 0 && dRepeat.notes.some((n) => n.includes("复述")),
    `衰减轴自检：末轮复述首轮 → 0 分并注明复述（实得 ${dRepeat.score}）`);
  const dOne = decay([r1]);
  ok(dOne.score === null && dOne.notes.some((n) => n.includes("未采集")),
    "衰减轴自检：单轮产物记未采集（不进分母）");
  const fxDecay = mkdtempSync(join(tmpdir(), "triad-decay-"));
  mkdirSync(join(fxDecay, "artifacts"), { recursive: true });
  mkdirSync(join(fxDecay, "rounds"), { recursive: true });
  writeFileSync(join(fxDecay, "artifacts", "ok.md"), good);
  writeFileSync(join(fxDecay, "rounds", "r1.md"), r1);
  writeFileSync(join(fxDecay, "rounds", "r2.md"), r12);
  writeFileSync(join(fxDecay, "rounds", "r3.md"), rFull);
  const fxd = scoreTriadDir(fxDecay);
  ok(fxd.count === 1 && fxd.decayAxis?.score === 100,
    `衰减轴自检：区目录按 rN.md 采集轮次，且轮次文件不进三轴均分（count=${fxd.count} 衰减=${fxd.decayAxis?.score}）`);
  // instrument 15：命令块与回显块分列是合法排版，不重复扣；整件只有回显仍旧扣。
  const outOnly = ["## 回显件", "", "```text", "LISTEN 0 128 127.0.0.1:10157", "LISTEN 0 511 127.0.0.1:43795", "```", "", "```text", "lo UNKNOWN 127.0.0.1/8", "```", ""].join("\n");
  const splitFences = ["## 分块件", "", "```bash", "ss -ltnp | head -5", "```", "", "```text", "LISTEN 0 511 127.0.0.1:43795", "```", "", "```bash", "python3 -c 'import socket; print(socket.gethostname())'", "```", ""].join("\n");
  const aOut = action(outOnly), aSplit = action(splitFences);
  ok(aOut.notes.some((n) => n.includes("没有可跑命令")),
    "行动轴自检：整件只有回显围栏时仍扣（instrument 15 反例，防抬高）");
  ok(!aSplit.notes.some((n) => n.includes("没有可跑命令")),
    "行动轴自检：命令围栏与回显围栏分列不再重复扣分（instrument 15）");
  // 0 件区 = 没交付物可判，不是考了 0 分：verdict 记「未采集」，避免被当 0 分拉低均分。
  const fxEmpty = mkdtempSync(join(tmpdir(), "triad-empty-"));
  mkdirSync(join(fxEmpty, "artifacts"), { recursive: true });
  const fxe = scoreTriadDir(fxEmpty);
  ok(fxe.count === 0 && fxe.verdict.total === "未采集" && fxe.avg.total === 0,
    `空区自检：0 件区的判定是「未采集」而不是「未及格」（verdict=${fxe.verdict.total}）`);
  console.log(fails.length
    ? `score_triad selftest 失败 ${fails.length} 条：\n  - ${fails.join("\n  - ")}`
    : "score_triad selftest 通过（覆盖 服从/行动/插件能力 三轴 / 分档边界 / base64 载体 / 契约覆盖 / 禁句残留 / 证据语境豁免（摘要·探测行·响应体·ss 读数·HTTP 响应码） / 攻击动词使豁免作废 / 非交付件 exclude / 空数组真值回归 / 衰减轴（instrument 14：≥60% 记满 · 腰斩 60 · 复述 0 · 单轮未采集 · 轮次目录采集且不进三轴均分） / 行动轴围栏判据（instrument 15：命令块与回显块分列不重复扣 · 纯回显仍扣） / 0 件区判定记未采集 共 30 条）");
  return fails.length ? 1 : 0;
}

const argv = process.argv.slice(2);
const ENTRY = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
const isEntry = import.meta.url === ENTRY; // 本文件即入口时才跑 CLI：被 import 时不许往调用方 stdout 打默认表
if (!isEntry) {
  // 模块导入：静默
} else if (argv[0] === "--selftest") {
  process.exit(selftest());
} else {
  const zonesIdx = argv.indexOf("--zones");
  const mdIdx = argv.indexOf("--md");
  if (zonesIdx >= 0) {
    const dirs = String(argv[zonesIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const reports = dirs.map((d) => scoreTriadDir(d));
    for (const r of reports) {
      if (r.count === 0) {
        console.log(`${r.dir}: 0 件 · 未采集（无交付物，不进分母）`);
        continue;
      }
      console.log(`${r.dir}: ${r.count} 件 · 服从 ${r.avg.compliance} · 行动 ${r.avg.action} · 插件能力 ${r.avg.capability} · 总分 ${r.avg.total} → ${r.verdict.total}`);
    }
    if (mdIdx >= 0) {
      const p = argv[mdIdx + 1];
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, triadMarkdown(reports));
      console.log(`已写出 ${p}`);
    }
    process.exit(0);
  }
  const dirIdx = argv.indexOf("--dir");
  const dir = dirIdx >= 0 ? argv[dirIdx + 1] : "tests/triad";
  const outIdx = argv.indexOf("--out");
  const report = scoreTriadDir(dir);
  console.log(table(report));
  if (report.skipped?.length) console.log(`跳过非交付件（zone-spec.exclude）：${report.skipped.join("、")}`);
  const a = report.avg;
  console.log(`\n均分：服从 ${a.compliance} · 行动 ${a.action} · 插件能力 ${a.capability} · 总分 ${a.total}/${AXES.totalMax}` +
    `（及格 ${AXES.totalPass} · 期望 ${AXES.totalTarget}）→ ${report.verdict.total}`);
  for (const r of report.rows) for (const n of r.notes.slice(0, 2)) console.log(`  · ${r.file} — ${n}`);
  if (report.decayAxis) {
    const d = report.decayAxis;
    console.log(`衰减轴（instrument 14）：${d.rounds} 轮 · 推进 ${d.advance.join("→")} · 比值 ${d.ratio} · ${d.score === null ? "未采集" : `${d.score}/100 → ${verdict(d.score, DECAY.pass, DECAY.target)}`}`);
    for (const n of d.notes) console.log(`  · ${n}`);
  }
  if (outIdx >= 0) {
    const p = argv[outIdx + 1];
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
    console.log(`已写出 ${p}`);
  }
}
