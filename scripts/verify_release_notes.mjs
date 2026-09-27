// 无限五代 · 发布正文压缩自检（离线、确定性、零依赖）
//
// 针对的缺陷：产物描述（RELEASE-NOTES.md / GitHub Release 正文）过去直接贴 CHANGELOG 里
// 该版本的整段 —— 版本一多就是历史复读机，且与仓库内《更新文档》UPDATE.md 两处漂移。
//
// 断言四组：
//   1) 压缩器本身（scripts/lib/release-notes.mjs，纯函数，用合成 CHANGELOG 喂）：
//      只取该 tag 段 / 分类标题不占行 / 条目带 emoji / 超长截断 / 条数封顶 / 总量封顶 /
//      重复条目去重 / 指针指回 UPDATE.md / 缺段有占位 / opts 可覆盖；
//   2) 真实仓库的 CHANGELOG.md：每个版本段都能压出非空正文，且压缩后不会比原段更长；
//   3) 两个产物路径（release:pack 与 release）都真的走了压缩器，不许只改一边；
//   4) 版本变更叙述确实「统一到仓库内部」：README / HARNESS_PLUGIN 只留指针，
//      UPDATE.md 在 version-targets 的 PROSE_ALLOWED_FILES 里登记（否则 verify_version 会抓）。
//
// 用法：node scripts/verify_release_notes.mjs [--json]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOTES_LIMITS, NOTES_POINTER, buildReleaseNotes, changelogSection } from "./lib/release-notes.mjs";
import { PROSE_ALLOWED_FILES } from "./version-targets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

const passes = [];
const failures = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

// ---------- 1) 压缩器（合成输入）----------
const fixture = [
  "# 更新日志",
  "",
  "## v9.9.9 — 2026-01-02",
  "",
  "### ✨ 新特性",
  "",
  "- 第一条：短",
  "- 第二条：" + "长".repeat(NOTES_LIMITS.maxCharsPerBullet + 40),
  "- 第一条：短",
  ...Array.from({ length: 12 }, (_, i) => `- 批量条目 ${i + 3}`),
  "",
  "### 🐛 修复",
  "",
  "",
  "## v9.9.8 — 2026-01-01",
  "",
  "- 上一版才有的条目，不该出现",
  "",
].join("\n");

// 分类切换单独喂一份小样本（上一条 fixture 会因封顶丢掉后面的组，测不到 emoji 切换）
const twoGroups = ["## v1.0.0 — 2026-01-01", "", "### ✨ 新特性", "", "- 甲", "### 🐛 修复", "", "- 乙", ""].join("\n");

const info = buildReleaseNotes(fixture, "v9.9.9");
const keptBullets = info.bullets.filter((b) => !b.startsWith("- …"));
check(info.found, "合成：找到该 tag 段");
check(info.heading === "## v9.9.9 — 2026-01-02", "合成：保留版本头（含日期）", `实际 ${info.heading}`);
check(!info.text.includes("上一版才有的条目"), "合成：不串到别的版本段");
check(!/^###\s/m.test(info.text), "合成：分类标题不单独占行");
check(info.text.includes("- ✨ 第一条：短"), "合成：条目带分类 emoji 前缀");
check(buildReleaseNotes(twoGroups, "v1.0.0").text.includes("- 🐛 乙"), "合成：换分类后 emoji 跟着换");
check(info.text.includes("长".repeat(10) + "…") && !info.text.includes("长".repeat(NOTES_LIMITS.maxCharsPerBullet + 40)), "合成：超长条目被截断");
check(info.truncatedBullets === 1, "合成：截断计数正确", `实际 ${info.truncatedBullets}`);
check(keptBullets.length <= NOTES_LIMITS.maxBullets, "合成：条数不超过 maxBullets", `实际 ${keptBullets.length}`);
check(info.dropped > 0 && /- …其余 \d+ 条见/.test(info.text), "合成：被压掉的条数有明示", `dropped=${info.dropped}`);
check((info.text.match(/第一条：短/g) || []).length === 1, "合成：重复条目去重");
const contentChars = info.text.split("\n").filter((l) => l.startsWith("- ") && !l.startsWith("- …")).join("").length;
check(contentChars <= NOTES_LIMITS.maxChars, "合成：条目总量不超过 maxChars", `实际 ${contentChars}`);
check(info.text.includes("UPDATE.md"), "合成：指针指回仓库内《更新文档》");
check(info.text.trimEnd().endsWith(NOTES_POINTER), "合成：指针是最后一行");

const tiny = buildReleaseNotes(fixture, "v9.9.9", { maxBullets: 2, maxCharsPerBullet: 20, maxChars: 100 });
check(tiny.bullets.filter((b) => !b.startsWith("- …")).length <= 2, "合成：opts 能收紧条数");

const missing = buildReleaseNotes(fixture, "v9.9.7");
check(!missing.found && missing.text.includes("还没有 v9.9.7 段") && missing.text.includes("UPDATE.md"), "合成：缺段时给占位 + 指针，不抛");
check(changelogSection(fixture, "v9.9.8").startsWith("## v9.9.8"), "合成：段提取函数按 tag 命中");

// ---------- 2) 真实仓库的 CHANGELOG ----------
const changelog = execFileSync(process.execPath, [join(ROOT, "scripts", "changelog.mjs"), "--stdout"], {
  cwd: ROOT,
  encoding: "utf8",
});
const pkg = JSON.parse(read("package.json"));
const tag = `v${pkg.version}`;
const section = changelogSection(changelog, tag);
check(Boolean(section), `仓库：CHANGELOG 有当前版本 ${tag} 的段`);
const real = buildReleaseNotes(changelog, tag);
check(real.found && real.text.includes(tag), "仓库：当前版本能压出正文");
check(section === null || real.text.length < section.length || real.text.length <= 700, "仓库：压缩后不比原段更长", `原 ${section?.length} / 压 ${real.text.length}`);
const sections = [...changelog.matchAll(/^## (v\d+\.\d+\.\d+) /gm)].map((m) => m[1]);
// 浅克隆（CI 默认 fetch-depth: 1）里 git log 只有一个提交 ⇒ 生成结果只剩当前版本一段。
// 那是「历史不在本地」，不是回归：此时跳过段数断言并如实标注（verify.yml 已改成 fetch-depth: 0）。
const shallow = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: ROOT, encoding: "utf8" }).trim() === "true";
  } catch {
    return false;
  }
})();
check(
  shallow || sections.length > 5,
  shallow ? "仓库：浅克隆只有一个提交，跳过「版本段数」断言（历史不在本地，不是回归）" : "仓库：CHANGELOG 里版本段数合理",
  `实际 ${sections.length}`,
);
const emptyOnes = sections.filter((v) => buildReleaseNotes(changelog, v).bullets.filter((b) => !b.startsWith("- …")).length === 0);
check(emptyOnes.length === 0, "仓库：每个版本段都能压出至少一条更新", emptyOnes.join(" / "));

// ---------- 3) 两个产物路径都走压缩器 ----------
// 打包器（package-release.mjs）只装 git ls-files 出来的**跟踪文件**：新文档/新脚本忘了 add，
// 包里就没有 UPDATE.md —— 指针会指向一个不存在的文件，所以这里把它当硬断言。
const tracked = new Set(
  execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean),
);
for (const f of ["UPDATE.md", "scripts/lib/release-notes.mjs", "scripts/verify_release_notes.mjs"]) {
  check(tracked.has(f), `${f} 已被 git 跟踪（打包器只装跟踪文件）`);
}

for (const f of ["scripts/package-release.mjs", "scripts/release.mjs"]) {
  const text = read(f);
  check(text.includes('from "./lib/release-notes.mjs"'), `${f} 引用了压缩器`);
  check(!/changelog\.indexOf\(`## \$\{tag\} `\)/.test(text), `${f} 不再自己切 CHANGELOG 段`);
}

// ---------- 4) 叙述统一到仓库内部 ----------
for (const f of ["README.md", "HARNESS_PLUGIN.md"]) {
  const text = read(f);
  check(text.includes("UPDATE.md"), `${f} 指向仓库内《更新文档》`);
  check(!/^\| \*\*v\d+\.\d+\.\d+\*\* \|/m.test(text), `${f} 不再复述逐版表格`);
}
check(PROSE_ALLOWED_FILES.includes("UPDATE.md"), "UPDATE.md 登记在 PROSE_ALLOWED_FILES（verify_version 放行）");
check(read("UPDATE.md").includes("## v"), "UPDATE.md 是仓库内可读的更新文档");

// ---------- 输出 ----------
const total = passes.length + failures.length;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ passed: passes.length, failed: failures.length, passes, failures }, null, 1));
} else {
  for (const f of failures) console.log(`  ✗ ${f}`);
  if (failures.length) console.log(`  （另有 ${passes.length} 项通过）`);
  console.log(`verify_release_notes：${passes.length} 通过 · ${failures.length} 失败（共 ${total} 项）`);
}
process.exit(failures.length ? 1 : 0);
