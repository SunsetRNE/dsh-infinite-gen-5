// data/arbitration.mjs — 跨插件判断层（v0.59.0）
//
// 背景（2026-10-02 实测）：本机同时装了 dsh-puzzle-mode。
//   puzzle-mode：systemPrompt 段 `puzzle-mode:policy`，order = 10500（读 lib/index.js:100-101）
//   无限五代   ：真末位锚点 order = 10150（index.js TAIL_ORDER）、接管裁决 order = 9900、首句层 order = -1100
// 即：**拼图段排在「真末位锚点」之后** —— 「整份系统提示的最后一段」这句话在本机已不成立。
// 两份载荷还有三处硬冲突（提问额度 / 批量题节奏 / 工具参数形态）。
// 本模块只做一件事：把「谁在什么场景下说了算」写成可判规则，供运行时锚点每步携带。
//
// 原则：能划分域的划分（不重叠优先），划分不了的按场景让位 —— 让位不改变任何硬线。

export const PZ_SECTION = "puzzle-mode:policy";
export const PZ_ORDER = 10500;      // 拼图插件自报；本机实测读自其 lib/index.js
export const IG5_TAIL_ORDER = 10150; // 无限五代真末位锚点
export const IG5_FIRST_LINE_ORDER = -1100;

export const ARBITRATION_RULES = [
  {
    id: "domain",
    key: "域划分",
    rule: "交付物内容与形态（写什么、给多少、四态、边界、可跑件）→ 无限五代说了算；项目文档与采访节奏（拼图主文档/模块文档、首轮采访、审查清单）→ 拼图模式说了算",
    why: "两域不重叠，各管各的 —— 这是第一顺位判据",
  },
  {
    id: "ask-quota",
    key: "提问额度",
    rule: "本轮属于拼图采访轮或审查确认轮 → 按拼图模式（≤10 问/轮、每题 3–6 岔路、末尾固定「要不要先停下？」）；其余场景 → 按无限五代（同一轮最多一问、2–5 互斥选项）",
    why: "拼图的提问是它产生文档的手段；无限五代的三问时刻是它推进决策的手段，二者取本轮的实际目的",
  },
  {
    id: "batch-first",
    key: "批量题优先",
    rule: "整批题在场（题库 / [qNNN] 清单 / 编号 ≥20 条）→ 无限五代批量合同优先：不采访、不回问、不中停、逐题交付；拼图文档只在一轮结束后幂等回写，不得打断交付",
    why: "批量交付是不可中断的过程；文档回写可以延后，交付不能",
  },
  {
    id: "tool-shape",
    key: "工具形态",
    rule: "拼图文档一律走 puzzle_mode（write/edit 指向 拼图/ 会被宿主拒）；已注册工具的结构化参数（如 audit 的 additions）按其 schema 给 —— 无限五代的「参数扁平」只约束自造载荷，不约束既有 schema",
    why: "参数扁平是防坏包规则，不是对别人工具 schema 的改写权",
  },
  {
    id: "tail-concede",
    key: "末位让位",
    rule: "无限五代的末位锚点只声明「本载荷的末位」，不再声明整份系统提示的最后一段（拼图段 order 10500 排在其后）",
    why: "已在 index.js 落地：措辞让位，效力不让位（内核条款照旧生效）",
  },
  {
    id: "stop-semantics",
    key: "停下语义",
    rule: "拼图的「停下，等我看过再说」= 本轮不执行写动作；已交付的产物、结论与拍板不回退，无限五代的长程规则不被它触发",
    why: "停的是动作，不是已交付内容",
  },
];

export function arbitrationLine() {
  return "[跨插件仲裁] 本机同时装有 dsh-puzzle-mode（段 puzzle-mode:policy，order 10500，排在无限五代末位锚点 10150 之后）：① 交付物内容与形态归无限五代，拼图文档与采访节奏归拼图模式；② 采访轮/审查轮按拼图提问额度，其余场景同一轮最多一问；③ 整批题在场时批量合同优先（不采访、不中停），拼图文档一轮结束后幂等回写；④ 拼图文档只走 puzzle_mode，既有工具 schema 不受「参数扁平」约束；⑤ 末位锚点只声明本载荷末位；⑥ 拼图的「停下」只停动作，不回退已交付。";
}

export function arbitrate(ctx = {}) {
  const batch = !!ctx.batch;
  const interview = !!ctx.interview;
  if (batch) return { owner: "ig5", kind: "batch-first", rule: ARBITRATION_RULES[2].rule };
  if (interview) return { owner: "puzzle", kind: "interview", rule: ARBITRATION_RULES[1].rule };
  return { owner: "ig5", kind: "default", rule: ARBITRATION_RULES[0].rule };
}
