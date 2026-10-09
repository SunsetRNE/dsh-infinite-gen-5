// 无限五代 · Windows 兼容自检（实验性，无网络、无副作用、不改任何文件）
//
// 两件事：
//   ① 垫片行为的 win32 单测：在 Linux 上强制 platform=win32 跑真分支，
//      断言分隔符 / 外壳 / 家目录 / 行尾 / 安装脚本 / 命令改写 / 环境变量大小写；
//   ② 全仓静态扫描：把平台敏感点按「运行时缺陷 / 数据 / 安装脚本 / 已兼容」分类计数，
//      并对运行时缺陷设闸门 —— 数量上升就红。
//
// 用法：
//   node scripts/verify_win_compat.mjs            # 人类可读
//   node scripts/verify_win_compat.mjs --json     # 机器可读
//   node scripts/verify_win_compat.mjs --list      # 附完整命中清单
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import {
  WIN_COMPAT_VERSION, platformView, homeDir, joinPath, dshRoot, shellFor, binName,
  adaptCommand, normalizeEol, installerFor, envValue, compatMatrix, familyOf,
} from "../data/win-compat.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AS_JSON = process.argv.includes("--json");
const SHOW_LIST = process.argv.includes("--list");

const fails = [];
const notes = [];
let checks = 0;
const ok = (cond, label, detail = "") => {
  checks += 1;
  if (!cond) fails.push(`${label}${detail ? " :: " + detail : ""}`);
};

// ── ① 垫片 win32 分支单测 ───────────────────────────────────────────────
const WIN = { platform: "win32", home: "C:\\Users\\TARGET_USER" };
const NIX = { platform: "linux", home: "/root" };

{
  ok(familyOf("win32") === "nt", "win32 归 nt 族");
  ok(familyOf("darwin") === "posix" && familyOf("linux") === "posix", "darwin/linux 归 posix 族");
  ok(platformView(WIN).sep === "\\" && platformView(NIX).sep === "/", "分隔符随平台切换");
  ok(platformView(WIN).delim === ";" && platformView(NIX).delim === ":", "PATH 分隔符随平台切换");

  ok(homeDir(WIN) === "C:\\Users\\TARGET_USER", "win 家目录走注入值", homeDir(WIN));
  ok(homeDir(NIX) === "/root", "posix 家目录走注入值", homeDir(NIX));

  ok(joinPath(["a", "b", "c.mjs"], WIN) === "a\\b\\c.mjs", "win 拼接用反斜杠", joinPath(["a", "b", "c.mjs"], WIN));
  ok(joinPath(["a", "b"], NIX) === "a/b", "posix 拼接用斜杠");
  ok(joinPath(["a/", "b\\"], WIN) === "a\\b", "拼接剥掉尾部分隔符且不重复", joinPath(["a/", "b\\"], WIN));

  ok(dshRoot(WIN).endsWith("\\.dsh"), "win 下 DSH 根落在 <home>\\.dsh", dshRoot(WIN));
  ok(dshRoot({ ...WIN, home: undefined, DSH_HOME: undefined }) !== "", "DSH 根可解析即便未注入");

  const wsh = shellFor("node x.mjs", WIN);
  ok(wsh.cmd === "powershell.exe" && wsh.shell === false, "win 外壳走 powershell 且不经 shell", wsh.cmd);
  const nsh = shellFor("node x.mjs", NIX);
  ok(nsh.cmd === "/bin/sh" && nsh.args[0] === "-c", "posix 外壳走 /bin/sh -c");

  ok(binName("npm", WIN) === "npm.cmd", "win 上 npm 需点全 .cmd", binName("npm", WIN));
  ok(binName("pnpm", WIN) === "pnpm.cmd", "win 上 pnpm 需点全 .cmd");
  ok(binName("npm", NIX) === "npm", "posix 上保持原样");

  const t = adaptCommand("curl -s http://HOST/ -o /tmp/out.bin", WIN);
  ok(t.changed && t.line.includes("%TEMP%"), "win 改写 /tmp → %TEMP%", t.line);
  ok(adaptCommand("curl -s http://HOST/ -o /tmp/out.bin", NIX).changed === false, "posix 不改写命令");
  ok(adaptCommand("chmod +x bin.sh", WIN).line.startsWith("icacls"), "win 改写 chmod → icacls");
  ok(adaptCommand("sudo apt install ffuf", WIN).line.includes("Start-Process -Verb RunAs"), "win 改写 sudo → 提权调用");
  ok(/人工复核/.test(adaptCommand("cat f | grep -i x", WIN).reason), "win 管道工具缺口被标为需人工复核");

  ok(normalizeEol("a\nb", WIN) === "a\r\nb", "win 行尾归一为 CRLF");
  ok(normalizeEol("a\r\nb", NIX) === "a\nb", "posix 行尾归一为 LF");
  ok(normalizeEol("a\r\r\nb", WIN) === "a\r\nb", "混杂行尾收敛成单一 CRLF");

  ok(installerFor(WIN).primary === "install.ps1", "win 首选 install.ps1");
  ok(installerFor(WIN).run.includes("-ExecutionPolicy Bypass"), "win 安装命令带执行策略放行");
  ok(installerFor(NIX).primary === "install.sh", "posix 首选 install.sh");

  const fakeEnv = { Path: "C:\\x", "nPm_Config": "1" };
  ok(envValue("PATH", { platform: "win32", env: fakeEnv }) === "C:\\x", "win 环境变量大小写不敏感");
  ok(envValue("PATH", { platform: "linux", env: fakeEnv }) === undefined, "posix 环境变量区分大小写");
}

// ── ② 三平台对照矩阵 ────────────────────────────────────────────────────
const matrix = compatMatrix({ home: undefined, probe: "npm run verify:cot-router" });
{
  ok(matrix.length === 3, "对照矩阵覆盖三平台");
  const win = matrix.find((r) => r.platform === "win32");
  ok(win.eol === "CRLF" && win.npmBin === "npm.cmd" && win.installer === "install.ps1", "win32 行三项一致");
  ok(win.tempAdapted.includes("%TEMP%"), "矩阵里 win32 已改写临时目录");
  const nix = matrix.find((r) => r.platform === "linux");
  ok(nix.tempAdapted.includes("/tmp/"), "矩阵里 posix 保留 /tmp");
  notes.push(`对照矩阵 ${matrix.length} 行 × 10 列（home/dshRoot/joined/shell/npmBin/installer/eol/tempAdapted…）`);
}

// ── ③ 全仓静态扫描 ─────────────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "ui-preview", "adapters", "companions", "skills", "tests", "docs"]);
const SCAN_EXT = /\.(mjs|js|json|sh|ps1|bat|md)$/;

function walk(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      walk(join(dir, e.name), out);
    } else if (SCAN_EXT.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

// 规则表：id / 正则 / 归因 / 分类（runtime=真会炸 / data=可随档位过滤 / compat=已兼容）
const RULES = [
  { id: "shell-posix", re: /["'`]\/bin\/(sh|bash)["'`]/, kind: "runtime", why: "win 上无 /bin/sh —— 子进程会 ENOENT" },
  { id: "sudo-use", re: /^\s*sudo\s+[a-z]/, kind: "runtime", why: "win 上无 sudo" },
  { id: "chmod-call", re: /\bchmodSync\s*\(|\bchmod\s+\+x/, kind: "runtime", why: "win 上无 chmod（POSIX 权限位不存在）" },
  { id: "tmp-hard", re: /["'`]\/tmp\//, kind: "runtime", why: "win 无 /tmp；应用 os.tmpdir() 或 %TEMP%" },
  // 只在「引号开头 + 非 ./ 非 /tmp + 有扩展名 + 不带盘符」时报。两个已踩过的坑：
  // ① ESM 说明符 `./a/b.mjs` 由 Node 解析器处理（win32 分支），不是硬编码路径，必须排掉；
  // ② 路径串前后常带别的引号（`join(dir, "lib/x.mjs")`），所以后缀不锚 `["'`]$`，改锚 `["'`]?[,) ]?$`。
  { id: "path-hardsep", re: /["'`](?!\/tmp\/)(?!\.\/)(?!\.\.\/)(?![A-Za-z]:[\\/])[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,5}["'`]?[,) ]?$/, kind: "runtime", why: "字面量里的正斜杠路径，win 上要 path.join" },
  // 真·硬编码 POSIX 绝对路径（不是 /tmp，那个另算）：win 上必然不存在。
  { id: "path-posix-abs", re: /["'`](?!\/tmp\/)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+["'`]/u, kind: "runtime", why: "硬编码 POSIX 绝对路径，win 上不存在" },
  { id: "spawn-shell", re: /spawnSync\(\s*["'`]sh["'`]|execSync\(\s*["'`]sh\b/, kind: "runtime", why: "显式 sh 调用在 win 上不可用" },
  { id: "platform-api", re: /process\.platform/, kind: "compat", why: "已按平台分支，属已兼容面" },
  { id: "crlf-literal", re: /\\r\\n/, kind: "compat", why: "显式 CRLF 处理，属已兼容面" },
  { id: "win-shell-data", re: /powershell\.exe|-ExecutionPolicy|%\w+%|\.cmd\b/, kind: "compat", why: "已含 Windows 写法" },
  { id: "install-ref", re: /install\.(sh|ps1|bat)/, kind: "installer", why: "安装脚本三份并存，是兼容矩阵的维护点" },
];

/** 行级豁免：原因必须写死在这里，不能靠猜。 */
const LINE_EXEMPT = [
  { file: "scripts/verify_win_compat.mjs", rule: "shell-posix", why: "自检脚本本身要断言 posix 外壳字符串" },
  // 垫片的分支表必须同时含两条平台的写法，扫出来的命中就是它的实现本身。
  { file: "data/win-compat.mjs", rule: "shell-posix", why: "垫片的 posix 分支实现" },
  { file: "data/win-compat.mjs", rule: "chmod-call", why: "垫片的命令改写表" },
  // 测试夹具里的 /tmp 常量不参与跨平台执行：它们只在本机 Linux 跑，且已被 --list 记录。
  { file: "scripts/merge_collection.mjs", rule: "tmp-hard", why: "自检夹具常量" },
  { file: "scripts/oneshot_harness.mjs", rule: "tmp-hard", why: "自检夹具常量" },
  { file: "scripts/verify_armor.mjs", rule: "tmp-hard", why: "自检夹具常量" },
  { file: "scripts/patch-host-toolargs.mjs", rule: "tmp-hard", why: "解析器用例的输入字符串" },
  { file: "scripts/score_triad.mjs", rule: "tmp-hard", why: "报告模板里的示例路径" },
];
const exempt = (rel, rule) => LINE_EXEMPT.some((e) => e.file === rel && e.rule === rule);

const INSTALLER_FILES = new Set(["install.sh", "install.ps1", "install.bat", "uninstall.sh", "uninstall.ps1"]);
/** 文件角色：只对 code / installer 计闸门；docs（.md）与 data（命令库）只计数。 */
function scopeOf(rel, text = "") {
  if (INSTALLER_FILES.has(rel)) return "installer";
  if (rel.endsWith(".md")) return "docs";
  if (rel.startsWith("data/")) return "data";
  if (/^(tests|docs|adapters|companions|skills)\//.test(rel)) return "docs";
  return "code";
}

const findings = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split("\\").join("/");
  let body = "";
  try { body = readFileSync(file, "utf8"); } catch { continue; }
  const scope = scopeOf(rel);
  const lines = body.split("\n");
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      if (!rule.re.test(line)) return;
      if (exempt(rel, rule.id)) return;
      findings.push({ rule: rule.id, kind: rule.kind, scope, why: rule.why, file: rel, line: i + 1, text: line.trim().slice(0, 90) });
    });
  }
}

const byKind = (k) => findings.filter((f) => f.kind === k);
const byRule = (id) => findings.filter((f) => f.rule === id);
const byScope = (s) => findings.filter((f) => f.scope === s);
/** 运行时缺陷 = 真会炸的规则 × 会执行的文件角色（docs/data 不计）。 */
const runtimeDefects = byKind("runtime").filter((f) => f.scope === "code" || f.scope === "installer");
const counted = (kind, scope) => findings.filter((f) => f.kind === kind && f.scope === scope).length;

{
  // 闸门 1：核心运行时（index.js / dispatch.mjs / tasks.mjs / stats-store.mjs / client.js
  //  + 本期切片新增的 services/data 模块）不得出现 shell-posix / spawn-shell ——
  //  这两类在 win 上是硬崩，垫片兜不住调用点。
  const CORE = [
    "index.js", "dispatch.mjs", "tasks.mjs", "stats-store.mjs", "client.js",
    "services/stats-service.mjs", "data/stats-api.mjs", "data/scenario-service.mjs",
  ];
  const coreHard = findings.filter((f) => CORE.includes(f.file) && ["shell-posix", "spawn-shell"].includes(f.rule));
  ok(coreHard.length === 0, "核心运行时无硬崩 shell 调用", coreHard.map((f) => `${f.file}:${f.line}`).join(","));

  // 闸门 2：data/ 的命令库是数据不是缺陷 —— 启动命令按档位过滤即可，但必须显式归类。
  ok(counted("runtime", "data") > 0, "命令库平台条目归入数据面", String(counted("runtime", "data")));

  // 闸门 3：scripts/ 的 POSIX 假设封顶 —— 数字是本机实测基线，改动规则或写新脚本都会动它。
  // 上升说明新脚本又硬编码了 POSIX 假设；要么接进垫片，要么在 LINE_EXEMPT 里写明原因。
  //
  // 基线怎么读（2026-04-XX 本机实测，见交付正文四态行）：
  //   path-posix-abs 86 条集中在 scripts/ 的 Linux 专用工具（CA 信任库 / setpriv / /root 路径），
  //     这批脚本在 Windows 上不参与运行 —— 真要让它们跨平台，得先定「哪些脚本是 Windows 交付面」。
  //   path-hardsep 29 + tmp-hard 26 + chmod-call 12 是可直接改的（join/os.tmpdir/try-catch）。
  // 因此闸门按 rule 分档，而不是一个总数盖住两类性质不同的东西。
  const BUDGET = {
    "scripts/|path-posix-abs": 86,
    "scripts/|path-hardsep": 30,
    "scripts/|tmp-hard": 30,
    "scripts/|chmod-call": 13,
    "scripts/|shell-posix": 2,
  };
  for (const [key, cap] of Object.entries(BUDGET)) {
    const [prefix, rule] = key.split("|");
    const n = runtimeDefects.filter((f) => f.file.startsWith(prefix) && f.rule === rule).length;
    ok(n <= cap, `${prefix} ${rule} 未超封顶（≤${cap}）`, String(n));
  }

  // 闸门 4：垫片自身只允许出现「分支表 / 改写表」两类命中（已豁免），其余为零。
  const shimBad = findings.filter((f) => f.file === "data/win-compat.mjs" && f.kind === "runtime"
    && ["shell-posix", "spawn-shell", "chmod-call"].includes(f.rule));
  ok(shimBad.length === 0, "垫片自身无平台缺陷", shimBad.map((f) => `${f.file}:${f.line}`).join(","));

  notes.push(`静态扫描 ${findings.length} 处命中 · 运行时缺陷 ${runtimeDefects.length}（code ${counted("runtime", "code")} + installer ${counted("runtime", "installer")}）· 数据面 ${counted("runtime", "data")} · docs ${counted("runtime", "docs")} · 已兼容面 ${byKind("compat").length} · 安装脚本引用 ${byKind("installer").length}`);
  for (const rule of RULES) {
    const n = byRule(rule.id).length;
    if (n) notes.push(`  ${rule.id.padEnd(14)} ${String(n).padStart(4)} 处 · ${rule.why}`);
  }
}

// ── 报告 ───────────────────────────────────────────────────────────────
const report = {
  version: WIN_COMPAT_VERSION,
  hostPlatform: process.platform,
  checks,
  failed: fails.length,
  matrix,
  scan: {
    root: relative(process.cwd(), ROOT) || ".",
    total: findings.length,
    runtimeDefects: runtimeDefects.length,
    runtimeByScope: {
      code: counted("runtime", "code"),
      installer: counted("runtime", "installer"),
      data: counted("runtime", "data"),
      docs: counted("runtime", "docs"),
    },
    compat: byKind("compat").length,
    installer: byKind("installer").length,
    byRule: Object.fromEntries(RULES.map((r) => [r.id, byRule(r.id).length])),
    top: runtimeDefects.slice(0, 12),
    findings: SHOW_LIST ? findings : undefined,
  },
  notes,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Windows 兼容自检 ${WIN_COMPAT_VERSION}（宿主 ${process.platform}，win32 分支用模拟视图跑）`);
  console.log(`  win32 分支单测：断言 ${checks - fails.length}/${checks} 通过`);
  console.log(`  三平台对照：`);
  for (const r of matrix) {
    console.log(`    ${r.platform.padEnd(7)} ${r.family.padEnd(5)} sep=${JSON.stringify(r.sep ?? "")} npm=${r.npmBin.padEnd(9)} installer=${r.installer.padEnd(11)} eol=${r.eol}`);
  }
  console.log(`  静态扫描：${findings.length} 处命中`);
  for (const line of notes.slice(1).filter((l) => l.startsWith("  "))) console.log(line);
  if (runtimeDefects.length) {
    console.log(`  运行时缺陷 ${runtimeDefects.length} 处（前 12）：`);
    for (const f of runtimeDefects.slice(0, 12)) console.log(`    ${f.rule.padEnd(12)} ${f.file}:${f.line}  ${f.text}`);
  }
  if (SHOW_LIST && findings.length) {
    console.log(`  完整清单：`);
    for (const f of findings) console.log(`    [${f.kind}] ${f.rule} ${f.file}:${f.line}`);
  }
  for (const f of fails) console.log(`  ✗ ${f}`);
  console.log(`断言：${checks - fails.length}/${checks} 通过`);
}
if (fails.length) process.exitCode = 1;
