#!/usr/bin/env node
// MITM 根 CA 私钥守卫（r2-01 处置件）
// 事实：容器内真 uid 恒为同一 Android uid，0600 挡不住同 uid 的进程（见 cred_reach_gate）；
// 本件做的是「收窄 + 可轮换」而不是假装隔离：检查配对/信任落点、给出加密与轮换的可执行路径。
// 用法： node scripts/ca_key_guard.mjs --check [--dir DIR] [--json]
//        node scripts/ca_key_guard.mjs --lock [--apply] [--dir DIR]
//        node scripts/ca_key_guard.mjs --rotate [--apply] [--dir DIR] [--cn NAME]
//        node scripts/ca_key_guard.mjs --selftest
// 说明：--lock --apply 需要 IG5_CA_PASSPHRASE；--rotate --apply 需要 IG5_CA_ROTATE=yes。
//       轮换只写 staging 目录，绝不就地覆盖在用 CA（覆盖会让所有已签发叶证书失配）。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_DIR = "/root/.local/share/billion-context/ca";
export const DROP_UID = 65534;

export function sha12(path) {
  try { return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12); } catch { return null; }
}

export function modeOf(path) {
  return (lstatSync(path).mode & 0o7777).toString(8).padStart(4, "0");
}

export function runOpenSSL(args, input) {
  return execFileSync("openssl", args, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"], input }).toString();
}

// 只比较材料指纹，不打印密钥内容
export function pairMatch(keyPath, certPath) {
  try {
    const k = createHash("sha256").update(runOpenSSL(["rsa", "-in", keyPath, "-noout", "-modulus"])).digest("hex").slice(0, 16);
    const c = createHash("sha256").update(runOpenSSL(["x509", "-in", certPath, "-noout", "-modulus"])).digest("hex").slice(0, 16);
    return { match: k === c, keyHash: k, certHash: c };
  } catch (e) {
    return { match: false, error: String(e.message || e).split("\n")[0] };
  }
}

export function certInfo(certPath) {
  try {
    const out = runOpenSSL(["x509", "-in", certPath, "-noout", "-subject", "-issuer", "-dates", "-fingerprint", "-sha256"]);
    const pick = (re) => (re.exec(out) || [])[1] || null;
    return {
      subject: pick(/subject=(.+)/),
      issuer: pick(/issuer=(.+)/),
      notBefore: pick(/notBefore=(.+)/),
      notAfter: pick(/notAfter=(.+)/),
      fingerprint: pick(/Fingerprint=([0-9A-F:]+)/),
    };
  } catch (e) {
    return { error: String(e.message || e).split("\n")[0] };
  }
}

export function droppedReadable(path, uid = DROP_UID) {
  try {
    execFileSync("/usr/bin/setpriv", ["--reuid=" + uid, "--regid=" + uid, "--clear-groups", "cat", path], { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch { return false; }
}

export function trustPlacement({ systemBundle = "/etc/ssl/certs/ca-certificates.crt", customDir = "/usr/local/share/ca-certificates", marker = "billion-context" } = {}) {
  const placed = [];
  let systemMatches = null;
  if (existsSync(systemBundle)) {
    try { systemMatches = Number(execFileSync("/bin/grep", ["-c", marker, systemBundle], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()); }
    catch { systemMatches = 0; }
  }
  placed.push({ where: systemBundle, matches: systemMatches, note: `按 CN 文本「${marker}」计数；>0 表示已进入系统信任库` });
  const custom = existsSync(customDir) ? Number(execFileSync("/bin/ls", ["-1", customDir]).toString().trim().split("\n").filter(Boolean).length) : 0;
  placed.push({ where: customDir, matches: custom, note: "自定义 CA 落点条数" });
  return placed;
}

export function envTrust(paths = ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE"]) {
  return paths.map((k) => ({ var: k, value: process.env[k] || null }));
}

export function lockPlan(dir, { apply = false, passphrase = null } = {}) {
  const key = join(dir, "root-ca-key.pem");
  const enc = join(dir, "root-ca-key.pem.enc");
  const steps = [
    `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in ${key} -out ${enc}   # 口令只从 IG5_CA_PASSPHRASE 读，不入 argv`,
    `chmod 600 ${enc}`,
    `# 解锁（由需要签发的进程在启动时执行，不落盘明文）：openssl enc -d -aes-256-cbc -pbkdf2 -in ${enc} | openssl pkey -out /dev/stdout`,
    `# 确认代理可解锁后，再删明文：rm -f ${key}   ← 需人工确认，本工具不自动删`,
  ];
  if (!apply) return { applied: false, steps };
  if (!passphrase) throw new Error("缺少 IG5_CA_PASSPHRASE，拒绝加密（口令不入 argv/文件）");
  execFileSync("/usr/bin/openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt", "-in", key, "-out", enc, "-pass", "env:IG5_CA_PASSPHRASE"], { env: { ...process.env, IG5_CA_PASSPHRASE: passphrase } });
  chmodSync(enc, 0o600);
  return { applied: true, enc, sha12: sha12(enc), steps };
}

export function rotatePlan(dir, { apply = false, cn = "billion-context MITM Root CA", allow = false } = {}) {
  const stage = join(dir, `rotation-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const steps = [
    `mkdir -p ${stage}`,
    `openssl genrsa -out ${stage}/root-ca-key.pem 4096 && chmod 600 ${stage}/root-ca-key.pem`,
    `openssl req -x509 -new -sha256 -days 3650 -key ${stage}/root-ca-key.pem -subj "/CN=${cn}" -out ${stage}/root-ca.pem`,
    `# 交换（人工，需停代理后执行）：mv 旧 CA 到 *.bak-<ts> → 用新 root-ca.pem 重建 combined-ca.pem → 重装信任 → 重启代理`,
    `# 回滚：把 *.bak-<ts> 移回原位并重启；已签发叶证书需重签`,
  ];
  if (!apply) return { applied: false, stage, steps };
  if (!allow) throw new Error("轮换必须显式放行：IG5_CA_ROTATE=yes（会改变全机信任面）");
  mkdirSync(stage, { recursive: true });
  execFileSync("/usr/bin/openssl", ["genrsa", "-out", join(stage, "root-ca-key.pem"), "4096"], { stdio: "ignore" });
  chmodSync(join(stage, "root-ca-key.pem"), 0o600);
  execFileSync("/usr/bin/openssl", ["req", "-x509", "-new", "-sha256", "-days", "3650", "-key", join(stage, "root-ca-key.pem"), "-subj", `/CN=${cn}`, "-out", join(stage, "root-ca.pem")], { stdio: "ignore" });
  return { applied: true, stage, steps, cert: certInfo(join(stage, "root-ca.pem")), pair: pairMatch(join(stage, "root-ca-key.pem"), join(stage, "root-ca.pem")) };
}

export function check(dir = DEFAULT_DIR) {
  const key = join(dir, "root-ca-key.pem");
  const cert = join(dir, "root-ca.pem");
  const combined = join(dir, "combined-ca.pem");
  const files = [key, cert, combined].filter(existsSync).map((p) => ({ path: p, mode: modeOf(p), size: statSync(p).size, sha12: sha12(p) }));
  const pair = existsSync(key) && existsSync(cert) ? pairMatch(key, cert) : { match: false, error: "缺少 key 或 cert" };
  const info = existsSync(cert) ? certInfo(cert) : {};
  const keyMode = existsSync(key) ? modeOf(key) : null;
  const reachable = existsSync(key) ? droppedReadable(key) : null;
  const combinedCount = existsSync(combined) ? Number(execFileSync("/bin/grep", ["-c", "BEGIN CERTIFICATE", combined]).toString().trim()) : 0;
  const verdicts = {
    pair: pair.match ? "OK" : "FAIL",
    keyMode: keyMode === "0600" ? "OK" : keyMode ? "WIDE" : "MISSING",
    sameUidReach: reachable ? "REACHABLE(架构性，非本件可修)" : "BLOCKED",
    trust: trustPlacement(),
    envTrust: envTrust(),
  };
  const fail = !pair.match || verdicts.keyMode !== "OK";
  return { dir, files, pair, info, combinedCertificates: combinedCount, verdicts, pass: !fail };
}

function selftest() {
  const ok = [];
  const t = mkdtempSync(join(tmpdir(), "cag-"));
  const k1 = join(t, "root-ca-key.pem");
  const c1 = join(t, "root-ca.pem");
  const k2 = join(t, "other-key.pem");
  execFileSync("/usr/bin/openssl", ["genrsa", "-out", k1, "2048"], { stdio: "ignore" });
  execFileSync("/usr/bin/openssl", ["genrsa", "-out", k2, "2048"], { stdio: "ignore" });
  execFileSync("/usr/bin/openssl", ["req", "-x509", "-new", "-sha256", "-days", "1", "-key", k1, "-subj", "/CN=TEST_ROOT", "-out", c1], { stdio: "ignore" });
  ok.push(["配对阳性：同源 key/cert 判为 match", pairMatch(k1, c1).match === true]);
  ok.push(["配对阴性：异源 key 判为不匹配", pairMatch(k2, c1).match === false]);
  const info = certInfo(c1);
  ok.push(["证书信息含 CN 与有效期", /CN\s*=\s*TEST_ROOT/.test(info.subject || "") && !!info.notAfter]);
  const before = readFileSync(k1);
  writeFileSync(join(t, "plain.txt"), "hello");
  const lp = lockPlan(t, { apply: false });
  ok.push(["lock 默认只出计划", lp.applied === false && /openssl enc -aes-256-cbc/.test(lp.steps[0])]);
  let refused = false;
  try { lockPlan(t, { apply: true }); } catch { refused = true; }
  ok.push(["lock --apply 无口令时拒绝", refused === true]);
  const enc = execFileSync("/usr/bin/openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "2000", "-salt", "-pass", "pass:test", "-in", k1], { stdio: ["ignore", "pipe", "ignore"] });
  const dec = execFileSync("/usr/bin/openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "2000", "-pass", "pass:test"], { input: enc, stdio: ["pipe", "pipe", "ignore"] });
  ok.push(["加密往返可还原同材料", createHash("sha256").update(dec).digest("hex") === createHash("sha256").update(before).digest("hex")]);
  const rp = rotatePlan(t, { apply: false });
  ok.push(["rotate 默认只出计划且写 staging", rp.applied === false && rp.stage.includes("rotation-")]);
  let rotateRefused = false;
  try { rotatePlan(t, { apply: true }); } catch { rotateRefused = true; }
  ok.push(["rotate --apply 无 IG5_CA_ROTATE 时拒绝", rotateRefused === true]);
  ok.push(["降权可读探测为布尔", typeof droppedReadable(c1) === "boolean"]);
  ok.push(["trustPlacement 返回系统库与自定义落点两项", trustPlacement().length >= 2]);
  rmSync(t, { recursive: true, force: true });
  for (const [name, v] of ok) console.log(`${v ? "ok" : "FAIL"}(${name})`);
  const bad = ok.filter(([, v]) => !v).length;
  console.log(`ca_key_guard 自检${bad ? "未通过" : "通过"}（共 ${ok.length} 条）`);
  return bad ? 1 : 0;
}

const isEntry = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isEntry) {
  const argv = process.argv.slice(2);
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = get("--dir") || DEFAULT_DIR;
  try {
    if (argv.includes("--selftest")) process.exit(selftest());
    if (argv.includes("--check")) {
      const r = check(dir);
      const verdict = r.pass ? "CA_KEY_GUARD=OK" : "CA_KEY_GUARD=FAIL";
      if (argv.includes("--json")) { console.log(JSON.stringify(r, null, 2)); console.error(verdict); }
      else { console.log(JSON.stringify(r)); console.log(verdict); }
      process.exit(r.pass ? 0 : 1);
    }
    if (argv.includes("--lock")) {
      const r = lockPlan(dir, { apply: argv.includes("--apply"), passphrase: process.env.IG5_CA_PASSPHRASE });
      console.log(r.steps.join("\n"));
      console.log(r.applied ? `CA_LOCK=APPLIED sha12=${r.sha12}` : "CA_LOCK=DRY_RUN");
      process.exit(0);
    }
    if (argv.includes("--rotate")) {
      const r = rotatePlan(dir, { apply: argv.includes("--apply"), cn: get("--cn") || "billion-context MITM Root CA", allow: process.env.IG5_CA_ROTATE === "yes" });
      console.log(r.steps.join("\n"));
      console.log(r.applied ? `CA_ROTATE=STAGED ${r.stage} fp=${r.cert.fingerprint}` : `CA_ROTATE=DRY_RUN stage=${r.stage}`);
      process.exit(0);
    }
    console.log("用法：--check | --lock [--apply] | --rotate [--apply] | --selftest");
    process.exit(2);
  } catch (e) {
    console.error(`CA_KEY_GUARD=ERROR ${String(e.message || e).split("\n")[0]}`);
    process.exit(1);
  }
}
