#!/usr/bin/env node
// ig5-estimate —— 把一句需求变成「档位 / 形态 / 问法 / 工时 / 日历 / 人民币 / 相位 / 维护期」。
// 口径全部来自 data/cot-router.mjs（与 ui-preview/cot-router-preview.html 同源，逐字节同核）。
// 用法：
//   node scripts/estimate.mjs "帮我设计一个记账 App 的界面，要有预算环和月历"
//   node scripts/estimate.mjs --json "长线项目：多端 App + 后台，持续维护，SLA 监控告警"
//   node scripts/estimate.mjs --modules 6 --platforms 3 --integrations 4 "设计一个设备管理后台"
//   node scripts/estimate.mjs --clause            # 只打印注入条款（贴进 prompt 的那段）
//   node scripts/estimate.mjs --selftest          # 自检：判档 + 估算不变量
// 选项：--json --tier T1|T2|T3 --ai-rate N --human-rate N --ai-share 0..1
//       --modules N --platforms N --integrations N --users N --clause --anchor --selftest --help
import { analyze, renderRouterClause, renderRouterAnchor, COT_VERSION, TIERS } from "../data/cot-router.mjs";

const argv = process.argv.slice(2);
const opts = { rate: {} };
const words = [];
const num = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} 需要一个 ≥0 的数字，收到 ${v}`);
  return n;
};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => {
    const v = argv[++i];
    if (v === undefined) throw new Error(`${a} 缺少参数值`);
    return v;
  };
  switch (a) {
    case "--json": opts.json = true; break;
    case "--clause": opts.clause = true; break;
    case "--anchor": opts.anchor = true; break;
    case "--selftest": opts.selftest = true; break;
    case "--tier": {
      const t = next().toUpperCase();
      if (!TIERS.includes(t)) throw new Error(`--tier 只接受 ${TIERS.join(" / ")}`);
      opts.tier = t;
      break;
    }
    case "--ai-rate": opts.rate.aiHourly = num(next(), "--ai-rate"); break;
    case "--human-rate": opts.rate.humanHourly = num(next(), "--human-rate"); break;
    case "--ai-share": {
      const s = Number(next());
      if (!(s >= 0 && s <= 1)) throw new Error("--ai-share 取值 0..1");
      opts.rate.aiShare = s;
      break;
    }
    case "--hours-per-day": opts.rate.calendarHoursPerDay = num(next(), "--hours-per-day"); break;
    case "--modules": opts.modules = num(next(), "--modules"); break;
    case "--platforms": opts.platforms = num(next(), "--platforms"); break;
    case "--integrations": opts.integrations = num(next(), "--integrations"); break;
    case "--users": opts.users = num(next(), "--users"); break;
    case "-h": case "--help": opts.help = true; break;
    default:
      if (a.startsWith("--")) throw new Error(`未知选项 ${a}（--help 看用法）`);
      words.push(a);
  }
}

const yuan = (n) => `¥${(Math.round(n * 100) / 100).toLocaleString("zh-CN")}`;
const hh = (n) => (n < 1 ? `${Math.round(n * 60)} 分钟` : `${Math.round(n * 10) / 10} 小时`);

if (opts.help || (!opts.selftest && !opts.clause && words.length === 0)) {
  console.log(`ig5-estimate (${COT_VERSION})
用法：node scripts/estimate.mjs [选项] "需求原文…"
      node scripts/estimate.mjs --clause     只打印注入条款
      node scripts/estimate.mjs --selftest   自检
选项：--json --tier T1|T2|T3 --ai-rate N --human-rate N --ai-share 0..1 --hours-per-day N
      --modules N --platforms N --integrations N --users N --anchor`);
  process.exit(opts.help ? 0 : 2);
}

if (opts.clause) {
  console.log(renderRouterClause());
  process.exit(0);
}

// ── 自检 ────────────────────────────────────────────────────────────────
if (opts.selftest) {
  const cases = [
    ["T1", "这个报错怎么改：TypeError: Cannot read properties of undefined"],
    ["T2", "帮我设计一个记账 App 的界面，要有预算环和月历，给几个方案"],
    ["T3", "长线项目：多端记账 App + 后台，要持续维护，SLA 和监控告警都要"],
  ];
  let pass = 0, fail = 0;
  const chk = (cond, label, extra = "") => {
    cond ? pass++ : fail++;
    if (!cond) console.log(`  ✗ ${label} ${extra}`);
  };
  for (const [tier, text] of cases) {
    const a = analyze(text);
    chk(a.tier === tier, `判档 ${tier}`, `实得 ${a.tier} :: ${text}`);
    chk(a.estimate.hours.min < a.estimate.hours.mid && a.estimate.hours.mid < a.estimate.hours.max, `${tier} 人时三点单调`);
    chk(a.estimate.money.ai < a.estimate.money.blended && a.estimate.money.blended < a.estimate.money.human, `${tier} 报价三档单调`);
    chk(a.estimate.billedHours >= a.estimate.hours.mid, `${tier} 计费人时含应急与验收`);
    chk((tier === "T3") === (a.estimate.maintenance !== null), `${tier} 维护期挂载规则`);
    chk(tier === "T2" ? a.needsPreview === true : true, `${tier} 预览件触发`);
  }
  chk(analyze("", {}).tier === "T1", "空串退化为 T1（不猜不拦）");
  const forced = analyze("随便写个东西", { tier: "T2" });
  chk(forced.tier === "T2" && forced.forced === true, "强制档位生效");
  const cheap = analyze("设计一个界面", { rate: { aiHourly: 10, aiShare: 1 } });
  chk(Math.abs(cheap.estimate.money.blended - cheap.estimate.billedHours * 10) < 0.02, "自定义费率生效");
  chk(renderRouterClause().includes("T3") && /人民币/.test(renderRouterClause()), "注入条款含三档与人民币");
  chk(renderRouterAnchor("设计一个界面").includes("T2"), "锚点带档位");
  console.log(`ig5-estimate 自检 · ${COT_VERSION} · 通过 ${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
}

// ── 正常路径 ────────────────────────────────────────────────────────────
const text = words.join(" ");
const r = analyze(text, opts);
const { tier, meta, why, estimate: e, needsPreview, needsSearch, forced } = r;

// 预览件触发但用户没要预览：这里只报「该出预览件」，不自动生成。
const nextSteps = [];
if (needsPreview) nextSteps.push("先出 HTML+CSS+JS 替代性预览（可点、可切档）");
if (needsSearch) nextSteps.push("检索同类设计方案后再定稿（选型/对比类）");
if (tier === "T3") nextSteps.push("给混合路线 + 里程碑 + 维护期节奏，不停在简单方案");

if (opts.json) {
  console.log(JSON.stringify({
    version: COT_VERSION, text, tier, tierName: meta.name, forced: forced === true,
    why: { rule: why.rule, evidence: why.evidence, score: why.score },
    needsPreview, needsSearch,
    hours: e.hours, calendarDays: e.calendarDays, calendarText: e.calendarText,
    billedHours: e.billedHours, money: e.money, rate: e.rate,
    phases: e.phases, maintenance: e.maintenance, questionPolicy: meta.questionPolicy,
    nextSteps,
  }, null, 2));
  process.exit(0);
}

const L = [];
L.push(`需求：${text.slice(0, 120)}`);
L.push(`档位：${tier} · ${meta.name}${forced ? "（强制指定）" : ""}`);
L.push(`判据：${why.rule} ｜ 证据：${why.evidence.join(" / ") || "无"}`);
L.push(`形态：${meta.shape}`);
L.push(`问法：${meta.questionPolicy}`);
L.push("");
L.push(`工时：${hh(e.hours.min)} ～ ${hh(e.hours.max)}（中值 ${hh(e.hours.mid)}）· 计费 ${hh(e.billedHours)}`);
L.push(`日历：${e.calendarText}`);
L.push(`报价：混合 ${yuan(e.money.blended)}｜纯 AI 工时 ${yuan(e.money.ai)}｜全程人工 ${yuan(e.money.human)}`);
L.push(`费率：AI ${yuan(e.rate.aiHourly)}/时 · 人工 ${yuan(e.rate.humanHourly)}/时 · AI 占比 ${Math.round(e.rate.aiShare * 100)}%`);
L.push("");
L.push("相位：");
for (const p of e.phases) L.push(`  · ${p.name}：${hh(p.hours)}（占 ${p.share}）`);
if (e.maintenance) {
  L.push(`维护期：${yuan(e.maintenance.monthly)}/月 · 半年 ${yuan(e.maintenance.months6)} · 全年 ${yuan(e.maintenance.months12)}`);
  L.push(`  ${e.maintenance.node}`);
}
if (nextSteps.length) {
  L.push("");
  L.push("下一步：");
  for (const s of nextSteps) L.push(`  · ${s}`);
}
if (opts.anchor) { L.push(""); L.push(renderRouterAnchor(text)); }
console.log(L.join("\n"));
