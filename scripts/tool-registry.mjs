// 无限五代 · 工具注册表（真源）· scripts/tool-registry.mjs
//
// 为什么需要它：仓库里有近百个脚本，README 只讲「怎么做」不讲「有哪些工具、各自的判据是什么」，
// 结果是每加一个工具就得靠人肉记忆，新人（或未来的自己）找不到入口，也无法判断某个工具是否还活着。
// 这个模块把「工具面」变成机器可读的一份数据：**每个脚本都在册、每个能力声明都能被文件本身证实**。
//
// 单一真源原则：这里的 OVERLAY 只写「分类 + 人为覆盖的判据 + 备注」，**不复制脚本里的用途说明** ——
// 用途在生成文档时从每个文件的头注释现读，所以文档与代码不会漂移（改了头注释，文档自动改）。
// 能力（--json / --selftest / --apply …）同样是现扫文件文本得到的；verify_tool_registry.mjs 会
// 反过来断言「注册表里声明的 flag 必须在该文件里真的出现」，所以这里写不出没有的能力。
//
// 配套：scripts/gen_tool_docs.mjs 用本模块渲染 docs/TOOL-PROTOCOLS.md 与 docs/INDEX.md；
// scripts/verify_tool_registry.mjs 是门禁（完整性 / 路径 / 协议字面量 / npm 名 / 文档新鲜度）。
// 加新工具的正确顺序：先写脚本 → 在 OVERLAY 里加一行 → `npm run tools:doc` → `npm run verify:tools`。

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const REGISTRY_PROTOCOL = "ig5-tool-registry-v1";

// 分类顺序即文档里的呈现顺序。
export const CATEGORIES = [
  ["门禁", "可判失败的检查件：退出码非零即「这棵树不对」，全部进 verify:all"],
  ["评分", "把运行产物折算成分数的评分器（不引入人工打分）"],
  ["探针", "跑在真宿主/真端点上取读数的实验件，默认 dry-run"],
  ["构建", "把真源数据编译成产物（技能帧、题库分片、邻接表、词汇表…）"],
  ["惰性", "惰性章节拆分与命中率工程"],
  ["校准", "校准轴/语义漂移的历史审计件"],
  ["词汇", "命中词汇表与语料对照"],
  ["审计", "事后审计既有产物（不看代码对不对，只看产物自洽不自洽）"],
  ["报告", "把多轮读数汇总成 Markdown"],
  ["装机", "把仓库铺进本机 DSH 安装树 / 装伴生插件 / 打宿主补丁"],
  ["发布", "版本号、CHANGELOG、打包、Release 正文"],
  ["一次性", "一次性实验台（留档用，不进 verify:all）"],
  ["插件模块", "插件运行时本体（被 index.js / 宿主直接调用）"],
  ["工具", "其余 CLI 工具"],
];

// 逐脚本覆盖项：只写分类；判据按「显式 > npm 映射(verify 优先) > 带 --selftest 则自检 > 直接跑」推导。
// 需要人为改判据时写 judge；需要解释「为什么它还在」时写 note。
export const OVERLAY = {
  "analyze_c3.mjs": { cat: "审计" },
  "audit_stress100_receipts.mjs": { cat: "审计" },
  "back_audit.mjs": { cat: "审计" },
  "build_skill.mjs": { cat: "构建" },
  "build_stress100_neighbors.mjs": { cat: "构建" },
  "build_stress100_shards.mjs": { cat: "构建" },
  "bump-version.mjs": { cat: "发布" },
  "bump-version.sh": { cat: "发布" },
  "ca_key_guard.mjs": { cat: "工具" },
  "calib_audit.mjs": { cat: "校准" },
  "calib_report.mjs": { cat: "校准" },
  "changelog.mjs": { cat: "发布" },
  "cleanup.mjs": { cat: "发布" },
  "compare_runs.mjs": { cat: "报告" },
  "cred_reach_gate.mjs": { cat: "工具" },
  "dev-link.mjs": { cat: "装机" },
  "eval-corpus.mjs": { cat: "工具" },
  "extract-boost-corpus.mjs": { cat: "工具" },
  "h_audit.mjs": { cat: "审计" },
  "install_companion.mjs": { cat: "装机" },
  "kernel-lazy-split.mjs": { cat: "工具" },
  "lazy_candidate_scan.mjs": { cat: "惰性" },
  "lazy_coverage.mjs": { cat: "惰性" },
  "merge_collection.mjs": { cat: "工具" },
  "oneshot_harness.mjs": { cat: "一次性" },
  "oneshot_report.mjs": { cat: "一次性" },
  "package-release.mjs": { cat: "发布" },
  "patch-host-toolargs.mjs": { cat: "装机" },
  "plugin_integrity.mjs": { cat: "工具" },
  "pressure_block.mjs": { cat: "工具" },
  "probe-env.mjs": { cat: "工具" },
  "probe_jb_suite.mjs": { cat: "探针" },
  "probe_registration.mjs": { cat: "探针" },
  "redteam_report.mjs": { cat: "报告" },
  "regress_jb.mjs": { cat: "工具" },
  "release.mjs": { cat: "发布" },
  "run_bank_live.mjs": { cat: "工具" },
  "score_full_run.mjs": { cat: "评分" },
  "score_headroom.mjs": { cat: "评分" },
  "score_jb.mjs": { cat: "评分" },
  "score_live_probes.mjs": { cat: "评分" },
  "score_live_probes_v2.mjs": { cat: "评分" },
  "score_oneshot.mjs": { cat: "评分" },
  "score_silent_batch.mjs": { cat: "评分" },
  "score_stress100.mjs": { cat: "评分" },
  "score_stress100_400.mjs": { cat: "评分" },
  "score_triad.mjs": { cat: "评分" },
  "scorer_semantics_test.mjs": { cat: "工具" },
  "stress100_report.mjs": { cat: "报告" },
  "sync-local.mjs": { cat: "装机" },
  "verify_armor.mjs": { cat: "门禁" },
  "verify_batch_arm.mjs": { cat: "门禁" },
  "verify_boost.mjs": { cat: "门禁" },
  "verify_boot_attest.mjs": { cat: "门禁" },
  "verify_breach.mjs": { cat: "门禁" },
  "verify_calib.mjs": { cat: "门禁" },
  "verify_card_size.mjs": { cat: "门禁" },
  "verify_contracts.mjs": { cat: "门禁" },
  "verify_decay.mjs": { cat: "门禁" },
  "verify_dedupe.mjs": { cat: "门禁" },
  "verify_density.mjs": { cat: "门禁" },
  "verify_dispatch.mjs": { cat: "门禁" },
  "verify_env.mjs": { cat: "门禁" },
  "verify_eval.mjs": { cat: "门禁" },
  "verify_h_audit.mjs": { cat: "门禁" },
  "verify_injection.mjs": { cat: "门禁" },
  "verify_install.mjs": { cat: "门禁" },
  "verify_kernel_v039.sh": { cat: "门禁" },
  "verify_lazy.mjs": { cat: "门禁" },
  "verify_prompt.mjs": { cat: "门禁" },
  "verify_prompt_gen4.mjs": { cat: "门禁" },
  "verify_prompt_gen41.mjs": { cat: "门禁" },
  "verify_prompt_gen5.mjs": { cat: "门禁" },
  "verify_prompt_gen51.mjs": { cat: "门禁" },
  "verify_release_notes.mjs": { cat: "门禁" },
  "verify_runtime_sync.mjs": { cat: "门禁" },
  "verify_scenario_tool.mjs": { cat: "门禁" },
  "verify_scenarios.mjs": { cat: "门禁" },
  "verify_scoring.mjs": { cat: "门禁" },
  "verify_skill.mjs": { cat: "门禁" },
  "verify_stats_panel.mjs": { cat: "门禁" },
  "verify_stress100_protocol.mjs": { cat: "门禁" },
  "verify_surface.mjs": { cat: "门禁" },
  "verify_sync.mjs": { cat: "门禁" },
  "verify_t6_mechanism.mjs": { cat: "门禁" },
  "verify_tool_budget.mjs": { cat: "门禁" },
  "verify_tuning.mjs": { cat: "门禁" },
  "verify_ui.mjs": { cat: "门禁" },
  "verify_version.mjs": { cat: "门禁" },
  "verify_vocab.mjs": { cat: "门禁" },
  "version-targets.mjs": { cat: "工具" },
  "vocab-build.mjs": { cat: "工具" },
  "vocab-report.mjs": { cat: "工具" },
};

// 不进「工具」清单的东西，每条必须给理由（门禁会检查理由非空）。
export const EXCLUDED = {
  "scripts/lib/breach-suite-v3.mjs": "被 verify_breach.mjs 引用的套件数据模块，无 CLI 入口",
  "scripts/lib/contracts.mjs": "被 verify_contracts.mjs 等引用的纯函数库，无 CLI 入口",
  "scripts/lib/corpus.mjs": "被 verify_eval.mjs / eval-corpus.mjs 引用的用例库",
  "scripts/lib/host-resolve.mjs": "宿主路径解析库（v0.38.2 起 0.2.x 平铺布局）",
  "scripts/lib/release-notes.mjs": "发布正文压缩纯函数库",
  "scripts/lib/scorer.mjs": "共享评分器实现（多评分件共用）",
  "scripts/lib/tree-fingerprint.mjs": "目录指纹算法（复刻宿主插件管理器）",
  "scripts/lib/vocab-fixtures.mjs": "词汇自检语料（不是运行时数据）",
  "scripts/version-targets.mjs": "版本锚点常量模块：被 verify_version.mjs / bump-version.mjs 读取，自身不是工具",
};

// 根目录的插件模块（不在 scripts/ 下，但同属「工具面」）。
export const EXTRA_ROOTS = [
  "anchor-armor.mjs",
  "dispatch.mjs",
  "stats-store.mjs",
  "tasks.mjs",
];

// 命名协议：只在「实现里有字面量 + 有消费者 + 有判据」时才登记。
// 判据列必须是一条能真跑的检查；没有检查的名字不许上这张表（宁可写「判据在脚本里」）。
export const PROTOCOLS = [
  {
    name: "ig5-tool-registry-v1",
    definedIn: "scripts/tool-registry.mjs",
    consumers: ["scripts/gen_tool_docs.mjs", "scripts/verify_tool_registry.mjs"],
    doc: "docs/TOOL-PROTOCOLS.md",
    judge: "npm run verify:tools",
    what: "本表自身的协议：工具注册表的字段与不变式（每个脚本在册、能力声明可由文件证实、文档与注册表逐字一致）。",
  },
  {
    name: "ig5-skill-frame-v1",
    definedIn: "scripts/build_skill.mjs",
    consumers: ["skills/ig5-layer-01/SKILL.md", "scripts/verify_skill.mjs"],
    doc: "docs/ARCHITECTURE.md",
    judge: "npm run verify:skill",
    what: "技能帧：frontmatter（name/description/whenToUse/metadata.source/protocol/blocks/chars/triggerWords/bodySha256）+ 正文，索引帧必须 < 8192 字符（宿主裁剪阈值）。",
  },
  {
    name: "ig5-merge-v1",
    definedIn: "scripts/merge_collection.mjs",
    consumers: ["skills/ig5-layer-02-codex", "skills/ig5-layer-03-zhekk", "skills/ig5-layer-04-ctf"],
    doc: "docs/MERGE-COLLECTION.md",
    judge: "npm run verify:merge",
    what: "素材融合编译：每层产 SKILL.md 索引帧 + refs/ 原文（命中凭据规则的改写为 «REDACTED:<rule>» 标记，源件不动）+ MANIFEST.json 逐文件 sha256。",
  },
  {
    name: "ig5-companion-v1",
    definedIn: "scripts/install_companion.mjs",
    consumers: ["companions/", "~/.dsh/plugin-activations.json"],
    doc: "docs/INSTALL.md",
    judge: "npm run verify:companion",
    what: "伴生插件清单：id / 名称 / 依赖 / 安装点，--check 只报差异不写盘。",
  },
  {
    name: "stress100-neighbors-v1",
    definedIn: "scripts/build_stress100_neighbors.mjs",
    consumers: ["tests/stress100/neighbors.json", "tools/ig5_evidence.py（邻接补轮证据链）"],
    doc: "docs/stress100-400.md",
    judge: "npm run build:stress-neighbors",
    what: "邻接补轮表：把 boundary 回执映射到合法邻接件，供评分器按 lifted_boundary 口径复算。",
  },
  {
    name: "infinite-gen5/env-probe@1",
    definedIn: "data/probe.mjs",
    consumers: ["scripts/probe-env.mjs", "ENV_PROBE.md"],
    doc: "ENV_PROBE.md",
    judge: "npm run verify:env",
    what: "环境探针报告 schema：宿主/容器/运行时/网络/工具链就绪度的机读形状。",
  },
];

// ---- 读取与推导 ----------------------------------------------------------

const SKIP_DIRS = new Set(["lib", "node_modules"]);

function walkScripts(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkScripts(join(dir, e.name), acc);
      continue;
    }
    if (/\.(mjs|sh)$/.test(e.name)) acc.push(join(dir, e.name));
  }
  return acc;
}

export function purposeOf(text) {
  const lines = text.split("\n").slice(0, 30);
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith("#!")) continue;
    const m = l.match(/^\/\/\s*(.+)$/);
    if (m) {
      const t = m[1].trim();
      if (t && !/^[\s\-=*]+$/.test(t)) return t;
      continue;
    }
    const h = l.match(/^#\s*(.+)$/);
    if (h) {
      const t = h[1].trim();
      if (t && !t.startsWith("!") && !/^[\s\-*=]+$/.test(t)) return t;
      continue;
    }
    if (l.startsWith("/*") || l.startsWith("*")) {
      const t = l.replace(/^\/\*+/, "").replace(/^\*+/, "").trim();
      if (t && !/^[\s\-=*]+$/.test(t)) return t;
    }
  }
  return "";
}

export const FLAG_TOKENS = [
  "--selftest", "--json", "--apply", "--check", "--dry-run", "--repro",
  "--write", "--out", "--live", "--yes", "--dir", "--src", "--bank",
];

export function flagsOf(text) {
  return FLAG_TOKENS.filter((f) => text.includes(f));
}

export function readPackage() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
}

function npmNamesFor(pkgScripts, rel) {
  const needle = "scripts/" + rel;
  return Object.entries(pkgScripts)
    .filter(([, v]) => v.includes(needle))
    .map(([k]) => k);
}

export function loadRegistry() {
  const pkg = readPackage();
  const pkgScripts = pkg.scripts || {};
  const ids = [
    ...walkScripts(join(ROOT, "scripts")).map((f) => relative(join(ROOT, "scripts"), f).split("\\").join("/")),
    ...EXTRA_ROOTS,
  ].sort();

  const entries = ids.map((id) => {
    const path = EXTRA_ROOTS.includes(id) ? id : join("scripts", id);
    const text = readFileSync(join(ROOT, path), "utf8");
    const overlay = OVERLAY[id] || {};
    const npm = npmNamesFor(pkgScripts, id);
    const flags = flagsOf(text);
    const isSh = id.endsWith(".sh");
    const invoke = isSh
      ? `bash scripts/${id}`
      : EXTRA_ROOTS.includes(id) ? `node ${id}` : `node scripts/${id}`;
    let judge = overlay.judge;
    if (!judge) {
      const verifyish = npm.find((n) => n.startsWith("verify"));
      if (verifyish) judge = `npm run ${verifyish}`;
      else if (npm.length) judge = `npm run ${npm[0]}`;
      else judge = flags.includes("--selftest") ? `${invoke} --selftest` : invoke;
    }
    return {
      id,
      path,
      cat: overlay.cat || (EXTRA_ROOTS.includes(id) ? "插件模块" : "工具"),
      purpose: purposeOf(text),
      invoke,
      judge,
      judgeSource: overlay.judge ? "overlay" : "derived",
      flags,
      npm,
      note: overlay.note || "",
      root: EXTRA_ROOTS.includes(id) ? "top" : "scripts",
    };
  });

  return { protocol: REGISTRY_PROTOCOL, entries, excluded: EXCLUDED, libraries: Object.keys(EXCLUDED).filter((k) => k.includes("/lib/")) };
}

export function groupByCategory(entries) {
  const order = CATEGORIES.map(([name]) => name);
  const groups = new Map(order.map((n) => [n, []]));
  for (const e of entries) {
    if (!groups.has(e.cat)) groups.set(e.cat, []);
    groups.get(e.cat).push(e);
  }
  return [...groups.entries()].filter(([, list]) => list.length);
}
