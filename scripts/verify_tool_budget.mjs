// 无限五代 v0.13.8「同类问题统一强化」自检：解析入口 / 结果体积闸 / 参数扁平 / 两端同值体积闸
//
// 背景：宿主侧那条 "tool input is invalid JSON" 是模型输出在流里被截断的产物
// （dsh-llm-deepseek 的 JSON.parse → MALFORMED_RESPONSE，属硬失败不自动重试）。
// 插件改不到宿主，但能把自己这一侧**所有 JSON 边界**收成同一套做法：
//   1) 全插件只留一个解析入口 safeParseJson —— 坏包/空包不抛，不把请求炸掉；
//   2) 工具结果统一过体积闸 capResult —— 超预算先丢重复的辅助字段，再截断最长正文，
//      并在结果里写明降级了什么（结果被截断同样会变成「看起来成功的半截数据」）；
//   3) 工具参数保持扁平标量 —— 不给模型制造嵌套大对象的机会；
//   4) 设置接口的体积上限在服务端与页面同值，页面先自量再发。
//
// 用假宿主把 apply() 真跑一遍，拿**真实注册的工具对象**断言参数形状与结果闸，
// 而不是 grep 源码猜。用法：node scripts/verify_tool_budget.mjs [--json]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// 自检不碰用户真实统计库（v0.13.9）：给统计库指一个 /tmp 落点，跑完即弃。
process.env.IG5_STATS_FILE = "/tmp/ig5-stats-tool-budget.json";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const passes = [];
const failures = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}
const bytes = (value) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");

const plugin = await import(new URL("../index.js", import.meta.url).href);
const { IG5_BUDGET } = plugin;
const { capResult, safeParseJson, RESULT_BUDGET_BYTES, RESULT_DROP_FIRST } = IG5_BUDGET;

// ---- 假宿主：只为把三个工具真注册出来（形状与闸都要看真实对象）----
function mountTools() {
  const tools = [];
  const store = new Map();
  const disposers = [];
  const systemPrompt = {
    section(spec) {
      store.set(spec.name, spec);
      const dispose = () => store.delete(spec.name);
      disposers.push(dispose);
      return dispose;
    },
    context() {
      return () => {};
    },
    layers: { merge: () => new Map(store), global: { sections: { entries: () => store.entries() } } },
  };
  const ctx = {
    systemPrompt,
    tools: { register: (tool) => tools.push(tool) },
    effect: (fn) => {
      const dispose = fn();
      if (typeof dispose === "function") disposers.push(dispose);
    },
    get: () => undefined,
    inject: () => {},
  };
  plugin.apply(ctx);
  return tools;
}

// ---- 1. 接缝本身 ----
check(Number.isInteger(RESULT_BUDGET_BYTES) && RESULT_BUDGET_BYTES > 0, "结果体积预算是正整数", String(RESULT_BUDGET_BYTES));
check(typeof capResult === "function" && typeof safeParseJson === "function", "自检接缝导出了 capResult 与 safeParseJson");
check(
  Array.isArray(RESULT_DROP_FIRST) && RESULT_DROP_FIRST.includes("toolProtocol"),
  "辅助字段丢弃顺序里有 toolProtocol（每次调用都重复的那份）",
  Array.isArray(RESULT_DROP_FIRST) ? RESULT_DROP_FIRST.join(",") : String(RESULT_DROP_FIRST),
);

// ---- 2. 最坏合法结果也要装得进预算（否则闸会把正常调用降级）----
const { SCENARIOS, scenarioIndexText, renderScenario, TOOLCHAIN_PROTOCOL } = await import(
  new URL("../data/scenarios.mjs", import.meta.url).href
);
const indexWorst = bytes({
  ok: true,
  domains: SCENARIOS.length,
  families: [],
  index: scenarioIndexText(),
  toolProtocol: TOOLCHAIN_PROTOCOL,
  hint: "x".repeat(400),
});
const domainWorst = SCENARIOS.map((scenario) =>
  bytes({
    ok: true,
    query: "x".repeat(64),
    label: "y",
    family: "offense",
    playbook: renderScenario(scenario),
    toolchain: scenario.toolchain ?? [],
    toolProtocol: TOOLCHAIN_PROTOCOL,
    alternatives: ["a", "b", "c"],
    hint: "x".repeat(400),
  }),
).sort((a, b) => b - a)[0];
check(indexWorst <= RESULT_BUDGET_BYTES, "无参索引调用（最坏合法结果）装得进预算", `${indexWorst} vs ${RESULT_BUDGET_BYTES}`);
check(domainWorst <= RESULT_BUDGET_BYTES, "单域打法最坏结果装得进预算", `${domainWorst} vs ${RESULT_BUDGET_BYTES}`);
check(
  RESULT_BUDGET_BYTES - Math.max(indexWorst, domainWorst) >= 512,
  "预算给最坏合法结果留了余量（不是踩着线卡）",
  `${RESULT_BUDGET_BYTES - Math.max(indexWorst, domainWorst)} B`,
);

// ---- 3. 参数形状：扁平标量，不给模型制造嵌套大对象的机会 ----
const tools = mountTools();
const toolNames = tools.map((t) => t.name).sort().join(",");
// v0.36.8 起 relay / skills 两块并回主干，注册面由 4 名变 6 名（注册点 index.js:3505
// registerRelayTools；relay 定义 index.js:2882、skills 定义 index.js:3247）。
// 这两名工具自带结果渲染、不走 budgetedOutput，所以体积闸只对下面 4 名资源工具断言。
const EXPECTED_TOOLS = [
  "infinite_gen5_dispatch",
  "infinite_gen5_env",
  "infinite_gen5_profile",
  "infinite_gen5_scenario",
];
const EXPECTED_ALL = [...EXPECTED_TOOLS, "infinite_gen5_relay", "infinite_gen5_skills"].sort().join(",");
check(tools.length === 6, "注册了六个工具（4 资源 + relay/skills）", String(tools.length));
check(toolNames === EXPECTED_ALL, "工具名齐全且无计划外工具", toolNames);
const renderTools = tools.filter((t) => EXPECTED_TOOLS.includes(t.name));
check(renderTools.length === EXPECTED_TOOLS.length, "四个资源工具都在注册面里", String(renderTools.length));
for (const tool of renderTools) {
  const props = tool.parameters?.properties ?? {};
  const kinds = Object.values(props).map((p) => p.type);
  const flat =
    Object.values(props).every((p) => !p.properties && !p.items) &&
    kinds.every((kind) => ["string", "boolean", "number", "integer"].includes(kind));
  check(flat, `${tool.name} 参数是扁平标量（无嵌套对象/数组）`, kinds.join(",") || "无参数");
  check(tool.parameters?.additionalProperties === false, `${tool.name} 拒绝未声明参数（additionalProperties:false）`);
  check(typeof tool.output?.render === "function", `${tool.name} 结果走统一 render`);
}

// ---- 4. 结果闸走真实 render：小结果原样、超大结果被压进预算并写明降级 ----
for (const tool of renderTools) {
  const smallText = tool.output.render([], { ok: true, note: "小结果" })[0].text;
  check(!JSON.parse(smallText).truncated, `${tool.name} 小结果不加降级标记（原样返回）`);
  const hugeText = tool.output.render([], {
    ok: true,
    blob: "x".repeat(60000),
    toolProtocol: TOOLCHAIN_PROTOCOL,
    alternatives: ["a"],
    hint: "小提示",
  })[0].text;
  const parsed = JSON.parse(hugeText);
  check(bytes(hugeText) <= RESULT_BUDGET_BYTES, `${tool.name} 超大结果被压进预算`, `${bytes(hugeText)} vs ${RESULT_BUDGET_BYTES}`);
  check(parsed.truncated === true && parsed.budget === RESULT_BUDGET_BYTES, `${tool.name} 降级结果写明 truncated / budget`);
  check(typeof parsed.bytes === "number" && parsed.bytes <= RESULT_BUDGET_BYTES, `${tool.name} 降级结果自带实际字节数`);
}

// ---- 5. capResult 的语义：不改原对象、非对象透传、主字段不清空 ----
const untouched = { ok: true, tiny: "1" };
check(capResult(untouched) === untouched, "未超预算时原样返回（连引用都不变）");
check(capResult(null) === null && capResult("s") === "s" && capResult(7) === 7, "非对象输入直接透传");
const mixed = {
  ok: true,
  toolProtocol: "P".repeat(2000),
  alternatives: ["a"],
  toolchain: ["t"],
  main: "M".repeat(30000),
  hint: "小提示",
};
const capped = capResult(mixed);
check("toolProtocol" in mixed && "alternatives" in mixed, "体积闸只在副本上降级，不改调用方原对象");
check((capped.droppedFields ?? []).includes("toolProtocol"), "优先丢重复的辅助字段", (capped.droppedFields ?? []).join(","));
check(typeof capped.main === "string" && capped.main.length > 0, "主字段保留（降级不等于清空）");
check(bytes(capped) <= RESULT_BUDGET_BYTES, "混合超限对象被压进预算", String(bytes(capped)));

// ---- 6. safeParseJson：合法照解、坏包一律不抛 ----
const good = safeParseJson('{"a":[1,2]}', null);
check(good.ok === true && Array.isArray(good.value?.a) && good.value.a[1] === 2, "合法 JSON 正常解析");
const nul = safeParseJson("null", "FB");
check(nul.ok === true && nul.value === null, "字面量 null 也按合法 JSON 处理");
let thrown = null;
const badOk = ["", "   ", "{", "[1,2", '{"a":', '{"a":1,}', "\u0000", "undefined", Number.NaN].every((text) => {
  try {
    const result = safeParseJson(text, "FB");
    return result.ok === false && result.value === "FB" && typeof result.reason === "string" && result.reason.length > 0;
  } catch (error) {
    thrown = String((error && error.message) || error);
    return false;
  }
});
check(badOk, "坏包 / 空包一律不抛，回退 fallback 并给出原因", thrown ?? "");
const whole = JSON.stringify({ payload: "x".repeat(50000) });
check(safeParseJson(whole.slice(0, 20000), {}).ok === false, "被截断的大 JSON 判为坏包（宿主同款场景不再炸）");

// ---- 7. 源码级：只剩一个解析点，且两端体积上限同值 ----
const indexSrc = readFileSync(join(ROOT, "index.js"), "utf8");
const clientSrc = readFileSync(join(ROOT, "client.js"), "utf8");
const parseHits = indexSrc
  .split("\n")
  .map((line, i) => [i + 1, line])
  .filter(([, line]) => line.includes("JSON.parse("));
check(parseHits.length === 1, "index.js 里只剩一个 JSON.parse 点", `${parseHits.length} 处：${parseHits.map(([n]) => n).join(",")}`);
check(parseHits.length === 1 && parseHits[0][1].includes("JSON.parse(text)"), "唯一解析点在 safeParseJson 内部");
check(!/JSON\.parse\((raw|readFileSync)/.test(indexSrc), "旧的裸解析写法已清除（raw / readFileSync 不再直解）");
const serverLimit = /BODY_LIMIT_BYTES = (\d+)/.exec(indexSrc)?.[1];
const clientLimit = /TUNING_BODY_LIMIT = (\d+)/.exec(clientSrc)?.[1];
check(
  Boolean(serverLimit) && serverLimit === clientLimit,
  "服务端与页面用同一个体积上限",
  `server=${serverLimit} client=${clientLimit}`,
);
check(clientSrc.includes("已在本地拦截") && clientSrc.includes("utf8Len("), "页面先自量体积再发请求（不给对端 destroy 的机会）");
const kernelSrc = readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8");
check(kernelSrc.includes("truncated mid-stream"), "内核写明结果被截断也算坏包（两个方向都管）");
check(kernelSrc.includes("re-call narrower"), "内核给出结果截断的修复动作：缩小范围重调");

// ---- 8. 这条自检自己被登记进 verify:all，否则写了也没人跑 ----
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
check(Boolean(pkg.scripts?.["verify:tool-budget"]), "package.json 登记了 verify:tool-budget 脚本");
check(String(pkg.scripts?.["verify:all"] ?? "").includes("verify:tool-budget"), "verify:all 真的会跑这条自检");

const total = passes.length + failures.length;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ passed: passes.length, failed: failures.length, passes, failures }, null, 1));
} else {
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`\n体积与解析统一强化自检：${passes.length} 通过 / ${failures.length} 失败（共 ${total} 条）`);
}
process.exit(failures.length === 0 ? 0 : 1);
