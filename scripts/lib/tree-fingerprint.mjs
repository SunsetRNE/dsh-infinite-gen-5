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
import { join, relative, sep } from "node:path";

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

/** 复刻 `current(root)['sha256']`：单节点依赖图再哈希一次。 */
export function treeFingerprint(root) {
  const top = realpathSync(root);
  const pkg = JSON.parse(readFileSync(join(top, "package.json"), "utf8"));
  const name = pkg.name;
  const version = String(pkg.version ?? "");
  const node = `{"codeSha256":"${codeSha256(top)}","dependencies":{},"name":${hostJson(name)},"version":${hostJson(version)}}`;
  return createHash("sha256").update(`{${hostJson(top)}:${node}}`).digest("hex");
}
