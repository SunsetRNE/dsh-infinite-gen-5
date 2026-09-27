// 无限五代 · 版本号字面量的「当前版本锚点」唯一真源（离线、零依赖）
//
// bump-version.mjs（写）与 verify_version.mjs（读）共用本表，避免两边各记一份文件清单。
//
// 什么进表：语义 == 「当前版本」的位置 —— 发版时这些点必须跟着换，不换就是缺陷
//           （状态条显示旧版本、patch 头注释过期、README 标题对不上 package.json）。
// 什么不进表：记录「当时」的历史叙述 —— README / HARNESS_PLUGIN 的版本沿革、
//           package.json description 里的历代特性、ENV_PROBE 的「随插件 v0.8.0 引入」。
//           这些刻意保留旧号，发版时改写它们等于篡改历史。
//
// 每项字段：
//   file  相对仓库根的文件路径
//   name  人类可读的检查名（报错时直接给你看是哪里）
//   re    必须「恰好命中一次」，第 1 个捕获组为版本号数字部分（不含前缀 v）
//         例：/const PLUGIN_VERSION = "(\d+\.\d+\.\d+)"/ 的第 1 个捕获组就是版本号数字。
//   ⚠️ 本文件自身会被 verify_version.mjs 的全仓扫描覆盖，所以注释里不要写具体版本号。

export const VERSION_ANCHORS = [
  {
    file: "index.js",
    name: "index.js · PLUGIN_VERSION（插件自报版本）",
    re: /const PLUGIN_VERSION = "(\d+\.\d+\.\d+)"/,
  },
  {
    file: "client.js",
    name: "client.js · VERSION（状态条显示版本）",
    re: /var VERSION = "v(\d+\.\d+\.\d+)"/,
  },
  {
    file: "cordis.patch.yml",
    name: "cordis.patch.yml · 注入头注释",
    re: /── 无限五代 v(\d+\.\d+\.\d+) 注入说明/,
  },
  {
    file: "README.md",
    name: "README.md · 标题",
    re: /^# .*（无限五代）v(\d+\.\d+\.\d+)\s*$/m,
  },
  {
    file: "HARNESS_PLUGIN.md",
    name: "HARNESS_PLUGIN.md · 标题",
    re: /^# .*\(v(\d+\.\d+\.\d+)\)\s*$/m,
  },
  {
    file: "scripts/verify_prompt_gen5.mjs",
    name: "scripts/verify_prompt_gen5.mjs · 头注释",
    re: /^\/\/ 无限五代 v(\d+\.\d+\.\d+)/m,
  },
  {
    file: "scripts/verify_dedupe.mjs",
    name: "scripts/verify_dedupe.mjs · 头注释",
    re: /^\/\/ 无限五代 v(\d+\.\d+\.\d+)/m,
  },
];

// 允许「散见叙述」当前版本号、但不作为锚点的文件：
// 命中检查时视为已知，发版时不改写（package.json 由 bump 结构化处理）。
export const PROSE_ALLOWED_FILES = ["package.json", "ENV_PROBE.md"];

// 全仓字面量扫描时跳过的目录：依赖 / 生成物 / 运行产物 / 版本库内部。
export const SCAN_SKIP_DIRS = [".git", "node_modules", "ui-preview", "runs", ".dsh"];

// 只扫这些后缀，避免把二进制、图片、用例产物当文本读。
export const SCAN_EXTENSIONS = [
  ".js", ".mjs", ".cjs", ".json", ".md",
  ".yml", ".yaml", ".sh", ".ps1", ".bat", ".txt",
];
