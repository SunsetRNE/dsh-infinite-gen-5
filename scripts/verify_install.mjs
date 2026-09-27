#!/usr/bin/env node
/**
 * 无限五代 · 安装与接线体检（verify_install）
 *
 * 回答三个只有本机能回答的问题：
 *   1) 盘上三处是不是同一个版本 —— 仓库 / ~/.dsh/plugins 副本 / profile 解析到的 node_modules 副本；
 *   2) profile 的接线是哪一种 —— 新版 cordis.patch.yml insert、还是旧版 dsh.profile.bundles（两者同时在 = 双接线风险）；
 *   3) 运行中的 dsh web 进程是不是比盘上副本更旧 —— 即「装了但没重启」，v0.8.1 曾这样空转数小时。
 *
 * 缺 ~/.dsh（CI、别人机器）→ SKIP 并 exit 0：环境限制不是回归。
 * 硬失败只给「版本/内容不一致」；陈旧与接线告警默认只提醒，--strict 时才算失败。
 *
 * 用法:
 *   node scripts/verify_install.mjs [--dsh-home=/root/.dsh] [--json] [--strict]
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
const short = (p) => p.replace(homedir(), "~");
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
    `\n体检：${passes.length} 通过 · ${failures.length} 失败 · ${warnings.length} 警告（dshHome=${dshHome}）`,
  );
};

if (!existsSync(dshHome)) {
  console.log(`SKIP 无限五代安装体检：找不到 ${dshHome}（CI / 未装 DSH 的机器属正常）`);
  process.exit(0);
}

// ---------- 1) 仓库 vs 已安装副本 ----------
const repoPkg = readJson(join(REPO, "package.json"));
const dest = join(dshHome, "plugins", NAME);
const destPkg = readJson(join(dest, "package.json"));
const repoVersion = repoPkg?.version || "?";
const destVersion = destPkg?.version || "?";

if (!destPkg) {
  warn("已安装副本缺失", `${short(dest)} 不存在或没有 package.json —— 跑 ./install.sh 装一份`);
} else if (isLink(dest)) {
  const target = linkTarget(dest);
  check(
    resolve(target || ".") === REPO,
    "已装副本是 dev 热链接（指向本仓库）",
    `${short(dest)} → ${target}${resolve(target || ".") === REPO ? "" : `（期望 → ${REPO}）`}`,
  );
  check(
    destVersion === repoVersion,
    "热链接态版本 = 仓库版本",
    `副本 ${destVersion} / 仓库 ${repoVersion}`,
  );
} else {
  check(destVersion === repoVersion, "已安装副本版本 = 仓库版本", `副本 ${destVersion} / 仓库 ${repoVersion}`);
  for (const rel of KEY_FILES) {
    const a = sha(join(REPO, rel));
    const b = sha(join(dest, rel));
    check(a !== null && a === b, `内容一致 ${rel}`, `${a || "缺"} / ${b || "缺"}`);
  }
}

// ---------- 2) profile 接线 ----------
const profilesRoot = join(dshHome, "profiles");
const profileDirs = existsSync(profilesRoot)
  ? readdirSync(profilesRoot).map((n) => join(profilesRoot, n)).filter((p) => existsSync(join(p, "package.json")))
  : [];
let wired = 0;
for (const prof of profileDirs) {
  const pkg = readJson(join(prof, "package.json"));
  if (!pkg) continue;
  const spec = pkg.dependencies?.[NAME];
  if (!spec) continue;
  wired++;
  const label = short(prof);
  const bundles = pkg.dsh?.profile?.bundles || [];
  const inBundles = bundles.includes(NAME) || bundles.includes(NAME);
  const patchPath = join(prof, "cordis.patch.yml");
  const patch = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : "";
  const inserted = new RegExp("^\\s*-\\s*id:\\s*" + NAME + "\\b", "m").test(patch);
  check(true, `${label} 依赖声明`, `${spec}`);
  check(inserted || inBundles, `${label} 有接线入口`, inserted ? "cordis.patch.yml insert" : inBundles ? "dsh.profile.bundles" : "两处都没有，插件不会加载");
  if (inserted && inBundles) warn(`${label} 双接线`, "patch insert 与 bundles 同时存在，可能被加载两次");
  const nm = join(prof, "node_modules", NAME);
  const resolved = readJson(join(nm, "package.json"));
  const nmIsLink = isLink(nm);
  if (nmIsLink) {
    const target = linkTarget(nm);
    check(resolve(target || ".") === REPO, `${label} node_modules 是热链接（指向本仓库）`, `→ ${target}`);
  } else if (resolved) {
    check(
      !destPkg || resolved.version === destVersion,
      `${label} node_modules 副本版本 = 已安装副本`,
      `node_modules ${resolved.version} / plugins ${destVersion}`,
    );
    if (isLink(dest)) {
      warn(
        `${label} node_modules 是普通副本（破坏了热链接）`,
        `pnpm install 会把软链重建成副本 —— 重跑 node scripts/dev-link.mjs --link 即可`,
      );
    }
  } else {
    warn(`${label} node_modules 里没有副本`, "pnpm install 没跑或还没同步，重启后可能仍加载旧版");
  }
  if (spec.startsWith("link:")) {
    warn(`${label} 仍是旧版 link: 接线`, `${spec} —— 新版 install.sh 会迁移成 file:../../plugins/${NAME}`);
  }
}
if (wired === 0) warn("没有 profile 引用本插件", `扫过 ${profileDirs.length} 个 profile，都没声明 ${NAME} 依赖`);

// ---------- 3) 运行进程是否比盘上副本更旧 ----------
let proc = null;
if (existsSync(pidFile)) {
  const pid = readFileSync(pidFile, "utf8").trim();
  if (/^\d+$/.test(pid)) {
    try {
      const started = new Date(execFileSync("ps", ["-o", "lstart=", "-p", pid], { encoding: "utf8" }).trim());
      proc = { pid, started: started.toISOString() };
      const destMtime = destPkg ? statSync(join(dest, "index.js")).mtime : null;
      if (destMtime && started < destMtime) {
        warn(
          "进程比盘上副本更旧（装了没重启）",
          `dsh web pid ${pid} 启动于 ${started.toISOString()}，副本更新于 ${destMtime.toISOString()} —— 这份改动还没生效`,
        );
      } else if (destMtime) {
        passes.push({ label: "运行进程不早于盘上副本", detail: `pid ${pid} 启动于 ${started.toISOString()}` });
      }
    } catch {
      warn("读不到 dsh web 进程启动时间", `pid 文件 ${short(pidFile)} 里的 ${pid} 不存在？`);
    }
  }
} else {
  warn("没有 dsh web pid 文件", `${short(pidFile)} 不存在（桌面版或未运行），跳过新旧比对`);
}

// ---------- 4) 遗留副本与备份快照 ----------
const legacy = readJson(join(dshHome, "plugin-src", NAME, "package.json"));
if (legacy) warn("遗留 plugin-src 副本", `版本 ${legacy.version}（旧接线产物，可留作回滚，也可删）`);
const pluginSrc = join(dshHome, "plugin-src");
let backups = [];
try {
  backups = readdirSync(pluginSrc).filter((n) => n.startsWith(NAME + ".bak-"));
} catch {}
if (backups.length > 0) {
  passes.push({ label: `历史快照 ${backups.length} 份`, detail: `最新 ${backups.sort().at(-1)}` });
  if (backups.length > 10) warn("快照堆积", `${backups.length} 份，可按 mtime 清理 14 天前的`);
}

// ---------- 5) 宿主插件管理器的激活记录（plugin-activations.json） ----------
// 这份记录由宿主侧的插件管理器维护，记「上一次确认过的插件版本与指纹」。
// 它是另一条会撒谎的路径：插件已升到新版，管理器界面里却还显示旧版号。
const actFile = join(dshHome, "plugin-activations.json");
const act = readJson(actFile);
const rec = act?.entries?.[NAME];
if (rec) {
  if (rec.version && rec.version !== repoVersion) {
    warn(
      "宿主插件管理器激活记录过期",
      `${short(actFile)} 记的是 ${rec.version}，实际 ${repoVersion} —— 管理器界面会显示旧版本，重启后应自动刷新`,
    );
  } else {
    passes.push({ label: "宿主插件管理器激活记录 = 仓库版本", detail: `${rec.version || "?"}（${rec.status || "?"}）` });
  }
}

report();
process.exit(failures.length > 0 || (strict && warnings.length > 0) ? 1 : 0);
