// 无限五代 · 工具与文档索引生成器（docs/TOOL-PROTOCOLS.md + docs/INDEX.md）
//
// 为什么存在：README 只保留入口，工具面与文档面需要一份「跟着代码自动翻新」的目录。
// 本脚本从 scripts/tool-registry.mjs 现读注册表、从头注释现读用途，因此文档永远不会
// 落后于代码 —— 门禁 verify_tool_registry.mjs 会逐字节比对生成结果，陈旧即失败。
//
// 用法：
//   node scripts/gen_tool_docs.mjs --write    # 写入两份文档
//   node scripts/gen_tool_docs.mjs --check    # 只比对，不写盘（退出码非零 = 文档过期）
//   node scripts/gen_tool_docs.mjs --json     # 打印机读摘要

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, CATEGORIES, PROTOCOLS, loadRegistry, groupByCategory } from "./tool-registry.mjs";

export const DOC_FILES = {
  tools: "docs/TOOL-PROTOCOLS.md",
  index: "docs/INDEX.md",
};

const rel = (p) => relative(ROOT, p).split("\\").join("/");

function firstLine(path, { skipHeading = false } = {}) {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const window = skipHeading ? 60 : 12;
  for (const raw of lines.slice(0, window)) {
    const l = raw.trim();
    if (!l || l === "---") continue;
    if (skipHeading && (l.startsWith("#") || l.startsWith(">") || l.startsWith("本文件由") || l.startsWith("返回 ") || l.startsWith("|") || l.startsWith("```"))) continue;
    if (l.startsWith("```")) continue;
    return l
      .replace(/^#+\s*/, "")
      .replace(/^[*>-]\s*/, "")
      .replace(/`/g, "")
      .slice(0, 120);
  }
  return "";
}

function docTitle(path) {
  const text = readFileSync(path, "utf8");
  const m = text.match(/^#\s+(.+)$/m);
  return m ? m[1].trim().replace(/`/g, "") : rel(path);
}

/** 被 .gitignore 拉黑的目录不进索引（v0.52.13）：内部留档 docs/incidents/ 只在本机存在，
 *  索引一旦列上它，CI 上就会出现「指向不存在文件」的条目，顺带也把内部路径写进对外文件。 */
function ignoredDocDirs() {
  // 显式denylist + git 兜底：内部留档（docs/incidents/）只在本机存在，索引列上它
  // 会让 CI 出现「指向不存在文件」的条目，也把内部路径写进对外文件。
  const ignored = new Set(["incidents"]);
  const dir = join(ROOT, "docs");
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    try {
      execFileSync("git", ["check-ignore", "-q", `docs/${e.name}`], { cwd: ROOT });
      ignored.add(e.name);
    } catch {
      /* 没被忽略 —— 正常情况；check-ignore 在无命中时退出码 1 */
    }
  }
  return ignored;
}

function listDocs() {
  const dir = join(ROOT, "docs");
  const ignored = ignoredDocDirs();
  const files = [];
  const dirs = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (ignored.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      const count = readdirSync(full).filter((f) => !f.startsWith(".")).length;
      dirs.push({ name: e.name + "/", count, title: firstLine(join(full, readdirSync(full)[0] ?? "")) });
    } else if (e.name.endsWith(".md")) {
      files.push({ path: full, rel: rel(full), title: docTitle(full), summary: firstLine(full, { skipHeading: true }) });
    }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  return { files, dirs };
}

const ABI_INTRO = `## 一、工具协议总则（Tool ABI）

仓库里 90+ 个脚本不是各写各的：它们共享同一套调用与判读约定。新增工具必须遵守这里的每一条，
否则它会成为「只有作者知道怎么跑」的孤岛。

| 约定 | 内容 | 为什么 |
|---|---|---|
| 入口 | \`node scripts/<name>.mjs\`；shell 件 \`bash scripts/<name>.sh\` | 不依赖 PATH 上的全局命令，克隆即可跑 |
| npm 别名 | 能进 CI 的件必须在 \`package.json\` 有别名（\`verify:*\` / \`build:*\` / \`probe:*\`…） | 别名是「这个工具还活着」的唯一外部证据 |
| 退出码 | \`0\` = 通过；非零 = 失败。**判据是退出码，不是屏幕上的字** | 管道下游（\`| tail\`）会吃掉真实退出码，脚本必须自己 \`process.exit\` |
| 最后一行 | 打印一行人类可读结论（\`<名字> OK …\` / \`<名字>：N 通过 / M 失败\`） | 人看这一行，机器看退出码，两者都不猜 |
| \`--json\` | 有机读需求时提供，且与人类输出互斥（同一轮只出一种） | 让上层脚本不必正则解析中文 |
| \`--selftest\` | 用内联夹具自检（夹具坏了要能被抓到，包括「伪造摘要必须被抓到」这类反例） | 门禁自己也要有判据，否则它只是在打印现状 |
| \`--check\` / \`--write\` | 生成器必须成对提供：默认 \`--check\` 不写盘 | 让「文档过期」变成可判失败的事实 |
| 写盘开关 | 任何改本机状态（装技能、铺安装树、改激活记录）的件默认 dry-run，要 \`--apply\` 才落盘 | 误跑一次不该毁掉环境 |
| 网络 | 默认离线；确需联网的件独立命名并在文档里标明 | 内网/无网环境也要能跑门禁 |
| 真源纪律 | 只读真源、不改历史证据：产物写新文件，旧产物留在原地 | 追认式改写会让读数与它测的那棵树脱钩 |

判据面：本文件与注册表、代码三者互相钉住 —— \`npm run verify:tools\` 会检查
「每个脚本都在册 / 在册路径都存在 / 声明的能力在文件里真的出现 / npm 别名真的存在 /
本文件与生成器输出逐字节一致」。`;

function renderTools(reg) {
  const { entries } = reg;
  const groups = groupByCategory(entries);
  const withJson = entries.filter((e) => e.flags.includes("--json"));
  const withSelftest = entries.filter((e) => e.flags.includes("--selftest"));
  const withApply = entries.filter((e) => e.flags.includes("--apply"));
  const npmMapped = entries.filter((e) => e.npm.length);
  const out = [];

  out.push("# 工具与工具协议（自动生成）");
  out.push("");
  out.push("> 本文件由 `npm run tools:doc` 生成，**不要手改**：改代码或 `scripts/tool-registry.mjs` 后重跑。");
  out.push(`> 协议标识 \`${reg.protocol}\` · 在册工具 **${entries.length}** 个 · 另有 ${Object.keys(reg.excluded).length} 个文件按理由排除（见文末）· 命名协议 **${PROTOCOLS.length}** 条。`);
  out.push("");
  out.push(ABI_INTRO);
  out.push("");
  out.push(`实测分布（现扫文件文本得出）：带 \`--json\` 的 **${withJson.length}** 个、带 \`--selftest\` 的 **${withSelftest.length}** 个、带 \`--apply\` 的 **${withApply.length}** 个、有 npm 别名的 **${npmMapped.length}** 个。`);
  out.push("");
  out.push("## 二、命名协议注册表");
  out.push("");
  out.push("只登记「实现里有字面量 + 有消费者 + 有能真跑的判据」的名字；没有判据的名字不上表。");
  out.push("");
  out.push("| 协议 | 定义处 | 消费者 | 判据 | 说明 |");
  out.push("|---|---|---|---|---|");
  for (const p of PROTOCOLS) {
    out.push(`| \`${p.name}\` | \`${p.definedIn}\` | ${p.consumers.map((c) => `\`${c}\``).join("、")} | \`${p.judge}\` | ${p.what} |`);
  }
  out.push("");
  out.push("非协议、但同属「对外承诺面」的判据：`npm run verify:version`（版本锚点与文档一致性）、`npm run verify:dispatch`（任务书载荷与回执字段闸门）、`npm run verify:surface`（插件对外表面计数）。这些工具没有独立的协议字符串，判据在脚本里。");
  out.push("");
  out.push("## 三、工具清单");
  out.push("");
  for (const [cat, list] of groups) {
    const desc = (CATEGORIES.find(([n]) => n === cat) || [, ""])[1];
    out.push(`### ${cat}（${list.length}）`);
    out.push("");
    out.push(`*${desc}*`);
    out.push("");
    out.push("| 工具 | 用途（读自文件头注释） | 调用 | 判据 | 能力 |");
    out.push("|---|---|---|---|---|");
    for (const e of list) {
      const flags = e.flags.length ? e.flags.map((f) => `\`${f}\``).join(" ") : "—";
      const npm = e.npm.length ? ` <br>npm: ${e.npm.map((n) => `\`${n}\``).join(" ")}` : "";
      out.push(`| \`${e.path}\`${npm} | ${e.purpose || "（无头注释，建议补一行）"} | \`${e.invoke}\` | \`${e.judge}\` | ${flags} |`);
    }
    out.push("");
  }
  out.push("### 不进清单的库文件");
  out.push("");
  out.push("| 文件 | 为什么不进 |");
  out.push("|---|---|");
  for (const [k, v] of Object.entries(reg.excluded)) out.push(`| \`${k}\` | ${v} |`);
  out.push("");
  out.push("---");
  out.push("");
  out.push(`判据一行：\`npm run verify:tools\` —— 完整性（盘上每个脚本都在册）· 路径存在 · 能力声明可在文件里证实 · npm 别名存在 · 本文件与生成器输出逐字节一致。`);
  out.push("");
  return out.join("\n");
}

function renderIndex() {
  const { files, dirs } = listDocs();
  const out = [];
  out.push("# 文档索引（自动生成）");
  out.push("");
  out.push("> 本文件由 `npm run tools:doc` 生成，**不要手改**。根目录只留入口与发版叙述，其余正文都在 `docs/`。");
  out.push("");
  out.push("| 文档 | 标题 | 讲什么 |");
  out.push("|---|---|---|");
  for (const d of files) out.push(`| [\`${d.rel}\`](${d.rel.replace(/^docs\//, "")}) | ${d.title} | ${d.summary} |`);
  out.push("");
  if (dirs.length) {
    out.push("## 证据与实验目录");
    out.push("");
    out.push("| 目录 | 条目 | 内容 |");
    out.push("|---|---|---|");
    for (const d of dirs) out.push(`| \`docs/${d.name}\` | ${d.count} | ${d.title} |`);
    out.push("");
  }
  out.push("## 仓库根目录的叙述件");
  out.push("");
  out.push("| 文件 | 用途 |");
  out.push("|---|---|");
  for (const name of ["README.md", "UPDATE.md", "VERSIONS.md", "CHANGELOG.md", "HARNESS_PLUGIN.md", "ENV_PROBE.md", "THIRD_PARTY_NOTICES.md", "docs/README-FULL.md"]) {
    const full = join(ROOT, name);
    if (!existsSync(full)) continue;
    out.push(`| \`${name}\` | ${firstLine(full, { skipHeading: true }) || docTitle(full)} |`);
  }
  out.push("");
  out.push("---");
  out.push("");
  out.push("判据一行：`npm run verify:tools` —— `docs/` 下每个 Markdown 都必须出现在本索引里，且本文件与生成器输出逐字节一致。");
  out.push("");
  return out.join("\n");
}

export function renderAll() {
  const reg = loadRegistry();
  return { [DOC_FILES.tools]: renderTools(reg), [DOC_FILES.index]: renderIndex(), entries: reg.entries.length };
}

function main() {
  const write = process.argv.includes("--write");
  const json = process.argv.includes("--json");
  const rendered = renderAll();
  const stale = [];
  for (const [relPath, content] of Object.entries(rendered)) {
    if (relPath === "entries") continue;
    const full = join(ROOT, relPath);
    const old = existsSync(full) ? readFileSync(full, "utf8") : null;
    if (old !== content) stale.push(relPath);
    if (write) writeFileSync(full, content);
  }
  if (json) {
    console.log(JSON.stringify({ tools: rendered[DOC_FILES.tools].length, index: rendered[DOC_FILES.index].length, entries: rendered.entries, stale }, null, 1));
  } else {
    const verb = write ? "写入" : "比对";
    console.log(`TOOLS DOC ${write ? "WROTE" : "CHECK"} entries=${rendered.entries} ${verb}=${Object.keys(rendered).filter((k) => !k.startsWith("entries")).length} 过期=${stale.length ? stale.join(" / ") : "无"}`);
  }
  process.exit(!write && stale.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
