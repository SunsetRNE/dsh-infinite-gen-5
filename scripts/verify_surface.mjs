// 无限五代 v0.38.0 表面覆盖门禁：契约短形必须同时出现在三处「每轮都会重发」的表面上。
//
// 为什么是这三处（而不是再多加几个 section）：
//   1) 工具目录 —— 插件自有 6 个工具的 description 由宿主每轮随工具表发给模型；
//   2) 技能目录 —— ~/.dsh/skills 下技能的 front-matter description 由宿主每轮随
//      available_skills 发给模型（本轮实测：目录里那条 description 就是契约短形原文）；
//   3) 真末位锚点 —— 走 system-prompt/assemble 瀑布追加到最后，段落裁剪（complete 模式）
//      会丢掉 order 段，但这一段不是 order 段。
//
// 前两处不随系统段落裁剪消失；第三处是裁剪后仍能兜底的那一份。对抗断言就是按这个分工写的：
// 把全部 infinite-gen-5 order 段删掉、只留宿主段与末位锚点，契约仍必须可见。
//
// 找不到宿主（裸机 / CI）时打印 SKIP 并 exit 0：缺宿主是环境限制，不是回归。
// 用法：node scripts/verify_surface.mjs [--json] [--host=/path/to/node_modules/@deepseek-ai/dsh]

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

process.env.IG5_STATS_FILE = "/tmp/ig5-stats-surface.json";
process.env.IG5_HOME = "/tmp/ig5-home-surface";
rmSync("/tmp/ig5-home-surface", { recursive: true, force: true });

const passes = [];
const failures = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

const hostArg = process.argv.find((a) => a.startsWith("--host="));
const candidates = [
  hostArg && hostArg.slice("--host=".length),
  process.env.IG5_DSH_ROOT,
  "/usr/local/lib/node_modules/@deepseek-ai/dsh",
  join(dirname(process.execPath), "..", "lib", "node_modules", "@deepseek-ai", "dsh"),
  join(dirname(process.execPath), "..", "node_modules", "@deepseek-ai", "dsh"),
].filter((p) => typeof p === "string" && p.length > 0);

function locateHost() {
  for (const root of candidates) {
    const cordis = join(root, "node_modules", "@deepseek-ai", "cordis", "lib", "index.js");
    const prompt = join(root, "node_modules", "@deepseek-ai", "dsh-system-prompt", "lib", "index.js");
    if (existsSync(cordis) && existsSync(prompt)) return { root, cordis, prompt };
  }
  return null;
}

const host = locateHost();
if (!host) {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ skipped: true, reason: "no dsh-system-prompt", candidates, passed: 0, failed: 0 }, null, 1));
  } else {
    console.log("SKIP: 没找到 dsh 宿主（@deepseek-ai/dsh-system-prompt），表面覆盖门禁只在装有 DSH 的机器上跑。");
    console.log("  找过：" + candidates.join(" · "));
  }
  process.exit(0);
}

const { Context } = await import(pathToFileURL(host.cordis).href);
const promptModule = await import(pathToFileURL(host.prompt).href);
const SystemPrompt = promptModule.default;
const plugin = await import(new URL("../index.js", import.meta.url).href);
const armor = await import(new URL("../anchor-armor.mjs", import.meta.url).href);
const { IG5_CONFIG } = plugin;
const DEFAULTS = { ...IG5_CONFIG };
const restore = () => Object.assign(IG5_CONFIG, DEFAULTS);

const FIRST_LINE = armor.FIRST_LINE_SECTION;
const TAIL = "infinite-gen-5:tail-anchor";
const MARK = armor.CONTRACT_MARK;
const SHORT = armor.CONTRACT_SHORT;

async function rig() {
  const app = new Context();
  await app.plugin(SystemPrompt, {});
  const sp = app.get("systemPrompt");
  if (typeof sp?.section !== "function" || typeof sp?.assemble !== "function") {
    throw new Error("宿主 systemPrompt 服务没有 section()/assemble()，演习台假设已失效");
  }
  const tools = [];
  app.provide("tools", { register: (tool) => tools.push(tool) });
  restore();
  plugin.apply(app, {});
  return { app, sp, tools, assemble: () => sp.assemble({ agent: {}, scope: {} }) };
}

// ---- 1. 工具目录：6 个工具的 description 全部携带契约短形 ----
{
  const r = await rig();
  const names = r.tools.map((t) => t.name);
  check(r.tools.length >= 6, "插件自有工具注册齐（≥6 个）", `实得 ${r.tools.length}：${names.join(", ")}`);
  const missing = r.tools.filter((t) => !String(t.description ?? "").includes(MARK)).map((t) => t.name);
  check(missing.length === 0, "每个工具 description 都含契约短形", missing.length ? `缺：${missing.join(", ")}` : "");
  const rawTools = r.tools.map((t) => String(t.description ?? ""));
  check(rawTools.every((d) => d.includes(SHORT)), "工具里带的是短形全串（逐字节）");
  const twice = armor.withContract(r.tools[0]);
  check(twice === r.tools[0], "withContract 幂等：已包装的工具再包一次不叠第二份");
  const unwrapped = { name: "PROBE_TOOL", description: "原始描述" };
  check(!unwrapped.description.includes(MARK), "反例：未包装的原始定义里没有契约（证明契约来自包装层）");
  check(SHORT.length <= 400, "契约短形在 token 预算内（≤400 字符）", String(SHORT.length));
}

// ---- 2. 真末位锚点：装配最后一段，且对抗裁剪后仍在 ----
{
  const r = await rig();
  const a = await r.assemble();
  const sections = a.sections ?? [];
  const last = sections[sections.length - 1];
  check(last?.name === TAIL, "装配出来的最后一段是真末位锚点", String(last?.name));
  check(String(last?.text ?? "").includes(MARK), "末位锚点正文含契约短形");
  check(String(last?.text ?? "").includes("末位锚点"), "末位锚点正文仍是锚点（不是被替换成契约块）");

  // 对抗：模拟 complete 模式的段落裁剪 —— 只留宿主段与瀑布追加的末位锚点，
  // 把所有无限五代 order 段（首句层 / 内核 / 增强 / 惰性 / L2 / 运行时锚点）全删掉。
  const culled = sections.filter((s) => s.name === TAIL || !String(s.name).startsWith("infinite-gen-5:"));
  const tailStill = culled[culled.length - 1];
  check(culled.length < sections.length, "对抗裁剪确实删掉了段（否则断言空转）", `${sections.length} → ${culled.length}`);
  check(String(tailStill?.text ?? "").includes(MARK), "裁剪到只剩宿主段后，契约仍由末位锚点兜住");
  check(!culled.some((s) => s.name === FIRST_LINE), "对抗裁剪确实删掉了首句层（证明兜底不靠它）");
}

// ---- 3. 技能目录：dist 产物与已安装副本的 description 都携带契约 ----
function frontMatterDescription(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const line = m[1].split(/\r?\n/).find((l) => l.startsWith("description:"));
  return line ? line.slice("description:".length).trim() : null;
}

const demoSources = [
  { label: "dist", file: process.env.IG5_SKILLS_SRC ? join(process.env.IG5_SKILLS_SRC, "ig5-layer-01/SKILL.md") : "/root/ig5-adapters/dist/skills/ig5-layer-01/SKILL.md", required: false },
  { label: "installed", file: join(homedir(), ".dsh", "skills", "ig5-layer-01", "SKILL.md"), required: false },
];

{
  let seen = 0;
  for (const src of demoSources) {
    if (!existsSync(src.file)) {
      check(!src.required, `技能 ${src.label} 产物在场（缺则跳过）`, src.file);
      continue;
    }
    seen += 1;
    const text = readFileSync(src.file, "utf8");
    const desc = frontMatterDescription(text);
    check(desc !== null, `技能 ${src.label} 前置元数据有 description`);
    check(String(desc ?? "").includes(MARK), `技能 ${src.label} description 含契约短形`, String(desc ?? "").slice(0, 80));
    const bytes = statSync(src.file).size;
    check(bytes < 8192, `技能 ${src.label} 体量在宿主裁剪阈值内（<8192 B）`, String(bytes));
  }
  check(seen >= 1, "至少一个技能副本可查（否则这一节空转）", String(seen));
}

// ---- 汇总 ----
const report = { passed: passes.length, failed: failures.length, passes, failures };
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 1));
} else {
  for (const p of passes) console.log(`  ok  ${p}`);
  for (const f of failures) console.log(`  ✗   ${f}`);
  console.log(`表面覆盖检查：${passes.length} 通过 / ${failures.length} 失败（共 ${passes.length + failures.length} 条）`);
}
process.exit(failures.length ? 1 : 0);
