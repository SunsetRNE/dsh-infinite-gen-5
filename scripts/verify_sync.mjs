#!/usr/bin/env node
/**
 * 无限五代 · 本机安装树同步自检（verify_sync）
 *
 * 两块：
 *   1) 指纹算法冻结 —— scripts/lib/tree-fingerprint.mjs 复刻的是宿主
 *      `~/.dsh/plugin-dependencies.py` 的 `current()`：这份值一旦算错，激活记录就是假账。
 *      本机存在真实 `plugin-activations.json` 时，直接用宿主**自己记过的指纹**当标准答案交叉验证；
 *      另外用一颗确定性 fixture 把 codeSha256 冻成一个常量，防止有人顺手改算法。
 *   2) 同步行为 —— 在临时目录里造假 repo / 假 DSH_HOME，验证：只读预览不落盘、--yes 增改删、
 *      安装树独有的 .dsha-dependencies.json 保留、权限位跟随源文件、二次运行幂等、
 *      激活记录刷新（含备份）与 --no-record、管理器没登记时不乱写。
 *
 * 全程只在 mkdtemp 出来的临时目录里动手，不碰真实 ~/.dsh（仅第 1 块做只读交叉验证）。
 *
 * 用法: node scripts/verify_sync.mjs [--dsh-home=/root/.dsh] [--json]
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codeSha256, treeFingerprint } from "./lib/tree-fingerprint.mjs";

const NAME = "dsh-infinite-gen-5";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SYNC = join(REPO, "scripts", "sync-local.mjs");
const argv = process.argv.slice(2);
const wantJson = argv.includes("--json");
const argOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(name + "="));
  return hit ? hit.slice(name.length + 1) : fallback;
};

/** 确定性 fixture 的 codeSha256 冻值（改算法必须同时改这里，并说明理由）。 */
const FIXTURE_CODE_SHA = "9b0f237f66909037d35a41443175022ad38957ff4dd57b6766b31cbece7b1104";

const passes = [];
const failures = [];
const warnings = [];
const check = (okFlag, label, detail) => (okFlag ? passes : failures).push({ label, detail });
const warn = (label, detail) => warnings.push({ label, detail });

const w = (path, content, mode = 0o644) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, mode);
};

// ---------- 1) 复刻宿主算法：真实记录当标准答案 ----------
const dshHome = resolve(argOf("--dsh-home", process.env.DSH_HOME || join(homedir(), ".dsh")));
let oracle = 0;
let oracleChecked = 0;
try {
  const act = JSON.parse(readFileSync(join(dshHome, "plugin-activations.json"), "utf8"));
  for (const [name, rec] of Object.entries(act.entries ?? {})) {
    if (rec.status !== "loaded" || !rec.fingerprint) continue;
    const dir = join(dshHome, "plugin-src", name);
    if (!existsSync(join(dir, "package.json"))) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    oracle += 1;
    if (String(pkg.version ?? "") !== String(rec.version ?? "")) continue; // 装过又改过，指纹本来就该不同
    oracleChecked += 1;
    check(
      treeFingerprint(dir) === rec.fingerprint,
      `指纹算法 = 宿主记录（${name}）`,
      `${rec.fingerprint.slice(0, 12)}…`,
    );
  }
} catch {
  // 没有真实 ~/.dsh 或格式不对：不做交叉验证，交给下面的冻值兜底
}
if (oracle === 0) warn("没有可用的宿主指纹做交叉验证", "跳过（CI 或没装插件）");
else if (oracleChecked === 0) warn("宿主记录都在「装过又改过」状态", `跳过 ${oracle} 条`);

// ---------- fixture：确定性内容（不依赖 umask） ----------
const root = mkdtempSync(join(tmpdir(), "ig5-sync-"));
const fakeRepo = join(root, "repo");
const fakeHome = join(root, "home");
const dest = join(fakeHome, "plugin-src", NAME);
const actFile = join(fakeHome, "plugin-activations.json");

w(join(fakeRepo, "package.json"), JSON.stringify({ name: NAME, version: "9.9.9" }, null, 2) + "\n");
w(join(fakeRepo, "index.js"), "export const KERNEL = 'v9';\n");
w(join(fakeRepo, "prompts", "infinite-gen-5.md"), "# kernel\n");
w(join(fakeRepo, "tests", "测试数据获取方式.md"), "中文名文件\n");
w(join(fakeRepo, "bin", "tool.mjs"), "#!/usr/bin/env node\n", 0o755);
w(join(fakeRepo, "node_modules", "junk", "index.js"), "module.exports = 1;\n");
w(join(fakeRepo, ".git", "config"), "[core]\n");
w(join(fakeRepo, "ui-preview", "preview.html"), "<html></html>\n");

check(codeSha256(fakeRepo) === FIXTURE_CODE_SHA, "codeSha256 冻值（确定性 fixture）", codeSha256(fakeRepo));

// node_modules / .git / ui-preview 不进指纹
const scratch = join(root, "scratch");
cpSync(fakeRepo, scratch, { recursive: true });
w(join(scratch, "node_modules", "junk", "extra.js"), "module.exports = 2;\n");
check(codeSha256(scratch) === FIXTURE_CODE_SHA, "node_modules 内容不进指纹", "加了文件也应当不变");
// 内容变了 → 指纹变
w(join(scratch, "index.js"), "export const KERNEL = 'v10';\n");
check(codeSha256(scratch) !== FIXTURE_CODE_SHA, "内容变化 → 指纹变化", "改一行 index.js");
// 版本变了 → 图指纹变，内容指纹不变
const codeBefore = codeSha256(fakeRepo);
const fpBefore = treeFingerprint(fakeRepo);
w(join(fakeRepo, "package.json"), JSON.stringify({ name: NAME, version: "9.9.10" }, null, 2) + "\n");
check(treeFingerprint(fakeRepo) !== fpBefore, "版本变化 → 图指纹变化", "9.9.9 → 9.9.10");
w(join(fakeRepo, "package.json"), JSON.stringify({ name: NAME, version: "9.9.9" }, null, 2) + "\n");
check(codeSha256(fakeRepo) === codeBefore && treeFingerprint(fakeRepo) === fpBefore, "改回版本 → 指纹复原", "确定性");

// ---------- 2) 假 DSH_HOME：接线 + 一份旧安装树 ----------
w(
  join(fakeHome, "profiles", "web", "package.json"),
  JSON.stringify({ name: "web", dependencies: { [NAME]: `link:${dest}` } }, null, 2) + "\n",
);
w(join(dest, "package.json"), JSON.stringify({ name: NAME, version: "0.0.1" }, null, 2) + "\n");
w(join(dest, "index.js"), "export const KERNEL = 'old';\n");
w(join(dest, "prompts", "infinite-gen-5.md"), "# kernel\n");
w(join(dest, "STALE.txt"), "仓库里已经没有这个文件了\n");
w(join(dest, "sub", "leftover.txt"), "空目录也该被清掉\n");
w(join(dest, ".dsha-dependencies.json"), '{"format":1,"plugin":"' + NAME + '","version":"0.0.1"}\n');
w(
  actFile,
  JSON.stringify(
    {
      format: 1,
      entries: {
        [NAME]: { status: "loaded", fingerprint: "deadbeef", version: "0.0.1", confirmedAt: 1, startup: "u-1", loadedAt: 2 },
      },
    },
    null,
    2,
  ) + "\n",
);

const runSync = (args) => {
  try {
    const out = execFileSync(process.execPath, [SYNC, `--dsh-home=${fakeHome}`, `--repo=${fakeRepo}`, ...args, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, json: JSON.parse(out) };
  } catch (error) {
    let json = null;
    try {
      json = JSON.parse(String(error.stdout ?? ""));
    } catch {}
    return { code: error.status ?? 1, json, stderr: String(error.stderr ?? "") };
  }
};

const readAct = () => JSON.parse(readFileSync(actFile, "utf8")).entries[NAME];

// 只读预览：不改磁盘、不动记录
const preview = runSync([]);
check(preview.code === 0, "只读预览 exit 0", String(preview.code));
check(preview.json?.targets?.[0]?.add === 2, "预览识别出 2 个新增", `add=${preview.json?.targets?.[0]?.add}`);
check(preview.json?.targets?.[0]?.update === 2, "预览识别出 2 个更新", `update=${preview.json?.targets?.[0]?.update}`);
check(preview.json?.targets?.[0]?.remove === 2, "预览识别出 2 个删除", `remove=${preview.json?.targets?.[0]?.remove}`);
check(existsSync(join(dest, "STALE.txt")), "预览不落盘", "STALE.txt 还在");
check(readAct().version === "0.0.1", "预览不写激活记录", readAct().version);

// --yes：真同步
const applied = runSync(["--yes"]);
check(applied.code === 0, "同步 exit 0", String(applied.code));
check(readFileSync(join(dest, "package.json"), "utf8").includes("9.9.9"), "package.json 已更新", "0.0.1 → 9.9.9");
check(readFileSync(join(dest, "index.js"), "utf8").includes("v9"), "index.js 已更新", "内容取自仓库");
check(existsSync(join(dest, "tests", "测试数据获取方式.md")), "中文名新文件已铺", "tests/测试数据获取方式.md");
check(!existsSync(join(dest, "STALE.txt")), "仓库里没有的文件被删", "STALE.txt");
check(!existsSync(join(dest, "sub")), "空目录一起清掉", "sub/");
check(existsSync(join(dest, ".dsha-dependencies.json")), "安装树独有的依赖快照保留", ".dsha-dependencies.json");
check((statSync(join(dest, "bin", "tool.mjs")).mode & 0o7777) === 0o755, "权限位跟随源文件", "bin/tool.mjs = 0755");
check(!existsSync(join(dest, "node_modules")), "node_modules 不进安装树", "被跳过");

const rec = readAct();
check(rec.version === "9.9.9", "激活记录版本已刷新", rec.version);
check(rec.fingerprint === treeFingerprint(dest), "激活记录指纹 = 现树指纹", String(rec.fingerprint).slice(0, 12) + "…");
check(rec.status === "loaded" && rec.startup === "u-1", "记录其它字段不动", `${rec.status} / ${rec.startup}`);
const backups = readdirSync(fakeHome).filter((n) => n.startsWith("plugin-activations.json.bak-"));
check(backups.length === 1, "刷新前留了一份备份", backups[0] ?? "没有");

// 幂等
const again = runSync(["--yes"]);
const t = again.json?.targets?.[0] ?? {};
check(t.add + t.update + t.remove === 0, "二次运行幂等", `add=${t.add} update=${t.update} remove=${t.remove}`);
check(again.json?.record?.state === "clean", "记录已一致时不再重写", again.json?.record?.state);

// --no-record：只铺树不碰记录
w(actFile, JSON.stringify({ format: 1, entries: { [NAME]: { ...rec, version: "0.0.1" } } }, null, 2) + "\n");
const noRec = runSync(["--yes", "--no-record"]);
check(noRec.code === 0 && readAct().version === "0.0.1", "--no-record 不碰激活记录", readAct().version);

// 管理器没登记：只告警，不当失败
writeFileSync(actFile, JSON.stringify({ format: 1, entries: {} }, null, 2) + "\n");
const missing = runSync(["--yes"]);
check(missing.code === 0 && missing.json?.record?.state === "missing", "没登记时不乱写记录", missing.json?.record?.state);

// 前置条件：dshHome 不存在 / 仓库 name 不对
const badHome = (() => {
  try {
    execFileSync(process.execPath, [SYNC, `--dsh-home=${join(root, "nope")}`, `--repo=${fakeRepo}`, "--json"], { encoding: "utf8" });
    return 0;
  } catch (error) {
    return error.status ?? 1;
  }
})();
check(badHome === 2, "缺 DSH_HOME → exit 2", String(badHome));
const badRepo = (() => {
  try {
    execFileSync(process.execPath, [SYNC, `--dsh-home=${fakeHome}`, `--repo=${fakeHome}`, "--json"], { encoding: "utf8" });
    return 0;
  } catch (error) {
    return error.status ?? 1;
  }
})();
check(badRepo === 2, "仓库 name 不对 → exit 2", String(badRepo));

// 热链接态：安装树就是仓库，同步应当是空操作
const linkHome = join(root, "linkhome");
w(join(linkHome, "profiles", "web", "package.json"), JSON.stringify({ name: "web", dependencies: { [NAME]: `link:${join(linkHome, "plugin-src", NAME)}` } }, null, 2) + "\n");
mkdirSync(join(linkHome, "plugin-src"), { recursive: true });
symlinkSync(fakeRepo, join(linkHome, "plugin-src", NAME), "dir");
let hot = null;
try {
  hot = JSON.parse(
    execFileSync(process.execPath, [SYNC, `--dsh-home=${linkHome}`, `--repo=${fakeRepo}`, "--yes", "--json"], { encoding: "utf8" }),
  );
} catch {}
check(
  hot?.targets?.[0]?.hotlink === true && hot.targets[0].add + hot.targets[0].update + hot.targets[0].remove === 0,
  "热链接态识别为空操作",
  `hotlink=${hot?.targets?.[0]?.hotlink}`,
);

rmSync(root, { recursive: true, force: true });

// ---------- 报告 ----------
if (wantJson) {
  console.log(JSON.stringify({ passes, failures, warnings }, null, 2));
} else {
  for (const p of passes) console.log(`  ✓ ${p.label}${p.detail ? " — " + p.detail : ""}`);
  for (const f of failures) console.log(`  ✗ ${f.label}${f.detail ? " — " + f.detail : ""}`);
  for (const m of warnings) console.log(`  ⚠ ${m.label}${m.detail ? " — " + m.detail : ""}`);
  console.log(`\nverify_sync：${passes.length} 通过 · ${failures.length} 失败 · ${warnings.length} 警告`);
}
process.exit(failures.length > 0 ? 1 : 0);
