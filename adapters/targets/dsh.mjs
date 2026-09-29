// 兼容层 · DSH 宿主（插件分节 + 组装瀑布）
//
// 这条通道是「原始宿主」：它提供的能力最全（分节注册 / 组装瀑布 / 工具面 / 热加载 / 投影 / 任务清单），
// 也是唯一能承诺**真末位锚点**的通道 —— 因为只有它能把自己的段落追加到组装结果末尾。
//
// 本文件是纯描述：不 import 宿主、不注册任何东西。真实注册发生在 dsh-infinite-gen-5/index.js，
// 那份代码已经跑在生产上；这里把它依赖的契约固化成可校验的数据结构。

import { SLOT, DEDUPE, compileFlags, validateAdapter, DEGRADE } from "../lib/adapter-spec.mjs";

export const TARGET_VERSION = "DSH >=0.1.7-rc.2（插件协议 v1）";

// 宿主侧已有的常量（对齐 index.js 的实际取值，改动时两处一起改）。
export const SECTION = {
  primary: { name: "infinite-gen-5:kernel", order: 100 },
  index: { name: "infinite-gen-5:index", order: 120 },
  lazy: { name: "infinite-gen-5:lazy-sections", order: 160 },
  tail: { name: "infinite-gen-5:tail-anchor", order: 999 },
};

export const adapter = {
  id: "dsh",
  label: "DSH 插件（systemPrompt.section + assemble 瀑布）",
  version: TARGET_VERSION,
  channel: "plugin-assemble",
  slot: SLOT.LAST,
  dedupe: DEDUPE.YIELD,
  caps: ["systemPromptSection", "systemPromptAssemble", "toolSurface", "hotReload"],
  notes: [
    "宿主提供 ctx.systemPrompt.section() 与 assemble 瀑布：可承诺真末位锚点。",
    "缺少 assemble 的宿主（假宿主 / 老版本）不得宣称末位 —— 见 DEGRADE.systemPromptAssemble。",
    "注入前先做同源检查：宿主里已有同源载荷时整段让位，避免双份计费。",
  ],
  budget: { kernelBytes: 24000, indexBytes: 9600, lazyBudgetBytes: 6000, totalBytes: 40000 },
};

validateAdapter(adapter);

export function flags() {
  return compileFlags(adapter);
}

// 能力探测：宿主对象进、能力报告出。任何一项缺失都给明确的降级动作，而不是抛错。
export function probe(host = {}) {
  const sp = host.systemPrompt ?? {};
  const has = (fn) => typeof fn === "function";
  const caps = {
    systemPromptSection: has(sp.section),
    systemPromptAssemble: has(sp.assemble),
    toolSurface: Boolean(host.tools) || has(host.registerTool) || has(host.tool),
    hotReload: true, // DSH 插件从盘上热读（见 index.js:81 的 v0.28.0 备忘）
    sessionProjection: Boolean(host.projection) || has(sp.context),
    taskList: Boolean(host.todos) || Boolean(host.tasks),
  };
  const degradations = [];
  for (const [cap, ok] of Object.entries(caps)) {
    if (!ok && DEGRADE[cap]) degradations.push({ cap, action: DEGRADE[cap] });
  }
  return { caps, degradations, canInject: caps.systemPromptSection, tailAnchor: caps.systemPromptAssemble };
}

/** 摊成宿主调用序列（人读 + 可被 verify 脚本断言）。 */
export function layout(load, { prepared = [] } = {}) {
  const calls = [];
  for (const p of prepared) {
    const spec =
      p.id === "core.kernel"
        ? SECTION.primary
        : p.id === "core.index.via-tool" || p.id === "core.index.inline"
          ? SECTION.index
          : p.id === "core.tail-anchor"
            ? SECTION.tail
            : null;
    calls.push({
      api: spec === SECTION.tail ? "systemPrompt.assemble(append)" : "systemPrompt.section(spec)",
      section: spec ? spec.name : `${adapter.id}:${p.id}`,
      order: spec ? spec.order : 500,
      bytes: p.bytes ?? Buffer.byteLength(p.text, "utf8"),
      text: p.text,
    });
  }
  return {
    adapter: adapter.id,
    host: "dsh",
    calls,
    lazyRegistration: {
      api: "systemPrompt.section({name, order, mode:'lazy', units})",
      section: SECTION.lazy.name,
      order: SECTION.lazy.order,
      units: load.lazy.units.map((u) => ({ id: u.id, order: u.order, triggers: u.triggers.length, bytes: u.bytes })),
      budgetBytes: load.lazy.budgetBytes,
    },
    tools: ["infinite_gen5_scenario", "infinite_gen5_env", "infinite_gen5_dispatch", "infinite_gen5_profile"],
    dedupe: {
      probe: "hostSections() 读 systemPrompt.layers.merge / global.sections",
      match: "findSameKernel(text, sections, ownNames)",
      onHit: "整段让位（DEDUPE_PAYLOAD），只保留工具与投影",
    },
    warnings: [
      "改 prompts/*.md 后需重启进程（v0.28.0 前）或触发宿主热加载钩子",
      "禁止在没有 systemPrompt.section 的宿主上假装注入成功",
    ],
  };
}

export default adapter;
