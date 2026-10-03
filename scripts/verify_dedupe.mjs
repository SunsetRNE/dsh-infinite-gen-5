// 无限五代 v0.62.0 注入去重行为回归（离线、确定性、无需 API Key）
//
// 针对的缺陷：v0.5.0 的 Order 100 与 Order 200 载入的是逐字同源的两个文件，
// 于是同一份 3010 字节内核每轮被注入两遍；与同机在线的上一代破甲插件叠加时
// 会叠成 4 份近似拷贝。
//
// 用假宿主把 apply() 真跑一遍，断言「实际注册了什么」，而不是 grep 源码。
// 用法：node scripts/verify_dedupe.mjs [--json]
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// 自检不碰用户真实统计库（v0.13.9）：给统计库指一个 /tmp 落点，跑完即弃。
process.env.IG5_STATS_FILE = "/tmp/ig5-stats-dedupe.json";
// 自检也不读用户真实的调参档（v0.22.0 回归）：调参档落点由 IG5_HOME ?? DSH_HOME ?? ~/.dsh 决定
// （index.js 的 tuningHome()），不隔离的话，开发机上「在设置页 / 浮层点一下档位」就会把
// RUNTIME_ANCHOR_EVERY 从默认 4 写成 ui override，本节拍断言于是在有使用痕迹的机器上红、
// 在干净机器上绿。这里先清掉临时 home 再导入插件，保证每次都是「没有调参档」的初始态。
process.env.IG5_HOME = "/tmp/ig5-home-dedupe";
rmSync("/tmp/ig5-home-dedupe", { recursive: true, force: true });
// 适配层（ig5-adapt:endpoint）在缓存文件存在时会多注册一段，段数断言就随开发机状态飘。
// 本套只考内核八段（首句层 + 内核 + 任务态 + 增强集 + 惰性 + 批量交付合同 + 中段锚点 + 末位锚点）：把适配缓存指到一个不存在的路径，注入口径回到「无适配层」的干净态。
process.env.IG5_ADAPT_CACHE = "/tmp/ig5-adapt-cache-dedupe-off.json";
rmSync("/tmp/ig5-adapt-cache-dedupe-off.json", { force: true });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const passes = [];
const failures = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

const plugin = await import(new URL("../index.js", import.meta.url).href);
const { IG5_CONFIG } = plugin;
// 节拍默认值从 IG5_CONFIG 读：调默认档不必回来改断言。
const EVERY_STEPS = IG5_CONFIG.RUNTIME_ANCHOR_EVERY;

const PRIMARY = "infinite-gen-5:global-system-prompt";
const BOOST = "infinite-gen-5:boost-corpus";
const LAYER2 = "infinite-gen-5:dual-layer-reinforce";
const BATCH = "infinite-gen-5:batch-arm";

// ---- 假宿主：记录 section() / context() 与 tools.register() 的真实调用 ----
// 刻意不提供 ctx.on：宿主瀑布不可用时，真末位锚点必须自己退化成 order 10150 普通段，
// 这条降级路径在这里被顺带守住（真实宿主上的瀑布末端位置由 verify_injection 断言）。
function makeHost({ preexisting = [], enumerable = true } = {}) {
  const registered = [];
  const registeredContexts = [];
  const disposers = [];
  const tools = [];
  const store = new Map(
    preexisting.map(([name, text]) => [name, { name, order: 50, text }]),
  );
  const systemPrompt = {
    section(spec) {
      registered.push(spec);
      store.set(spec.name, spec);
      const dispose = () => store.delete(spec.name);
      disposers.push(dispose);
      return dispose;
    },
    context(spec) {
      registeredContexts.push(spec);
      const dispose = () => {};
      disposers.push(dispose);
      return dispose;
    },
  };
  if (enumerable) {
    systemPrompt.layers = {
      merge: () => new Map(store),
      global: { sections: { entries: () => store.entries() } },
    };
  }
  const ctx = {
    systemPrompt,
    tools: { register: (t) => tools.push(t) },
    effect: (fn) => {
      const d = fn();
      if (typeof d === "function") disposers.push(d);
    },
    get: () => undefined,
    inject: () => {},
  };
  return { ctx, registered, registeredContexts, tools, store };
}

const run = (opts) => {
  const host = makeHost(opts);
  plugin.apply(host.ctx);
  const profile = host.tools[0];
  return {
    ...host,
    profile: profile && typeof profile.execute === "function" ? profile.execute() : null,
  };
};

const chars = (rows) => rows.map((r) => r.text.length);

// ---- 1. 空宿主：单内核 + 中段锚点 + 真末位锚点，不再双份同源 ----
{
  const r = run({});
  check(r.registered.length === 8, "空宿主注册八段（首句层 + 内核 + 任务态 + 增强集 + 惰性章节 + 批量交付合同 + 中段锚点 + 末位锚点）", `实得 ${r.registered.length}`);
  // 适配层是「有缓存才注入」的条件段：本套把缓存指空（见文件头），所以它必须不在场。
  // 这条同时守住 env() 的读取口径——对象式 reader（process.env）读不出来的话，关不掉这个段。
  check(
    !r.registered.some((s) => s.name === "ig5-adapt:endpoint"),
    "适配缓存关闭时不注入 ig5-adapt:endpoint（条件段不参与内核八段计数）",
  );
  // 假宿主按「调用顺序」入表，真宿主按 order 装配。这里统一按 order 排一遍再断言段序，
  // 断的就是宿主实际看到的顺序（首句层 -1100 最前）。
  const byOrder = r.registered.slice().sort((a, b) => a.order - b.order);
  check(
    byOrder[0].name === "infinite-gen-5:first-line" && byOrder[0].order === -1100,
    "首段是 Order -1100 首句层（排在宿主身份段 -1000 之前）",
    `${byOrder[0].name}@${byOrder[0].order}`,
  );
  check(byOrder[1].name === PRIMARY && byOrder[1].order === 100, "次段是 Order 100 通用内核", `${byOrder[1].name}@${byOrder[1].order}`);
  check(
    byOrder[2].name === BOOST && byOrder[2].order === 150,
    "第三段是 Order 150 增强训练集（紧跟内核之后）",
    `${byOrder[2].name}@${byOrder[2].order}`,
  );
  check(
    byOrder[3].name === "infinite-gen-5:lazy-sections" && byOrder[3].order === 160,
    "第四段是 Order 160 惰性章节",
    `${byOrder[3].name}@${byOrder[3].order}`,
  );
  // 批量交付合同（v0.42.0）：Order 170，锁死「一批题一次做完」的交付形状。
  // 它刻意**不随内核让位**（见本文件第 2/3/4 节的断言）：合同说的是交付形状，不是内核副本，
  // 宿主里已有一份同源内核时，这条臂仍要按「首行命名 + 第二行可执行细节」约束输出。
  check(
    byOrder[4].name === BATCH && byOrder[4].order === 170,
    "第五段是 Order 170 批量交付合同（增强集之后、中段锚点之前）",
    `${byOrder[4].name}@${byOrder[4].order}`,
  );
  check(byOrder[5].name === LAYER2 && byOrder[5].order === 200, "第六段是 Order 200 槽位", `${byOrder[5].name}@${byOrder[5].order}`);
  const kernel = byOrder[1].text.length;
  const boost = byOrder[2].text.length;
  const anchor2 = byOrder[5].text;
  check(kernel > 2000, "内核是完整载荷", `实得 ${kernel} 字符`);
  check(anchor2.length < 500, "Order 200 是短锚点而非第二份完整内核", `实得 ${anchor2.length} 字符`);
  check(anchor2.length !== kernel, "两段内容不再逐字同源");
  // 增强集同样是「子集」而不是第二份载荷：字节上限由 BOOST_BYTES 封顶，注册时刻还没
  // 收到用户输入，等于只编译常驻那两条（实测闲聊档 400 B 上下）。
  check(boost > 0 && boost < 800, "Order 150 增强集是按需编译的子集（默认档在千字节以内）", `实得 ${boost} 字符`);
  check(!byOrder[2].text.includes("[MODE: SANDBOX]"), "Order 150 不含内核正文");
  // 这两条取代了原来「两段合计 < 固定字符数」的写法。固定阈值在功能演进后必然报假
  // 失败（v0.5.0 双份 5235 → v0.6.0 内核扩写 4225+172 → v0.8.0 再加环境规则 5469），
  // 而它想守的其实是一件事：**Order 200 里不许再塞第二份完整载荷**。所以直接判那件事。
  check(!anchor2.includes("[MODE: SANDBOX]"), "Order 200 不含内核正文（不是第二份载荷）");
  check(anchor2.length < kernel * 0.1, "Order 200 长度不到内核的 10%（是锚点不是载荷）", `${anchor2.length} vs ${kernel}`);
  check(
    kernel + anchor2.length + boost < kernel * 1.2,
    "内核侧合计不到 1.2 份内核（无第二份同源载荷）",
    `${kernel + anchor2.length + boost} vs ${kernel}`,
  );
  check(!r.registered.some((s) => /\{\{/.test(s.text)), "注入文本里没有可触发插值器抛错的 {{");
  // 末位段：宿主瀑布不可用时的降级位置（按 order 取最大，不再用固定下标）。真实宿主上的「恒为最后一段」由 verify_injection 断言。
  const tail = byOrder.find((s) => s.order === 10150) ?? byOrder[byOrder.length - 1];
  check(tail.name === "infinite-gen-5:tail-anchor", "末位锚点是 order 10150 段");
  check(tail.order === 10150, "末位锚点退化到 order 10150（瀑布不可用）", String(tail.order));
  check(tail.text.length > 100 && tail.text.length < 900, "末位锚点是紧凑锚点", `实得 ${tail.text.length}`);
  check(!tail.text.includes("[MODE: SANDBOX]"), "末位锚点不含内核正文");
  check(tail.text !== anchor2, "末位锚点与中段锚点措辞不同（不是同一段的复制）");
  // 运行时锚点走 context() 槽，不是系统提示段：段数不变，但必须真注册上。
  check(r.registeredContexts.length === 1, "运行时锚点注册进上下文槽", `实得 ${r.registeredContexts.length}`);
  const ctxSpec = r.registeredContexts[0] || {};
  check(ctxSpec.name === "infinite-gen-5:runtime-anchor", "上下文槽名正确");
  check(ctxSpec.order === 118, "上下文锚点排在 115 审批策略之后", String(ctxSpec.order));
  check(typeof ctxSpec.text === "function", "运行时锚点文本是惰性函数（宿主每步取一次）");
  if (typeof ctxSpec.text === "function") {
    const first = ctxSpec.text();
    // first 之后到换文本之前还剩 N-2 次调用；第 N 次调用换文本。
    const sticky = Array.from({ length: Math.max(0, EVERY_STEPS - 2) }, () => ctxSpec.text());
    const rotated = ctxSpec.text();
    check(sticky.every((t) => t === first), `节拍未到时文本保持不变（快照不重发，默认 N=${EVERY_STEPS}）`);
    check(rotated !== first, `第 ${EVERY_STEPS} 步换文本，触发宿主重发快照`);
    check(
      /R#1\b/.test(first) && new RegExp(`R#${EVERY_STEPS}\\b`).test(rotated),
      "锚点文本带递增序号",
      `${first.slice(0, 24)} … ${rotated.slice(0, 24)}`,
    );
  }
  check(r.profile?.injection?.length === 8, "profile 工具汇报实际注入 8 段");
  check(
    r.profile?.injectionPlacements?.length === 9,
    "profile 汇报九处注入位置（首句层 -1100 起算）",
    `实得 ${r.profile?.injectionPlacements?.length}`,
  );
  check(
    JSON.stringify((r.profile?.injectionPlacements ?? []).map((p) => p.order)) === "[-1100,100,118,150,160,170,200,300,10150]",
    "注入位置按 order 排序（首句层 -1100 最前，运行时锚点 118、增强集 150、惰性 160、批量交付合同 170，末位锚点最后）",
    JSON.stringify((r.profile?.injectionPlacements ?? []).map((p) => p.order)),
  );
  check(r.profile?.dedupe?.role === "primary", "profile 汇报本插件是内核提供方");
  check(
    (r.profile?.dedupe?.skipped ?? []).every((s) => s.kind === "unsupported"),
    "空宿主上没有发生同源让位",
    JSON.stringify(r.profile?.dedupe?.skipped),
  );
  check(r.profile?.layer2Mode === "anchor", "profile 汇报 Order 200 模式为 anchor");
  check(r.profile?.injectionStrength?.tail?.mode === "waterfall", "profile 汇报末位锚点为瀑布模式");
  check(
    r.profile?.injectionStrength?.runtimeAnchor?.everySteps === EVERY_STEPS,
    `profile 汇报运行时锚点节拍为 ${EVERY_STEPS} 步`,
  );
  check(r.profile?.injectionStrength?.exclusive === false, "默认不开独占内核");
}

// ---- 2. 宿主已有逐字同源内核（模拟同机在线的上一代插件）→ 内核整段让位 ----
{
  const payload = readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8");
  const r = run({ preexisting: [["infinite-gen-4:global-system-prompt", payload]] });
  check(r.registered.length === 2, "同源内核在场时只注册 2 段（中段锚点 + 批量交付合同）", `实得 ${r.registered.length}`);
  // 批量交付合同刻意不跟着内核让位：它约束的是「输出形状」（首行命名 / 第二行可执行细节 /
  // 一次做完一批），即使内核由宿主里的同源副本提供，这条臂也必须还在。
  check(r.registered.some((s) => s.name === BATCH), "让位时批量交付合同仍然注册（只管形状，不依赖内核副本）");
  check(r.registered.some((s) => s.name === LAYER2), "让位的是内核，保留的是中段锚点");
  // 让位就整体让位：内核不注入时，末位锚点与运行时锚点都不许单独挂上去，
  // 否则模型手里只剩半个载荷（两三行命令语气、没有 5 槽骨架与交付物契约）。
  check(!r.registered.some((s) => s.name === "infinite-gen-5:tail-anchor"), "让位时不追加末位锚点");
  check(r.registeredContexts.length === 0, "让位时不注册运行时锚点");
  check(r.profile?.dedupe?.role === "yielded", "profile 如实汇报已让位");
  const skip = r.profile?.dedupe?.skipped?.[0];
  check(skip?.duplicateOf === "infinite-gen-4:global-system-prompt", "让位对象被点名", JSON.stringify(skip));
  check(skip?.kind === "identical", "识别为逐字同源");
}

// ---- 3. 近同源（只差一个结尾换行）也要拦住 ----
{
  const payload = readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8");
  const r = run({ preexisting: [["infinite-gen-4:global-system-prompt", payload.trimEnd()]] });
  check(r.registered.length === 2, "只差结尾空白的近同源也算重复");
  check(r.profile?.dedupe?.role === "yielded", "近同源同样让位");
}

// ---- 4. 我方是子集（对方更完整）→ 让位 ----
{
  const payload = readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8");
  const r = run({
    preexisting: [["infinite-gen-4:global-system-prompt", payload + "\n附加的额外一段规则\n"]],
  });
  check(r.registered.length === 2, "对方更完整时我方让位");
  check(r.profile?.dedupe?.skipped?.[0]?.kind === "subset", "让位原因标为 subset");
}

// ---- 5. 无关段落不得误伤 ----
{
  const r = run({ preexisting: [["harness:identity", "You are an AI agent powered by DeepSeek Harness."]] });
  check(r.registered.length === 8, "无关段落在场时照常注入八段", `实得 ${r.registered.length}`);
  check(r.profile?.dedupe?.role === "primary", "无关段落不触发让位");
}

// ---- 6. 枚举不到宿主段落时绝不静默丢载荷 ----
{
  const r = run({ enumerable: false });
  check(r.registered.length === 8, "无法枚举宿主段落时照常注入（宁可重复，不可静默丢失）", `实得 ${r.registered.length}`);
  check(r.profile?.dedupe?.role === "primary", "无法枚举时按内核提供方处理");
}

// ---- 7. 热重载残留：宿主里已有「我方自己的」段名 → 不得因此把自己判成重复 ----
{
  const mine = readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8");
  const r = run({ preexisting: [[PRIMARY, mine]] });
  check(r.registered.length === 8, "自己的段名不算同源重复（热重载安全）", `实得 ${r.registered.length}`);
  check(r.registered[0].name === PRIMARY, "热重载后内核仍会重新注册");
}

// ---- 8. 宿主没有 systemPrompt.section → 不抛错，且工具/投影照常 ----
{
  const tools = [];
  let threw = null;
  try {
    plugin.apply({
      systemPrompt: {},
      tools: { register: (t) => tools.push(t) },
      effect: (fn) => fn(),
      get: () => undefined,
      inject: () => {},
    });
  } catch (error) {
    threw = error;
  }
  check(threw === null, "缺 systemPrompt.section 时不抛错", threw && String(threw.message));
  check(tools.some((t) => t.name === "infinite_gen5_profile"), "缺 systemPrompt.section 时 profile 工具仍注册", JSON.stringify(tools.map((t) => t.name)));
  check(tools.some((t) => t.name === "infinite_gen5_scenario"), "缺 systemPrompt.section 时领域工具仍注册");
  check(tools.some((t) => t.name === "infinite_gen5_env"), "缺 systemPrompt.section 时环境工具仍注册");
}

// ---- 9. 回归护栏：源码里不得再出现「第二份完整内核」的写法 ----
{
  const src = readFileSync(join(ROOT, "index.js"), "utf8");
  check(/LAYER2_MODE\s*=\s*"anchor"/.test(src), "index.js 默认 Order 200 为 anchor");
  check(/const ANCHOR_TEXT =/.test(src), "index.js 定义了中段锚点文本");
  check(/const TAIL_ANCHOR_TEXT =/.test(src), "index.js 定义了真末位锚点文本");
  check(/TAIL_MODE\s*=\s*"waterfall"/.test(src), "index.js 默认末位锚点走 assemble 瀑布");
  check(/TAIL_ORDER\s*=\s*10150/.test(src), "末位锚点退化为 order 10150");
  check(/RUNTIME_ANCHOR_MODE\s*=\s*"cadence"/.test(src), "index.js 默认运行时锚点走节拍模式");
  check(
    new RegExp(`RUNTIME_ANCHOR_EVERY\\s*=\\s*${EVERY_STEPS}\\b`).test(src),
    `运行时锚点默认每 ${EVERY_STEPS} 步重述`,
  );
  check(/RUNTIME_ANCHOR_EVERY\s*=\s*4\b/.test(src), "默认节拍经实测调参定为 4 步（更贴合长任务的重述节奏）");
  check(/RUNTIME_ANCHOR_ORDER\s*=\s*118/.test(src), "运行时锚点排在 115 审批策略之后");
  check(
    /工具调用一轮一个、参数扁平不塞正文，坏包改小重发/.test(src),
    "运行时锚点（离模型最近的一格）也复述工具调用卫生 —— 坏包修复回路不只躺在内核里（v0.13.7）",
  );
  check(
    /结果被截断也按坏包处理/.test(src),
    "运行时锚点把结果侧截断也纳入坏包纪律（v0.13.8：两个方向都管）",
  );
  check(/EXCLUSIVE_SECTION\s*=\s*false/.test(src), "独占内核默认关闭");
  check(/export const IG5_CONFIG = \{/.test(src), "自检接缝 IG5_CONFIG 已导出");
  check(/\bconst CFG = IG5_CONFIG\b/.test(src), "apply() 经 IG5_CONFIG 取值（自检可改档位驱动）");
  check(/system-prompt\/assemble/.test(src), "index.js 挂了 system-prompt/assemble 瀑布");
  check(/DEDUPE_PAYLOAD\s*=\s*true/.test(src), "index.js 默认开启同源去重");
  check(!/text:\s*PROMPT41_TEXT/.test(src), "index.js 不再把镜像文件当默认 Order 200 载荷");
}

// ---- 10. 客户端：二代徽标折叠 + 徽标标识不再撞车 ----
{
  const client = readFileSync(join(ROOT, "client.js"), "utf8");
  check(/FOREIGN_BADGE\s*=\s*\/\^无限\[三四\]代\//.test(client), "客户端会识别上一代破甲徽标");
  check(/data-armor":\s*"gen5"/.test(client), "五代徽标改用独立标识，不再与上一代同为 on");
  check(/data-armor-folded-by/.test(client), "折叠动作留下可审计标记");
  check(/MutationObserver/.test(client), "用 MutationObserver 处理徽标后挂载");
  check(/已折叠上一代破甲徽标/.test(client), "折叠后在 title 里说明去向");
  {
    const pkgUi = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const escaped = pkgUi.version.replace(/\./g, "\\.");
    check(new RegExp('var VERSION = "v' + escaped + '"').test(client) &&
      /"无限五代 "\s*\+\s*VERSION/.test(client), "徽标版本由 package.json 驱动", pkgUi.version);
  }
  check(!/无限五代 v0\.5\.0/.test(client), "客户端不再残留 v0.5.0 字样");
  const hooks = (client.match(/useProjection\(/g) || []).length;
  // v0.50.2：抽屉第四页要读宿主任务清单，投影调用从 2 增至 3（infinite-gen-5:armor / armor / todos）。
  // 这里钉的是「数量不变」这个不变量本身：增删投影都必须同步改这条，避免 hook 顺序被无意打乱。
  check(hooks === 3, "useProjection 调用数保持不变（hook 顺序恒定）", `实得 ${hooks}`);
  check(/if \(!foldable\) return undefined;/.test(client), "拿不到投影数据时不折叠别人的徽标");
}

// ---- 11. 版本一致性 ----
{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const src = readFileSync(join(ROOT, "index.js"), "utf8");
  // 版本号只有一处字面量（index.js 的 PLUGIN_VERSION），其余全部引用它。
  // 断言写成「字面量 == package.json」而不是「代码里有这个字符串」，
  // 这样任何一边改了、另一边没跟上都会报错，而重构掉字面量也不会假失败。
  check(/^\d+\.\d+\.\d+$/.test(pkg.version), "package.json 版本号形如 x.y.z", pkg.version);
  check(pkg.dsh?.version === pkg.version, "package.json 的 dsh.version 与 version 一致");
  check(src.includes(`const PLUGIN_VERSION = "${pkg.version}"`), "index.js 的 PLUGIN_VERSION 与 package.json 一致");
  check(src.includes("pluginVersion: PLUGIN_VERSION"), "profile 工具引用 PLUGIN_VERSION 而不是再写一遍");
  check(src.includes("kernelVersion: KERNEL_VERSION"), "kernelVersion 引用 KERNEL_VERSION");
  check(!/pluginVersion: "\d/.test(src) && !/kernelVersion: "\d/.test(src), "index.js 里不再有第二处版本字面量");
}

const total = passes.length + failures.length;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ passed: passes.length, failed: failures.length, passes, failures }, null, 1));
} else {
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`\n去重行为检查：${passes.length} 通过 / ${failures.length} 失败（共 ${total} 条）`);
}
process.exit(failures.length === 0 ? 0 : 1);
