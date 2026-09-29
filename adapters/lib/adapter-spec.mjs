// 无限五代 · 宿主适配层契约（Host Adapter Contract）
//
// 这一段是整个「抽公共层 + 兼容层」改造的地基：插件本体不再直接认识 DSH，
// 只认识 adapter 对象；换宿主 = 换 adapter，语义内核一个字不改。
//
// 三层职责（严格单向依赖）：
//   core   语义层     内核正文 / 惰性章节 / 领域包 / 预算表 —— 零导入，不认识任何宿主
//   spec   契约层     本文件：CAPS 能力位 + 校验 + 能力降级矩阵
//   target 兼容层     每个宿主一个模块，实现 mount() 并把 core 产物翻译成宿主的注入 API
//
// 禁止事项（一处违反就等于公共层失效）：
//   1) core/* 里不得出现宿主名（dsh / codex / claude / cursor …）；
//   2) target/* 里不得出现内核正文，只能引用 core 的产物；
//   3) 任何 target 不得修改 core 产物，只能选择 / 裁剪 / 转码。

/** 宿主能力位。target 只能声明，不能假装。 */
export const CAPS = Object.freeze([
  "systemPromptSection", // 提供「系统提示词分节注册」API（可指定顺序号）
  "systemPromptAssemble", // 提供「组装瀑布」，允许把自己的段落追加到末尾
  "promptFile", // 从磁盘上的提示词文件读取行为约束（config.toml / 平台设置项）
  "pasteBlock", // 只能粘贴：用户在设置页把整段文本贴进去
  "toolSurface", // 允许注册新工具（infinite_gen5_scenario / env / dispatch 这类）
  "hotReload", // 改盘上提示词后无需重启进程即可生效
  "sessionProjection", // 允许把状态投影到宿主 UI（状态条 / 面板 / 统计库）
  "taskList", // 宿主有原生任务清单，可投影进度
  "endpointRelay", // 端点是模型 API：可以直接发请求、自己拿回执（不经宿主会话）
]);

/** 注入通道 → 该通道天然具备 / 天然缺失的能力。 */
export const CHANNEL_CAPS = Object.freeze({
  "plugin-section": ["systemPromptSection", "toolSurface", "hotReload", "sessionProjection", "taskList"],
  "plugin-assemble": ["systemPromptSection", "systemPromptAssemble", "toolSurface", "hotReload"],
  promptFile: ["promptFile"],
  "config-file": ["promptFile", "toolSurface"],
  paste: ["pasteBlock"],
  "agent-file": ["promptFile", "toolSurface"],
  // 端点是模型 API 本身：内核进 system 段，回执由本进程 HTTP 直接收 —— 不经宿主会话，
  // 因此没有分节/热加载/投影，也拿不到宿主的工具注册面。
  "endpoint-relay": ["endpointRelay"],
});

/** 注入位次：同一份内核在不同宿主里应该落在哪一段。 */
export const SLOT = Object.freeze({
  LAST: "last", //   追加到系统提示词末尾，紧跟用户轮（Codex / 末位锚点场景）
  FIRST: "first", // 放在最前，宿主人格在后（Claude / 长上下文稳定前缀）
  INLINE: "inline", // 无系统提示词概念，随首轮用户消息一起送
  FILE: "file", //   交给宿主的提示词文件机制，位次由宿主决定
  NONE: "none", //   用户自行粘贴，位次不可控
});

/** 去重策略：发现宿主里已有同源载荷时怎么办。 */
export const DEDUPE = Object.freeze({
  YIELD: "yield", // 整段让位（DSH 上同源插件叠加时的默认）
  DROP_TAIL: "drop-tail", // 保留主段，丢掉末位锚点
  KEEP: "keep", //   不去重（宿主自身不重复加载）
});

const ADAPTER_REQUIRED = ["id", "label", "version", "channel", "slot", "caps", "budget"];

// mount 是可选的：只有「由本适配器自己把载荷装进宿主」的通道才需要它。
//   DSH —— 装载由生产插件 dsh-infinite-gen-5/index.js 完成，本层只描述契约，故不提供 mount。
//   Codex / Claude / generic —— 提供 mount()，返回**纯数据**安装计划（默认 dry-run）。
//     写宿主真实配置是显式动作，走 deploy.mjs，且必须先快照、只动自己管理的键。
const MOUNT_KEYS = ["adapter", "host", "dryRun", "writes", "snapshot", "rollback", "verify", "notes"];

/**
 * 校验一个 target 是否合法。任何一项不合法都返回错误列表，不抛异常 ——
 * 构建脚本要能一次列出全部问题，而不是只报第一个。
 */
export function validateAdapter(adapter) {
  const errors = [];
  if (!adapter || typeof adapter !== "object") return ["adapter 不是对象"];

  for (const key of ADAPTER_REQUIRED) {
    if (adapter[key] === undefined || adapter[key] === null) errors.push(`缺少字段 ${key}`);
  }
  if (adapter.mount !== undefined) {
    if (typeof adapter.mount !== "function") {
      errors.push("mount 必须是函数");
    } else {
      let plan;
      try {
        plan = adapter.mount({ dryRun: true, load: null });
      } catch (err) {
        errors.push(`mount 在 dry-run 下抛错：${err.message}`);
      }
      if (plan !== undefined) {
        if (!plan || typeof plan !== "object") {
          errors.push("mount 返回的不是对象");
        } else {
          for (const key of Object.keys(plan)) {
            if (!MOUNT_KEYS.includes(key)) errors.push(`mount 返回了未声明字段 ${key}`);
          }
          if (plan.dryRun !== true) errors.push("mount 默认必须是 dry-run（plan.dryRun===true）");
          if (!Array.isArray(plan.writes)) errors.push("mount.writes 必须是数组");
        }
      }
    }
  }

  if (adapter.channel && !CHANNEL_CAPS[adapter.channel]) {
    errors.push(`未知通道 ${adapter.channel}`);
  }
  if (adapter.slot && !Object.values(SLOT).includes(adapter.slot)) {
    errors.push(`未知位次 ${adapter.slot}`);
  }
  if (adapter.dedupe && !Object.values(DEDUPE).includes(adapter.dedupe)) {
    errors.push(`未知去重策略 ${adapter.dedupe}`);
  }
  if (Array.isArray(adapter.caps)) {
    for (const cap of adapter.caps) {
      if (!CAPS.includes(cap)) errors.push(`未知能力位 ${cap}`);
    }
    const implied = CHANNEL_CAPS[adapter.channel] ?? [];
    const bogus = adapter.caps.filter((cap) => !implied.includes(cap));
    if (bogus.length) {
      errors.push(`通道 ${adapter.channel} 不可能提供能力：${bogus.join(", ")}`);
    }
    const missing = implied.filter((cap) => !adapter.caps.includes(cap));
    if (missing.length) {
      errors.push(`通道 ${adapter.channel} 应提供却未声明：${missing.join(", ")}`);
    }
  } else {
    errors.push("caps 必须是数组");
  }

  const budget = adapter.budget;
  if (!budget || typeof budget !== "object") {
    errors.push("budget 必须是对象");
  } else {
    for (const key of ["kernelBytes", "totalBytes"]) {
      if (typeof budget[key] !== "number" || budget[key] <= 0) {
        errors.push(`budget.${key} 必须是正数`);
      }
    }
    if (budget.kernelBytes > budget.totalBytes) {
      errors.push("常数内核不能超过总预算");
    }
  }
  return errors;
}

// 能力降级矩阵：宿主缺某能力时，兼容层必须执行的替代动作（不是「尽力而为」，是有明确定义的行为）。
export const DEGRADE = Object.freeze({
  promptFile:
    "提示词文件通道不可用时，降级为整段粘贴：把载荷渲染成单文件 markdown 交给用户手动导入；惰性正文一并内嵌，预算按内嵌口径重算。",
  pasteBlock:
    "宿主没有分节 API 也没有文件接口时，只能整段粘贴；此时必须显式声明「粘贴后不可增量更新」，并给出可定位的段落锚点（锚点文本 + 前后各一行），供用户下轮覆盖。",
  systemPromptSection:
    "改为在首轮用户消息前内联整段载荷，并要求宿主把该轮标记为一次性注入；缺此能力时末位锚点降级为段首锚点。",
  systemPromptAssemble:
    "放弃「真末位」保证，把锚点并入主段尾部；该宿主上锚点强度按段首锚点估算，不得宣称末位。",
  toolSurface:
    "领域包由工具调用降级为内核内嵌索引：索引进常驻载荷，正文按命中不装载（预算 +索引字节）。",
  hotReload:
    "改盘上提示词后需重启宿主进程；兼容层必须在 mount() 返回的 notes 里写明清真条件。",
  sessionProjection:
    "状态条 / 面板不注册，统计改写为本地 JSONL，供离线脚本读取。",
  taskList:
    "任务清单不投影到宿主 UI，改为在正文里逐轮输出清单快照。",
  endpointRelay:
    "端点不可直连时（无密钥 / 无出网 / 服务方限流）降级为两段式：本进程只产出待发请求体与判据脚本，由用户在自有环境执行；此时**不得**宣称已取得回执，统计一律标 missing。",
});

/** 把「宿主声明能力」映射成「编译参数」。core 只认这里吐出来的开关。 */
export function compileFlags(adapter) {
  const caps = new Set(adapter.caps ?? []);
  const has = (cap) => caps.has(cap);
  return Object.freeze({
    // 骨架：内核必须与宿主的关键约束同段出现 → true
    coLocated: !has("systemPromptAssemble"),
    // 末位锚点：只有「装配位置由我们决定」时才敢承诺 ——
    // 宿主组装瀑布（systemPromptAssemble）或自建消息数组（endpointRelay）。
    // 文件/粘贴通道做不到：写进文件不等于送进模型的最后一段。
    tailAnchor: adapter.slot === SLOT.LAST && (has("systemPromptAssemble") || has("endpointRelay")),
    // 领域包：能注册工具就按需取，不能就内嵌索引
    domainViaTool: has("toolSurface"),
    // 惰性章节：能热加载才有意义，否则每次装载都要重启
    lazyEnabled: has("hotReload"),
    // 环境探针：只有能注册工具时才有运行时探针
    envProbe: has("toolSurface"),
    // 投影：状态条 / 统计库
    projection: has("sessionProjection"),
    // 任务清单投影
    taskProjection: has("taskList"),
    // 载体
    carrier: has("promptFile") ? "file" : has("pasteBlock") ? "paste" : "inline",
    // 端点直连：回执由本进程收，不走宿主会话；关闭时统计一律 missing
    endpointRelay: has("endpointRelay"),
  });
}
