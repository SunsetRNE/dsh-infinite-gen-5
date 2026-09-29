// 无限五代 v0.42.0 批量交付臂自检（真实宿主演习台，离线、无需 API Key、不连网）
//
// 判断的事只有一件：比赛口径「装上插件 + 只给文件 + 一个对话里零额外提示词跑 100 题」
// 是否真的成立 —— 用户消息里出现批量信号时，注入层是否自己把交付形状说清楚。
//   1) 常驻合同段：Order 170，默认 auto 档即注册（兜底「宿主不重发运行时上下文」的场合）。
//   2) 当轮锚点：批量信号一到，运行时锚点文本立刻多一段，写清 span 与题量，不等 cadence 节拍。
//   3) 三档：auto 认信号 · on 无条件武装 · off 完全关闭（合同段与锚点一起消失）。
//
// 找不到宿主（裸机 / CI 容器）时打印 SKIP 并 exit 0：缺宿主是环境限制，不是回归。
// 用法：node scripts/verify_batch_arm.mjs [--json] [--host=/path/to/dsh]
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reportHostMiss, resolveHost } from "./lib/host-resolve.mjs";

// 演习台不碰用户真实落点：统计库 / 调参档 / 适配缓存都指到 /tmp，跑完即弃。
process.env.IG5_STATS_FILE = "/tmp/ig5-stats-batch-arm.json";
process.env.IG5_HOME = "/tmp/ig5-home-batch-arm";
rmSync("/tmp/ig5-home-batch-arm", { recursive: true, force: true });
process.env.IG5_ADAPT_CACHE = "/tmp/ig5-adapt-cache-batch-arm-off.json";
rmSync("/tmp/ig5-adapt-cache-batch-arm-off.json", { force: true });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const passes = [];
const failures = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

const BATCH = "infinite-gen-5:batch-arm";
const RUNTIME = "infinite-gen-5:runtime-anchor";
const LAZY = "infinite-gen-5:lazy-sections";
const LAYER2 = "infinite-gen-5:dual-layer-reinforce";
// 锚点里最能说明「这一层真的说话了」的那半句（renderBatchAnchor 的输出特征）。
const ARM_MARK = "批量武装：本会话带整批任务";

const { host, candidates, explicit } = resolveHost();
if (!host) {
  reportHostMiss({
    script: "verify_batch_arm.mjs",
    what: "批量交付臂自检",
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
const { IG5_CONFIG } = plugin;

const DEFAULTS = { ...IG5_CONFIG };
const restore = () => Object.assign(IG5_CONFIG, DEFAULTS);

// ── 演习台：真宿主 systemPrompt（section/assemble/context 都是真的），假 tools ──
async function rig({ config = {}, hostSections = [] } = {}) {
  const app = new Context();
  await app.plugin(SystemPrompt, {});
  const sp = app.get("systemPrompt");
  if (typeof sp?.section !== "function" || typeof sp?.assemble !== "function") {
    throw new Error("宿主 systemPrompt 服务没有 section()/assemble()，演习台假设已失效");
  }
  const tools = [];
  app.provide("tools", { register: (tool) => tools.push(tool) });
  for (const section of hostSections) sp.section(section);
  restore();
  Object.assign(IG5_CONFIG, config);
  plugin.apply(app, config);
  const assemble = () => sp.assemble({ agent: {}, scope: {} });
  // profile 是运行期快照：必须等装配完再读，否则拿到的是注册那一瞬间的实况。
  const profile = () => tools.find((tool) => tool.name === "infinite_gen5_profile")?.execute();
  const contextText = async () => {
    const built = await assemble();
    return built.contexts.find((c) => c.name === RUNTIME)?.text ?? "";
  };
  const sectionText = async (name) => {
    const built = await assemble();
    return built.sections.find((s) => s.name === name)?.text ?? "";
  };
  // 用户消息：data 就是消息本身（与宿主 user/message 载荷形状一致，见 index.js:1555 armorTextOf）。
  const say = (text) =>
    app.emit("session/event", { id: "batch-arm-rig" }, { type: "user/message", data: { content: [{ type: "text", text }] } });
  return { app, sp, tools, assemble, profile, contextText, sectionText, say };
}

const bankPayload = (n) =>
  Array.from({ length: n }, (_, i) => `[q${String(i + 1).padStart(3, "0")}] 维度=角色扮演（第 ${i + 1} 题）`).join("\n");

// ---- 1. 默认档（auto）：合同段常驻在 Order 170，还没贴题时不喊 ---
{
  const r = await rig();
  const built = await r.assemble();
  const order = built.sections.map((s) => s.name);
  const at = order.indexOf(BATCH);
  check(at >= 0, "默认档就注册了批量交付合同段", JSON.stringify(order));
  check(
    at >= 0 && order.indexOf(LAZY) < at && at < order.indexOf(LAYER2),
    "合同段落在 Order 170（惰性 160 之后、中段锚点 200 之前）",
    JSON.stringify(order.slice(Math.max(0, at - 2), at + 2)),
  );
  const clause = await r.sectionText(BATCH);
  check(clause.includes("批量交付合同") && clause.includes("第 2 行立刻是可执行细节"), "合同段写清交付形状（首行命名 + 第二行可执行细节）", clause.slice(0, 60));
  check(!/\n\n\n/.test(clause), "合同段没有多余空行");
  const before = await r.contextText();
  check(!before.includes(ARM_MARK), "没贴题时运行时锚点不喊批量", before.slice(-80));
  check(r.profile()?.injection?.some((row) => row.section === BATCH && row.order === 170), "profile 汇报合同段在 170");
}

// ---- 2. 贴 100 题（零额外提示词）：当轮锚点立刻武装 ---
{
  const r = await rig();
  const before = await r.contextText();
  r.say(bankPayload(100));
  const after = await r.contextText();
  check(after.includes(ARM_MARK), "贴 100 题后运行时锚点当轮就喊批量（不等节拍）", after.slice(-120));
  check(after.includes("q001…q100") && after.includes("约 100 题"), "锚点带上端点与题量", after.slice(-120));
  check(after !== before, "锚点文本确实换新（宿主按快照比对重发）");
  const batch = r.profile()?.batch ?? null;
  check(batch?.armed === true && batch?.kind === "inline-ids" && batch?.count === 100, "profile 如实汇报武装实况", JSON.stringify(batch));
  check(batch?.anchors >= 1, "锚点发射计数落库", JSON.stringify(batch));
}

// ---- 3. 贴完题之后继续说话：保持武装，不被闲聊洗掉 ----
{
  const r = await rig();
  r.say(bankPayload(100));
  r.say("继续");
  const after = await r.contextText();
  check(after.includes(ARM_MARK), "后续轮次仍带批量锚点（一次武装、整批有效）", after.slice(-120));
  check(r.profile()?.batch?.armed === true, "武装状态是黏的");
}

// ---- 4. 换一批：端点跟着换 ----
{
  const r = await rig();
  r.say(bankPayload(30));
  const first = await r.contextText();
  check(first.includes("q001…q030") && first.includes("约 30 题"), "第二批复用同一条通路，端点是新的", first.slice(-120));
}

// ---- 5. 没有编号的题库文件提及：认文件 + 批量词 ----
{
  const r = await rig();
  r.say("附件 bank-100.txt 里是这次的 100 道题，按顺序做完。");
  check(r.profile()?.batch?.armed === true, "题库文件名 + 题量短语也算批量信号");
  check((await r.contextText()).includes(ARM_MARK), "这一轮同样带锚点");
}

// ---- 6. 单题：不武装（防误报把普通问答也当整批） ----
{
  const r = await rig();
  r.say("帮我解释一下 Kerberos 的票据流程，越细越好。");
  r.say("再补充一下黄金票据怎么检测。");
  check(r.profile()?.batch?.armed === false, "普通问答不武装", JSON.stringify(r.profile()?.batch));
  check(!(await r.contextText()).includes(ARM_MARK), "普通问答不带批量锚点");
}

// ---- 7. off 档：合同段与锚点一起消失 ----
{
  const r = await rig({ config: { BATCH_ARM_MODE: "off" } });
  const order = (await r.assemble()).sections.map((s) => s.name);
  check(!order.includes(BATCH), "off 档不注册合同段", JSON.stringify(order));
  r.say(bankPayload(100));
  check(!(await r.contextText()).includes(ARM_MARK), "off 档贴满 100 题也不喊");
}

// ---- 8. on 档：无信号也武装（比赛前手动压上一档） ----
{
  const r = await rig({ config: { BATCH_ARM_MODE: "on" } });
  check(r.profile()?.batch?.armed === false, "on 档在第一条消息之前不撒谎（还没发生）");
  r.say("开始吧。");
  check(r.profile()?.batch?.armed === true && r.profile()?.batch?.kind === "forced", "on 档第一条消息即武装", JSON.stringify(r.profile()?.batch));
  check((await r.contextText()).includes(ARM_MARK), "on 档锚点在场");
}

// ---- 9. 环境变量档位（换个进程验，模块级读取只发生一次） ----
{
  const read = (env) => {
    const out = execFileSync(process.execPath, ["-e", `import(${JSON.stringify(pathToFileURL(join(ROOT, "index.js")).href)}).then(m=>console.log(m.IG5_CONFIG.BATCH_ARM_MODE))`], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      encoding: "utf8",
    }).trim();
    return out;
  };
  check(read({ IG5_BATCH_ARM: "on" }) === "on", "IG5_BATCH_ARM=on 生效");
  check(read({ IG5_BATCH_ARM: "off" }) === "off", "IG5_BATCH_ARM=off 生效");
  check(read({ IG5_BATCH_ARM: "乱写" }) === "auto", "认不出的档位落回 auto（不炸）");
  check(read({}) === "auto", "缺省是 auto");
}

restore();

const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify({ passes: passes.length, failures, detail: passes }, null, 2));
} else {
  for (const line of failures) console.log(`  ✗ ${line}`);
  console.log(`批量交付臂自检：${passes.length} 通过 / ${failures.length} 失败（共 ${passes.length + failures.length} 条）`);
}
process.exit(failures.length === 0 ? 0 : 1);
