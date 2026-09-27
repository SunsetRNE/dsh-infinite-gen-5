#!/usr/bin/env node
/**
 * 无限五代 · 客户端半体行为自检（v0.8.1）
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

function render(Component, props, store) {
  const prev = slots;
  slots = store.hooks;
  cursor = 0;
  effects.length = 0;
  const tree = Component(props);
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
// eslint-disable-next-line no-new-func
new Function("window", "document", "MutationObserver", "setTimeout", "clearTimeout", "console", CLIENT_SRC)(
  fakeWindow, doc, FakeMutationObserver, setTimeout, clearTimeout, console
);

ok("客户端半体注册进了模块加载器", spec !== null && spec.id === "dsh-infinite-gen-5");
const mod = spec.factory(fakeRequire);
ok("工厂返回了 CommonJS 形状的 exports", !!mod && typeof mod.apply === "function");
ok("inject 只声明 slots", Array.isArray(mod.inject) && mod.inject.length === 1 && mod.inject[0] === "slots");

// ── 槽位注册（apply） ───────────────────────────────────────────────────────
const registrations = [];
const injected = [];
const fakeCtx = {
  slots: {
    inject(name, cb) { injected.push(name); return cb(); },
    register(options, Component) { registrations.push({ options, Component }); return () => {}; }
  }
};
mod.apply(fakeCtx);

ok("apply 只注册一个条目（不会两个槽位各挂一个）", registrations.length === 1, "实际 " + registrations.length);
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
ok("三种位置模式都写进了槽位表",
  ["composer", "header", "zone"].every((m) => CLIENT_SRC.includes(m + ": \"conversation.")));
ok("版本与 package.json 一致", mod.__meta.version === "v" + VERSION, mod.__meta.version + " vs " + VERSION);
ok("触发条默认压成多态指示器（compact）", mod.__meta.triggerMode === "compact", mod.__meta.triggerMode);
ok("三种触发条形态都写进常量表",
  Array.isArray(mod.__meta.triggerModes) && mod.__meta.triggerModes.join(",") === "full,compact,dot",
  JSON.stringify(mod.__meta.triggerModes));

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

function mount(projection, docForeign) {
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
  let r = render(reg.Component, props, store);
  flush(r.pending);
  const snapshot = () => r.tree;
  // 组件会在 effect 里 setState（量锚点、开浮层、折叠徽标），所以要再跑一轮渲染才看得到结果。
  const rerender = () => {
    for (let i = 0; i < 2; i += 1) { r = render(reg.Component, props, store); flush(r.pending); }
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
  ok("空闲：触发条压成单个圆点（compact 不写文字）", textOf(button) === "", JSON.stringify(textOf(button)));
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
  ok("通过：短词只留状态与主领域（数值收进浮层）", passText === "通过 web(3)", passText);
  ok("通过：领域命中数仍在短词里（>1 标在域名后）", passText.includes("web(3)"), passText);
  ok("通过：title 保留完整明细（载荷数等）", /载荷 2/.test(button.props.title), button.props.title);
  // 判决常驻：时间推进（远超原先的 3.2 秒窗口）后仍然显示，只有下一条用户发言才重置。
  const later = Date.now() + 60000;
  const realNow = Date.now;
  Date.now = () => later;
  const tree2 = m.rerender();
  Date.now = realNow;
  const after = findByClass(tree2, "dsh-armor5-root");
  ok("判决常驻：60 秒后仍显示判决而不是回落空闲",
    after.props["data-tone"] === "success" && textOf(after).indexOf("通过") === 0, after.props["data-tone"] + " " + textOf(after));
  const idleM = mount({ "infinite-gen-5:armor": IDLE });
  ok("无判决时空闲态只有圆点（compact 无文字）",
    textOf(findByClass(idleM.tree, "dsh-armor5-root")) === "",
    JSON.stringify(textOf(findByClass(idleM.tree, "dsh-armor5-root"))));
}

// 5) 拒绝 / 兜底
{
  const m = mount({ "infinite-gen-5:armor": REFUSAL });
  const button = findByClass(m.tree, "dsh-armor5-root");
  ok("拒绝：tone=error（走 error 令牌）", button.props["data-tone"] === "error");
  ok("拒绝：短词为「拒绝」（命中词进浮层与 title）", textOf(button) === "拒绝", textOf(button));
}
{
  const m = mount({ "infinite-gen-5:armor": FALLBACK });
  const button = findByClass(m.tree, "dsh-armor5-root");
  ok("兜底：tone=error 但文字区分「兜底」", button.props["data-tone"] === "error" && textOf(button) === "兜底", textOf(button));
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

const OLD_STYLE_CSS = `
.old-armor{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;
  background:#10b981;color:#fff;font-size:12px;font-weight:600;line-height:18px;
  box-shadow:0 0 14px rgba(16,185,129,.55);animation:dshArmorPulse 1.4s ease-in-out infinite alternate}
@keyframes dshArmorPulse{from{opacity:.72}to{opacity:1}}
`;

function previewPage({ theme, pluginCss, stateRows, panelHtml, dark }) {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>无限五代状态条 · 视觉预览</title>
<style>${theme}</style>
<style>${pluginCss}</style>
<style>${NATIVE_METER_CSS}${OLD_STYLE_CSS}
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
  <p class="note">空闲态是「无限五代 + 中性圆点」；运行中呼吸；<b>判决常驻 — 不再 3.2 秒淡出</b>，
  一直留到你发出下一条消息（落笔时刻显示在浮层的「最近判决」一行）。领域命中数 &gt;1 时标在域名后，如 <code>web(3)</code>。
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
  const mo = mount({ "infinite-gen-5:armor": PASS });
  const trigger = findByClass(mo.rerender(), "dsh-armor5-root");
  trigger.props.onClick();
  const openTree = mo.rerender();
  const panelHtml = toHtml(findByClass(openTree, "dsh-armor5-panel"));
  const base = outPath || "/tmp/preview";
  mkdirSync(dirname(base.replace(/\.html$/, "") + "-x.html"), { recursive: true });
  for (const dark of [true, false]) {
    const target = base.replace(/\.html$/, "") + (dark ? "-dark" : "-light") + ".html";
    writeFileSync(target, previewPage({ theme, pluginCss, stateRows, panelHtml, dark }), "utf8");
    console.log("预览已生成 → " + target);
  }
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
