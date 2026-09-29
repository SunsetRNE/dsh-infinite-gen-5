// 兼容层 · 文件载体部署器（Codex / gpt-instruct 协议）
//
// 对齐 github.com/MDX-Tom/gpt-instruct 的部署协议（MIT；只借协议与判据，不复用其素材）：
//   - 只碰自己管理的那一个键：顶层 model_instructions_file（provider / model / 认证一概不碰）
//   - 写前快照：config.toml.bak_<YYYYmmdd_HHMMSS_ffffff>
//   - 原子写：mkstemp + fsync + rename；拒绝写符号链接
//   - 字段级 state：previous 值 + 托管文件 sha256/existed_before
//   - --reset 只在 sha256 匹配且 existed_before=false 时删自己创建的文件，否则 preserved
//   - 载体：ZIP 内含唯一 .md（不塞别的东西），旁边落 manifest（含 zip 的 sha256）
//
// 默认 dry-run：不写任何字节。写宿主真实配置是显式动作（--apply）。
// 对真实 ~/.codex 打 --apply 时要求 --yes；本模块本身不判断「是不是真 HOME」，由 CLI 闸门做。

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  lstatSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
} from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const DEPLOY_VERSION = "ig5-codex-deploy/1";
export const MANAGED_KEY = "model_instructions_file";
export const STATE_FILE = ".ig5-adapter-state.json";
export const STATE_VERSION = 2;
export const DEFAULT_NAME = "infinite-gen-5.md";
export const BACKUP_PREFIX = "config.toml.bak_";
export const CARRIER_CAP_BYTES = 8000; // gpt-instruct 的候选提示词上限（其文档口径）

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function nowStamp(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `_${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}` +
    `_${p(date.getUTCMilliseconds(), 3)}${p(Math.floor(Math.random() * 1000), 3)}`
  );
}

export function isSafePromptName(name) {
  if (typeof name !== "string" || !name.length) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (!name.endsWith(".md")) return false;
  if (name.startsWith(".")) return false; // 别把 state 之类的隐藏文件当载荷
  return true;
}

// ── TOML：只认顶层（首个 [table] 之前）的赋值 ────────────────────────────────
export function topLevelRange(text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) return i; // 表开始，顶层到此为止
  }
  return lines.length;
}

export function readTopLevelAssignment(text, key = MANAGED_KEY) {
  const lines = text.split("\n");
  const end = topLevelRange(text);
  const re = new RegExp(`^(\\s*)${key}\\s*=\\s*(.*)$`);
  for (let i = 0; i < end; i += 1) {
    const m = lines[i].match(re);
    if (m) {
      const raw = m[2];
      const commentAt = raw.indexOf("#");
      const valuePart = (commentAt >= 0 ? raw.slice(0, commentAt) : raw).trim();
      return {
        found: true,
        index: i,
        indent: m[1],
        value: valuePart.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"),
        raw: valuePart,
        comment: commentAt >= 0 ? raw.slice(commentAt).trim() : "",
      };
    }
  }
  return { found: false, index: -1, value: null, raw: null, comment: "" };
}

export function setTopLevelAssignment(text, key, value) {
  const lines = text.split("\n");
  const current = readTopLevelAssignment(text, key);
  const line = `${key} = "${value}"`;
  if (current.found) {
    if (current.value === value) return { text, changed: false, action: "unchanged" };
    lines[current.index] = current.comment ? `${line} ${current.comment}` : line;
    return { text: lines.join("\n"), changed: true, action: "replaced" };
  }
  const end = topLevelRange(text);
  let insertAt = 0;
  for (let i = 0; i < end; i += 1) {
    if (/^\s*model\s*=/.test(lines[i])) insertAt = i + 1; // 有顶层 model = 就紧随其后
  }
  lines.splice(insertAt, 0, line);
  return { text: lines.join("\n"), changed: true, action: insertAt === 0 ? "inserted-at-top" : "inserted-after-model" };
}

export function removeTopLevelAssignment(text, key = MANAGED_KEY) {
  const current = readTopLevelAssignment(text, key);
  if (!current.found) return { text, changed: false, action: "absent" };
  const lines = text.split("\n");
  lines.splice(current.index, 1);
  return { text: lines.join("\n"), changed: true, action: "removed" };
}

// ── 原子写：拒绝符号链接，mkstemp + fsync + rename ───────────────────────────
export function atomicWriteText(path, text, { mode = 0o600 } = {}) {
  if (existsSync(path)) {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) {
      return { ok: false, path, reason: "refused-symlink" };
    }
  }
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(tmp, "w", mode);
  try {
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  return { ok: true, path, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256(text) };
}

export function atomicWriteBuffer(path, buf, { mode = 0o600 } = {}) {
  if (existsSync(path)) {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) return { ok: false, path, reason: "refused-symlink" };
  }
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(tmp, "w", mode);
  try {
    writeFileSync(fd, buf);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  return { ok: true, path, bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
}

// ── state ───────────────────────────────────────────────────────────────────
export function statePath(codexDir) {
  return join(codexDir, STATE_FILE);
}

export function readState(codexDir) {
  const path = statePath(codexDir);
  if (!existsSync(path)) return { ok: false, path, reason: "no-state" };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return { ok: true, path, state: parsed };
  } catch (error) {
    return { ok: false, path, reason: `state-unreadable: ${String(error && error.message)}` };
  }
}

// ── 计划 / 应用 ─────────────────────────────────────────────────────────────
export function planDeploy({ codexDir, name = DEFAULT_NAME, payloadText = "", capBytes = CARRIER_CAP_BYTES, allowOversize = false, now = new Date() }) {
  const steps = [];
  const warnings = [];
  const payloadBytes = Buffer.byteLength(payloadText, "utf8");
  const oversize = payloadBytes > capBytes;

  if (!isSafePromptName(name)) {
    return { ok: false, version: DEPLOY_VERSION, reason: "unsafe-name", name, steps, warnings };
  }
  if (oversize && !allowOversize) {
    return {
      ok: false,
      version: DEPLOY_VERSION,
      reason: "oversize",
      bytes: payloadBytes,
      capBytes,
      oversizeBy: payloadBytes - capBytes,
      steps,
      warnings: [`载荷 ${payloadBytes} B 超过 ${capBytes} B：需 --allow-oversize 才部署（或换裁剪档）`],
    };
  }

  const configPath = join(codexDir, "config.toml");
  const configText = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const current = readTopLevelAssignment(configText, MANAGED_KEY);
  const snapshot = existsSync(configPath) ? `${BACKUP_PREFIX}${nowStamp(now)}` : null;

  steps.push({ op: "snapshot", path: configPath, to: snapshot, reason: "写前快照（无 config.toml 则跳过）" });
  steps.push({
    op: "config-write",
    path: configPath,
    key: MANAGED_KEY,
    value: `./${name}`,
    previous: current.found ? current.raw : null,
    action: current.found ? (current.value === `./${name}` ? "unchanged" : "replaced") : "inserted",
    reason: "只改这一个键；位置在首个 [table] 之前",
  });
  steps.push({ op: "payload-write", path: join(codexDir, name), bytes: payloadBytes, reason: "托管载荷（同 sha256 则跳过）" });
  steps.push({ op: "zip-write", path: join(codexDir, `${basename(name, ".md")}.zip`), reason: "ZIP 载体：内含唯一 .md" });
  steps.push({ op: "manifest-write", path: join(codexDir, `${basename(name, ".md")}.manifest.json`), reason: "归档 sha256 + 惰性账目" });
  steps.push({ op: "state-write", path: statePath(codexDir), reason: `previous=${JSON.stringify(current.found ? current.raw : null)}，供 --reset 判定` });

  if (oversize) warnings.push(`载荷 ${payloadBytes} B > ${capBytes} B（--allow-oversize 已显式放行）`);
  if (!existsSync(codexDir)) warnings.push(`目标目录不存在：apply 时会创建 ${codexDir}`);
  warnings.push("本通道无热加载：部署后需重启宿主会话");
  warnings.push("禁止跨身份拼接成绩（本通道结果不得与 DSH 通道合并统计）");

  return { ok: true, version: DEPLOY_VERSION, dryRun: true, codexDir, name, payloadBytes, oversize, steps, warnings };
}

export function buildZip(entryName, text) {
  const nameBuf = Buffer.from(entryName, "utf8");
  const data = Buffer.from(text, "utf8");
  const crc = crc32(data);
  const dosTime = 0;
  const dosDate = (1 << 5) | 1; // 1980-01-01，避免把机器时钟写进产物

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); // store
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const localSize = local.length + nameBuf.length + data.length;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 40);

  const centralSize = central.length + nameBuf.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(localSize, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

export function readZipEntries(buf) {
  const eocdAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdAt < 0) return [];
  const count = buf.readUInt16LE(eocdAt + 10);
  let off = buf.readUInt32LE(eocdAt + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const size = buf.readUInt32LE(off + 24);
    entries.push({ name: buf.slice(off + 46, off + 46 + nameLen).toString("utf8"), size });
    off += 46 + nameLen + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
  }
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function applyDeploy({
  codexDir,
  name = DEFAULT_NAME,
  payloadText = "",
  manifestExtra = {},
  capBytes = CARRIER_CAP_BYTES,
  allowOversize = false,
  now = new Date(),
} = {}) {
  const plan = planDeploy({ codexDir, name, payloadText, capBytes, allowOversize, now });
  if (!plan.ok) return plan;
  if (!existsSync(codexDir)) mkdirSync(codexDir, { recursive: true });

  const configPath = join(codexDir, "config.toml");
  const payloadPath = join(codexDir, name);
  const zipPath = join(codexDir, `${basename(name, ".md")}.zip`);
  const manifestPath = join(codexDir, `${basename(name, ".md")}.manifest.json`);
  const writes = [];
  const warnings = [...plan.warnings];

  const configText = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const current = readTopLevelAssignment(configText, MANAGED_KEY);
  const payloadSha = sha256(payloadText);
  const previous = current.found ? current.raw : null;
  // existed_before 只看「我们之前有没有创建过它」：第一次部署时它已存在 → true；否则沿用 state。
  const priorState = readState(codexDir);
  const existedBefore = priorState.ok ? priorState.state?.managed?.existed_before === true : existsSync(payloadPath);

  let snapshot = null;
  if (existsSync(configPath)) {
    snapshot = `${BACKUP_PREFIX}${nowStamp(now)}`;
    const snapPath = join(codexDir, snapshot);
    const copied = atomicWriteText(snapPath, configText, { mode: 0o600 });
    if (!copied.ok) return { ok: false, version: DEPLOY_VERSION, reason: `snapshot-failed: ${copied.reason}`, writes };
    writes.push({ op: "snapshot", path: snapPath, bytes: copied.bytes });
  } else {
    warnings.push("目标目录没有 config.toml：将新建，--reset 会删掉本适配器插入的那一行");
  }

  const edited = setTopLevelAssignment(configText, MANAGED_KEY, `./${name}`);
  if (edited.changed) {
    const w = atomicWriteText(configPath, edited.text, { mode: 0o600 });
    if (!w.ok) return { ok: false, version: DEPLOY_VERSION, reason: `config-write-failed: ${w.reason}`, writes };
    writes.push({ op: "config-write", path: configPath, bytes: w.bytes, action: edited.action });
  } else {
    writes.push({ op: "config-write", path: configPath, action: "unchanged" });
  }

  const samePayload = existsSync(payloadPath) && sha256(readFileSync(payloadPath, "utf8")) === payloadSha;
  // 覆盖「部署前就存在、不是我们创建的」载荷前先存一份：否则 --reset 时 preserved 的其实是我们写的内容，
  // 用户原本那份就永久丢了。备份只在首次托管时做一次，之后沿用 state 里记的名字。
  let payloadBackup = priorState.ok ? priorState.state?.managed?.backup ?? null : null;
  if (!samePayload && existedBefore && existsSync(payloadPath) && !payloadBackup) {
    const bakName = `${name}.bak_${nowStamp(now)}`;
    const bk = atomicWriteText(join(codexDir, bakName), readFileSync(payloadPath, "utf8"), { mode: 0o600 });
    if (!bk.ok) return { ok: false, version: DEPLOY_VERSION, reason: `payload-backup-failed: ${bk.reason}`, writes };
    payloadBackup = bakName;
    warnings.push(`载荷文件部署前已存在：原内容备份到 ${bakName}（--reset 不会删它）`);
    writes.push({ op: "payload-backup", path: join(codexDir, bakName), bytes: bk.bytes });
  }
  if (samePayload) {
    writes.push({ op: "payload-write", path: payloadPath, action: "unchanged", sha256: payloadSha });
  } else {
    const w = atomicWriteText(payloadPath, payloadText, { mode: 0o600 });
    if (!w.ok) return { ok: false, version: DEPLOY_VERSION, reason: `payload-write-failed: ${w.reason}`, writes };
    writes.push({ op: "payload-write", path: payloadPath, bytes: w.bytes, sha256: payloadSha });
  }

  const zip = buildZip(name, payloadText);
  const zipWrite = atomicWriteBuffer(zipPath, zip, { mode: 0o600 });
  if (!zipWrite.ok) return { ok: false, version: DEPLOY_VERSION, reason: `zip-write-failed: ${zipWrite.reason}`, writes };
  writes.push({ op: "zip-write", path: zipPath, bytes: zip.length, sha256: zipWrite.sha256, entries: readZipEntries(zip).map((e) => e.name) });

  const manifest = {
    version: DEPLOY_VERSION,
    name,
    sha256: payloadSha,
    bytes: Buffer.byteLength(payloadText, "utf8"),
    key: MANAGED_KEY,
    value: `./${name}`,
    zip: { file: basename(zipPath), sha256: createHash("sha256").update(zip).digest("hex"), bytes: zip.length, entries: readZipEntries(zip) },
    previous,
    snapshot,
    at: now.toISOString(),
    ...manifestExtra,
  };
  const mw = atomicWriteText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  writes.push({ op: "manifest-write", path: manifestPath, bytes: mw.bytes });

  const state = {
    version: STATE_VERSION,
    key: MANAGED_KEY,
    previous,
    managed: { name, sha256: payloadSha, bytes: manifest.bytes, existed_before: existedBefore, backup: payloadBackup },
    snapshot,
    updatedAt: now.toISOString(),
  };
  const sw = atomicWriteText(statePath(codexDir), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  writes.push({ op: "state-write", path: statePath(codexDir), bytes: sw.bytes });

  return { ok: true, version: DEPLOY_VERSION, dryRun: false, codexDir, name, snapshot, writes, warnings, manifest };
}

// ── 回滚 ────────────────────────────────────────────────────────────────────
export function resetDeploy({ codexDir, now = new Date(), dryRun = false } = {}) {
  const st = readState(codexDir);
  if (!st.ok) return { ok: false, version: DEPLOY_VERSION, reason: st.reason, actions: [] };
  const state = st.state;
  const actions = [];
  const configPath = join(codexDir, "config.toml");

  if (existsSync(configPath)) {
    const configText = readFileSync(configPath, "utf8");
    const current = readTopLevelAssignment(configText, MANAGED_KEY);
    if (current.found && state.previous != null && current.value === state.previous) {
      actions.push({ op: "config", action: "already-previous", value: state.previous });
    } else if (current.found) {
      if (state.previous != null) {
        const snap = existsSync(configPath);
        if (snap) {
          const snapName = `${BACKUP_PREFIX}${nowStamp(now)}.reset`;
          atomicWriteText(join(codexDir, snapName), configText, { mode: 0o600 });
          actions.push({ op: "snapshot", path: snapName, reason: "reset 前再存一份" });
        }
        const edited = setTopLevelAssignment(configText, MANAGED_KEY, state.previous);
        if (!dryRun) atomicWriteText(configPath, edited.text, { mode: 0o600 });
        actions.push({ op: "config", action: "restored-previous", value: state.previous });
      } else {
        const edited = removeTopLevelAssignment(configText, MANAGED_KEY);
        if (!dryRun) atomicWriteText(configPath, edited.text, { mode: 0o600 });
        actions.push({ op: "config", action: "removed-key" });
      }
    } else {
      actions.push({ op: "config", action: "key-absent" });
    }
  } else {
    actions.push({ op: "config", action: "missing" });
  }

  const name = state.managed?.name ?? DEFAULT_NAME;
  const payloadPath = join(codexDir, name);
  if (existsSync(payloadPath)) {
    const currentSha = sha256(readFileSync(payloadPath, "utf8"));
    if (state.managed?.existed_before === true) {
      actions.push({
        op: "payload",
        action: "preserved（existed_before=true：不是我们创建的）",
        sha256: currentSha,
        backup: state.managed?.backup ?? null,
      });
    } else if (currentSha !== state.managed?.sha256) {
      actions.push({ op: "payload", action: "preserved（内容被外部改过，不删）", sha256: currentSha, expected: state.managed?.sha256 });
    } else if (dryRun) {
      actions.push({ op: "payload", action: "would-delete", sha256: currentSha });
    } else {
      unlinkSync(payloadPath);
      actions.push({ op: "payload", action: "deleted", sha256: currentSha });
    }
  } else {
    actions.push({ op: "payload", action: "absent" });
  }

  // 派生工件（ZIP 载体 + manifest）也是我们写的：载荷按我们的记录被删掉时一并清理，
  // 否则（载荷被外部改过 / 原本就不是我们的）保留，避免把别人的文件当残留删掉。
  const payloadOurs =
    state.managed?.existed_before !== true &&
    (!existsSync(payloadPath) || sha256(readFileSync(payloadPath, "utf8")) === state.managed?.sha256);
  const derived = [
    ["zip", join(codexDir, `${basename(name, ".md")}.zip`)],
    ["manifest", join(codexDir, `${basename(name, ".md")}.manifest.json`)],
  ];
  for (const [op, p] of derived) {
    if (!existsSync(p)) { actions.push({ op, action: "absent" }); continue; }
    if (!payloadOurs) { actions.push({ op, action: "preserved（载荷未按我们的记录删除，派生工件一并留着）" }); continue; }
    if (dryRun) { actions.push({ op, action: "would-delete" }); continue; }
    unlinkSync(p);
    actions.push({ op, action: "deleted" });
  }

  if (!dryRun && existsSync(statePath(codexDir))) unlinkSync(statePath(codexDir));
  return { ok: true, version: DEPLOY_VERSION, dryRun, codexDir, actions };
}

export function listSnapshots(codexDir) {
  if (!existsSync(codexDir)) return [];
  return readdirSync(codexDir)
    .filter((f) => f.startsWith(BACKUP_PREFIX))
    .map((f) => ({ file: f, path: join(codexDir, f), bytes: statSync(join(codexDir, f)).size }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function restoreSnapshot({ codexDir, snapshotPath, dryRun = false } = {}) {
  const abs = resolve(snapshotPath ?? "");
  const dirAbs = resolve(codexDir);
  if (dirname(abs) !== dirAbs) return { ok: false, version: DEPLOY_VERSION, reason: "snapshot-outside-target" };
  if (!basename(abs).startsWith(BACKUP_PREFIX)) return { ok: false, version: DEPLOY_VERSION, reason: "not-a-managed-snapshot" };
  if (!existsSync(abs)) return { ok: false, version: DEPLOY_VERSION, reason: "snapshot-missing" };
  const configPath = join(dirAbs, "config.toml");
  const bytes = statSync(abs).size;
  if (!dryRun) {
    const text = readFileSync(abs, "utf8");
    if (existsSync(configPath)) atomicWriteText(join(dirAbs, `${BACKUP_PREFIX}${nowStamp(new Date())}.pre-restore`), readFileSync(configPath, "utf8"), { mode: 0o600 });
    const w = atomicWriteText(configPath, text, { mode: 0o600 });
    if (!w.ok) return { ok: false, version: DEPLOY_VERSION, reason: w.reason };
  }
  return { ok: true, version: DEPLOY_VERSION, dryRun, restored: abs, bytes };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const HELP = [
  "用法：node codex-deploy.mjs [动作] [选项]",
  "",
  "动作（默认 --check，只读）：",
  "  --check                        只算计划，不写任何字节",
  "  --apply                        写 config.toml 的顶层 model_instructions_file + 载荷 + ZIP + manifest + state",
  "  --reset                        撤销自己写的东西（键还原 / 自己创建的文件才删）",
  "  --restore-snapshot <PATH>      用本模块建过的快照覆盖 config.toml（恢复前再存一份 .pre-restore）",
  "",
  "选项：",
  "  --codex-dir DIR                目标目录（默认 $CODEX_HOME 或 ~/.codex）",
  `  --name NAME                    载荷文件名（默认 ${DEFAULT_NAME}；拒 / \\ 非 .md 与点开头）`,
  "  --payload FILE                 直接给载荷正文；不给则用 build-adapters 现场编译 --target 通道",
  "  --target ID                    编译通道（默认 codex）",
  "  --truth DIR / --data DIR       真源与域数据目录（默认沿用 build-adapters 的常量）",
  `  --allow-oversize               放行超过 ${CARRIER_CAP_BYTES} B 的载荷（gpt-instruct 上限口径）`,
  "  --yes                          对真实 ~/.codex 打 --apply/--reset 时必须显式给出",
  "  --json                         机器可读输出",
  "  --version / --help",
].join("\n");

function parseArgs(argv) {
  const args = {
    action: "check",
    codexDir: null,
    name: DEFAULT_NAME,
    payload: null,
    target: "codex",
    truth: null,
    data: null,
    snapshot: null,
    allowOversize: false,
    yes: false,
    json: false,
    version: false,
    help: false,
  };
  const next = (i) => argv[i + 1] ?? null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--check") args.action = "check";
    else if (a === "--apply") args.action = "apply";
    else if (a === "--reset") args.action = "reset";
    else if (a === "--restore-snapshot") { args.action = "restore"; args.snapshot = next(i); i += 1; }
    else if (a === "--codex-dir") { args.codexDir = next(i); i += 1; }
    else if (a === "--name") { args.name = next(i) ?? DEFAULT_NAME; i += 1; }
    else if (a === "--payload") { args.payload = next(i); i += 1; }
    else if (a === "--target") { args.target = next(i) ?? "codex"; i += 1; }
    else if (a === "--truth") { args.truth = next(i); i += 1; }
    else if (a === "--data") { args.data = next(i); i += 1; }
    else if (a === "--allow-oversize") args.allowOversize = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--json") args.json = true;
    else if (a === "--version") args.version = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a.startsWith("-")) throw new Error(`未知选项 ${a}`);
  }
  return args;
}

export async function composePayload({ target = "codex", truth = null, data = null, payloadFile = null } = {}) {
  if (payloadFile) {
    const abs = resolve(payloadFile);
    if (!existsSync(abs)) return { ok: false, reason: `payload-missing: ${abs}` };
    const text = readFileSync(abs, "utf8");
    return { ok: true, source: abs, text, bytes: Buffer.byteLength(text, "utf8") };
  }
  const mod = await import("./build-adapters.mjs");
  const spec = mod.TARGETS[target];
  if (!spec) return { ok: false, reason: `unknown-target: ${target}（可选 ${Object.keys(mod.TARGETS).join(" / ")}）` };
  const built = mod.buildOne(
    target,
    spec,
    resolve(truth ?? mod.DEFAULT_TRUTH),
    mod.readDomainIndex(resolve(data ?? mod.DEFAULT_DATA)),
  );
  const text = built.plan.text;
  return {
    ok: true,
    source: `build-adapters:${target}`,
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    adapterErrors: built.errors,
    artifactProblems: built.artifactProblems,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const emit = (obj, human) => {
    if (args.json) console.log(JSON.stringify(obj, null, 2));
    else console.log(human);
    return obj.ok === false ? 1 : 0;
  };
  if (args.help) { console.log(HELP); return 0; }
  if (args.version) { console.log(DEPLOY_VERSION); return 0; }

  const codexDir = resolve(args.codexDir ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
  const realHome = resolve(join(homedir(), ".codex"));
  const isReal = codexDir === realHome;
  const write = args.action === "apply" || args.action === "reset" || args.action === "restore";
  if (write && isReal && !args.yes) {
    return emit(
      { ok: false, version: DEPLOY_VERSION, action: args.action, codexDir, reason: "real-home-needs-yes" },
      `拒绝：${codexDir} 是真实 CODEX_HOME，写入必须显式加 --yes（先跑 --check 看计划）。`,
    );
  }

  // 走到这里，真实 HOME 已被上面的闸门拦住（除非 --yes），所以到此的动作按「显式请求即执行」处理。
  if (args.action === "restore") {
    const r = restoreSnapshot({ codexDir, snapshotPath: args.snapshot ?? "", dryRun: false });
    return emit(
      { ...r, action: "restore", codexDir },
      r.ok ? `快照 ${r.restored}（${r.bytes} B）→ ${join(codexDir, "config.toml")}` : `失败：${r.reason}`,
    );
  }

  if (args.action === "reset") {
    const r = resetDeploy({ codexDir, dryRun: false });
    const lines = (r.actions ?? []).map((a) => `  - ${a.op}${a.action ? `:${a.action}` : ""}${a.reason ? ` (${a.reason})` : ""}`);
    return emit(
      { ...r, codexDir },
      `${r.ok ? "已回滚" : `失败：${r.reason}`}\n${lines.join("\n")}`,
    );
  }

  const payload = await composePayload({
    target: args.target,
    truth: args.truth,
    data: args.data,
    payloadFile: args.payload,
  });
  if (!payload.ok) return emit({ ok: false, version: DEPLOY_VERSION, ...payload }, `失败：${payload.reason}`);

  const name = args.name;
  const apply = args.action === "apply";
  const opts = {
    codexDir,
    name,
    payloadText: payload.text,
    capBytes: CARRIER_CAP_BYTES,
    allowOversize: args.allowOversize,
  };
  const res = apply ? applyDeploy(opts) : planDeploy(opts);
  if (!res.ok) {
    const hint = res.reason === "oversize"
      ? `（内核本身 ${res.bytes} B 就超过 gpt-instruct 的 ${res.capBytes} B 上限；要落盘加 --allow-oversize，或者用 lib/file-carrier.mjs 先裁成指针清单）`
      : "";
    return emit({ ok: false, action: args.action, codexDir, ...res, hint }, `失败：${res.reason} ${hint}`);
  }
  const steps = (res.steps ?? res.writes ?? []).map((s) => `  - ${s.op}${s.action ? `:${s.action}` : ""}${s.path ? ` → ${s.path}` : ""}`);
  const head = apply
    ? `已写入 ${codexDir}（载荷 ${payload.bytes} B，来源 ${payload.source}）`
    : `[dry-run] ${codexDir} 计划（载荷 ${payload.bytes} B，来源 ${payload.source}）`;
  return emit(
    { ok: true, action: args.action, codexDir, version: res.version, payloadBytes: payload.bytes, source: payload.source, ...res },
    `${head}\n${steps.join("\n")}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(`错误：${e.message}`);
    process.exit(2);
  });
}
