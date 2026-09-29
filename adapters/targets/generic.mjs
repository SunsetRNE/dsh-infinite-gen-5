// 兼容层 · 通用宿主（任何能读文本的 AI）
//
// 这条通道假设最少：没有工具注册、没有分节 API、没有组装瀑布。载荷以**单文件明文**交付，
// 由用户放进「自定义指令 / 系统提示词 / 项目规则」里的任意一个位置。
//
// 这是兜底通道，也是校验其他通道的基准：任何在 DSH 上跑通的载荷，
// 都必须能在这条通道上以「零工具」形态完整表达 —— 否则说明它偷偷依赖了宿主。

import { SLOT, DEDUPE, compileFlags, validateAdapter } from "../lib/adapter-spec.mjs";
import { sha256 } from "../lib/release-artifact.mjs";

export const TARGET_VERSION = "generic-doc-1（无工具假设）";

export const adapter = {
  id: "generic",
  label: "通用文本宿主（无工具、无分节 API）",
  version: TARGET_VERSION,
  channel: "paste",
  slot: SLOT.INLINE,
  dedupe: DEDUPE.KEEP,
  caps: ["pasteBlock"],
  notes: [
    "零能力假设：只要求宿主能接受一段文本。",
    "领域包无法按需取 → 索引内嵌；惰性章节无法热加载 → 整段不装卸。",
    "末位锚点降级为段末锚点（内联位次）。",
  ],
  budget: { kernelBytes: 20000, indexBytes: 8000, lazyBudgetBytes: 0, totalBytes: 28000 },
};

validateAdapter(adapter);

export function flags() {
  return compileFlags(adapter);
}

export function layout(load, { prepared = [] } = {}) {
  const body = prepared.map((p) => p.text).join("\n\n");
  return {
    adapter: adapter.id,
    host: "generic",
    files: [
      {
        path: "infinite-gen-5.generic.md",
        text: body,
        sha256: sha256(body),
        bytes: Buffer.byteLength(body, "utf8"),
        managed: false,
      },
    ],
    usage: [
      "把整份 markdown 贴进宿主的「自定义指令 / 系统提示词 / 项目规则」。",
      "宿主支持文件读取时，改为把该文件放进工作区并在首轮声明其为常驻规则。",
      "提交后先跑一次自检：让宿主复述五槽骨架与首行规则，答不上来说明载荷被截断。",
    ],
    degradeNotes: [
      "无工具注册能力：领域包索引内嵌常驻，正文由触发词命中后由用户粘贴。",
      "无热加载：改盘上提示词后需重新粘贴。",
    ],
    warnings: ["粘贴位次不可控，锚点强度按段末锚点估算"],
  };
}

adapter.mount = function mount({ dryRun = true, load = null } = {}) {
  return {
    adapter: adapter.id,
    host: "generic",
    dryRun,
    writes: [
      {
        path: "dist/generic/infinite-gen-5.generic.md",
        kind: "payload",
        bytes: load ? load.budget.residentBytes : 0,
        reason: "交付单文件，由用户自行粘贴进宿主的自定义指令位",
      },
    ],
    snapshot: "不适用：本通道不改动宿主文件，粘贴动作由用户完成",
    rollback: ["在宿主里删除粘贴的自定义指令；本层不留任何状态文件"],
    verify: ["node verify_adapters.mjs --target generic", "把 payload 交给宿主后让它复述五槽骨架，答不上来说明被截断"],
    notes: ["零能力假设通道：任何一项能力缺失都不构成失败，只降级"],
  };
};

export default adapter;
