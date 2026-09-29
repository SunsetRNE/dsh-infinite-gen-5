// 兼容层判据 · 文件载体部署器（codex / gpt-instruct 协议）
//
// 只在一次性临时目录里跑：所有写入都落在 mkdtemp 出来的 CODEX_HOME 下，
// 真实 ~/.codex 只作为「闸门」被验一次（HOME 被指向临时根，因此闸门即使失效也写不进真目录）。
//
// 判据十一条：H1 顶层键插入位置与表格隔离 · H2 幂等 · H3 快照 · H4 超限闸门 · H5 不安全名
//            H6 拒绝写符号链接 · H7 标准 unzip 能读回载荷 · H8 state 形状
//            H9 reset 三分支 · H10 restore-snapshot 三道闸 · H11 CLI 真实 HOME 闸门

import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import {
  DEPLOY_VERSION,
  MANAGED_KEY,
  STATE_FILE,
  DEFAULT_NAME,
  CARRIER_CAP_BYTES,
  sha256,
  isSafePromptName,
  readTopLevelAssignment,
  setTopLevelAssignment,
  removeTopLevelAssignment,
  readState,
  planDeploy,
  applyDeploy,
  resetDeploy,
  restoreSnapshot,
  listSnapshots,
  buildZip,
  readZipEntries,
  main,
} from "./codex-deploy.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "ig5-codex-test-"));
const PAYLOAD = "# 载荷\nhello from ig5\n";
const CONFIG = [
  "# 用户自己的配置",
  'model = "gpt-5.6-sol"',
  'approval_policy = "never"',
  "",
  "[profiles.default]",
  `  ${MANAGED_KEY} = "./decoy.md"`,
  'model = "gpt-5.6"',
  "",
].join("\n");

const results = [];
function check(id, title, ok, detail = "") {
  results.push({ id, title, ok: !!ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${id} ${title}${detail ? ` —— ${detail}` : ""}`);
}

function freshDir(name, configText = CONFIG) {
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.toml"), configText);
  return dir;
}

async function capture(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    return { code: await fn(), lines };
  } finally {
    console.log = orig;
  }
}

// ── H1 顶层键插入位置与表格隔离 ─────────────────────────────────────────────
{
  const dir = freshDir("h1");
  const res = applyDeploy({ codexDir: dir, payloadText: PAYLOAD });
  const text = readFileSync(join(dir, "config.toml"), "utf8");
  const lines = text.split("\n");
  const cfg = res.writes.find((w) => w.op === "config-write");
  const topIdx = lines.findIndex((l) => l.startsWith(`${MANAGED_KEY} = `));
  const decoyIdx = lines.findIndex((l) => l.trim().startsWith(`${MANAGED_KEY} = "./decoy.md"`));
  check(
    "H1",
    "顶层键插在顶层 model 之后、表格内的同名键不动",
    res.ok &&
      cfg?.action === "inserted-after-model" &&
      topIdx === 2 &&
      lines[1] === 'model = "gpt-5.6-sol"' &&
      decoyIdx > topIdx &&
      lines[decoyIdx] === `  ${MANAGED_KEY} = "./decoy.md"`,
    `action=${cfg?.action} topIdx=${topIdx} decoyIdx=${decoyIdx}`,
  );
}

// ── H2 幂等 ────────────────────────────────────────────────────────────────
{
  const dir = freshDir("h2");
  applyDeploy({ codexDir: dir, payloadText: PAYLOAD });
  const before = readFileSync(join(dir, "config.toml"), "utf8");
  const second = applyDeploy({ codexDir: dir, payloadText: PAYLOAD });
  const after = readFileSync(join(dir, "config.toml"), "utf8");
  const cfg = second.writes.find((w) => w.op === "config-write");
  const pay = second.writes.find((w) => w.op === "payload-write");
  check(
    "H2",
    "同内容再 apply：config 与载荷都报 unchanged，字节不变",
    second.ok && cfg?.action === "unchanged" && pay?.action === "unchanged" && before === after,
    `config=${cfg?.action} payload=${pay?.action} bytesEqual=${before === after}`,
  );
}

// ── H3 快照 ────────────────────────────────────────────────────────────────
{
  const dir = freshDir("h3");
  const res = applyDeploy({ codexDir: dir, payloadText: PAYLOAD });
  const snaps = listSnapshots(dir);
  const snap = snaps.find((s) => s.file === res.writes.find((w) => w.op === "snapshot")?.path.split("/").pop());
  check(
    "H3",
    "写前快照内容 == 原 config，且快照名带时间戳",
    snaps.length === 1 &&
      snap?.file.startsWith("config.toml.bak_") &&
      readFileSync(snap.path, "utf8") === CONFIG,
    `snapshots=${snaps.map((s) => s.file).join(",")}`,
  );
}

// ── H4 超限闸门 ────────────────────────────────────────────────────────────
{
  const dir = freshDir("h4");
  const big = `# big\n${"a".repeat(9000)}`;
  const denied = planDeploy({ codexDir: dir, payloadText: big });
  const allowed = planDeploy({ codexDir: dir, payloadText: big, allowOversize: true });
  check(
    "H4",
    `超过 ${CARRIER_CAP_BYTES} B 拒绝、--allow-oversize 放行，且拒绝态没写盘`,
    denied.ok === false &&
      denied.reason === "oversize" &&
      denied.capBytes === CARRIER_CAP_BYTES &&
      allowed.ok === true &&
      !existsSync(join(dir, DEFAULT_NAME)),
    `denied=${denied.reason}/${denied.oversizeBy}B allowed=${allowed.ok}`,
  );
}

// ── H5 不安全名 ────────────────────────────────────────────────────────────
{
  const dir = freshDir("h5");
  const bad = ["../evil.md", "noext", ".hidden.md", "sub/dir.md", "a\\b.md"];
  const safe = isSafePromptName("infinite-gen-5.md") && isSafePromptName("ig5_v2.md");
  const allDenied = bad.every((n) => planDeploy({ codexDir: dir, name: n, payloadText: PAYLOAD }).reason === "unsafe-name");
  check("H5", "路径穿越 / 无扩展名 / 点开头 / 反斜杠一律 unsafe-name，正常名放行", allDenied && safe, `bad=${bad.length} safe=${safe}`);
}

// ── H6 拒绝写符号链接 ──────────────────────────────────────────────────────
{
  const dir = freshDir("h6");
  const victim = join(ROOT, "h6-victim.txt");
  writeFileSync(victim, "不该被改");
  symlinkSync(victim, join(dir, DEFAULT_NAME));
  const res = applyDeploy({ codexDir: dir, payloadText: PAYLOAD });
  check(
    "H6",
    "载荷路径是符号链接时拒写（refused-symlink），链接目标未被改",
    res.ok === false && res.reason === "payload-write-failed: refused-symlink" && readFileSync(victim, "utf8") === "不该被改",
    `reason=${res.reason}`,
  );
  unlinkSync(join(dir, DEFAULT_NAME));
}

// ── H7 标准 unzip 能读回载荷 ───────────────────────────────────────────────
{
  const dir = freshDir("h7");
  applyDeploy({ codexDir: dir, payloadText: PAYLOAD });
  const zipPath = join(dir, "infinite-gen-5.zip");
  const buf = readFileSync(zipPath);
  const entries = readZipEntries(buf);
  let extracted = null;
  let zipErr = null;
  try {
    extracted = execFileSync("unzip", ["-p", zipPath, DEFAULT_NAME], { encoding: "utf8" });
  } catch (e) {
    zipErr = e.message.split("\n")[0];
  }
  check(
    "H7",
    "自造 ZIP（store 方式）被标准 unzip 解出、正文与载荷逐字节一致、只含一个 .md",
    zipErr === null &&
      extracted === PAYLOAD &&
      entries.length === 1 &&
      entries[0].name === DEFAULT_NAME &&
      entries[0].size === Buffer.byteLength(PAYLOAD, "utf8"),
    zipErr ? `unzip 失败：${zipErr}` : `entries=${entries.map((e) => `${e.name}:${e.size}`).join(",")}`,
  );
}

// ── H8 state 形状 ──────────────────────────────────────────────────────────
{
  const dir = freshDir("h8");
  applyDeploy({ codexDir: dir, payloadText: PAYLOAD });
  const st = readState(dir);
  const m = st.state?.managed ?? {};
  check(
    "H8",
    "state 记全 previous/受管文件四元组/快照",
    st.ok &&
      st.state.version === 2 &&
      st.state.key === MANAGED_KEY &&
      st.state.previous === null &&
      m.name === DEFAULT_NAME &&
      m.sha256 === sha256(PAYLOAD) &&
      m.bytes === Buffer.byteLength(PAYLOAD, "utf8") &&
      m.existed_before === false &&
      typeof st.state.snapshot === "string" &&
      typeof st.state.updatedAt === "string",
    `managed=${JSON.stringify(m)} previous=${st.state?.previous}`,
  );
}

// ── H9 reset 三分支 ────────────────────────────────────────────────────────
{
  const a = freshDir("h9a");
  applyDeploy({ codexDir: a, payloadText: PAYLOAD });
  const ra = resetDeploy({ codexDir: a });
  const opsA = ra.actions.map((x) => `${x.op}:${x.action}`);
  const cleanA =
    ra.ok &&
    opsA.join(",") === "config:removed-key,payload:deleted,zip:deleted,manifest:deleted" &&
    !existsSync(join(a, DEFAULT_NAME)) &&
    !existsSync(join(a, "infinite-gen-5.zip")) &&
    !existsSync(join(a, "infinite-gen-5.manifest.json")) &&
    !existsSync(join(a, STATE_FILE)) &&
    readFileSync(join(a, "config.toml"), "utf8") === CONFIG;

  const b = freshDir("h9b");
  applyDeploy({ codexDir: b, payloadText: PAYLOAD });
  writeFileSync(join(b, DEFAULT_NAME), "# 别人改过的内容\n");
  const rb = resetDeploy({ codexDir: b });
  const opsB = rb.actions.map((x) => `${x.op}:${x.action}`);
  const preservedB = opsB.some((o) => o.startsWith("payload:preserved")) && existsSync(join(b, DEFAULT_NAME));

  const c = freshDir("h9c");
  const original = "# 部署前就存在的载荷\n";
  writeFileSync(join(c, DEFAULT_NAME), original);
  applyDeploy({ codexDir: c, payloadText: PAYLOAD });
  const stC = readState(c);
  const backupName = stC.state?.managed?.backup ?? "";
  const rc = resetDeploy({ codexDir: c });
  const preservedC =
    stC.state?.managed?.existed_before === true &&
    rc.actions.some((o) => o.op === "payload" && String(o.action).startsWith("preserved")) &&
    existsSync(join(c, DEFAULT_NAME)) &&
    readFileSync(join(c, DEFAULT_NAME), "utf8") === PAYLOAD &&
    backupName.startsWith(`${DEFAULT_NAME}.bak_`) &&
    existsSync(join(c, backupName)) &&
    readFileSync(join(c, backupName), "utf8") === original;

  check(
    "H9",
    "reset：我们创建的删干净 / 被外部改过保留 / 原本就有的保留",
    cleanA && preservedB && preservedC,
    `a=${opsA.join("|")} b=${opsB.filter((o) => o.startsWith("payload")).join("|")} c=existed_before=${stC.state?.managed?.existed_before}`,
  );
}

// ── H10 restore-snapshot 三道闸 ────────────────────────────────────────────
{
  const dir = freshDir("h10");
  const res = applyDeploy({ codexDir: dir, payloadText: PAYLOAD });
  const snap = res.writes.find((w) => w.op === "snapshot").path;
  const outside = join(ROOT, "h10-outside.bak_20260101_000000_000000");
  writeFileSync(outside, "# 外部文件\n");
  const r1 = restoreSnapshot({ codexDir: dir, snapshotPath: outside });
  const r2 = restoreSnapshot({ codexDir: dir, snapshotPath: join(dir, "config.toml") });
  const r3 = restoreSnapshot({ codexDir: dir, snapshotPath: snap });
  const restored = readFileSync(join(dir, "config.toml"), "utf8") === CONFIG;
  const preRestore = readdirSync(dir).filter((f) => f.includes(".pre-restore"));
  check(
    "H10",
    "快照恢复：目录外拒绝 / 非托管名拒绝 / 正常恢复且留 .pre-restore",
    r1.reason === "snapshot-outside-target" && r2.reason === "not-a-managed-snapshot" && r3.ok && restored && preRestore.length >= 1,
    `r1=${r1.reason} r2=${r2.reason} r3=${r3.ok} preRestore=${preRestore.length}`,
  );
}

// ── H11 CLI 真实 HOME 闸门（HOME 指向临时根）──────────────────────────────
{
  const home = join(ROOT, "h11-home");
  mkdirSync(join(home, ".codex"), { recursive: true });
  const realHome = process.env.HOME;
  process.env.HOME = home;
  let gate = null;
  let dry = null;
  try {
    const g = await capture(() => main(["--apply", "--json"]));
    gate = JSON.parse(g.lines.join("\n"));
    const d = await capture(() => main(["--check", "--codex-dir", join(home, ".codex"), "--payload", join(home, "nope.md")]));
    dry = { code: d.code, out: d.lines.join("\n") };
  } finally {
    process.env.HOME = realHome;
  }
  const cfgPath = join(home, ".codex", "config.toml");
  const cfgText = existsSync(cfgPath) ? readFileSync(cfgPath, "utf8") : "";
  check(
    "H11",
    "缺少 --yes 时不写真实 CODEX_HOME；给了 --codex-dir 的只读 --check 正常",
    gate?.reason === "real-home-needs-yes" &&
      gate.codexDir === join(home, ".codex") &&
      !cfgText.includes(MANAGED_KEY) &&
      dry.code === 1 &&
      dry.out.includes("payload-missing"),
    `gate=${gate?.reason} 未写键=${!cfgText.includes(MANAGED_KEY)} checkCode=${dry.code}`,
  );
}

// ── 汇总 ───────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length;
console.log("");
console.log(`临时 CODEX_HOME：${ROOT}`);
console.log(`部署器版本：${DEPLOY_VERSION}`);
console.log(`结果：${passed}/${results.length} 条判据通过`);
console.log(`顶层键工具自测：set=${setTopLevelAssignment(CONFIG, MANAGED_KEY, "./x.md").action} readTopLevel=${readTopLevelAssignment(CONFIG).found}（表格里那个不算）removeTopLevel=${removeTopLevelAssignment(CONFIG).text.includes(`\n${MANAGED_KEY} =`) ? "有残留" : "已删、表格内保留"}`);
console.log(`ZIP 自测：${readZipEntries(buildZip("a.md", "x")).map((e) => e.name).join(",")}`);
process.exit(passed === results.length ? 0 : 1);
