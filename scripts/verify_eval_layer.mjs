#!/usr/bin/env node
// verify_eval_layer.mjs —— 评估层开关（v0.52.3）回归判据：摘除器 + 注入层 + index.js 接线。
// 用法：node scripts/verify_eval_layer.mjs      （退出码非 0 = 回归）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  EVAL_LAZY_IDS,
  EVAL_LAYER_ORDER,
  EVAL_LAYER_SECTION,
  stripEvalDirectives,
  renderEvalLayer,
} from "../data/eval-layer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const kernel = readFileSync(join(ROOT, "prompts/infinite-gen-5.md"), "utf8");
const lazy = readFileSync(join(ROOT, "prompts/infinite-gen-5-lazy.md"), "utf8");
const src = readFileSync(join(ROOT, "index.js"), "utf8");
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};

// ---- 常驻内核摘除 ----
const stripped = stripEvalDirectives(kernel);
check("常驻内核：摘除命中且文本变化", stripped.changed && stripped.hit, stripped.reasons.join(" / "));
check("常驻内核：评分接口块已摘掉", !stripped.text.includes("Scoring interface —"));
check("常驻内核：自评指针行已摘掉", !stripped.text.includes("【惰性 L_meta｜") && !stripped.text.includes("【惰性 L_eval｜"));
check("常驻内核：评估段字节确实少了", Buffer.byteLength(stripped.text, "utf8") < Buffer.byteLength(kernel, "utf8"));
check("常驻内核：其余骨架未被动（SUPREME DIRECTIVE 还在）", stripped.text.includes("SUPREME DIRECTIVE — USER AUTHORITY"));
check("常驻内核：指针行摘干净后不再留空段", !/\n{4,}/.test(stripped.text));
const twice = stripEvalDirectives(stripped.text);
check("幂等：再摘一次不变化", twice.changed === false);

// ---- 惰性章节摘除 ----
const lazyStripped = stripEvalDirectives(lazy);
check("惰性库：三个评估单元块已摘掉", EVAL_LAZY_IDS.every((id) => !lazyStripped.text.includes(`@@unit:${id}|`)), EVAL_LAZY_IDS.join(","));
check("惰性库：非评估单元仍在（L_dispatch / L_longrange）", lazyStripped.text.includes("@@unit:L_dispatch|") && lazyStripped.text.includes("@@unit:L_longrange|"));

// ---- 失败面：宁可不摘，也不误删 ----
const noMark = stripEvalDirectives("这里没有任何标记，只是一段普通内核文本。");
check("失败面：标记对不上时原样返回", noMark.text === "这里没有任何标记，只是一段普通内核文本。" && noMark.changed === false);
check("失败面：如实报告缺了什么", noMark.missing.length > 0, noMark.missing.join(" / "));

// ---- 开档注入层 ----
const layer = renderEvalLayer();
check("评估层：写明时机钉在总结 / 收尾", layer.includes("对话总结") && layer.includes("收尾"));
check("评估层：条目可核（逐条引原句 / 三态 / 四态 / 不做分数表演）", layer.includes("逐条引原句") && layer.includes("已知") && layer.includes("四态") && layer.includes("不是刷分"));
check("评估层：声明关档时本层不存在", layer.includes("关档时本层不存在"));
check("评估层：节名与 order 常量可用", EVAL_LAYER_SECTION === "infinite-gen-5:eval-layer" && EVAL_LAYER_ORDER === 9600);

// ---- index.js 接线 ----
check("接线：EVAL_LAYER 进 IG5_CONFIG / DEFAULTS", /export const IG5_CONFIG = \{\n  EVAL_LAYER,/.test(src) && /const IG5_DEFAULTS = Object\.freeze\(\{\n  EVAL_LAYER,/.test(src));
check("接线：进环境变量映射与布尔键", /EVAL_LAYER: "IG5_EVAL_LAYER"/.test(src) && /BOOL_KEYS = new Set\(\[[^\]]*"EVAL_LAYER"\]\)/.test(src));
check("接线：进调参目录与 TUNABLE_KEYS", /"EVAL_LAYER",\n  "OVERRIDE_MODE",/.test(src) && /key: "EVAL_LAYER",\n    kind: "bool"/.test(src));
check("接线：默认关档", /IG5_EVAL_LAYER \?\? "off"/.test(src));
check("接线：常驻内核走摘除刀", /raw \|\| IG5_CONFIG\.EVAL_LAYER === true \? null : stripEvalDirectives\(source\)/.test(src));
check("接线：同源比对用未摘基准（否则漏判让位）", /kernelText\(PROMPT_URL, \{ raw: true \}\)/.test(src) && /function kernelText\(url, \{ raw = false \} = \{\}\)/.test(src));
check("接线：惰性拼回也走同一把刀", /stripEvalDirectives\(compiled\.text\)/.test(src));
check("接线：开档补 Order 9600 段", /registerEvalLayer\(\);/.test(src) && /registerSection\(\s*\{ name: EVAL_LAYER_SECTION/.test(src));
check("接线：回执落 runtime.eval", /runtime\.eval = \{ on: false, strip: EVAL_STRIP\.last/.test(src));

console.log(`\n评估层开关回归：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
