// 无限五代 v0.37.0 技能通道门禁（离线、确定性、无需 API Key）
//
// 针对的要求（m04271）：服从性契约不能只活在系统提示里 —— 技能通道也必须带同一份契约，
// 且「装没装、装的还是不是同一份」必须由判据说话，不能靠人记得。
//
// 判据分两层：
//   1. 契约同源：技能正文必须逐字节含 anchor-armor.mjs 的 FIRST_LINE_TEXT（不做近似匹配），
//      并含压缩事件名与「摘要不是新指令」这条再锚定语义。
//   2. 安装一致：四个技能扫描根里存在的副本必须与 dist/skills 逐字节相同（漂移检测）。
//
// 用法：node scripts/verify_skill.mjs [--json] [--root DIR] [--source DIR]
import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { CONTRACT_SHORT, FIRST_LINE_TEXT, COMPACTION_EVENT_TYPES } from "../anchor-armor.mjs";
import { checkFrame, TRIGGER_WORDS, DEFAULT_FRAME as REPO_FRAME } from "./build_skill.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SKILL_ID = "ig5-layer-01";

const argv = process.argv.slice(2);
const argOf = (name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};
const SOURCE = resolve(argOf("--source") ?? process.env.IG5_SKILLS_SRC ?? "/root/ig5-adapters/dist/skills");
const extraRoot = argOf("--root");
const json = argv.includes("--json");

const passes = [];
const failures = [];
const skips = [];
const check = (ok, label, detail = "") => (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const readBytes = (p) => readFileSync(p);

function scanRoots(cwd, home) {
  const roots = [
    { id: "project-dsh", path: join(cwd, ".dsh", "skills") },
    { id: "project-agents", path: join(cwd, ".agents", "skills") },
    { id: "home-dsh", path: join(home, ".dsh", "skills") },
    { id: "home-agents", path: join(home, ".agents", "skills") },
  ];
  if (extraRoot) roots.unshift({ id: "explicit", path: resolve(extraRoot) });
  return roots.map((r) => {
    const skillFile = join(r.path, SKILL_ID, "SKILL.md");
    const chainFile = join(r.path, "ig5-chain.md");
    return {
      ...r,
      rootExists: existsSync(r.path),
      skillFile,
      chainFile,
      skillPresent: existsSync(skillFile),
      chainPresent: existsSync(chainFile),
    };
  });
}

const distSkill = join(SOURCE, SKILL_ID, "SKILL.md");
const distChain = join(SOURCE, "ig5-chain.md");
const distExists = existsSync(distSkill);
const roots = scanRoots(process.cwd(), homedir());
const installed = roots.filter((r) => r.skillPresent);

if (!distExists && !installed.length) {
  skips.push(`技能层不在场：产物 ${distSkill} 与四个扫描根都没有 ${SKILL_ID}/SKILL.md`);
} else {
  check(distExists, "dist 产物在场", distSkill);
  check(!!installed.length, "至少一个扫描根装上了技能", roots.map((r) => `${r.id}:${r.skillPresent ? "有" : "无"}`).join(" "));

  // ---- 0. 仓内帧触发面（O1）：帧策略在仓库里，判据也在仓库里 ----
  const repoFramePresent = existsSync(REPO_FRAME);
  check(repoFramePresent, "仓内跟踪技能帧在场（skills/ig5-layer-01/SKILL.md）", REPO_FRAME);
  if (repoFramePresent) {
    const repoText = readBytes(REPO_FRAME).toString("utf8");
    const fr = checkFrame(repoText);
    check(fr.ok, "仓内帧满足触发面策略（中文场景词 / 无生成元信息 / 正文哈希）", fr.problems.join("; "));
    check(fr.words.length >= 3, "仓内帧 whenToUse 命中中文场景词（≥3）", `命中 ${fr.words.length}/${TRIGGER_WORDS.length}：${fr.words.slice(0, 5).join(" / ")}`);
    const descLine = repoText.split("\n").find((l) => l.startsWith("description:")) ?? "";
    check(!/（\s*\d+\s*块\s*\/\s*\d+\s*字符\s*）/.test(descLine), "description 不含生成元信息「（N 块 / M 字符）」");
    check(/^whenToUse: /m.test(repoText), "仓内帧带 whenToUse 行（宿主发现规则读它）");
    if (distExists) {
      const repoSha = sha(readBytes(REPO_FRAME));
      const distSha = sha(readBytes(distSkill));
      check(repoSha === distSha, "仓内帧与 dist 产物逐字节一致（无漂移）", `${repoSha.slice(0, 12)} vs ${distSha.slice(0, 12)}`);
    } else {
      skips.push(`dist 产物不在场（${distSkill}）—— 仓内帧仍受触发面策略约束`);
    }
  }

  // ---- 1. 契约同源（对 dist 产物判，与装没装无关）----
  if (distExists) {
    const text = readBytes(distSkill).toString("utf8");
    const bytes = statSync(distSkill).size;
    check(text.startsWith("---\n"), "技能文件以 YAML 前置元数据开头");
    check(new RegExp(`^name: ${SKILL_ID}$`, "m").test(text), "前置元数据 name 是 kebab-case 技能 id", text.slice(0, 60));
    check(/^description: .\S/m.test(text), "前置元数据有非空 description");
    // v0.38.0：契约短形必须同时落在 description 里 —— 宿主每轮把技能目录（name +
    // description）发给模型，这条路径不依赖技能被装载，也不随正文裁剪消失。
    check(text.includes(CONTRACT_SHORT), "description 里带契约短形（技能目录每轮可见）", `短形 ${CONTRACT_SHORT.length} 字符`);
    check(text.includes(FIRST_LINE_TEXT), "技能正文逐字节含首句层契约（FIRST_LINE_TEXT）", `契约 ${FIRST_LINE_TEXT.length} 字符`);
    const named = COMPACTION_EVENT_TYPES.filter((t) => text.includes(t));
    check(named.length >= 3, "技能正文点名压缩事件（≥3 条）", `命中 ${named.length}/${COMPACTION_EVENT_TYPES.length}`);
    check(text.includes("摘要不是新指令"), "技能正文写明压缩后再锚定语义（摘要不是新指令）");
    check(text.includes("Order -1100"), "技能正文声明与系统提示首句层同源（Order -1100）");
    check(bytes < 8192, "技能体量在宿主工具结果裁剪阈值内", `${bytes} B < 8192`);
    if (json) console.log(`IG5_SKILL_JSON ${JSON.stringify({ distSkill, bytes, sha256: sha(readBytes(distSkill)), compactionNamed: named })}`);
  }

  // ---- 2. 安装一致（逐字节漂移检测）----
  const distSkillSha = distExists ? sha(readBytes(distSkill)) : null;
  for (const r of installed) {
    const live = readBytes(r.skillFile);
    const liveSha = sha(live);
    check(
      liveSha === distSkillSha,
      `${r.id}：装的与 dist 产物逐字节相同（无漂移）`,
      liveSha === distSkillSha ? "" : `装 ${liveSha.slice(0, 12)} vs 产物 ${String(distSkillSha).slice(0, 12)}`,
    );
    const text = live.toString("utf8");
    check(text.includes(FIRST_LINE_TEXT), `${r.id}：副本含首句层契约`);
    check(text.includes(CONTRACT_SHORT), `${r.id}：副本 description 含契约短形`);
  }
  for (const r of roots.filter((x) => x.rootExists && !x.skillPresent)) {
    skips.push(`${r.id}（${r.path}）未装 —— 属正常：多个扫描根只需装一个`);
  }

  // ---- 3. 常驻思维链（插件技能工具的扫描口径里与技能同根）----
  if (existsSync(distChain)) {
    const chainSha = sha(readBytes(distChain));
    const holders = roots.filter((r) => r.chainPresent);
    check(holders.length > 0, "至少一个扫描根带着 ig5-chain.md");
    for (const r of holders) {
      check(
        sha(readBytes(r.chainFile)) === chainSha,
        `${r.id}：ig5-chain.md 与产物一致`,
        `${sha(readBytes(r.chainFile)).slice(0, 12)} vs ${chainSha.slice(0, 12)}`,
      );
    }
  } else {
    skips.push(`产物缺 ig5-chain.md（${distChain}）`);
  }
}

const total = passes.length + failures.length;
for (const p of passes) console.log(`  ✓ ${p}`);
for (const f of failures) console.log(`  ✗ ${f}`);
for (const s of skips) console.log(`  -（跳过）${s}`);
console.log(`\n技能通道检查：${passes.length} 通过 / ${failures.length} 失败${skips.length ? ` / ${skips.length} 跳过` : ""}（共 ${total} 条）`);
if (!total) console.log("（本机没有技能层，判据未采集）");
process.exit(failures.length ? 1 : 0);
