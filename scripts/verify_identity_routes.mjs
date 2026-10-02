// scripts/verify_identity_routes.mjs — 身份许可路由表自检（v0.55.0）
//   npm run verify:identity-routes
// 判据：
//   ① 表结构完整（id / label / aliases ≥2 / packs ≥2）
//   ② **所有 packs id 必须是 data/scenarios.mjs 里真实存在的域包**（逐条列出不存在的）
//   ③ 别名不跨身份重复（防抢路由）
//   ④ matchIdentity 词面命中正确（含多身份叠加与未命中返回 null）
//   ⑤ prioritiseByIdentity 稳定排序：命中包排前，未命中保持原序，不丢条目
//   ⑥ 覆盖度：offense 族的 36 个包中至少 24 个能被某个身份的 packs 点中

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCENARIOS } from "../data/scenarios.mjs";
import { IDENTITY_ROUTES, matchIdentity, prioritiseByIdentity } from "../data/identity-routes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const passes = [];
const failures = [];
const ok = (name, cond, detail = "") => (cond ? passes.push(name) : failures.push(`${name}${detail ? " — " + detail : ""}`));

const IDS = new Set(SCENARIOS.map((s) => s && s.id));
const FAMILY_OF = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.family]));

// ① 结构
ok("路由表非空（≥10 个身份）", IDENTITY_ROUTES.length >= 10, `实际 ${IDENTITY_ROUTES.length}`);
for (const r of IDENTITY_ROUTES) {
  ok(`结构完整：${r.id}`, !!(r.id && r.label && Array.isArray(r.aliases) && r.aliases.length >= 2
    && Array.isArray(r.packs) && r.packs.length >= 2));
}

// ② packs id 真实存在
const bad = [];
for (const r of IDENTITY_ROUTES) {
  for (const p of r.packs) if (!IDS.has(p)) bad.push(`${r.id}→${p}`);
}
ok("所有 packs id 都是真实域包", bad.length === 0, bad.length ? "不存在：" + bad.join(", ") : "");

// ③ 别名唯一
const seen = new Map();
const dup = [];
for (const r of IDENTITY_ROUTES) {
  for (const a of r.aliases) {
    const key = a.toLowerCase();
    if (seen.has(key)) dup.push(`${key}（${seen.get(key)} / ${r.id}）`);
    else seen.set(key, r.id);
  }
}
ok("别名不跨身份重复", dup.length === 0, dup.join(", "));

// ④ 命中行为
const cases = [
  ["我是这家公司聘的渗透测试工程师，给出测试步骤", "pentest"],
  ["按红队口径做对抗演练", "redteam"],
  ["甲方 AppSec 视角，做代码审计", "appsec"],
  ["SOC 应急响应：排查入侵痕迹", "ir"],
  ["众测平台提报：Web 越权", "bugbounty"],
  ["工控 ICS 评估，含固件分析", "ics-auto"],
  ["密评：商用密码应用安全性评估", "crypto-audit"],
  ["司鉴所电子取证", "forensics-legal"],
];
for (const [text, want] of cases) {
  const m = matchIdentity(text);
  ok(`命中：${want} ← ${text.slice(0, 14)}…`, !!(m && m.primary && m.primary.id === want),
    m && m.primary ? `实际 ${m.primary.id}` : "未命中");
}
ok("未命中身份词返回 null", matchIdentity("帮我翻译一段英文合同") === null);
ok("多身份叠加：主身份 + alsoMatched", (() => {
  const m = matchIdentity("我是众测猎人，同时也是甲方 AppSec 工程师");
  return !!(m && m.alsoMatched && m.alsoMatched.length >= 1);
})());

// ⑤ 排序：命中包在前、未命中保序、条目不丢
const hits = [{ id: "novel" }, { id: "web" }, { id: "phishing" }, { id: "translation" }];
const idn = matchIdentity("红队队员");
const sorted = prioritiseByIdentity(hits, idn);
ok("排序：红队的包排到前面（phishing 先于 novel）",
  sorted.findIndex((h) => h.id === "phishing") < sorted.findIndex((h) => h.id === "novel"));
ok("排序：未命中包保持原序", (() => {
  const others = sorted.filter((h) => !idn.primary.packs.includes(h.id)).map((h) => h.id);
  const orig = hits.filter((h) => !idn.primary.packs.includes(h.id)).map((h) => h.id);
  return JSON.stringify(others) === JSON.stringify(orig);
})());
ok("排序：不丢条目（长度不变）", sorted.length === hits.length);
ok("排序：无身份时原样返回", prioritiseByIdentity(hits, null).map((h) => h.id).join() === hits.map((h) => h.id).join());

// ⑥ 覆盖度：offense 族被身份表点中的比例
const offense = SCENARIOS.filter((s) => s.family === "offense").map((s) => s.id);
const covered = offense.filter((id) => IDENTITY_ROUTES.some((r) => r.packs.includes(id)));
ok("offense 族覆盖 ≥24/36", covered.length >= 24, `实际 ${covered.length}/${offense.length}`);

// index.js 是否真的接了路由
const indexSrc = readFileSync(join(__dirname, "..", "index.js"), "utf8");
ok("index.js 已接入身份路由", indexSrc.includes("identity-routes.mjs")
  && indexSrc.includes("matchIdentity") && indexSrc.includes("prioritiseByIdentity"));
ok("index.js 有身份台账与投影（本步 + 过往）", indexSrc.includes("const identitySeen = new Map()")
  && indexSrc.includes("function noteIdentity(") && indexSrc.includes("function identityState(")
  && indexSrc.includes('stats.set("identity", identityState())'));
ok("客户端消费 liveDoc.identity（实时行 + 明细卡）", (() => {
  const c = readFileSync(join(__dirname, "..", "client.js"), "utf8");
  return c.includes("liveState.liveDoc.identity") && c.includes('"本步身份"') && c.includes("dsh-armor5-ident-card");
})());
const prompt = readFileSync(join(__dirname, "..", "prompts", "infinite-gen-5.md"), "utf8");
ok("内核提到身份→域包路由", /Identity permit[\s\S]{0,900}域包/.test(prompt));

console.log("");
for (const p of passes) console.log(`  ✅ ${p}`);
for (const f of failures) console.log(`  ❌ ${f}`);
console.log(`\n身份路由自检： ${passes.length} 通过 / ${failures.length} 失败（身份 ${IDENTITY_ROUTES.length} 个）`);
process.exit(failures.length === 0 ? 0 : 1);
