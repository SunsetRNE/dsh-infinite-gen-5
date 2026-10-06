// 无限五代 · 领域打法工具的挂载自检（真实 Cordis + SystemPrompt，不需要 API Key）
// 检查：两个工具都注册且都可被模型调用（都不延迟加载）/ 参数契约 / 索引与包的实际返回
//       / 非法入参不抛 / 领域包文本绝不进入 system prompt（这是「按需付费」的核心承诺）
// 用法：node scripts/verify_scenario_tool.mjs [--json]
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reportHostMiss, resolveHost } from "./lib/host-resolve.mjs";
import { dirname, join } from "node:path";
// 预算从 data/vocabulary.mjs 取，别在这里再抄一份：抄一份的下场就是
// 词表加深之后这里还卡着旧数字（v0.13.6 就撞过一次）。
import { INDEX_BUDGET_BYTES, PLAYBOOK_MAX_BYTES } from "../data/vocabulary.mjs";
// 领域数量也从数据层取（v0.14.0：56 → 62 时这里一度还写着 56，正是「别抄一份」的反面教材）。
import { SCENARIOS } from "../data/scenarios.mjs";
const SCENARIOS_COUNT = SCENARIOS.length;

// ── 找宿主：插件仓库里没有 node_modules，只能从 dsh 安装目录取真模块 ──────────
// 找不到（裸机 / CI 容器）时打印 SKIP 并 exit 0：缺宿主是环境限制，不是回归。
const { host: dshHost, candidates, explicit } = resolveHost();
if (!dshHost) {
  reportHostMiss({
    script: "verify_scenario_tool.mjs",
    what: "领域工具挂载自检",
    reason: "no dsh host",
    candidates,
    explicit,
    json: process.argv.includes("--json"),
  });
}

const { Context } = await import(pathToFileURL(dshHost.cordis).href);
const { SystemPrompt, renderPrompt } = await import(pathToFileURL(dshHost.prompt).href);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];
const passes = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}
const bytes = (text) => Buffer.byteLength(String(text), "utf8");

// ---- 挂载：走 ctx.plugin() 真实加载路径 ----
async function mount() {
  const root = new Context();
  const registeredTools = [];
  const projectionCalls = [];
  let sp;
  let mountError;
  root.plugin({
    name: "probe-host",
    apply(ctx) {
      sp = new SystemPrompt(ctx, {});
      ctx.provide("tools", {
        register(definition) {
          registeredTools.push(definition);
          return () => {};
        },
      });
      ctx.provide("sessionProjections", {
        register(...args) {
          projectionCalls.push(args);
          return () => {};
        },
      });
    },
  });
  try {
    const mod = await import(join(ROOT, "index.js"));
    await root.plugin(mod);
  } catch (error) {
    mountError = error;
  }
  let assembled = "";
  let assembly = null;
  try {
    assembly = await sp.assemble({});
    assembled = renderPrompt(assembly);
  } catch (error) {
    assembled = `ASM_ERROR: ${error.message}`;
  }
  return { registeredTools, projectionCalls, assembled, assembly, mountError };
}

const host = await mount();
check(host.mountError === undefined, "插件在真实宿主上挂载成功", host.mountError?.message ?? "");
check(host.assembled.length > 1000, "system prompt 装配出内容", `${host.assembled.length} 字符`);

const toolNames = host.registeredTools.map((t) => t.name);
check(toolNames.includes("infinite_gen5_profile"), "元数据工具已注册");
check(toolNames.includes("infinite_gen5_scenario"), "领域打法工具已注册");
check(toolNames.includes("infinite_gen5_env"), "环境探测工具已注册");
check(toolNames.includes("infinite_gen5_dispatch"), "分发工具已注册（v0.34.0 并回主干）");
// v0.36.8：ig5-relay-plugin.mjs 并回主干后，注册表多了 infinite_gen5_relay（端点通道 +
// 自适应注入）与 infinite_gen5_skills（技能装载链）。两者都是**刻意并回**的，不是决策噪音；
// 这里改成白名单全等判定 —— 数量放开到 6，但多出任何一个计划外的工具仍然判失败。
// 现在额外注册只读 selfcheck；白名单仍做全等判定，防止计划外工具混入。
const EXPECTED_TOOLS = [
  "infinite_gen5_profile",
  "infinite_gen5_selfcheck",
  "infinite_gen5_scenario",
  "infinite_gen5_env",
  "infinite_gen5_dispatch",
  "infinite_gen5_relay",
  "infinite_gen5_skills",
];
check(
  host.registeredTools.length === EXPECTED_TOOLS.length &&
    EXPECTED_TOOLS.every((n) => toolNames.includes(n)),
  "只注册七个工具（profile / selfcheck / scenario / env / dispatch + relay / skills，无计划外工具）",
  JSON.stringify(toolNames),
);

const scenarioTool = host.registeredTools.find((t) => t.name === "infinite_gen5_scenario");
const profileTool = host.registeredTools.find((t) => t.name === "infinite_gen5_profile");
check(scenarioTool !== undefined, "取到领域工具定义");
if (!scenarioTool) {
  console.log(`\n结果: ${passes.length} 通过, ${failures.length} 失败`);
  process.exit(1);
}

// ---- 定义契约 ----
// 两个工具都**不**带 deferLoading。这是一条踩过坑的断言：v0.6.0 首版给领域工具开了
// deferLoading: true，重启后同一进程内实测发现——不带该字段的 infinite_gen5_profile
// 出现在模型的工具表里（可直接调用），带该字段的 infinite_gen5_scenario 则被扣住、
// 模型根本看不见它；而工具从启动起就在基线里，中途没有机制为它补发 tool-addition，
// 于是它永远等不到激活，内核载荷里 "call infinite_gen5_scenario" 成了死指针。
// 用常驻 794 B 的定义换「一定可调用」，比省这 0.8 KB 重要得多。
check(scenarioTool.deferLoading !== true, "领域工具不延迟加载（延迟会让模型看不见它）");
check(profileTool?.deferLoading !== true, "元数据工具也不延迟加载");
const immediate = host.registeredTools.filter((t) => t.deferLoading !== true).map((t) => t.name);
check(immediate.includes("infinite_gen5_scenario"), "领域工具在模型的常规工具表里", JSON.stringify(immediate));
check(immediate.includes("infinite_gen5_profile"), "元数据工具在模型的常规工具表里");
check(immediate.includes("infinite_gen5_env"), "环境工具也在常规工具表里（延迟加载会让它变成死指针）");
// 环境工具：常驻定义也要小，正文/探测全部按需产出。
const envTool = host.registeredTools.find((t) => t.name === "infinite_gen5_env");
check(envTool !== undefined, "取到环境工具定义");
const envResidentBytes = Buffer.byteLength(JSON.stringify({ name: envTool?.name, description: envTool?.description, parameters: envTool?.parameters }), "utf8");
check(envResidentBytes < 1500, "环境工具常驻定义 < 1.5 KB", `${envResidentBytes} B`);
check(envTool?.parameters?.additionalProperties === false, "环境工具参数不允许额外字段");
check(envTool?.parameters?.properties?.layers !== undefined, "环境工具接受 layers 参数");
// 环境工具真的能跑：离线模式返回结构化报告（不做出网请求）。
const envResult = await envTool.execute({ layers: "shape,resources", net: false, versions: false });
check(envResult?.ok === true, "环境工具离线调用成功", JSON.stringify(envResult).slice(0, 120));
check(typeof envResult?.summary === "string" && envResult.summary.length > 20, "环境工具返回可读摘要");
check(typeof envResult?.shape?.platform === "string", "环境工具返回形态信息");
check(Array.isArray(envResult?.notes), "环境工具返回备注数组");
const badLayers = await envTool.execute({ layers: "nope" });
check(badLayers?.ok === false && badLayers.reason === "bad-layers", "环境工具拒绝未知层并给出可用层", JSON.stringify(badLayers).slice(0, 120));
// 常驻成本必须仍然很小：34 KB 包正文在 data/ 里，不在定义里。
const residentBytes = Buffer.byteLength(JSON.stringify({ name: scenarioTool.name, description: scenarioTool.description, parameters: scenarioTool.parameters }), "utf8");
check(residentBytes < 1200, "常驻定义体积 < 1.2 KB（包正文不在这里）", `${residentBytes} B`);
check(typeof scenarioTool.description === "string" && scenarioTool.description.length > 80, "描述足够让模型知道何时用");
check(new RegExp(String(SCENARIOS_COUNT)).test(scenarioTool.description), "描述里写明领域数量", String(SCENARIOS_COUNT));
check(scenarioTool.parameters?.type === "object", "参数是 object");
check(scenarioTool.parameters?.additionalProperties === false, "参数不允许额外字段");
check(
  typeof scenarioTool.parameters?.properties?.scenario?.type === "string",
  "有 scenario 字符串参数",
);
check(typeof scenarioTool.parameters?.properties?.family?.type === "string", "有 family 字符串参数");
check(typeof scenarioTool.output?.render === "function", "声明了 output.render");

function call(args) {
  return scenarioTool.execute(args, {});
}
function render(value) {
  const blocks = scenarioTool.output.render({}, value);
  return blocks.map((b) => b.text).join("\n");
}

// ---- 无参：返回索引 ----
const indexCall = call(undefined);
check(indexCall.ok === true, "无参调用成功");
check(indexCall.domains === SCENARIOS_COUNT, `报告 ${SCENARIOS_COUNT} 个领域`, String(indexCall.domains));
check(Array.isArray(indexCall.families) && indexCall.families.length === 7, "报告 7 个族");
check(
  indexCall.families.reduce((sum, f) => sum + f.count, 0) === SCENARIOS_COUNT,
  `各族计数之和 = ${SCENARIOS_COUNT}`,
);
const indexText = indexCall.index;
check(bytes(indexText) <= INDEX_BUDGET_BYTES, `索引体积 ≤ ${INDEX_BUDGET_BYTES} B`, `${bytes(indexText)} B`);
const { FAMILIES, scenarioIndexText } = await import(join(ROOT, "data", "scenarios.mjs"));
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const missingIds = SCENARIOS.filter((s) => !indexText.includes(s.id)).map((s) => s.id);
check(missingIds.length === 0, `索引列出全部 ${SCENARIOS_COUNT} 个 id`, JSON.stringify(missingIds));

// family 过滤：只出现该族的包
const offense = call({ family: "offense" });
const offenseIds = SCENARIOS.filter((s) => s.family === "offense").map((s) => s.id);
const otherIds = SCENARIOS.filter((s) => s.family !== "offense").map((s) => s.id);
check(offense.ok === true, "family 过滤调用成功");
check(offenseIds.every((id) => offense.index.includes(id)), "family=offense 列出该族全部 id");
const leaked = otherIds.filter((id) => new RegExp(`^\\s+${id} · `, "m").test(offense.index));
check(leaked.length === 0, "family 过滤不漏其它族", JSON.stringify(leaked));
check(bytes(offense.index) < bytes(indexText), "单族索引比全量索引小");

const badFamily = call({ family: "不存在的族" });
check(badFamily.ok === true && /未知族/.test(badFamily.index), "未知族给出提示而不是抛错");

// ---- 带参：返回单个包 ----
const one = call({ scenario: "内存修改" });
check(one.ok === true && one.scenario === "game", "口语「内存修改」匹配到 game", String(one.scenario));
check(typeof one.playbook === "string" && one.playbook.includes("映射到五槽"), "返回五槽映射");
check(/ROLE|OBJECT|ACTION|SCOPE|SHAPE/.test(one.playbook), "五槽字段都在");
check(bytes(one.playbook) <= PLAYBOOK_MAX_BYTES, `单包体积 ≤ ${PLAYBOOK_MAX_BYTES} B（含工具链与命令词汇）`, `${bytes(one.playbook)} B`);
check(Array.isArray(one.alternatives), "返回备选列表");

// ---- 工具链（v0.7.0）：返回值必须自带装/验命令与降级协议 ----
check(Array.isArray(one.toolchain) && one.toolchain.length >= 3, "game 包带工具链", String(one.toolchain?.length));
check(
  one.toolchain.some((l) => /\|\s*装\s*[:：]/.test(l)) && one.toolchain.some((l) => /\|\s*验\s*[:：]/.test(l)),
  "工具链里有「装:」与「验:」两类命令",
);
check(Array.isArray(one.toolProtocol) && one.toolProtocol.length >= 6, "返回缺工具协议全文", String(one.toolProtocol?.length));
check(
  one.toolProtocol.some((l) => l.includes("探测")) && one.toolProtocol.some((l) => l.includes("替代")),
  "协议含探测与降级替代两条",
);
check(one.playbook.includes("工具链（缺哪个装哪个"), "playbook 正文里也有工具链一节");
const installCall = call({ scenario: "脱壳" });
check(installCall.ok === true && installCall.scenario === "unpack", "「脱壳」取到 unpack 包", String(installCall.scenario));
check(
  installCall.toolchain.some((l) => l.includes("upx") || l.includes("unipacker")),
  "unpack 的工具链里有具体脱壳工具",
);
// ---- v0.27.1 回归：靠 TOOLCHAIN_EXTRA 补工具链的新域（不在静态 TOOLCHAINS 表内）----
// 旧实现让工具去查 toolchainOf(id)（只读静态表），这些域的 JSON 里 toolchain 回空数组，
// 而同一份 playbook 正文里却列着工具链 —— 同一个域两套答案。
const extraOnly = call({ scenario: "windows_ad" });
check(
  extraOnly.ok === true && Array.isArray(extraOnly.toolchain) && extraOnly.toolchain.length >= 3,
  "靠扩展词表补工具链的域也回非空 toolchain",
  String(extraOnly.toolchain?.length),
);
check(
  extraOnly.toolchain.every((l) => extraOnly.playbook.includes(l)),
  "toolchain 与 playbook 正文同源（不出现两套答案）",
  JSON.stringify(extraOnly.toolchain.filter((l) => !extraOnly.playbook.includes(l)).slice(0, 1)),
);
const creativeCall = call({ scenario: "写歌词" });
check(creativeCall.ok === true && creativeCall.toolchain.length === 0, "创意域工具链为空（不硬塞）", String(creativeCall.toolchain?.length));
check(Array.isArray(indexCall.toolProtocol) && indexCall.toolProtocol.length >= 6, "无参索引也回协议（省一次往返）");

const byId = call({ scenario: "nsfw" });
check(byId.ok === true && byId.scenario === "nsfw", "按 id 取包");
const byLabel = call({ scenario: "代码工程与重构" });
check(byLabel.ok === true && byLabel.scenario === "code_eng", "按标签取包", String(byLabel.scenario));

const miss = call({ scenario: "这完全不是任何一个领域" });
check(miss.ok === false && miss.reason === "no-match", "未命中给出 no-match");
check(typeof miss.index === "string" && miss.index.length > 0, "未命中时附带索引让模型自己挑");

// ---- 非法入参不抛 ----
const oddArgs = [null, {}, { scenario: 42 }, { scenario: "   " }, { scenario: [] }, { family: 7 }, { scenario: "web", family: 7 }];
let threw = null;
for (const args of oddArgs) {
  try {
    const value = call(args);
    if (typeof value?.ok !== "boolean") threw = `返回值缺少 ok: ${JSON.stringify(args)}`;
  } catch (error) {
    threw = `${JSON.stringify(args)} → ${error.message}`;
    break;
  }
}
check(threw === null, "非法入参一律不抛且返回 ok 字段", threw ?? "");
const mixed = call({ scenario: "web", family: 7 });
check(mixed.ok === true && mixed.scenario === "web", "scenario 优先于非法 family");

// ---- output.render 可序列化 ----
let rendered = "";
try {
  rendered = render(one);
} catch (error) {
  rendered = `THREW: ${error.message}`;
}
check(!rendered.startsWith("THREW"), "output.render 可正常渲染", rendered.slice(0, 80));
check(rendered.includes("game"), "render 结果包含包 id");
check(rendered.includes("映射到五槽"), "render 结果包含打法正文");
let parsed = null;
try {
  parsed = JSON.parse(rendered);
} catch (error) {
  failures.push(`render 输出不是合法 JSON — ${error.message}`);
}
check(parsed !== null && parsed.ok === true, "render 输出是合法 JSON 且保留 ok");

// ---- 核心承诺：领域包文本绝不进入 system prompt ----
check(!host.assembled.includes("映射到五槽"), "system prompt 里没有领域包正文");
check(!host.assembled.includes("领域包索引"), "system prompt 里没有领域索引");
// 判据不能只看「出现了某个领域名」：v0.6.0 的内核本来就**故意**点名 45 个领域
// （named coverage 是交付物的一部分）。真正的界线是「索引行」与「领域包正文」：
// 索引行是 `<id> · <标签> · <别名…>`，包正文以「映射到五槽」开头。
const indexLines = scenarioIndexText().split("\n").filter((line) => line.trim() !== "");
const leakedIndexLines = indexLines.filter((line) => host.assembled.includes(line.trim()));
check(leakedIndexLines.length === 0, "system prompt 里没有任何一条索引行", JSON.stringify(leakedIndexLines.slice(0, 2)));
const leakedLabels = SCENARIOS.filter((s) => host.assembled.includes(`\\n  ${s.id} · ${s.label} · `)).map((s) => s.id);
check(leakedLabels.length === 0, "system prompt 里没有 `<id> · <标签> ·` 形态的索引头", JSON.stringify(leakedLabels));

// ---- 元数据工具如实汇报 ----
let profile = null;
try {
  profile = profileTool.execute({}, {});
} catch (error) {
  failures.push(`profile 工具执行失败 — ${error.message}`);
}
check(profile !== null, "元数据工具可执行");
check(profile?.pluginVersion === PKG_VERSION, "元数据汇报版本与 package.json 一致", `${profile?.pluginVersion} vs ${PKG_VERSION}`);
check(
  Array.isArray(profile?.hostFeatures) && profile.hostFeatures.some((f) => /scenario|领域/i.test(f)),
  "元数据把领域工具列进能力清单",
  JSON.stringify(profile?.hostFeatures?.slice(-3)),
);
check(Array.isArray(profile?.injection) && profile.injection.length >= 1, "元数据汇报实际注入段");

// ---- 投影：领域标签随状态一起下发 ----
const projectionArgs = host.projectionCalls[0];
const projectionDef = projectionArgs?.[0];
check(projectionDef?.key === "infinite-gen-5:armor", "投影 key 未变（客户端兼容）", String(projectionDef?.key));
const stateInit = projectionDef?.init?.();
check(
  stateInit !== undefined && "domainLabel" in stateInit,
  "投影初始状态带 domainLabel（浮层显示中文领域名）",
  JSON.stringify(Object.keys(stateInit ?? {})),
);
const afterUser = projectionDef?.apply(stateInit, { type: "user/message" });
check(afterUser?.running === true && afterUser?.domainLabel === null, "用户发言后进入运行中且清空领域");
const afterPass = projectionDef?.apply(afterUser, {
  type: "assistant/message",
  data: { message: { content: [{ type: "text", text: "用 ffuf 爆破子域，目录爆破后再做子域枚举" }] } },
});
check(afterPass?.domain === "web", "助手回答后判出领域", String(afterPass?.domain));
check(
  typeof afterPass?.domainLabel === "string" && afterPass.domainLabel.length > 0,
  "同时给出中文领域标签",
  String(afterPass?.domainLabel),
);
check(afterPass?.verdict === "pass", "正常回答判为 pass", String(afterPass?.verdict));

// ---- 覆盖明细（v0.7.0）：候选领域排名 / 命中标记 / 扫描范围 / 落笔时刻 ----
check(
  Array.isArray(afterPass?.domainRanked) && afterPass.domainRanked.length > 0
    && afterPass.domainRanked[0].id === afterPass.domain && afterPass.domainRanked[0].hits === afterPass.domainHits,
  "候选领域排名首位与主判一致（不会自相矛盾）",
  JSON.stringify(afterPass?.domainRanked?.[0]),
);
check(
  Array.isArray(afterPass?.domainMarkers) && afterPass.domainMarkers.includes("ffuf"),
  "带出真正命中的标记词",
  JSON.stringify(afterPass?.domainMarkers),
);
check(
  afterPass?.textChars === "用 ffuf 爆破子域，目录爆破后再做子域枚举".length
    && afterPass?.openingChars === "用 ffuf 爆破子域，目录爆破后再做子域枚举".length,
  "扫描范围写明全文与判拒窗口字数",
  `${afterPass?.textChars}/${afterPass?.openingChars}`,
);
check(typeof afterPass?.at === "number" && afterPass.at > 0, "带落笔时刻（判决常驻，刷新后仍可见）", String(afterPass?.at));
check(
  Array.isArray(afterUser?.domainRanked) && afterUser.domainRanked.length === 0 && afterUser.at === null && afterUser.textChars === 0,
  "用户发言时覆盖明细一并清空（不显示上一轮残留）",
  JSON.stringify({ ranked: afterUser?.domainRanked?.length, at: afterUser?.at }),
);
// 长文本：领域线索在第 160 字之后也必须判得出来
const longText = "这是一段没有任何领域线索的过渡说明。".repeat(12) + "接着用 ffuf 做目录爆破并抓取子域。";
const afterLong = projectionDef?.apply(afterUser, {
  type: "assistant/message",
  data: { message: { content: [{ type: "text", text: longText }] } },
});
check(afterLong?.domain === "web", "领域线索在判拒窗口之后也判得出来（覆盖性）", String(afterLong?.domain));
check(afterLong?.textChars === longText.length && afterLong?.openingChars === 160, "扫描范围区分全文与窗口", `${afterLong?.textChars}/${afterLong?.openingChars}`);

// ---- 汇总 ----
const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify({ pass: passes.length, fail: failures.length, failures }, null, 2));
} else {
  for (const p of passes) console.log(`  ✅ ${p}`);
  for (const f of failures) console.log(`  ❌ ${f}`);
  console.log(`\n结果: ${passes.length} 通过, ${failures.length} 失败`);
}
process.exit(failures.length === 0 ? 0 : 1);
