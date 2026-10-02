#!/usr/bin/env node
// verify_visual.mjs —— 运行时浮点渲染规则回归（v0.52.8）
//   ① 动态：把 client.js 里的纯状态机与边沿触发器整块抠出来在 Node 里跑
//        —— 相位/闪烁次数/回落时机 · 同信号不重启闪烁 · 整场标记 · 单符号表达
//   ② 静态：CSS 规则、根节点属性、单符号接线必须都在，且不得再有「边框 + 追加字符」那套
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

// ---- 抠出纯函数并在 Node 里执行 ----
const m = /\/\/ === IG5-VISUAL-STATE-BEGIN ===([\s\S]*?)\/\/ === IG5-VISUAL-STATE-END ===/.exec(src);
check("状态机块可在 client.js 里定位", !!m);
const block = m ? m[1] : "";
const body = block.replace(/if \(typeof window[\s\S]*$/, "");
check("状态机块对 window 只用 typeof 守卫（Node 里可直接跑、不碰 document）", /typeof window !== "undefined"/.test(src) && !/document\./.test(body));
const { ig5VisualState, ig5NextEvent } = new Function(
  "IG5_VISUAL",
  `${body}\nreturn { ig5VisualState, ig5NextEvent };`
)({ FLASHES: 3, FLASH_MS: 1000, CALL_MS: 900 });

const t0 = 1_000_000;
let s = ig5VisualState(null, { type: "tick" }, t0);
check("冷启动 = 蓝色呼吸、无标记", s.phase === "blue" && s.mark === null && s.flashes === 0, JSON.stringify({ phase: s.phase, mark: s.mark }));

// 整场正确 → 绿 ✓
s = ig5VisualState(s, { type: "inject-ok", key: "a" }, t0 + 10);
check("注入成功一次：相位仍蓝", s.phase === "blue" && s.injected === 1);
check("整场无告警 → 绿 ✓ 标记", ig5VisualState(s, { type: "tick" }, t0 + 20).mark === "ok");

// 拦截 / 异常 → 红橙交替 ×3，每秒一次，3s 后回蓝
const a = ig5VisualState(s, { type: "alert", key: "k1" }, t0 + 100);
check("alert 触发即进告警相位、第 1 次闪烁", a.phase === "alert" && a.flashes === 1);
check("alert 后标记转橙 🟠", a.mark === "warn");
check("+999ms 仍是第 1 次", ig5VisualState(a, { type: "tick" }, t0 + 1099).flashes === 1);
check("+1000ms 进第 2 次", ig5VisualState(a, { type: "tick" }, t0 + 1100).flashes === 2);
check("+2000ms 进第 3 次", ig5VisualState(a, { type: "tick" }, t0 + 2100).flashes === 3);
check("+3000ms 自动回蓝", ig5VisualState(a, { type: "tick" }, t0 + 3100).phase === "blue");
check("回蓝后不再复闪（计数清零）", ig5VisualState(a, { type: "tick" }, t0 + 3100).flashes === 0);

// 调用插件自身的工具 → 紫色单闪一次
let c = ig5VisualState(s, { type: "tool-call", key: "7" }, t0 + 200);
check("tool-call 进紫色单闪", c.phase === "call");
check("+899ms 仍在紫闪窗口", ig5VisualState(c, { type: "tick" }, t0 + 1099).phase === "call");
check("+900ms 回蓝", ig5VisualState(c, { type: "tick" }, t0 + 1100).phase === "blue");
const during = ig5VisualState(a, { type: "tool-call", key: "8" }, t0 + 1500);
check("告警优先于紫闪（告警期间调工具不改相位）", during.phase === "alert" && during.flashes === 2);
check("工具调用仍被记录", during.called === true);
check("reset 清空相位/计数/标记/信号键",
  (() => { const r = ig5VisualState(a, { type: "reset" }, t0 + 5000); return r.phase === "blue" && r.injected === 0 && r.mark === null && r.alertKey === null; })());

// ---- 边沿触发（v0.52.8 修的那个 bug：同信号每拍重算 → 闪烁永不落回蓝色）----
const badSig = { verdict: "fallback", words: ["拒绝"], risk: [], at: 111 };
const e1 = ig5NextEvent(null, badSig);
check("首次异常信号 → alert", e1.type === "alert" && e1.key.length > 0, JSON.stringify(e1));
const afterAlert = ig5VisualState(null, e1, t0);
check("同一异常信号连续重算 → 只 tick（不重启闪烁窗口）", ig5NextEvent(afterAlert, badSig).type === "tick");
check("信号变了（新的一拍）→ 再次 alert", ig5NextEvent(afterAlert, { verdict: "fallback", words: ["拒绝"], risk: [], at: 222 }).type === "alert");
check("三拍都 tick 时窗口能正常走完（+3000ms 回蓝）",
  ig5VisualState(afterAlert, { type: "tick" }, t0 + 3000).phase === "blue");

const okSig = { verdict: "pass", words: [], risk: [], at: 333 };
const ok1 = ig5NextEvent(null, okSig);
check("首次 pass 判决 → inject-ok", ok1.type === "inject-ok");
const afterOk = ig5VisualState(null, ok1, t0);
check("同一 pass 判决连续重算 → 只 tick（不重复计入）", ig5NextEvent(afterOk, okSig).type === "tick");
check("工具调用按计数做边沿：涨了才触发", ig5NextEvent(afterOk, { verdict: "pass", words: [], risk: [], at: 333, toolCalls: 2 }).type === "tool-call");
const afterCall = ig5VisualState(afterOk, { type: "tool-call", key: "2" }, t0);
check("同一计数重复 → 只 tick", ig5NextEvent(afterCall, { verdict: "pass", words: [], risk: [], at: 333, toolCalls: 2 }).type === "tick");
check("异常优先于工具：同拍里既有命中又有调用 → alert",
  ig5NextEvent(null, { verdict: "refusal", words: ["我不能"], risk: [], at: 9, toolCalls: 3 }).type === "alert");

// ---- 静态接线：单符号 ----
check("CSS：蓝色渐变呼吸", /\[data-ig5-visual=blue\]\{animation:dshArmor5Breath/.test(src) && /@keyframes dshArmor5Breath/.test(src));
check("CSS：红橙交替 3 次 / 每秒一次", /\[data-ig5-visual=alert\]\{animation:dshArmor5Alert 1s steps\(1,end\) 3\}/.test(src) && /@keyframes dshArmor5Alert/.test(src));
check("CSS：紫色单闪一次", /\[data-ig5-visual=call\]\{animation:dshArmor5Call \.9s ease-out 1\}/.test(src) && /@keyframes dshArmor5Call/.test(src));
check("浮点不再有边框/环形描边（v0.52.6 那套 box-shadow 已移除）", !/data-ig5-mark=ok\]\{box-shadow/.test(src) && !/data-ig5-mark=warn\]\{box-shadow/.test(src));
check("浮点不再追加第二个字符（::after 标记已移除）", !/data-ig5-mark-char/.test(src) && !/\[data-ig5-mark=(ok|warn)\]::after/.test(src));
check("浮点去框体：data-ig5-float 规则在场", /\[data-ig5-float='1'\]\{background:transparent;border:0;box-shadow:none/.test(src));
check("单符号表达判决：圆点带 data-mark（✓ / 🟠）", /"data-mark": visual && visual\.mark && !busy \? visual\.mark : undefined/.test(src) && /\.dsh-armor5-dot\[data-mark=ok\]::before\{content:'✓'\}/.test(src) && /\.dsh-armor5-dot\[data-mark=warn\]::before\{content:'🟠'\}/.test(src));
check("判决标记只染颜色（不再新增节点）", /\[data-ig5-mark=ok\]\{color:var\(--dsw-alias-state-success-primary/.test(src));
check("根节点带 data-ig5-visual / data-ig5-mark / data-ig5-float", /"data-ig5-visual": visual \? visual\.phase : undefined/.test(src) && /"data-ig5-mark": visual && visual\.mark \? visual\.mark : undefined/.test(src) && /"data-ig5-float": showDot && !text \? "1" : undefined/.test(src));
check("事件推导走边沿触发器（ig5NextEvent，不再是手写 visualEv）", /var ig5Ev = ig5NextEvent\(visualPrev, \{/.test(src) && !/visualEv = "alert"/.test(src));
check("两个纯函数都挂到 window 供测试", /window\.__IG5_VISUAL_STATE__ = ig5VisualState;/.test(src) && /window\.__IG5_VISUAL_NEXT__ = ig5NextEvent;/.test(src));

// ---- 服务端信号源（v0.52.8：紫闪的边沿触发源必须在浮点订阅得到的那枚投影里）----
const SRV = readFileSync(join(ROOT, "index.js"), "utf8");
check("服务端把 selfToolCalls 带进判决投影（初值 + 每拍）",
  /selfToolCalls: ig5SelfToolCalls/.test(SRV) && /selfToolCalls: 0,/.test(SRV));
check("服务端按名字前缀计数、user/message 归零",
  /indexOf\("infinite_gen5_"\) === 0\) ig5SelfToolCalls \+= 1/.test(SRV) && /ig5SelfToolCalls = 0;/.test(SRV));
check("客户端优先读 armor.selfToolCalls（旧 tools 数组只作兜底）",
  /typeof armor\.selfToolCalls === "number"/.test(src) && /else if \(armor && Array\.isArray\(armor\.tools\)\)/.test(src));

console.log(`\n运行时浮点渲染回归：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
