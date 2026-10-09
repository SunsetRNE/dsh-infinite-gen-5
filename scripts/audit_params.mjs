#!/usr/bin/env node
// audit_params.mjs —— 参数逻辑机械审计（v0.52.4）
//
// 查的是「四张表必须互相对得上」，这类错在运行时不会报错、只会静默跑偏：
//   IG5_DEFAULTS（文件默认） · TUNABLE_KEYS（面板可调） · TUNING_CATALOG（控件目录） · ENV 映射
// 外加拿每个键的**字面默认值**去撞 NUMERIC_RANGES 的区间 —— 默认值落在区间外时，
// coerce 会把面板/环境传来的合法值当越界丢掉，功能看着开着其实没生效。
//
// 用法：node scripts/audit_params.mjs        （退出码非 0 = 有 error 级发现）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "index.js"), "utf8");

const block = (head) => {
  const i = src.indexOf(head);
  if (i < 0) return "";
  const a = src.indexOf("{", i);
  const b = src.indexOf("\n};", a);
  return b < 0 ? "" : src.slice(a, b);
};
const arrBlock = (head) => {
  const i = src.indexOf(head);
  if (i < 0) return "";
  const a = src.indexOf("[", i);
  const b = src.indexOf("\n];", a);
  return b < 0 ? "" : src.slice(a, b);
};
const ids = (text) => [...text.matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]);
const uniq = (a) => [...new Set(a)];

const defaultsText = block("const IG5_DEFAULTS = Object.freeze(");
// 键名有两种写法：裸标识符（简写属性）与访问器（get KEY() { } / set KEY(v) { }）。
// v0.66.0 的 INJECTION_PROFILE / INJECTION_POLICY 是故意写成 getter 的（见 index.js 里那段注释：
// 写成值拷贝会让面板显示的档位与实际跑的档位分家）。只认裸标识符会把它们误判成
// 「在 TUNABLE_KEYS 里、却没有文件默认值」——那是审计自己的漏判，不是接线缺口。
const defaultKeys = uniq(
  defaultsText
    .split("\n")
    .map((l) => l.trim().replace(/,$/, ""))
    .map((l) => {
      if (/^[A-Z][A-Z0-9_]+$/.test(l)) return l;
      const accessor = /^(?:get|set)\s+([A-Z][A-Z0-9_]+)\s*\(/.exec(l);
      if (accessor) return accessor[1];
      const pair = /^([A-Z][A-Z0-9_]+)\s*:/.exec(l);
      return pair ? pair[1] : null;
    })
    .filter(Boolean),
);
const tunableKeys = uniq(ids(arrBlock("const TUNABLE_KEYS = [")));
const catalogKeys = uniq([...src.matchAll(/key: "([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]));
const envKeys = uniq([...src.matchAll(/^\s{2}([A-Z][A-Z0-9_]+): "IG5_[A-Z0-9_]+",?$/gm)].map((m) => m[1]));
const rangeKeys = uniq([...block("const NUMERIC_RANGES = Object.freeze(").matchAll(/([A-Z][A-Z0-9_]+): \[([0-9x* ]+), ([0-9x* ]+)\]/g)].map((m) => m[1]));
const ranges = {};
for (const m of block("const NUMERIC_RANGES = Object.freeze(").matchAll(/([A-Z][A-Z0-9_]+): \[([^\]]+)\]/g)) {
  const nums = m[2].split(",").map((s) => Number(eval(s.trim().replace(/x/g, "*"))));
  ranges[m[1]] = nums;
}

/** 取某个键的字面默认值：找 `const KEY = <literal>;`（含布尔/大写常量引用）。 */
const literalOf = (key) => {
  const m = new RegExp(`const ${key} = ([^;]+);`).exec(src);
  if (!m) return { kind: "missing" };
  const raw = m[1].trim();
  if (/^(true|false)$/.test(raw)) return { kind: "bool", value: raw === "true" };
  if (/^-?[0-9.]+$/.test(raw)) return { kind: "number", value: Number(raw) };
  if (/^"[^"]*"$/.test(raw)) return { kind: "string", value: raw.slice(1, -1) };
  const env = new RegExp(`process\\.env\\.(IG5_[A-Z0-9_]+) \\?\\? "([^"]*)"`).exec(raw);
  if (env) return { kind: "env-string", value: env[2], env: env[1] };
  return { kind: "expr", value: raw.slice(0, 60) };
};

const findings = [];
const add = (level, key, msg) => findings.push({ level, key, msg });

// 1) 三张表互相对得上
for (const k of defaultKeys) if (!tunableKeys.includes(k)) add("warn", k, "在 IG5_DEFAULTS 里，但不在 TUNABLE_KEYS（面板改不了）");
for (const k of tunableKeys) if (!defaultKeys.includes(k)) add("error", k, "在 TUNABLE_KEYS 里，但不在 IG5_DEFAULTS（没有文件默认值）");
for (const k of tunableKeys) if (!catalogKeys.includes(k)) add("error", k, "在 TUNABLE_KEYS 里，但目录里没有对应控件（面板会缺行）");
for (const k of catalogKeys) if (!tunableKeys.includes(k)) add("warn", k, "目录里有控件，但不在 TUNABLE_KEYS");
for (const k of envKeys) if (!defaultKeys.includes(k)) add("warn", k, "有 IG5_* 环境变量映射，但不在 IG5_DEFAULTS");

// 2) 重复键
for (const [name, list] of [["IG5_DEFAULTS", defaultKeys], ["TUNABLE_KEYS", tunableKeys], ["TUNING_CATALOG", catalogKeys]]) {
  const raw = name === "TUNABLE_KEYS" ? ids(arrBlock("const TUNABLE_KEYS = [")) : name === "TUNING_CATALOG" ? [...src.matchAll(/key: "([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]) : defaultsText.split("\n").map((l) => l.trim().replace(/,$/, "")).filter((l) => /^[A-Z][A-Z0-9_]+$/.test(l));
  const seen = new Set();
  for (const k of raw) {
    if (seen.has(k)) add("error", k, `${name} 里重复出现`);
    seen.add(k);
  }
}

// 3) 默认值 vs 区间（本次审计的主菜）
for (const k of rangeKeys) {
  const lit = literalOf(k);
  const [lo, hi] = ranges[k] ?? [];
  if (lit.kind !== "number") {
    add("info", k, `区间 [${lo}, ${hi}]，但默认值不是数字字面量（${lit.kind}）`);
    continue;
  }
  if (lit.value < lo || lit.value > hi) {
    add("error", k, `默认值 ${lit.value} 落在区间 [${lo}, ${hi}] 之外 —— coerce() 会把面板/环境传来的合法值当越界丢掉`);
  }
}

// 4) MODE_KEYS 的默认值必须在允许档位里
const modeBlock = block("const MODE_KEYS = Object.freeze(");
for (const m of modeBlock.matchAll(/([A-Z][A-Z0-9_]+): ([A-Z_]+)/g)) {
  const [, key, constName] = m;
  const lit = literalOf(key);
  const modes = new RegExp(`const ${constName} = \\[([^\\]]+)\\]`).exec(src);
  const allowed = modes ? [...modes[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  if (allowed.length && !allowed.includes(String(lit.value))) {
    add("error", key, `默认值「${lit.value}」不在允许档位 ${allowed.join("/")} 里`);
  }
}

// 5) 环境变量映射：名字与键一一对应，且每个可调键都能用 env 覆盖
//    注意：常量写成字面量是**设计如此** —— env 覆盖由解析器按 ENV 映射做，
//    不要求常量本身去读 process.env（早先按那条判会刷出 15 条无意义 warn）。
const envPairs = [...src.matchAll(/^\s{2}([A-Z][A-Z0-9_]+): "(IG5_[A-Z0-9_]+)",?$/gm)].map((m) => [m[1], m[2]]);
const seenEnv = new Map();
for (const [key, name] of envPairs) {
  if (seenEnv.has(name)) add("error", key, `环境变量名 ${name} 被 ${seenEnv.get(name)} 与 ${key} 共用`);
  seenEnv.set(name, key);
  if (name !== `IG5_${key}`) add("info", key, `环境变量名 ${name} 不遵循 IG5_<KEY> 约定`);
}
for (const k of defaultKeys) if (!envPairs.some(([key]) => key === k)) add("warn", k, "没有 IG5_* 环境变量映射（无头环境只能改文件默认）");

const order = { error: 0, warn: 1, info: 2 };
findings.sort((a, b) => order[a.level] - order[b.level]);
console.log(`参数审计：defaults=${defaultKeys.length} · tunable=${tunableKeys.length} · catalog=${catalogKeys.length} · env=${envKeys.length} · ranges=${rangeKeys.length}\n`);
for (const f of findings) console.log(`[${f.level}] ${f.key} — ${f.msg}`);
const errs = findings.filter((f) => f.level === "error").length;
console.log(`\n结论：${errs} error · ${findings.filter((f) => f.level === "warn").length} warn · ${findings.filter((f) => f.level === "info").length} info`);
process.exit(errs === 0 ? 0 : 1);
