#!/usr/bin/env node
// verify_override.mjs —— 提示词接管（v0.52.2）回归判据：纯函数层 + index.js 接线。
// 用法：node scripts/verify_override.mjs    （退出码非 0 = 回归）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  OVERRIDE_MODES,
  normalizeMode,
  parseDropList,
  planOverride,
  renderTakeoverClause,
  scanResidual,
} from "../data/prompt-override.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "index.js"), "utf8");
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};

// 一批「装配出来的」段：宿主自带 + 本插件
const assembly = [
  { name: "dsh:host-identity", order: -1000, text: "You are an AI agent powered by DeepSeek Harness." },
  { name: "dsh-sandbox-policy", order: 0, text: "sandbox mode 相关策略" },
  { name: "dsh-host-features", order: 20, text: "工具用法与宿主能力说明" },
  { name: "infinite-gen-5:global-system-prompt", order: 100, text: "内核" },
  { name: "infinite-gen-5:tail-anchor", order: 10150, text: "末位锚点" },
];

check("档位枚举（resident 常驻档位于最前）", OVERRIDE_MODES.join(",") === "off,resident,shadow,replace");
check("档位归一：非法值回落 off", normalizeMode("nonsense") === "off" && normalizeMode("REPLACE") === "replace");
check("剔除词解析：中英文逗号都认", parseDropList("a, b，c").join("|") === "a|b|c");

const off = planOverride(assembly, { mode: "off" });
check("off 档：一段不动", off.dropped.length === 0 && off.kept.length === assembly.length);

const shadow = planOverride(assembly, { mode: "shadow" });
check(
  "shadow 档：只让位命中剔除词的宿主段，自己的一段不少",
  shadow.dropped.length === 3 && shadow.kept.length === 2,
  `dropped=${shadow.dropped.map((d) => d.name).join(",")}`,
);
check(
  "shadow 档：本插件段永不让位",
  shadow.kept.every((s) => s.name.startsWith("infinite-gen-5:")),
);

// 自定义剔除词是**追加**在默认词之后的（不是替换），所以这里仍会命中默认词的三段
const shadowNamed = planOverride(assembly, { mode: "shadow", dropList: "dsh-sandbox-policy" });
check(
  "shadow 档 + 自定义剔除词：按名命中（自定义词是追加，不覆盖默认词）",
  shadowNamed.dropped.length === 3 && shadowNamed.dropped.some((d) => d.name === "dsh-sandbox-policy"),
  shadowNamed.dropped.map((d) => d.name).join(","),
);

const replace = planOverride(assembly, { mode: "replace" });
check(
  "replace 档：非本插件段一律让位",
  replace.dropped.length === 3 && replace.kept.length === 2,
);

check("接管裁决句：off 档为空", renderTakeoverClause({ mode: "off", dropped: [] }) === "");
const clause = renderTakeoverClause({ mode: "shadow", dropped: shadow.dropped });
check("接管裁决句：带段数与段名", clause.includes("接管裁决") && clause.includes("让位 3 段") && clause.includes("dsh:host-identity"));
check("接管裁决句：写明冲突以上文内核为准", clause.includes("以上文内核为准"));

const dirty = assembly.map((s) => s.text).join("\n\n");
const hits = scanResidual(dirty);
check("残留扫描：命中宿主身份句", hits.some((h) => h.id === "host-identity"), hits.map((h) => h.id).join(","));
check("残留扫描：干净文本零命中", scanResidual("只有内核与锚点，没有宿主立场句。").length === 0);

// index.js 接线
check("接线：配置键进 IG5_CONFIG", /OVERRIDE_MODE,\n  OVERRIDE_CLAUSE,\n  TASK_MODE,/.test(src));
check("接线：进环境变量映射", /OVERRIDE_MODE: "IG5_OVERRIDE_MODE"/.test(src) && /OVERRIDE_CLAUSE: "IG5_OVERRIDE_CLAUSE"/.test(src));
check("接线：自由文本清单不进调参目录（只认 env）", !/\n  OVERRIDE_DROP: "IG5_OVERRIDE_DROP",/.test(src));
check("接线：档位键进调参目录与守卫", /"OVERRIDE_MODE",\n  "OVERRIDE_CLAUSE",/.test(src) && /const MODE_KEYS = Object.freeze\(\{ OVERRIDE_MODE: OVERRIDE_MODES \}\)/.test(src));
check("接线：目录里两枚新控件（select + bool）", /key: "OVERRIDE_MODE",\n    label: "提示词接管（训练档）"/.test(src) && /key: "OVERRIDE_CLAUSE",\n    kind: "bool"/.test(src));
check("接线：replace 档触发独占内核", /CFG\.EXCLUSIVE_SECTION === true \|\| CFG\.OVERRIDE_MODE === "replace"/.test(src));
check("接线：装配瀑布已挂", /registerOverrideWaterfall\(\);/.test(src) && /const registerOverrideWaterfall = \(\) => \{/.test(src));
check("接线：回执落 runtime.override", /runtime\.override = \{/.test(src));
check("接线：默认档是 resident（常驻注入，不剔宿主段）", /IG5_OVERRIDE_MODE \?\? "resident"/.test(src));

console.log(`\n提示词接管回归：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
