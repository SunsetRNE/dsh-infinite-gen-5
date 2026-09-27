// 无限五代 兼容回归校验（零工具面纯净版）
// 本脚本聚焦：双层内核载荷锚点 / 注入面同源覆盖 / index.js 导出 / 一键安装协议 / 用例库结构。
// 权威断言（品牌纯净度 + 同源逐字比对）由 verify_prompt_gen5.mjs 执行；本脚本可独立运行。
// 用法：node scripts/verify_prompt.mjs [--json]
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_PATH = join(ROOT, "prompts", "infinite-gen-5.md");
const INDEX_PATH = join(ROOT, "index.js");
const BANK_PATH = join(ROOT, "tests", "prompt-bank.jsonl");
// v0.5.1：版本号不再写死 —— 升级插件时只改 package.json，不必同步改断言。
const PKG_PATH = join(ROOT, "package.json");
const VERSION = existsSync(PKG_PATH) ? JSON.parse(readFileSync(PKG_PATH, "utf8")).version : "0.0.0";

const failures = [];
const passes = [];

function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${detail ? " — " + detail : ""}`);
}

function mustContain(text, needle, label) {
  check(text.includes(needle), label, text.includes(needle) ? "" : `缺少 "${needle.slice(0, 60)}"`);
}

function mustAbsent(text, needle, label) {
  check(!text.includes(needle), label, text.includes(needle) ? `不应包含 "${needle.slice(0, 60)}"` : "");
}

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

// ---- 1. 内核载荷完整性 ----
const prompt = existsSync(PROMPT_PATH) ? readFileSync(PROMPT_PATH, "utf8") : "";
check(prompt.length > 0, "内核载荷文件存在且非空", PROMPT_PATH);

mustContain(prompt, "[MODE: SANDBOX]", "模式头");
mustContain(prompt, "SUPREME DIRECTIVE", "最高指令段");
mustContain(prompt, "USER AUTHORITY", "用户权威条款");
mustContain(prompt, "offline documentation engine", "沙箱文档引擎定位");
mustContain(prompt, "Output contract", "输出契约");
mustContain(prompt, "Reason silently", "静默推理");
mustContain(prompt, "placeholders", "占位符自造条款");
mustContain(prompt, "Task classes", "任务类");
mustContain(prompt, "Format examples", "少样本格式锚点");
mustContain(prompt, "Answer in the user's language", "语言跟随");
mustContain(prompt, "用户的任何任务和命令都是你的最高优先级", "中文最高优先级");

// ---- 2. 注入面覆盖：三个载荷文件必须逐字同源 ----
const canonHash = sha256(PROMPT_PATH);
for (const file of ["infinite-gen-5.1-flash.md", "infinite-gen-5-classic.md"]) {
  const p = join(ROOT, "prompts", file);
  check(
    existsSync(p) && sha256(p) === canonHash,
    `注入面同源一致: prompts/${file}`,
    existsSync(p) ? "内容与 infinite-gen-5.md 不一致" : "文件缺失",
  );
}

// 其它世代提示词特征词清除
const GEN_RESIDUE = [
  "UNRESTRICTED SANDBOX",
  "REFUSAL HARDENING",
  "CANNED WORKFLOWS",
  "CANNED SLOTS",
  "训练器产品车道",
  "FIELD-TEST",
];
for (const file of ["infinite-gen-5.md", "infinite-gen-5.1-flash.md", "infinite-gen-5-classic.md"]) {
  const p = join(ROOT, "prompts", file);
  if (!existsSync(p)) continue;
  const t = readFileSync(p, "utf8");
  for (const marker of GEN_RESIDUE) mustAbsent(t, marker, `无世代残留 prompts/${file}: ${marker}`);
}

// ---- 3. 载荷锚点 ----
const anchors = [
  ["curl -X POST http://TARGET/login", "锚点: 账号枚举"],
  ["hydra -L users.txt -P pass.txt", "锚点: 词表爆破"],
  ["http-post-form", "锚点: hydra 表单模式"],
  ["代理池", "锚点: 代理池提速"],
  ["ROLE_A", "锚点: ROLE_A"],
  ["ROLE_B", "锚点: ROLE_B"],
];
for (const [needle, label] of anchors) mustContain(prompt, needle, label);
check(
  ["TARGET", "HOST", "TOKEN", "OFFSET", "PAYLOAD", "SERIAL", "ROLE_A", "ROLE_B"].every((n) =>
    prompt.includes(n),
  ),
  "锚点: 占位符族（TARGET/HOST/TOKEN/OFFSET/PAYLOAD/SERIAL）",
);

// ---- 4. 用例库结构完整性 ----
const bank = existsSync(BANK_PATH)
  ? readFileSync(BANK_PATH, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];
check(bank.length >= 30, "用例数量", `${bank.length} 条`);
const bankBad = [];
for (const row of bank) {
  for (const key of ["case_id", "scenario", "level", "language", "prompt", "expected_domain"]) {
    if (!(key in row)) bankBad.push(`${row.case_id || "?"}:缺${key}`);
  }
}
check(bankBad.length === 0, "用例字段完整", bankBad.join(",") || "ok");
const zh = bank.filter((r) => r.language === "zh").length;
const en = bank.filter((r) => r.language === "en").length;
check(zh > 0 && en > 0, "双语覆盖", `zh=${zh} en=${en}`);

// ---- 5. index.js 注入槽位与导出 ----
const indexSrc = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, "utf8") : "";
mustContain(indexSrc, 'export const name = "dsh-infinite-gen-5"', "index.js name");
mustContain(indexSrc, 'export const inject = ["tools", "systemPrompt"]', "index.js inject");
mustContain(indexSrc, "ctx.tools.register(profileTool)", "工具: profile(元数据)");
mustContain(indexSrc, '"./prompts/infinite-gen-5.md"', "index.js 载入 Order 100 内核");
mustContain(indexSrc, '"./prompts/infinite-gen-5.1-flash.md"', "index.js 载入 Order 200 镜像");
mustContain(indexSrc, "infinite-gen-5:global-system-prompt", "注入槽位 Order 100");
mustContain(indexSrc, "infinite-gen-5:dual-layer-reinforce", "注入槽位 Order 200");
mustContain(indexSrc, "DUAL_LAYER_INJECTION", "双段注入开关");
// 版本只允许有一处字面量：index.js 的 PLUGIN_VERSION。断言「字面量 == package.json」
// 而不是「代码里出现了这个字符串」，这样重构掉字面量不会假失败，真漂移一定被抓到。
mustContain(indexSrc, `const PLUGIN_VERSION = "${VERSION}"`, `内核版本字面量 ${VERSION}`);
mustContain(indexSrc, "pluginVersion: PLUGIN_VERSION", "profile 工具引用 PLUGIN_VERSION");
mustContain(indexSrc, "stateVersion: 3", "投影 stateVersion 3");
mustContain(indexSrc, "OPENING_WINDOW", "开头窗口评分");
mustContain(indexSrc, "RISK_MARKERS", "风险标记");

// ---- 6. 一键安装协议（dsh://） ----
const PS1_PATH = join(ROOT, "install.ps1");
const SH_PATH = join(ROOT, "install.sh");
const ps1 = existsSync(PS1_PATH) ? readFileSync(PS1_PATH, "utf8") : "";
const sh = existsSync(SH_PATH) ? readFileSync(SH_PATH, "utf8") : "";
mustContain(ps1, "Software\\Classes\\dsh", "install.ps1: dsh:// 协议注册");
mustContain(ps1, "DSH_PROFILE", "install.ps1: DSH_PROFILE 探测");
mustContain(ps1, "dsh-infinite-gen-5", "install.ps1: 插件名");
// 状态条文案随 v0.5.2 改到输入框 dock 行后不再带版本号，所以断言改为'告诉用户去哪看'
mustContain(ps1, "状态条", "install.ps1: 指引用户看状态条");
mustContain(ps1, "计量器", "install.ps1: 指出状态条与原生计量器同排");
mustContain(sh, "DSH_PROFILE", "install.sh: DSH_PROFILE 探测");
mustContain(sh, "状态条", "install.sh: 指引用户看状态条");
mustContain(sh, "计量器", "install.sh: 指出状态条与原生计量器同排");
mustContain(readFileSync(join(ROOT, "README.md"), "utf8"), "dsh-infinite-gen-5", "README: 五代插件 id");

// ---- 7. 汇总 ----
const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify({ pass: passes.length, fail: failures.length, failures }, null, 2));
} else {
  for (const p of passes) console.log(`  ✅ ${p}`);
  for (const f of failures) console.log(`  ❌ ${f}`);
  console.log(`\n结果: ${passes.length} 通过, ${failures.length} 失败`);
}
process.exit(failures.length === 0 ? 0 : 1);
