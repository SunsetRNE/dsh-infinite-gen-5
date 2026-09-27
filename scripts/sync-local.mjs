#!/usr/bin/env node
/**
 * 无限五代 · 本机安装树同步（sync:local）
 *
 * 为什么需要它：宿主插件管理器只在自己执行过安装/更新之后，才会重写
 * `~/.dsh/plugin-activations.json` 里那条记录（版本 + 内容指纹）。开发期我们常常
 * 手工把仓库铺进安装树（tar/cp），管理器对此一无所知 —— 于是出现「磁盘与活体都是新版，
 * 管理器界面却停在旧版号、加载状态一栏空着」的错觉。本脚本把这件事做成一步：
 *
 *   1) 先把仓库镜像到 dsh 实际加载的那棵树（默认只读预览，`--yes` 才动）；
 *      镜像 = 只增改 + 删掉仓库里已经没有的文件（安装树独有的 .dsha-dependencies.json 保留）；
 *   2) 再按宿主自己的算法（scripts/lib/tree-fingerprint.mjs）算一遍这棵树的内容指纹，
 *      把激活记录里的 version / fingerprint 刷成与磁盘一致 —— 管理器界面因此显示正确版本。
 *
 * 不做的事（故意的）：不碰 `plugin-updates.json`（那是「去 GitHub 查过」的结论，代签等于撒谎），
 * 不动管理的器安装历史与回滚快照、不跑 pnpm、不重启进程。
 *
 * 用法：
 *   node scripts/sync-local.mjs                  # 只读：报告三处差异（仓库 / 安装树 / 激活记录）
 *   node scripts/sync-local.mjs --yes            # 同步安装树 + 刷新激活记录
 *   node scripts/sync-local.mjs --yes --no-record  # 只同步安装树
 *   node scripts/sync-local.mjs --dsh-home=<路径>  # 换一份 DSH 目录（自检用）
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { treeFingerprint } from "./lib/tree-fingerprint.mjs";

const NAME = "dsh-infinite-gen-5";
const REPO_DEFAULT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOP_SKIP = new Set([".git", "node_modules", "ui-preview"]); // 与 install.sh 的剔除一致
const KEEP = new Set([".dsha-dependencies.json"]); // 安装树独有，镜像时删不得

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const argOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(name + "="));
  return hit ? hit.slice(name.length + 1) : fallback;
};
const dryRun = !flag("--yes");
const wantRecord = !flag("--no-record");
const asJson = flag("--json");

const ok = (label, detail) => console.log(`  ✓ ${label}${detail ? " — " + detail : ""}`);
const warn = (label, detail) => console.log(`  ⚠ ${label}${detail ? " — " + detail : ""}`);
const err = (label, detail) => console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
const short = (p) => p.replace(homedir(), "~");
const stamp = () => new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

const dshHome = resolve(argOf("--dsh-home", process.env.DSH_HOME || join(homedir(), ".dsh")));
const repo = resolve(argOf("--repo", REPO_DEFAULT));

if (!existsSync(dshHome)) {
  err("找不到 DSH 目录", `${short(dshHome)} —— 先 ./install.sh 装一份，或用 --dsh-home=<路径>`);
  process.exit(2);
}
const repoPkg = readJson(join(repo, "package.json"));
if (repoPkg?.name !== NAME) {
  err("仓库根看起来不对", `${short(repo)} 的 package.json 里 name=${repoPkg?.name ?? "读不到"}，期望 ${NAME}`);
  process.exit(2);
}
const version = String(repoPkg.version ?? "");

// ---------- 找 dsh 真正加载的那棵树 ----------
const profilesRoot = join(dshHome, "profiles");
const profileDirs = existsSync(profilesRoot)
  ? readdirSync(profilesRoot)
      .map((n) => join(profilesRoot, n))
      .filter((p) => existsSync(join(p, "package.json")))
  : [];

const declaredTargets = [];
const copies = [];
for (const prof of profileDirs) {
  const spec = readJson(join(prof, "package.json"))?.dependencies?.[NAME];
  if (typeof spec !== "string") continue;
  const m = /^(link|file):(.+)$/.exec(spec);
  if (m) {
    const target = resolve(prof, m[2]);
    if (existsSync(join(target, "package.json"))) declaredTargets.push({ dir: target, how: `${short(prof)} 依赖 ${spec}` });
  }
  const nm = join(prof, "node_modules", NAME);
  if (existsSync(nm) && !isLink(nm)) copies.push({ dir: nm, how: `${short(prof)} node_modules 普通副本` });
}
for (const extra of [join(dshHome, "plugin-src", NAME), join(dshHome, "plugins", NAME)]) {
  if (existsSync(join(extra, "package.json"))) {
    declaredTargets.push({ dir: extra, how: `固定位置 ${short(extra)}` });
  }
}

const seen = new Set();
const targets = [];
for (const t of [...declaredTargets, ...copies]) {
  let real;
  try {
    real = realpathSync(t.dir);
  } catch {
    continue;
  }
  if (seen.has(real)) continue;
  seen.add(real);
  targets.push({ ...t, real });
}
if (targets.length === 0) {
  err("没找到 dsh 实际加载的安装树", `看 ${short(dshHome)}/profiles/*/package.json 的 dependencies.${NAME} —— 先 ./install.sh`);
  process.exit(2);
}

// ---------- 镜像 ----------
/** 列目录内容：跳过 .git / node_modules / ui-preview，返回 rel → {mode, size, bytes?} 与目录 rel → mode */
const listTree = (root, { keep = false } = {}) => {
  const files = new Map();
  const dirs = new Map();
  const visit = (base) => {
    for (const d of readdirSync(base, { withFileTypes: true })) {
      if (TOP_SKIP.has(d.name) || (keep && KEEP.has(d.name))) continue;
      const path = join(base, d.name);
      const rel = relative(root, path).split(sep).join("/");
      if (d.isDirectory() && !d.isSymbolicLink()) {
        // 目录的权限位也在宿主指纹里（mkdir 受 umask 影响，不跟着仓库走就会漂）
        dirs.set(rel, statSync(path).mode & 0o7777);
        visit(path);
      } else {
        const info = statSync(path);
        files.set(rel, { path, mode: info.mode & 0o7777, size: info.size });
      }
    }
  };
  visit(root);
  return { files, dirs };
};

const sameContent = (a, b) => {
  if (a.size !== b.size) return false;
  const left = readFileSync(a.path);
  const right = readFileSync(b.path);
  return left.equals(right);
};

const syncTree = (target) => {
  const src = listTree(repo);
  const dst = listTree(target.dir, { keep: true });
  const add = [];
  const update = [];
  const remove = [];
  for (const [rel, info] of src.files) {
    const cur = dst.files.get(rel);
    if (!cur) add.push(rel);
    // 内容一样但权限位变了也算「要改」—— 宿主指纹把 mode 算进去，不跟着改指纹就对不上
    else if (!sameContent(info, cur) || info.mode !== cur.mode) update.push(rel);
  }
  for (const rel of dst.files.keys()) {
    if (!src.files.has(rel) && !KEEP.has(rel)) remove.push(rel);
  }
  const dirsToRemove = [...dst.dirs.keys()].filter((rel) => !src.dirs.has(rel)).sort((a, b) => b.length - a.length);

  if (!dryRun) {
    for (const [rel, mode] of src.dirs) {
      const dest = join(target.dir, rel);
      mkdirSync(dest, { recursive: true });
      try {
        chmodSync(dest, mode);
      } catch {
        /* 权限改不动不影响内容同步 */
      }
    }
    for (const rel of [...add, ...update]) {
      const info = src.files.get(rel);
      const dest = join(target.dir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      const tmp = `${dest}.ig5-sync-tmp`;
      copyFileSync(info.path, tmp);
      chmodSync(tmp, info.mode);
      renameSync(tmp, dest);
    }
    for (const rel of remove) rmSync(join(target.dir, rel), { force: true });
    for (const rel of dirsToRemove) rmSync(join(target.dir, rel), { recursive: true, force: true });
  }
  return { target, add, update, remove, dirsToRemove };
};

// ---------- 刷新宿主激活记录 ----------
const actFile = join(dshHome, "plugin-activations.json");
const act = readJson(actFile);
const rec = act?.entries?.[NAME] ?? null;
let recordPlan = null;
const results = targets.map((t) => {
  const plan = syncTree(t);
  const fingerprint = treeFingerprint(t.dir);
  return { ...plan, fingerprint };
});

const primary = results[0];
if (!rec) {
  recordPlan = { state: "missing", file: actFile };
} else if (rec.version === version && rec.fingerprint === primary.fingerprint) {
  recordPlan = { state: "clean", file: actFile, version, status: rec.status };
} else {
  recordPlan = {
    state: "stale",
    file: actFile,
    from: { version: rec.version ?? "", fingerprint: rec.fingerprint ?? "" },
    to: { version, fingerprint: primary.fingerprint },
    // 只读预览时这个指纹是**现树**的：落盘后内容会变，指纹得按新树重算，报告里必须说清楚
    previewFingerprint: dryRun || !wantRecord,
    status: rec.status,
    backup: `${actFile}.bak-${stamp()}`,
  };
  if (!dryRun && wantRecord) {
    copyFileSync(actFile, recordPlan.backup);
    rec.version = version;
    rec.fingerprint = primary.fingerprint;
    const tmp = `${actFile}.ig5-sync-tmp`;
    writeFileSync(tmp, JSON.stringify(act, null, 2) + "\n");
    renameSync(tmp, actFile);
    recordPlan.written = true;
  }
}

// ---------- 报告 ----------
const summary = {
  repo: short(repo),
  version,
  dshHome: short(dshHome),
  dryRun,
  targets: results.map((r) => ({
    dir: short(r.target.dir),
    how: r.target.how,
    hotlink: r.target.real === realpathSync(repo),
    add: r.add.length,
    update: r.update.length,
    remove: r.remove.length,
    fingerprint: r.fingerprint,
  })),
  record: recordPlan ? { ...recordPlan, file: short(recordPlan.file), backup: recordPlan.backup ? short(recordPlan.backup) : undefined } : null,
};
if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`无限五代 sync:local（仓库 ${short(repo)} v${version} · dshHome ${short(dshHome)}）`);
  for (const r of results) {
    const verb = r.target.real === realpathSync(repo) ? "热链接态（仓库即安装树）" : dryRun ? "将同步" : "已同步";
    const detail = `新增 ${r.add.length} · 更新 ${r.update.length} · 删除 ${r.remove.length}`;
    if (r.target.real === realpathSync(repo)) ok(`${r.target.how}：${verb}`, detail);
    else if (r.add.length + r.update.length + r.remove.length === 0) ok(`${r.target.how}：已是最新`, detail);
    else if (dryRun) warn(`${r.target.how}：${verb}`, `${detail}（加 --yes 落盘）`);
    else ok(`${r.target.how}：${verb}`, detail);
    if (dryRun && r.remove.length > 0) console.log(`      待删：${r.remove.slice(0, 6).join("、")}${r.remove.length > 6 ? " …" : ""}`);
  }
  if (recordPlan?.state === "missing") {
    warn("管理器没登记本插件", `${short(actFile)} 里没有 ${NAME} —— 管理器式安装才会写这条，跳过记录刷新`);
  } else if (recordPlan?.state === "clean") {
    ok("管理器激活记录与磁盘一致", `${version}（${recordPlan.status}）`);
  } else if (recordPlan?.state === "stale") {
    const detail = recordPlan.previewFingerprint
      ? `${recordPlan.from.version || "?"} → ${recordPlan.to.version}（现树指纹 ${recordPlan.to.fingerprint.slice(0, 12)}…，落盘后按新树重算）`
      : `${recordPlan.from.version || "?"} → ${recordPlan.to.version}，指纹 ${recordPlan.to.fingerprint.slice(0, 12)}…`;
    if (dryRun || !wantRecord) warn("管理器激活记录过期", `${detail}${wantRecord ? "（加 --yes 刷新）" : "（--no-record 已跳过）"}`);
    else ok("管理器激活记录已刷新", `${detail}（原文件备份 ${short(recordPlan.backup)}）`);
  }
  const changed = results.some((r) => r.add.length + r.update.length + r.remove.length > 0);
  if (!dryRun) console.log("\n生效方式：服务端（index.js / prompts）重启 DSH 进程；客户端（client.js）刷新页面。");
  else if (changed || recordPlan?.state === "stale") console.log("\n（以上为只读预览；要落盘加 --yes）");
}
process.exit(0);
