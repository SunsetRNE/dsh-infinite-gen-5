// 无限五代 · 版本号字面量的「当前版本锚点」唯一真源（离线、零依赖）
//
// bump-version.mjs（写）与 verify_version.mjs（读）共用本表，避免两边各记一份文件清单。
//
// 什么进表：语义 == 「当前版本」的位置 —— 发版时这些点必须跟着换，不换就是缺陷
//           （状态条显示旧版本、patch 头注释过期、README 标题对不上 package.json）。
// 什么不进表：记录「当时」的历史叙述 —— UPDATE.md / VERSIONS.md 的逐版沿革、
//           CHANGELOG.md 的逐版条目、ENV_PROBE.md 的「某能力随插件某版引入」。
//           这些刻意保留旧号，发版时改写它们等于篡改历史。
//           自述文件（README.md / HARNESS_PLUGIN.md / package.json 的 description）
//           现在只讲「当前状态」，不承担沿革 —— 要提历史就写一句指针指回 VERSIONS.md。
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
    // README 里的「唤起桌面客户端一键安装」深链共 4 处（顶部徽标 + 安装段），
    // 它们说的是「装哪个版本」，属当前版本语义 —— count 声明 4 处同源一起改。
    file: "README.md",
    name: "README.md · 一键安装深链 version（4 处同源）",
    re: /dsh:\/\/plugin\/install\?[^"\s]*&version=(\d+\.\d+\.\d+)&/,
    count: 4,
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
  {
    // 增强集（boost corpus）自报版本：BOOST_HEADER 与 boostStats() 都从它派生，
    // 所以这一处是本文件唯一的版本号字面量 —— 断言见 scripts/verify_boost.mjs。
    file: "data/boost-corpus.mjs",
    name: "data/boost-corpus.mjs · BOOST_VERSION（增强集自报版本）",
    re: /export const BOOST_VERSION = "(\d+\.\d+\.\d+)"/,
  },
];

// 允许「散见叙述」当前版本号、但不作为锚点的文件：
// 命中检查时视为已知，发版时不改写（package.json 由 bump 结构化处理）。
// CHANGELOG.md 是 scripts/changelog.mjs 的生成物、按提交标题切版本段，天然满篇版本号；
// 它记的是「哪个版本发布了什么」，属历史叙述，发版时交给 changelog.mjs 重生成。
// UPDATE.md 是仓库内《更新文档》——版本变更叙述的唯一真源，天生满篇历史版本号，
// 而且必须能写「当前版本」那一节（否则最新的改动没处落笔）。
// VERSIONS.md 是《版本沿革要点》—— UPDATE.md 的压缩版（一版 1–3 行），
// 同样满篇版本号、同样要能写当前版本那一行；README / HARNESS / description 的指针指向它。
export const PROSE_ALLOWED_FILES = [
  "package.json",
  "ENV_PROBE.md",
  "CHANGELOG.md",
  "UPDATE.md",
  "VERSIONS.md",
];

// 全仓字面量扫描时跳过的目录：依赖 / 生成物 / 运行产物 / 版本库内部。
export const SCAN_SKIP_DIRS = [".git", "node_modules", "ui-preview", "runs", ".dsh"];

// 只扫这些后缀，避免把二进制、图片、用例产物当文本读。
export const SCAN_EXTENSIONS = [
  ".js", ".mjs", ".cjs", ".json", ".md",
  ".yml", ".yaml", ".sh", ".ps1", ".bat", ".txt",
];
