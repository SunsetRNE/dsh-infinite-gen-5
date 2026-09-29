// 公共层 · 文件载体组装
//
// 有些宿主没有运行期注入：它只会读**盘上的一个 .md**（Codex / gpt-instruct 的
// model_instructions_file 就是这种）。这类通道的「自适应」只能在**编译期**发生：
// 探到的上下文窗口 / system 段态度决定这一个文件里到底塞多少、惰性章节是展开正文还是留指针。
//
// 本模块是纯函数：给 blocks（编译产物）+ units（真源惰性单元）+ plan（adaptPlan 的结论），
// 回一份文件正文与账目。写盘、改 config.toml 是 deploy 侧的事，这里不碰。

export const FILE_CARRIER_VERSION = "ig5-file-carrier/1";

// gpt-instruct 的 epoch 规则：候选提示词 ≤ 8000 UTF-8 bytes。
export const CARRIER_CAP_BYTES = 8000;

const POINTER_HEAD = "## 惰性章节（本载体为盘上单文件：正文已被裁掉，需要时按下面的锚点展开）";

function pointerLine(unit) {
  const triggers = Array.isArray(unit.triggers) ? unit.triggers.slice(0, 4).join("/") : "";
  return `- ${unit.id} · order ${unit.order} · anchor ${unit.anchor} · 触发词 ${triggers}`;
}

function joinBlocks(parts) {
  return parts.filter((p) => typeof p === "string" && p.length > 0).join("\n\n");
}

/**
 * 组装文件载体正文。
 *
 * @param {object} input
 * @param {Array<{id:string,text:string}>} input.blocks 编译产物分块（core.kernel / core.index.* / core.tail-anchor）
 * @param {Array<{id:string,order:number,anchor:string,triggers:Array<string>,body:string,bytes:number}>} input.units 真源惰性单元
 * @param {object} input.plan adaptPlan 的结论（只读 lazyMode / injectLazy / budgetBytes）
 * @param {number} [input.cap] 载体硬上限，默认 8000 B（gpt-instruct 规则）
 * @param {boolean} [input.pointer] 是否输出指针清单，默认 true（留了指针，人才知道去哪展开）
 */
export function composeCarrierFile({
  blocks = [],
  units = [],
  plan = {},
  cap = CARRIER_CAP_BYTES,
  pointer = true,
  alwaysIndex = true,
} = {}) {
  const notes = [];
  const mode = plan.lazyMode ?? "off";
  const injectLazy = plan.injectLazy !== false && mode !== "off";
  const budget = Number(plan.budgetBytes) > 0 ? Math.min(Number(plan.budgetBytes), cap) : cap;

  // 固定部分：内核正文 + 域索引（索引是否内嵌由调用方给的 blocks 决定，文件载体通常必须内嵌）
  const fixedBlocks = blocks.filter((b) => b && b.text);
  const fixedText = joinBlocks(fixedBlocks.map((b) => b.text));
  const fixedBytes = Buffer.byteLength(fixedText, "utf8");

  if (fixedBytes > budget) {
    notes.push(`固定部分 ${fixedBytes} B 已超过可用预算 ${budget} B（cap ${cap} B）：只能部署超限文件或换更小的索引`);
  }

  const included = [];
  const dropped = [];
  const bodies = [];
  const pointerBlock = pointer && units.length ? [POINTER_HEAD, ...units.map(pointerLine)].join("\n") : "";
  const pointerBytes = Buffer.byteLength(pointerBlock, "utf8");
  let used = fixedBytes;
  // 指针清单也在同一份文件里：给正文分预算时必须先把它扣掉，否则会算出一个「超限但账目说没超」结果。
  const bodyBudget = Math.max(0, budget - pointerBytes);

  if (injectLazy) {
    if (pointerBytes + fixedBytes > budget) {
      notes.push(`指针清单 ${pointerBytes} B + 固定部分 ${fixedBytes} B 已吃掉全部预算 ${budget} B：惰性正文一律不进`);
    }
    for (const unit of units) {
      const body = `${(unit.body ?? "").trim()}\n`;
      const size = Buffer.byteLength(body, "utf8");
      if (used + size > bodyBudget) {
        dropped.push({ id: unit.id, bytes: size, because: `超预算（正文预算 ${bodyBudget} B，已用 ${used} B）` });
        continue;
      }
      bodies.push(body.trimEnd());
      included.push({ id: unit.id, bytes: size });
      used += size;
    }
  } else {
    for (const unit of units) {
      dropped.push({ id: unit.id, bytes: unit.bytes ?? 0, because: mode === "off" ? "plan.lazyMode=off" : "plan.injectLazy=false" });
    }
  }

  const text = joinBlocks([fixedText, ...bodies, pointerBlock]);
  const bytes = Buffer.byteLength(text, "utf8");
  const withinCap = bytes <= cap;

  return {
    version: FILE_CARRIER_VERSION,
    mode,
    injectLazy,
    text,
    bytes,
    cap,
    budget,
    withinCap,
    oversizeBy: withinCap ? 0 : bytes - cap,
    fixedBytes,
    included,
    dropped,
    blocks: fixedBlocks.map((b) => ({ id: b.id, bytes: Buffer.byteLength(b.text, "utf8") })),
    notes,
    alwaysIndex,
  };
}
