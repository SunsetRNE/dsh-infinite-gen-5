// 无限五代 · 工具注册表门禁（scripts/verify_tool_registry.mjs）
//
// 判的是「工具面是否自洽」，不是「代码好不好」：
//   1) 完整性：盘上每个脚本都在册，或按理由排除（漏登记 = 失败）
//   2) 存在性：在册/排除的路径都真的在
//   3) 可证实性：注册表里声明的能力（--json / --selftest / --apply …）必须在文件文本里真的出现
//   4) 判据可跑：judge 里引用的 npm 别名必须在 package.json 里、引用的脚本路径必须存在
//   5) 协议面：命名协议的 definedIn 文件里必须有该协议字面量，文档必须存在
//   6) 文档新鲜度：docs/TOOL-PROTOCOLS.md 与 docs/INDEX.md 必须与生成器输出逐字节一致
//   7) 索引覆盖：docs/ 下每个 Markdown 都必须出现在 docs/INDEX.md 里
//
// 用法：node scripts/verify_tool_registry.mjs [--json] [--selftest]

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  ROOT,
  REGISTRY_PROTOCOL,
  EXTRA_ROOTS,
  PROTOCOLS,
  loadRegistry,
  readPackage,
} from "./tool-registry.mjs";
import { renderAll, DOC_FILES } from "./gen_tool_docs.mjs";

const passes = [];
const failures = [];
const check = (ok, name, detail = "") => (ok ? passes.push(name) : failures.push(`${name}${detail ? " — " + detail : ""}`));

function diskScripts() {
  const acc = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name !== "lib" && e.name !== "node_modules") walk(join(dir, e.name));
        continue;
      }
      if (/\.(mjs|sh)$/.test(e.name)) acc.push(relative(ROOT, join(dir, e.name)).split("\\").join("/"));
    }
  };
  walk(join(ROOT, "scripts"));
  return acc.sort();
}

export function audit(reg, pkg) {
  const out = [];
  const add = (msg) => out.push(msg);
  const textCache = new Map();
  const textOf = (path) => {
    if (!textCache.has(path)) {
      const full = join(ROOT, path);
      textCache.set(path, existsSync(full) ? readFileSync(full, "utf8") : null);
    }
    return textCache.get(path);
  };

  // 1) 完整性
  const registered = new Set(reg.entries.map((e) => e.path));
  const excluded = new Set(Object.keys(reg.excluded));
  for (const rel of diskScripts()) {
    if (!registered.has(rel) && !excluded.has(rel)) {
      add(`未登记：${rel} 既不在 OVERLAY 也不在 EXCLUDED —— 加一行再跑 npm run tools:doc`);
    }
  }

  // 2) 存在性
  for (const [rel, reason] of Object.entries(reg.excluded)) {
    if (!existsSync(join(ROOT, rel))) add(`排除项指向不存在的文件：${rel}`);
    if (!reason || reason.length < 8) add(`排除项缺理由（≥8 字）：${rel}`);
  }
  for (const e of reg.entries) {
    if (!existsSync(join(ROOT, e.path))) add(`在册但文件不存在：${e.path}`);
  }
  for (const rel of EXTRA_ROOTS) {
    if (!reg.entries.some((e) => e.path === rel)) add(`根目录模块未在册：${rel}`);
  }

  // 3) 可证实性 + 用途行 + 分类
  for (const e of reg.entries) {
    const text = textOf(e.path);
    if (!text) continue;
    if (!e.purpose) add(`缺用途行（请在文件头补一行注释）：${e.path}`);
    if (!e.cat) add(`缺分类：${e.path}`);
    for (const f of e.flags) {
      if (!text.includes(f)) add(`能力声明与文件不符：${e.path} 声称有 ${f}，但文件里没出现这个字面量`);
    }
    if (e.judge.includes("--selftest") && !text.includes("--selftest")) add(`判据声明与文件不符：${e.path} 的 judge 带 --selftest，但文件里没这个开关`);
  }

  // 4) 判据可跑（只做静态可验证的部分：npm 名 + 脚本路径）
  const npmNames = new Set(Object.keys(pkg.scripts || {}));
  for (const e of reg.entries) {
    const m = e.judge.match(/^npm run ([^\s]+)/);
    if (m && !npmNames.has(m[1])) add(`判据引用了不存在的 npm 别名：${e.path} → ${m[1]}`);
    for (const p of e.judge.matchAll(/scripts\/([\w./-]+\.(?:mjs|sh))/g)) {
      if (!existsSync(join(ROOT, "scripts", p[1]))) add(`判据引用了不存在的脚本：${e.path} → scripts/${p[1]}`);
    }
  }

  // 5) 协议面
  for (const p of PROTOCOLS) {
    const text = textOf(p.definedIn);
    if (!text) add(`协议定义处不存在：${p.name} → ${p.definedIn}`);
    else if (!text.includes(p.name)) add(`协议字面量不在定义处：${p.name} 不在 ${p.definedIn} 里`);
    if (!existsSync(join(ROOT, p.doc))) add(`协议文档不存在：${p.name} → ${p.doc}`);
    const m = p.judge.match(/^npm run ([^\s]+)/);
    if (m && !npmNames.has(m[1])) add(`协议判据引用了不存在的 npm 别名：${p.name} → ${m[1]}`);
    if (!p.what || p.what.length < 20) add(`协议缺说明（≥20 字）：${p.name}`);
  }

  // 6) 文档新鲜度
  const rendered = renderAll();
  for (const rel of [DOC_FILES.tools, DOC_FILES.index]) {
    const full = join(ROOT, rel);
    if (!existsSync(full)) { add(`生成文档缺失：${rel} —— 跑 npm run tools:doc`); continue; }
    if (readFileSync(full, "utf8") !== rendered[rel]) add(`生成文档已过期：${rel} —— 跑 npm run tools:doc`);
  }

  // 7) 索引覆盖
  const indexText = existsSync(join(ROOT, DOC_FILES.index)) ? readFileSync(join(ROOT, DOC_FILES.index), "utf8") : "";
  const docsDir = join(ROOT, "docs");
  for (const name of readdirSync(docsDir)) {
    if (!name.endsWith(".md")) continue;
    if (!indexText.includes(name)) add(`docs/${name} 未出现在 docs/INDEX.md 里`);
  }
  return out;
}

function main() {
  const reg = loadRegistry();
  const pkg = readPackage();
  const problems = audit(reg, pkg);
  if (process.argv.includes("--selftest")) {
    // 反例：伪造一个能力声明，审计必须报出来（门禁自己也要有判据）
    const fake = {
      ...reg,
      entries: reg.entries.map((e, i) => (i === 0 ? { ...e, flags: [...e.flags, "--fabricated-flag"] } : e)),
    };
    const fakeProblems = audit(fake, pkg);
    const caught = fakeProblems.some((p) => p.includes("--fabricated-flag"));
    check(caught, "自检 · 伪造能力声明必须被抓到", caught ? "" : "审计函数放过了伪造的 flag");
    const fake2 = { ...reg, entries: reg.entries.slice(1) };
    const caught2 = audit(fake2, pkg).some((p) => p.includes("未登记"));
    check(caught2, "自检 · 漏登记必须被抓到", caught2 ? "" : "审计函数放过了缺失的注册项");
  }
  check(problems.length === 0, "工具注册表自洽", problems.slice(0, 12).join("；"));
  check(REGISTRY_PROTOCOL === "ig5-tool-registry-v1", "协议标识与注册表一致");

  const json = process.argv.includes("--json");
  if (json) {
    console.log(JSON.stringify({ protocol: REGISTRY_PROTOCOL, entries: reg.entries.length, excluded: Object.keys(reg.excluded).length, protocols: PROTOCOLS.length, passed: passes.length, failed: failures.length, failures }, null, 1));
  } else {
    for (const f of failures) console.log(`  ✗ ${f}`);
    console.log(`\n工具注册表自检： ${passes.length} 通过 / ${failures.length} 失败（共 ${passes.length + failures.length} 条）`);
    console.log(`在册 ${reg.entries.length} 个工具 · 排除 ${Object.keys(reg.excluded).length} 个文件 · 协议 ${PROTOCOLS.length} 条 · 文档 ${DOC_FILES.tools} / ${DOC_FILES.index}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
