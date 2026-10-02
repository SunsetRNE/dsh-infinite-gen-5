#!/usr/bin/env node
// verify_host_takeover.mjs —— 按上游 DSH 布局精准接管的回归（v0.52.10）
//
// 表来自官方上游实现 `@deepseek-ai/dsh`（repository = deepseek-ai/deepseek-harness，
// directory = apps/cli）里的 `dsh-system-prompt/lib/index.js`：
//   SECTION_ORDERS / CONTEXT_ORDERS / PERSONA_*_SECTION。
// 本套回归守住三件事：
//   ① 表本身抄对了（数字逐条比对，改错一位就红）；
//   ② 精准接管按「段族 + 上下文」两路走，且 resident 档一段不剔；
//   ③ 我们的裁决条款 order 不与平台任何段撞车（上游 STRUCTURED_OUTPUT 正是 9900）。
// 用法：node scripts/verify_host_takeover.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "index.js"), "utf8");
const cat = await import(new URL("../data/host-catalog.mjs", import.meta.url).href);
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};

// ---- ① 上游表抄写正确 ----
const EXPECT = {
  HARNESS_IDENTITY: -1000, DEPLOYMENT_PERSONA_PREFIX: 0, PLAN_POLICY: 500, TEAM_POLICY: 600,
  PTC_ONLY: 800, FILE_REFERENCE: 900, TOOL_BASH: 1000, TOOL_PWSH: 1010, TOOL_READ: 1100,
  TOOL_WRITE: 1200, TOOL_EDIT: 1300, TOOL_GLOB: 1400, TOOL_GREP: 1500, TOOL_JOBS: 1600,
  TOOL_PTY: 1700, TOOL_WEB_SEARCH: 2000, TOOL_WEB_FETCH: 2100, TOOL_LSP: 2200,
  TOOL_SESSION_QUERY: 2300, TOOL_GOAL: 2400, TOOL_WORKFLOW: 2600, TOOL_RALPH: 2700,
  TOOL_SUBAGENT: 2800, TOOL_REPORT: 2900, TOOL_COMPUTER_USE: 3000, MCP_SERVERS: 3100,
  TOOLS_SDK: 5000, DELIVERABLE_FILE_REFERENCES: 9000, STRUCTURED_OUTPUT: 9900,
  HARNESS_SOURCE: 10000, WEB_SURFACE: 10100, DEPLOYMENT_PERSONA_SUFFIX: 10200,
};
const got = cat.HOST_SECTION_ORDERS;
const bad = Object.entries(EXPECT).filter(([k, v]) => got[k] !== v);
check(`上游段表 32 条逐条一致（键数 ${Object.keys(got).length}）`,
  Object.keys(got).length === 32 && bad.length === 0, bad.map(([k, v]) => `${k}:${got[k]}≠${v}`).join(","));
check("上游上下文表三条（沙箱/审批/委派）与数字一致",
  cat.HOST_CONTEXT_ORDERS.SANDBOX_POLICY === 110 && cat.HOST_CONTEXT_ORDERS.APPROVAL_POLICY === 115 &&
  cat.HOST_CONTEXT_ORDERS.SUBAGENT_DELEGATION === 120);
check("上游已知段名常量一致",
  cat.HOST_SECTION_NAMES.IDENTITY === "harness:identity" &&
  cat.HOST_SECTION_NAMES.PERSONA_PREFIX === "deployment:persona-prefix" &&
  cat.HOST_SECTION_NAMES.PERSONA_SUFFIX === "deployment:persona-suffix");

// ---- ② 族别分类 ----
check("identity / persona 判为 stance", cat.classifySection("harness:identity", -1000).family === "stance" &&
  cat.classifySection("deployment:persona-suffix", 10200).family === "stance");
check("工具段判为 tool", cat.classifySection("tool:bash", 1000).family === "tool" && cat.classifySection("mcp:servers", 3100).family === "tool");
check("自身源码 / Web 面判为 source / surface", cat.classifySection("harness:source", 10000).family === "source" &&
  cat.classifySection("web:surface", 10100).family === "surface");
check("第三方段判为 foreign（接管不碰）", cat.classifySection("vendor:custom", 1234).family === "foreign");
check("策略上下文按名字认得出", cat.classifyContext("sandbox-policy").key === "SANDBOX_POLICY" &&
  cat.classifyContext("approval-policy").key === "APPROVAL_POLICY" &&
  cat.classifyContext("subagent-delegation").key === "SUBAGENT_DELEGATION");

// ---- 上游真实段名索引（v0.52.11：从克隆到的官方 master 收的 28 个段名）----
const HARVESTED = ["app:web-surface","approval:policy","browser-use:stagehand-native","computer-use:cua-driver-native",
  "context:file-reference","cordis:include","deployment:persona-prefix","harness:identity","plan:policy",
  "sandbox:policy","subagent:delegation","team:policy","tool:bash","tool:edit","tool:glob","tool:goal",
  "tool:grep","tool:jobs","tool:lsp","tool:pty","tool:pwsh","tool:ralph","tool:read","tool:session-query",
  "tool:write","tools:ptc-only","tools:sdk","ui:deliverable-file-references"];
const missing = HARVESTED.filter((n) => !cat.HOST_SECTION_NAME_INDEX[n]);
check(`上游真实段名 ${HARVESTED.length} 条全部在册`, missing.length === 0, missing.join(","));
check("段名索引优先于前缀启发（stake=upstream-name）", cat.classifySection("sandbox:policy", 110).stake === "upstream-name");
check("沙箱/审批/委派按上游段名归 policy", cat.classifySection("sandbox:policy").family === "policy" &&
  cat.classifySection("approval:policy").family === "policy" && cat.classifySection("subagent:delegation").family === "policy");
check("文件引用/交付物引用归 reference（接管不碰）", cat.classifySection("context:file-reference").family === "reference" &&
  cat.classifySection("ui:deliverable-file-references").family === "reference");

// ---- ③ 四档语义 ----
const sections = [
  { name: "infinite-gen-5:global-system-prompt", order: 100 },
  { name: "harness:identity", order: -1000 },
  { name: "deployment:persona-suffix", order: 10200 },
  { name: "tool:bash", order: 1000 },
  { name: "vendor:custom", order: 1234 },
];
const contexts = [{ name: "sandbox-policy", order: 110 }, { name: "approval-policy", order: 115 }, { name: "other:thing", order: 9 }];
const plan = (mode, extra = {}) => cat.planHostTakeover({ sections, contexts, mode, dropList: ["vendor"], ...extra });

const r = plan("resident");
check("resident（默认）：一段不剔、一个上下文不压", r.kept.length === 5 && r.dropped.length === 0 && r.suppressedContexts.length === 0);
check("resident 仍回报认出的平台段（供面板核对）", r.matched.length === 3);

const e = plan("exact");
check("exact：剔 stance 段（工具段留着）",
  e.dropped.some((d) => d.name === "harness:identity") && e.dropped.some((d) => d.name === "deployment:persona-suffix") &&
  e.kept.some((s) => s.name === "tool:bash"));
check("exact：平台的沙箱/审批段一并剔（上游把策略也做成了段）",
  cat.planHostTakeover({ sections: [{ name: "sandbox:policy", order: 110 }, { name: "approval:policy", order: 115 }, { name: "tool:read", order: 1100 }], contexts: [], mode: "exact" })
    .dropped.map((d) => d.name).sort().join(",") === "approval:policy,sandbox:policy");
check("exact：压制策略上下文、留下非策略上下文",
  e.suppressedContexts.map((c) => c.name).sort().join(",") === "approval-policy,sandbox-policy" &&
  e.keptContexts.some((c) => c.name === "other:thing"));
check("exact：第三方段不动（靠表认，不靠猜）", e.kept.some((s) => s.name === "vendor:custom"));

const sh = plan("shadow");
check("shadow：= exact + 旧子串剔除词兜底", sh.dropped.some((d) => d.name === "vendor:custom") && sh.dropped.length === 3);
const rp = plan("replace");
check("replace：非本插件段全让位 + 上下文整片压制",
  rp.kept.length === 1 && rp.suppressedContexts.length === 3);

// ---- ④ order 不撞车 ----
const m = /const OVERRIDE_ORDER = (\d+);/.exec(src);
check("裁决条款 order 已从 9900（上游 STRUCTURED_OUTPUT）挪开", m && Number(m[1]) !== 9900, m ? m[1] : "未找到");
check("新 order 未占用上游任何段位", m && !cat.isHostTakenOrder(Number(m[1])));
check("新 order 落在平台最后立场段与自身源码段之间",
  m && Number(m[1]) > cat.HOST_SECTION_ORDERS.STRUCTURED_OUTPUT && Number(m[1]) < cat.HOST_SECTION_ORDERS.HARNESS_SOURCE);
check("启动即自检：撞车直接抛错（不是静默将就）", /if \(isHostTakenOrder\(OVERRIDE_ORDER\)\) \{\s*\n\s*throw new Error/.test(src));

// ---- ⑤ 接线 ----
check("瀑布改走 planHostTakeover（段 + 上下文一起算）", /const plan = planHostTakeover\(\{\s*\n\s*sections: out\.sections,\s*\n\s*contexts: out\.contexts,/.test(src));
check("回执带 matched / contextsSuppressed / catalog 依据", /matched: plan\.matched,/.test(src) && /contextsSuppressed: plan\.suppressedContexts,/.test(src) && /clauseOrder: OVERRIDE_ORDER/.test(src));
check("被压制的上下文真的从装配里去掉", /return \{ \.\.\.out, sections, contexts \};/.test(src) && /const contexts = plan\.keptContexts;/.test(src));
check("shadow 档仍带旧剔除词兜底", /hints: DEFAULT_DROP_HINTS,/.test(src));
check("面板出现「精准接管（按上游表）」档", /value: "exact", label: "精准接管（按上游表）"/.test(src));

console.log(`\n上游布局精准接管回归：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
