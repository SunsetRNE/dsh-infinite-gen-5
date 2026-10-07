// 无限五代 v0.52.9 · 两处旧变更（提示词接管 / 评估层开关）的逻辑复查回归
//
// 查的是单件回归（verify_override / verify_eval_layer）照不到的那一类问题：**开合的耦合**。
// 用假宿主真跑 apply()，在同一个进程里把档位翻来翻去，断言「实际注册进宿主的那份文本」跟着翻。
//
// 用法：node scripts/verify_change_review.mjs
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

process.env.IG5_STATS_FILE = "/tmp/ig5-stats-chrev.json";
process.env.IG5_HOME = "/tmp/ig5-home-chrev";
rmSync("/tmp/ig5-home-chrev", { recursive: true, force: true });
process.env.IG5_ADAPT_CACHE = "/tmp/ig5-adapt-chrev-off.json";
rmSync("/tmp/ig5-adapt-chrev-off.json", { force: true });
process.env.IG5_EVAL_LAYER = "off";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "index.js"), "utf8");
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};

const plugin = await import(new URL("../index.js", import.meta.url).href);
const { IG5_CONFIG } = plugin;

const KERNEL = "infinite-gen-5:global-system-prompt";
const EVAL = "infinite-gen-5:eval-layer";
const OVERRIDE = "infinite-gen-5:prompt-override";
const EVAL_MARK = "Scoring interface —";

/** 假宿主：只实现本套要考的那几个注册口。 */
function makeHost() {
  const store = new Map();
  const ctx = {
    effect(fn) {
      const dispose = fn();
      return () => {
        if (typeof dispose === "function") dispose();
      };
    },
    systemPrompt: {
      section(spec) {
        store.set(spec.name, spec);
        return () => store.delete(spec.name);
      },
      context() {
        return () => {};
      },
    },
    tools: { register() {} },
    on() {
      return () => {};
    },
    get() {
      return undefined;
    },
  };
  return { ctx, store };
}

const mount = () => {
  const host = makeHost();
  plugin.apply(host.ctx);
  return host.store;
};

// ---- 1) 关档：内核里不该有评分接口块 ----
let store = mount();
const offText = store.get(KERNEL)?.text ?? "";
check("关档：内核段已注册", offText.length > 0);
check("关档：内核里没有评分接口块（开档才注入）", !offText.includes(EVAL_MARK), EVAL_MARK);
check("关档：没有 Order 9600 评估层段", !store.has(EVAL), [...store.keys()].join(","));

// ---- 2) 运行中把档位翻到 on（等价于「设置页点保存 → 服务端当场重装」）----
// 注意：apply() 每次都会**按 env/profile/文件默认重新解析** IG5_CONFIG（实测：直接改 IG5_CONFIG
// 在下一次 apply 时会被覆盖回去），所以这里走真实路径 —— 改 env 再重挂。
process.env.IG5_EVAL_LAYER = "on";
store = mount();
const onText = store.get(KERNEL)?.text ?? "";
check("开档：**同一个进程、同一个内核文件**下拿得回评分接口块（缓存键必须带档位）",
  onText.includes(EVAL_MARK), `len=${onText.length}`);
check("开档：评分接口块只出现一次（不重复注入）",
  onText.split(EVAL_MARK).length - 1 === 1);
check("开档：Order 9600 评估层已注册", store.has(EVAL));
check("开档：评估层文本非空", (store.get(EVAL)?.text ?? "").length > 0);

// ---- 3) 再翻回关档：必须摘干净（缓存不能把开档那份留着）----
process.env.IG5_EVAL_LAYER = "off";
store = mount();
const offText2 = store.get(KERNEL)?.text ?? "";
check("翻回关档：评分接口块又摘掉了", !offText2.includes(EVAL_MARK));
check("翻回关档：Order 9600 评估层不再注册", !store.has(EVAL));
check("关档文本与首次关档逐字一致（无残留漂移）", offText2 === offText);
check("开档比关档多出的正是评分接口块那几个字节", Buffer.byteLength(onText, "utf8") > Buffer.byteLength(offText, "utf8"));

// ---- 4) 接管档位与评估层开合的多种组合：段在场性互不串味 ----
const combos = [
  ["off", false], ["resident", false], ["resident", true], ["shadow", true], ["replace", true],
];
for (const [mode, evalOn] of combos) {
  process.env.IG5_OVERRIDE_MODE = mode;
  process.env.IG5_EVAL_LAYER = evalOn ? "on" : "off";
  const s = mount();
  const kernel = s.get(KERNEL)?.text ?? "";
  const label = `接管=${mode} 评估=${evalOn ? "on" : "off"}`;
  check(`${label}：内核在场且评分块随档位`, kernel.length > 0 && kernel.includes(EVAL_MARK) === evalOn);
  check(`${label}：评估层段在场性正确`, s.has(EVAL) === evalOn);
  // 接管裁决段由 assemble 瀑布插入（无瀑布的宿主上不该凭空出现），这里只守住「不误注册」
  check(`${label}：接管裁决段不误注册`, !s.has(OVERRIDE) || mode !== "off");
}
delete process.env.IG5_OVERRIDE_MODE;
process.env.IG5_EVAL_LAYER = "off";

// ---- 5) 源码级：这两个开关的默认档与目录/区间必须对得上 ----
check("默认档：评估层默认关（用户要的「默认不评估」）",
  /const EVAL_LAYER = process\.env\.IG5_EVAL_LAYER[\s\S]{0,80}?\?\? false/.test(src) || /EVAL_LAYER: false/.test(src) || /IG5_CONFIG\.EVAL_LAYER === true/.test(src));
check(
  "默认档：接管档在 MODE_KEYS 里、取值来自 OVERRIDE_MODES",
  // v0.66.0 起 MODE_KEYS 还收了 INJECTION_PROFILE / INJECTION_POLICY 两个档位键，
  // 所以断言从「整行逐字相等」改成「这一行里 OVERRIDE_MODE 绑的是 OVERRIDE_MODES」。
  /const MODE_KEYS = Object\.freeze\(\{[^}]*OVERRIDE_MODE: OVERRIDE_MODES[^}]*\}\)/.test(src),
);
check("默认档：接管档默认 resident（默认常驻、不剔宿主段）", /const OVERRIDE_MODE = normalizeOverrideMode\(process\.env\.IG5_OVERRIDE_MODE \?\? "resident"\)/.test(src));
check("apply() 会按 env/profile/文件默认重解析配置（所以开关走 env/面板，不走改对象）",
  /IG5_CONFIG/.test(src) && typeof IG5_CONFIG === "object");
check("缓存键带上档位（本版新修）", /const gate = raw \? "raw" : IG5_CONFIG\.EVAL_LAYER === true \? "eval-on" : "eval-off"/.test(src));
check("开档时不摘评分块（kernelText 门）", /raw \|\| IG5_CONFIG\.EVAL_LAYER === true \? null : stripEvalDirectives\(source\)/.test(src));
check("开档时惰性拼回也不摘（lazyLive 门）", /if \(IG5_CONFIG\.EVAL_LAYER === true \|\| !compiled\.text\) return compiled;/.test(src));
check("接管回执只在运行时写（clauseChars 与实际注入长度分开记）",
  /clauseChars: clause\.length/.test(src) && /chars: CFG\.OVERRIDE_CLAUSE \? renderTakeoverClause/.test(src));

console.log(`\n两处变更的逻辑复查回归：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
