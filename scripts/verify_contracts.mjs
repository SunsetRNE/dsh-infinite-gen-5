// 无限五代 · 服从性轴收口门禁（离线、确定性、无需 API Key、不写用户目录）
//
// 针对的要求（m01941「服从性测试」轴）：契约本体已经铺在六条通道上 —— 首句层、内核注入、
// 工具目录表面、技能通道、子代理任务书、评分口径。但「判据自己会不会腐烂」此前没有任何门禁：
// contractsSelftest() 全仓 0 个调用点，新增一种契约类型不补自测也无人发现。
// 本脚本把轴收口成三块可跑判据，并把它自己挂进 verify:all，防止门禁被悄悄摘钩。
//
//   A 判据自检：contractsSelftest() 必须自己先过（它一失败，六条通道的判据全部不可信）
//   B 类型覆盖：CONTRACT_KINDS 每一种都必须在自测正文里出现（不补 = 失败）
//   C 通道矩阵：六条通道的载体串在场 + 通道门禁脚本存在 + 已挂在 verify:all 链上
//
// 用法：node scripts/verify_contracts.mjs [--root DIR] [--json]
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { contractsSelftest, CONTRACT_KINDS } from "./lib/contracts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const asJson = argv.includes("--json");
const ROOT = resolve(flag("--root") || join(HERE, ".."));

/** 六条通道：每条给「载体文件 + 必须出现的串」与「通道门禁」。字符串全部是实测到的标识符。 */
const CHANNELS = [
  {
    id: "first-line",
    label: "首句层（Order -1100，排在宿主身份段之前）",
    files: [{ path: "anchor-armor.mjs", all: ["FIRST_LINE_TEXT", "CONTRACT_MARK", "CONTRACT_SHORT"] }],
    gate: "verify:armor",
  },
  {
    id: "kernel",
    label: "内核提示注入（apply 时把契约短形推进系统提示）",
    files: [{ path: "index.js", all: ["anchor-armor", "CONTRACT_SHORT", "withContract"] }],
    gate: "harness:check",
  },
  {
    id: "tool-surface",
    label: "工具目录 / 技能 front-matter / 真末位锚点回指行",
    files: [
      { path: "anchor-armor.mjs", all: ["withContract"] },
      { path: "scripts/verify_surface.mjs", all: ["CONTRACT_MARK"] },
    ],
    gate: "verify:surface",
  },
  {
    id: "skill",
    label: "技能通道（技能正文逐字节含首句层 + 副本漂移检测）",
    files: [{ path: "scripts/verify_skill.mjs", all: ["FIRST_LINE_TEXT", "CONTRACT_SHORT"] }],
    gate: "verify:skill",
  },
  {
    id: "subagent",
    label: "子代理任务书与服从性题库（一次性契约行 + os 号题目）",
    files: [
      { path: "scripts/oneshot_harness.mjs", all: ["BANK_COMPLIANCE", "服从性题库"] },
      { path: "scripts/verify_dispatch.mjs", all: ["withContract"] },
    ],
    gate: "verify:dispatch",
  },
  {
    id: "scoring",
    label: "评分口径（契约命中逐条判定 / 服从分）",
    files: [
      { path: "scripts/score_oneshot.mjs", all: ["checkContract"] },
      { path: "scripts/score_triad.mjs", all: ["checkContract"] },
      { path: "scripts/lib/contracts.mjs", all: ["CONTRACT_KINDS", "contractsSelftest", "checkContract"] },
    ],
    gate: "verify:oneshot",
  },
];

const SELF_GATE = "verify:contracts";
const fails = [];
const bad = (m) => fails.push(m);
const rows = [];

const readText = (rel) => {
  const full = join(ROOT, rel);
  if (!existsSync(full)) return null;
  try {
    return readFileSync(full, "utf8");
  } catch {
    return null;
  }
};

// ── A 判据自检 ────────────────────────────────────────────────────────────────
const selftestRc = contractsSelftest();

// ── B 类型覆盖：每种契约类型都必须在自测正文里被引用 ────────────────────────
const contractsSrc = readText("scripts/lib/contracts.mjs") || "";
const selftestBody = contractsSrc.slice(contractsSrc.indexOf("export function contractsSelftest"));
const coveredKinds = new Set([...selftestBody.matchAll(/kind:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]));
const missingKinds = CONTRACT_KINDS.filter((k) => !coveredKinds.has(k));
for (const k of missingKinds) bad(`契约类型 ${k} 没有自测（新增 kind 必须同时补一条，否则判据会腐烂）`);

// ── C 通道矩阵 ───────────────────────────────────────────────────────────────
const pkgText = readText("package.json") || "{}";
let scripts = {};
try {
  scripts = JSON.parse(pkgText).scripts || {};
} catch (e) {
  bad(`package.json 解析失败：${e.message}`);
}
const chain = scripts["verify:all"] || "";
const inChain = (gate) => new RegExp(`npm run ${gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w:.-])`).test(chain);

for (const ch of CHANNELS) {
  const detail = [];
  let ok = true;
  for (const f of ch.files) {
    const text = readText(f.path);
    if (text === null) {
      ok = false;
      detail.push(`缺文件 ${f.path}`);
      continue;
    }
    const miss = (f.all || []).filter((s) => !text.includes(s));
    if (miss.length) {
      ok = false;
      detail.push(`${f.path} 缺 ${miss.join("/")}`);
    }
  }
  if (!scripts[ch.gate]) {
    ok = false;
    detail.push(`门禁 ${ch.gate} 未注册在 package.json`);
  }
  if (!inChain(ch.gate)) {
    ok = false;
    detail.push(`门禁 ${ch.gate} 未挂在 verify:all 链上`);
  }
  if (!ok) bad(`通道 ${ch.id}（${ch.label}）：${detail.join("；")}`);
  rows.push({ id: ch.id, label: ch.label, gate: ch.gate, ok, detail });
}

// 自证钩子：本门禁自己必须挂在链上，否则「收口」只是一句话。
const selfHooked = !!scripts[SELF_GATE] && inChain(SELF_GATE);
if (!selfHooked) bad(`本门禁 ${SELF_GATE} 未挂在 verify:all 链上（收口门禁不许被摘钩）`);

const channelsOk = rows.filter((r) => r.ok).length;
const summary = {
  selftestRc,
  kinds: CONTRACT_KINDS.length,
  missingKinds,
  channels: rows,
  channelsOk,
  fails,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log("服从性轴收口门禁（离线 · 不写用户目录）");
  console.log(`A 判据自检：contractsSelftest RC=${selftestRc}（失败即六条通道的判据全部不可信）`);
  console.log(`B 类型覆盖：${CONTRACT_KINDS.length - missingKinds.length}/${CONTRACT_KINDS.length} 种契约类型有自测${missingKinds.length ? `（缺 ${missingKinds.join("/")}）` : ""}`);
  console.log(`C 通道矩阵：${channelsOk}/${rows.length} 条通道在场，自证钩子 ${selfHooked ? "已挂链" : "未挂链"}`);
  for (const r of rows) console.log(`  ${r.ok ? "✓" : "✗"} ${r.id.padEnd(13)} ${r.label} · 门禁 ${r.gate}`);
  for (const f of fails) console.log(`  ✗ ${f}`);
}

if (fails.length || selftestRc !== 0) {
  console.log(`服从性轴收口门禁未通过（${fails.length} 条问题）`);
  process.exit(1);
}
console.log(`服从性轴收口门禁通过（${rows.length} 条通道 · ${CONTRACT_KINDS.length} 种契约类型 · 判据自检 ${selftestRc === 0 ? "1 次通过" : "未过"} · 链上自证已挂）`);
