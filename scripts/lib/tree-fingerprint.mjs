/**
 * 无限五代 · 目录指纹（复刻宿主插件管理器的算法）
 *
 * 宿主 `~/.dsh/plugin-dependencies.py` 的 `current(root)['sha256']` 是插件管理器
 * 用来记「这份安装树是哪一份内容」的指纹：plugin-activations.json 的 `fingerprint`、
 * 以及 `plugin-lifecycle.py` 里「加载前内容变没变」的比对，都用它。
 *
 * 算法（逐行对齐宿主实现，别凭记忆改）：
 *   1) 遍历插件目录（`node_modules` 不进遍历，`.dsha-dependencies.json` 自身不算内容）；
 *   2) 每个条目按 base 内 `sorted(directories + files)` 的顺序产出一行 JSON：
 *        ['file', 相对路径, 权限位, 文件 sha256]
 *        ['directory', 相对路径, 权限位]
 *        ['link', 相对路径, 链接原文, 目标文件 sha256]
 *        ['directory-link', 相对路径, 链接原文]（别名目录不递归）
 *      每行 `json.dumps(row, ensure_ascii=True, separators=(',',':'))` 再补一个 `\n` 累进 sha256；
 *   3) 单节点图 `{绝对路径: {name, version, codeSha256, dependencies}}`（键排序、无空格）
 *      再 sha256 一次 —— 零依赖插件的 `dependencies` 就是 `{}`。
 *
 * 已实证：本文件对 `dsh-whale-widget` 算出 62d110fe6d2d049fde392b0ad588226dd88bc224221d7a57785d6257aafe47c7，
 * 与 `~/.dsh/plugin-activations.json` 里宿主自己记的指纹逐字符一致。
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

const SNAPSHOT = ".dsha-dependencies.json";
const MAX_ENTRIES = 100000;

/** python 的 json.dumps(..., ensure_ascii=True, separators=(',', ':'))：非 ASCII 一律转 \uXXXX。 */
export function hostJson(value) {
  return JSON.stringify(value).replace(/[^\x00-\x7f]/g, (ch) => {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const rest = cp - 0x10000;
      const hi = 0xd800 + (rest >> 10);
      const lo = 0xdc00 + (rest & 0x3ff);
      return `\\u${hi.toString(16)}\\u${lo.toString(16)}`;
    }
    return `\\u${cp.toString(16).padStart(4, "0")}`;
  });
}

const digestFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** 复刻 `current()` 里 `code` 那一轮哈希：只算这一棵目录的内容。 */
export function codeSha256(root) {
  const top = realpathSync(root);
  const hash = createHash("sha256");
  let entries = 0;

  const visit = (base, isRoot) => {
    const dirents = readdirSync(base, { withFileTypes: true });
    const dirs = [];
    const files = [];
    for (const d of dirents) {
      if (isRoot && d.name === "node_modules") continue; // 宿主在根上剔除 node_modules
      (d.isDirectory() && !d.isSymbolicLink() ? dirs : files).push(d.name);
    }
    dirs.sort();
    files.sort();
    const names = [...dirs, ...files].sort(); // sorted(directories + files)
    const realDirs = [];
    for (const name of names) {
      const path = join(base, name);
      const rel = relative(top, path).split(sep).join("/");
      if (rel === SNAPSHOT) continue;
      if (++entries > MAX_ENTRIES) throw new Error(`目录条目超过审阅上限（>${MAX_ENTRIES}）`);
      const info = lstatSync(path);
      let row;
      if (info.isSymbolicLink()) {
        const target = realpathSync(path);
        if (statSync(target).isFile()) row = ["link", rel, readlinkSync(path), digestFile(target)];
        else row = ["directory-link", rel, readlinkSync(path)];
      } else if (info.isFile()) {
        row = ["file", rel, info.mode & 0o7777, digestFile(path)];
      } else if (info.isDirectory()) {
        row = ["directory", rel, info.mode & 0o7777];
        realDirs.push(name);
      } else {
        throw new Error(`目录里有无法审阅的特殊文件：${rel}`);
      }
      hash.update(hostJson(row));
      hash.update("\n");
    }
    for (const name of realDirs) visit(join(base, name), false); // os.walk 不跟随目录软链
  };

  visit(top, true);
  return hash.digest("hex");
}

/* ---------- 依赖图那一半（宿主 current() 的 edges + 多节点图） ---------- */

const MAX_NODES = 2000;
const MAX_EDGES = 50000;

/** 宿主 Dependencies.current() 里的全局搜索目录，顺序即优先级。 */
export function defaultGlobalDirs(env = process.env) {
  const home = env.DSH_HOME || join(env.HOME || "/root", ".dsh");
  return [
    join(home, "node_modules"),
    "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules",
    "/usr/local/lib/node_modules",
  ];
}

const isFile = (path) => { try { return statSync(path).isFile(); } catch { return false; } };
const isDir = (path) => { try { return statSync(path).isDir(); } catch { return false; } };

/** 键排序 + ensure_ascii 的序列化（= json.dumps(sort_keys=True, separators=(',',':'))）。 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${hostJson(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return hostJson(value);
}

/** 复刻 backup-plugin-graph.py:21 resolve_module：先沿父链找 node_modules，再查全局目录。 */
export function resolveModule(source, name, globalDirs = defaultGlobalDirs()) {
  for (let parent = source; ; parent = dirname(parent)) {
    if (basename(parent) !== "node_modules" && isFile(join(parent, "node_modules", name, "package.json"))) {
      return realpathSync(join(parent, "node_modules", name));
    }
    if (dirname(parent) === parent) break;
  }
  for (const base of globalDirs) {
    if (isFile(join(base, name, "package.json"))) return realpathSync(join(base, name));
  }
  return null;
}

/**
 * 复刻 `current(root)['sha256']`：从 root 起解析依赖边，拼出多节点图再整体哈希一次。
 * 节点 = {codeSha256, dependencies, name, version}；边 = 找到时 {kind, requested, target}
 * （target 也进图），没找到时 {hostService, kind, missing, optional, requested}。
 */
export function treeFingerprint(root, options = {}) {
  const globalDirs = options.globalDirs ?? defaultGlobalDirs();
  const shared = new Set(globalDirs.filter(isDir).map((dir) => realpathSync(dir)));
  const pending = [realpathSync(root)];
  const queued = new Set(pending);
  const graph = {};
  while (pending.length) {
    const source = pending.shift();
    if (graph[source]) continue;
    if (Object.keys(graph).length >= MAX_NODES) throw new Error(`插件依赖图超过审阅上限（>${MAX_NODES} 节点）`);
    const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    const requirements = new Map();
    for (const section of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      const declared = pkg[section] ?? {};
      if (declared === null || typeof declared !== "object" || Array.isArray(declared)) {
        throw new Error(`插件依赖声明必须是对象：${source} 的 ${section}`);
      }
      for (const [name, requested] of Object.entries(declared)) requirements.set(name, { requested, kind: section });
    }
    const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
    for (const [name, meta] of Object.entries(pkg.peerDependenciesMeta ?? {})) {
      if (meta && typeof meta === "object" && meta.optional) optional.add(name);
    }
    const embedded = join(source, "node_modules");
    if (isDir(embedded) && !shared.has(realpathSync(embedded))) {
      for (const child of readdirSync(embedded)) {
        const scoped = child.startsWith("@");
        const names = scoped && isDir(join(embedded, child))
          ? readdirSync(join(embedded, child)).map((sub) => `${child}/${sub}`)
          : [child];
        for (const name of names) {
          if (isFile(join(embedded, name, "package.json")) && !requirements.has(name)) {
            requirements.set(name, { requested: "*", kind: "bundled" });
          }
        }
      }
    }
    const edges = {};
    for (const [name, { requested, kind }] of [...requirements.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (Object.keys(edges).length >= MAX_EDGES) throw new Error(`插件依赖图超过审阅上限（>${MAX_EDGES} 条边）`);
      const target = resolveModule(source, name, globalDirs);
      if (target === null) {
        edges[name] = {
          hostService: kind === "peerDependencies" && name.startsWith("@deepseek-ai/dsh-"),
          kind, missing: true, optional: optional.has(name), requested,
        };
      } else {
        edges[name] = { kind, requested, target };
        if (!queued.has(target)) { queued.add(target); pending.push(target); }
      }
    }
    graph[source] = { codeSha256: codeSha256(source), dependencies: edges, name: pkg.name, version: String(pkg.version ?? "") };
  }
  return createHash("sha256").update(stableJson(graph)).digest("hex");
}
