// 无限五代 · 运行环境探测离线自检（无依赖、不做任何出网请求）
// 检查：纯函数解析（os-release/proc-limits/能力位/工具名抽取）/
//       领域就绪度与「缺什么怎么装」/ 包管理器建议 / 报告结构契约 /
//       只读与隐私边界（扫源码，禁止写操作与凭据路径）/ 超时保证 /
//       本地 TCP 探测行为（127.0.0.1，不出网）/ CLI 参数与退出码 / 性能预算
// 用法：node scripts/verify_env.mjs [--json]
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { execFile } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE_PATH = join(ROOT, "data", "probe.mjs");
const CLI_PATH = join(ROOT, "scripts", "probe-env.mjs");
const INDEX_PATH = join(ROOT, "index.js");
const KERNEL_PATH = join(ROOT, "prompts", "infinite-gen-5.md");
const MIRROR_PATHS = [
  join(ROOT, "prompts", "infinite-gen-5.1-flash.md"),
  join(ROOT, "prompts", "infinite-gen-5-classic.md"),
];

// 预算：本机（Android/arm64 容器）实测「不查版本 + 不出网」0.35 s。
// 上限故意放得很宽 —— 只用来抓「又退回逐条 command -v 的百毫秒级抖动」这类回归。
const OFFLINE_BUDGET_MS = 6000;

const passes = [];
const failures = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

for (const path of [PROBE_PATH, CLI_PATH, INDEX_PATH, KERNEL_PATH]) {
  check(existsSync(path), `文件存在：${path.replace(`${ROOT}/`, "")}`);
}
if (!existsSync(PROBE_PATH)) {
  console.log("❌ 缺少 data/probe.mjs");
  process.exit(1);
}

const probe = await import(PROBE_PATH);
const probeSrc = readFileSync(PROBE_PATH, "utf8");
const cliSrc = readFileSync(CLI_PATH, "utf8");
const indexSrc = readFileSync(INDEX_PATH, "utf8");
const kernel = readFileSync(KERNEL_PATH, "utf8");

// 边界扫描要看**代码**，不是注释：头注释里正大光明地写着「不读 ~/.ssh、不跑 apt install」，
// 那是对边界的说明，不是违规。剥掉 // 与 /* */ 之后再扫。
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}
const probeCode = codeOnly(probeSrc);
const cliCode = codeOnly(cliSrc);
const indexCode = codeOnly(indexSrc);

// ───────────────── 1. 导出面与契约常量 ─────────────────
check(probe.ENV_SCHEMA === "infinite-gen5/env-probe@1", "schema 常量稳定（infinite-gen5/env-probe@1）", String(probe.ENV_SCHEMA));
check(probe.PROBE_VERSION === 1, "探测版本号是数字", String(probe.PROBE_VERSION));
for (const name of ["probeEnv", "renderEnvSummary", "domainReadiness", "binsOfToolLine",
  "parseKeyValueFile", "parseProcStatus", "parseLimitBytes", "packageManagerAdvice",
  "tcpProbe", "inspectBins", "probeShape", "probeResources", "probeNetwork", "probeStock", "probeCapabilities"]) {
  check(typeof probe[name] === "function", `导出函数：${name}`);
}
check(Array.isArray(probe.RUNTIME_BINS) && probe.RUNTIME_BINS.length >= 20, `运行时清单 ≥20 项（实得 ${probe.RUNTIME_BINS?.length}）`);
check(Array.isArray(probe.COMMON_BINS) && probe.COMMON_BINS.length >= 30, `常用工具清单 ≥30 项（实得 ${probe.COMMON_BINS?.length}）`);
check(Object.keys(probe.PACKAGE_MANAGERS).length >= 8, `包管理器 ≥8 种（实得 ${Object.keys(probe.PACKAGE_MANAGERS).length}）`);
check(probe.NET_TARGETS.length >= 4, `出网目标 ≥4 个（实得 ${probe.NET_TARGETS.length}）`);

// ───────────────── 2. 纯函数：os-release 解析 ─────────────────
const osr = probe.parseKeyValueFile([
  '# comment',
  'NAME="Ubuntu"',
  "ID=ubuntu",
  "VERSION_ID='24.04'",
  "EMPTY=",
  "BAD_LINE",
].join("\n"));
check(osr?.NAME === "Ubuntu" && osr?.ID === "ubuntu", "os-release：去引号、留原值", JSON.stringify(osr));
check(osr?.VERSION_ID === "24.04", "os-release：单引号也去", osr?.VERSION_ID);
check(probe.parseKeyValueFile("no equals here") === null, "os-release：无有效键值时返回 null");
check(probe.parseKeyValueFile(null) === null, "os-release：非字符串返回 null");

// ───────────────── 3. 纯函数：/proc 与限额 ─────────────────
const status = probe.parseProcStatus("Name:\tnode\nCapEff:\t0000000000000000\nSeccomp:\t2\nNoNewPrivs:\t0\n");
check(status?.CapEff === "0000000000000000", "proc status：CapEff 取值", status?.CapEff);
check(status?.Seccomp === "2", "proc status：Seccomp 取值", status?.Seccomp);
check(probe.parseProcStatus("garbage") !== null, "proc status：无冒号行不崩");

check(probe.parseLimitBytes("max") === null, "cgroup：max 视为无限");
check(probe.parseLimitBytes("9223372036854771712") === null, "cgroup：近 2^63 视为无限");
check(probe.parseLimitBytes("1073741824") === 1073741824, "cgroup：正常字节数解析");
check(probe.parseLimitBytes("abc") === null, "cgroup：非数字返回 null");
check(probe.parseLimitBytes(null) === null, "cgroup：null 返回 null");

// ───────────────── 4. 工具名抽取 ─────────────────
const b1 = probe.binsOfToolLine("Detect It Easy (diec) — PE 壳识别 | 装: 官方 release | 验: diec -h");
check(b1[0] === "diec", "工具名：括号内的命令名优先（Detect It Easy (diec) → diec）", JSON.stringify(b1));
const b2 = probe.binsOfToolLine("binutils（readelf/objdump/strings/nm） — ELF 分析 | 装: apt install binutils");
for (const bin of ["readelf", "objdump", "strings", "nm"]) {
  check(b2.includes(bin), `工具名：括号内斜杠拆分含 ${bin}`, JSON.stringify(b2));
}
const b3 = probe.binsOfToolLine("rizin + Cutter / radare2 — 反汇编与调试 | 装: apt install rizin");
check(b3.includes("rizin") && b3.includes("radare2"), "工具名：加号与斜杠都拆", JSON.stringify(b3));
check(probe.binsOfToolLine("顺序：元数据 → 通道 → 频谱；每步留证据").length === 0, "工具名：注意事项行不产出命令名");
check(probe.binsOfToolLine("").length === 0, "工具名：空行返回空数组");

// ───────────────── 5. 领域就绪度与安装提示 ─────────────────
const fakeStock = [
  { bin: "ffuf", ok: true, path: "/usr/bin/ffuf", version: "ffuf 2.1" },
  { bin: "jq", ok: true, path: "/usr/bin/jq", version: "jq-1.7" },
  { bin: "curl", ok: true, path: "/usr/bin/curl", version: "curl 8" },
];
const readiness = probe.domainReadiness(fakeStock);
check(readiness.length >= 30, `就绪度覆盖全部领域（实得 ${readiness.length}）`);
const web = readiness.find((row) => row.id === "web");
check(!!web && web.ready >= 2, "web 域：装了的工具被算进就绪（ffuf/jq）", JSON.stringify(web));
check(!!web && web.ratio > 0 && web.ratio <= 1, "web 域：ratio 落在 (0,1]");
check(!!web && Array.isArray(web.missing) && web.missing.length > 0, "web 域：缺件清单非空");
check(!!web && web.missing.every((bin) => /^[a-z][a-z0-9._+-]*$/.test(bin)), "web 域：缺件优先报小写真命令名", JSON.stringify(web?.missing));
const withInstall = readiness.find((row) => row.install?.some((item) => item.install));
check(!!withInstall, "就绪度带「缺的那个怎么装」的安装命令");
check(
  !!withInstall && withInstall.install.every((item) => item.install === null || typeof item.install === "string"),
  "安装命令字段是字符串或 null",
);
const sorted = readiness.every((row, i) => i === 0 || readiness[i - 1].ratio >= row.ratio);
check(sorted, "就绪度按 ratio 降序（最缺的排后面）");
const empty = probe.domainReadiness([]);
check(empty.every((row) => row.ready === 0), "空库存：所有域 ready 为 0");
check(empty.length === readiness.length, "空库存不改变领域数量");

// ───────────────── 6. 包管理器建议 ─────────────────
const advice = (id, managers) => probe.packageManagerAdvice({ platform: "linux", distro: { ID: id } }, managers);
const aptManagers = { apt: { ok: true, bin: "apt-get" } };
check(advice("ubuntu", aptManagers).command === "apt-get install -y", "建议：Ubuntu → apt-get install -y");
check(advice("debian", aptManagers).note.includes("apt-get update"), "建议：Debian 系提醒先 update");
check(advice("alpine", { apk: { ok: true, bin: "apk" } }).command === "apk add --no-cache", "建议：Alpine → apk add");
check(advice("fedora", { dnf: { ok: true, bin: "dnf" } }).command === "dnf install -y", "建议：Fedora → dnf");
check(advice("arch", { pacman: { ok: true, bin: "pacman" } }).command.startsWith("pacman"), "建议：Arch → pacman");
check(advice("unknown", aptManagers).command === "apt-get install -y", "建议：发行版未知但有 apt 时按 apt 给");
check(advice("unknown", {}).command === null, "建议：没有包管理器时给 null 而不是硬编一条");
check(probe.packageManagerAdvice({ platform: "darwin" }, {}).command === "brew install", "建议：macOS → brew");
check(probe.packageManagerAdvice({ platform: "win32" }, {}).command === "winget install", "建议：Windows → winget");

// ───────────────── 7. 摘要渲染（纯函数，喂合成报告） ─────────────────
const synthetic = {
  shape: { platform: "linux", arch: "x64", release: "6.1", node: "v22.0.0", container: "/.dockerenv",
    distro: { PRETTY_NAME: "Debian 12" }, identity: { uid: 0, root: true } },
  resources: { cpuCount: 4, totalMemBytes: 8 * 2 ** 30, freeMemBytes: 2 ** 30, disk: { freeBytes: 40 * 2 ** 30 },
    ulimits: { openFiles: "1024" } },
  network: { enabled: true, verdict: "offline", targets: [{ id: "npm", ok: false }], proxies: { HTTPS_PROXY: "http://x" } },
  stock: { managers: { apt: { ok: true }, dpkg: { ok: true } }, runtimes: [{ bin: "node", ok: true }],
    common: [{ bin: "curl", ok: true }, { bin: "jq", ok: false }], writable: { tmp: true, cwd: true } },
  capabilities: { capEff: "0000000000000000", seccomp: "2", ptraceLikely: "restricted", decoded: {} },
  device: { bridgeToken: true, endpoints: { device: { ok: true } }, adbShell: "/usr/bin/adb-shell" },
  domains: [{ id: "web", total: 7, ready: 2, ratio: 0.29, missing: ["ffuf"], install: [{ bin: "ffuf", install: "apt install ffuf" }] }],
  advice: { command: "apt-get install -y", note: "Debian 系" },
  notes: ["测试备注"],
};
const summary = probe.renderEnvSummary(synthetic);
check(typeof summary === "string" && summary.length > 100, "摘要：非空字符串");
for (const token of ["容器", "Debian 12", "uid=0(root)", "offline", "apt", "capEff", "领域就绪", "apt-get install -y", "测试备注"]) {
  check(summary.includes(token), `摘要：含「${token}」`);
}
check(probe.renderEnvSummary({}).length > 0, "摘要：空报告也不崩");
check(probe.renderEnvSummary({ network: { enabled: false } }).includes("跳过"), "摘要：net=false 时明确说明跳过");

// ───────────────── 8. 只读与隐私边界（扫源码） ─────────────────
const writeOps = ["writeFileSync", "unlinkSync", "rmSync", "rmdirSync", "chmodSync", "chownSync",
  "mkdirSync", "appendFileSync", "truncateSync", "renameSync", "symlinkSync", "execSync"];
for (const op of writeOps) {
  check(!probeCode.includes(op), `只读：引擎里不出现 ${op}`);
}
// 引擎会给「怎么装」的建议文本（apt-get install …），但**不得自己去装**：
// 所有子进程调用必须是 command -v / where / --version 这三类。
check(!/execFile\(\s*"(apt|apt-get|apk|dnf|yum|pacman|zypper|brew|npm|pnpm|pip3?|go|winget|choco|scoop)/.test(probeCode),
  "只读：不把包管理器/安装器交给 execFile");
check(!/run\(\s*"(apt|apt-get|apk|dnf|yum|pacman|zypper|brew|npm|pip3?|go|winget)/.test(probeCode),
  "只读：不把安装命令交给 run()");
check(probeCode.includes('command -v'), "只读：定位工具走 command -v");
const sensitive = [".ssh", ".aws", ".gnupg", "id_rsa", "credentials", ".netrc", "keychain", ".docker/config"];
for (const path of sensitive) {
  check(!probeCode.includes(path) && !cliCode.includes(path), `隐私：代码不引用 ${path}`);
}
check(probeSrc.includes("timeout: timeoutMs"), "超时：execFile 带 timeout");
check(probeSrc.includes("socket.setTimeout"), "超时：TCP 探测带超时");
check(probeSrc.includes("AbortSignal.timeout"), "超时：设备接口探测带超时");
check(probeSrc.includes("net: false") || probeSrc.includes("options.net === false"), "net=false 时确实短路");
check(/import \{ createConnection \} from "node:net"/.test(probeSrc), "网络：只有 node:net，没有外部 HTTP 客户端");

// ───────────────── 9. 本地 TCP 探测行为（127.0.0.1，不出网） ─────────────────
const closed = await probe.tcpProbe("127.0.0.1", 9, 400);
check(closed.ok === false, "TCP：未监听端口判为不可达", JSON.stringify(closed));
check(typeof closed.ms === "number" && closed.ms < 2000, "TCP：不可达也在超时预算内返回", `${closed.ms} ms`);
const server = createServer(() => {});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const open = await probe.tcpProbe("127.0.0.1", port, 800);
check(open.ok === true, "TCP：监听中的端口判为可达", JSON.stringify(open));
await new Promise((resolve) => server.close(resolve));

// ───────────────── 10. 报告结构契约 ─────────────────
const offline = await probe.probeEnv({
  layers: ["shape", "resources", "stock", "capabilities", "domains"],
  versions: false,
  net: false,
});
check(offline.schema === probe.ENV_SCHEMA, "报告：schema 一致");
check(offline.probeVersion === probe.PROBE_VERSION, "报告：probeVersion 一致");
check(typeof offline.tookMs === "number" && offline.tookMs >= 0, "报告：tookMs 是数字");
check(typeof offline.at === "string" && !Number.isNaN(Date.parse(offline.at)), "报告：at 是 ISO 时间");
check(typeof offline.shape?.platform === "string", "报告：shape.platform 是字符串");
check(typeof offline.shape?.identity?.uid === "number", "报告：shape.identity.uid 是数字");
check(Array.isArray(offline.notes), "报告：notes 是数组");
check(typeof offline.summary === "string" && offline.summary.length > 20, "报告：summary 非空");
check(offline.resources === null || typeof offline.resources?.cpuCount === "number", "报告：resources 结构");
check(Array.isArray(offline.domains) && offline.domains.length >= 30, `报告：domains 覆盖全部领域（实得 ${offline.domains?.length}）`);
check(offline.network === null, "报告：未选 network 层时不产出该段");
const noStock = await probe.probeEnv({ layers: ["shape", "domains"], versions: false, net: false });
check(noStock.stock === null && noStock.domains === null, "报告：domains 依赖 stock，缺依赖时如实为空");
check(noStock.notes.some((note) => note.includes("依赖 stock")), "报告：缺依赖时留下可读备注", JSON.stringify(noStock.notes.slice(-2)));
check(Array.isArray(offline.toolProtocol) && offline.toolProtocol.length >= 5, "报告：带工具链协议");
check(offline.tookMs < OFFLINE_BUDGET_MS, `性能：离线四层在预算内（实得 ${offline.tookMs} ms < ${OFFLINE_BUDGET_MS} ms）`);

const shapeOnly = await probe.probeEnv({ layers: ["shape"], versions: false, net: false });
check(shapeOnly.shape !== null && shapeOnly.resources === null && shapeOnly.domains === null, "报告：单层只产出该层");
const shapeOnlyMs = shapeOnly.tookMs;
check(shapeOnlyMs <= offline.tookMs + 50, "性能：单层不比四层慢", `${shapeOnlyMs} ms vs ${offline.tookMs} ms`);

// ───────────────── 11. CLI 参数与退出码 ─────────────────
function runCli(args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI_PATH, ...args], { timeout, maxBuffer: 8 << 20 }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}
const badLayer = await runCli(["--layers", "nope"]);
check(badLayer.code === 2, "CLI：未知层退出码 2", `code=${badLayer.code}`);
check(badLayer.stderr.includes("未知层"), "CLI：未知层给出可读错误", badLayer.stderr.trim().slice(0, 80));
const badTimeout = await runCli(["--timeout", "abc"]);
check(badTimeout.code === 2, "CLI：非数字 timeout 退出码 2", `code=${badTimeout.code}`);
const badArg = await runCli(["--nope"]);
check(badArg.code === 2, "CLI：未知参数退出码 2", `code=${badArg.code}`);
const help = await runCli(["--help"]);
check(help.code === 0 && help.stdout.includes("probe-env.mjs"), "CLI：--help 退出码 0 且给出用法");

const cliRun = await runCli(["--json", "--fast", "--no-net", "--domains"]);
check(cliRun.code === 0, "CLI：--json --fast --no-net 退出码 0", `code=${cliRun.code}`);
let parsed = null;
try { parsed = JSON.parse(cliRun.stdout); } catch { /* 留给下面的断言报错 */ }
check(!!parsed && parsed.schema === probe.ENV_SCHEMA, "CLI：--json 输出可解析且 schema 正确");
check(!!parsed && Array.isArray(parsed.domains) && parsed.domains.length >= 30, "CLI：--domains 附带领域明细");
check(!!parsed && parsed.network?.enabled === false, "CLI：--no-net 真的关闭网络层");

const tmp = mkdtempSync(join(tmpdir(), "gen5-env-verify-"));
const outPath = join(tmp, "env.json");
const cliOut = await runCli(["--fast", "--no-net", "--layers", "shape,resources", "--out", outPath]);
check(cliOut.code === 0, "CLI：--out 退出码 0", `code=${cliOut.code}`);
check(existsSync(outPath), "CLI：--out 写出了报告文件");
let written = null;
try { written = JSON.parse(readFileSync(outPath, "utf8")); } catch { /* 断言会报 */ }
check(!!written && written.schema === probe.ENV_SCHEMA, "CLI：写出的文件是合法报告");
check(!!written && written.network === null, "CLI：--layers 真的裁剪了层");
rmSync(tmp, { recursive: true, force: true });

// ───────────────── 12. 工具与内核接线 ─────────────────
check(indexSrc.includes('name: "infinite_gen5_env"'), "接线：index.js 定义 infinite_gen5_env 工具");
check(indexSrc.includes("ctx.tools.register(envTool)"), "接线：infinite_gen5_env 被注册");
check(/async execute\(args\)/.test(indexSrc), "接线：环境工具 execute 是 async（探测本身是异步的）");
check(!indexCode.includes("deferLoading: true"),
  "接线：刻意不使用 deferLoading（v0.6.0 实测会导致工具在模型工具表里不可见）");
check(indexCode.includes("ctx.tools.register(envTool)") && indexCode.includes("ctx.tools.register(scenarioTool)"),
  "接线：环境工具与领域工具都注册");
check(indexSrc.includes('from "./data/probe.mjs"'), "接线：index.js 从 data/probe.mjs 导入");
check(kernel.includes("infinite_gen5_env"), "内核：载荷点名 infinite_gen5_env");
check(/Environment rule/.test(kernel), "内核：载荷有 Environment rule 一节");
check(kernel.includes("read-only"), "内核：说明探测是只读的");
for (const path of MIRROR_PATHS) {
  check(existsSync(path) && readFileSync(path, "utf8") === kernel,
    `内核：三份载荷逐字同源（${path.split("/").pop()}）`);
}
check(readFileSync(join(ROOT, "package.json"), "utf8").includes("ENV_PROBE.md"), "打包：package.json 的 files 含 ENV_PROBE.md");

// ───────────────── 汇总 ─────────────────
const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify({ pass: passes.length, fail: failures.length, failures }, null, 2));
} else {
  for (const p of passes) console.log(`  ✅ ${p}`);
  for (const f of failures) console.log(`  ❌ ${f}`);
  console.log(`\n结果: ${passes.length} 通过, ${failures.length} 失败`);
  const reportBytes = Buffer.byteLength(JSON.stringify(offline), "utf8");
  console.log(
    `离线四层 ${offline.tookMs} ms · 报告 ${reportBytes} B · 领域 ${offline.domains?.length} 个 · ` +
      `运行时 ${probe.RUNTIME_BINS.length} / 常用工具 ${probe.COMMON_BINS.length} / 包管理器 ${Object.keys(probe.PACKAGE_MANAGERS).length} 项待查`,
  );
}
process.exit(failures.length === 0 ? 0 : 1);
