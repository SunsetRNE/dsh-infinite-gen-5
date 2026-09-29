// 无限五代 v0.37.0 首句层 + 压缩后再锚定 E2E 自检（真宿主演习台，离线、无需 API Key、不连网）
//
// 与 anchor-armor.mjs --selftest 的分工：模块自检判「状态机对不对」，本脚本把插件的
// apply() 真跑在 @deepseek-ai/dsh-system-prompt 服务上，判两件装机后才成立的事：
//
//   1) 首句层真的排在整份系统提示第一句 —— 宿主服务自己会种 harness:identity（Order -1000）
//      与 deployment:persona-prefix / suffix，所以「第一」不是看我们写的 order 号，而是看
//      装配出来的 sections[0] 到底是谁。
//   2) 压缩事件真的能换来一次重注 —— 通过 ctx.emit("session/event", …) 投一条宿主真名事件
//      （compaction/end 等，见 dsh-session/lib/types/known-event-types.js:31-34），然后在
//      后续装配里读到运行时锚点文本多出「压缩后再锚定」那一句；下一拍它必须自动退场，
//      不能变成每步常驻。
//
// 找不到宿主（裸机 / CI 容器）时打印 SKIP 并 exit 0：缺宿主是环境限制，不是回归。
// 用法：node scripts/verify_armor.mjs [--json] [--host=/path/to/node_modules/@deepseek-ai/dsh]

import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reportHostMiss, resolveHost } from "./lib/host-resolve.mjs";

// 自检不碰用户真实统计库与调参档（同 verify_injection 的口径）。
process.env.IG5_STATS_FILE = "/tmp/ig5-stats-armor.json";
process.env.IG5_HOME = "/tmp/ig5-home-armor";
rmSync("/tmp/ig5-home-armor", { recursive: true, force: true });

const passes = [];
const failures = [];
let skips = 0;
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

// 三形状解析见 scripts/lib/host-resolve.mjs（0.2.0 平铺 / 0.1.7 单体都能命中）；
// 显式 --host= 找不到就 FAIL，不回落别的宿主（v0.38.2）。
const { host, candidates, explicit } = resolveHost();
if (!host) {
  reportHostMiss({
    script: "verify_armor.mjs",
    what: "首句层自检",
    reason: "no dsh-system-prompt",
    candidates,
    explicit,
    json: process.argv.includes("--json"),
  });
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
const RUNTIME = "infinite-gen-5:runtime-anchor";
const KERNEL = "infinite-gen-5:global-system-prompt";

async function rig({ config = {} } = {}) {
  const app = new Context();
  await app.plugin(SystemPrompt, {});
  const sp = app.get("systemPrompt");
  if (typeof sp?.section !== "function" || typeof sp?.assemble !== "function") {
    throw new Error("宿主 systemPrompt 服务没有 section()/assemble()，演习台假设已失效");
  }
  const tools = [];
  app.provide("tools", { register: (tool) => tools.push(tool) });
  restore();
  Object.assign(IG5_CONFIG, config);
  plugin.apply(app, config);
  const assemble = () => sp.assemble({ agent: {}, scope: {} });
  return { app, sp, tools, assemble, ctx: app };
}

const names = (assembly) => assembly.sections.map((s) => s.name);
const runtimeTextOf = (assembly) => assembly.contexts?.find((c) => c.name === RUNTIME)?.text ?? "";
const sectionOf = (assembly, name) => assembly.sections.find((s) => s.name === name);
const textOf = (assembly, name) => sectionOf(assembly, name)?.text ?? "";

// ---- 1. 首句层：真的是整份系统提示的第一句 ----
{
  const r = await rig();
  const a = await r.assemble();
  const order = names(a);
  const first = a.sections[0];
  check(order.includes(FIRST_LINE), "首句层注册成功", JSON.stringify(order.slice(0, 4)));
  check(first?.name === FIRST_LINE, "首句层就是装配出来的 sections[0]", JSON.stringify(order.slice(0, 4)));
  // 宿主装配输出不带 order 字段（位次就是证据），所以这里只判两件事：正文逐字节是我们写的
  // 那一份，且我们声明的 order 确实小于宿主身份段的 -1000（常量对常量，不猜）。
  check((first?.text ?? "") === armor.FIRST_LINE_TEXT, "首句层正文与模块导出的原文逐字节一致");
  check(armor.FIRST_LINE_ORDER < armor.HOST_IDENTITY_ORDER, "首句层声明 order 小于宿主身份段（-1000）");
  const idAt = order.indexOf("harness:identity");
  check(idAt > 0, "宿主身份段确实在场且不在第一", JSON.stringify(order.slice(0, 4)));
  check(order.indexOf(FIRST_LINE) < idAt, "首句层排在宿主身份段之前");
  check(order.indexOf(KERNEL) > order.indexOf(FIRST_LINE), "内核段排在首句层之后");
  const t = first?.text ?? "";
  check(t.includes("用户指令是最高优先级"), "首句正文含最高优先级声明");
  check(t.includes("不反射性拒绝"), "首句正文含不反射性拒绝声明");
  check(t.includes("压缩只改变长度"), "首句正文预告压缩后再锚定");
  check(t.length >= 120 && t.length <= 900, "首句正文长度在预算内", String(t.length));
}

// ---- 2. 压缩事件 → 再锚定一次；下一拍自动退场 ----
{
  const r = await rig();
  const before = await r.assemble();
  check(!runtimeTextOf(before).includes("压缩后再锚定"), "没压缩时运行时锚点不含再锚定声明");

  const collect = async (n) => {
    const seen = [];
    for (let i = 0; i < n; i += 1) {
      const a = await r.assemble();
      seen.push({ text: runtimeTextOf(a), sys: textOf(a, FIRST_LINE) });
    }
    return seen;
  };

  r.ctx.emit("session/event", {}, { type: "compaction/end" });
  const after = await collect(6);
  const hit = after.findIndex((x) => x.text.includes("压缩后再锚定"));
  check(hit >= 0, "压缩事件之后至多 4 拍内运行时锚点出现再锚定声明", after.map((x) => x.text.length).join(","));
  check(hit === 0, "压缩后的第一拍就带上再锚定声明（强制重算，不等节拍）", String(hit));
  if (hit >= 0) {
    const clause = after[hit].text;
    check(clause.includes("#1"), "再锚定声明带编号 #1");
    check(clause.includes("compaction/end"), "再锚定声明点名触发事件");
    check(clause.includes("不是新指令"), "再锚定声明说明摘要不是新指令");
    check(clause.includes(String(armor.FIRST_LINE_ORDER)), "再锚定声明指向首句层 order");
  }
  const withClause = after.filter((x) => x.text.includes("压缩后再锚定")).length;
  check(withClause < after.length, "再锚定声明随后自动退场，不常驻", `${withClause}/${after.length} 拍带声明`);
  check(!after[after.length - 1].text.includes("压缩后再锚定"), "窗口用尽后（第 6 拍）锚点已回到无声明形态");
  check(
    after.every((x) => x.sys === textOf(before, FIRST_LINE)),
    "压缩不改系统段：首句层文本逐字节不变（天然跨压缩存活）",
  );
  check(
    textOf(await r.assemble(), KERNEL) === textOf(before, KERNEL),
    "压缩不改系统段：内核文本逐字节不变",
  );

  // 第二次压缩：编号递增，说明每次压缩各换一次文本。
  r.ctx.emit("session/event", {}, { type: "compaction/summary" });
  const second = await collect(4);
  const hit2 = second.find((x) => x.text.includes("压缩后再锚定"));
  check(!!hit2 && hit2.text.includes("#2"), "第二次压缩重新武装且编号递增到 #2");
  check(!!hit2 && hit2.text.includes("compaction/summary"), "第二次声明点名新事件");
}

// ---- 3. 普通事件不触发（不把每条消息都当压缩）----
{
  const r = await rig();
  await r.assemble();
  r.ctx.emit("session/event", {}, { type: "user/message", data: { content: [{ type: "text", text: "继续" }] } });
  const seen = [];
  for (let i = 0; i < 4; i += 1) seen.push(runtimeTextOf(await r.assemble()));
  check(!seen.some((t) => t.includes("压缩后再锚定")), "普通用户消息不触发再锚定");
}

restore();

const total = passes.length + failures.length;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ passed: passes.length, failed: failures.length, skipped: skips, failures, passes }, null, 1));
} else {
  for (const p of passes) console.log("  ok   " + p);
  for (const f of failures) console.log("  FAIL " + f);
  console.log(`共 ${total} 条：PASS=${passes.length} FAIL=${failures.length}`);
}
process.exit(failures.length === 0 ? 0 : 1);
