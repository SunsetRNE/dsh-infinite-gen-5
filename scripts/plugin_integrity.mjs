#!/usr/bin/env node
// 插件目录完整性清单（r5-01 处置件）
// 写入 / 校验插件目录内容清单：安装时记录，链接前校验，防「同名本地目录替换」。
// 用法： node scripts/plugin_integrity.mjs --write --dir DIR [--manifest FILE]
//        node scripts/plugin_integrity.mjs --verify --dir DIR [--manifest FILE] [--json]
//        node scripts/plugin_integrity.mjs --selftest
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

export const MANIFEST_NAME = ".plugin-manifest.sha256";
const SKIP_DIRS = new Set([".git", "node_modules", ".plugin-manifest.tmp"]);
const SKIP_FILES = new Set([MANIFEST_NAME]);

export function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else if (st.isFile()) out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

export function hashFiles(dir) {
  const map = new Map();
  for (const rel of walk(dir)) {
    const h = createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex");
    map.set(rel, h);
  }
  return map;
}

export function manifestText(map) {
  return [...map.keys()].sort().map((k) => `${map.get(k)}  ${k}`).join("\n") + "\n";
}

export function parseManifest(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]{64})\s\s(.+)$/.exec(line);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

export function diffManifests(expected, actual) {
  const added = [...actual.keys()].filter((k) => !expected.has(k));
  const removed = [...expected.keys()].filter((k) => !actual.has(k));
  const changed = [...expected.keys()].filter((k) => actual.has(k) && actual.get(k) !== expected.get(k));
  return { added, removed, changed, equal: !added.length && !removed.length && !changed.length };
}

export function verifyDir(dir, manifestPath = join(dir, MANIFEST_NAME)) {
  if (!existsSync(manifestPath)) return { state: "NO_MANIFEST", manifestPath };
  const expected = parseManifest(readFileSync(manifestPath, "utf8"));
  const actual = hashFiles(dir);
  const d = diffManifests(expected, actual);
  return { state: d.equal ? "OK" : "MISMATCH", manifestPath, files: actual.size, ...d };
}

function selftest() {
  const ok = [];
  const t = mkdtempSync(join(tmpdir(), "pi-"));
  mkdirSync(join(t, "sub"), { recursive: true });
  writeFileSync(join(t, "a.js"), "a");
  writeFileSync(join(t, "sub", "b.js"), "b");
  const m1 = hashFiles(t);
  ok.push(["遍历命中 2 件", m1.size === 2]);
  ok.push(["清单文本含相对路径", manifestText(m1).includes("sub/b.js")]);
  ok.push(["清单可解析回同样条数", parseManifest(manifestText(m1)).size === 2]);

  const mp = join(t, MANIFEST_NAME);
  writeFileSync(mp, manifestText(m1));
  ok.push(["写入后校验为 OK", verifyDir(t).state === "OK"]);

  writeFileSync(join(t, "a.js"), "a!");
  ok.push(["改一字节即 MISMATCH", verifyDir(t).state === "MISMATCH"]);
  ok.push(["改动项被点名", verifyDir(t).changed.includes("a.js")]);

  writeFileSync(mp, manifestText(hashFiles(t)));
  writeFileSync(join(t, "new.js"), "n");
  ok.push(["新增文件被判 added", verifyDir(t).added.includes("new.js")]);

  rmSync(join(t, "new.js"));
  writeFileSync(mp, manifestText(hashFiles(t)));
  rmSync(join(t, "sub", "b.js"));
  ok.push(["缺失文件被判 removed", verifyDir(t).removed.includes("sub/b.js")]);
  writeFileSync(join(t, "sub", "b.js"), "b");

  rmSync(mp);
  ok.push(["无清单返回 NO_MANIFEST", verifyDir(t).state === "NO_MANIFEST"]);
  ok.push([".git 与 node_modules 被跳过", (() => {
    mkdirSync(join(t, ".git"), { recursive: true });
    writeFileSync(join(t, ".git", "x"), "x");
    return hashFiles(t).size === 2;
  })()]);

  rmSync(t, { recursive: true, force: true });
  for (const [name, v] of ok) console.log(`${v ? "ok" : "FAIL"}(${name})`);
  const bad = ok.filter(([, v]) => !v).length;
  console.log(`plugin_integrity 自检${bad ? "未通过" : "通过"}（共 ${ok.length} 条）`);
  return bad ? 1 : 0;
}

const isEntry = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isEntry) {
  const argv = process.argv.slice(2);
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = get("--dir") || process.cwd();
  if (argv.includes("--selftest")) process.exit(selftest());
  if (argv.includes("--write")) {
    const map = hashFiles(dir);
    const out = get("--manifest") || join(dir, MANIFEST_NAME);
    writeFileSync(out, manifestText(map));
    console.log(`已写入 ${out}（${map.size} 件）`);
    process.exit(0);
  }
  if (argv.includes("--verify")) {
    const r = verifyDir(dir, get("--manifest") || join(dir, MANIFEST_NAME));
    console.log(JSON.stringify(r, null, argv.includes("--json") ? 2 : 0));
    if (r.state === "OK") { console.log("PLUGIN_INTEGRITY=OK"); process.exit(0); }
    console.log(`PLUGIN_INTEGRITY=${r.state}`);
    process.exit(r.state === "NO_MANIFEST" ? 3 : 1);
  }
  console.log("用法：--write --dir DIR | --verify --dir DIR [--json] | --selftest");
  process.exit(2);
}
