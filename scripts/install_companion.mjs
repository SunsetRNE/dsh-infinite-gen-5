#!/usr/bin/env node
/**
 * 伴生插件（companion）校验与装载 —— 当前只有一个：dsh-persona-volt。
 *
 * 口径：
 *   - 仓内 `companions/<id>/` 是**逐字节副本**，MERGE-MANIFEST.json 钉住每个文件的 sha256；
 *     --check 复算哈希，任何漂移都报错（不以「差不多」放过）。
 *   - 装载 = 复制到 `~/.dsh/plugin-src/<id>/`：这是宿主插件加载器的本地源目录。
 *     **激活记录（~/.dsh/plugin-activations.json）由宿主自己写** —— 它是加载器的账本
 *     （fingerprint / startup / loadedAt 都是运行时事实），脚本不去手改；装完在 GUI
 *     插件页打开开关，或重启 DSH 生效。
 *   - 缺 --apply 一律 dry-run，只打印计划与回滚行。
 *
 * 用法：
 *   node scripts/install_companion.mjs --check
 *   node scripts/install_companion.mjs --install [--root DIR] [--apply]
 *   node scripts/install_companion.mjs --selftest
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");
export const COMPANION_ID = "dsh-persona-volt";
export const DEFAULT_ROOT = join(homedir(), ".dsh", "plugin-src");
export const COMPANION_PROTOCOL = "ig5-companion-v1";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, base, out);
    else if (!/^MERGE-MANIFEST\.json$/.test(relative(base, p))) out.push(relative(base, p));
  }
  return out;
}

export function readManifest(srcDir = join(ROOT, "companions", COMPANION_ID)) {
  const p = join(srcDir, "MERGE-MANIFEST.json");
  if (!existsSync(p)) return { ok: false, errors: [`缺清单：${p}`] };
  let man;
  try {
    man = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    return { ok: false, errors: [`清单不是合法 JSON：${p}（${e.message}）`] };
  }
  return { ok: true, man, path: p };
}

export function checkCompanion(srcDir = join(ROOT, "companions", COMPANION_ID)) {
  const errors = [];
  const { ok, man } = readManifest(srcDir);
  if (!ok) return { ok: false, errors: man ? man.errors : [] };
  if (man.protocol !== COMPANION_PROTOCOL) errors.push(`protocol 不是 ${COMPANION_PROTOCOL}：${man.protocol}`);
  if (man.companion !== COMPANION_ID) errors.push(`companion 不是 ${COMPANION_ID}：${man.companion}`);
  const want = new Map(man.files.map((f) => [f.path, f]));
  const have = walk(srcDir);
  for (const f of man.files) {
    const p = join(srcDir, f.path);
    if (!existsSync(p)) {
      errors.push(`清单里的文件不在盘上：${f.path}`);
      continue;
    }
    const b = readFileSync(p);
    const h = sha(b);
    if (h !== f.sha256) errors.push(`sha256 漂移：${f.path}（清单 ${f.sha256.slice(0, 12)}… 实算 ${h.slice(0, 12)}…）`);
    if (b.length !== f.bytes) errors.push(`字节数漂移：${f.path}（清单 ${f.bytes} 实算 ${b.length}）`);
  }
  for (const rel of have) if (!want.has(rel)) errors.push(`盘上有清单外文件（未跟踪）：${rel}`);
  if (man.fileCount !== man.files.length) errors.push(`fileCount 与 files 条数不一致：${man.fileCount} vs ${man.files.length}`);
  return { ok: errors.length === 0, errors, man, files: man.files.length, bytes: man.bytes };
}

function arg(argv, k, d) {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
}

function selftest() {
  const errors = [];
  const tmp = join(ROOT, "companions", ".selftest-tmp");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, "lib"), { recursive: true });
  writeFileSync(join(tmp, "SKILL.txt"), "hello\n");
  writeFileSync(join(tmp, "lib", "index.js"), "export const x = 1;\n");
  const files = walk(tmp).map((rel) => {
    const b = readFileSync(join(tmp, rel));
    return { path: rel, bytes: b.length, sha256: sha(b) };
  });
  writeFileSync(join(tmp, "MERGE-MANIFEST.json"), JSON.stringify({ protocol: COMPANION_PROTOCOL, companion: COMPANION_ID, files, fileCount: files.length, bytes: files.reduce((s, f) => s + f.bytes, 0) }, null, 2));
  const clean = checkCompanion(tmp);
  if (!clean.ok) errors.push(`自检：干净夹具不该报错：${clean.errors.join("; ")}`);
  writeFileSync(join(tmp, "SKILL.txt"), "tampered\n");
  const tampered = checkCompanion(tmp);
  if (tampered.ok || !tampered.errors.some((e) => e.includes("sha256 漂移"))) errors.push("自检：改动文件后应报 sha256 漂移");
  writeFileSync(join(tmp, "extra.md"), "x\n");
  const extra = checkCompanion(tmp);
  if (extra.ok || !extra.errors.some((e) => e.includes("清单外文件"))) errors.push("自检：新增未跟踪文件应报错");
  rmSync(tmp, { recursive: true, force: true });
  const real = checkCompanion();
  if (!real.ok) errors.push(`自检：仓内伴生件不干净：${real.errors.join("; ")}`);
  console.log(errors.length ? "COMPANION SELFTEST FAILED\n" + errors.join("\n") : `COMPANION SELFTEST OK files=${real.files} bytes=${real.bytes}`);
  return errors.length ? 1 : 0;
}

function main(argv) {
  if (argv.includes("--selftest")) process.exit(selftest());
  const srcDir = join(ROOT, "companions", COMPANION_ID);
  if (argv.includes("--install")) {
    const target = resolve(arg(argv, "--root", DEFAULT_ROOT));
    const apply = argv.includes("--apply");
    const chk = checkCompanion(srcDir);
    if (!chk.ok) {
      console.log("COMPANION INSTALL FAILED 仓内副本不干净：\n" + chk.errors.join("\n"));
      process.exit(1);
    }
    const dest = join(target, COMPANION_ID);
    if (!apply) {
      console.log(`COMPANION INSTALL DRY-RUN ${srcDir} -> ${dest}（files=${chk.files} bytes=${chk.bytes}）`);
      console.log(`  rollback: rm -rf "${dest}"`);
      process.exit(0);
    }
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(srcDir, dest, { recursive: true });
    const installed = checkCompanion(dest);
    const lines = [
      `COMPANION INSTALL ${installed.ok ? "OK" : "CHECK FAILED"} ${dest}（files=${installed.files} bytes=${installed.bytes}）`,
      installed.ok ? "" : installed.errors.join("\n"),
      `  激活：宿主插件页打开开关，或重启 DSH —— 激活记录由宿主写进 ~/.dsh/plugin-activations.json（脚本不手改账本）`,
      `  核验：python3 -c "import json;print('${COMPANION_ID}' in json.load(open('$HOME/.dsh/plugin-activations.json'))['entries'])"`,
    ].filter(Boolean);
    console.log(lines.join("\n"));
    process.exit(installed.ok ? 0 : 1);
  }
  const chk = checkCompanion(srcDir);
  const asJson = argv.includes("--json");
  if (asJson) console.log(JSON.stringify({ ok: chk.ok, errors: chk.errors, files: chk.files, bytes: chk.bytes }, null, 2));
  else console.log(chk.ok ? `COMPANION CHECK OK id=${COMPANION_ID} files=${chk.files} bytes=${chk.bytes}` : "COMPANION CHECK FAILED\n" + chk.errors.join("\n"));
  process.exit(chk.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
