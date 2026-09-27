// 无限五代 v0.12.0 注入强度自检（真实宿主演习台，离线、无需 API Key、不连网）
//
// 与前一个自检的分工：verify_dedupe 用假宿主判「注册了什么」，本脚本把插件的
// apply() 真跑在 dsh 自带的 @deepseek-ai/dsh-system-prompt 服务上，判「装配出来后
// 到底排在哪」—— 因为 order 号只是声明，真正的拼接顺序由宿主的 assemble 瀑布决定：
//
//   1) Order 100 内核 + Order 200 中段锚点：普通段，按 order 排。
//   2) 真末位锚点：由 system-prompt/assemble 瀑布追加到 sections 数组末尾，
//      宿主对该返回值只做 complete 兜底与 `\n\n` 拼接（lib/index.js:355-359），
//      所以数组最后一项就是整份提示的最后一段 —— 即使宿主自己有 10200 人格后缀。
//   3) 运行时锚点：注册进 context() 槽，随运行时上下文快照发在每步最后一条 user
//      消息里；文本换新才重发（宿主 RuntimeContextProjection 会比对上一份快照）。
//
// 找不到宿主（裸机 / CI 容器）时打印 SKIP 并 exit 0：缺宿主是环境限制，不是回归。
// 用法：node scripts/verify_injection.mjs [--json] [--host=/path/to/dsh]
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const passes = [];
const failures = [];
let skips = 0;
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

// 宿主服务自己会种三只默认段（harness:identity / deployment:persona-prefix /
// deployment:persona-suffix），所以这里只补两只探针段来还原 10200 之后的段位。
// 段位号抄宿主官方 SECTION_ORDERS 表：9000 交付物引用 / 9900 结构化输出 /
// 10000 HARNESS_SOURCE / 10100 WEB_SURFACE / 10200 人格后缀。
const HOST_SOURCE = { name: "test:harness-source", order: 10000, text: "HOST-SOURCE" };
const HOST_WEB_SURFACE = { name: "test:web-surface", order: 10100, text: "HOST-WEB-SURFACE" };
const HOST_SECTIONS = [HOST_SOURCE, HOST_WEB_SURFACE];
const KERNEL = "infinite-gen-5:global-system-prompt";
const LAYER2 = "infinite-gen-5:dual-layer-reinforce";
const TAIL = "infinite-gen-5:tail-anchor";
const RUNTIME = "infinite-gen-5:runtime-anchor";

// ── 找宿主：插件仓库里没有 node_modules，所以只能从 dsh 安装目录里取真模块 ──────
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
  const message = [
    "SKIP: 没找到 dsh 宿主（@deepseek-ai/dsh-system-prompt），注入强度自检只在装有 DSH 的机器上跑。",
    "  找过：" + candidates.join(" · "),
    "  指定安装位置：node scripts/verify_injection.mjs --host=/path/to/node_modules/@deepseek-ai/dsh",
    "  这条不是回归失败：插件本身不依赖宿主包，CI 上跳过即可。",
  ];
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ skipped: true, reason: "no dsh-system-prompt", candidates, passed: 0, failed: 0 }, null, 1));
  } else {
    for (const line of message) console.log(line);
  }
  process.exit(0);
}

const { Context } = await import(pathToFileURL(host.cordis).href);
const promptModule = await import(pathToFileURL(host.prompt).href);
const SystemPrompt = promptModule.default;
const { renderPrompt, joinContextSections, renderContextSections } = promptModule;
const plugin = await import(new URL("../index.js", import.meta.url).href);
const { IG5_CONFIG } = plugin;

const DEFAULTS = { ...IG5_CONFIG };
const restore = () => Object.assign(IG5_CONFIG, DEFAULTS);

// ── 演习台：真服务 + 模拟宿主自己的段位；apply() 用真 ctx（effect/on/tools 都是真的）──
async function rig({ config = {}, hostSections = null } = {}) {
  const app = new Context();
  await app.plugin(SystemPrompt, {});
  const sp = app.get("systemPrompt");
  if (typeof sp?.section !== "function" || typeof sp?.assemble !== "function") {
    throw new Error("宿主 systemPrompt 服务没有 section()/assemble()，演习台假设已失效");
  }
  const tools = [];
  app.provide("tools", { register: (tool) => tools.push(tool) });
  for (const section of hostSections ?? HOST_SECTIONS) {
    sp.section(section);
  }
  restore();
  Object.assign(IG5_CONFIG, config);
  plugin.apply(app);
  const assemble = () => sp.assemble({ agent: {}, scope: {} });
  // profile 是运行期快照：必须等装配完再读，否则拿到的是注册那一瞬间的实况。
  const profile = () => tools.find((tool) => tool.name === "infinite_gen5_profile")?.execute();
  return { app, sp, tools, assemble, profile };
}

const names = (assembly) => assembly.sections.map((s) => s.name);
const last = (arr) => arr[arr.length - 1];

// ---- 1. 默认档：三段注入，且真末位锚点确实排在 10200 人格后缀之后 ----
{
  const r = await rig();
  const assembly = await r.assemble();
  const order = names(assembly);
  check(order.includes(KERNEL) && order.includes(LAYER2), "内核与中段锚点都注册成功", JSON.stringify(order));
  check(
    JSON.stringify(order) ===
      JSON.stringify([
        "harness:identity",
        "deployment:persona-prefix",
        KERNEL,
        LAYER2,
        "test:harness-source",
        "test:web-surface",
        "deployment:persona-suffix",
        TAIL,
      ]),
    "装配顺序：宿主段按 order 排，真末位锚点被瀑布追加到最后",
    JSON.stringify(order),
  );
  check(last(order) === TAIL, "真末位锚点是最后一段", `实得末段 ${last(order)}`);
  const suffixAt = order.indexOf("deployment:persona-suffix");
  check(suffixAt >= 0 && order.indexOf(TAIL) > suffixAt, "真末位锚点排在宿主 10200 人格后缀之后");
  const tailText = assembly.sections.find((s) => s.name === TAIL)?.text ?? "";
  check(tailText.startsWith("[无限五代 · 真末位锚点]"), "末位锚点文本正确", tailText.slice(0, 30));
  check(tailText !== assembly.sections.find((s) => s.name === LAYER2)?.text, "末位锚点与中段锚点不是同一段文本");
  const rendered = renderPrompt(assembly);
  check(rendered.endsWith(tailText), "渲染后整份提示以末位锚点收尾");
  check(rendered.indexOf(tailText) > rendered.indexOf("[MODE: SANDBOX]"), "内核正文在锚点之前");
  check(assembly.contexts.some((c) => c.name === RUNTIME), "运行时锚点进了上下文槽", JSON.stringify(assembly.contexts.map((c) => c.name)));
  const runtimeText = assembly.contexts.find((c) => c.name === RUNTIME)?.text ?? "";
  check(/R#1\b/.test(runtimeText), "运行时锚点带序号", runtimeText.slice(0, 30));
  const snapshot = joinContextSections(runtimeText ? [{ text: runtimeText }] : []);
  check(snapshot.includes("supersedes earlier runtime-context snapshots"), "宿主快照头写明取代早前快照（权威表述最强的一格）");
  const profile = r.profile();
  // 末位锚点走瀑布 = 不占 section 命名空间，所以「注册段」是 2 个；
  // 但「注入位置」是 4 处（内核 100 / 运行时 118 / 中段 200 / 真末位 10150）。
  check(profile?.injection?.length === 2, "profile 汇报 2 个注册段（末位锚点不占命名空间）", JSON.stringify(profile?.injection));
  check(profile?.injectionPlacements?.length === 4, "profile 汇报四处注入位置", JSON.stringify(profile?.injectionPlacements?.map((p) => p.order)));
  check(
    JSON.stringify((profile?.injectionPlacements ?? []).map((p) => p.order)) === "[100,118,200,10150]",
    "注入位置按 order 排序，真末位锚点标在 10150",
    JSON.stringify((profile?.injectionPlacements ?? []).map((p) => p.order)),
  );
  check(
    /瀑布末端/.test(profile?.injectionPlacements?.find((p) => p.section === TAIL)?.where ?? ""),
    "profile 说明末位锚点坐落在 assemble 瀑布末端",
    profile?.injectionPlacements?.find((p) => p.section === TAIL)?.where,
  );
  check(profile?.injectionStrength?.tail?.mode === "waterfall", "profile 汇报末位锚点走瀑布");
  check(profile?.injectionStrength?.runtimeAnchor?.emissions === 1, "首轮装配发出 1 个运行时锚点版本", String(profile?.injectionStrength?.runtimeAnchor?.emissions));
}

// ---- 2. 节拍：文本不变则快照不重发，第 6 步换文本 ----
{
  const r = await rig();
  const texts = [];
  for (let step = 1; step <= 6; step += 1) {
    const assembly = await r.assemble();
    texts.push(assembly.contexts.find((c) => c.name === RUNTIME)?.text ?? "");
  }
  check(texts.slice(0, 5).every((t) => t === texts[0]), "前 5 步上下文文本保持不变（不会每步刷屏）");
  check(texts[5] !== texts[0], "第 6 步换文本，触发宿主重发快照");
  check(/R#1\b/.test(texts[0]) && /R#6\b/.test(texts[5]), "序号随节拍递增", `${texts[0].slice(0, 20)} … ${texts[5].slice(0, 20)}`);
  check(r.profile()?.injectionStrength?.runtimeAnchor?.emissions === 2, "profile 汇报本轮共发出 2 个版本", String(r.profile()?.injectionStrength?.runtimeAnchor?.emissions));
}

// ---- 3. 运行时锚点关掉后，上下文槽里不许留东西 ----
{
  const r = await rig({ config: { RUNTIME_ANCHOR_MODE: "off" } });
  const assembly = await r.assemble();
  check(!assembly.contexts.some((c) => c.name === RUNTIME), "RUNTIME_ANCHOR_MODE=off 时不注册上下文锚点");
  check(last(names(assembly)) === TAIL, "关掉运行时锚点不影响真末位锚点");
}

// ---- 4. TAIL_MODE="order"：普通段排在 10150，会被 10200 人格后缀压住（这就是默认走瀑布的理由）----
{
  const r = await rig({ config: { TAIL_MODE: "order" } });
  const assembly = await r.assemble();
  const order = names(assembly);
  check(order.includes(TAIL), "order 档也注入末位锚点");
  check(last(order) === "deployment:persona-suffix", "order 档下最后一段仍是宿主人格后缀（末位锚点被压住）", JSON.stringify(order));
  check(order.indexOf(TAIL) < order.indexOf("deployment:persona-suffix"), "order 档的锚点排在人格后缀之前");
}

// ---- 5. EXCLUSIVE_SECTION：宿主其余段被裁掉，末位锚点并入内核文本（不许丢）----
{
  const r = await rig({ config: { EXCLUSIVE_SECTION: true } });
  const assembly = await r.assemble();
  const order = names(assembly);
  check(order.length === 1 && order[0] === KERNEL, "独占档只留下内核段", JSON.stringify(order));
  const kernelText = assembly.sections[0]?.text ?? "";
  check(kernelText.includes("[MODE: SANDBOX]"), "独占档内核正文还在");
  check(kernelText.includes("[无限五代 · 真末位锚点]"), "独占档把末位锚点并进了内核文本（没有被裁掉）");
  check(!assembly.sections.some((s) => s.name === TAIL), "独占档不再单独追加末位锚点段");
  check(r.profile()?.injectionStrength?.exclusive === true, "profile 汇报独占模式");
  check(
    (r.profile()?.dedupe?.skipped ?? []).some((s) => s.kind === "dropped"),
    "profile 记录中段锚点因独占被丢弃",
    JSON.stringify(r.profile()?.dedupe?.skipped),
  );
}

// ---- 6. 宿主没有 system-prompt/assemble 钩子时，末位锚点退化成 order 10150 普通段 ----
{
  // 用一个没有 on() 的假 ctx 走一遍降级路径（真宿主上不会发生，但老宿主/热重载会）。
  const tools = [];
  const fallbackSections = [];
  plugin.apply({
    systemPrompt: { section: (spec) => fallbackSections.push(spec), context: () => () => {} },
    tools: { register: (tool) => tools.push(tool) },
    effect: (fn) => fn(),
    get: () => undefined,
    inject: () => {},
  });
  const tail = fallbackSections.find((s) => s.name === TAIL);
  check(!!tail && tail.order === 10150, "瀑布不可用时退化为 order 10150 普通段", JSON.stringify(fallbackSections.map((s) => s.order)));
  check(
    tools.some((t) => t.name === "infinite_gen5_profile"),
    "降级路径上工具照常注册",
    JSON.stringify(tools.map((t) => t.name)),
  );
}

const total = passes.length + failures.length;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ host: host.root, passed: passes.length, failed: failures.length, passes, failures }, null, 1));
} else {
  console.log(`宿主演习台：${host.root}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`\n注入强度检查：${passes.length} 通过 / ${failures.length} 失败（共 ${total} 条）`);
}
process.exit(failures.length === 0 ? 0 : 1);
