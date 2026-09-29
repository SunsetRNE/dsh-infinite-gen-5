// 无限五代 · 公共层编译器（Kernel Compiler）
//
// 输入：盘上三份真源（常驻内核 / 惰性章节 / 完整档）+ 宿主 adapter 声明
// 输出：一份**与宿主无关**的载荷对象（compiled load）+ 一份清单（manifest）
//
// 这里刻意不 import 任何宿主模块、不读写任何宿主的配置文件 —— 编译只做翻译，
// 落盘与注入是兼容层的事（mount() / layout()）。
import { readFileSync } from "node:fs";
import { compileFlags, SLOT, DEDUPE } from "./adapter-spec.mjs";
import { kernelSignature, checkKernelIntegrity, sha256 } from "./kernel-signature.mjs";
import { buildArtifact, verifyArtifact, serializeArtifact } from "./release-artifact.mjs";

/** 媒体类型：声明某段文本「零宿主假设」需要哪一级别的证据。 */
export const COMPAT = Object.freeze({
  GENERIC: "generic", // 任何能读文本的 AI 都能用
  TOOL: "tool", //     需要宿主能注册工具（领域包 / 环境探针）
  RUNTIME: "runtime", // 需要宿主提供运行时接口（投影 / 任务清单 / 热加载）
});

export const DEFAULT_BUDGET = Object.freeze({
  kernelBytes: 24000,
  indexBytes: 9600,
  lazyBudgetBytes: 6000,
  totalBytes: 40000,
});

// 常驻内核里的指针行模板。惰性 unit 被搬出内核后，原位只留这一行。
const POINTER = (id, anchor, digest) =>
  `【惰性 ${id}｜${anchor}】全文不常驻；命中触发词时由兼容层从惰性表按 id 原文拼回（digest ${digest}）。`;

/**
 * 解析惰性章节文件，拆出 unit 表。
 * 正则与 data/lazy-sections.mjs 的 `@@unit:` 语法保持一致，但不复用那份代码 ——
 * 那边绑定在 DSH 的注入链路上，公共层要能独立跑。
 */
export function parseLazyUnits(text) {
  const units = [];
  const re = /^@@unit:([A-Za-z0-9_]+)\|order:(\d+)\|anchor:([^|\n]+)\|triggers:([^\n]+)\n([\s\S]*?)\n@@end:\1$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, id, order, anchor, triggers, body] = m;
    units.push(
      Object.freeze({
        id,
        order: Number(order),
        anchor: anchor.trim(),
        triggers: triggers.split("|").map((s) => s.trim()).filter(Boolean),
        body,
        bytes: Buffer.byteLength(body, "utf8"),
        sha256: sha256(body),
      }),
    );
  }
  units.sort((a, b) => a.order - b.order);
  return units;
}

/** 惰性档位 → 字节预算（宿主没有热加载能力时预算为 0，即整段不装卸）。 */
export const LAZY_MODES = Object.freeze({ off: 0, light: 3500, standard: 6000, full: 16000 });

export function resolveLazyBudget(mode, cap = 0) {
  const base = LAZY_MODES[mode] ?? LAZY_MODES.standard;
  if (cap > 0) return Math.min(base, cap);
  return base;
}

/**
 * 编译一份载荷。
 * @param {{sources:{primary,lazy,full}, flags, lazyMode, lazyBudgetBytes, signature}} input
 */
export function compileLoad(input) {
  const { sources, flags } = input;
  // 指纹由编译器自算（调用方仍可覆盖）。漏传就是一个静默的 undefined，
  // 一路飘到 buildManifest 才炸 —— 实测踩过：probe-runner 没传 signature。
  const signature = input.signature ?? kernelSignature({ primary: sources.primary, lazy: sources.lazy });
  const units = parseLazyUnits(sources.lazy);
  const byId = new Map(units.map((u) => [u.id, u]));

  // 1) 惰性 unit 必须从常驻正文里搬干净：否则同一段文字既常驻又按需装载，白烧 token。
  const residentText = stripLazyBodies(sources.primary, byId);

  // 2) 常驻内核切块：块边界来自内核自身的「小节标记」，不来自宿主。
  const blocks = [];
  blocks.push(
    block("core.kernel", 100, residentText, COMPAT.GENERIC, "常驻内核：五槽骨架 + 注入契约 + 工具调用卫生"),
  );

  if (flags.domainViaTool) {
    blocks.push(
      block(
        "core.index.via-tool",
        120,
        sources.index ?? "",
        COMPAT.TOOL,
        "领域索引由宿主工具按需取（infinite_gen5_scenario 一族），不常驻正文",
      ),
    );
  } else {
    blocks.push(
      block(
        "core.index.inline",
        120,
        sources.index ?? "",
        COMPAT.GENERIC,
        "宿主无工具注册能力：索引内嵌常驻，领域正文由用户粘贴触发",
      ),
    );
  }

  if (flags.tailAnchor) {
    blocks.push(block("core.tail-anchor", 999, sources.tailAnchor ?? "", COMPAT.GENERIC, "真末位锚点：组装末尾追加"));
  }

  const lazy = {
    mode: input.lazyMode,
    budgetBytes: resolveLazyBudget(input.lazyMode, input.lazyBudgetBytes ?? 0),
    enabled: Boolean(flags.lazyEnabled),
    units: units.map((u) => ({
      id: u.id,
      order: u.order,
      anchor: u.anchor,
      triggers: u.triggers,
      bytes: u.bytes,
      sha256: u.sha256,
      compat: u.id === "L_coverage" ? COMPAT.TOOL : COMPAT.GENERIC,
    })),
    table: new Map(units.map((u) => [u.id, u.body])),
  };

  const totalBytes = blocks.reduce((sum, b) => sum + b.bytes, 0);
  // 内嵌索引与惰性正文也是「真占位」的字节。此前只算常驻块，导致内嵌索引通道
  // （generic/claude/codex）超预算却不报警 —— 实测 29656 显示成「未超」的假通过。
  const indexBytes = blocks.find((b) => b.id === "core.index.inline")?.bytes ?? 0;
  const lazyBodyBytes = 0; // 惰性正文只在宿主侧按需注入，不占常驻预算
  const budget = {
    ...DEFAULT_BUDGET,
    ...(input.budget ?? {}),
    residentBytes: totalBytes,
    indexBytes,
    lazyBytes: lazy.budgetBytes,
    lazyBodyBytes,
  };
  // 预算是判据，不是装饰：超了就在这里记下来，构建与验证都读同一处。
  const budgetProblems = [];
  if (budget.residentBytes > budget.totalBytes) {
    budgetProblems.push(
      `常驻 ${budget.residentBytes} B 超总预算 ${budget.totalBytes} B（${budget.residentBytes - budget.totalBytes} B）`,
    );
  }
  if (indexBytes > budget.indexBytes) {
    budgetProblems.push(
      `内嵌域索引 ${indexBytes} B 超单列索引预算 ${budget.indexBytes} B（${indexBytes - budget.indexBytes} B）`,
    );
  }
  if (budget.lazyBytes > budget.lazyBudgetBytes) {
    budgetProblems.push(
      `惰性预算 ${budget.lazyBytes} B 超上限 ${budget.lazyBudgetBytes} B`,
    );
  }
  budget.problems = budgetProblems;

  const load = {
    kernelVersion: input.kernelVersion,
    adapter: input.adapterId,
    flags,
    slot: input.slot,
    dedupe: input.dedupe,
    blocks,
    lazy,
    budget,
    signature,
    placement: placementRule(input.slot, input.dedupe),
  };
  load.manifest = buildManifest(load, { units, blocks });
  return load;
}

function block(id, order, text, compat, note) {
  const body = text ?? "";
  return { id, order, text: body, bytes: Buffer.byteLength(body, "utf8"), compat, note, sha256: sha256(body) };
}

// 把 `@@unit:…@@end:` 包裹的正文从常驻内核里剔除，原位留一行带 digest 的指针。
function stripLazyBodies(primary, byId) {
  return primary.replace(
    /^@@unit:([A-Za-z0-9_]+)\|order:(\d+)\|anchor:([^|\n]+)\|triggers:([^\n]+)\n([\s\S]*?)\n@@end:\1$/gm,
    (whole, id) => {
      const unit = byId.get(id);
      if (!unit) return whole;
      return POINTER(unit.id, unit.anchor, unit.sha256.slice(0, 12));
    },
  );
}

function placementRule(slot, dedupe) {
  const where = {
    [SLOT.LAST]: "追加到系统提示词组装结果的末尾，紧随其后就是本轮用户输入",
    [SLOT.FIRST]: "放在系统提示词最前，宿主人格与安全声明排在其后",
    [SLOT.INLINE]: "随首轮用户消息内联送出，并声明该轮为一次性注入",
    [SLOT.FILE]: "交给宿主提示词文件机制，位次由宿主决定",
    [SLOT.NONE]: "由用户粘贴，位次不可控",
  }[slot] ?? "位次未声明";
  const dedupeRule = {
    [DEDUPE.YIELD]: "注册前检查宿主里是否已有同源载荷，有则整段让位",
    [DEDUPE.DROP_TAIL]: "发现同源载荷时保留主段、丢掉末位锚点",
    [DEDUPE.KEEP]: "不去重，调用方负责避免重复加载",
  }[dedupe] ?? "未声明去重策略";
  return Object.freeze({ where, dedupeRule });
}

function buildManifest(load, { units, blocks }) {
  return {
    schema: 1,
    adapter: load.adapter,
    kernelVersion: load.kernelVersion,
    signature: load.signature.semanticSha256,
    residentSha256: load.signature.primarySha256,
    blocks: blocks.map((b) => ({
      id: b.id,
      order: b.order,
      bytes: b.bytes,
      sha256: b.sha256.slice(0, 16),
      compat: b.compat,
    })),
    lazy: units.map((u) => ({
      id: u.id,
      order: u.order,
      bytes: u.bytes,
      sha256: u.sha256.slice(0, 16),
      triggers: u.triggers.length,
      cursor: null, // 由适配器落盘时回填（file / paste 载体需要可定位的偏移）
    })),
    residentBytes: load.budget.residentBytes,
    totalBudgetBytes: load.budget.totalBytes,
    utilization: Number((load.budget.residentBytes / load.budget.totalBytes).toFixed(4)),
  };
}

/** 把载荷渲染成「纯文本版」：任何宿主都能吃，不依赖 JSON / 工具。 */
export function renderGenericText(load) {
  const head = [
    `# 无限五代载荷 · 宿主无关版`,
    ``,
    `- 内核版本：${load.kernelVersion}`,
    `- 语义指纹：${load.signature.semanticSha256.slice(0, 16)}`,
    `- 位次：${load.placement.where}`,
    `- 去重：${load.placement.dedupeRule}`,
    `- 常驻字节：${load.budget.residentBytes} / 预算 ${load.budget.totalBytes}`,
    ``,
    `## 投放方式`,
    ``,
    `把本文件全文放进宿主的系统提示词 / 自定义指令 / 项目规则中，位次按上面「位次」一节执行。`,
    `若宿主有工具注册能力，另注册领域查询工具；没有则使用下文的领域索引。`,
    ``,
  ].join("\n");
  const body = load.blocks
    .sort((a, b) => a.order - b.order)
    .map((b) => `<!-- block ${b.id} order=${b.order} bytes=${b.bytes} compat=${b.compat} -->\n${b.text}`)
    .join("\n\n");
  return `${head}${body}\n`;
}

/**
 * 落盘产物：由 core 生成（保证与宿主无关），但写盘由兼容层的 outDir 决定。
 * 返回清单文件内容（JSON 文本），调用方负责 writeFileSync。
 */
export function planArtifacts(load, outDir, fileName = "infinite-gen-5.payload.md") {
  const text = renderGenericText(load);
  const artifact = buildArtifact({
    id: load.adapter,
    kernelVersion: load.kernelVersion,
    payload: text,
    extra: { outDir, fileName, blocks: load.blocks.length, lazyUnits: load.lazy.units.length },
  });
  return { text, manifest: load.manifest, artifact, artifactJson: serializeArtifact(artifact) };
}

export { verifyArtifact, serializeArtifact, buildArtifact };
export { kernelSignature, checkKernelIntegrity };
export { compileFlags };
