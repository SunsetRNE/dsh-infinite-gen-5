// 兼容层 · Claude 系宿主（长上下文 + 显式缓存断点）
//
// 这条通道有一个 DSH 上没有的硬约束：**前缀缓存**。系统提示词按前缀匹配缓存，
// 任何一个字节变动都会让断点之后全部重算。所以本通道把载荷切成两段：
//   stable 段（内核 + 索引）—— 必须逐字节稳定，缓存断点放在它末尾
//   volatile 段（锚点）—— 每轮可变，放断点之后
// 结果是锚点既在末尾、又不污染缓存；把锚点挪到最前的写法在这条通道上是纯亏损。

import { SLOT, DEDUPE, compileFlags, validateAdapter } from "../lib/adapter-spec.mjs";
import { sha256 } from "../lib/release-artifact.mjs";

export const TARGET_VERSION = "Claude 系 / 长上下文 + prompt caching";

export const CHECKPOINT_AFTER = "core.kernel"; // 缓存断点落在这个块之后

export const adapter = {
  id: "claude",
  label: "Claude 系（Projects 自定义指令 / 系统提示词文件）",
  version: TARGET_VERSION,
  channel: "promptFile",
  slot: SLOT.LAST,
  dedupe: DEDUPE.KEEP,
  caps: ["promptFile"],
  notes: [
    "前缀缓存：稳定段与易变段必须物理分离，断点落在稳定段末尾。",
    "无工具注册能力 → 领域索引内嵌；无热加载 → 改文件后重新开始会话。",
    "长上下文不等于可以无脑加长：常驻预算按住 28 KB 封顶。",
  ],
  budget: { kernelBytes: 24000, indexBytes: 6000, lazyBudgetBytes: 0, totalBytes: 30000 },
};

validateAdapter(adapter);

export function flags() {
  return compileFlags(adapter);
}

export function layout(load, { prepared = [] } = {}) {
  const stable = prepared.filter((p) => p.id !== "core.tail-anchor");
  const volatile = prepared.filter((p) => p.id === "core.tail-anchor");
  const stableText = stable.map((p) => p.text).join("\n\n");
  const volatileText = volatile.map((p) => p.text).join("\n\n");

  const doc = [
    `<!-- stable: 逐字节稳定段，缓存断点在此之后 -->`,
    stableText,
    `<!-- cache_breakpoint -->`,
    volatileText ? `<!-- volatile: 每轮可变段 -->\n${volatileText}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    adapter: adapter.id,
    host: "claude",
    files: [
      {
        path: "infinite-gen-5.claude.md",
        text: doc,
        sha256: sha256(doc),
        bytes: Buffer.byteLength(doc, "utf8"),
        managed: false,
      },
    ],
    segments: [
      {
        id: "stable",
        bytes: Buffer.byteLength(stableText, "utf8"),
        sha256: sha256(stableText),
        cacheable: true,
        note: `断点落在 ${CHECKPOINT_AFTER} 之后`,
      },
      {
        id: "volatile",
        bytes: Buffer.byteLength(volatileText, "utf8"),
        sha256: sha256(volatileText),
        cacheable: false,
        note: "每轮可变，落在断点之后",
      },
    ],
    usage: [
      "Projects → 自定义指令 / 项目知识：粘贴 stable 段。",
      "易变锚点随每轮首条消息送入，不要写进项目知识（写了等于每轮打掉缓存）。",
      "API 用法：stable 段末尾打 cache_control 断点，锚点走当轮 messages。",
    ],
    warnings: [
      "把锚点放最前会打掉整个前缀缓存 —— 本通道明确禁止该写法",
      "禁止在 stable 段内写入任何带日期/版本号的动态文本",
    ],
  };
}

adapter.mount = function mount({ dryRun = true, load = null } = {}) {
  const stableBytes = load?.blocks?.filter((b) => b.id !== "core.tail-anchor").reduce((s, b) => s + b.bytes, 0) ?? 0;
  return {
    adapter: adapter.id,
    host: "claude",
    dryRun,
    writes: [
      {
        path: "项目知识 / 自定义指令（stable 段）",
        kind: "payload",
        bytes: stableBytes,
        reason: `逐字节稳定段；断点落在 ${CHECKPOINT_AFTER} 之后`,
      },
      {
        path: "当轮 messages（volatile 段）",
        kind: "payload",
        bytes: load?.blocks?.find((b) => b.id === "core.tail-anchor")?.bytes ?? 0,
        reason: "易变锚点随轮次送入，不进项目知识",
      },
    ],
    snapshot: "不适用：本通道不改动本地文件；撤销 = 清空项目知识",
    rollback: ["清空项目知识 / 自定义指令里的 stable 段", "删除当轮附带的 volatile 段"],
    verify: ["node verify_adapters.mjs --target claude", "部署后连问两轮，第二轮的缓存命中率应显著高于首轮；若无提升说明 stable 段被改动"],
    notes: ["stable 段一旦改动，前缀缓存全部重算 —— 改版必须接受一次全量计费"],
  };
};

export default adapter;
