// plugin-patch.mjs — 把「端点直连」通道装进 dsh-infinite-gen-5 插件（两行加法 + 备份 + 回滚）。
//
// 为什么是加法而不是改写：index.js 是宿主的生产插件（2731 行），任何重写都可能踩到
// 提示词注入、去重、惰性装载、投影五条链。本补丁只做三件事：
//   1) 复制 ig5-relay-plugin.mjs 到插件目录（新文件，删掉即消失）
//   2) 在 import 区插一行；在工具注册区插一行 ctx.effect(() => registerRelayTools(ctx))
//   3) 写之前先备份 index.js.bak-v<版本>-<时间戳>；--revert 用最新备份还原
//
// 幂等：检测到补丁标记 #ig5relay 就不再插；锚点找不到或出现多次 → 拒绝写入（绝不猜位置）。
// 用法：node plugin-patch.mjs            # dry-run（默认，只打印将要做什么）
//       node plugin-patch.mjs --apply    # 真写：备份 → 插两处 → node --check
//       node plugin-patch.mjs --revert   # 用最新备份还原 index.js 并删掉模块
//       node plugin-patch.mjs --json

import { resolveKernelRoot } from "./lib/kernel-root.mjs";
import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync, unlinkSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolveKernelRoot();
const INDEX = join(PLUGIN_DIR, "index.js");
const MODULE_SRC = join(HERE, "ig5-relay-plugin.mjs");
const MODULE_DST = join(PLUGIN_DIR, "ig5-relay-plugin.mjs");
const MARKER = "#ig5relay";
const BAK_PREFIX = "index.js.bak-v0.36.8-";

const ANCHOR_IMPORT = 'import { createStatsStore, emptyStats, statsFile, STATS_SCHEMA } from "./stats-store.mjs";';
const ANCHOR_REGISTER = [
  "  ctx.effect(() => {",
  "    ctx.tools.register(envTool);",
  "    ctx.tools.register(dispatchTool);",
  "  });",
].join("\n");

const IMPORT_LINE = `import { registerRelayTools } from "./ig5-relay-plugin.mjs"; // ig5-adapters 补丁 ${MARKER}`;
const REGISTER_BLOCK = [
  "",
  `  // ig5-adapters 补丁 ${MARKER} —— endpoint-relay 通道（卸载：删本块与顶部 import，或用 --revert）`,
  "  ctx.effect(() => {",
  "    registerRelayTools(ctx);",
  "  });",
  "",
].join("\n");

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

export function plan() {
  if (!existsSync(INDEX)) return { status: "index-missing", index: INDEX, changed: false };
  const source = readFileSync(INDEX, "utf8");
  if (source.includes(MARKER)) return { status: "already-patched", index: INDEX, changed: false, marker: MARKER };
  const importHits = countOccurrences(source, ANCHOR_IMPORT);
  const registerHits = countOccurrences(source, ANCHOR_REGISTER);
  if (importHits !== 1 || registerHits !== 1) {
    return {
      status: "anchor-mismatch",
      index: INDEX,
      changed: false,
      anchors: { importHits, registerHits },
      hint: "锚点数量不为 1：宿主 index.js 已改版，先核对导入区与 tools.register(dispatchTool) 附近再打补丁",
    };
  }
  const patched = source.replace(ANCHOR_IMPORT, `${ANCHOR_IMPORT}\n${IMPORT_LINE}`).replace(ANCHOR_REGISTER, `${ANCHOR_REGISTER}\n${REGISTER_BLOCK}`);
  return {
    status: "ready",
    index: INDEX,
    changed: false,
    moduleSource: MODULE_SRC,
    moduleTarget: MODULE_DST,
    moduleWillCopy: !existsSync(MODULE_DST),
    addedLines: patched.split("\n").length - source.split("\n").length,
    backup: join(PLUGIN_DIR, `${BAK_PREFIX}${stamp()}`),
    patched,
  };
}

export function syncModule() {
  const same = existsSync(MODULE_DST) && readFileSync(MODULE_DST, "utf8") === readFileSync(MODULE_SRC, "utf8");
  if (!same) copyFileSync(MODULE_SRC, MODULE_DST);
  const syntax = spawnSync(process.execPath, ["--check", INDEX], { encoding: "utf8" });
  return {
    status: same ? "module-uptodate" : "module-synced",
    index: INDEX,
    changed: !same,
    moduleSource: MODULE_SRC,
    moduleTarget: MODULE_DST,
    syntax: { code: syntax.status, stderr: (syntax.stderr || "").trim().slice(0, 400) },
  };
}

export function apply() {
  const planResult = plan();
  if (planResult.status === "already-patched") return syncModule();
  if (planResult.status !== "ready") {
    const { patched, ...rest } = planResult;
    return rest;
  }
  const backup = planResult.backup;
  copyFileSync(INDEX, backup);
  const tmp = `${INDEX}.ig5tmp`;
  writeFileSync(tmp, planResult.patched, "utf8");
  renameSync(tmp, INDEX);
  let moduleCopied = false;
  if (planResult.moduleWillCopy || readFileSync(MODULE_SRC).length !== (existsSync(MODULE_DST) ? readFileSync(MODULE_DST).length : -1)) {
    copyFileSync(MODULE_SRC, MODULE_DST);
    moduleCopied = true;
  }
  const syntax = spawnSync(process.execPath, ["--check", INDEX], { encoding: "utf8" });
  return {
    status: syntax.status === 0 ? "applied" : "syntax-error",
    index: INDEX,
    changed: true,
    backup,
    moduleCopied,
    moduleTarget: MODULE_DST,
    addedLines: planResult.addedLines,
    syntax: { code: syntax.status, stderr: (syntax.stderr || "").trim().slice(0, 400) },
    rollback: [`node ${join(HERE, "plugin-patch.mjs")} --revert`, `cp "${backup}" "${INDEX}"`, `rm -f "${MODULE_DST}"`],
  };
}

export function revert() {
  const backups = readdirSync(PLUGIN_DIR)
    .filter((name) => name.startsWith(BAK_PREFIX))
    .sort();
  if (!backups.length) return { status: "no-backup", changed: false, hint: `目录里没有 ${BAK_PREFIX}* 备份` };
  const newest = join(PLUGIN_DIR, backups[backups.length - 1]);
  copyFileSync(newest, INDEX);
  let moduleRemoved = false;
  if (existsSync(MODULE_DST) && readFileSync(MODULE_DST, "utf8").includes("ig5-relay-plugin.mjs")) {
    unlinkSync(MODULE_DST);
    moduleRemoved = true;
  }
  const syntax = spawnSync(process.execPath, ["--check", INDEX], { encoding: "utf8" });
  return {
    status: syntax.status === 0 ? "reverted" : "syntax-error",
    changed: true,
    restoredFrom: newest,
    moduleRemoved,
    syntax: { code: syntax.status, stderr: (syntax.stderr || "").trim().slice(0, 400) },
  };
}

function main(argv) {
  const json = argv.includes("--json");
  let out;
  if (argv.includes("--revert")) out = revert();
  else if (argv.includes("--apply")) out = apply();
  else out = (({ patched, ...rest }) => rest)(plan());

  if (json) {
    console.log(`IG5_PATCH_JSON ${JSON.stringify(out)}`);
    return out.status === "syntax-error" || out.status === "anchor-mismatch" ? 1 : 0;
  }
  console.log(`插件目录：${PLUGIN_DIR}`);
  console.log(`状态：${out.status}`);
  if (out.status === "ready") {
    console.log(`  将插入 ${out.addedLines} 行：顶部 import + 注册区 ctx.effect`);
    console.log(`  将复制模块：${out.moduleSource} → ${out.moduleTarget}${out.moduleWillCopy ? "" : "（已存在同文件，跳过判定见实现）"}`);
    console.log(`  写入前备份：${out.backup}`);
    console.log("  这是 dry-run —— 加 --apply 才真写");
  }
  if (out.status === "applied") {
    console.log(`  插入 ${out.addedLines} 行 · 备份 ${out.backup} · 模块已复制=${out.moduleCopied}`);
    console.log(`  node --check index.js → exit ${out.syntax.code}`);
    console.log("  回滚：");
    for (const line of out.rollback) console.log(`    ${line}`);
  }
  if (out.status === "already-patched") console.log(`  已含标记 ${out.marker}，跳过（幂等）`);
  if (out.status === "module-synced" || out.status === "module-uptodate") {
    console.log(`  模块同步：${out.status} · ${out.moduleTarget} · node --check exit ${out.syntax.code}`);
  }
  if (out.status === "anchor-mismatch") {
    console.log(`  锚点命中数：${JSON.stringify(out.anchors)} —— 拒绝写入`);
    console.log(`  ${out.hint}`);
  }
  if (out.status === "reverted") console.log(`  已从 ${out.restoredFrom} 还原 · 模块删除=${out.moduleRemoved} · node --check exit ${out.syntax.code}`);
  if (out.status === "syntax-error") console.log(`  语法检查失败：${out.syntax.stderr}`);
  if (out.status === "no-backup") console.log(`  ${out.hint}`);
  return out.status === "syntax-error" || out.status === "anchor-mismatch" ? 1 : 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));

export { main, PLUGIN_DIR, INDEX, MODULE_DST, MARKER, ANCHOR_IMPORT, ANCHOR_REGISTER };
