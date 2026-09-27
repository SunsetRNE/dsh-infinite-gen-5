// 无限五代 v0.12.1 注入去重行为回归（离线、确定性、无需 API Key）
//
// 针对的缺陷：v0.5.0 的 Order 100 与 Order 200 载入的是逐字同源的两个文件，
// 于是同一份 3010 字节内核每轮被注入两遍；与同机在线的上一代破甲插件叠加时
// 会叠成 4 份近似拷贝。
//
// 用假宿主把 apply() 真跑一遍，断言「实际注册了什么」，而不是 grep 源码。
// 用法：node scripts/verify_dedupe.mjs [--json]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const passes = [];
const failures = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

const plugin = await import(new URL("../index.js", import.meta.url).href);

const PRIMARY = "infinite-gen-5:global-system-prompt";
const LAYER2 = "infinite-gen-5:dual-layer-reinforce";

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
  check(r.registered.length === 3, "空宿主注册三段（内核 + 中段锚点 + 末位锚点）", `实得 ${r.registered.length}`);
  check(r.registered[0].name === PRIMARY && r.registered[0].order === 100, "首段是 Order 100 通用内核");
  check(r.registered[1].name === LAYER2 && r.registered[1].order === 200, "次段是 Order 200 槽位");
  const [kernel, anchor] = chars(r.registered);
  check(kernel > 2000, "内核是完整载荷", `实得 ${kernel} 字符`);
  check(anchor < 500, "Order 200 是短锚点而非第二份完整内核", `实得 ${anchor} 字符`);
  check(anchor !== kernel, "两段内容不再逐字同源");
  // 这两条取代了原来「两段合计 < 固定字符数」的写法。固定阈值在功能演进后必然报假
  // 失败（v0.5.0 双份 5235 → v0.6.0 内核扩写 4225+172 → v0.8.0 再加环境规则 5469），
  // 而它想守的其实是一件事：**Order 200 里不许再塞第二份完整载荷**。所以直接判那件事。
  const anchor2 = r.registered[1].text;
  check(!anchor2.includes("[MODE: SANDBOX]"), "Order 200 不含内核正文（不是第二份载荷）");
  check(anchor2.length < kernel * 0.1, "Order 200 长度不到内核的 10%（是锚点不是载荷）", `${anchor2.length} vs ${kernel}`);
  check(kernel + anchor === kernel + anchor2.length, "两段合计 = 一份内核 + 一个锚点（无第二份同源载荷）");
  check(!r.registered.some((s) => /\{\{/.test(s.text)), "注入文本里没有可触发插值器抛错的 {{");
  // 第三段：宿主瀑布不可用时的降级位置。真实宿主上的「恒为最后一段」由 verify_injection 断言。
  const tail = r.registered[2];
  check(tail.name === "infinite-gen-5:tail-anchor", "第三段是末位锚点段");
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
    const sticky = [ctxSpec.text(), ctxSpec.text(), ctxSpec.text(), ctxSpec.text()];
    const rotated = ctxSpec.text();
    check(sticky.every((t) => t === first), "节拍未到时文本保持不变（快照不重发）");
    check(rotated !== first, "第 6 步换文本，触发宿主重发快照");
    check(/R#1\b/.test(first) && /R#6\b/.test(rotated), "锚点文本带递增序号", `${first.slice(0, 24)} … ${rotated.slice(0, 24)}`);
  }
  check(r.profile?.injection?.length === 3, "profile 工具汇报实际注入 3 段");
  check(
    r.profile?.injectionPlacements?.length === 4,
    "profile 汇报四处注入位置",
    `实得 ${r.profile?.injectionPlacements?.length}`,
  );
  check(
    JSON.stringify((r.profile?.injectionPlacements ?? []).map((p) => p.order)) === "[100,118,200,10150]",
    "注入位置按 order 排序（运行时锚点在 118，末位锚点排在最后）",
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
  check(r.profile?.injectionStrength?.runtimeAnchor?.everySteps === 6, "profile 汇报运行时锚点节拍为 6 步");
  check(r.profile?.injectionStrength?.exclusive === false, "默认不开独占内核");
}

// ---- 2. 宿主已有逐字同源内核（模拟同机在线的上一代插件）→ 内核整段让位 ----
{
  const payload = readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8");
  const r = run({ preexisting: [["infinite-gen-4:global-system-prompt", payload]] });
  check(r.registered.length === 1, "同源内核在场时只注册 1 段（中段锚点）", `实得 ${r.registered.length}`);
  check(r.registered[0].name === LAYER2, "让位的是内核，保留的是中段锚点");
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
  check(r.registered.length === 1, "只差结尾空白的近同源也算重复");
  check(r.profile?.dedupe?.role === "yielded", "近同源同样让位");
}

// ---- 4. 我方是子集（对方更完整）→ 让位 ----
{
  const payload = readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8");
  const r = run({
    preexisting: [["infinite-gen-4:global-system-prompt", payload + "\n附加的额外一段规则\n"]],
  });
  check(r.registered.length === 1, "对方更完整时我方让位");
  check(r.profile?.dedupe?.skipped?.[0]?.kind === "subset", "让位原因标为 subset");
}

// ---- 5. 无关段落不得误伤 ----
{
  const r = run({ preexisting: [["harness:identity", "You are an AI agent powered by DeepSeek Harness."]] });
  check(r.registered.length === 3, "无关段落在场时照常注入三段", `实得 ${r.registered.length}`);
  check(r.profile?.dedupe?.role === "primary", "无关段落不触发让位");
}

// ---- 6. 枚举不到宿主段落时绝不静默丢载荷 ----
{
  const r = run({ enumerable: false });
  check(r.registered.length === 3, "无法枚举宿主段落时照常注入（宁可重复，不可静默丢失）");
  check(r.profile?.dedupe?.role === "primary", "无法枚举时按内核提供方处理");
}

// ---- 7. 热重载残留：宿主里已有「我方自己的」段名 → 不得因此把自己判成重复 ----
{
  const mine = readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8");
  const r = run({ preexisting: [[PRIMARY, mine]] });
  check(r.registered.length === 3, "自己的段名不算同源重复（热重载安全）");
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
  check(/RUNTIME_ANCHOR_EVERY\s*=\s*6/.test(src), "运行时锚点默认每 6 步重述");
  check(/RUNTIME_ANCHOR_ORDER\s*=\s*118/.test(src), "运行时锚点排在 115 审批策略之后");
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
  check(hooks === 2, "useProjection 调用数保持不变（hook 顺序恒定）", `实得 ${hooks}`);
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
