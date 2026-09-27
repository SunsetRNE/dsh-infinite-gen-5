// 无限五代 · 安装残留清理（离线、零依赖、默认只列不动手）
//
// 为什么需要它：安装链路的每一次迭代都会在 ~/.dsh 里留下备份 —— install.sh 的
// `dsh-infinite-gen-5.bak-<时间戳>-pre-v<版本>` 快照、profile 的
// `package.json.bak-<时间戳>`、dev-link 期的 `<dest>.bak-<ts>-pre-devlink`，
// 还有仓库里验证热链接用的 HOTLINK_PROOF.txt。verify:install 会把这些报成警告，
// 但不会替你删。本脚本把「有哪些残留、占多少、删掉会释放多少」一次列清楚。
//
// 用法：
//   node scripts/cleanup.mjs            # 只列（默认，纯只读）
//   node scripts/cleanup.mjs --yes      # 真删（只删下面这几类，绝不碰活着的安装树）
//   node scripts/cleanup.mjs --json
//
// 安全边界（宁可少删）：正在被 profile 依赖解析到的那棵树、profile 自己的
// package.json / cordis.patch.yml / node_modules 一律不在清理范围内；
// 判不准的路径只报告不删除。
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const NAME = pkg.name;
const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
const PROFILE = process.env.DSH_PROFILE || "web";
const PROFILE_DIR = process.env.DSH_PROFILE_DIR || join(DSH_HOME, "profiles", PROFILE);
const argv = process.argv.slice(2);
const apply = argv.includes("--yes");
const asJson = argv.includes("--json");
const short = (p) => (p.startsWith(homedir()) ? "~" + p.slice(homedir().length) : p);

const items = [];
const pushFile = (kind, path, note) => {
  if (!existsSync(path)) return;
  let size = 0;
  try {
    size = statSync(path).isDirectory() ? dirSize(path) : statSync(path).size;
  } catch {
    size = 0;
  }
  items.push({ kind, path, note, size });
};
function dirSize(dir, acc = 0) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    try {
      acc = entry.isDirectory() ? dirSize(full, acc) : acc + statSync(full).size;
    } catch {
      /* 读不动的条目按 0 计 */
    }
  }
  return acc;
}

// ── 活着的树：profile 依赖指向 / profile node_modules 解析到的位置，永不清理 ──
const liveTrees = new Set();
try {
  const profilePkg = JSON.parse(readFileSync(join(PROFILE_DIR, "package.json"), "utf8"));
  const spec = (profilePkg.dependencies || {})[NAME];
  if (spec) {
    const p = spec.replace(/^(link:|file:)/, "");
    liveTrees.add(realpathSync(join(PROFILE_DIR, p)));
  }
} catch {
  /* 没有 profile 就只做其余检查 */
}
for (const p of [join(PROFILE_DIR, "node_modules", NAME), join(DSH_HOME, "plugin-src", NAME)]) {
  try {
    liveTrees.add(realpathSync(p));
  } catch {
    /* 不存在 */
  }
}
const isLive = (path) => {
  try {
    return liveTrees.has(realpathSync(path));
  } catch {
    return false;
  }
};

// ── 1. install.sh 落点：~/.dsh/plugins/<name>*（管理器式安装下这里应当空着）──
const pluginsDir = join(DSH_HOME, "plugins");
if (existsSync(pluginsDir)) {
  for (const entry of readdirSync(pluginsDir)) {
    if (entry !== NAME && !entry.startsWith(`${NAME}.bak-`)) continue;
    const full = join(pluginsDir, entry);
    const live = isLive(full);
    pushFile(
      live ? "install.sh 落点（仍被引用，跳过）" : "install.sh 落点残留",
      full,
      live ? "profile 依赖正指向这里 —— 不删" : "管理器式安装不需要它；dev 热链接期它是仓库的软链",
    );
  }
}

// ── 2. install.sh 快照：plugin-src/*.bak-* ──
const srcDir = join(DSH_HOME, "plugin-src");
if (existsSync(srcDir)) {
  for (const entry of readdirSync(srcDir)) {
    if (!entry.startsWith(`${NAME}.bak-`) && !entry.endsWith("-pre-devlink")) continue;
    const full = join(srcDir, entry);
    if (isLive(full)) continue;
    const note = entry.endsWith("-pre-devlink") ? "dev-link 切换前的备份（回滚靠 git 即可）" : "install.sh 装新版前留的快照";
    pushFile("安装快照", full, note);
  }
}

// ── 3. profile 的 package.json 备份：profiles/*/package.json.bak-* ──
const profilesDir = join(DSH_HOME, "profiles");
if (existsSync(profilesDir)) {
  for (const profile of readdirSync(profilesDir)) {
    const dir = join(profilesDir, profile);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.startsWith("package.json.bak-")) continue;
      pushFile("接线备份", join(dir, entry), "install.sh/dev-link 迁移前的 profile 依赖与 bundles 记录");
    }
  }
}

// ── 4. 仓库里的临时验证文件 ──
pushFile("仓库临时文件", join(ROOT, "HOTLINK_PROOF.txt"), "dev 热链接实证用的探针文件，验证完即可删");

// ── 输出 / 执行 ──
const total = items.reduce((sum, it) => sum + it.size, 0);
const fmt = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);
let removed = 0;
let skipped = 0;
if (apply) {
  for (const it of items) {
    if (it.kind.includes("跳过")) {
      skipped += 1;
      continue;
    }
    try {
      rmSync(it.path, { recursive: true, force: true });
      removed += 1;
      it.removed = true;
    } catch (err) {
      it.error = String(err.message || err);
    }
  }
}

if (asJson) {
  console.log(
    JSON.stringify(
      { dshHome: DSH_HOME, profile: PROFILE, dryRun: !apply, totalBytes: total, removed, skipped, items },
      null,
      1,
    ),
  );
} else {
  console.log(`安装残留清理（dshHome=${short(DSH_HOME)} · profile=${PROFILE}）${apply ? " · 已执行删除" : " · 只列不动手"}`);
  if (!items.length) {
    console.log("  ✓ 没有安装残留 —— 活着的安装树与仓库都不在清理范围内");
  }
  for (const it of items) {
    const mark = it.error ? "✗" : it.removed ? "✓ 已删" : it.kind.includes("跳过") ? "⚠ 跳过" : "·";
    console.log(`  ${mark} [${it.kind}] ${short(it.path)} — ${fmt(it.size)}（${it.note}）${it.error ? ` 失败：${it.error}` : ""}`);
  }
  if (items.length) {
    console.log(
      apply
        ? `\n删掉 ${removed} 项 · 释放 ${fmt(total)}${skipped ? ` · 跳过 ${skipped} 项（仍被引用）` : ""}`
        : `\n共 ${items.length} 项 · 可释放 ${fmt(total)} —— 确认无误后跑：node scripts/cleanup.mjs --yes`,
    );
  }
}
process.exit(items.some((it) => it.error) ? 1 : 0);
