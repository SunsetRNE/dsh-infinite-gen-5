#!/usr/bin/env node
/**
 * supply_audit.mjs — R5 供应链与构建面审计器（零依赖，只用 node 内建模块）
 *
 * 用法：
 *   node supply_audit.mjs                 人读表格
 *   node supply_audit.mjs --json          结构化 JSON（机器可读，落 stdout）
 *   node supply_audit.mjs --selftest      固定断言自证可用；全过 exit 0，任一失败 exit 1
 *   node supply_audit.mjs --selftest --live   自证 + 实跑子进程探测
 *   node supply_audit.mjs --root=/path/to/repo
 *
 * 审计面：依赖 / 生命周期与 scripts / CI-CD / 制品与 SBOM / 发布链
 * 设计约束：任何单点失败都降级为 status=skip|error，不让进程崩；无网可跑（live 探测超时即降级）。
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCHEMA = "ig5.supply_audit/v1";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..", "..", "..");

const argv = process.argv.slice(2);
const wantJson = argv.includes("--json");
const wantSelf = argv.includes("--selftest");
const wantLive = argv.includes("--live") || (!wantSelf && !argv.includes("--no-live"));
const rootArg = argv.find((a) => a.startsWith("--root="));
const ROOT = rootArg ? path.resolve(rootArg.slice("--root=".length)) : DEFAULT_ROOT;

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`用法: node supply_audit.mjs [--json] [--selftest] [--live] [--root=PATH]
  --json      输出结构化 JSON
  --selftest  固定断言自证（离线、确定性）；exit 0=全过 / 1=有断言失败
  --live      允许实跑子进程探测（npm/syft/bump-version）
  --root=PATH 指定仓库根（默认 ${DEFAULT_ROOT}）`);
  process.exit(0);
}

// ---------------------------------------------------------------- 基础工具

function readText(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

function readJson(rel) {
  const t = readText(rel);
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function exists(rel) {
  try {
    fs.statSync(path.join(ROOT, rel));
    return true;
  } catch {
    return false;
  }
}

function lines(rel) {
  const t = readText(rel);
  return t === null ? [] : t.split(/\r?\n/);
}

/** 在 rel 里逐行找正则，返回 [{file,line,text}] —— 行号 1-based，行文本 trim 后截断 */
function grepLines(rel, re) {
  const out = [];
  const ls = lines(rel);
  for (let i = 0; i < ls.length; i++) {
    if (re.test(ls[i])) out.push({ file: rel, line: i + 1, text: ls[i].trim().slice(0, 200) });
  }
  return out;
}

function listFiles(dir, filter) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isFile() && (!filter || filter(d.name)))
    .map((d) => path.posix.join(dir, d.name))
    .sort();
}

/** 跑一条命令：永不抛，返回 {ok, code, stdout, stderr, timedOut} */
function run(cmd, args, { timeout = 60000, cwd = ROOT } = {}) {
  try {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
    if (r.error) return { ok: false, code: null, stdout: "", stderr: String(r.error.message), timedOut: r.error.code === "ETIMEDOUT" };
    return { ok: r.status === 0, code: r.status, stdout: r.stdout || "", stderr: r.stderr || "", timedOut: false };
  } catch (e) {
    return { ok: false, code: null, stdout: "", stderr: String(e && e.message), timedOut: false };
  }
}

const firstLine = (s) => (s || "").split(/\r?\n/).find((l) => l.trim().length > 0) || "";
const truncate = (s, n = 300) => (s.length > n ? s.slice(0, n) + "…" : s);

// ---------------------------------------------------------------- 审计项

const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"];
const NPMRC = [".npmrc", ".yarnrc", ".yarnrc.yml"];
const LIFECYCLE = [
  "preinstall", "install", "postinstall", "prepare",
  "prepublish", "prepublishOnly", "prepack", "postpack", "preuninstall", "dependencies",
];
const DEP_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const NET_SYS_RE = /(curl|wget|https?:\/\/|npm i |npm install|pnpm add|pnpm install|yarn add|git clone|\/etc\/|\/usr\/|\/bin\/|sudo|chmod \+x|rm -rf|setcap)/;
const SHA40 = /@[0-9a-f]{40}$/;
const TAGREF = /@[A-Za-z0-9._-]*v?\d+(\.\d+)*$/;

const checks = [];
function check(id, section, title, fn) {
  checks.push({ id, section, title, fn });
}

// --- 依赖面 ---

check("DEP-01", "依赖面", "package.json 声明的依赖条数（四类合计）", () => {
  const pkg = readJson("package.json");
  if (!pkg) return { status: "error", value: null, detail: "package.json 缺失或不是合法 JSON" };
  const per = {};
  let total = 0;
  for (const s of DEP_SECTIONS) {
    const n = Object.keys(pkg[s] || {}).length;
    per[s] = n;
    total += n;
  }
  return {
    status: total === 0 ? "pass" : "info",
    value: { total, per, name: pkg.name, version: pkg.version },
    detail: `合计 ${total} 条：${DEP_SECTIONS.map((s) => `${s}=${per[s]}`).join(" / ")}`,
  };
});

check("DEP-02", "依赖面", "npm ls --all --json 的实际体量", () => {
  if (!wantLive) return { status: "skip", value: null, detail: "--no-live：跳过子进程" };
  const r = run("npm", ["ls", "--all", "--json"], { timeout: 120000 });
  let n = null;
  try {
    n = Object.keys(JSON.parse(r.stdout).dependencies || {}).length;
  } catch {
    n = null;
  }
  return {
    status: r.ok ? "pass" : "info",
    value: { exitCode: r.code, bytes: Buffer.byteLength(r.stdout), topLevelNodes: n },
    detail: `exit=${r.code} stdout=${Buffer.byteLength(r.stdout)}B 顶层依赖节点=${n} ${truncate(firstLine(r.stderr), 120)}`.trim(),
  };
});

check("DEP-03", "依赖面", "锁文件 / 包管理器配置 / node_modules 在场情况", () => {
  const locks = LOCKFILES.filter(exists);
  const rc = NPMRC.filter(exists);
  const nm = exists("node_modules");
  return {
    status: locks.length === 0 ? "warn" : "pass",
    value: { lockfiles: locks, npmrc: rc, nodeModules: nm },
    detail: `锁文件=${locks.length ? locks.join(",") : "无"} · 包管理器配置=${rc.length ? rc.join(",") : "无"} · node_modules=${nm}`,
  };
});

check("DEP-04", "依赖面", "file: 形态依赖注入点（install.sh）", () => {
  const hits = grepLines("install.sh", /file:/);
  const shape = grepLines("install.sh", /dependencies\[[^\]]*\]\s*=\s*"file:/);
  return {
    status: shape.length ? "warn" : "info",
    value: { fileHits: hits, shapeHits: shape },
    detail: hits.length
      ? hits.map((h) => `${h.file}:${h.line} ${h.text}`).join(" | ")
      : "install.sh 未发现 file: 依赖注入",
  };
});

check("DEP-05", "依赖面", "pnpm 安装链与版本锚定", () => {
  const chain = grepLines("install.sh", /pnpm install|command -v pnpm|npm install -g pnpm/);
  const pin = grepLines("install.sh", /pnpm@\d|pnpm_version|PNPM_VERSION/);
  const s = run("pnpm", ["--version"], { timeout: 20000 });
  return {
    status: pin.length === 0 ? "warn" : "pass",
    value: {
      chainLines: chain.map((h) => `${h.file}:${h.line}`),
      pinnedVersionHits: pin.length,
      localPnpm: s.ok ? s.stdout.trim() : null,
    },
    detail: `链条 ${chain.length} 处（${chain.map((h) => `${h.file}:${h.line}`).join(", ")}）· 版本锚定=${pin.length ? "有" : "无（只查存在性，未锁定版本）"} · 本地 pnpm=${s.ok ? s.stdout.trim() : "不可用"}`,
  };
});

// --- 生命周期与脚本面 ---

check("LIFE-01", "生命周期", "package.json scripts 里的 lifecycle 钩子计数", () => {
  const pkg = readJson("package.json");
  if (!pkg) return { status: "error", value: null, detail: "package.json 缺失" };
  const s = pkg.scripts || {};
  const hit = LIFECYCLE.filter((k) => Object.prototype.hasOwnProperty.call(s, k));
  return {
    status: hit.length ? "warn" : "pass",
    value: { lifecycleCount: hit.length, hits: hit, scriptsTotal: Object.keys(s).length },
    detail: `lifecycle=${hit.length}（${hit.join(",") || "无"}）· scripts 总数=${Object.keys(s).length}`,
  };
});

check("LIFE-02", "生命周期", "scripts 是否含网络下载或写系统路径", () => {
  const pkg = readJson("package.json");
  if (!pkg) return { status: "error", value: null, detail: "package.json 缺失" };
  const hits = [];
  for (const [k, v] of Object.entries(pkg.scripts || {})) if (NET_SYS_RE.test(v)) hits.push({ script: k, cmd: v });
  return {
    status: hits.length ? "warn" : "pass",
    value: { hits, scanned: Object.keys(pkg.scripts || {}).length },
    detail: hits.length ? hits.map((h) => `${h.script} :: ${truncate(h.cmd, 120)}`).join(" | ") : `扫描 ${Object.keys(pkg.scripts || {}).length} 条脚本，零网络/系统路径写入`,
  };
});

// --- CI/CD 面 ---

const WORKFLOWS = () => listFiles(".github/workflows", (n) => /\.ya?ml$/.test(n));

check("CI-01", "CI/CD", "action 引用是 tag 还是 40 位 SHA", () => {
  const out = [];
  for (const wf of WORKFLOWS()) {
    for (const h of grepLines(wf, /^\s*(-\s*)?uses:\s*\S+/)) {
      const m = h.text.match(/uses:\s*(\S+)/);
      const ref = m ? m[1] : "";
      out.push({ file: h.file, line: h.line, uses: ref, shape: SHA40.test(ref) ? "sha40" : TAGREF.test(ref) ? "tag" : ref.startsWith("./") ? "local" : "other" });
    }
  }
  const unsha = out.filter((o) => o.shape === "tag" || o.shape === "other");
  return {
    status: unsha.length ? "warn" : "pass",
    value: out,
    detail: out.length
      ? `${out.length} 处引用：tag=${out.filter((o) => o.shape === "tag").length} · sha40=${out.filter((o) => o.shape === "sha40").length}；` + out.map((o) => `${o.file}:${o.line} ${o.uses}`).join(" | ")
      : "无 uses 引用",
  };
});

check("CI-02", "CI/CD", "workflow 权限块是否显式声明 permissions", () => {
  const out = [];
  for (const wf of WORKFLOWS()) {
    const ls = lines(wf);
    let top = null;
    let job = [];
    for (let i = 0; i < ls.length; i++) {
      const m = ls[i].match(/^(\s*)permissions:\s*(.*)$/);
      if (!m) continue;
      if (m[1].length === 0) top = i + 1;
      else job.push(i + 1);
    }
    const scopeLines = ls.filter((l) => /^\s{2,}\S+:\s*(read|write|none)\s*$/.test(l)).map((l) => l.trim());
    out.push({ file: wf, topLevelPermissionsLine: top, scopes: scopeLines, hasPermissions: top !== null || job.length > 0 });
  }
  const missing = out.filter((o) => !o.hasPermissions);
  return {
    status: missing.length ? "warn" : "pass",
    value: out,
    detail: out.map((o) => `${o.file}: ${o.hasPermissions ? `permissions 在 ${o.topLevelPermissionsLine} 行（${o.scopes.join(",")}）` : "无 permissions 块 → 走仓库默认令牌权限"}`).join(" | "),
  };
});

check("CI-03", "CI/CD", "是否使用 pull_request_target", () => {
  const hits = WORKFLOWS().flatMap((wf) => grepLines(wf, /pull_request_target/));
  const pr = WORKFLOWS().flatMap((wf) => grepLines(wf, /^\s{2}pull_request:/));
  return {
    status: hits.length ? "warn" : "pass",
    value: { pullRequestTarget: hits, plainPullRequest: pr.map((h) => `${h.file}:${h.line}`) },
    detail: hits.length ? hits.map((h) => `${h.file}:${h.line}`).join(" | ") : `未使用 pull_request_target；pull_request 触发器 ${pr.length} 处（${pr.map((h) => `${h.file}:${h.line}`).join(", ") || "无"}）`,
  };
});

check("CI-04", "CI/CD", "workflow 触发条件", () => {
  const out = [];
  for (const wf of WORKFLOWS()) {
    const ls = lines(wf);
    const idx = ls.findIndex((l) => /^on:/.test(l));
    if (idx < 0) {
      out.push({ file: wf, triggers: [] });
      continue;
    }
    const trig = [];
    for (let i = idx + 1; i < ls.length; i++) {
      const l = ls[i];
      if (/^\S/.test(l) && l.trim() !== "") break;
      const m = l.match(/^\s{2}([A-Za-z_]+):/);
      if (m) trig.push({ name: m[1], line: i + 1, inline: l.replace(/^\s+/, "") });
    }
    out.push({ file: wf, triggers: trig });
  }
  return {
    status: "info",
    value: out,
    detail: out.map((o) => `${o.file}: ${o.triggers.map((t) => t.name).join(",") || "?"}`).join(" | "),
  };
});

// --- 制品与 SBOM 面 ---

check("SBOM-01", "制品/SBOM", "syft 在场与版本", () => {
  if (!wantLive) return { status: "skip", value: null, detail: "--no-live：跳过子进程" };
  const r = run("syft", ["version"], { timeout: 30000 });
  if (!r.ok) return { status: "skip", value: { present: false }, detail: `syft 不可用（exit=${r.code}）：${truncate(firstLine(r.stderr), 160)}；装：curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin` };
  const m = r.stdout.match(/Version:\s*(\S+)/);
  return { status: "pass", value: { present: true, version: m ? m[1] : null }, detail: `syft ${m ? m[1] : "?"}（${firstLine(r.stdout)}）` };
});

check("SBOM-02", "制品/SBOM", "syft dir:. 的组件数与许可证分布", () => {
  if (!wantLive) return { status: "skip", value: null, detail: "--no-live：跳过子进程" };
  const out = path.join("/tmp", `ig5-sbom-${process.pid}.json`);
  const r = run("syft", ["dir:.", "-o", `cyclonedx-json=${out}`, "-q"], { timeout: 300000 });
  if (!r.ok || !fs.existsSync(out)) {
    return { status: "skip", value: null, detail: `syft 未产出 SBOM（exit=${r.code}）：${truncate(firstLine(r.stderr), 160)}` };
  }
  let b;
  try {
    b = JSON.parse(fs.readFileSync(out, "utf8"));
  } catch (e) {
    return { status: "error", value: null, detail: `SBOM 解析失败：${e.message}` };
  }
  try { fs.unlinkSync(out); } catch {}
  const comps = b.components || [];
  const lic = {};
  const types = {};
  for (const c of comps) {
    const k = (c.licenses || []).map((l) => l.license?.id || l.license?.name || "?").join("|") || "(未声明)";
    lic[k] = (lic[k] || 0) + 1;
    types[c.type || "?"] = (types[c.type || "?"] || 0) + 1;
  }
  return {
    status: "info",
    value: { specVersion: b.specVersion, components: comps.length, licenseDistribution: lic, typeDistribution: types, names: comps.map((c) => `${c.type}:${c.name}@${c.version || "-"}`) },
    detail: `${comps.length} 个组件 · 类型=${JSON.stringify(types)} · 许可证=${Object.entries(lic).map(([k, v]) => `${k}×${v}`).join(",")}`,
  };
});

check("SBOM-03", "制品/SBOM", "无锁文件下 npm audit 的真实行为", () => {
  if (!wantLive) return { status: "skip", value: null, detail: "--no-live：跳过子进程" };
  const r = run("npm", ["audit", "--json"], { timeout: 90000 });
  return {
    status: "info",
    value: { exitCode: r.code, stderr: truncate(r.stderr, 600), stdoutHead: truncate(r.stdout, 300), timedOut: r.timedOut },
    detail: `exit=${r.code} · stderr[0]=${truncate(firstLine(r.stderr), 200)}`,
  };
});

// --- 发布链 ---

check("REL-01", "发布链", "npm 登录态（npm whoami）", () => {
  if (!wantLive) return { status: "skip", value: null, detail: "--no-live：跳过子进程" };
  const r = run("npm", ["whoami"], { timeout: 30000 });
  return {
    status: "info",
    value: { exitCode: r.code, stdout: truncate(r.stdout.trim(), 120), stderr: truncate(firstLine(r.stderr), 200) },
    detail: r.ok ? `已登录：${r.stdout.trim()}` : `exit=${r.code} 未登录 · ${truncate(firstLine(r.stderr), 160)}`,
  };
});

check("REL-02", "发布链", "bump-version.mjs --dry 的锚点数", () => {
  if (!wantLive) return { status: "skip", value: null, detail: "--no-live：跳过子进程" };
  const targets = readText("scripts/version-targets.mjs");
  const declared = targets ? (targets.match(/file:/g) || []).length : null;
  const pkg = readJson("package.json");
  const ver = pkg && pkg.version;
  if (!ver) return { status: "error", value: null, detail: "读不到当前版本号，无法构造 dry-run 目标版本" };
  const next = ver.replace(/^(\d+)\.(\d+)\.(\d+)$/, (_m, a, b, c) => `${a}.${b}.${Number(c) + 1}`);
  const r = run("node", ["scripts/bump-version.mjs", next, "--dry"], { timeout: 60000 });
  const okLines = (r.stdout.match(/\[OK\]/g) || []).length;
  return {
    status: r.ok ? "pass" : "error",
    value: { exitCode: r.code, anchorDeclaredEntries: declared, anchorReportedLines: okLines, dryTarget: next, stdoutHead: truncate(r.stdout, 400) },
    detail: `dry ${ver}→${next}：声明锚点 ${declared} 条 / 实报 ${okLines} 行 · exit=${r.code}`,
  };
});

check("REL-03", "发布链", "发布 workflow 的触发条件", () => {
  const rel = ".github/workflows/release.yml";
  if (!exists(rel)) return { status: "error", value: null, detail: `${rel} 不存在` };
  const tagTrigger = grepLines(rel, /^\s{4}tags:/);
  const dispatch = grepLines(rel, /workflow_dispatch:/);
  const publish = grepLines(rel, /gh release (create|upload)/);
  return {
    status: tagTrigger.length ? "info" : "warn",
    value: {
      tagTrigger: tagTrigger.map((h) => `${h.file}:${h.line} ${h.text}`),
      workflowDispatch: dispatch.map((h) => `${h.file}:${h.line}`),
      publishSteps: publish.map((h) => `${h.file}:${h.line}`),
    },
    detail: `tag 触发=${tagTrigger.map((h) => `${h.file}:${h.line} ${h.text}`).join(",") || "无"} · 手动=${dispatch.length ? `是（${dispatch.map((h) => `${h.file}:${h.line}`).join(",")}）` : "否"} · 发布动作=${publish.length} 处`,
  };
});

// ---------------------------------------------------------------- 执行

function runChecks() {
  const results = [];
  for (const c of checks) {
    let r;
    try {
      r = c.fn();
    } catch (e) {
      r = { status: "error", value: null, detail: `审计项抛错：${e && e.message}` };
    }
    results.push({ id: c.id, section: c.section, title: c.title, ...r });
  }
  return results;
}

function summarize(results) {
  const by = (s) => results.filter((r) => r.status === s).length;
  return {
    total: results.length,
    pass: by("pass"),
    info: by("info"),
    warn: by("warn"),
    skip: by("skip"),
    error: by("error"),
    hardFindings: results.filter((r) => r.status === "warn").map((r) => r.id),
    skipped: results.filter((r) => r.status === "skip").map((r) => r.id),
  };
}

// ---------------------------------------------------------------- 自证

/** 固定断言：文件存在性 + 正则命中 + 计数一致性。全过才 exit 0。 */
function selftest(results) {
  const as = [];
  const A = (id, desc, ok, got) => as.push({ id, desc, ok: !!ok, got: got === undefined ? null : got });

  const pkg = readJson("package.json");
  A("ST-01", "package.json 存在且可解析，含 name/version", pkg && pkg.name && pkg.version, pkg ? `${pkg.name}@${pkg.version}` : null);

  const depTotal = pkg ? DEP_SECTIONS.reduce((n, s) => n + Object.keys(pkg[s] || {}).length, 0) : -1;
  A("ST-02", "四类依赖声明合计为 0（与 npm ls 空树一致）", depTotal === 0, `total=${depTotal}`);

  A("ST-03", "无任何锁文件在场", LOCKFILES.every((f) => !exists(f)), LOCKFILES.filter(exists).join(",") || "none");
  A("ST-04", "scripts 中 lifecycle 钩子计数为 0", pkg && LIFECYCLE.filter((k) => k in (pkg.scripts || {})).length === 0, pkg ? `${LIFECYCLE.filter((k) => k in (pkg.scripts || {})).length}` : null);

  const wfs = WORKFLOWS();
  A("ST-05", ".github/workflows 下至少 2 个 yml", wfs.length >= 2, wfs.join(","));
  A("ST-06", "release.yml 存在且 tag 触发形如 v*", exists(".github/workflows/release.yml") && /tags:\s*\[".*v\*.*"\]|tags:\s*\n\s*-\s*"?v\*/.test(readText(".github/workflows/release.yml") || ""), null);

  const refs = wfs.flatMap((wf) => grepLines(wf, /^\s*(-\s*)?uses:\s*\S+/).map((h) => (h.text.match(/uses:\s*(\S+)/) || [])[1]).filter(Boolean));
  const noneSha = refs.length > 0 && refs.every((r) => !SHA40.test(r) && TAGREF.test(r));
  A("ST-07", "全部 uses 引用为 tag/版本形态（无 40 位 SHA 固定）", noneSha, refs.join(",") || "no-refs");

  const verifyTxt = readText(".github/workflows/verify.yml") || "";
  const releaseTxt = readText(".github/workflows/release.yml") || "";
  A("ST-08", "verify.yml 无 permissions 块，release.yml 有 contents 权限", !/^permissions:/m.test(verifyTxt) && /^permissions:/m.test(releaseTxt), null);
  A("ST-09", "全库无 pull_request_target", wfs.every((wf) => !/pull_request_target/.test(readText(wf) || "")), null);

  const inj = grepLines("install.sh", /dependencies\[[^\]]*\]\s*=\s*"file:/);
  A("ST-10", "install.sh 存在 file: 形态依赖注入点且能定位行号", inj.length === 1 && inj[0].line > 0, inj.map((h) => `${h.file}:${h.line}`).join(",") || "0-hit");

  A("ST-11", "审计项数量与结果数量一致（无静默丢项）", results.length === checks.length, `${results.length}/${checks.length}`);
  A("ST-12", "每条结果都带 id/section/status/detail 四字段", results.every((r) => r.id && r.section && r.status && typeof r.detail === "string"), null);

  let round = false;
  try {
    const j = JSON.parse(JSON.stringify({ schema: SCHEMA, checks: results }));
    round = j.checks.length === results.length;
  } catch { round = false; }
  A("ST-13", "结果可 JSON 往返且条数不变（--json 契约）", round, null);

  const ids = results.map((r) => r.id);
  A("ST-14", "审计项 id 唯一", new Set(ids).size === ids.length, `${new Set(ids).size}/${ids.length}`);

  return as;
}

// ---------------------------------------------------------------- 输出

const results = runChecks();

if (wantSelf) {
  const as = selftest(results);
  if (wantJson) {
    console.log(JSON.stringify({ schema: SCHEMA, mode: "selftest", root: ROOT, assertions: as, passed: as.filter((a) => a.ok).length, failed: as.filter((a) => !a.ok).length }, null, 2));
  } else {
    console.log(`# supply_audit selftest · root=${ROOT}`);
    for (const a of as) console.log(`  ${a.ok ? "PASS" : "FAIL"}  ${a.id}  ${a.desc}${a.got !== null ? `   [${a.got}]` : ""}`);
    const bad = as.filter((a) => !a.ok);
    console.log(`\n判据：selftest ${as.length - bad.length}/${as.length} 断言通过${bad.length ? ` · 失败：${bad.map((a) => a.id).join(",")}` : " · 全部通过"}`);
  }
  process.exit(as.every((a) => a.ok) ? 0 : 1);
}

if (wantJson) {
  console.log(JSON.stringify({
    schema: SCHEMA,
    root: ROOT,
    live: wantLive,
    generatedAt: new Date().toISOString(),
    toolchain: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      kernel: run("uname", ["-r"], { timeout: 5000 }).stdout.trim() || null,
    },
    summary: summarize(results),
    checks: results,
  }, null, 2));
} else {
  console.log(`# 供应链与构建面审计 · root=${ROOT} · live=${wantLive}`);
  let lastSection = "";
  for (const r of results) {
    if (r.section !== lastSection) {
      console.log(`\n## ${r.section}`);
      lastSection = r.section;
    }
    console.log(`  [${r.status.toUpperCase().padEnd(5)}] ${r.id}  ${r.title}`);
    console.log(`          ${r.detail}`);
  }
  const s = summarize(results);
  console.log(`\n判据：共 ${s.total} 项 · pass=${s.pass} info=${s.info} warn=${s.warn} skip=${s.skip} error=${s.error}${s.hardFindings.length ? ` · 需处置：${s.hardFindings.join(",")}` : ""}`);
}
