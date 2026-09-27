#!/usr/bin/env node
/**
 * 无限五代 · 安装与接线体检（verify_install）
 *
 * 回答三个只有本机能回答的问题：
 *   1) 运行中的 dsh 到底会加载哪一棵树，它和仓库是不是同一个版本；
 *   2) 接线有没有重复或悬空（patch insert 与 bundles 同时存在 = 双接线风险；link: 指向的树不存在 = 悬空）；
 *   3) 运行中的 dsh web 进程是不是比那棵树更旧 —— 即「装了但没重启」，v0.8.1 曾这样空转数小时。
 *
 * 三种接线的正常形态（本脚本只认这三种，混用会告警）：
 *   - 管理器式：profile 依赖 link:<dshHome>/plugin-src/<name> + dsh.profile.bundles 含有本插件
 *               （宿主插件管理器的「安装/更新」写成这样，更新由它负责）；
 *   - install.sh 式：依赖 file:../../plugins/<name> + profile cordis.patch.yml 里有 insert 条目
 *               （本仓库 install.sh 写成这样，不需要 bits 也能装）；
 *   - dev 热链接：上述任一位置换成指向本仓库的软链（scripts/dev-link.mjs --link）。
 *
 * 缺 ~/.dsh（CI、别人机器）→ SKIP 并 exit 0：环境限制不是回归。
 * 硬失败只给「该解析的树解析不到 / 软链指错地方 / 同版本但内容不一致 / 没有接线入口」；
 * 版本落后与陈旧告警默认只提醒，--strict 时才算失败。
 *
 * 用法:
 *   node scripts/verify_install.mjs [--dsh-home=/root/.dsh] [--json] [--strict]
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "dsh-infinite-gen-5";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_FILES = [
  "index.js",
  "client.js",
  "prompts/infinite-gen-5.md",
  "prompts/infinite-gen-5.1-flash.md",
];

const argv = process.argv.slice(2);
const wantJson = argv.includes("--json");
const strict = argv.includes("--strict");
const argOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(name + "="));
  return hit ? hit.slice(name.length + 1) : fallback;
};

const passes = [];
const failures = [];
const warnings = [];
const check = (ok, label, detail) => (ok ? passes : failures).push({ label, detail });
const warn = (label, detail) => warnings.push({ label, detail });

const sha = (p) => {
  try {
    return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);
  } catch {
    return null;
  }
};
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};
const short = (p) => (p ? String(p).replace(homedir(), "~").replace(REPO, "仓库") : p);
// dev 热链接态：副本位置放的是指向仓库的软链（scripts/dev-link.mjs --link），
// 此时「副本与仓库内容一致」是恒真的，几条检查要换个说法才不误导。
const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
const linkTarget = (p) => {
  try {
    return readlinkSync(p);
  } catch {
    return null;
  }
};
// profile 依赖里的 link:/file: 都要相对 profile 目录解析（pnpm 语义：相对该 profile 的 package.json）。
const specTarget = (prof, spec) => {
  const m = /^(?:link|file):(.+)$/.exec(spec || "");
  return m ? resolve(prof, m[1]) : null;
};
const targetOf = (p) => {
  if (!isLink(p)) return resolve(p);
  const t = linkTarget(p);
  return t ? resolve(dirname(p), t) : null;
};
// 只有「进程启动时会被读进内存」的文件才算「改了要重启」：
// index.js / client.js / cordis.patch.yml + prompts/ + data/ 下的模块。
// README、CHANGELOG、scripts/ 这些改完不需要重启，否则文档提交也会被误报成「装了没重启」。
const RUNTIME_FILES = ["index.js", "client.js", "cordis.patch.yml"];
const collectRuntimeFiles = (dir) => {
  const found = [];
  const walk = (rel) => {
    const abs = join(dir, rel);
    let st;
    try {
      st = statSync(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(abs)) walk(join(rel, entry));
    } else if (/\.(mjs|js|md|yml|json)$/.test(rel)) {
      found.push({ path: abs, mtime: st.mtime });
    }
  };
  for (const rel of RUNTIME_FILES) walk(rel);
  for (const sub of ["prompts", "data"]) walk(sub);
  return found;
};

const dshHome = resolve(argOf("--dsh-home", process.env.DSH_HOME || "/root/.dsh"));
const pidFile = resolve(argOf("--pid-file", join(homedir(), ".dsha-web.pid")));

const report = () => {
  if (wantJson) {
    console.log(JSON.stringify({ passes, failures, warnings, dshHome, repo: { root: REPO } }, null, 1));
    return;
  }
  for (const p of passes) console.log(`  ✓ ${p.label}${p.detail ? " — " + p.detail : ""}`);
  for (const w of warnings) console.log(`  ⚠ ${w.label}${w.detail ? " — " + w.detail : ""}`);
  for (const f of failures) console.log(`  ✗ ${f.label}${f.detail ? " — " + f.detail : ""}`);
  console.log(
    `\n体检：${passes.length} 通过 · ${failures.length} 失败 · ${warnings.length} 警告（dshHome=${short(dshHome)}）`,
  );
};

if (!existsSync(dshHome)) {
  console.log(`SKIP 无限五代安装体检：找不到 ${dshHome}（CI / 未装 DSH 的机器属正常）`);
  process.exit(0);
}

const repoPkg = readJson(join(REPO, "package.json"));
const repoVersion = repoPkg?.version || "?";
const dest = join(dshHome, "plugins", NAME);

// 同一个版本才比内容；版本不同本身就是信息（仓库超前或落后于已装树），不必再逐文件比对。
const compareTree = (dir, label) => {
  const pkg = readJson(join(dir, "package.json"));
  if (!pkg) return;
  if (pkg.version !== repoVersion) {
    warn(
      `仓库版本 ≠ ${label}`,
      `仓库 ${repoVersion} / 该树 ${pkg.version}${pkg.version === repoVersion ? "" : ""} —— 这棵树不会被代码改动自动更新`,
    );
    return;
  }
  for (const rel of KEY_FILES) {
    const a = sha(join(REPO, rel));
    const b = sha(join(dir, rel));
    check(a !== null && a === b, `内容一致 ${rel}（${label}）`, `${a || "缺"} / ${b || "缺"}`);
  }
};

// ---------- 1) profile 接线：先认清楚「运行中的 dsh 会加载哪棵树」 ----------
const profilesRoot = join(dshHome, "profiles");
const profileDirs = existsSync(profilesRoot)
  ? readdirSync(profilesRoot)
      .map((n) => join(profilesRoot, n))
      .filter((p) => existsSync(join(p, "package.json")))
  : [];
const states = [];
for (const prof of profileDirs) {
  const pkg = readJson(join(prof, "package.json"));
  const spec = pkg?.dependencies?.[NAME];
  if (!spec) continue;
  const bundles = pkg?.dsh?.profile?.bundles || [];
  const patchPath = join(prof, "cordis.patch.yml");
  const patch = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : "";
  const inserted = new RegExp("^\\s*-\\s*id:\\s*" + NAME + "\\b", "m").test(patch);
  const target = specTarget(prof, spec);
  const nm = join(prof, "node_modules", NAME);
  states.push({
    prof,
    label: short(prof),
    spec,
    inBundles: bundles.includes(NAME),
    inserted,
    target,
    targetOk: !!(target && existsSync(join(target, "package.json"))),
    nm,
    nmTarget: targetOf(nm),
  });
}
for (const s of states) {
  check(true, `${s.label} 依赖声明`, s.spec);
  // 接线入口：insert 与 bundles 二选一；都在 = 双接线；都不在 = 插件根本不会加载（硬失败）。
  if (s.inserted && s.inBundles) {
    warn(
      `${s.label} 双接线`,
      "cordis.patch.yml insert 与 dsh.profile.bundles 同时存在，同一次 dump 里会出现两条 - id（实测尚未重复加载，但接线意图已经含混）",
    );
  } else if (!s.inserted && !s.inBundles) {
    check(false, `${s.label} 有接线入口`, "cordis.patch.yml insert 与 dsh.profile.bundles 两处都没有，插件不会被加载");
  } else {
    check(true, `${s.label} 单一接线入口`, s.inserted ? "profile cordis.patch.yml insert" : "dsh.profile.bundles");
  }
  if (s.spec.startsWith("link:") && !s.inBundles) {
    warn(`${s.label} link: 依赖但不在 bundles 里`, "宿主插件管理器的「已启用」集合取自 dsh.profile.bundles，它可能会把本插件当成没启用");
  }
  // 依赖指向的那棵树
  if (s.target) {
    check(s.targetOk, `${s.label} 依赖目标可解析`, `${short(s.target)}${s.targetOk ? (isLink(s.target) ? "（软链）" : "") : " 不存在或没有 package.json"}`);
  }
  // node_modules 的实际解析路径（运行中的 dsh 就是从这里 require）
  if (s.nmTarget) {
    const same = s.target && s.nmTarget === resolve(s.target);
    const toRepo = s.nmTarget === REPO;
    check(
      toRepo || same || existsSync(join(s.nm, "package.json")),
      `${s.label} node_modules 可解析`,
      `${short(s.nm)}${isLink(s.nm) ? " → " + short(s.nmTarget) : ""}${toRepo ? "（dev 热链接）" : ""}`,
    );
    if (s.target && !same && !toRepo && existsSync(join(s.nm, "package.json"))) {
      warn(`${s.label} node_modules 与依赖声明不是同一棵树`, `声明 → ${short(s.target)}，实际 → ${short(s.nmTarget)}`);
    }
    if (s.target && isLink(s.target) && resolve(s.target) === REPO && !isLink(s.nm)) {
      warn(
        `${s.label} node_modules 是普通副本（破坏了热链接）`,
        "pnpm install 会把软链重建成副本 —— 重跑 node scripts/dev-link.mjs --link 即可",
      );
    }
  } else if (existsSync(s.nm)) {
    warn(`${s.label} node_modules 里没有副本`, "pnpm install 没跑或还没同步，重启后可能仍加载旧版");
  }
}
if (states.length === 0) {
  warn("没有 profile 引用本插件", `扫过 ${profileDirs.length} 个 profile，都没声明 ${NAME} 依赖`);
}

// 运行中的 dsh 真正加载的树：优先用 profile 解析到的那棵，其次 install.sh 副本，最后仓库。
const activeTarget =
  (states.find((s) => s.targetOk) || {}).target || (existsSync(join(dest, "package.json")) ? dest : REPO);

// ---------- 2) 盘上这棵树与仓库对不对得上 ----------
if (isLink(dest)) {
  const t = targetOf(dest);
  check(t === REPO, "install.sh 副本位置是 dev 热链接（指向本仓库）", `${short(dest)} → ${short(t)}`);
} else if (existsSync(join(dest, "package.json"))) {
  compareTree(dest, "install.sh 副本");
} else {
  // 管理器式安装只落 dshHome/plugin-src，不生成 plugins/ 副本 —— 这不是问题。
  passes.push({ label: "无 install.sh 式副本", detail: `${short(dest)} 不存在（管理器式安装属正常）` });
}
if (activeTarget !== REPO && resolve(activeTarget) !== resolve(dest)) {
  compareTree(activeTarget, "运行中的安装树");
}

// ---------- 3) 运行进程是否比那棵树更旧 ----------
let proc = null;
if (existsSync(pidFile)) {
  const pid = readFileSync(pidFile, "utf8").trim();
  if (/^\d+$/.test(pid)) {
    try {
      const started = new Date(execFileSync("ps", ["-o", "lstart=", "-p", pid], { encoding: "utf8" }).trim());
      proc = { pid, started: started.toISOString() };
      const newest = collectRuntimeFiles(activeTarget).sort((x, y) => y.mtime - x.mtime)[0] || null;
      const destMtime = newest ? newest.mtime : null;
      if (destMtime && started < destMtime) {
        warn(
          "进程比盘上副本更旧（改了没重启）",
          `dsh web pid ${pid} 启动于 ${started.toISOString()}，${short(newest.path)} 更新于 ${destMtime.toISOString()} —— 这份改动还没进进程`,
        );
      } else if (destMtime) {
        passes.push({
          label: "运行进程不早于运行时文件",
          detail: `pid ${pid} 启动于 ${started.toISOString()}，最新改动是 ${short(newest.path)}`,
        });
      }
    } catch {
      warn("读不到 dsh web 进程启动时间", `pid 文件 ${short(pidFile)} 里的 ${pid} 不存在？`);
    }
  }
} else {
  warn("没有 dsh web pid 文件", `${short(pidFile)} 不存在（桌面版或未运行），跳过新旧比对`);
}

// ---------- 4) 遗留副本与备份快照 ----------
const pluginSrc = join(dshHome, "plugin-src");
const srcCopy = join(pluginSrc, NAME);
const activeIsSrcCopy = resolve(activeTarget) === resolve(srcCopy);
if (existsSync(join(srcCopy, "package.json"))) {
  if (activeIsSrcCopy) {
    passes.push({
      label: "管理器安装树（plugin-src）",
      detail: `版本 ${readJson(join(srcCopy, "package.json"))?.version || "?"}，正被 profile 依赖引用`,
    });
  } else {
    warn(
      "遗留 plugin-src 副本",
      `版本 ${readJson(join(srcCopy, "package.json"))?.version || "?"}（没有 profile 依赖引用它，可留作回滚，也可删）`,
    );
  }
}
let backups = [];
try {
  backups = readdirSync(pluginSrc).filter((n) => n.startsWith(NAME + ".bak-"));
} catch {}
if (backups.length > 0) {
  passes.push({ label: `历史快照 ${backups.length} 份`, detail: `最新 ${backups.sort().at(-1)}` });
  if (backups.length > 10) warn("快照堆积", `${backups.length} 份，可按 mtime 清理 14 天前的`);
}
let devBackups = [];
try {
  devBackups = readdirSync(join(dshHome, "plugins")).filter((n) => n.startsWith(NAME + ".bak-"));
} catch {}
if (devBackups.length > 0) {
  warn("dev 链接切换留下的副本", `${devBackups.join("、")} —— 确认不需要回滚后删掉即可`);
}

// ---------- 5) 宿主插件管理器的激活记录（plugin-activations.json） ----------
// 这份记录由宿主侧的插件管理器维护，记「上一次确认过的插件版本与指纹」。
// 它是另一条会撒谎的路径：插件已升到新版，管理器界面里却还显示旧版号。
const bundleWired = states.some((s) => s.inBundles);
const actFile = join(dshHome, "plugin-activations.json");
const act = readJson(actFile);
const rec = act?.entries?.[NAME];
if (rec) {
  if (rec.version && rec.version !== repoVersion) {
    warn(
      "宿主插件管理器激活记录过期",
      `${short(actFile)} 记的是 ${rec.version}，实际 ${repoVersion} —— 管理器界面会显示旧版本；宿主只在 queued/attempted 的条目上重写这份记录，要用管理器重新确认一次才更新`,
    );
    if ((rec.status === "queued" || rec.status === "attempted") && !bundleWired) {
      warn(
        "管理器会把本插件判为未启用",
        `记录 status=${rec.status}，而管理器的「已启用」集合取自 profile 的 dsh.profile.bundles；本插件走的是 cordis.patch.yml insert —— 别用管理器启用它，否则会被标 disabled`,
      );
    }
  } else {
    passes.push({ label: "宿主插件管理器激活记录 = 仓库版本", detail: `${rec.version || "?"}（${rec.status || "?"}）` });
  }
}

report();
process.exit(failures.length > 0 || (strict && warnings.length > 0) ? 1 : 0);
