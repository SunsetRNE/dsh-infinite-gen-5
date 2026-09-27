// 无限五代 v0.6.1 注入去重行为回归（离线、确定性、无需 API Key）
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

// ---- 假宿主：记录 section() 与 tools.register() 的真实调用 ----
function makeHost({ preexisting = [], enumerable = true } = {}) {
  const registered = [];
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
  return { ctx, registered, tools, store };
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

// ---- 1. 空宿主：单内核 + 短锚点，不再双份同源 ----
{
  const r = run({});
  check(r.registered.length === 2, "空宿主只注册两段（内核 + 锚点）", `实得 ${r.registered.length}`);
  check(r.registered[0].name === PRIMARY && r.registered[0].order === 100, "首段是 Order 100 通用内核");
  check(r.registered[1].name === LAYER2 && r.registered[1].order === 200, "次段是 Order 200 槽位");
  const [kernel, anchor] = chars(r.registered);
  check(kernel > 2000, "内核是完整载荷", `实得 ${kernel} 字符`);
  check(anchor < 500, "Order 200 是短锚点而非第二份完整内核", `实得 ${anchor} 字符`);
  check(anchor !== kernel, "两段内容不再逐字同源");
  // v0.5.0 的双份载荷实测 5235 字符（ADAPTATION.md §9）。v0.6.0 主动扩写了内核的
  // 领域/语言覆盖（5 槽骨架 + 45 域 × 7 族点名 + 语言规则 + 4 条 few-shot），所以
  // 绝对预算从 3200 上调到 5200 —— 门槛仍设在旧版双份注入之下：单份内核再怎么长，
  // 也没有回到 v0.5.0 的重复注入。
  check(kernel + anchor < 5200, "两段合计仍低于 v0.5.0 的双份载荷（5235 字符）", `实得 ${kernel + anchor} 字符`);
  check(!r.registered.some((s) => /\{\{/.test(s.text)), "注入文本里没有可触发插值器抛错的 {{");
  check(r.profile?.injection?.length === 2, "profile 工具汇报实际注入 2 段");
  check(r.profile?.dedupe?.role === "primary", "profile 汇报本插件是内核提供方");
  check(r.profile?.dedupe?.skipped?.length === 0, "空宿主上没有发生让位");
  check(r.profile?.layer2Mode === "anchor", "profile 汇报 Order 200 模式为 anchor");
}

// ---- 2. 宿主已有逐字同源内核（模拟同机在线的上一代插件）→ 内核整段让位 ----
{
  const payload = readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8");
  const r = run({ preexisting: [["infinite-gen-4:global-system-prompt", payload]] });
  check(r.registered.length === 1, "同源内核在场时只注册 1 段（锚点）", `实得 ${r.registered.length}`);
  check(r.registered[0].name === LAYER2, "让位的是内核，保留的是末位锚点");
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
  check(r.registered.length === 2, "无关段落在场时照常注入两段", `实得 ${r.registered.length}`);
  check(r.profile?.dedupe?.role === "primary", "无关段落不触发让位");
}

// ---- 6. 枚举不到宿主段落时绝不静默丢载荷 ----
{
  const r = run({ enumerable: false });
  check(r.registered.length === 2, "无法枚举宿主段落时照常注入（宁可重复，不可静默丢失）");
  check(r.profile?.dedupe?.role === "primary", "无法枚举时按内核提供方处理");
}

// ---- 7. 热重载残留：宿主里已有「我方自己的」段名 → 不得因此把自己判成重复 ----
{
  const mine = readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8");
  const r = run({ preexisting: [[PRIMARY, mine]] });
  check(r.registered.length === 2, "自己的段名不算同源重复（热重载安全）");
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
}

// ---- 9. 回归护栏：源码里不得再出现「第二份完整内核」的写法 ----
{
  const src = readFileSync(join(ROOT, "index.js"), "utf8");
  check(/LAYER2_MODE\s*=\s*"anchor"/.test(src), "index.js 默认 Order 200 为 anchor");
  check(/const ANCHOR_TEXT =/.test(src), "index.js 定义了末位锚点文本");
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
