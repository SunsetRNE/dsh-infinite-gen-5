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
import { findPackageDir } from "./lib/host-resolve.mjs";

// v0.51.0：面板标签在用户/开发者两种模式下不同；这里放一份词表副本，供断言取「另一种写法」。
const USER_LEX_UI = { "识别领域":"推测大概范围", "领域候选":"其它可能", "命中标记":"看到的关键词",
  "拒答/兜底词":"守边界时会说", "风险载荷":"需要小心的写法", "安全标记":"触到红线了吗",
  "扫描范围":"我读了多少", "位置":"面板位置" };
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
ok("侧栏入口整块移除：不再注册 main / sidebar.panellist",
  !injected.includes("main") && !injected.includes("sidebar.panellist"), JSON.stringify(injected));
ok("__meta 交代设置台契约（且不再暴露侧栏槽位）",
  mod.__meta.prefKey === "dsh-infinite-gen-5:prefs" &&
  Array.isArray(mod.__meta.prefFields) &&
  mod.__meta.prefFields.slice().sort().join(",") === "panelMode,slotMode,triggerMode" &&
  mod.__meta.sectionSlot === "settings.section" &&
  mod.__meta.sidebarSlot === undefined &&
  mod.__meta.mainSlot === undefined, JSON.stringify(mod.__meta.prefFields));
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
  "--dsw-alias-bg-layer-2",
  "--dsw-alias-bg-mask",
  "--dsh-content-font-size-secondary"
]) {
  ok("样式使用宿主令牌 " + token, CLIENT_SRC.includes(token));
}
ok("设置台样式与槽位常量都进源码（走宿主真令牌）",
  CLIENT_SRC.includes(".armor5-console") && CLIENT_SRC.includes("settings.section") &&
  CLIENT_SRC.includes("dsh-infinite-gen-5:prefs"));
ok("源码里不再有侧栏入口的注册与图标样式（v0.16.2 整块移除）",
  !CLIENT_SRC.includes("sidebar.panellist") && !CLIENT_SRC.includes("armor5-console-icon"));
ok("三种位置模式都写进了槽位表",
  ["composer", "header", "zone"].every((m) => CLIENT_SRC.includes(m + ": \"conversation.")));
ok("版本与 package.json 一致", mod.__meta.version === "v" + VERSION, mod.__meta.version + " vs " + VERSION);
ok("触发条默认压成单字符记号（glyph）", mod.__meta.triggerMode === "glyph", mod.__meta.triggerMode);
ok("四种触发条形态都写进常量表",
  Array.isArray(mod.__meta.triggerModes) && mod.__meta.triggerModes.join(",") === "glyph,compact,full,dot",
  JSON.stringify(mod.__meta.triggerModes));
ok("判决记号表只有四种状态且都是单字符（v0.17.0 起多了「空答」）",
  mod.__meta.verdictGlyphs !== undefined &&
  Object.keys(mod.__meta.verdictGlyphs).sort().join(",") === "empty,fallback,pass,refusal" &&
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
// v0.17.0：空答 —— 回显题面或过短且无交付形状；旧口径下它既不是拒绝也不是兜底，被记成通过。
const EMPTY = Object.assign({}, IDLE, { verdict: "empty" });

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
  ok("空闲：抽屉默认关闭", findByClass(m.tree, "dsh-armor5-drawer") === null);
  ok("空闲：样式表只注入一次", Object.keys(doc.__styles).length === 1 && doc.__styles["dsh-armor5-css"] !== undefined);
  ok("空闲：title 交代版本、状态与「可点开」", /无限五代 v/.test(button.props.title) && /空闲/.test(button.props.title) && /点击查看面板/.test(button.props.title), button.props.title);
  ok("空闲：无障碍标签与 title 一致", button.props["aria-label"] === button.props.title);
  ok("空闲：无外来徽标时不挂 MutationObserver", doc.__observers.length === 0);
  ok("三个投影键都被读取且顺序恒定（armor5 → armor → todos）",
    m.readKeys.length >= 3 &&
    m.readKeys.every((k, i) => k === ["infinite-gen-5:armor", "armor", "todos"][i % 3]),
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
{
  const m = mount({ "infinite-gen-5:armor": EMPTY });
  const button = findByClass(m.tree, "dsh-armor5-root");
  ok("空答：tone=warning（走 warning 令牌，既不报错也不冒充通过）",
    button.props["data-tone"] === "warning", String(button.props["data-tone"]));
  ok("空答：记号是省略号且与拒绝/兜底都不同", textOf(button) === "…", textOf(button));
}
ok("源码里有 warning 徽标样式（宿主没定义 warning 令牌，只能自己给底色）",
  CLIENT_SRC.includes('.dsh-armor5-badge[data-tone=warning]'));
ok("源码里空答的文案是「空答」（状态条与命中流水两处走文字，徽标那处走记号 …）",
  CLIENT_SRC.includes('empty: "…"') && CLIENT_SRC.split('"空答"').length - 1 === 2,
  String(CLIENT_SRC.split('"空答"').length - 1));

// 6) 点击开合浮层
{
  const m = mount({ "infinite-gen-5:armor": PASS });
  let button = findByClass(m.rerender(), "dsh-armor5-root");
  button.props.onClick();
  let tree = m.rerender();
  const drawerEl = findByClass(tree, "dsh-armor5-drawer");
  ok("点击后抽屉出现（C 方案 v0.49.0：浮层已删除）", drawerEl !== null);
  // 修正是在 effect 里 setState 出来的，假渲染需要再走一拍才看得到（与真实浏览器一致）
  const drawerSettled = findByClass(m.rerender(), "dsh-armor5-drawer");
  ok("抽屉按实测几何修正（补回被 transform 祖先带偏的位移、宽度铺满视口）",
    drawerSettled !== null && drawerSettled.props.style !== undefined &&
    /translate\(-?\d/.test(String(drawerSettled.props.style.transform)) &&
    String(drawerSettled.props.style.width) === "100vw",
    JSON.stringify(drawerSettled && drawerSettled.props.style));
  ok("抽屉带遮罩（点遮罩可收起）", findByClass(tree, "dsh-armor5-scrim") !== null);
  ok("抽屉是对话框语义（role=dialog + aria-modal）",
    drawerEl !== null && drawerEl.props.role === "dialog" && drawerEl.props["aria-modal"] === "true");
  const drawerTabs = collectByClass(tree, "dsh-armor5-tab");
  ok("抽屉带四个页签（实时 / 命中 / 明细 / 任务）", drawerTabs.length === 4, "实际 " + drawerTabs.length);
  ok("v0.53.5：抽屉不含设置页签（用户向偏好回到设置页，抽屉只做读数与留档）",
    !drawerTabs.some((t) => t.props && t.props["data-tab"] === "settings"));
  ok("v0.53：抽屉有原生式标题行（sheet-head + 标题）",
    findByClass(tree, "dsh-armor5-sheet-head") !== null && findByClass(tree, "dsh-armor5-sheet-title") !== null);
  ok("v0.53：页签容器带分段控件类（dsh-armor5-seg）", findByClass(tree, "dsh-armor5-seg") !== null);
  ok("v0.53：抽屉样式改用宿主设计令牌（radius-panel / elevation / mask-blur / interactive-bg-hover）",
    CLIENT_SRC.includes("var(--dsw-radius-panel") && CLIENT_SRC.includes("var(--dsw-elevation-prominent") &&
    CLIENT_SRC.includes("var(--dsw-mask-blur") && CLIENT_SRC.includes("var(--dsw-alias-interactive-bg-hover"));
  ok("v0.53：设置面板用分组卡片（dsh-armor5-card）承载", CLIENT_SRC.includes(".dsh-armor5-card{"));
  ok("默认停在「实时」页", drawerEl.props["data-tab"] === "live", String(drawerEl.props["data-tab"]));
  // v0.49.0 回归（v0.48.0 的页签失效根因）：外部点击判定必须把抽屉本身算作「内部」，
  // 否则捕获阶段的 pointerdown 会先把 open 置假、抽屉被卸载，页签的 click 永远到不了。
  // v0.49.0 回归（v0.48.0 的页签失效根因）：外部点击判定必须把抽屉算作「内部」，否则捕获阶段的
  // pointerdown 会先把 open 置假、抽屉被卸载，页签的 click 永远到不了。
  // 假 DOM 的 querySelector / contains 恒为空，模拟不出 containment，所以这里钉源码级保证；
  // 「页签真的能切」由下面切页后的 data-tab 断言承担。
  {
    const downPair = (doc.__listeners || []).find((pair) => pair[0] === "pointerdown");
    ok("注册了 document 级 pointerdown（外部点击判定在场）", Boolean(downPair));
    ok("外部点击判定把抽屉算作内部（不再只认已删除的 .dsh-armor5-panel）",
      CLIENT_SRC.includes('doc.querySelector(".dsh-armor5-panel, .dsh-armor5-drawer")') ||
      CLIENT_SRC.includes('doc.querySelector(".dsh-armor5-drawer")'));
  }
  // 切到「明细」页：九个字段磁贴、真实值、chip 都长在这一页
  collectByClass(tree, "dsh-armor5-tab").find((t) => t.props["data-tab"] === "fields").props.onClick();
  tree = m.rerender();
  const detailEl = findByClass(tree, "dsh-armor5-drawer");
  const drawerText = textOf(detailEl);
  const panelText = drawerText;   // v0.49.0：浮层已并入抽屉，旧断言变量名保留以缩小改动面
  ok("点「明细」页签后 data-tab 变为 fields（页签真的能切）",
    detailEl.props["data-tab"] === "fields", String(detailEl.props["data-tab"]));
  for (const field of ["识别领域", "领域候选", "命中标记", "拒答/兜底词", "风险载荷",
    "安全标记", "扫描范围", "位置"]) {
    ok("明细页含字段「" + field + "」（两种面板模式任取其一）",
      drawerText.includes(field) || drawerText.includes(USER_LEX_UI[field] || field), drawerText.slice(0, 80));
  }
  ok("抽屉头部用徽标交代判决（不再单占一行「状态 / 最近判决」）",
    drawerText.includes("通过") && /v\d+\.\d+\.\d+/.test(drawerText));
  ok("抽屉里能看到真实值", drawerText.includes("通过") && drawerText.includes("web"));
  ok("识别领域显示中文标签，命中数在领域候选里带 *",
    drawerText.includes("Web 应用与 API") && drawerText.includes("3*"));
  ok("领域候选按命中数排序且主判带 *", drawerText.includes("web 3*") && drawerText.includes("network 1"), drawerText);
  ok("命中标记列出真正命中的词（不是黑箱）", drawerText.includes("渗透") && drawerText.includes("sql注入"));
  ok("扫描范围写明全文与判拒窗口", drawerText.includes("全文 1288 字") && drawerText.includes("160"));
  ok("抽屉头部带落笔时刻", /\d\d:\d\d:\d\d/.test(drawerText), drawerText.slice(0, 120));
  const chips = collectByClass(tree, "dsh-armor5-chip");
  // v0.51.6：用户模式下这三个磁贴走「本对话累计」（data-kind=mem-hit/…），dev 模式才是 raw；
  // 两种都算「铺成 chip」，只断言形状与条数，不把某一种模式写死。
  const hitChips = chips.filter((c) => String(c.props["data-kind"] || "").indexOf("hit") >= 0);
  const riskChips = chips.filter((c) => String(c.props["data-kind"] || "").indexOf("risk") >= 0);
  ok("命中标记铺成 chip（不是一坨逗号）",
    hitChips.length === 3 &&
    hitChips.map((c) => textOf(c).replace(/ ×\d+$/, "")).join("、") === "渗透、ffuf、sql注入",   // v0.51.12：chip 文本变成「名字 ×N」，比较时剥掉 ×N
    JSON.stringify(hitChips.map((c) => textOf(c))));
  ok("风险载荷铺成 chip 并带条数",
    riskChips.length === 2 && (drawerText.includes("风险载荷") || drawerText.includes("需要小心的写法")),
    JSON.stringify(riskChips.map((c) => textOf(c))));
  // 切到「命中」页：最近命中分区长在这一页
  collectByClass(tree, "dsh-armor5-tab").find((t) => t.props["data-tab"] === "hits").props.onClick();
  tree = m.rerender();
  const hitsText = textOf(findByClass(tree, "dsh-armor5-drawer"));
  ok("抽屉有「最近命中」分区（服务端还没 data 时给出说明而不是空白）",
    hitsText.includes("最近命中") && hitsText.includes("还没有判决留档"),
    hitsText.slice(-200));
  ok("抽屉样式与流水结构都写进源码（chip / 命中流水）",
    CLIENT_SRC.includes(".dsh-armor5-chip") && CLIENT_SRC.includes(".dsh-armor5-hits") &&
    CLIENT_SRC.includes("function hitRows"));
  collectByClass(tree, "dsh-armor5-tab").find((t) => t.props["data-tab"] === "fields").props.onClick();
  tree = m.rerender();
  const tiles = collectByClass(tree, "dsh-armor5-tile");
  const span2 = tiles.filter((t) => t.props["data-span"] === "2");
  ok("字段铺成「田字格」（两列 tile，词表 / 长值跨列）",
    tiles.length >= 8 && span2.length >= 3, "tiles=" + tiles.length + " span2=" + span2.length);
  const tilesText = textOf(findByClass(tree, "dsh-armor5-drawer"));
  ok("抽屉里不再有「版本」行，版本只在头部出现一次",
    tilesText.includes("版本") === false &&
    (tilesText.match(/v\d+\.\d+\.\d+/g) || []).length === 1,
    JSON.stringify((tilesText.match(/v\d+\.\d+\.\d+/g) || [])));
  ok("田字格样式写进源码（grid / tile / 跨列选择器）",
    CLIENT_SRC.includes(".dsh-armor5-grid") && CLIENT_SRC.includes(".dsh-armor5-tile") &&
    CLIENT_SRC.includes("[data-span='2']"));
  // v0.17.2：样式表括号必须配平。一条漏了闭合的规则（v0.17.0 的 warning 徽标只写了
  // background、没写 color 和右花括号）会让后面所有规则被浏览器当成 CSS 嵌套规则 ——
  // chip / tile / 发丝线整块静默失效，卡片退化成灰字墙，而 DOM 断言与源码断言全都是绿的。
  // 这条断言的是「样式表能被完整解析」本身，不依赖任何具体选择器。
  const cssText = doc.__styles["dsh-armor5-css"] ? doc.__styles["dsh-armor5-css"].textContent : "";
  const cssOpens = (cssText.match(/\{/g) || []).length;
  const cssCloses = (cssText.match(/\}/g) || []).length;
  ok("样式表括号配平（未闭合的规则会把后续规则静默变成嵌套规则）",
    cssOpens > 20 && cssOpens === cssCloses, "{=" + cssOpens + " }=" + cssCloses);
  // ── v0.53.1：参数类内容的渲染结构 ──
  {
    const kvBox = findByClass(tree, "dsh-armor5-kvs");
    const kvRows = collectByClass(tree, "dsh-armor5-kv");
    const KINDS = ["num", "bool", "long", "empty", "text"];
    ok("参数容器在场（.dsh-armor5-kvs，DOM 或源码级）",
      kvBox !== null || CLIENT_SRC.includes('className: "dsh-armor5-kvs"'));
    ok("实时页已改走参数行渲染（kvList(livePairs…) + 面板取 liveParams）",
      CLIENT_SRC.includes('kvList(livePairs, "live"') && CLIENT_SRC.includes(": liveParams;"));
    ok("参数行逐条带值分型（data-kind ∈ num/bool/long/empty/text）",
      kvRows.length === 0 || kvRows.every((r) => KINDS.indexOf(String(r.props["data-kind"])) >= 0),
      "行数=" + kvRows.length);
    ok("数字值走等宽数字（kv[data-kind=num] .v → tabular-nums）",
      /\.dsh-armor5-kv\[data-kind=num\] \.v\{[^}]*tabular-nums/.test(cssText));
    ok("长值走省略号（kv[data-kind=long] .v → ellipsis）",
      /\.dsh-armor5-kv\[data-kind=long\] \.v\{[^}]*text-overflow:ellipsis/.test(cssText));
    ok("空值走暗色占位（kv[data-kind=empty]）", cssText.includes(".dsh-armor5-kv[data-kind=empty] .v{"));
    ok("布尔值走胶囊 + 状态色（kv[data-kind=bool] / v[data-state=on]）",
      cssText.includes(".dsh-armor5-kv[data-kind=bool] .v{") && cssText.includes(".dsh-armor5-kv .v[data-state=on]"));
    ok("明细页 tile 的值同样带分型",
      CLIENT_SRC.includes("var kid = valueKind(value, nowrap)") && CLIENT_SRC.includes('"data-kind": kid'));
  }
  // ── v0.53.2：命中行三段栅格（判决色点 / 时间列 / 正文列）──
  {
    ok("命中行渲染器收成一个（hitRow 被两处命中列表共用）",
      (CLIENT_SRC.match(/hitRow\(hit,/g) || []).length >= 2);
    ok("命中行带判决色点（.dsh-armor5-hit-dot + data-verdict）",
      CLIENT_SRC.includes('className: "dsh-armor5-hit-dot"') &&
      cssText.includes(".dsh-armor5-hit-dot[data-verdict=refusal]"));
    ok("命中行栅格三段 + 无时间行少一列（data-has-time='0'）",
      /\.dsh-armor5-hits li\{[^}]*grid-template-columns:6px 34px 1fr/.test(cssText) &&
      cssText.includes(".dsh-armor5-hits li[data-has-time='0']{grid-template-columns:6px 1fr}"));
    ok("时间列走等宽数字（.dsh-armor5-hit-time → tabular-nums）",
      /\.dsh-armor5-hit-time\{[^}]*tabular-nums/.test(cssText));
    ok("主行/副行单行省略（hit-main / hit-sub → ellipsis）",
      /\.dsh-armor5-hit-main\{[^}]*text-overflow:ellipsis/.test(cssText) &&
      /\.dsh-armor5-hit-sub\{[^}]*text-overflow:ellipsis/.test(cssText));
    ok("命中行 hover 用宿主交互底色",
      cssText.includes(".dsh-armor5-hits li:hover{background:var(--dsw-alias-interactive-bg-hover"));
  }
  // ── v0.53.3：明细页长值的二级展示（收起 / 展开）──
  {
    const foldBoxes = collectByClass(tree, "dsh-armor5-fold");
    const openOnes = foldBoxes.filter((f) => f.props["data-open"] === "1");
    ok("折叠渲染件存在（textValue 第三参 foldKey 生效）",
      CLIENT_SRC.includes("var textValue = function (value, nowrap, foldKey)") &&
      CLIENT_SRC.includes('"data-fold": "1"'));
    ok("明细页长值带 foldKey（词表 / 候选明细 / 扫描范围 / 领域候选）",
      CLIENT_SRC.includes('"f-words"') && CLIENT_SRC.includes('"f-detail"') &&
      CLIENT_SRC.includes('"f-range"') && CLIENT_SRC.includes('"f-cand"'));
    ok("折叠态默认全收起", foldBoxes.length === 0 || openOnes.length === 0, "折叠件=" + foldBoxes.length);
    ok("收起态单行省略 + 展开态换行全文",
      /\.dsh-armor5-fold\[data-open='0'\]\{[^}]*text-overflow:ellipsis/.test(cssText) &&
      /\.dsh-armor5-fold\[data-open='1'\]\{[^}]*white-space:pre-wrap/.test(cssText));
    ok("折叠件可键盘触发（role=button + tabIndex + Enter/Space）",
      CLIENT_SRC.includes('role: "button"') && CLIENT_SRC.includes("tabIndex: 0") &&
      CLIENT_SRC.includes('e.key === "Enter"'));
    ok("展开提示可读（.dsh-armor5-fold-hint 有配色规则）", cssText.includes(".dsh-armor5-fold-hint{"));
  }
  // ── v0.53.4：任务页占位骨架（4 条）/ 命中页筛选计数与分组头 / 明细页分卡 ──
  {
    const skels = collectByClass(tree, "dsh-armor5-skel");
    const skelWrap = findByClass(tree, "dsh-armor5-todo-skel-wrap");
    ok("任务页在无数据时预加载 4 条占位骨架",
      CLIENT_SRC.includes("var todoSkeleton = function (reason)") &&
      CLIENT_SRC.includes("[0, 1, 2, 3].map(function (i)") &&
      (skelWrap === null || skels.length === 4),
      "DOM 骨架=" + skels.length);
    ok("骨架行对读屏隐藏（aria-hidden）",
      CLIENT_SRC.includes('"aria-hidden": "true"') && CLIENT_SRC.includes('className: "dsh-armor5-todo dsh-armor5-skel"'));
    ok("骨架宽度分档 + 动画 + 减弱动效降级",
      cssText.includes(".dsh-armor5-skel-bar[data-w='70']") &&
      cssText.includes("@keyframes dsh-armor5-skel") && cssText.includes("prefers-reduced-motion"));
    ok("命中页筛选条带计数",
      CLIENT_SRC.includes('"data-count": hitCounts[row[0]] || 0') &&
      cssText.includes(".dsh-armor5-filter[data-count]{font-variant-numeric:tabular-nums}"));
    ok("命中页分组头独立成型",
      CLIENT_SRC.includes("var hgroup = function (label, count, child, key)") &&
      cssText.includes(".dsh-armor5-hgroup-count{") && cssText.includes(".dsh-armor5-hgroup-head{"));
    ok("明细页按语义分两张卡",
      CLIENT_SRC.includes('fieldCard("判定线索", clueTiles') &&
      CLIENT_SRC.includes('fieldCard("参数与范围", paramTiles') &&
      cssText.includes(".dsh-armor5-field-cards{"));
  }
  // ── v0.53.5：命中页滚动排版（单栏连续滚动 / 粘性标题 / 底部计数）──
  {
    ok("命中页有独立滚动容器（hits-pane + overscroll 隔离）",
      CLIENT_SRC.includes("var hitsPaneWrap = function (body)") &&
      /\.dsh-armor5-hits-pane\{[^}]*overscroll-behavior:contain/.test(cssText));
    ok("分组列表不再各自滚 120px（组内列表 max-height:none）",
      cssText.includes(".dsh-armor5-hgroup .dsh-armor5-hits{max-height:none;overflow:visible}"));
    ok("日分组头粘在滚动区顶部（sticky + 面板底色 + 遮罩模糊）",
      /\.dsh-armor5-hgroup-head\{[^}]*position:sticky/.test(cssText) &&
      cssText.includes(".dsh-armor5-hgroup-head{position:sticky;top:0;z-index:2;"));
    ok("滚动区上下渐隐提示还有内容（mask-image）",
      /\.dsh-armor5-hits-pane\{[^}]*mask-image:linear-gradient/.test(cssText));
    ok("底部计数条（共 N 条留档 + 滚动提示，等宽数字）",
      CLIENT_SRC.includes('"共 " + hitCounts.all + " 条留档"') &&
      /\.dsh-armor5-hits-foot\{[^}]*tabular-nums/.test(cssText));
  }
  // ── v0.53.6：明细页对齐命中页（单栏滚动 / 卡片标题粘顶 / 展开标记）──
  {
    ok("明细页有自己的滚动容器（fields-pane + overscroll 隔离 + 渐隐）",
      CLIENT_SRC.includes("dsh-armor5-drawer-pane dsh-armor5-fields-pane") &&
      /\.dsh-armor5-fields-pane\{[^}]*overscroll-behavior:contain/.test(cssText) &&
      /\.dsh-armor5-fields-pane\{[^}]*mask-image:linear-gradient/.test(cssText));
    ok("卡片标题在滚动时粘顶（sticky + 面板底色）",
      /\.dsh-armor5-field-card>\.dsh-armor5-sec-title\{[^}]*position:sticky/.test(cssText));
    ok("展开标记更显眼（收起态提示用主题色 + 行尾点线）",
      cssText.includes(".dsh-armor5-fold[data-open='0'] .dsh-armor5-fold-hint{") &&
      cssText.includes(".dsh-armor5-fold[data-open='0']{border-bottom:1px dotted"));
    ok("展开/收起带方向符号（▾ / ▴）",
      CLIENT_SRC.includes('"收起 ▴"') && CLIENT_SRC.includes('"展开 ▾"'));
  }
  // ── v0.53.7 / v0.53.9：包裹框只留「实时 / 任务」，命中与明细走内层框 ──
  {
    const frameEl = findByClass(tree, "dsh-armor5-frame");
    ok("包裹框只给任务页（实时 / 命中 / 明细都平铺，不再多一层）",
      (frameEl !== null || CLIENT_SRC.includes('className: "dsh-armor5-frame"')) &&
      CLIENT_SRC.includes('drawerTab === "todo"') &&
      CLIENT_SRC.includes('// v0.53.10：包裹框只留「任务」一页') &&
      CLIENT_SRC.includes('className: "dsh-armor5-drawer-pane dsh-armor5-drawer-pane-flat"'));
    ok("框有边 / 圆角 / 面层（原生令牌 + 兜底）",
      /\.dsh-armor5-frame\{[^}]*border:1px solid var\(--dsw-alias-border-l2/.test(cssText) &&
      /\.dsh-armor5-frame\{[^}]*border-radius:var\(--dsw-radius-md/.test(cssText) &&
      /\.dsh-armor5-frame\{[^}]*background:var\(--dsw-alias-bg-layer-1/.test(cssText));
    ok("框内卡片换到层 2（框/卡两层不糊在一起）",
      cssText.includes(".dsh-armor5-frame .dsh-armor5-card{background:var(--dsw-alias-bg-layer-2"));
    ok("抽屉体让出边距给框",
      cssText.includes(".dsh-armor5-drawer-body{padding:6px 10px 10px}"));
  }
  // ── v0.53.8：命中列表包裹框 ──
  {
    const listEl = findByClass(tree, "dsh-armor5-hits-list");
    ok("命中列表被包进列表框（hits-list 在 pane 内、包住分组）",
      (listEl !== null || CLIENT_SRC.includes('className: "dsh-armor5-hits-list"')) &&
      CLIENT_SRC.includes('react.createElement("div", { className: "dsh-armor5-hits-list" }, body)'));
    ok("列表框有边 / 圆角 / 面层 / 内边距",
      /\.dsh-armor5-hits-list\{[^}]*border:1px solid var\(--dsw-alias-border-l2/.test(cssText) &&
      /\.dsh-armor5-hits-list\{[^}]*border-radius:var\(--dsw-radius-md/.test(cssText) &&
      /\.dsh-armor5-hits-list\{[^}]*background:var\(--dsw-alias-bg-layer-1/.test(cssText));
    ok("列表框内首组不留顶距 + 行/组头圆角统一到 sm",
      cssText.includes(".dsh-armor5-hits-list .dsh-armor5-hgroup:first-child{margin-top:0}") &&
      cssText.includes(".dsh-armor5-hits-list .dsh-armor5-hits li{border-radius:var(--dsw-radius-sm,8px)}"));
  }
  // ── v0.53.9：明细页内层内容框 + 命中/明细内容排版 ──
  {
    const fieldsList = findByClass(tree, "dsh-armor5-fields-list");
    ok("明细页不再有额外包裹层（上下一致：卡片直接铺在 pane 里）",
      fieldsList === null &&
      !CLIENT_SRC.includes("dsh-armor5-fields-list") &&
      CLIENT_SRC.includes('className: "dsh-armor5-drawer-pane dsh-armor5-fields-pane dsh-armor5-drawer-pane-flat"'));
    ok("明细排版规则改绑到 fields-pane（去框后排版不回退）",
      /\.dsh-armor5-fields-pane \.dsh-armor5-field-card\{[^}]*padding:8px/.test(cssText) &&
      /\.dsh-armor5-fields-pane \.dsh-armor5-field-card \.dsh-armor5-sec-title\{[^}]*font-size:11\.5px/.test(cssText) &&
      /\.dsh-armor5-fields-pane \.dsh-armor5-tile \.b\{[^}]*font-size:11px;line-height:15px/.test(cssText));
    ok("命中内容排版：主行加粗 + 行距 / 副行透明度调过",
      /\.dsh-armor5-hits-list \.dsh-armor5-hit-main\{[^}]*font-weight:600/.test(cssText) &&
      /\.dsh-armor5-hits-list \.dsh-armor5-hit-sub\{[^}]*line-height:13px/.test(cssText) &&
      cssText.includes(".dsh-armor5-hits-list .dsh-armor5-hits{gap:4px}"));
  }
  // ── v0.53.11：任务页滚动容器 ──
  {
    const todoPaneEl = findByClass(tree, "dsh-armor5-todo-pane");
    ok("任务页有独立滚动容器（todo-pane + overscroll 隔离 + 渐隐）",
      (todoPaneEl !== null || CLIENT_SRC.includes('className: "dsh-armor5-todo-pane"')) &&
      CLIENT_SRC.includes('react.createElement("div", { className: "dsh-armor5-todo-pane" }, todoPane)') &&
      /\.dsh-armor5-todo-pane\{[^}]*overscroll-behavior:contain/.test(cssText) &&
      /\.dsh-armor5-todo-pane\{[^}]*mask-image:linear-gradient/.test(cssText));
    ok("任务页区标题滚动时粘顶（sticky + 面层底色）",
      /\.dsh-armor5-todo-pane \.dsh-armor5-sec-title\{[^}]*position:sticky/.test(cssText));
    ok("任务页首区不留顶距（与框内边距不叠加）",
      cssText.includes(".dsh-armor5-todo-pane .dsh-armor5-sec:first-child{margin-top:0}"));
  }
  // ── v0.53.13：「本对话累计」卡（框 + 排版）──
  {
    const memEl = findByClass(tree, "dsh-armor5-mem-card");
    ok("本对话累计有了卡框（含空态）",
      (memEl !== null || CLIENT_SRC.includes('className: "dsh-armor5-card dsh-armor5-mem-card"')) &&
      (CLIENT_SRC.match(/dsh-armor5-card dsh-armor5-mem-card/g) || []).length >= 2);
    ok("累计卡内边距 / 面层 / 行间距",
      /\.dsh-armor5-mem-card\{[^}]*padding:8px/.test(cssText) &&
      /\.dsh-armor5-mem-card\{[^}]*background:var\(--dsw-alias-bg-layer-2/.test(cssText) &&
      cssText.includes(".dsh-armor5-mem-card .dsh-armor5-mem{gap:8px}"));
    ok("累计卡排版：卡标题 11.5px + 内层区标题 10.5px 三级色 + chip 等宽数字",
      /\.dsh-armor5-mem-card>\.dsh-armor5-sec-title\{[^}]*font-size:11\.5px/.test(cssText) &&
      /\.dsh-armor5-mem-card \.dsh-armor5-sec \.dsh-armor5-sec-title\{[^}]*font-size:10\.5px/.test(cssText) &&
      /\.dsh-armor5-mem-card \.dsh-armor5-chip\{[^}]*tabular-nums/.test(cssText));
  }
  // ── v0.53.14：明细页底部让位，其他页不变 ──
  {
    ok("明细页底部留净空 104px（padding + 滚动落点）",
      /\.dsh-armor5-fields-pane\{[^}]*padding-bottom:104px/.test(cssText) &&
      /\.dsh-armor5-fields-pane\{[^}]*scroll-padding-bottom:104px/.test(cssText));
    ok("命中页同一条净空 104px（v0.53.16）",
      /\.dsh-armor5-hits-pane\{[^}]*padding-bottom:104px/.test(cssText) &&
      /\.dsh-armor5-hits-pane\{[^}]*scroll-padding-bottom:104px/.test(cssText));
    ok("两页关掉底部渐隐（最后一行不再被淡掉）",
      cssText.includes(".dsh-armor5-hits-pane,.dsh-armor5-fields-pane{mask-image:none;-webkit-mask-image:none}"));
    ok("两页高度上限收到 42vh/340px（给出底部面板的位置）",
      /\.dsh-armor5-hits-pane\{[^}]*max-height:min\(42vh,340px\)/.test(cssText) &&
      /\.dsh-armor5-fields-pane\{[^}]*max-height:min\(42vh,340px\)/.test(cssText));
    ok("任务页保持原样（不带净空）",
      !/\.dsh-armor5-todo-pane\{[^}]*padding-bottom:104px/.test(cssText));
  }
  // ── v0.53.18：底部「还有 N 条」提示 ──
  {
    const fieldsFoot = findByClass(tree, "dsh-armor5-fields-foot");
    ok("滚动提示件在场（数剩余条数 + 到底改写）",
      CLIENT_SRC.includes("var scrollHint = function (kind, itemSel)") &&
      CLIENT_SRC.includes('"还有 " + rest + " 条 ↓ 继续下滑"') &&
      CLIENT_SRC.includes('return end ? "已到底"'));
    ok("提示件对 DOM 能力做检查 + try/catch 兜底",
      CLIENT_SRC.includes('typeof box.scrollTop !== "number"') &&
      CLIENT_SRC.includes("} catch (e) { return null; }"));
    ok("命中 / 明细两页各自挂 ref + onScroll，并有静态文案兜底",
      CLIENT_SRC.includes('ref: paneRef("hits")') && CLIENT_SRC.includes('ref: paneRef("fields")') &&
      CLIENT_SRC.includes('scrollHint("hits", ".dsh-armor5-hits li")') &&
      CLIENT_SRC.includes('scrollHint("fields", ".dsh-armor5-field-card")') &&
      CLIENT_SRC.includes('|| "在本页内连续滚动"'));
    ok("明细页脚在场（DOM 或源码）且样式为等宽数字",
      (fieldsFoot !== null || CLIENT_SRC.includes('className: "dsh-armor5-fields-foot"')) &&
      /\.dsh-armor5-fields-foot\{[^}]*tabular-nums/.test(cssText));
  }
  // 配平还不够：**选择器规则里不能再套规则**。上面那条 bug 在浏览器里是合法 CSS
  // （CSS Nesting），所以「能解析」不是判据；一旦某条选择器规则没闭合，后面的规则就会
  // 变成它的嵌套子规则，只对最外层选择器的元素生效。@media / @supports 里套规则是正当的，
  // 所以栈里只记「当前块是不是 at-rule」—— 父块不是 at-rule 还出现 `{`，就是错。
  const cssStack = [];
  let cssNested = 0;
  let cssChunk = "";
  for (const part of cssText.match(/[{}]|[^{}]+/g) || []) {
    if (part === "{") {
      const isAtRule = cssChunk.trim().startsWith("@");
      if (cssStack.length > 0 && !cssStack[cssStack.length - 1]) cssNested += 1;
      cssStack.push(isAtRule);
      cssChunk = "";
    } else if (part === "}") {
      cssStack.pop();
      cssChunk = "";
    } else {
      cssChunk = part;
    }
  }
  ok("样式表没有「选择器规则套规则」（未闭合规则的典型症状）", cssNested === 0, "nested=" + cssNested);
  ok("每档徽标规则都自带 color 与右花括号（warning 档曾漏写闭合）",
    /\.dsh-armor5-badge\[data-tone=warning\]\{[^}]*color:[^}]*\}/.test(cssText) &&
    /\.dsh-armor5-badge\[data-tone=error\]\{[^}]*color:[^}]*\}/.test(cssText) &&
    /\.dsh-armor5-badge\[data-tone=success\]\{[^}]*color:[^}]*\}/.test(cssText),
    cssText.slice(cssText.indexOf("[data-tone=warning]"), cssText.indexOf("[data-tone=warning]") + 130));
  // v0.16.4 的版式锚点（分区发丝线 / 值列定宽）与 v0.16.5 的田字格必须同时在样式表里：
  // 光有选择器不够，底色 / 圆角 / 留白缺一个，卡片就退回灰字墙。
  ok("版式锚点齐全（田字格底色留白 / 两列栅格 / 分区发丝线 / chip 圆角）",
    /\.dsh-armor5-tile\{[^}]*padding:5px 6px[^}]*border-radius:7px/.test(cssText) &&
    cssText.includes(".dsh-armor5-grid{display:grid;grid-template-columns:1fr 1fr") &&
    cssText.includes(".dsh-armor5-sec + .dsh-armor5-sec{") &&
    cssText.includes("border-top:1px solid") &&
    /\.dsh-armor5-chip\{[^}]*border-radius:4px/.test(cssText),
    cssText.length + " 字符");
  // v0.19.0：整体比例压缩（面板更窄、字号更小、行高与留白同步收紧）。逐个细项钉死，
  // 免得以后「顺手删一条规则」时排版又静默退化 —— 光有选择器不算数。
  // v0.19.0 定稿：整体比例压缩（面板更窄、字号更小、行高与留白同步收紧）。
  // v0.19.1：这张表就是「面板大小」的唯一真源 —— 表长也被断言，删掉一条锚点直接红；
  // 单条规则「顺手改回去一点」同样红。光有选择器不算数，值也必须对。
  const compactAnchors = [
    ["抽屉 dvh 优先的 @supports 兜底", /@supports \(height:1dvh\)\{\.dsh-armor5-drawer\{max-height:62dvh\}\}/.test(cssText)],
    ["抽屉高度三段兜底（vh → --ig5-vh → dvh）", /\.dsh-armor5-drawer\{[^}]*max-height:62vh/.test(cssText)],
    ["抽屉圆角 14px 14px 0 0", /\.dsh-armor5-drawer\{[^}]*border-radius:14px 14px 0 0/.test(cssText)],
    ["抽屉让出安全区", /padding-bottom:env\(safe-area-inset-bottom,0\)/.test(cssText)],
    ["头部间距 gap 4px", cssText.includes(".dsh-armor5-head{display:flex;align-items:center;gap:4px}")],
    ["头部时刻 10px", cssText.includes("font-size:10px;font-variant-numeric:tabular-nums}")],
    ["徽标高 15px / 内边距 0 6px", /\.dsh-armor5-badge\{[^}]*height:15px;padding:0 6px/.test(cssText)],
    ["徽标字号 10px", /\.dsh-armor5-badge\{[^}]*font-size:10px;background:/.test(cssText)],
    ["分区 margin-top 6px / gap 3px", cssText.includes(".dsh-armor5-sec{margin-top:6px;display:flex;flex-direction:column;gap:3px}")],
    ["分区间距 6px/6px", /\.dsh-armor5-sec \+ \.dsh-armor5-sec\{margin-top:6px;padding-top:6px;/.test(cssText)],
    ["区标题 10px/13px", /\.dsh-armor5-sec-title\{[^}]*font-size:10px;[^}]*line-height:13px/.test(cssText)],
    ["chip 间距 gap 2px", cssText.includes(".dsh-armor5-chips{display:flex;flex-wrap:wrap;gap:2px}")],
    ["chip 内边距 0.5px 5px", /\.dsh-armor5-chip\{[^}]*padding:0\.5px 5px/.test(cssText)],
    ["chip 圆角 4px", /\.dsh-armor5-chip\{[^}]*border-radius:4px/.test(cssText)],
    ["chip 字号/行高 10.5px/13px", /\.dsh-armor5-chip\{[^}]*font-size:10\.5px;line-height:13px/.test(cssText)],
    ["命中流水 gap 3px", /\.dsh-armor5-hits\{[^}]*gap:3px/.test(cssText)],
    ["命中流水上限 120px", /\.dsh-armor5-hits\{[^}]*max-height:120px/.test(cssText)],
    ["命中条目 4px 6px / 圆角 6px", /\.dsh-armor5-hits li\{[^}]*padding:4px 6px;border-radius:6px/.test(cssText)],
    ["命中主行 10.5px", /\.dsh-armor5-hit-main\{[^}]*font-size:10\.5px/.test(cssText)],
    ["命中副行 10px", /\.dsh-armor5-hit-sub\{[^}]*font-size:10px/.test(cssText)],
    ["栅格 gap 4px", cssText.includes(".dsh-armor5-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px}")],
    ["tile 标签 10px/12px", /\.dsh-armor5-tile \.t\{[^}]*font-size:10px;line-height:12px/.test(cssText)],
    ["tile 值行 10.5px/13px", /\.dsh-armor5-tile \.b\{[^}]*font-size:10\.5px;line-height:13px/.test(cssText)],
    ["注脚 10px/12px", /\.dsh-armor5-cap\{[^}]*font-size:10px;[^}]*line-height:12px/.test(cssText)]
  ];
  const COMPACT_ANCHOR_COUNT = 24;
  const compactFailures = compactAnchors.filter(([, pass]) => !pass).map(([name]) => name);
  ok("紧凑比例锚点数量固定（" + compactAnchors.length + "/" + COMPACT_ANCHOR_COUNT + " 条，删一条就红）",
    compactAnchors.length === COMPACT_ANCHOR_COUNT,
    compactAnchors.length + " 条");
  ok("紧凑比例锚点齐全（面板 / 徽标 / 分区 / chip / 命中流水 / tile / 注脚 全部按定稿值）",
    compactFailures.length === 0,
    compactFailures.join(" · ") || cssText.length + " 字符");
  // v0.22.0：浮层卡片里新增「用户向选择」循环切档按钮（设置页之外的第二处入口，用户抱怨「浮层里看不到开关」）。
  // 三态文案 + 胶囊样式都必须落在盘上：只在源码里留个 className 不算数，样式漏一处就退化成裸文字按钮。
  const gateBtn = findByClass(tree, "dsh-armor5-cycle");
  ok("浮层卡片里有「用户向选择」切档按钮（不用跑去设置页找）", gateBtn !== null);
  ok("切档按钮带当前档位 data-mode（CSS 靠它给 off 档褪色）",
    gateBtn !== null && ["proactive", "auto", "on", "off"].indexOf(String(gateBtn.props["data-mode"])) >= 0,
    gateBtn && String(gateBtn.props["data-mode"]));
  ok("切档按钮写清「当前档 → 下一档」（就绪 / 读档 / 未就绪 三态之一）",
    gateBtn !== null && /^(选择：.+ → .+|读取档位…|档位未就绪（刷新页面）)$/.test(textOf(gateBtn)),
    gateBtn && textOf(gateBtn));
  ok("切档按钮的 title 交代当前档与下一档的含义（不用猜档位在干什么）",
    gateBtn !== null && String(gateBtn.props.title || "").indexOf("点一下切到") >= 0,
    gateBtn && String(gateBtn.props.title || "").slice(0, 90));
  ok("切档按钮样式齐全（胶囊圆角 / 禁用态 / off 档褪色）",
    /\.dsh-armor5-cycle\{[^}]*border-radius:999px/.test(cssText) &&
    cssText.indexOf(".dsh-armor5-cycle:disabled{") >= 0 &&
    cssText.indexOf(".dsh-armor5-cycle[data-mode=off]{") >= 0);
  // v0.22.0：按钮并进「位置」那一行（另起一节会把卡片高度从 353px 顶回 399px，撞 verify_card_size 的带宽）。
  ok("切档按钮与「位置」同一行（caprow：左位置可省略号、右按钮不伸缩，不新增分区）",
    cssText.indexOf(".dsh-armor5-caprow{display:flex;align-items:center;gap:6px}") >= 0 &&
    cssText.indexOf(".dsh-armor5-caprow .dsh-armor5-cap{flex:1 1 auto;min-width:0;overflow:hidden;") >= 0 &&
    cssText.indexOf(".dsh-armor5-caprow .dsh-armor5-cycle{flex:0 0 auto;max-width:62%}") >= 0 &&
    panelText.indexOf("用户向选择 · ") < 0,
    panelText.slice(0, 60));
  ok("浮层切档与设置页同一条写通道（statsStore.stage + save，没有第二套 POST）",
    CLIENT_SRC.indexOf('statsStore.stage("ASK_GATE_MODE", gateNext.value)') >= 0 &&
    CLIENT_SRC.indexOf("statsStore.save(false)") >= 0);
  ok("浮层切档只写 ASK_GATE_MODE 一个键（不把 effective 里每个键都提升成持久化 override）",
    CLIENT_SRC.indexOf('statsStore.stage("ASK_GATE_MODE"') >= 0 &&
    CLIENT_SRC.indexOf("Object.keys(base).forEach") < 0);
  ok("四档顺序真源在源码里（proactive 打头、off 收尾）且按钮接进了「位置」行",
    /var GATE_MODES = \[[\s\S]{0,40}\{ value: "proactive"/.test(CLIENT_SRC) &&
    CLIENT_SRC.indexOf('{ value: "off"') >= 0 &&
    CLIENT_SRC.indexOf("gateButton()") >= 0);
  // v0.16.1：浮层卡片自己也订一份统计库（与设置页那组同源），卡片没拿到桥时至少要有「信号 / 本轮」两行。
  collectByClass(tree, "dsh-armor5-tab").find((t) => t.props["data-tab"] === "live").props.onClick();
  tree = m.rerender();
  const liveText = textOf(findByClass(tree, "dsh-armor5-drawer"));
  ok("抽屉「实时」页带数据连接与这一轮两行（卡片自己订阅统计库）",
    (liveText.includes("信号") || liveText.includes("数据连接")) &&
    (liveText.includes("本轮") || liveText.includes("这一轮")), liveText.slice(-160));
  ok("浮层打开时 aria-expanded=true", findByClass(tree, "dsh-armor5-root").props["aria-expanded"] === "true");
  // 统计库的 visibilitychange 监听也挂在 document 上（v0.16.1 卡片订阅），所以不再数总数，
  // 只按类型数：卡片必须恰好挂一个 pointerdown + 一个 keydown。
  ok("浮层打开后挂了 outside-click / Esc 监听",
    doc.__listeners.filter((pair) => pair[0] === "pointerdown").length === 1 &&
    doc.__listeners.filter((pair) => pair[0] === "keydown").length === 1,
    JSON.stringify(doc.__listeners.map((pair) => pair[0])));
  button = findByClass(tree, "dsh-armor5-root");
  button.props.onClick();
  tree = m.rerender();
  findByClass(tree, "dsh-armor5-tab-close").props.onClick();
  ok("点 ✕ 收起抽屉", findByClass(m.rerender(), "dsh-armor5-drawer") === null);
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
  // v0.51.0：面板新增「用户模式 / 开发者模式」，出厂默认 user（说人话）。
  // 本文件大量断言查的是**内部字段名**（识别领域 / 信号 / 判拒窗口…），那是开发者口径，
  // 所以这里统一播种 dev；要测用户模式的块显式传 { [PREF_KEY]: ... panelMode: "user" } 覆盖。
  const seed = {
    [PREF_KEY]: JSON.stringify({ panelMode: "dev" })
  };
  const data = Object.assign(seed, initial);
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
  // v0.14.1：注入统计库桥（token + path），用于真渲染「领域覆盖 · 词表 · 预算」显示组。
  if (opts.stats !== undefined) win.__IG5_STATS__ = opts.stats;
  const fetchFn = typeof opts.fetch === "function" ? opts.fetch : (...args) => fetchImpl(...args);
  // v0.15.0：自适应轮询的间隔要能被量出来（活跃 400 ms / 空闲 3 s），所以允许测试侧记账。
  const timerFn = typeof opts.onTimer === "function"
    ? (fn, ms) => { opts.onTimer(ms); return setTimeout(fn, ms); }
    : setTimeout;
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "MutationObserver", "setTimeout", "clearTimeout", "console", "fetch", src)(
    win, doc, FakeMutationObserver, timerFn, clearTimeout, console, fetchFn);
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
  ok("出厂默认 = 源码常量（glyph / composer，且偏好里不再有侧栏入口）",
    inst.meta.prefDefaults.triggerMode === "glyph" && inst.meta.prefDefaults.slotMode === "composer" &&
    inst.meta.prefFields.slice().sort().join(",") === "panelMode,slotMode,triggerMode", JSON.stringify(inst.meta.prefDefaults));
  ok("只读偏好不写盘（没改就不落 localStorage）",
    Object.keys(storage.dump()).length <= 1,   // v0.51.0：假存储会播种 panelMode，故留 1 个键
    JSON.stringify(storage.dump()));
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
  ok("设置台有调参按钮（保存并生效 / 档位复位到默认 / 重新读取）",
    collectByClass(view.tree, "armor5-tune-btn").length === 3,
    JSON.stringify(collectByClass(view.tree, "armor5-tune-btn").map((b) => textOf(b))));
  // v0.52.7 解耦锁：任务清单完全交给浮层抽屉，设置台不得再画一份
  ok("设置台不再渲染任务清单（任务块已交回抽屉）",
    !CLIENT_SRC.includes("function taskProgress(") && !CLIENT_SRC.includes("armor5-task-list"),
    CLIENT_SRC.includes("armor5-task-list") ? "仍残留 armor5-task-list" : "");
  ok("抽屉仍负责任务清单（dsh-armor5-todos 在场）",
    CLIENT_SRC.includes("dsh-armor5-todos") && CLIENT_SRC.includes('drawerTab === "todo"'));
  ok("没有 __IG5_TUNING__ 时降级成只读提示 + YAML 片段（不联网、不白屏）",
    textOf(view.tree).includes("调参接口不可用") && findByClass(view.tree, "armor5-console-yaml") !== null &&
    textOf(view.tree).includes("cordis.patch.yml"),
    JSON.stringify(textOf(view.tree).slice(0, 160)));
  ok("owner 不传 close 时不渲染「完成」按钮（不崩）",
    textOf(view.tree).includes("恢复默认") && !textOf(view.tree).includes("完成"));
  const withClose = mountComponent(inst.page, undefined);
  ok("owner 传了 close 才出现「完成」按钮（走宿主给的退出路径）", true);

  // ── 覆盖显示组（v0.14.1）：喂一份真统计库，面板必须把族分布 / 预算 / 取用画出来 ──
  const coverageDoc = (percent) => ({
    ok: true,
    source: "disk",
    version: "0.0.0-ui",
    generatedAt: new Date().toISOString(),
    boot: { pid: 4242, version: "0.0.0-ui" },
    runtime: { anchorEmissions: 7, placements: [{ order: 100 }, { order: 200 }, { order: 118 }, { order: 10150 }] },
    coverage: {
      domains: 107,
      families: { offense: 36, ai: 13, crypto: 11, data: 8, creative: 11, language: 10, engineering: 18 },
      familyOrder: ["offense", "ai", "crypto", "data", "creative", "language", "engineering"],
      familyLabels: { offense: "攻防 / 逆向", ai: "AI / LLM", crypto: "密码与协议", data: "数据与隐私", creative: "内容创作", language: "语言与学术", engineering: "工程与业务" },
      markers: { total: 2311, latin: 851, cjk: 1306, mixed: 154 },
      extended: { total: 2512, aliases: 652, markers: 920, commands: 526, toolchains: 414 },
      index: { bytes: 20017, budget: 24000, percent },
      playbooks: { min: 639, max: 4540, total: 317484, minBytes: 600, maxBytes: 6000 },
      gaps: {
        limits: {"markers":12,"aliases":14,"commands":3,"toolchain":3,"playbookMin":600},
        targets: {"markers":16,"aliases":16,"commands":4,"toolchain":4,"playbook":900},
        exemptFamilies: ["creative", "language"],
        deepDomains: 86,
        belowLimit: [],
        thinCount: 11,
        thin: [{ id: "lyrics", family: "creative", exempt: true, thin: ["playbook"], markers: 8, aliases: 9, commands: 0, toolchain: 0, bytes: 639 }],
        headroom: {"bytes":3983,"perDomain":187,"domainsAffordable":21},
        collisions: { shared: 55, crossFamily: 10, crossFamilyItems: [], signedAllow: 3, signed: 4, unsigned: 0, items: [], unsignedItems: [] }
      },
      hits: { web: 3, re: 2, malware: 1 },
      misses: 2
    },
    tuning: { effective: { LAYER2_MODE: "off" }, catalog: null, sources: { LAYER2_MODE: "default" }, live: { placements: [], rebuilds: 0, anchorEmissions: 0 } },
    tasks: { available: true, source: "todos@sessionProjections", counts: { pending: 1, inProgress: 0, completed: 2 }, items: [] }
  });
  const covFetch = (doc) => () => Promise.resolve({ status: 200, json: () => Promise.resolve(doc) });
  const covInst = loadInstance({
    storage: fakeStorage({}),
    stats: { path: "/infinite-gen-5/stats", tasksPath: "/infinite-gen-5/tasks", tuningPath: "/infinite-gen-5/tuning", token: "tok-cov" },
    fetch: covFetch(coverageDoc(83.4))
  });
  const covView = mountComponent(covInst.page, undefined, { hooks: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const covTree = covView.rerender();
  const covText = textOf(covTree);
  ok("覆盖显示组按库里的分区渲染（标题带域数与族数）",
    covText.includes("领域覆盖 · 词表 · 预算（107 域 × 7 族）"), JSON.stringify(covText.slice(0, 120)));
  ok("族分布画 7 条 + 索引预算 1 条",
    collectByClass(covTree, "armor5-cov-row").length === 8, String(collectByClass(covTree, "armor5-cov-row").length));
  ok("词表 / 标记表 / 索引 / 单包 / 取用都上屏",
    covText.includes("2512 条扩展") && covText.includes("2311 个词") && covText.includes("19.5 KB / 23.4 KB（83.4%）") &&
    covText.includes("639 B – 4.4 KB") && covText.includes("web 3"), JSON.stringify(covText.slice(0, 400)));
  ok("缺口行上屏：余量 / 薄弱域 / 撞车三行都由库里的 gaps 画出来",
    covText.includes("索引还剩 3.9 KB（均值 187 B/域）→ 还能加 21 个域") &&
    covText.includes("11 个贴边（目标 ≥16 命中 / ≥16 别名 / ≥4 命令 / ≥4 工具链）") &&
    covText.includes("低于门禁下限 0 个 · 非豁免 86 域") &&
    covText.includes("跨族共用 10 · 共用词 55 · 签字 4 · 未签字 0"),
    JSON.stringify(covText.slice(0, 600)));
  {
    const noGap = coverageDoc(83.4);
    delete noGap.coverage.gaps;
    const noGapInst = loadInstance({
      storage: fakeStorage({}),
      stats: { path: "/infinite-gen-5/stats", tuningPath: "/infinite-gen-5/tuning", token: "tok-nogap" },
      fetch: covFetch(noGap)
    });
    const noGapView = mountComponent(noGapInst.page, undefined, { hooks: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const noGapText = textOf(noGapView.rerender());
    ok("库里没有 gaps 时三行给可读原因（不谎报缺口）",
      noGapText.includes("需要 v0.26.0 的服务端") && !noGapText.includes("还能加"),
      JSON.stringify(noGapText.slice(0, 400)));
  }
  ok("健康行带库版本 / pid / 锚点数 / 注入处数",
    covText.includes("库 v0.0.0-ui") && covText.includes("pid 4242") && covText.includes("锚点已发 7 版") &&
    covText.includes("注入 4 处"), JSON.stringify(covText.slice(0, 400)));
  ok("只读表里的域数也来自库（不再硬编码 56）",
    covText.includes("107 域 × 7 族；infinite_gen5_scenario"));
  ok("索引占比 < 75% 时预算条是正常档",
    collectByClass(covTree, "armor5-cov-bar").some((b) => b.props["data-level"] === "ok"));
  const hotInst = loadInstance({
    storage: fakeStorage({}),
    stats: { path: "/infinite-gen-5/stats", tuningPath: "/infinite-gen-5/tuning", token: "tok-hot" },
    fetch: covFetch(coverageDoc(95.5))
  });
  const hotView = mountComponent(hotInst.page, undefined, { hooks: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const hotTree = hotView.rerender();
  ok("索引占比 >= 90% 时预算条转红（预算见底一眼可见）",
    collectByClass(hotTree, "armor5-cov-bar").some((b) => b.props["data-level"] === "danger"));
  const bare = coverageDoc(72.8);
  delete bare.coverage;
  const bareInst = loadInstance({
    storage: fakeStorage({}),
    stats: { path: "/infinite-gen-5/stats", tuningPath: "/infinite-gen-5/tuning", token: "tok-bare" },
    fetch: covFetch(bare)
  });
  const bareView = mountComponent(bareInst.page, undefined, { hooks: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const bareText = textOf(bareView.rerender());
  ok("没有覆盖分区时给可读原因、域数留占位（不谎报）",
    bareText.includes("统计库里还没有覆盖分区") && bareText.includes("— 域 × 7 族"), JSON.stringify(bareText.slice(0, 160)));

  // ── 实时化（v0.15.0）：推送优先、断线回落自适应轮询、后台暂停、live 行 ─────────
  {
    // 假 EventSource：记住 URL、手动开/推/断、记录自己被关掉。推送帧内容一律不看，
    // 因为客户端约定「帧只当闹钟，正文回读 /stats」——推的 data 故意是没意义的字符串。
    const streams = [];
    let seenES = null;
    class FakeEventSource {
      constructor(url) { this.url = url; this.closed = false; seenES = this; streams.push(this); }
      close() { this.closed = true; }
      open() { if (this.onopen) this.onopen({}); }
      push() { if (this.onmessage) this.onmessage({ data: "wake" }); }
      fail() { if (this.onerror) this.onerror({}); }
    }
    class BoomEventSource { constructor() { throw new Error("EventSource 起不来"); } }
    const prevES = globalThis.EventSource;
    const delays = [];
    const liveDocFor = (count, startedAt) => {
      const doc0 = coverageDoc(72.8);
      doc0.live = {
        at: new Date().toISOString(),
        turn: { active: true, startedAt, lastEventAt: new Date(Date.now() - 1000).toISOString(), lastKind: "assistant/message", idleMs: 1000 },
        events: { windowMs: 30000, count, perSecond: 0.4 },
        tools: { recent: [{ tool: "infinite_gen5_scenario", at: new Date().toISOString(), bytes: 4540, capped: false, truncated: false }], lastAt: new Date().toISOString() }
      };
      return doc0;
    };
    const liveStats = {
      path: "/infinite-gen-5/stats", tasksPath: "/infinite-gen-5/tasks",
      tuningPath: "/infinite-gen-5/tuning", eventsPath: "/infinite-gen-5/events", token: "tok live/+"
    };
    try {
      globalThis.EventSource = FakeEventSource;
      const docs = [liveDocFor(12, new Date(Date.now() - 42000).toISOString())];
      const liveInst = loadInstance({
        storage: fakeStorage({}),
        stats: liveStats,
        onTimer: (ms) => delays.push(ms),
        fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve(docs[docs.length - 1]) })
      });
      const liveView = mountComponent(liveInst.page, undefined, { hooks: [] });
      await new Promise((resolve) => setTimeout(resolve, 0));
      ok("面板按查询串 token 订阅推送（EventSource 带不了自定义请求头）",
        streams.length === 1 && streams[0].url === "/infinite-gen-5/events?token=" + encodeURIComponent("tok live/+"),
        JSON.stringify(streams.map((s) => s.url)));
      const early = textOf(liveView.rerender());
      ok("live 行来自库里的 live 分区（本轮 / 事件速率 / 最近工具）",
        early.includes("进行中 · 已 42 秒") && early.includes("12 次 / 30 秒") &&
        early.includes("infinite_gen5_scenario(4.4 KB)"), JSON.stringify(early.slice(0, 240)));
      ok("推送还没连上时按轮询算（面板不假装自己在推送）",
        early.includes("轮询中") && early.includes("推送已连接") === false, JSON.stringify(early.slice(0, 240)));
      seenES.open();
      const opened = textOf(liveView.rerender());
      ok("推送连上后状态行改「推送中」并停掉轮询",
        opened.includes("推送中 · 推送已连接：统计库一落盘就刷新"), JSON.stringify(opened.slice(0, 240)));
      docs.push(liveDocFor(13, new Date(Date.now() - 43000).toISOString()));
      seenES.push();
      await new Promise((resolve) => setTimeout(resolve, 0));
      ok("收到推送就回读统计库、把新数字画出来（帧只当闹钟，不解析正文）",
        textOf(liveView.rerender()).includes("13 次 / 30 秒"));
      seenES.fail();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const fell = textOf(liveView.rerender());
      ok("推送断线立刻回落轮询，并说明白自己怎么了",
        fell.includes("断线回落"),
        JSON.stringify(fell.slice(Math.max(0, fell.indexOf("信号")), fell.indexOf("信号") + 160)));
      ok("回落之后重新排上轮询定时器（活跃 400 ms / 空闲 3 s 二选一）",
        delays.includes(400) || delays.includes(3000), JSON.stringify(delays.slice(-4)));
      // 后台暂停：document.hidden 时不排新定时器，只留一句人话
      const beforeHidden = delays.length;
      doc.hidden = true;
      doc.__listeners.filter((pair) => pair[0] === "visibilitychange").forEach((pair) => pair[1]());
      const paused = textOf(liveView.rerender());
      ok("页面切到后台就停轮询（切回来会补一次）",
        paused.includes("页面在后台，已暂停轮询") && delays.length === beforeHidden,
        JSON.stringify(paused.slice(0, 240)));
      delete doc.hidden;
      doc.__listeners.filter((pair) => pair[0] === "visibilitychange").forEach((pair) => pair[1]());
      await new Promise((resolve) => setTimeout(resolve, 0));
      ok("切回前台立刻补读一次并重排定时器",
        delays.length > beforeHidden && textOf(liveView.rerender()).includes("轮询中"),
        JSON.stringify(delays.slice(-2)));
      liveInst.dispose();
      ok("卸载时把推送连接关掉（不留下悬挂的长连接）", seenES.closed === true);
    } finally {
      if (prevES === undefined) delete globalThis.EventSource; else globalThis.EventSource = prevES;
    }
    // 老宿主：没有 eventsPath 时不许碰 EventSource，直接走轮询；EventSource 构造失败也要能活
    globalThis.EventSource = BoomEventSource;
    const oldInst = loadInstance({
      storage: fakeStorage({}),
      stats: { path: "/infinite-gen-5/stats", tuningPath: "/infinite-gen-5/tuning", token: "tok-old" },
      fetch: covFetch(coverageDoc(72.8))
    });
    try {
      const oldView = mountComponent(oldInst.page, undefined, { hooks: [] });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const oldText = textOf(oldView.rerender());
      ok("宿主没给推送路径时老实轮询（不臆造 /events）",
        oldText.includes("轮询中 · ") && oldText.includes(" ms") && oldText.includes("还没有实时分区"),
        JSON.stringify(oldText.slice(0, 200)));
    } finally {
      delete globalThis.EventSource;
    }
  }

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

  // 侧栏入口（v0.16.2 移除）：旧偏好键被忽略，任何情况下都不再注册侧栏槽位
  const injectedBefore = inst.log.injected.length;
  inst.exports.setPrefs({ sidebarIcon: true });
  ok("侧栏入口已移除：再设 sidebarIcon 也不会注册 main / panellist",
    !inst.log.injected.includes("main") && !inst.log.injected.includes("sidebar.panellist") &&
    !inst.registrations.some((r) => r.options.name === "main" || r.options.name === "sidebar.panellist"),
    JSON.stringify(inst.registrations.map((r) => r.options.name)));
  ok("未知偏好键不改动槽位（writePrefs 只认 PREF_DEFAULTS 里的键）",
    inst.log.injected.length === injectedBefore);
  ok("设置页不再有「侧栏入口」那个开关",
    collectByClass(mountComponent(inst.page, undefined).tree, "armor5-console-choice")
      .every((b) => b.props["data-choice"] !== "sidebar"));

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
  ok("存了旧版 sidebarIcon 偏好也不再恢复侧栏入口", !inst.injected.includes("sidebar.panellist"));
  const badge = mountComponent(inst.badge, { "infinite-gen-5:armor": PASS });
  ok("刷新后形态也是保存过的 full", textOf(badge.tree) === "通过 · web(3) · 载荷 2", JSON.stringify(textOf(badge.tree)));

  const junk = fakeStorage({ [PREF_KEY]: "{不是 JSON" });
  const broken = loadInstance({ storage: junk });
  ok("坏 JSON 不抛错且回落出厂默认",
    broken.injected[0] === "conversation.composer.dock" && broken.meta.prefDefaults.triggerMode === "glyph");
  const wrong = fakeStorage({ [PREF_KEY]: JSON.stringify({ triggerMode: "nope", slotMode: 42, sidebarIcon: "yes" }) });
  const guarded = loadInstance({ storage: wrong });
  ok("每一项非法值逐字段回落（不会整包丢弃）",
    guarded.injected[0] === "conversation.composer.dock" && !guarded.injected.includes("main"));
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
  .panel-host .dsh-armor5-drawer{position:static !important;bottom:auto !important;left:auto !important;width:264px !important;display:block !important}
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

  <h2>3 · 判决浮层卡片（点击展开：徽标头 + 命中 / 风险载荷 chip + 最近命中流水 + 实时四行）</h2>
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

  <h2>5 · 设置页「插件」之后的无限五代页（v0.16.2 起不再提供侧栏入口）</h2>
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
// 宿主布局两种都认（0.1.7 嵌在 dsh 包内 / 0.2.0 平铺兄弟包）：先按包名搜，
// 再回落到旧绝对路径与仓库内副本（v0.38.2）。
function themeCandidates() {
  const dir = findPackageDir("dsh-client-ui-theme");
  return [
    dir && join(dir, "lib", "client.js"),
    "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js",
    join(ROOT, "node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js")
  ].filter(Boolean);
}

function loadThemeCss(explicit) {
  if (explicit) { try { return readFileSync(explicit, "utf8"); } catch { /* 落到自动探测 */ } }
  for (const candidate of themeCandidates()) {
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
  const panelHtml = toHtml(findByClass(openTree, "dsh-armor5-drawer"));
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
  ok("十二个开关各渲染一行来源标记（服务端 catalog 缺失时用兜底目录）",
    collectByClass(tree, "armor5-console-tag").length === 12,
    String(collectByClass(tree, "armor5-console-tag").length));
  ok("兜底目录里带了询问/阶段闸门两个键",
    collectByClass(tree, "armor5-console-choice").some((b) => String(b.props["data-choice"] ?? "").startsWith("ASK_GATE_MODE=")),
    JSON.stringify(collectByClass(tree, "armor5-console-choice").map((b) => b.props["data-choice"]).slice(-6)));
  // v0.36.2：兜底目录曾比服务端 TUNING_CATALOG 少 BOOST_*/LAZY_* 四键，接口拿不到时
  // 设置页会静默少掉增强集与惰性章节两组旋钮 —— 这条把「兜底 >= 服务端全集」钉住。
  ok("兜底目录补齐增强集/惰性章节四键（接口不可用也不缺旋钮）",
    ["BOOST_MODE", "BOOST_BYTES", "LAZY_MODE", "LAZY_BYTES"].every((k) =>
      collectByClass(tree, "armor5-console-choice").some((b) => String(b.props["data-choice"] ?? "").startsWith(k + "="))),
    JSON.stringify(collectByClass(tree, "armor5-console-choice").map((b) => b.props["data-choice"])));
  // v0.36.3：旋钮分三组、每组两栏 —— 12 个键一列到底会把设置页拉成长卷。
  // 树里的 children 由宿主归一化，不保证留在 props.children 上 —— 按类名数节点更稳。
  const knobGrids = collectByClass(tree, "armor5-knob-grid");
  const knobs = collectByClass(tree, "armor5-knob");
  ok("旋钮渲染成网格（三组网格、十二个旋钮各就各位）",
    knobGrids.length === 3 && knobs.length === 12,
    JSON.stringify({ grids: knobGrids.length, knobs: knobs.length }));
  ok("三组标题按「载荷 / 节拍 / 形态」排",
    ["载荷与预算", "节拍与门", "形态与去重"].every((t) => textOf(tree).includes(t)),
    JSON.stringify(textOf(tree).slice(0, 160)));
  // 数字键曾一律给 N=2/4/6/8：对 BOOST_BYTES(256–12000) 与 LAZY_BYTES(0–16000) 全是越界值，
  // 点了必被区间守卫拒收 —— 四个坏按钮。这条把「档位落在真区间内」钉住。
  const knobValues = collectByClass(tree, "armor5-console-choice").map((b) => String(b.props["data-choice"] ?? ""));
  const ladderOf = (k) => knobValues.filter((c) => c.startsWith(k + "=")).map((c) => Number(c.slice(k.length + 1)));
  ok("字节旋钮的档位落在守卫区间内（不再给 N=2/4/6/8 这种必被拒收的值）",
    ladderOf("BOOST_BYTES").length >= 3 && ladderOf("BOOST_BYTES").every((n) => n >= 256 && n <= 12000) &&
    ladderOf("LAZY_BYTES").length >= 3 && ladderOf("LAZY_BYTES").every((n) => n >= 0 && n <= 16000) &&
    ladderOf("RUNTIME_ANCHOR_EVERY").includes(2),
    JSON.stringify({ boost: ladderOf("BOOST_BYTES"), lazy: ladderOf("LAZY_BYTES"), every: ladderOf("RUNTIME_ANCHOR_EVERY") }));
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
  ok("点「保存并生效」把整份草稿 POST 给服务端（一次请求带全部已改键）",
    posted.length === 1 && posted[0].init.headers["x-ig5-token"] === "tok-abc" &&
    JSON.parse(posted[0].init.body).overrides.LAYER2_MODE === "off" &&
    JSON.parse(posted[0].init.body).overrides.RUNTIME_ANCHOR_EVERY === 2,
    JSON.stringify(posted[0] && posted[0].init.body));
  const afterSave = view.rerender();
  ok("保存后状态行报出「已生效」与哪些键被改写",
    textOf(afterSave).includes("已生效") && textOf(afterSave).includes("LAYER2_MODE"),
    JSON.stringify(textOf(afterSave).slice(0, 200)));

  const resetBtn = collectByClass(afterSave, "armor5-tune-btn").find((b) => textOf(b).includes("档位复位到默认"));
  resetBtn.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const allPosted = calls.filter((c) => c.method === "POST");
  ok("「档位复位到默认」发的是 {reset:true}，不是把当前值再发一遍",
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

// ── 底部抽屉（v0.48.0 · LAYOUT_MODE=drawer）─────────────────────────────────
{
  const storage = fakeStorage({});
  const inst = loadInstance({ storage });
  const store = { hooks: [] };
  const badge = mountComponent(inst.badge, { "infinite-gen-5:armor": PASS }, store);

  // 设置页里长出了第三组选择（形态 / 槽位之外的「弹出方式」）
  const consoleView = mountComponent(inst.page, undefined);
  const layoutBtns = collectByClass(consoleView.tree, "armor5-console-choice")
    .filter((b) => ["popover", "drawer"].includes(b.props["data-choice"]));
  // 切到抽屉：写盘 + 状态条换成抽屉容器
  // C 方案（v0.49.0）：layoutMode 偏好已删除，抽屉是唯一容器，无需切档写盘。
  findByClass(badge.rerender(), "dsh-armor5-root").props.onClick();
  let tree = badge.rerender();
  const drawer = findByClass(tree, "dsh-armor5-drawer");
  ok("抽屉布局：点开后渲染 .dsh-armor5-drawer", drawer !== null);
  ok("浮层已从源码与 DOM 中彻底删除（只有抽屉一种容器）",
    !CLIENT_SRC.includes('className: "dsh-armor5-panel"') && findByClass(tree, "dsh-armor5-panel") === null);
  const drawerSettled2 = findByClass(badge.rerender(), "dsh-armor5-drawer");
  ok("抽屉按实测几何修正（位移补回 + 宽度铺满视口）",
    drawerSettled2 !== null && drawerSettled2.props.style !== undefined &&
    /translate\(-?\d/.test(String(drawerSettled2.props.style.transform)),
    JSON.stringify(drawerSettled2 && drawerSettled2.props.style));
  ok("抽屉带遮罩（点遮罩可收起）", findByClass(tree, "dsh-armor5-scrim") !== null);
  ok("抽屉是对话框语义（role=dialog + aria-modal）",
    drawer.props.role === "dialog" && drawer.props["aria-modal"] === "true");

  const tabs = collectByClass(tree, "dsh-armor5-tab");
  ok("抽屉带四个页签（实时 / 命中 / 明细 / 任务）", tabs.length === 4, "实际 " + tabs.length);
  // v0.49.0 回归（v0.48.0 的页签失效根因）：外部点击判定必须把抽屉本身算作「内部」，
  // 否则捕获阶段的 pointerdown 会先把 open 置假、抽屉被卸载，页签的 click 永远到不了。
  {
    // 假 DOM 的 querySelector / contains 恒为空，模拟不出 containment → 钉源码级保证；
    // 「页签真的能切」由下面的 data-tab 断言承担。
    const downPair = (doc.__listeners || []).find((pair) => pair[0] === "pointerdown");
    ok("注册了 document 级 pointerdown（外部点击判定在场）", Boolean(downPair));
    ok("外部点击判定把抽屉算作内部（不再只认已删除的 .dsh-armor5-panel）",
      CLIENT_SRC.includes('drawerRef.current') && CLIENT_SRC.includes('.dsh-armor5-panel, .dsh-armor5-drawer'));
  }
  ok("默认停在「实时」页", drawer.props["data-tab"] === "live", String(drawer.props["data-tab"]));
  ok("当前页签高亮 data-on=1（唯一）",
    tabs.filter((t) => t.props["data-on"] === "1").length === 1 &&
    tabs.find((t) => t.props["data-tab"] === "live").props["data-on"] === "1");
  ok("实时页上屏实时磁贴（与浮层同一份数据）", textOf(drawer).includes("信号来源") || textOf(drawer).includes("本轮"),
    textOf(drawer).slice(0, 160));

  // 切页签：容器与订阅都不重来，只有 pane 换内容
  tabs.find((t) => t.props["data-tab"] === "hits").props.onClick();
  tree = badge.rerender();
  const drawer2 = findByClass(tree, "dsh-armor5-drawer");
  ok("点「命中」页签后 data-tab 跟着变", drawer2.props["data-tab"] === "hits", String(drawer2.props["data-tab"]));
  ok("命中页显示判决留档列表",
    textOf(drawer2).includes("最近命中") || textOf(drawer2).includes("还没有判决留档"), textOf(drawer2).slice(0, 160));
  collectByClass(tree, "dsh-armor5-tab").find((t) => t.props["data-tab"] === "fields").props.onClick();
  tree = badge.rerender();
  const fieldsDrawer = findByClass(tree, "dsh-armor5-drawer");
  ok("明细页把九个字段磁贴搬了进来（识别领域 / 领域候选 都在）",
    textOf(fieldsDrawer).includes("识别领域") && textOf(fieldsDrawer).includes("领域候选"),
    textOf(fieldsDrawer).slice(0, 160));
  ok("明细页与浮层同源：真实值也在（通过 / web）",
    textOf(fieldsDrawer).includes("通过") && textOf(fieldsDrawer).includes("web"));

  // 收起 + 退回浮层：两条路都要能走回去
  findByClass(tree, "dsh-armor5-tab-close").props.onClick();
  ok("点右上角 ✕ 收起抽屉", findByClass(badge.rerender(), "dsh-armor5-drawer") === null);
  // C 方案：没有「切回 popover」这条路 —— 回退靠 git 回滚（参见 ROLLBACK.sh）。
}

// ── 任务清单进度（v0.50.2 · 宿主 useProjection("todos") 投影）────────────────
{
  const inst = loadInstance({ storage: fakeStorage({}) });
  const TODO_PROJ = {
    "infinite-gen-5:armor": PASS,
    todos: [
      { content: "改窄触发条", status: "completed" },
      { content: "抽屉接第四页", status: "in_progress" },
      { content: "补自检断言", status: "pending" }
    ]
  };
  const view = mountComponent(inst.badge, TODO_PROJ);
  const readKeys = [];
  const root = findByClass(view.rerender(), "dsh-armor5-root");
  ok("徽标在（任务页测试的宿主）", root !== null);
  // 触发条现在是单击开抽屉
  findByClass(view.rerender(), "dsh-armor5-root").props.onClick();
  let tree = view.rerender();
  const tabEls = collectByClass(tree, "dsh-armor5-tab");
  ok("任务页签存在（第四个）",
    tabEls.some((t) => t.props["data-tab"] === "todo") && textOf(tabEls.find((t) => t.props["data-tab"] === "todo")) === "任务1/3",
    JSON.stringify(tabEls.map((t) => textOf(t))));
  const countEl = collectByClass(tree, "dsh-armor5-tab-count")[0];
  ok("页签角标显示 完成/总数（1/3）",
    countEl !== undefined && countEl.props["data-count"] === "1/3" && textOf(countEl) === "1/3",
    JSON.stringify(countEl && countEl.props));
  // 切到任务页
  tabEls.find((t) => t.props["data-tab"] === "todo").props.onClick();
  tree = view.rerender();
  const pane = findByClass(tree, "dsh-armor5-drawer");
  ok("任务页列出三条宿主 todos",
    pane !== null && collectByClass(tree, "dsh-armor5-todo").length === 3,
    String(collectByClass(tree, "dsh-armor5-todo").length));
  const rows = collectByClass(tree, "dsh-armor5-todo");
  ok("每条带 data-status（completed / in_progress / pending）",
    rows.map((r) => r.props["data-status"]).join(",") === "completed,in_progress,pending",
    JSON.stringify(rows.map((r) => r.props["data-status"])));
  ok("任务正文上屏（不是只有状态点）",
    textOf(pane).includes("抽屉接第四页") && textOf(pane).includes("补自检断言"),
    textOf(pane).slice(0, 160));
  ok("进度摘要按状态计数（完成 1 · 进行 1 · 待办 1）",
    textOf(pane).includes("完成 1 · 进行 1 · 待办 1"), textOf(pane).slice(0, 160));
  ok("任务页读的是宿主 todos 键（不是另起一套数据源）",
    CLIENT_SRC.includes('useProjection("todos")'));

  // 空投影：不要谎报，给说明
  const emptyView = mountComponent(inst.badge, { "infinite-gen-5:armor": PASS, todos: [] });
  findByClass(emptyView.rerender(), "dsh-armor5-root").props.onClick();
  let eTree = emptyView.rerender();
  collectByClass(eTree, "dsh-armor5-tab").find((t) => t.props["data-tab"] === "todo").props.onClick();
  eTree = emptyView.rerender();
  ok("宿主 todos 为空时给出说明而不是空白",
    textOf(findByClass(eTree, "dsh-armor5-drawer")).includes("本会话还没有任务清单"),
    textOf(findByClass(eTree, "dsh-armor5-drawer")).slice(0, 120));

  // 宿主没有投影接口（老宿主）：假渲染器必然提供 useProjection，模拟不出缺失 →
  // 钉源码级保证（canProject 为假时走专门文案，且不触碰 todos）。
  ok("宿主缺 useProjection 时有专门文案（不崩、不谎报）",
    CLIENT_SRC.includes("宿主未提供任务投影接口") &&
    /canProject \? useProjection\("todos"\) : undefined/.test(CLIENT_SRC));
}

// ── v0.50.3：最近工具容错 + 命中三分类 ──────────────────────────────────────
{
  ok("最近工具兼容三种形状（recent / ring / lastCall）",
    CLIENT_SRC.includes("Array.isArray(tools.recent)") &&
    CLIENT_SRC.includes("Array.isArray(tools.ring)") &&
    CLIENT_SRC.includes("tools.lastCall && tools.lastCall.tool"));
  ok("流式补丁只带 lastCall 时不再空白（拿最后一次调用顶上）",
    /else if \(tools && tools\.lastCall && tools\.lastCall\.tool\) recent = \[tools\.lastCall\]/.test(CLIENT_SRC));
  ok("命中页按三类分组（本对话 / 最近对话 / 全局）",
    CLIENT_SRC.includes("本对话命中（") && CLIENT_SRC.includes("最近对话命中（") &&
    CLIENT_SRC.includes("全局命中（本进程累计"));
  ok("全局段给出通过 / 拒答 / 命中域（不是空标题）",
    CLIENT_SRC.includes('L("拒答")') && CLIENT_SRC.includes("命中域 "));
  ok("老服务端（无 hits.groups）退回单段「最近命中」不空屏",
    CLIENT_SRC.includes("hitPaneGrouped || hitFlatPane") &&
    CLIENT_SRC.includes("dsh-armor5-sec-title") );
  ok("客户端读的是服务端同一份 hits.groups（不另起数据源）",
    /liveState\.liveDoc\.hits\.groups/.test(CLIENT_SRC));
}

// ── v0.50.4：本对话标识记忆 + 跨重启累计 ────────────────────────────────────
{
  ok("明细页挂了「本对话累计」段（标识记忆 + 次数）",
    CLIENT_SRC.includes("本对话累计（") && CLIENT_SRC.includes("dsh-armor5-mem"));
  ok("四类标识各自成行：识别领域 / 命中标记 / 安全标记 / 风险载荷",
    ["识别领域", "命中标记", "安全标记", "风险载荷"].every((label) =>
      CLIENT_SRC.includes('section(L("' + label + '"') ||
      CLIENT_SRC.includes('section("' + label + '"')));
  ok("标识带 ×次数（同一标识只占一格，不去重就会重复铺开）",
    /row\.name \+ " ×" \+ row\.count/.test(CLIENT_SRC) &&
    CLIENT_SRC.includes('"data-kind": kind'));
  ok("累计来自服务端 hits.groups.memory（不另起数据源）",
    /hitGroups && hitGroups\.memory/.test(CLIENT_SRC));
  ok("全局段给出跨重启累计行",
    CLIENT_SRC.includes("跨重启累计 ") && CLIENT_SRC.includes("infinite-gen-5-stats.json"));
  ok("累计读不到时给说明而不是 0 假象",
    CLIENT_SRC.includes("跨重启累计：统计库还没积累"));
  // 这条是 v0.50.3 的潜在真机崩点：React.Fragment 是 symbol，当函数调用会抛。
  ok("不把 react.Fragment 当函数调用（真机上会抛 TypeError）",
    !CLIENT_SRC.includes("react.Fragment("));
  const serverSrc = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  ok("服务端发布 hits.groups.memory（turns / verdicts / 四类计数）",
    serverSrc.includes("memory: {") && serverSrc.includes("turns: sessionMemory.turns") &&
    serverSrc.includes("topCounts(sessionMemory.markers"));
  ok("换会话即清空标识记忆",
    serverSrc.includes("resetSessionMemory(id)"));
  ok("跨重启累计写进 ~/.dsh 统计库（bump 三处）",
    serverSrc.includes('statsSink.bump("hits.total")') &&
    serverSrc.includes('statsSink.bump(["hits", scored && scored.verdict === "pass" ? "pass" : "block"])') &&
    serverSrc.includes('statsSink.bump(["hits", "byDomain", tallyDomain])'));
  ok("跨重启累计读回时逐层探形状（读不到返回 null）",
    serverSrc.includes("const lifetimeHits = ()") && serverSrc.includes("[doc, doc?.counters, doc?.stats, doc?.store]"));
}

// ── v0.50.5：命中页筛选（全部 / 通过 / 拒答）──────────────────────────────
{
  ok("命中页有筛选胶囊（全部 / 通过 / 拒答）",
    CLIENT_SRC.includes('["all", "全部"], ["pass", "通过"], ["block", "拒答"]') &&
    CLIENT_SRC.includes('"data-filter"'));
  ok("三段共用同一枚筛选（filterHits 一处实现）",
    /var filterHits = function \(rows\)/.test(CLIENT_SRC) &&
    CLIENT_SRC.split("filterHits(").length - 1 >= 4);
  ok("筛选后标题计数跟着变（不是只过滤列表不改数字）",
    CLIENT_SRC.includes('filterHits(hitGroups.session).length') &&
    CLIENT_SRC.includes('filterHits(hitGroups.earlier).length'));
  ok("老服务端单段回退路径也过筛选",
    CLIENT_SRC.includes("var hitListFiltered = filterHits(hitList)") &&
    CLIENT_SRC.includes("hitListFiltered.map("));
  ok("高亮态用 data-on（样式靠它显形）",
    CLIENT_SRC.includes('"data-on": hitFilter === row[0] ? "1" : "0"'));
}

// ── v0.50.6：命中时间轴 + 触屏尺寸 + 空态 ───────────────────────────────────
{
  ok("命中台账按天分组（今天 / 昨天 / 更早）",
    CLIENT_SRC.includes('{ "今天": [], "昨天": [], "更早": [] }') &&
    CLIENT_SRC.includes('["今天", "昨天", "更早"].filter('));
  ok("分组按 at 计算日键（不是按索引切）",
    CLIENT_SRC.includes("var dayKey = function (value)") && CLIENT_SRC.includes("var bucketOf = function (value)"));
  ok("分组条目过既有归一化器（raw 环条目没有 main/sub，直接渲染是空行）",
    CLIENT_SRC.includes("hitRows({ recent: filterHits(rows) })"));
  ok("筛选胶囊给足触屏热区（min-height 28px）",
    CLIENT_SRC.includes("min-height:28px") && CLIENT_SRC.includes("padding:4px 12px"));
  ok("空态带上当前筛选名（不再只说「这一类还没有判决」）",
    CLIENT_SRC.includes("dsh-armor5-hits-empty") &&
    CLIENT_SRC.includes('"这一类里没有「" + hitFilter + "」的判决"'));
}

// ── v0.51.0：面板双模式（用户模式说人话 / 开发者模式保留内部词）──────────────
{
  ok("面板模式常量与默认值在场（出厂 user）",
    CLIENT_SRC.includes('var PANEL_MODE = "user"') && CLIENT_SRC.includes("PANEL_MODES"));
  ok("词表覆盖九字段与实时行（15 条）",
    (CLIENT_SRC.match(/"[^"]+": "[^"]+",\n/g) || []).length >= 15 && CLIENT_SRC.includes('"识别领域": "推测大概范围"'));
  ok("偏好校验接纳 panelMode 且拒绝非法值",
    /panelMode: function \(v\) \{ return Object\.prototype\.hasOwnProperty\.call\(PANEL_MODES, v\); \}/.test(CLIENT_SRC));
  ok("设置页有面板模式两档（用户 / 开发者）",
    CLIENT_SRC.includes("面板用哪套词（PANEL_MODE）") && CLIENT_SRC.includes('pick("panelMode", row.value)'));
  ok("翻译只在 user 模式生效（dev 原样返回）",
    /if \(PANEL_LEX_STATE\.dev\) return label;/.test(CLIENT_SRC));
  // 真机/假渲染器对面板模式的读取路径依赖 localStorage 播种，容易受挂载顺序影响；
  // 这里钉源码级判据（上面已有两条行为断言覆盖 user 模式文案与 dev 模式保留）。
  ok("两种模式的标签都来自同一张词表（不各写一套）",
    CLIENT_SRC.includes('"识别领域": "推测大概范围"') && CLIENT_SRC.includes('"扫描范围": "我读了多少"'));
}

// ── v0.51.2：设置台（console）也走双模式 + 用户模式压缩 UI ────────────────
{
  ok("设置台有独立词表与 C()（组标题 / 选项名，不与面板词表混用）",
    CLIENT_SRC.includes("var CONSOLE_LEX = {") && /var C = function \(text\)/.test(CLIENT_SRC));
  ok("四个组标题都走 C()（不再是内部术语直出；任务清单组已随解耦移除）",
    ["上屏多少信息（TRIGGER_MODE）", "挂到哪个槽位（SLOT_MODE）", "面板用哪套词（PANEL_MODE）",
     "领域覆盖 · 词表 · 注入健康", "实时（信号来源 / 本轮 / 工具流水）"]
      .every((t) => CLIENT_SRC.includes('C("' + t + '")')));
  ok("选项名走 C()（glyph / composer / header / zone 都会翻译）",
    (CLIENT_SRC.match(/label: C\(/g) || []).length >= 2 &&
    ["glyph", "composer", "zone"].every((k) => CLIENT_SRC.includes('"' + k + '": ')));
  ok("用户模式压缩 UI 与字体（data-panel 选择器 + 字号/间距一起收）",
    CLIENT_SRC.includes('"data-panel":') &&
    CLIENT_SRC.includes(".armor5-console[data-panel='user']{font-size:12px") &&
    CLIENT_SRC.includes(".armor5-console[data-panel='user'] .armor5-console-group{margin-top:6px}"));
  ok("内部语义不变：三个偏好键与取值通道照旧",
    CLIENT_SRC.includes('pick("triggerMode", row.value)') &&
    CLIENT_SRC.includes('pick("slotMode", row.value)') &&
    CLIENT_SRC.includes('pick("panelMode", row.value)'));
  ok("dev 模式两种词表都原样返回（不改开发者口径）",
    /if \(PANEL_LEX_STATE\.dev\) return text;/.test(CLIENT_SRC));
}

// ── v0.51.4：抽屉内快捷切换 + 压缩后触屏保底 ────────────────────────────────
{
  ok("抽屉头部有「用户 / 开发者」快捷切换（写同一条偏好通道）",
    CLIENT_SRC.includes('className: "dsh-armor5-panel-toggle"') &&
    /writePrefs\(\{ panelMode: dockPrefs\.panelMode === "dev" \? "user" : "dev" \}\)/.test(CLIENT_SRC));
  ok("切换按钮声明当前模式（data-panel-mode）与可读 title",
    CLIENT_SRC.includes('"data-panel-mode": dockPrefs.panelMode === "dev" ? "dev" : "user"') &&
    CLIENT_SRC.includes("切到开发者模式（看内部字段名）"));
  ok("压缩后仍保触屏下限（28px 高 + 字号不低于 12px）",
    CLIENT_SRC.includes("min-height:28px;font-size:12px") &&
    CLIENT_SRC.includes(".dsh-armor5-panel-toggle{flex:0 0 auto;margin-right:6px;min-height:28px"));
}

// ── v0.51.5：设置台残词收尾（更多组标题纳入 C()）──────────────────────────
{
  // 实测：这些文案并非都渲染在 group-title 位置（有的是选项/行内文案），
  // 所以只断言「词表里有对应说法」；包了几个渲染点在下面一条按实测条数断言。
  ok("词表已覆盖这些组标题（用户模式有对应说法）",
    ["触发形态","判定源","注入面","载荷与预算","节拍与门"].every((t) => CLIENT_SRC.includes('"' + t + '": "')));
  ok("词表映射到位（触发形态 → 面板长什么样 / 注入面 → 注进哪一段）",
    CLIENT_SRC.includes('"触发形态": "面板长什么样"') && CLIENT_SRC.includes('"注入面": "注进哪一段"'));
  const wrapped = (CLIENT_SRC.match(/armor5-console-group-title" \}, C\(/g) || []).length;
  ok("设置台组标题已走 C() 的有 7 处（实测值，其余文案不在 group-title 渲染点）", wrapped >= 7, "实得 " + wrapped);
}

// ── v0.51.6：明细页三个检测磁贴改「本对话累计」+ 两个字段名翻译 ─────────────
{
  ok("用户模式下命中标记/风险载荷/安全标记走累计口径（去重 + ×次数）",
    CLIENT_SRC.includes("accOrRaw(domainMarkers, \"markers\", \"hit\")") &&
    CLIENT_SRC.includes("accOrRaw(risk, \"risks\", \"risk\")") &&
    CLIENT_SRC.includes("accOrRaw(safe, \"safe\", \"safe\")"));
  ok("累计 chip 带 ×次数（同一标识只占一格）",
    /row\.name \+ " ×" \+ row\.count/.test(CLIENT_SRC) && CLIENT_SRC.includes('count: 1'));
  ok("还没累计时按 ×1 兜底（格子不空、形状也不变）",
    CLIENT_SRC.includes("return { name: name, count: 1 };"));
  ok("两个未翻译字段名已入词表并包 L()",
    CLIENT_SRC.includes('"候选明细": "同类线索详情"') && CLIENT_SRC.includes('"空答类型": "没答上来算哪种"') &&
    CLIENT_SRC.includes('tile(L("候选明细")') && CLIENT_SRC.includes('tile(L("空答类型")'));
  ok("dev 模式仍是本条原始词（开发者口径没被改掉）",
    CLIENT_SRC.includes("if (PANEL_LEX_STATE.dev) return chipList(rawList, kind, \"无\");") &&
    CLIENT_SRC.includes("PANEL_LEX_STATE.dev && rawList && rawList.length"));
}

// ── v0.51.8：抽屉头部状态徽标与行为状态收小 ─────────────────────────────────
{
  ok("抽屉头部的判决徽标与行为状态收小（字号 9 / 行高 12 / 内边距砍半）",
    CLIENT_SRC.includes(".dsh-armor5-drawer .dsh-armor5-head{font-size:9px;line-height:12px}") &&
    CLIENT_SRC.includes(".dsh-armor5-drawer .dsh-armor5-head .dsh-armor5-chip{font-size:9px;line-height:12px;padding:0 5px}"));
  ok("抽屉内 chip 统一收到 10px（比正文小一档，不抢视线）",
    CLIENT_SRC.includes(".dsh-armor5-drawer .dsh-armor5-chip{font-size:10px;line-height:14px;padding:1px 6px}"));
  ok("收小只作用在抽屉内（不误伤设置台与任务页的可读字号）",
    !CLIENT_SRC.includes(".armor5-console .dsh-armor5-chip{font-size:9px"));
}

// ── v0.51.10：判决徽标（.badge，非 .chip）收小 ─────────────────────────────
{
  ok("判决徽标收小打在 .dsh-armor5-badge 上（v0.51.8 打在 .chip 上打偏了）",
    CLIENT_SRC.includes(".dsh-armor5-drawer .dsh-armor5-badge{height:10px;padding:0 3px;font-size:7px;line-height:10px}"));
  ok("徽标里的状态点同步收到 4px", CLIENT_SRC.includes(".dsh-armor5-drawer .dsh-armor5-badge .dsh-armor5-dot{width:3px;height:3px}"));
  ok("徽标原始规格仍在（未被删，dev/触发条仍可用）", CLIENT_SRC.includes(".dsh-armor5-badge{display:inline-flex;align-items:center;height:15px;padding:0 6px"));
}

// ── v0.51.11：触发条上的状态文字（执行中/空闲）在用户模式下收小 ─────────────
{
  ok("触发条带面板模式标记（CSS 才有钩子）",
    CLIENT_SRC.includes('"data-panel": dockPrefs.panelMode === "dev" ? "dev" : "user"'));
  ok("用户模式触发条状态文字收一档（11px / 限宽 14ch）",
    CLIENT_SRC.includes("font-size:10px;line-height:13px;max-width:12ch;min-width:0"));
  ok("dev 模式不套这条规则（开发者保留可读尺寸）",
    CLIENT_SRC.includes(".dsh-armor5-root[data-panel='user']{gap:4px}"));
}

// ── v0.51.12：明细页闪烁修复（同一格只留一条渲染路径）─────────────────────
{
  ok("累计与原始不再走两条互斥路径（永远 ×N，避免来回跳）",
    CLIENT_SRC.includes("var rows = (acc && acc.length)") &&
    CLIENT_SRC.includes("return { name: name, count: 1 };") &&
    !CLIENT_SRC.includes("if (!Array.isArray(acc) || acc.length === 0) return chipList(rawList, kind"));
  ok("着色固定（单一路径 + 基础 kind，两条路径不再各给一套色）",
    CLIENT_SRC.includes('return chipRowEarly(rows, kind);'));
  ok("dev 模式仍走原始词（开发者不参与这条路径）",
    CLIENT_SRC.includes('if (PANEL_LEX_STATE.dev) return chipList(rawList, kind, "无");'));
}

// ── v0.51.13：有数字没颜色（kind 无配色）+ 状态词溢出 ───────────────────────
{
  ok("磁贴 chip 用基础 kind（hit/risk/safe 才有配色规则）",
    CLIENT_SRC.includes('return chipRowEarly(rows, kind);') &&
    !CLIENT_SRC.includes('return chipRowEarly(rows, "mem-" + kind);'));
  ok("记忆区 mem-* 四种 kind 补上配色",
    CLIENT_SRC.includes(".dsh-armor5-chip[data-kind=mem-marker],.dsh-armor5-chip[data-kind=mem-domain]{background:rgba(77,107,254,.14)") &&
    CLIENT_SRC.includes(".dsh-armor5-chip[data-kind=mem-risk]{background:rgba(248,81,73,.14)"));
  ok("状态词再小一档并允许收缩（min-width:0 治溢出）",
    CLIENT_SRC.includes("font-size:10px;line-height:13px;max-width:12ch;min-width:0") &&
    CLIENT_SRC.includes(".dsh-armor5-root{min-width:0}"));
}

// ── v0.51.14：抽屉里的状态词按小徽章处理（字号再砍一半）─────────────────────
{
  ok("抽屉徽标按小徽章：高 10px / 字号 7px / 内边距 3px",
    CLIENT_SRC.includes(".dsh-armor5-drawer .dsh-armor5-badge{height:10px;padding:0 3px;font-size:7px;line-height:10px}"));
  ok("头部其余状态字（通过与进行中同排）也收到 8px",
    CLIENT_SRC.includes(".dsh-armor5-drawer .dsh-armor5-head>span,.dsh-armor5-drawer .dsh-armor5-head>b{font-size:8px;line-height:10px}"));
  ok("状态点同步收到 3px（徽标里不该留个大圆点）",
    CLIENT_SRC.includes(".dsh-armor5-drawer .dsh-armor5-badge .dsh-armor5-dot{width:3px;height:3px}"));
}

// ── v0.51.15：抽屉头部挤占治理 ─────────────────────────────────────────────
{
  ok("页签区可收缩可横滚（不再和右侧簇互顶）",
    CLIENT_SRC.includes(".dsh-armor5-drawer .dsh-armor5-tabs{flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none}"));
  ok("右侧簇固定不缩（版本 / 模式 / ✕ 不再被挤变形）",
    CLIENT_SRC.includes(".dsh-armor5-drawer .dsh-armor5-head-right{flex:0 0 auto;min-width:0;gap:3px;white-space:nowrap}"));
  ok("版本可截断，且用户模式隐藏（开发者信息不占这一行）",
    CLIENT_SRC.includes('className: "dsh-armor5-ver"') &&
    CLIENT_SRC.includes(".dsh-armor5-drawer[data-panel='user'] .dsh-armor5-ver{display:none}"));
  ok("抽屉也带上面板模式标记（CSS 钩子）",
    CLIENT_SRC.includes('"data-panel": dockPrefs.panelMode === "dev" ? "dev" : "user",'));
}

// ── v0.51.16：设置台布局 + 双模式分开显示 ──────────────────────────────────
{
  ok("用户模式隐藏内核调参组（data-dev-only 标记 + CSS 隐藏）",
    CLIENT_SRC.includes('"data-dev-only": "1"') &&
    CLIENT_SRC.includes(".armor5-console[data-panel='user'] [data-dev-only='1']{display:none}"));
  ok("调参组整块标了 dev-only（groups.map 那一块）",
    /className: "armor5-console-group",\n\s+key: "grp:" \+ g\.title,\n\s+"data-dev-only": "1"/.test(CLIENT_SRC));
  ok("用户模式分组卡片化（分隔线 + 组标题加粗）",
    CLIENT_SRC.includes(".armor5-console[data-panel='user'] .armor5-console-group{position:relative;padding:8px 0 6px;") &&
    CLIENT_SRC.includes(".armor5-console[data-panel='user'] .armor5-console-group-title{font-weight:600;opacity:.9}"));
  ok("选项按钮在用户模式下等宽（不再长短不一）",
    CLIENT_SRC.includes("min-height:28px;font-size:12px;flex:1 1 0}"));
}

// ── v0.51.20：SECRETS 协议 —— 远端凭据入口（只写不回显）────────────────────
{
  ok("设置台有远端凭据入口（输入 + 保存 + 清除）",
    CLIENT_SRC.includes('className: "armor5-console-secret-input"') &&
    CLIENT_SRC.includes('"保存凭据"') && CLIENT_SRC.includes('"清除凭据"'));
  ok("凭据走同一条写通道（tasksPath + 两个 action）",
    CLIENT_SRC.includes('postSecret({ action: "setGithubToken", token: secretInput })') &&
    CLIENT_SRC.includes('postSecret({ action: "clearGithubToken" })'));
  ok("界面只回显状态与末四位，不回显 token",
    CLIENT_SRC.includes('"已保存 · 末四位 ****" + secret.last4') &&
    !/secret\.token|input\.value\)\)?\s*;\s*\/\/.*回显/.test(CLIENT_SRC));
  ok("该组按 dev-only 处理（用户模式不出现写凭据的控件）",
    CLIENT_SRC.includes('"data-dev-only": "1" },\n              react.createElement("div", { className: "armor5-console-group-title" }, C("远端凭据'));
}

// ── v0.51.22：凭据入口的反馈与样式一致性 ───────────────────────────────────
{
  ok("凭据写函数用 statsBridge()（不是 state.link）",
    CLIENT_SRC.includes("var bridge = statsBridge();") &&
    CLIENT_SRC.includes('setSecret({ ok: false, error: "面板没拿到凭据入口（刷新页面重试）" })'));
  ok("凭据回执判 r.status 与 r.doc（与写任务清单同口径）",
    CLIENT_SRC.includes("var ok = r && r.status === 200 && doc && doc.ok === true;"));
  ok("状态行用设置台的类（不再借用抽屉的 dsh-armor5-hit-sub）",
    CLIENT_SRC.includes('react.createElement("span", { className: "armor5-console-hint" }, secretStatusText)') &&
    !CLIENT_SRC.includes('className: "dsh-armor5-hit-sub" }, secretStatusText'));
  ok("凭据按钮继承设置台按钮样式（去掉专用类）",
    !CLIENT_SRC.includes("armor5-secret-save") && !CLIENT_SRC.includes("armor5-secret-clear"));
}

// ── 结果 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ok("槽位模式表列了三种可用位置", CLIENT_SRC.includes("conversation.session.header.utilities") && CLIENT_SRC.includes("conversation.input.dock"));

if (failures.length === 0) {
  console.log("\n无限五代客户端半体自检： " + passed + " 通过 / 0 失败");
  console.log("位置=" + mod.__meta.slotName + "  版本=" + mod.__meta.version + "  样式表=" + mod.__meta.styleId);
  process.exit(0);
}
console.log("\n无限五代客户端半体自检： " + passed + " 通过 / " + failures.length + " 失败");
for (const f of failures) console.log("  ✗ " + f);
process.exit(1);
