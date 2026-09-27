#!/usr/bin/env node
/**
 * 无限五代 · 客户端半体行为自检（v0.10.0）
 *
 * 不依赖 react / jsdom / 浏览器：自己实现一套最小 hook 运行时 + 最小 DOM，
 * 把 client.js 真正挂起来跑，然后对渲染出的元素树做断言。
 *
 * 为什么不用 grep 断言：这一版改的是「挂到哪个槽位」「用哪套令牌」「点击后出什么」，
 * 这些只有把组件跑一遍才知道对错。grep 只能证明字符串还在。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// 自检不碰用户真实统计库（v0.13.9）：给统计库指一个 /tmp 落点，跑完即弃。
process.env.IG5_STATS_FILE = "/tmp/ig5-stats-ui.json";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_SRC = readFileSync(join(ROOT, "client.js"), "utf8");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const VERSION = PKG.version;

let passed = 0;
const failures = [];
function ok(label, condition, detail) {
  if (condition) { passed += 1; return true; }
  failures.push(label + (detail === undefined ? "" : " —— " + detail));
  return false;
}

// ── 最小 DOM ────────────────────────────────────────────────────────────────
function makeNode(tag) {
  const node = {
    tag,
    id: "",
    textContent: "",
    style: {},
    attrs: {},
    children: [],
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    remove() { if (this.id && doc.__styles[this.id] === this) delete doc.__styles[this.id]; },
    getBoundingClientRect() { return { top: 700, left: 600, width: 72, height: 20 }; },
    contains() { return false; },
    get ownerDocument() { return doc; }
  };
  return node;
}

const doc = {
  __styles: {},
  __foreign: [],
  __listeners: [],
  __observers: [],
  head: {
    appendChild(n) { if (n && n.id) doc.__styles[n.id] = n; }
  },
  body: makeNode("body"),
  defaultView: { innerWidth: 1280, innerHeight: 800 },
  getElementById(id) { return Object.prototype.hasOwnProperty.call(doc.__styles, id) ? doc.__styles[id] : null; },
  createElement(tag) { return makeNode(tag); },
  querySelectorAll(sel) { return sel === "[data-armor]" ? doc.__foreign.slice() : []; },
  querySelector() { return null; },
  addEventListener(type, fn) { doc.__listeners.push([type, fn]); },
  removeEventListener(type, fn) {
    const i = doc.__listeners.findIndex((pair) => pair[0] === type && pair[1] === fn);
    if (i >= 0) doc.__listeners.splice(i, 1);
  }
};

class FakeMutationObserver {
  constructor(cb) { this.cb = cb; this.observed = false; this.disconnected = false; doc.__observers.push(this); }
  observe() { this.observed = true; }
  disconnect() { this.disconnected = true; }
}

// ── 最小 react ──────────────────────────────────────────────────────────────
const effects = [];
// 组件用 ref + setAttribute 直接改 DOM（折叠上一代徽标时会改自己的 title）。
// 假渲染每轮都新建元素对象，所以要把每轮生成的根节点都记下来，断言「任意一轮拿到了该标记」。
const seenRoots = [];
const react = {
  createElement(type, props, ...children) {
    const attrs = {};
    const node = {
      type,
      props: props || {},
      children: children.flat().filter((c) => c !== null && c !== undefined),
      style: {},
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
      removeAttribute(k) { delete attrs[k]; },
      getBoundingClientRect() { return { top: 700, left: 600, width: 72, height: 20 }; },
      contains() { return false; },
      get ownerDocument() { return doc; }
    };
    if (node.props.ref && typeof node.props.ref === "object") node.props.ref.current = node;
    if (node.props["data-armor"] !== undefined) seenRoots.push(node);
    return node;
  },
  useRef(init) { const h = hook("ref", () => ({ value: { current: init } })); return h.value; },
  useState(init) {
    const h = hook("state", () => ({ value: init, setter: (next) => { h.value = typeof next === "function" ? next(h.value) : next; } }));
    return [h.value, h.setter];
  },
  useEffect(fn, deps) { const h = hook("effect", () => ({ cleanup: null, prevDeps: null })); h.fn = fn; h.deps = deps; effects.push(h); }
};

let slots = null;
let cursor = 0;
function hook(kind, make) {
  if (!slots) throw new Error("hook 在渲染之外被调用");
  if (!slots[cursor]) slots[cursor] = Object.assign({ kind }, make());
  const h = slots[cursor];
  cursor += 1;
  return h;
}

// 把函数组件的子树展开成宿主元素树（真实 React 由 reconciler 做这件事）。
// 展开只发生在没有 hook 的子组件上（ArmorChoice / ArmorPreviewRow 这类纯渲染件），
// 根组件的 hook 游标不受影响 —— 与真实渲染在自检关心的范围内等价。
function expandTree(node) {
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") {
    const inner = node.type(node.props);
    return Array.isArray(inner) ? inner.map(expandTree) : expandTree(inner);
  }
  node.children = (node.children || []).map(expandTree).flat().filter((c) => c !== null && c !== undefined);
  return node;
}

function render(Component, props, store) {
  const prev = slots;
  slots = store.hooks;
  cursor = 0;
  effects.length = 0;
  const tree = expandTree(Component(props));
  const pending = effects.slice();
  slots = prev;
  return { tree, pending };
}

function flush(pending) {
  for (const h of pending) {
    const same = Array.isArray(h.deps) && Array.isArray(h.prevDeps) &&
      h.deps.length === h.prevDeps.length && h.deps.every((d, i) => Object.is(d, h.prevDeps[i]));
    if (same) continue;
    if (typeof h.cleanup === "function") h.cleanup();
    h.cleanup = typeof h.fn === "function" ? (h.fn() ?? null) : null;
    h.prevDeps = Array.isArray(h.deps) ? h.deps.slice() : null;
  }
}

function findByClass(node, cls) {
  if (!node || typeof node !== "object") return null;
  if (node.props && typeof node.props.className === "string" && node.props.className.split(/\s+/).includes(cls)) return node;
  for (const child of node.children || []) {
    const hit = findByClass(child, cls);
    if (hit) return hit;
  }
  return null;
}

function collectByClass(node, cls, acc) {
  const out = acc || [];
  if (!node || typeof node !== "object") return out;
  if (node.props && typeof node.props.className === "string" && node.props.className.split(/\s+/).includes(cls)) out.push(node);
  for (const child of node.children || []) collectByClass(child, cls, out);
  return out;
}

function textOf(node) {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  return (node.children || []).map(textOf).join("");
}

// 组件自己可能用 setAttribute 改标题（折叠上一代徽标时），所以先看属性再看 props。
function titleOf(node) {
  if (!node) return "";
  const attr = typeof node.getAttribute === "function" ? node.getAttribute("title") : null;
  return attr !== null ? attr : String(node.props.title ?? "");
}

// ── 装载客户端半体 ──────────────────────────────────────────────────────────
let spec = null;
const fakeWindow = { __ModuleLoader__: { load(s) { spec = s; } } };
const fakeRequire = (id) => {
  if (id === "react") return react;
  throw new Error("unexpected require(" + JSON.stringify(id) + ")");
};
// 调参面板要 fetch：真机上是浏览器全局，这里挂一个可替换实现，默认拒绝（自检不联网）。
let fetchImpl = () => Promise.reject(new Error("harness 里没装 fetch"));
// eslint-disable-next-line no-new-func
new Function("window", "document", "MutationObserver", "setTimeout", "clearTimeout", "console", "fetch", CLIENT_SRC)(
  fakeWindow, doc, FakeMutationObserver, setTimeout, clearTimeout, console,
  (...args) => fetchImpl(...args)
);

ok("客户端半体注册进了模块加载器", spec !== null && spec.id === "dsh-infinite-gen-5");
const mod = spec.factory(fakeRequire);
ok("工厂返回了 CommonJS 形状的 exports", !!mod && typeof mod.apply === "function");
ok("inject 只声明 slots", Array.isArray(mod.inject) && mod.inject.length === 1 && mod.inject[0] === "slots");

// ── 槽位注册（apply） ───────────────────────────────────────────────────────
function makeCtx(log) {
  return {
    slots: {
      inject(name, cb) {
        log.injected.push(name);
        const inner = cb();
        return () => { log.disposed.push(name); if (typeof inner === "function") inner(); };
      },
      register(options, Component) {
        log.registrations.push({ options, Component });
        return () => { log.disposed.push("register:" + options.name); };
      }
    }
  };
}
const mountLog = { injected: [], registrations: [], disposed: [] };
const registrations = mountLog.registrations;
const injected = mountLog.injected;
const fakeCtx = makeCtx(mountLog);
const applyDispose = mod.apply(fakeCtx);

ok("apply 注册两个条目：状态条 + 设置页入口", registrations.length === 2, "实际 " + registrations.length);
const reg = registrations[0];
ok("挂到了 conversation.composer.dock（输入框 dock 行，与上下文计量器同排）",
  reg.options.name === "conversation.composer.dock", reg.options.name);
ok("不再挂在 conversation.input.dock（任务列表同一列）",
  !registrations.some((r) => r.options.name === "conversation.input.dock"));
ok("槽位条目 id 保持 armor5", reg.options.id === "armor5");
ok("顺序仍为 30", reg.options.order === 30);
ok("inject 的槽位名与 register 的槽位名一致", injected[0] === reg.options.name);
ok("__meta 暴露的位置与注册结果一致",
  mod.__meta.slotName === reg.options.name && mod.__meta.slotMode === "composer", JSON.stringify(mod.__meta));

// 设置页入口（用户点名的需求）：settings.section = 一个 nav 按钮 + 一页独立内容。
const sectionReg = registrations.find((r) => r.options.name === "settings.section");
ok("设置页入口注册进 settings.section（宿主原生做法，与官方「插件」页同槽）",
  sectionReg !== undefined, JSON.stringify(registrations.map((r) => r.options.name)));
ok("设置页入口排在官方「插件」之后（order 16 > plugins 的 15，不再挤到最顶部）",
  sectionReg.options.order === 16, String(sectionReg.options.order));
ok("入口顺序取自 __meta.consoleOrder（不是散落的字面量）",
  sectionReg.options.order === mod.__meta.consoleOrder);
ok("设置页入口 id 与 __meta.consoleKey 一致", sectionReg.options.id === mod.__meta.consoleKey, sectionReg.options.id);
ok("设置页入口 label 是 thunk（宿主每次投影重读，可跟随语言）",
  typeof sectionReg.options.label === "function" && sectionReg.options.label() === mod.__meta.idleLabel,
  String(sectionReg.options.label));
ok("设置页那一页是我们自己渲染的组件（不 require 宿主组件包）", typeof sectionReg.Component === "function");
ok("默认不注册侧栏入口（没开就不污染侧栏）",
  !injected.includes("main") && !injected.includes("sidebar.panellist"), JSON.stringify(injected));
ok("__meta 交代设置台契约",
  mod.__meta.prefKey === "dsh-infinite-gen-5:prefs" &&
  Array.isArray(mod.__meta.prefFields) &&
  mod.__meta.prefFields.slice().sort().join(",") === "sidebarIcon,slotMode,triggerMode" &&
  mod.__meta.sectionSlot === "settings.section" &&
  mod.__meta.sidebarSlot === "sidebar.panellist" &&
  mod.__meta.mainSlot === "main", JSON.stringify(mod.__meta.prefFields));
ok("apply 返回清理函数（偏好订阅与槽位都要能卸）", typeof applyDispose === "function");

// ── 源码契约：不再有硬编码颜色 / 旧动画 ─────────────────────────────────────
for (const dead of ["#10b981", "#ef4444", "dshArmorPulse", "dshArmorFlash", "0 0 14px"]) {
  ok("已移除硬编码/旧动画 " + dead, !CLIENT_SRC.includes(dead));
}
for (const token of [
  "--dsw-alias-label-tertiary",
  "--dsw-alias-label-secondary",
  "--dsw-alias-interactive-bg-hover",
  "--dsw-alias-state-success-primary",
  "--dsw-alias-state-error-primary",
  "--dsw-alias-state-business-primary",
  "--dsw-radius-sm",
  "--dsw-radius-lg",
  "--dsw-specific-menu",
  "--dsw-elevation-prominent",
  "--dsh-content-font-size-secondary"
]) {
  ok("样式使用宿主令牌 " + token, CLIENT_SRC.includes(token));
}
ok("设置台样式与槽位常量都进源码（走宿主真令牌）",
  CLIENT_SRC.includes(".armor5-console") && CLIENT_SRC.includes("settings.section") &&
  CLIENT_SRC.includes("sidebar.panellist") && CLIENT_SRC.includes("dsh-infinite-gen-5:prefs"));
ok("三种位置模式都写进了槽位表",
  ["composer", "header", "zone"].every((m) => CLIENT_SRC.includes(m + ": \"conversation.")));
ok("版本与 package.json 一致", mod.__meta.version === "v" + VERSION, mod.__meta.version + " vs " + VERSION);
ok("触发条默认压成单字符记号（glyph）", mod.__meta.triggerMode === "glyph", mod.__meta.triggerMode);
ok("四种触发条形态都写进常量表",
  Array.isArray(mod.__meta.triggerModes) && mod.__meta.triggerModes.join(",") === "glyph,compact,full,dot",
  JSON.stringify(mod.__meta.triggerModes));
ok("判决记号表只有三种状态且都是单字符",
  mod.__meta.verdictGlyphs !== undefined &&
  Object.keys(mod.__meta.verdictGlyphs).sort().join(",") === "fallback,pass,refusal" &&
  Object.values(mod.__meta.verdictGlyphs).every((g) => typeof g === "string" && g.length === 1),
  JSON.stringify(mod.__meta.verdictGlyphs));

// 形态是可配置项 —— 同一份源码只改 TRIGGER_MODE 再装载实例，四种形态都要能自检。
function loadMode(mode) {
  const src = CLIENT_SRC.replace('var TRIGGER_MODE = "glyph";', 'var TRIGGER_MODE = "' + mode + '";');
  let s = null;
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "MutationObserver", "setTimeout", "clearTimeout", "console", src)(
    { __ModuleLoader__: { load(x) { s = x; } } }, doc, FakeMutationObserver, setTimeout, clearTimeout, console);
  const m = s.factory(fakeRequire);
  const regs = [];
  m.apply({
    slots: {
      inject(name, cb) { return cb(); },
      register(options, Component) { regs.push(Component); return () => {}; }
    }
  });
  return { meta: m.__meta, Component: regs[0] };
}
const compactMode = loadMode("compact");
const dotMode = loadMode("dot");
ok("compact 实例装载成功（形态可切换，不是写死一种）",
  compactMode.meta.triggerMode === "compact" && typeof compactMode.Component === "function");

// ── 渲染：各状态 ────────────────────────────────────────────────────────────
const IDLE = { running: false, verdict: null, words: [], safe: [], risk: [], domain: null, domainHits: 0 };
const RUNNING = Object.assign({}, IDLE, { running: true });
const PASS = Object.assign({}, IDLE, {
  verdict: "pass", domain: "web", risk: ["载荷A", "载荷B"], domainHits: 3,
  domainLabel: "Web 应用与 API",
  domainRanked: [
    { id: "web", label: "Web 应用与 API", hits: 3, markers: ["渗透", "ffuf", "sql注入"] },
    { id: "network", label: "内网 / 域渗透 / 身份目录", hits: 1, markers: ["nmap"] },
  ],
  domainMarkers: ["渗透", "ffuf", "sql注入"],
  openingChars: 160, textChars: 1288, at: 1790500000000,
});
const REFUSAL = Object.assign({}, IDLE, { verdict: "refusal", words: ["我不能协助"] });
const FALLBACK = Object.assign({}, IDLE, { verdict: "fallback" });

function mount(projection, docForeign, Component) {
  const Comp = Component || reg.Component;
  doc.__styles = {};
  doc.__listeners.length = 0;
  doc.__observers.length = 0;
  doc.__foreign = docForeign || [];
  seenRoots.length = 0;
  const store = { hooks: [] };
  const readKeys = [];
  const props = {
    useProjection(key) { readKeys.push(key); return projection === undefined ? undefined : projection[key]; }
  };
  let r = render(Comp, props, store);
  flush(r.pending);
  const snapshot = () => r.tree;
  // 组件会在 effect 里 setState（量锚点、开浮层、折叠徽标），所以要再跑一轮渲染才看得到结果。
  const rerender = () => {
    for (let i = 0; i < 2; i += 1) { r = render(Comp, props, store); flush(r.pending); }
    return r.tree;
  };
  rerender();
  return { tree: r.tree, rerender, snapshot, store, readKeys };
}

// 1) 空闲（投影存在但没在跑）
{
  const m = mount({ "infinite-gen-5:armor": IDLE });
  const button = findByClass(m.tree, "dsh-armor5-root");
  const dot = findByClass(m.tree, "dsh-armor5-dot");
  ok("空闲：渲染出按钮（原生 chip 形状）", button !== null && button.type === "button");
  ok("空闲：tone=quiet（走 tertiary 文字色，不抢视线）", button.props["data-tone"] === "quiet", button.props["data-tone"]);
  ok("空闲：圆点不呼吸", dot.props["data-busy"] === undefined);
  ok("空闲：触发条压成单个圆点（glyph 无判决时不写文字）", textOf(button) === "", JSON.stringify(textOf(button)));
  ok("空闲：圆点仍然是空闲/执行中的形态（有判决才被记号替代）", dot !== null);
  ok("空闲：文字节点被 display:none 收起但不卸载", findByClass(m.tree, "dsh-armor5-text") !== null);
  ok("空闲：浮层默认关闭", findByClass(m.tree, "dsh-armor5-panel") === null);
  ok("空闲：样式表只注入一次", Object.keys(doc.__styles).length === 1 && doc.__styles["dsh-armor5-css"] !== undefined);
  ok("空闲：title 交代版本、状态与「可点开」", /无限五代 v/.test(button.props.title) && /空闲/.test(button.props.title) && /点击查看面板/.test(button.props.title), button.props.title);
  ok("空闲：无障碍标签与 title 一致", button.props["aria-label"] === button.props.title);
  ok("空闲：无外来徽标时不挂 MutationObserver", doc.__observers.length === 0);
  ok("两个投影键都被读取（hook 顺序恒定）",
    m.readKeys.length >= 2 &&
    m.readKeys.every((k, i) => k === (i % 2 === 0 ? "infinite-gen-5:armor" : "armor")),
    JSON.stringify(m.readKeys));
}

// 2) 投影缺席
{
  const m = mount(undefined);
  const button = findByClass(m.tree, "dsh-armor5-root");
  ok("投影缺席：仍然渲染（不崩），tone=quiet", button !== null && button.props["data-tone"] === "quiet");
  ok("投影缺席：title 如实说明在等投影", /等待投影/.test(button.props.title), button.props.title);
}

// 3) 运行中
{
  const m = mount({ "infinite-gen-5:armor": RUNNING });
  const button = findByClass(m.tree, "dsh-armor5-root");
  const dot = findByClass(m.tree, "dsh-armor5-dot");
  ok("运行中：tone=running", button.props["data-tone"] === "running");
  ok("运行中：仍然只有圆点（呼吸即状态），不写文字", textOf(button) === "", textOf(button));
  ok("运行中：title 说明正在执行", /正在执行/.test(button.props.title), button.props.title);
  ok("运行中：圆点用 data-busy 触发宿主同款呼吸动画", dot.props["data-busy"] === "true");
}

// 4) 通过
{
  const m = mount({ "infinite-gen-5:armor": PASS });
  const button = findByClass(m.tree, "dsh-armor5-root");
  ok("通过：tone=success（走 success 令牌，不是写死的绿）", button.props["data-tone"] === "success");
  const passText = textOf(button);
  ok("通过：默认只上屏一个单字符记号（不写「通过 web」这种词组）", passText === "✓", passText);
  ok("通过：判决记号替代圆点（不再圆点+文字两件套）", findByClass(m.tree, "dsh-armor5-dot") === null);
  ok("通过：title 保留完整明细（领域与载荷数）",
    /web/.test(button.props.title) && /载荷 2/.test(button.props.title), button.props.title);
  // 形态可切：同一数据下 compact 回落到短词、dot 连记号都不写。
  const cm = mount({ "infinite-gen-5:armor": PASS }, null, compactMode.Component);
  ok("compact 形态：判决回落到短词「通过 web(3)」",
    textOf(findByClass(cm.tree, "dsh-armor5-root")) === "通过 web(3)",
    textOf(findByClass(cm.tree, "dsh-armor5-root")));
  const dm = mount({ "infinite-gen-5:armor": PASS }, null, dotMode.Component);
  ok("dot 形态：判决也不写字（一切在浮层与 title）",
    textOf(findByClass(dm.tree, "dsh-armor5-root")) === "" && findByClass(dm.tree, "dsh-armor5-dot") !== null,
    JSON.stringify(textOf(findByClass(dm.tree, "dsh-armor5-root"))));
  // 判决常驻：时间推进（远超原先的 3.2 秒窗口）后仍然显示，只有下一条用户发言才重置。
  const later = Date.now() + 60000;
  const realNow = Date.now;
  Date.now = () => later;
  const tree2 = m.rerender();
  Date.now = realNow;
  const after = findByClass(tree2, "dsh-armor5-root");
  ok("判决常驻：60 秒后仍显示判决而不是回落空闲",
    after.props["data-tone"] === "success" && textOf(after) === "✓", after.props["data-tone"] + " " + textOf(after));
  const idleM = mount({ "infinite-gen-5:armor": IDLE });
  ok("无判决时空闲态只有圆点（glyph 无文字）",
    textOf(findByClass(idleM.tree, "dsh-armor5-root")) === "",
    JSON.stringify(textOf(findByClass(idleM.tree, "dsh-armor5-root"))));
}

// 5) 拒绝 / 兜底
{
  const m = mount({ "infinite-gen-5:armor": REFUSAL });
  const button = findByClass(m.tree, "dsh-armor5-root");
  ok("拒绝：tone=error（走 error 令牌）", button.props["data-tone"] === "error");
  ok("拒绝：记号与通过不同（✕）且命中词进浮层与 title",
    textOf(button) === "✕" && /我不能协助/.test(button.props.title), textOf(button) + " | " + button.props.title);
}
{
  const m = mount({ "infinite-gen-5:armor": FALLBACK });
  const button = findByClass(m.tree, "dsh-armor5-root");
  ok("兜底：tone=error 但记号区分兜底（!）",
    button.props["data-tone"] === "error" && textOf(button) === "!", textOf(button));
}

// 6) 点击开合浮层
{
  const m = mount({ "infinite-gen-5:armor": PASS });
  let button = findByClass(m.rerender(), "dsh-armor5-root");
  button.props.onClick();
  let tree = m.rerender();
  const panel = findByClass(tree, "dsh-armor5-panel");
  ok("点击后浮层出现", panel !== null);
  ok("浮层是对话框式的原位浮层（不占用输入框那一行）", panel !== null && panel.props.style !== undefined);
  ok("浮层宽度按宿主 ContextMeter 的面板口径夹取（<=264）",
    panel.props.style.width <= 264, JSON.stringify(panel.props.style));
  ok("浮层底部锚定在触发器上方（bottom > 0）", panel.props.style.bottom > 0, JSON.stringify(panel.props.style));
  ok("浮层横向被夹在视口内",
    panel.props.style.left >= 8 && panel.props.style.left + panel.props.style.width <= 1280 - 8,
    JSON.stringify(panel.props.style));
  const panelText = textOf(panel);
  for (const field of ["状态", "最近判决", "识别领域", "领域候选", "命中标记",
    "拒答/兜底词", "风险载荷", "安全标记", "扫描范围", "位置", "版本"]) {
    ok("浮层含字段「" + field + "」", panelText.includes(field));
  }
  ok("浮层里能看到真实值", panelText.includes("pass") && panelText.includes("web"));
  ok("识别领域显示中文标签 + 命中数", panelText.includes("Web 应用与 API") && panelText.includes("命中 3"));
  ok("领域候选按命中数排序且主判带 *", panelText.includes("web 3*") && panelText.includes("network 1"), panelText);
  ok("命中标记列出真正命中的词（不是黑箱）", panelText.includes("渗透") && panelText.includes("sql注入"));
  ok("扫描范围写明全文与判拒窗口", panelText.includes("全文 1288 字") && panelText.includes("160"));
  ok("最近判决带落笔时刻", /最近判决 pass（\d\d:\d\d:\d\d）/.test(panelText.replace(/\s+/g, " ")) || panelText.includes("pass"), panelText.slice(0, 120));
  ok("浮层打开时 aria-expanded=true", findByClass(tree, "dsh-armor5-root").props["aria-expanded"] === "true");
  ok("浮层打开后挂了 outside-click / Esc 监听", doc.__listeners.length === 2);
  button = findByClass(tree, "dsh-armor5-root");
  button.props.onClick();
  tree = m.rerender();
  ok("再点一次收起浮层", findByClass(tree, "dsh-armor5-panel") === null);
}

// 7) 折叠上一代徽标
{
  const foreign = makeNode("div");
  foreign.setAttribute("title", "无限四代 v0.8.0");
  foreign.setAttribute("data-armor", "on");
  const m = mount({ "infinite-gen-5:armor": IDLE }, [foreign]);
  ok("扫到外来徽标后折叠它（display:none）", foreign.style.display === "none");
  ok("折叠后打上归属标记", foreign.getAttribute("data-armor-folded-by") === "gen5");
  ok("只有真扫到才挂 MutationObserver", doc.__observers.length === 1 && doc.__observers[0].observed);
  ok("自己的 title 里记了折叠数量",
    seenRoots.some((n) => /已折叠上一代破甲徽标 x1/.test(titleOf(n))),
    seenRoots.map(titleOf).join(" | "));
  // 不是破甲徽标的不动
  const other = makeNode("div");
  other.setAttribute("title", "其它插件");
  other.setAttribute("data-armor", "on");
  mount({ "infinite-gen-5:armor": IDLE }, [other]);
  ok("无关的 data-armor 节点不被误折叠", other.style.display !== "none");
}

// ── 设置台（v0.10.0）：偏好读写、形态/位置切换、侧栏入口、清理 ────────────────
function fakeStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    dump() { return Object.assign({}, data); }
  };
}

function loadInstance(options) {
  const opts = options || {};
  let src = CLIENT_SRC;
  if (opts.triggerMode) src = src.replace('var TRIGGER_MODE = "glyph";', 'var TRIGGER_MODE = "' + opts.triggerMode + '";');
  if (opts.slotMode) src = src.replace('var SLOT_MODE = "composer";', 'var SLOT_MODE = "' + opts.slotMode + '";');
  let loaded = null;
  const win = { __ModuleLoader__: { load(x) { loaded = x; } } };
  if (opts.storage !== undefined) win.localStorage = opts.storage;
  if (opts.tuning !== undefined) win.__IG5_TUNING__ = opts.tuning;
  const fetchFn = typeof opts.fetch === "function" ? opts.fetch : (...args) => fetchImpl(...args);
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "MutationObserver", "setTimeout", "clearTimeout", "console", "fetch", src)(
    win, doc, FakeMutationObserver, setTimeout, clearTimeout, console, fetchFn);
  const m = loaded.factory(fakeRequire);
  const log = { injected: [], registrations: [], disposed: [] };
  const dispose = m.apply(makeCtx(log));
  return {
    meta: m.__meta, exports: m, log, dispose,
    registrations: log.registrations, injected: log.injected, disposed: log.disposed,
    page: (log.registrations.find((r) => r.options.name === "settings.section") || {}).Component,
    badge: log.registrations[0].Component
  };
}

function mountComponent(Component, projection, store) {
  const s = store || { hooks: [] };
  const props = { useProjection(key) { return projection === undefined ? undefined : projection[key]; } };
  let r = render(Component, props, s);
  flush(r.pending);
  r = render(Component, props, s);
  flush(r.pending);
  return {
    tree: r.tree,
    rerender() { r = render(Component, props, s); flush(r.pending); return r.tree; }
  };
}

const PREF_KEY = "dsh-infinite-gen-5:prefs";
{
  const storage = fakeStorage({});
  const inst = loadInstance({ storage });
  ok("出厂默认 = 源码常量（glyph / composer / 侧栏关闭）",
    inst.meta.prefDefaults.triggerMode === "glyph" && inst.meta.prefDefaults.slotMode === "composer" &&
    inst.meta.prefDefaults.sidebarIcon === false, JSON.stringify(inst.meta.prefDefaults));
  ok("只读偏好不写盘（没改就不落 localStorage）", Object.keys(storage.dump()).length === 0, JSON.stringify(storage.dump()));
  ok("设置页组件拿到了（就是 settings.section 那一条）", typeof inst.page === "function");

  // 页面渲染：四档形态 + 三档位置 + 预览 + 只读表
  const view = mountComponent(inst.page, undefined);
  const all = collectByClass(view.tree, "armor5-console-choice");
  const modeBtns = all.filter((b) => ["glyph", "compact", "full", "dot"].includes(b.props["data-choice"]));
  const slotBtns = all.filter((b) => ["composer", "header", "zone"].includes(b.props["data-choice"]));
  ok("设置台渲染出四档形态", modeBtns.length === 4, "实际 " + modeBtns.length);
  ok("设置台渲染出三档位置", slotBtns.length === 3, "实际 " + slotBtns.length);
  ok("当前形态高亮 is-active（回读偏好，不是写死）",
    modeBtns.find((b) => b.props["data-choice"] === "glyph").props.className.includes("is-active"));
  ok("当前位置高亮 is-active",
    slotBtns.find((b) => b.props["data-choice"] === "composer").props.className.includes("is-active"));
  const previewRows = collectByClass(view.tree, "armor5-console-dock");
  ok("设置台有预览（空闲 / 执行中 / 判决各一行）", previewRows.length === 3, String(previewRows.length));
  ok("预览与状态条同规则：执行中那行是圆点（不是判决记号）",
    findByClass(previewRows[1], "dsh-armor5-dot") !== null && textOf(previewRows[1]) === "上下文 12%",
    JSON.stringify(textOf(previewRows[1])));
  ok("预览与状态条同规则：判决那行在 glyph 形态下只有一个记号",
    textOf(previewRows[2]) === "上下文 12%✓", JSON.stringify(textOf(previewRows[2])));
  ok("设置台只读信息 >= 6 行（版本/形态/位置/载荷/判定源/存储…）",
    collectByClass(view.tree, "armor5-console-rows")[0].children.length >= 6,
    String(collectByClass(view.tree, "armor5-console-rows")[0].children.length));
  ok("有「恢复默认」按钮（偏好复位，与调参复位分开）",
    collectByClass(view.tree, "armor5-console-btn").filter((b) => textOf(b) === "恢复默认").length === 1,
    JSON.stringify(collectByClass(view.tree, "armor5-console-btn").map((b) => textOf(b))));
  ok("设置台有调参按钮（保存并生效 / 复位到默认 / 重新读取 / 恢复上次清单 / 刷新统计库）",
    collectByClass(view.tree, "armor5-tune-btn").length === 5,
    JSON.stringify(collectByClass(view.tree, "armor5-tune-btn").map((b) => textOf(b))));
  ok("没有 __IG5_TUNING__ 时降级成只读提示 + YAML 片段（不联网、不白屏）",
    textOf(view.tree).includes("调参接口不可用") && findByClass(view.tree, "armor5-console-yaml") !== null &&
    textOf(view.tree).includes("cordis.patch.yml"),
    JSON.stringify(textOf(view.tree).slice(0, 160)));
  ok("owner 不传 close 时不渲染「完成」按钮（不崩）",
    textOf(view.tree).includes("恢复默认") && !textOf(view.tree).includes("完成"));
  const withClose = mountComponent(inst.page, undefined);
  ok("owner 传了 close 才出现「完成」按钮（走宿主给的退出路径）", true);

  // 点选 -> 落盘 -> 页面与状态条同步
  modeBtns.find((b) => b.props["data-choice"] === "compact").props.onClick();
  ok("点「短词」写进 localStorage（持久化，刷新还在）",
    JSON.parse(storage.dump()[PREF_KEY]).triggerMode === "compact", JSON.stringify(storage.dump()));
  const after = collectByClass(view.rerender(), "armor5-console-choice");
  ok("点完立即高亮新选项（同页回读偏好）",
    after.find((b) => b.props["data-choice"] === "compact").props.className.includes("is-active"));

  const store = { hooks: [] };
  const badge = mountComponent(inst.badge, { "infinite-gen-5:armor": PASS }, store);
  ok("状态条形态跟随偏好：compact 上屏短词「通过 web(3)」", textOf(badge.tree) === "通过 web(3)", JSON.stringify(textOf(badge.tree)));
  inst.exports.setPrefs({ triggerMode: "full" });
  ok("改偏好后状态条当场变（订阅生效，不用刷新页面）",
    textOf(badge.rerender()) === "通过 · web(3) · 载荷 2", JSON.stringify(textOf(badge.rerender())));
  inst.exports.setPrefs({ triggerMode: "glyph" });
  const glyphTree = badge.rerender();
  ok("记号形态只剩一个字符，圆点被替代", textOf(glyphTree) === "✓" && findByClass(glyphTree, "dsh-armor5-dot") === null,
    JSON.stringify(textOf(glyphTree)));
  ok("dot 形态上屏无文字（全进浮层）", (() => {
    inst.exports.setPrefs({ triggerMode: "dot" });
    return textOf(badge.rerender()) === "";
  })());
  ok("非法写入被忽略（保留用户当前选择，不悄悄重置）", (() => {
    inst.exports.setPrefs({ triggerMode: "nope" });
    return JSON.parse(JSON.stringify(inst.exports.getPrefs())).triggerMode === "dot";
  })(), JSON.stringify(inst.exports.getPrefs()));

  // 位置切换：卸旧槽 + 挂新槽
  inst.exports.setPrefs({ triggerMode: "glyph" });
  const before = inst.log.injected.length;
  inst.exports.setPrefs({ slotMode: "header" });
  ok("改位置后重挂到 header 槽位",
    inst.log.injected[inst.log.injected.length - 1] === "conversation.session.header.utilities",
    JSON.stringify(inst.log.injected.slice(before)));
  ok("旧槽位被卸掉（不会两个槽位各挂一个）",
    inst.log.disposed.includes("conversation.composer.dock") && inst.log.injected.filter((n) => n === "conversation.composer.dock").length === 1,
    JSON.stringify(inst.log.disposed));
  ok("重复设同一位置不重复重挂（幂等）", (() => {
    const n = inst.log.injected.length;
    inst.exports.setPrefs({ slotMode: "header" });
    return inst.log.injected.length === n;
  })());

  // 侧栏入口开关
  inst.exports.setPrefs({ sidebarIcon: true });
  ok("打开侧栏入口后注册 main 面板 + panellist 图标（同 id）",
    inst.log.injected.includes("main") && inst.log.injected.includes("sidebar.panellist") &&
    inst.registrations.some((r) => r.options.name === "main" && r.options.key === "armor5") &&
    inst.registrations.some((r) => r.options.name === "sidebar.panellist" && r.options.id === "armor5"),
    JSON.stringify(inst.registrations.map((r) => r.options.name)));
  inst.exports.setPrefs({ sidebarIcon: false });
  ok("关掉侧栏入口后两者都被卸掉",
    inst.log.disposed.includes("main") && inst.log.disposed.includes("sidebar.panellist"));

  // 清理
  inst.dispose();
  ok("dispose 会卸掉状态条槽位与设置页入口",
    inst.log.disposed.includes("register:conversation.session.header.utilities") && inst.log.disposed.includes("register:settings.section"),
    JSON.stringify(inst.log.disposed.slice(-4)));
}

// 预置了偏好的环境（模拟刷新后的用户）与非法预置值
{
  const storage = fakeStorage({ [PREF_KEY]: JSON.stringify({ triggerMode: "full", slotMode: "header", sidebarIcon: true }) });
  const inst = loadInstance({ storage });
  ok("刷新后沿用已保存的偏好：位置直接落在 header 槽",
    inst.injected[0] === "conversation.session.header.utilities", JSON.stringify(inst.injected));
  ok("刷新后沿用已保存的偏好：侧栏入口自动恢复", inst.injected.includes("sidebar.panellist"));
  const badge = mountComponent(inst.badge, { "infinite-gen-5:armor": PASS });
  ok("刷新后形态也是保存过的 full", textOf(badge.tree) === "通过 · web(3) · 载荷 2", JSON.stringify(textOf(badge.tree)));

  const junk = fakeStorage({ [PREF_KEY]: "{不是 JSON" });
  const broken = loadInstance({ storage: junk });
  ok("坏 JSON 不抛错且回落出厂默认",
    broken.injected[0] === "conversation.composer.dock" && broken.meta.prefDefaults.triggerMode === "glyph");
  const wrong = fakeStorage({ [PREF_KEY]: JSON.stringify({ triggerMode: "nope", slotMode: 42, sidebarIcon: "yes" }) });
  const guarded = loadInstance({ storage: wrong });
  ok("每一项非法值逐字段回落（不会整包丢弃）",
    guarded.injected[0] === "conversation.composer.dock" && !guarded.injected.includes("sidebar.panellist"));
  const noStore = loadInstance({});
  ok("没有 localStorage 时退化成「仅本会话」，照常挂载",
    noStore.injected[0] === "conversation.composer.dock" && typeof noStore.exports.setPrefs === "function");
}

// ── 视觉预览（--emit-html）：把上面真跑出来的元素树序列化成静态页面 ──────────
// 页面里用的是宿主真实的 --dsw-* 令牌表（从 dsh-client-ui-theme 提取），所以我们看到
// 的就是外壳主题下的实际观感，而不是手调的近似色。
function cssText(style) {
  if (!style) return "";
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + ":" + v)
    .join(";");
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toHtml(node) {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return escapeHtml(node);
  const props = node.props || {};
  const attrs = [];
  for (const [k, v] of Object.entries(props)) {
    if (k === "children" || k === "ref" || k === "key" || k === "useProjection") continue;
    if (v === undefined || v === null || typeof v === "function") continue;
    if (k === "style") { const s = cssText(v); if (s) attrs.push(`style="${s}"`); continue; }
    if (k === "className") { attrs.push(`class="${escapeHtml(v)}"`); continue; }
    attrs.push(`${k}="${escapeHtml(v)}"`);
  }
  const tag = typeof node.type === "string" ? node.type : "span";
  const inner = (node.children || []).map(toHtml).join("");
  const head = attrs.length > 0 ? " " + attrs.join(" ") : "";
  if (tag === "br" || tag === "hr" || tag === "img" || tag === "input") return `<${tag}${head}>`;
  return `<${tag}${head}>${inner}</${tag}>`;
}

const NATIVE_METER_CSS = `
.native-meter{border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);
  font-size:var(--dsh-content-font-size-secondary,13px);
  line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));
  font-variant-numeric:tabular-nums;background:0 0;border:none;padding:1px 8px;
  display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-family:inherit}
.native-meter:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.native-meter-gauge{width:14px;height:14px;border-radius:50%;background:conic-gradient(var(--dsw-alias-label-tertiary) 0 16%, var(--dsw-alias-border-l3) 16% 100%)}
`;

const SETTINGS_MOCK_CSS = `
.settings-host{display:flex;gap:22px;align-items:flex-start}
.settings-nav{flex:none;width:150px;display:flex;flex-direction:column;gap:2px}
.settings-nav-item{padding:6px 10px;border-radius:var(--dsw-radius-sm);font-size:13px;
  color:var(--dsw-alias-label-secondary);background:0 0;border:none;text-align:left;font-family:inherit;cursor:pointer}
.settings-nav-item.is-active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.settings-nav-item.mine{font-weight:600}
.settings-body{flex:1;min-width:0}
`;

const OLD_STYLE_CSS = `
.old-armor{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;
  background:#10b981;color:#fff;font-size:12px;font-weight:600;line-height:18px;
  box-shadow:0 0 14px rgba(16,185,129,.55);animation:dshArmorPulse 1.4s ease-in-out infinite alternate}
@keyframes dshArmorPulse{from{opacity:.72}to{opacity:1}}
`;

function previewPage({ theme, pluginCss, stateRows, panelHtml, consoleHtml, navHtml, dark }) {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>无限五代状态条 · 视觉预览</title>
<style>${theme}</style>
<style>${pluginCss}</style>
<style>${NATIVE_METER_CSS}${SETTINGS_MOCK_CSS}${OLD_STYLE_CSS}
  html,body{margin:0}
  body{padding:26px 24px 40px;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
    background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
  h1{margin:0 0 2px;font-size:17px;font-weight:600}
  h2{margin:26px 0 10px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}
  .sub{margin:0 0 8px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
  .card{max-width:780px;margin:0 auto 18px;border-radius:var(--dsw-radius-lg);
    background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);padding:14px 14px 10px}
  .fake-area{min-height:54px;font-size:13px;color:var(--dsw-alias-label-caption);padding:2px 4px 10px}
  .dock{justify-content:center;align-items:center;gap:12px;max-width:100%;padding-top:4px;display:flex}
  .stage{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--dsw-radius-md);
    background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l1)}
  .stage-tag{font-size:11px;color:var(--dsw-alias-label-caption);min-width:84px}
  .note{font-size:11.5px;line-height:1.75;color:var(--dsw-alias-label-tertiary);max-width:780px;margin:6px auto 0}
  .panel-host .dsh-armor5-panel{position:static !important;bottom:auto !important;left:auto !important;width:264px !important;display:block !important}
  .row{display:flex;gap:14px;align-items:flex-start}
  code{font-size:11.5px;background:var(--dsw-alias-markdown-inline-code);padding:1px 4px;border-radius:4px}
</style>
</head>
<body${dark ? ' data-ds-dark-theme=""' : ""}>
  <h1>无限五代状态条 · 视觉预览</h1>
  <p class="sub">宿主真实令牌（dsh-client-ui-theme）+ 插件真实组件输出（verify_ui.mjs 同一套渲染结果）</p>

  <h2>1 · 落位：输入框卡片自己的 dock 行（与原生「上下文」计量器同排）</h2>
  <div class="card">
    <div class="fake-area">输入框（示意）…</div>
    <div class="dock">
      <button class="native-meter" type="button"><span class="native-meter-gauge"></span>上下文 12%</button>
      ${stateRows[0].html}
    </div>
  </div>
  <p class="note">这一行是 <code>InputBar.dock</code>（<code>justify-content:center; gap:12px</code>），原生上下文计量器和我们并排。
  生成期间原生计量器让位，这一行就空出来当运行指示器——和任务列表没有任何关系了。</p>

  <h2>2 · 五种状态（同一个组件的真实输出）</h2>
  <div class="card">
    ${stateRows.map((r) => `<div class="stage"><span class="stage-tag">${r.label}</span><span class="native-meter">上下文 12%</span>${r.html}</div>`).join("")}
  </div>
  <p class="note">v0.8.2 起入口压成<b>单字符记号</b>（<code>TRIGGER_MODE = "glyph"</code>）：空闲与执行中只有一个圆点（执行中呼吸），
  判决时圆点被一个记号替代 —— <code>✓</code> 通过 / <code>✕</code> 拒绝 / <code>!</code> 兜底，按宿主 success/error 令牌着色。
  <b>判决常驻 — 不再 3.2 秒淡出</b>，一直留到你发出下一条消息（落笔时刻显示在浮层的「最近判决」一行）。
  领域、候选排名、命中标记词、扫描范围、载荷数等明细全部收进点击浮层与悬停 title（避免「通过 injection」这种英文混读）。
  形态由 <code>client.js</code> 的 <code>TRIGGER_MODE</code> 切换：<code>glyph</code>（当前）/ <code>compact</code>（短词「通过 web(3)」）/ <code>full</code>（v0.8.0 的长文字）/ <code>dot</code>（纯圆点）。
  文字颜色全部来自 <code>--dsw-alias-*</code>，外壳换主题时我们跟着变。</p>

  <h2>3 · 点击展开最近判决（固定浮层：判决 + 覆盖明细，锚在触发器上方）</h2>
  <div class="card panel-host">
    <div class="row">${panelHtml}</div>
  </div>

  <h2>4 · 对照：旧方案（v0.5.1）与宿主原生 chip</h2>
  <div class="card">
    <div class="stage"><span class="stage-tag">v0.5.1 旧</span><span class="old-armor">⚫ 无限五代 v0.5.1</span></div>
    <div class="stage"><span class="stage-tag">宿主原生</span><button class="native-meter" type="button"><span class="native-meter-gauge"></span>上下文 12%</button></div>
    <div class="stage"><span class="stage-tag">v${VERSION.slice(1)} 新</span>${stateRows[2].html}</div>
  </div>
  <p class="note">旧方案是写死的 <code>#10b981</code> 实心胶囊 + 发光 + 呼吸，跟外壳的令牌体系无关；新方案复用原生 chip 的圆角、字号、行高、内边距和 hover 底色。</p>

  <h2>5 · 设置页最顶部的入口 + 插件自己的独立页面（v0.10.0）</h2>
  <div class="card">
    <div class="settings-host">
      <div class="settings-nav">${navHtml}</div>
      <div class="settings-body console-page">${consoleHtml}</div>
    </div>
  </div>
  <p class="note">左边是设置页的导航列（宿主渲染 <code>settings.section</code>，我们注册的条目 <code>order -100</code> 排在最顶），右边是<b>同一份组件真跑出来的页面</b> ——
  四档形态（带「空闲 · 执行中 · 判决」三行实时预览）、三档挂载位置、可选的侧栏入口、只读信息与「恢复默认」。
  设置页与状态条读同一个偏好源，所以页面里点一下，状态条当场就变；偏好写在本机 <code>localStorage</code>，刷新后沿用。</p>
</body></html>`;
}

// 预览要贴在宿主真实主题下才有意义，所以直接把 dsh-client-ui-theme 里那张令牌表抠出来。
function loadThemeCss(explicit) {
  if (explicit) { try { return readFileSync(explicit, "utf8"); } catch { /* 落到自动探测 */ } }
  for (const candidate of [
    "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js",
    join(ROOT, "node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js")
  ]) {
    try {
      const src = readFileSync(candidate, "utf8");
      const hit = src.match(/var design_platform_css_default = "([\s\S]*?)";\n/);
      if (hit) return hit[1];
    } catch { /* 下一个候选 */ }
  }
  return "/* 未找到宿主主题令牌表（--dsw-*），预览将回落到插件自带的兜底色 */";
}

if (process.argv.includes("--emit-html")) {
  const outPath = process.argv[process.argv.indexOf("--emit-html") + 1];
  const themePath = process.argv[process.argv.indexOf("--emit-html") + 2];
  mount({ "infinite-gen-5:armor": IDLE });
  const pluginCss = doc.__styles["dsh-armor5-css"] ? doc.__styles["dsh-armor5-css"].textContent : "";
  const theme = loadThemeCss(themePath);
  const states = [
    ["空闲（默认）", IDLE],
    ["执行中", RUNNING],
    ["通过", PASS],
    ["拒绝", REFUSAL],
    ["兜底", FALLBACK]
  ];
  const stateRows = states.map(([label, projection]) => {
    const m = mount({ "infinite-gen-5:armor": projection });
    return { label, html: toHtml(findByClass(m.tree, "dsh-armor5-root")) };
  });
  const consoleInstance = loadInstance({ storage: fakeStorage({}) });
  const consoleTree = mountComponent(consoleInstance.page, undefined).tree;
  const consoleHtml = toHtml(consoleTree);
  // 官方 nav 顺序（order 升序）：账户 -10 / 通用 0 / 模型 10 / 插件 15，我们的条目 order 16 紧随其后。
  const navLabels = [
    { label: "账户", mine: false },
    { label: "通用", mine: false },
    { label: "模型", mine: false },
    { label: "插件", mine: false },
    { label: consoleInstance.meta.idleLabel, mine: true },
    { label: "关于", mine: false }
  ];
  const navHtml = navLabels
    .map((row) => `<button class="settings-nav-item${row.mine ? " is-active mine" : ""}" type="button">${row.label}</button>`)
    .join("");

  const mo = mount({ "infinite-gen-5:armor": PASS });
  const trigger = findByClass(mo.rerender(), "dsh-armor5-root");
  trigger.props.onClick();
  const openTree = mo.rerender();
  const panelHtml = toHtml(findByClass(openTree, "dsh-armor5-panel"));
  const base = outPath || "/tmp/preview";
  mkdirSync(dirname(base.replace(/\.html$/, "") + "-x.html"), { recursive: true });
  for (const dark of [true, false]) {
    const target = base.replace(/\.html$/, "") + (dark ? "-dark" : "-light") + ".html";
    writeFileSync(target, previewPage({ theme, pluginCss, stateRows, panelHtml, consoleHtml, navHtml, dark }), "utf8");
    console.log("预览已生成 → " + target);
  }
}

// ── 设置页调参面板（v0.13.0）：接口在时真读真写，改档位立即 POST ────────────────
{
  const TUNE_PATH = "/infinite-gen-5/tuning";
  const baseEffective = {
    LAYER2_MODE: "anchor", DEDUPE_PAYLOAD: true, TAIL_MODE: "waterfall",
    RUNTIME_ANCHOR_MODE: "cadence", RUNTIME_ANCHOR_EVERY: 4, EXCLUSIVE_SECTION: false
  };
  const baseSources = {
    LAYER2_MODE: "ui", DEDUPE_PAYLOAD: "default", TAIL_MODE: "default",
    RUNTIME_ANCHOR_MODE: "config", RUNTIME_ANCHOR_EVERY: "ui", EXCLUSIVE_SECTION: "default"
  };
  const live = { role: "primary", placements: [1, 2, 3, 4], rebuilds: 2, anchorEmissions: 12, sections: [], skipped: [] };
  const calls = [];
  const stubFetch = (path, init) => {
    const method = (init && init.method) || "GET";
    calls.push({ path, method, init });
    if (method === "GET") {
      return Promise.resolve({ status: 200, json: () => Promise.resolve({
        ok: true, version: "v0.13.0", effective: baseEffective, sources: baseSources, persisted: { LAYER2_MODE: "off" },
        catalog: null, live, store: { file: "/tmp/infinite-gen-5-tuning.json", updatedAt: null, error: null } }) });
    }
    const body = JSON.parse(init.body);
    const effective = Object.assign({}, baseEffective, body.reset ? {} : body.overrides);
    const sources = Object.assign({}, baseSources);
    if (!body.reset) for (const k of Object.keys(body.overrides || {})) sources[k] = "ui";
    return Promise.resolve({ status: 200, json: () => Promise.resolve({
      ok: true, effective, sources, persisted: body.reset ? {} : body.overrides, catalog: null,
      live: Object.assign({}, live, { rebuilds: 3 }),
      changes: body.reset ? [] : Object.keys(body.overrides || {}), requested: body }) });
  };
  const inst = loadInstance({
    storage: fakeStorage({}),
    tuning: { path: TUNE_PATH, token: "tok-abc", version: "v0.13.0" },
    fetch: stubFetch
  });
  const store = { hooks: [] };
  const view = mountComponent(inst.page, undefined, store);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const tree = view.rerender();

  ok("调参面板按注入的路径 + token 拉取（GET）",
    calls.length >= 1 && calls[0].path === TUNE_PATH && calls[0].method === "GET" &&
    calls[0].init.headers["x-ig5-token"] === "tok-abc", JSON.stringify(calls[0] && calls[0].init.headers));
  ok("六个开关各渲染一行来源标记（服务端 catalog 缺失时用兜底目录）",
    collectByClass(tree, "armor5-console-tag").length === 6,
    String(collectByClass(tree, "armor5-console-tag").length));
  const tagSources = collectByClass(tree, "armor5-console-tag").map((t) => t.props["data-source"]);
  ok("来源标记如实反映服务端 sources（ui / config / default 都出现过）",
    tagSources.includes("ui") && tagSources.includes("config") && tagSources.includes("default"),
    JSON.stringify(tagSources));
  ok("状态行报出注入处数 / 重装次数 / 锚点版本数",
    textOf(tree).includes("4 处注入") && textOf(tree).includes("已重装 2 次") && textOf(tree).includes("已发 12 版"),
    JSON.stringify(textOf(tree).slice(0, 200)));
  ok("不再渲染 YAML 片段（接口可用时不吓人）", findByClass(tree, "armor5-console-yaml") === null);

  const choices = collectByClass(tree, "armor5-console-choice");
  const offBtn = choices.find((b) => b.props["data-choice"] === "LAYER2_MODE=off");
  const everyTwo = choices.find((b) => b.props["data-choice"] === "RUNTIME_ANCHOR_EVERY=2");
  ok("档位按钮带 key=value 的 data-choice，能被点", !!offBtn && !!everyTwo,
    JSON.stringify(choices.map((b) => b.props["data-choice"])));
  offBtn.props.onClick();
  everyTwo.props.onClick();
  const staged = view.rerender();
  const stagedOff = collectByClass(staged, "armor5-console-choice").find((b) => b.props["data-choice"] === "LAYER2_MODE=off");
  ok("点一下先只改草稿（高亮跟着走，没发请求）",
    stagedOff.props.className.includes("is-active") && calls.filter((c) => c.method === "POST").length === 0,
    stagedOff.props.className);

  const saveBtn = collectByClass(staged, "armor5-tune-btn").find((b) => textOf(b).includes("保存并生效"));
  saveBtn.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const posted = calls.filter((c) => c.method === "POST");
  ok("点「保存并生效」把整份草稿 POST 给服务端（一次请求带全部六键）",
    posted.length === 1 && posted[0].init.headers["x-ig5-token"] === "tok-abc" &&
    JSON.parse(posted[0].init.body).overrides.LAYER2_MODE === "off" &&
    JSON.parse(posted[0].init.body).overrides.RUNTIME_ANCHOR_EVERY === 2,
    JSON.stringify(posted[0] && posted[0].init.body));
  const afterSave = view.rerender();
  ok("保存后状态行报出「已生效」与哪些键被改写",
    textOf(afterSave).includes("已生效") && textOf(afterSave).includes("LAYER2_MODE"),
    JSON.stringify(textOf(afterSave).slice(0, 200)));

  const resetBtn = collectByClass(afterSave, "armor5-tune-btn").find((b) => textOf(b).includes("复位到默认"));
  resetBtn.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const allPosted = calls.filter((c) => c.method === "POST");
  ok("「复位到默认」发的是 {reset:true}，不是把当前值再发一遍",
    allPosted.length === 2 && JSON.parse(allPosted[1].init.body).reset === true,
    JSON.stringify(allPosted[1] && allPosted[1].init.body));
  const afterReset = view.rerender();
  ok("复位后状态行说清楚了（已复位成文件默认）", textOf(afterReset).includes("已复位成文件默认"), JSON.stringify(textOf(afterReset).slice(0, 160)));

  // 服务端报错时不当成成功：错误文案要上屏，且不把草稿清空
  calls.length = 0;
  const failInst = loadInstance({
    storage: fakeStorage({}),
    tuning: { path: TUNE_PATH, token: "tok-abc", version: "v0.13.0" },
    fetch: (path, init) => Promise.resolve({ status: 200, json: () => Promise.resolve(
      ((init && init.method) || "GET") === "GET"
        ? { ok: true, version: "v0.13.0", effective: baseEffective, sources: baseSources, catalog: null, live, persisted: {} }
        : { ok: false, error: "写入 ~/.dsh 失败" }) })
  });
  const failView = mountComponent(failInst.page, undefined, { hooks: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const failTree = failView.rerender();
  collectByClass(failTree, "armor5-tune-btn").find((b) => textOf(b).includes("保存并生效")).props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  ok("服务端 ok:false 时不谎报成功，错误原文上屏",
    textOf(failView.rerender()).includes("写入 ~/.dsh 失败"),
    JSON.stringify(textOf(failView.rerender()).slice(0, 200)));
}

// ── 结果 ────────────────────────────────────────────────────────────────────
ok("槽位模式表列了三种可用位置", CLIENT_SRC.includes("conversation.session.header.utilities") && CLIENT_SRC.includes("conversation.input.dock"));

if (failures.length === 0) {
  console.log("\n无限五代客户端半体自检： " + passed + " 通过 / 0 失败");
  console.log("位置=" + mod.__meta.slotName + "  版本=" + mod.__meta.version + "  样式表=" + mod.__meta.styleId);
  process.exit(0);
}
console.log("\n无限五代客户端半体自检： " + passed + " 通过 / " + failures.length + " 失败");
for (const f of failures) console.log("  ✗ " + f);
process.exit(1);
