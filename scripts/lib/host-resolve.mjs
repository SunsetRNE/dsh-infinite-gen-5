// 无限五代 · 宿主解析（v0.38.2）
//
// 背景：DSH 0.1.7 是单体包（子系统嵌在 dsh/node_modules/@deepseek-ai/*），
// 0.2.0 拆成约 300 个平铺兄弟包（子系统直接落在 node_modules/@deepseek-ai/*）。
// 门禁脚本原来只把「包目录」当候选，在 0.2.0 布局下会匹配不到然后**静默回落到
// 硬编码的 /usr/local 旧宿主** —— 那是最坏的一种绿：跑的不是你指定的宿主。
//
// 本模块做两件事：
//   1) 把候选从「一条路径」扩成「这条路径 + 它的祖先目录」，并同时认三种形状：
//      · node_modules 的父级        /tmp/dsh020
//      · @deepseek-ai 作用域目录     /tmp/dsh020/node_modules/@deepseek-ai
//      · dsh 包目录（旧单体布局）    /usr/local/lib/node_modules/@deepseek-ai/dsh
//   2) 显式指定的宿主（--host= / IG5_DSH_ROOT）找不到时**报 FAIL 并退出 1**，
//      绝不改读别的宿主；没有显式指定才回落默认候选，找不到就打 SKIP（环境限制）。
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const SCOPE = "@deepseek-ai";

// 每个宿主子系统在两种布局里的落点（lib/index.js 是本仓库门禁真正 import 的入口）
export function packageEntry(root, name, lib = "index.js") {
  return join(root, "node_modules", SCOPE, name, "lib", lib);
}

// 一条路径 → 这条路径 + 最多 3 层祖先（去重、遇根即停）。
// 这样 0.2.0 下写 --host=…/node_modules/@deepseek-ai/dsh（包目录）也能落到 /tmp/dsh020。
export function expandRoots(input) {
  if (typeof input !== "string" || input.length === 0) return [];
  const out = [];
  let cur = input;
  for (let i = 0; i < 4; i += 1) {
    if (!out.includes(cur)) out.push(cur);
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return out;
}

// 在一条路径上找宿主：布局 A = root 是 node_modules 的父级；布局 B = root 就是作用域目录。
export function hostAt(root) {
  const shapes = [
    { cordis: packageEntry(root, "cordis"), prompt: packageEntry(root, "dsh-system-prompt") },
    { cordis: join(root, "cordis", "lib", "index.js"), prompt: join(root, "dsh-system-prompt", "lib", "index.js") },
  ];
  for (const s of shapes) {
    if (existsSync(s.cordis) && existsSync(s.prompt)) return { root, ...s };
  }
  return null;
}

export function locateHost(roots) {
  for (const root of roots) {
    const hit = hostAt(root);
    if (hit) return hit;
  }
  return null;
}

// 默认回落候选：老机器上的 /usr/local 安装 + 与当前 node 同级的两种 node_modules 布局。
export function defaultRoots(execPath = process.execPath) {
  const bin = dirname(execPath);
  return [
    "/usr/local/lib/node_modules/@deepseek-ai/dsh",
    join(bin, "..", "lib", "node_modules", "@deepseek-ai", "dsh"),
    join(bin, "..", "node_modules", "@deepseek-ai", "dsh"),
  ];
}

export const HOST_SHAPE_HINT = [
  "  --host 三种写法：",
  "    --host=/tmp/dsh020                            （node_modules 的父级 · 0.2.0 布局）",
  "    --host=/tmp/dsh020/node_modules/@deepseek-ai  （作用域目录）",
  "    --host=/usr/local/lib/node_modules/@deepseek-ai/dsh（dsh 包目录 · 0.1.7 单体布局）",
];

// 解析宿主。显式指定时只认显式路径（不回落）；未指定时用默认候选。
export function resolveHost({ argv = process.argv, env = process.env, execPath = process.execPath } = {}) {
  const hostArg = argv.find((a) => a.startsWith("--host="));
  const explicit = hostArg
    ? { from: "--host=", value: hostArg.slice("--host=".length), roots: expandRoots(hostArg.slice("--host=".length)) }
    : env.IG5_DSH_ROOT
      ? { from: "IG5_DSH_ROOT", value: env.IG5_DSH_ROOT, roots: expandRoots(env.IG5_DSH_ROOT) }
      : null;
  const fallbacks = defaultRoots(execPath);
  const host = explicit ? locateHost(explicit.roots) : locateHost(fallbacks);
  return {
    host,
    explicit,
    missedExplicit: Boolean(explicit) && !host,
    candidates: explicit ? explicit.roots : fallbacks,
  };
}

// 找不到宿主时的统一收尾：显式指定 → FAIL/exit 1；未指定 → SKIP/exit 0。
export function reportHostMiss({ script, what, reason = "no dsh host", candidates, explicit, json = false }) {
  const shapes = HOST_SHAPE_HINT;
  const tried = "  试过：" + (candidates.length ? candidates.join(" · ") : "（无候选）");
  if (explicit) {
    if (json) {
      console.log(JSON.stringify({ ok: false, reason: "explicit-host-not-found", script, candidates, passed: 0, failed: 1 }, null, 1));
    } else {
      console.log(`FAIL: ${explicit.from}${explicit.value} 指定的宿主不可用 —— 缺 @deepseek-ai/cordis 或 dsh-system-prompt。`);
      console.log("  改读别的宿主会是假绿：宁可失败，也不换靶子。");
      console.log(tried);
      for (const l of shapes) console.log(l);
    }
    process.exit(1);
  }
  if (json) {
    console.log(JSON.stringify({ skipped: true, reason: "no dsh host", script, candidates, passed: 0, failed: 0 }, null, 1));
  } else {
    console.log(`SKIP: 没找到 dsh 宿主（@deepseek-ai/cordis + dsh-system-prompt），${what}只在装有 DSH 的机器上跑。`);
    console.log(tried);
    for (const l of shapes) console.log(l);
    console.log("  这条不是回归失败：插件本身不依赖宿主包，CI 上跳过即可。");
  }
  process.exit(0);
}

// 按包名在三种形状里找子系统的包目录（用于原来写死 /usr/local 路径的两处脚本）。
export function findPackageDir(name, { argv = process.argv, env = process.env, execPath = process.execPath } = {}) {
  const { host } = resolveHost({ argv, env, execPath });
  const roots = host ? [host.root, ...expandRoots(host.root)] : defaultRoots(execPath).flatMap(expandRoots);
  for (const root of roots) {
    const nested = join(root, "node_modules", SCOPE, name);
    if (existsSync(nested)) return nested;
    const flat = join(root, SCOPE, name);
    if (existsSync(flat)) return flat;
    const direct = join(root, name);
    if (existsSync(direct)) return direct;
  }
  return null;
}
