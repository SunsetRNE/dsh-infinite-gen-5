#!/usr/bin/env node
// 同 uid 凭据可达性门禁（r7-01 处置件）
// 事实：本容器内真 uid 恒为 10527，mode 位拦不住同 uid 的其它进程；
// 本件不假装能修掉这一点，只做两件可验证的事：①把「谁能读到什么」量成基线
// ②基线漂移（原本读不到的凭据变成可读）在门禁里失败。
// 用法： node scripts/cred_reach_gate.mjs --scan [--json]
//        node scripts/cred_reach_gate.mjs --write-baseline FILE
//        node scripts/cred_reach_gate.mjs --check --baseline FILE
//        node scripts/cred_reach_gate.mjs --harden [--apply] [--root DIR]
//        node scripts/cred_reach_gate.mjs --selftest
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DROP_UID = 65534;
export const SECRET_RE = /(\.bridge_token$|\.pem$|\.key$|id_(rsa|ed25519|ecdsa)$|credentials|\.env$|secret|token)/i;

export function candidatePaths(extra = []) {
  const base = [
    "/root/.dsh/.bridge_token",
    "/root/.dsh/plugin-activations.json",
    "/root/.dsh/.credentials.yaml",
    "/root/.local/share/billion-context/ca/root-ca-key.pem",
    "/root/.local/share/billion-context/ca/root-ca.pem",
    "/root/.local/share/billion-context/ca/combined-ca.pem",
    "/root/.ssh/id_ed25519",
    "/root/.ssh/id_rsa",
  ];
  return [...new Set([...base, ...extra])].filter((p) => existsSync(p));
}

export function probeTools() {
  const tryBin = (bin, args) => {
    try { execFileSync(bin, args, { stdio: "ignore" }); return true; } catch { return false; }
  };
  if (tryBin("/usr/bin/setpriv", ["--reuid=" + DROP_UID, "--regid=" + DROP_UID, "--clear-groups", "id"])) {
    return { method: "setpriv", read: (p) => probeRead("/usr/bin/setpriv", ["--reuid=" + DROP_UID, "--regid=" + DROP_UID, "--clear-groups", "cat", p], p) };
  }
  if (tryBin("/usr/bin/su", ["-s", "/bin/sh", "nobody", "-c", "id"])) {
    return { method: "su-nobody", read: (p) => probeRead("/usr/bin/su", ["-s", "/bin/sh", "nobody", "-c", "cat " + JSON.stringify(p)], p) };
  }
  return { method: "static", read: () => null };
}

export function probeRead(bin, args, path) {
  try {
    const out = execFileSync(bin, args, { stdio: ["ignore", "pipe", "ignore"] });
    return out.length > 0 || readFileSync(path).length === 0;
  } catch {
    return false;
  }
}

export function scanFile(path, reader) {
  const st = lstatSync(path);
  const mode = (st.mode & 0o7777).toString(8).padStart(4, "0");
  let sha12 = null;
  try { sha12 = createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12); } catch { sha12 = null; }
  return {
    path,
    mode,
    uidGid: `${st.uid}:${st.gid}`,
    size: st.size,
    sha12,
    class: SECRET_RE.test(path) ? "secret" : "other",
    droppedRead: reader(path),
  };
}

export function scan(paths, reader) {
  return paths.map((p) => scanFile(p, reader));
}

export function checkDrift(baseline, current) {
  const regressions = [];
  const improvements = [];
  const unknown = [];
  const seen = new Set();
  for (const cur of current) {
    seen.add(cur.path);
    const was = baseline.files[cur.path];
    if (cur.droppedRead === null) { unknown.push(cur.path); continue; }
    if (!was) { if (cur.droppedRead && cur.class === "secret") regressions.push({ path: cur.path, why: "新增凭据文件且降权可读" }); continue; }
    if (was.droppedRead === false && cur.droppedRead === true) regressions.push({ path: cur.path, why: "原本被拒，现可读" });
    if (was.droppedRead === true && cur.droppedRead === false) improvements.push({ path: cur.path, why: "原本可读，现被拒" });
  }
  const disappeared = Object.keys(baseline.files).filter((p) => !seen.has(p));
  return { regressions, improvements, unknown, disappeared };
}

export function hardenPlan(roots) {
  const cmds = [];
  for (const root of roots) {
    cmds.push(`chmod 700 ${root}`);
    for (const rel of [".bridge_token", ".credentials.yaml", "plugin-activations.json"]) {
      const p = join(root, rel);
      if (existsSync(p)) cmds.push(`chmod 600 ${p}`);
    }
  }
  return cmds;
}

function selftest() {
  const ok = [];
  const t = mkdtempSync(join(tmpdir(), "crg-"));
  const tools = probeTools();
  ok.push(["降权通道可用（setpriv/su）", tools.method !== "static"]);
  const open = join(t, "open.txt");
  const shut = join(t, "shut.txt");
  writeFileSync(open, "public");
  writeFileSync(shut, "secret");
  chmodSync(open, 0o644);
  chmodSync(shut, 0o000);
  const rOpen = tools.read(open);
  const rShut = tools.read(shut);
  const rMissing = tools.read(join(t, "not-here.txt"));
  ok.push(["阳性对照：644 文件降权可读", rOpen === true]);
  ok.push(["阴性对照：000 文件降权被拒", rShut === false]);
  ok.push(["阴性对照：不存在的路径判为不可读", rMissing === false]);
  const rows = scan([open, shut], tools.read);
  const m0 = (lstatSync(open).mode & 0o7777).toString(8).padStart(4, "0");
  const m1 = (lstatSync(shut).mode & 0o7777).toString(8).padStart(4, "0");
  ok.push(["扫描 mode/class 与 lstat 一致", rows[0].mode === m0 && rows[1].mode === m1 && rows[1].class === "other"]);
  const base = { generatedAt: "t", method: tools.method, files: Object.fromEntries(rows.map((r) => [r.path, r])) };
  ok.push(["无漂移时 check 为空", checkDrift(base, rows).regressions.length === 0]);
  const cur = rows.map((r) => ({ ...r }));
  cur[1] = { ...cur[1], droppedRead: true };
  ok.push(["被拒→可读 记为回归", checkDrift(base, cur).regressions.length === 1]);
  cur[1] = { ...cur[1], droppedRead: null };
  ok.push(["探测不可用记为 unknown", checkDrift(base, cur).unknown.length === 1]);
  ok.push(["新增可读凭据记为回归", (() => {
    const b2 = { files: {} };
    const c2 = [{ path: "/x/.bridge_token", class: "secret", droppedRead: true }];
    return checkDrift(b2, c2).regressions.length === 1;
  })()]);
  ok.push(["harden 计划为幂等 chmod", (() => { const p = hardenPlan([t]); return p[0] === `chmod 700 ${t}`; })()]);
  chmodSync(shut, 0o600);
  rmSync(t, { recursive: true, force: true });
  for (const [name, v] of ok) console.log(`${v ? "ok" : "FAIL"}(${name})`);
  const bad = ok.filter(([, v]) => !v).length;
  console.log(`cred_reach_gate 自检${bad ? "未通过" : "通过"}（共 ${ok.length} 条，通道 ${tools.method}）`);
  return bad ? 1 : 0;
}

const isEntry = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isEntry) {
  const argv = process.argv.slice(2);
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const tools = probeTools();
  const extra = (get("--paths") || "").split(",").filter(Boolean);
  if (argv.includes("--selftest")) process.exit(selftest());
  if (argv.includes("--scan") || argv.includes("--write-baseline") || argv.includes("--check")) {
    const rows = scan(candidatePaths(extra), tools.read);
    const doc = { generatedAt: new Date().toISOString(), method: tools.method, files: Object.fromEntries(rows.map((r) => [r.path, r])) };
    const blPath = get("--baseline") || "docs/redteam/cred-baseline.json";
    if (argv.includes("--write-baseline")) {
      writeFileSync(get("--write-baseline") || blPath, JSON.stringify(doc, null, 2) + "\n");
      console.log(`基线已写入（${rows.length} 件，通道 ${tools.method}）`);
      process.exit(0);
    }
    if (argv.includes("--check")) {
      if (!existsSync(blPath)) { console.log(`CRED_REACH=NO_BASELINE(${blPath})`); process.exit(3); }
      const d = checkDrift(JSON.parse(readFileSync(blPath, "utf8")), rows);
      const verdict = d.regressions.length ? "CRED_REACH=REGRESSION" : "CRED_REACH=NO_DRIFT";
      if (argv.includes("--json")) { console.log(JSON.stringify({ method: tools.method, scanned: rows.length, ...d }, null, 2)); console.error(verdict); }
      else { console.log(JSON.stringify({ method: tools.method, scanned: rows.length, ...d })); console.log(verdict); }
      process.exit(d.regressions.length ? 1 : 0);
    }
    console.log(JSON.stringify(doc, null, argv.includes("--json") ? 2 : 0));
    process.exit(0);
  }
  if (argv.includes("--harden")) {
    const roots = (get("--root") || "/root/.dsh").split(",");
    const cmds = hardenPlan(roots);
    if (argv.includes("--apply")) { for (const c of cmds) execFileSync("/bin/chmod", c.split(" ").slice(1)); console.log("已应用："); }
    console.log(cmds.join("\n"));
    process.exit(0);
  }
  console.log("用法：--scan | --write-baseline FILE | --check [--baseline FILE] | --harden [--apply] | --selftest");
  process.exit(2);
}
