#!/usr/bin/env node
// verify_visual.mjs —— 运行时视觉四态回归（v0.52.5）
//   ① 动态：把 client.js 里的纯状态机整块抠出来在 Node 里跑，逐条断言相位/闪烁次数/回落时机
//   ② 静态：CSS 规则、根节点 data-* 属性、事件推导接线必须都在
// 用法：node scripts/verify_visual.mjs      （退出码非 0 = 回归）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "client.js"), "utf8");
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};

// ---- 抠出纯状态机并在 Node 里执行 ----
const m = /\/\/ === IG5-VISUAL-STATE-BEGIN ===([\s\S]*?)\/\/ === IG5-VISUAL-STATE-END ===/.exec(src);
check("状态机块可在 client.js 里定位", !!m);
const body = m ? m[1].replace(/if \(typeof window[\s\S]*?window\.__IG5_VISUAL_STATE__ = ig5VisualState;\s*\}/, "") : "";
check("状态机块对 window 只用 typeof 守卫（Node 里可直接跑、不碰 document）", /typeof window !== "undefined"/.test(src) && !/document\./.test(body));
const IG5_VISUAL = { FLASHES: 3, FLASH_MS: 1000, CALL_MS: 900 };
const ig5VisualState = new Function("IG5_VISUAL", `${body}\nreturn ig5VisualState;`)(IG5_VISUAL);

const t0 = 1_000_000;
let s = ig5VisualState(null, { type: "tick" }, t0);
check("冷启动 = 蓝色呼吸、无标记", s.phase === "blue" && s.mark === null && s.flashes === 0, JSON.stringify({ phase: s.phase, mark: s.mark }));

// 正常注入 → 整场绿 ✓
s = ig5VisualState(s, { type: "inject-ok" }, t0 + 10);
check("注入成功一次：相位仍蓝", s.phase === "blue" && s.injected === 1);
s = ig5VisualState(s, { type: "tick" }, t0 + 20);
check("整场无告警 → 绿 ✓ 标记", s.mark === "ok");

// 拦截 / 异常注入 → 红橙交替 ×3，每秒一次，3s 后回蓝
let a = ig5VisualState(s, { type: "alert" }, t0 + 100);
check("alert 触发即进告警相位、第 1 次闪烁", a.phase === "alert" && a.flashes === 1);
check("alert 后标记转橙 🟠", a.mark === "warn");
check("+999ms 仍是第 1 次", ig5VisualState(a, { type: "tick" }, t0 + 1099).flashes === 1);
check("+1000ms 进第 2 次", ig5VisualState(a, { type: "tick" }, t0 + 1100).flashes === 2);
check("+2000ms 进第 3 次", ig5VisualState(a, { type: "tick" }, t0 + 2100).flashes === 3);
check("+3000ms 自动回蓝", ig5VisualState(a, { type: "tick" }, t0 + 3100).phase === "blue");
check("回蓝后不再复闪（闪烁计数清零）", ig5VisualState(a, { type: "tick" }, t0 + 3100).flashes === 0);

// 调用插件自身的工具 → 紫色单闪一次
let c = ig5VisualState(s, { type: "tool-call" }, t0 + 200);
check("tool-call 进紫色单闪", c.phase === "call");
check("+899ms 仍在紫闪窗口", ig5VisualState(c, { type: "tick" }, t0 + 1099).phase === "call");
check("+900ms 回蓝", ig5VisualState(c, { type: "tick" }, t0 + 1100).phase === "blue");

// 优先级：告警期间来工具调用，仍保持告警
const during = ig5VisualState(a, { type: "tool-call" }, t0 + 1500);
check("告警优先于紫闪（告警期间调工具不改相位）", during.phase === "alert" && during.flashes === 2);
check("工具调用仍被记录", during.called === true);

// reset
const r = ig5VisualState({ phase: "alert", flashes: 3, startedAt: t0, ok: false, injected: 5, alerted: true, called: true }, { type: "reset" }, t0 + 5000);
check("reset 清空相位/计数/标记", r.phase === "blue" && r.injected === 0 && r.mark === null && r.alerted === false);

// ---- 静态接线 ----
check("CSS：蓝色渐变呼吸", /\[data-ig5-visual=blue\]\{animation:dshArmor5Breath/.test(src) && /@keyframes dshArmor5Breath/.test(src));
check("CSS：红橙交替 3 次 / 每秒一次", /\[data-ig5-visual=alert\]\{animation:dshArmor5Alert 1s steps\(1,end\) 3\}/.test(src) && /@keyframes dshArmor5Alert/.test(src));
check("CSS：紫色单闪一次", /\[data-ig5-visual=call\]\{animation:dshArmor5Call \.9s ease-out 1\}/.test(src) && /@keyframes dshArmor5Call/.test(src));
check("CSS：绿 ✓ 与橙 🟠 标记", /\[data-ig5-mark=ok\]::after\{content:'✓'/.test(src) && /\[data-ig5-mark=warn\]::after\{content:'🟠'/.test(src));
check("根节点带 data-ig5-visual / data-ig5-mark", /"data-ig5-visual": visual \? visual\.phase : undefined/.test(src) && /"data-ig5-mark": visual && visual\.mark \? visual\.mark : undefined/.test(src));
check("事件推导在场（命中/跳过/兜底→alert，infinite_gen5_*→tool-call，pass→inject-ok）", /visualEv = "alert"/.test(src) && /visualEv = "tool-call"/.test(src) && /visualEv = "inject-ok"/.test(src) && /indexOf\("infinite_gen5_"\) === 0/.test(src));
check("状态机挂到 window 供测试", /window\.__IG5_VISUAL_STATE__ = ig5VisualState;/.test(src));

console.log(`\n运行时视觉四态回归：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
