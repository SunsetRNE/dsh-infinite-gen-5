#!/usr/bin/env node
/**
 * 无限五代 · 开发热链接（dev-link）
 *
 * 安装脚本是「复制」：仓库 → ~/.dsh/plugins/dsh-infinite-gen-5 → profile/node_modules 副本（pnpm 硬链接）。
 * 每改一行代码都要 ./install.sh + 重启，开发循环很钝。本脚本把这条链路换成**软链**：
 *
 *   ~/.dsh/plugins/dsh-infinite-gen-5          → 仓库根（原来是一份拷出来的副本）
 *   ~/.dsh/profiles/<profile>/node_modules/…   → 仓库根（原来是 pnpm 造出来的副本）
 *
 * 效果：改仓库即刻可见 —— 服务端（index.js / prompts）重启一次 DSH 进程生效；
 *       客户端（client.js）刷新页面即可；再也不用重跑 install.sh。
 *
 * 代价（想清楚再切）：
 *   1) 没有防呆副本了 —— install.sh 那份 .bak 快照不再自动产生，回滚靠 git（仓库本身有版本控制）；
 *   2) profile 里再跑 `pnpm install` 会把 node_modules 的软链重建回普通副本 → 重跑本脚本 `--link` 即可；
 *   3) 半成品代码会被真加载 —— 别在软链状态下开着 DSH 改一半就重启。
 *
 * 注意接线形态：本脚本假设的是 install.sh 式接线（依赖 file:../../plugins/…）。
 * 若 profile 依赖是管理器式（link:<dshHome>/plugin-src/…），dsh 认的是依赖指向的那棵树，
 * 上面的 node_modules 软链会被忽略 —— `--link` 会就此告警，`--restore` 会警告它会把管理器接线改写成 install.sh 式。
 *
 * 用法：
 *   node scripts/dev-link.mjs              # 看当前是复制态还是热链接态（只读）
 *   node scripts/dev-link.mjs --link       # 切到热链接（原副本改名留存，可回滚）
 *   node scripts/dev-link.mjs --restore    # 切回复制态：删软链 + 重跑 ./install.sh
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "dsh-infinite-gen-5";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(name + "="));
  return hit ? hit.slice(name.length + 1) : fallback;
};
const wantLink = argv.includes("--link");
const wantRestore = argv.includes("--restore");

const ok = (label, detail) => console.log(`  ✓ ${label}${detail ? " — " + detail : ""}`);
const warn = (label, detail) => console.log(`  ⚠ ${label}${detail ? " — " + detail : ""}`);
const err = (label, detail) => console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
const short = (p) => p.replace(homedir(), "~");

const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
const targetOf = (p) => {
  try {
    return readlinkSync(p);
  } catch {
    return null;
  }
};
const stamp = () => new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

const dshHome = resolve(argOf("--dsh-home", process.env.DSH_HOME || join(homedir(), ".dsh")));
const dest = join(dshHome, "plugins", NAME);
const profilesRoot = join(dshHome, "profiles");

const repoPkg = (() => {
  try {
    return JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  } catch {
    return null;
  }
})();
if (repoPkg?.name !== NAME) {
  err("仓库根看起来不对", `${REPO} 的 package.json 里 name=${repoPkg?.name ?? "读不到"}，期望 ${NAME}`);
  process.exit(2);
}

const profiles = () => {
  if (!existsSync(profilesRoot)) return [];
  return readdirSync(profilesRoot)
    .map((n) => join(profilesRoot, n))
    .filter((p) => existsSync(join(p, "package.json")))
    .filter((p) => {
      try {
        return Boolean(JSON.parse(readFileSync(join(p, "package.json"), "utf8")).dependencies?.[NAME]);
      } catch {
        return false;
      }
    });
};

if (!existsSync(dshHome)) {
  err("找不到 DSH 目录", `${short(dshHome)} —— 先跑 ./install.sh 装一份，或传 --dsh-home=<路径>`);
  process.exit(2);
}

// ---------- 状态视图（--link / --restore 也先打一遍） ----------
const show = () => {
  console.log(`无限五代 dev-link（仓库 ${short(REPO)} v${repoPkg.version} · dshHome ${short(dshHome)}）`);
  if (isLink(dest)) ok("已装副本是热链接", `${short(dest)} → ${targetOf(dest)}`);
  else if (existsSync(dest)) ok("已装副本是复制态", `${short(dest)}（改仓库不会自动生效，需 ./install.sh）`);
  else {
    // 管理器式接线只落 dshHome/plugin-src，不生成 plugins/ 副本 —— 这不是缺安装。
    const declaredAny = profiles().map((p) => specOf(p)).find((s) => /^(?:link|file):/.test(s));
    if (declaredAny) {
      ok("没有 install.sh 式副本（接线指向别处，属正常）", `依赖 ${declaredAny}；本脚本 --link 只影响 plugins/ 与 node_modules`);
    } else {
      warn("已装副本不存在", `${short(dest)} —— 先 ./install.sh，或直接 --link`);
    }
  }
  for (const prof of profiles()) {
    const nm = join(prof, "node_modules", NAME);
    const spec = specOf(prof);
    const declared = /^(?:link|file):(.+)$/.exec(spec);
    const declaredTarget = declared ? resolve(prof, declared[1]) : null;
    const nmTarget = isLink(nm) ? resolve(dirname(nm), targetOf(nm) || ".") : null;
    if (nmTarget && nmTarget === REPO) ok(`${short(prof)} node_modules 是热链接`, `→ ${targetOf(nm)}`);
    else if (nmTarget) {
      // pnpm 的 link:/file: 依赖也是软链 —— 那是正常接线，不是热链接。
      const tail = declaredTarget && nmTarget === declaredTarget ? `（依赖 ${spec} 的正常解析）` : "";
      warn(`${short(prof)} node_modules 是软链但没指向仓库`, `→ ${targetOf(nm)}${tail}`);
    } else if (existsSync(nm)) warn(`${short(prof)} node_modules 是普通副本`, `依赖 ${spec}（pnpm 装出来的，改仓库不生效）`);
    else warn(`${short(prof)} node_modules 里没有副本`, "重启后可能加载不到插件");
  }
};

// ---------- 切到热链接 ----------
const specOf = (prof) => {
  try {
    return JSON.parse(readFileSync(join(prof, "package.json"), "utf8")).dependencies?.[NAME] ?? "?";
  } catch {
    return "?";
  }
};
const toLink = () => {
  mkdirSync(join(dshHome, "plugins"), { recursive: true });
  if (existsSync(dest) || isLink(dest)) {
    if (isLink(dest)) {
      rmSync(dest, { force: true });
    } else {
      const keep = `${dest}.bak-${stamp()}-pre-devlink`;
      renameSync(dest, keep);
      warn("原副本已改名留存（回滚用）", short(keep));
    }
  }
  symlinkSync(REPO, dest, "dir");
  ok("已装副本 → 仓库软链", `${short(dest)} → ${REPO}`);

  const list = profiles();
  if (list.length === 0) warn("没有 profile 声明本插件依赖", "接线没配好，先跑 ./install.sh");
  for (const prof of list) {
    const nmDir = join(prof, "node_modules");
    mkdirSync(nmDir, { recursive: true });
    const nm = join(nmDir, NAME);
    if (existsSync(nm) || isLink(nm)) rmSync(nm, { recursive: true, force: true });
    symlinkSync(REPO, nm, "dir");
    ok(`${short(prof)} node_modules → 仓库软链`, `→ ${REPO}`);
    // 管理器式接线（link:<dshHome>/plugin-src/…）下 dsh 认的是依赖声明指向的那棵树，
    // 上面的 node_modules 软链会被忽略 —— 得先把依赖声明改成指向仓库才自洽。
    const spec = specOf(prof);
    const declared = /^(?:link|file):(.+)$/.exec(spec);
    const declaredTarget = declared ? resolve(prof, declared[1]) : null;
    if (declaredTarget && declaredTarget !== REPO && declaredTarget !== resolve(dest)) {
      warn(
        `${short(prof)} 依赖声明指向别处，热链接不会生效`,
        `依赖 ${spec} → ${short(declaredTarget)}；dsh 会加载那棵树。要真热链接，请把依赖改成 link:${REPO}（管理器式则改用管理器重新安装）`,
      );
    }
  }
  console.log("\n生效方式：服务端（index.js / prompts）重启 DSH 进程；客户端（client.js）刷新页面。");
  console.log("注意：profile 里再跑 `pnpm install` 会覆盖上面的软链，之后重跑 `node scripts/dev-link.mjs --link`。");
};

// ---------- 切回复制态 ----------
const toRestore = () => {
  for (const prof of profiles()) {
    if (specOf(prof).startsWith("link:")) {
      warn(
        "接线当前是管理器式（link: 依赖）",
        "install.sh 会把它改写成 file:../../plugins/… + cordis.patch.yml insert；想继续由宿主插件管理器负责更新，就别跑 --restore",
      );
    }
    const nm = join(prof, "node_modules", NAME);
    if (isLink(nm)) {
      rmSync(nm, { force: true });
      ok(`${short(prof)} node_modules 软链已删`, "交给 install.sh 重新生成副本");
    }
  }
  if (isLink(dest)) {
    rmSync(dest, { force: true });
    ok("已装副本软链已删", "交给 install.sh 重新复制");
  }
  const installer = join(REPO, "install.sh");
  if (!existsSync(installer)) {
    err("找不到 install.sh", `请在仓库根跑 ./install.sh 重建复制态（${short(REPO)}）`);
    process.exit(1);
  }
  console.log(`\n重跑安装脚本重建复制态：${short(installer)}`);
  try {
    execFileSync("bash", [installer], { cwd: REPO, stdio: "inherit" });
  } catch {
    err("install.sh 执行失败", "看上面的输出；软链已删，插件此刻处于未安装状态");
    process.exit(1);
  }
};

show();
if (wantLink) {
  console.log("");
  toLink();
} else if (wantRestore) {
  console.log("");
  toRestore();
} else if (argv.length > 0 && !argv.includes("--json")) {
  console.log("\n（以上为只读状态；要切换：--link 切热链接 / --restore 切回复制态）");
}
