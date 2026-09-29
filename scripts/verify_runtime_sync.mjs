// 无限五代 · 运行态同步核对（离线、只读、不写盘）
//   背景：工作树改了 prompts/*.md 不等于运行态改了。DSH 进程加载的副本在
//   ~/.dsh/plugin-src/dsh-infinite-gen-5（profiles/web 的 link: 目标）。2026-09-28 的
//   一次性子代理实验里，三臂被测内核之所以全是 v0.36.4，就是因为这个副本没同步。
//   本脚本只做一件事：把「关键文件」在工作树与运行态副本之间逐字节对齐，缺一处即 exit 1。
//
//   用法：node scripts/verify_runtime_sync.mjs [--against <dir>] [--self-test]
//   --against  指定对比目标（默认自动解析 ~/.dsh 下的 link 目标）
//   --self-test 自测：造一个只改了一字节的临时副本，必须被判定为不一致（exit 1）
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..");
const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");

// 真正会被注入提示词 / 参与运行的文件。改这些不动运行态 = 实验白跑。
export const WATCHED = [
  "prompts/infinite-gen-5.md",
  "prompts/infinite-gen-5-lazy.md",
  "data/boost-corpus.mjs",
  "data/lazy-sections.mjs",
  "anchor-armor.mjs",
  "index.js",
  "client.js",
  "package.json",
];

export function sha256(file) {
  if (!existsSync(file)) return null;
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function resolveRuntimeRoot(dshHome = DSH_HOME) {
  const acts = join(dshHome, "plugin-activations.json");
  const candidate = join(dshHome, "plugin-src", "dsh-infinite-gen-5");
  if (existsSync(acts)) {
    try {
      const txt = readFileSync(acts, "utf8");
      const m = txt.match(/link:([^"',\s]+dsh-infinite-gen-5)/);
      if (m && existsSync(m[1])) return m[1];
    } catch {
      /* 落到默认候选 */
    }
  }
  return existsSync(candidate) ? candidate : null;
}

// 返回 [{file, repo, runtime, ok}]，供报告与断言共用
export function compareTrees(repoRoot = REPO, runtimeRoot = null) {
  const rows = [];
  for (const rel of WATCHED) {
    const a = sha256(join(repoRoot, rel));
    const b = runtimeRoot ? sha256(join(runtimeRoot, rel)) : null;
    rows.push({ file: rel, repo: a, runtime: b, ok: a !== null && a === b });
  }
  return rows;
}

function selftest() {
  const tmp = join(REPO, "tests", ".runtime-sync-selftest");
  rmSync(tmp, { recursive: true, force: true });
  for (const rel of WATCHED) {
    const dst = join(tmp, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(join(REPO, rel)));
  }
  const same = compareTrees(REPO, tmp).every((r) => r.ok);
  // 只改一字节：必须判定为不一致
  const victim = join(tmp, "prompts/infinite-gen-5.md");
  writeFileSync(victim, readFileSync(victim, "utf8").replace(/\n/, "\n") + "\n");
  const diff = compareTrees(REPO, tmp).filter((r) => !r.ok).map((r) => r.file);
  rmSync(tmp, { recursive: true, force: true });
  const pass = same && diff.length === 1 && diff[0] === "prompts/infinite-gen-5.md";
  console.log(
    `运行态同步核对自测：${pass ? "通过" : "失败"}（同树=一致 ${same} · 改一字节后报出 ${diff.join(",") || "无"}）`,
  );
  return pass ? 0 : 1;
}

function main(argv) {
  if (argv.includes("--self-test")) process.exit(selftest());
  const i = argv.indexOf("--against");
  const explicit = i >= 0;
  const runtimeRoot = explicit ? resolve(argv[i + 1] || "") : resolveRuntimeRoot();
  if (!runtimeRoot || !existsSync(runtimeRoot)) {
    // 本机没装 DSH 时（例如 CI runner）没有运行态副本可比对 —— 这是「无从比对」，不是回归失败。
    // 本会话教训：这里原本一律 exit 2，于是 verify:runtime 一进 verify:all 就让远程 CI 变红，
    // 而同一棵树在本机是绿的。显式 --against 传错路径仍然按错误处理。
    if (explicit) {
      console.error(`运行态同步核对：--against 指向的目录不存在：${runtimeRoot || "(空)"}`);
      process.exit(2);
    }
    console.log("SKIP: 没找到运行态副本（~/.dsh/plugin-src/dsh-infinite-gen-5）—— 本机没装 DSH 时无从比对，CI 上跳过即可。");
    console.log("  指定对比目标：node scripts/verify_runtime_sync.mjs --against /path/to/plugin-src/dsh-infinite-gen-5");
    console.log("  这条不是回归失败：插件本身不依赖运行态副本，本机改完 prompts 后重跑本命令即可。");
    process.exit(0);
  }
  const rows = compareTrees(REPO, runtimeRoot);
  const bad = rows.filter((r) => !r.ok);
  for (const r of rows) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.file}  ${(r.repo || "缺失").slice(0, 12)} → ${(r.runtime || "运行态缺失").slice(0, 12)}`);
  }
  console.log(`\n运行态副本：${runtimeRoot}`);
  if (bad.length) {
    console.error(`不一致 ${bad.length} 处 —— 运行态注入的仍是旧内容。修：npm run sync:local:apply`);
    process.exit(1);
  }
  console.log(`运行态同步核对：${rows.length} 处关键文件逐字节一致（改 prompts 后务必重跑本命令）`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
