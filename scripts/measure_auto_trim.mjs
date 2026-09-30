#!/usr/bin/env node
/**
 * measure_auto_trim — 段预算在「本机真实段表」上的实测尺子（不改任何文件、不碰网络）。
 *
 * 与 verify_auto_trim 的分工：门禁验「逻辑对不对」，这一支量「本机现在有多少、按不同
 * 窗口会丢谁」。段表来源有两层：
 *   ① 本插件自己注册的段：内核正文（kernelText 读 prompts/*.md）、末位锚点、增强集条款、
 *      惰性章节条款、批量交付臂条款 —— 直接调模块函数取，量的是真文本不是占位串。
 *   ② 宿主段：默认用一份带名字与体量的代表性清单（可用 --host-json 换成从会话日志量出来的
 *      真值），因为宿主的段在进程外，本工具拿不到它的原文。
 *
 * 用法：
 *   node scripts/measure_auto_trim.mjs                    # 默认档位 + 四档窗口对照
 *   node scripts/measure_auto_trim.mjs --json             # 机器可读
 *   node scripts/measure_auto_trim.mjs --windows 262144,65536,32768,16384
 *   node scripts/measure_auto_trim.mjs --host-json FILE    # [{name,bytes}] 覆盖宿主段清单
 */
import fs from "node:fs";
import path from "node:path";
import {
	BUDGET_CEILING,
	applySectionPlan,
	droppableRankOf,
	planSectionBudget,
} from "../data/context-budget.mjs";
import { renderBatchClause } from "../data/batch-arm.mjs";
import { compileLazy } from "../data/lazy-sections.mjs";
import { renderRouterClause } from "../data/cot-router.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
	const i = argv.indexOf(name);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const JSON_OUT = argv.includes("--json");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const windows = (flag("--windows", "262144,65536,32768,16384"))
	.split(",")
	.map((s) => Number(s.trim()))
	.filter((n) => Number.isFinite(n) && n > 0);

/** 宿主段：进程外拿不到原文，用「名字 + 体量」的代表清单；--host-json 可换真值。 */
const DEFAULT_HOST = [
	{ name: "host:tools-usage", bytes: 3200 },
	{ name: "host:sandbox-policy", bytes: 1800 },
	{ name: "host:device-protocol", bytes: 5200 },
	{ name: "host:identity", bytes: 2400 },
];
let hostSections = DEFAULT_HOST;
const hostJson = flag("--host-json");
if (hostJson) {
	try {
		const raw = JSON.parse(fs.readFileSync(hostJson, "utf8"));
		hostSections = (Array.isArray(raw) ? raw : raw.sections ?? []).map((s) => ({
			name: String(s.name ?? "host:unknown"),
			bytes: Number(s.bytes ?? Buffer.byteLength(String(s.text ?? ""), "utf8")),
		}));
	} catch (error) {
		console.error(`--host-json 读取失败：${String(error?.message ?? error)}`);
		process.exit(1);
	}
}

const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).length));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/* ---------- ① 真段表：本插件自己那几段是真的 ---------- */
const promptDir = path.join(ROOT, "prompts");
const readIf = (file) => {
	try {
		return fs.readFileSync(path.join(promptDir, file), "utf8");
	} catch {
		return "";
	}
};
const kernel = readIf("infinite-gen-5.md") || readIf("infinite-gen-5.full.md");
const kernelFull = readIf("infinite-gen-5.full.md");
// 设计需求判 T2，惰性章节在这一轮真会装载（量的是真装载结果，不是空壳）
const lazyOut = compileLazy({ text: "帮我设计一个后台管理界面，要有监控面板与预算环", mode: "standard", bytes: 6000 });
const ourSections = [
	{ name: "order-100-kernel", order: 100, text: kernel || "（内核正文缺失）" },
	{ name: "infinite-gen-5:runtime-anchor", order: 10, text: "（运行时锚点占位，真值由宿主续写）" },
	{ name: "infinite-gen-5:boost-corpus", order: 150, text: "（增强集条款占位）" },
	{ name: "infinite-gen-5:lazy-sections", order: 160, text: lazyOut.text ?? "" },
	{ name: "infinite-gen-5:batch-arm", order: 170, text: renderBatchClause({ min: 20 }) },
	{ name: "infinite-gen-5:tuning-clause", order: 165, text: renderRouterClause() },
];
const sections = [
	...ourSections.map((s) => ({ ...s, bytes: Buffer.byteLength(s.text, "utf8") })),
	...hostSections.map((s) => ({ ...s, order: 300, text: null })),
];

/* ---------- ② 逐段台账 ---------- */
const ledger = sections.map((s) => ({
	name: s.name,
	bytes: s.bytes,
	rank: droppableRankOf(s.name),
	verdict: droppableRankOf(s.name) === null ? "受保护（永不丢）" : `可降级 rank ${droppableRankOf(s.name)}`,
}));
const total = ledger.reduce((n, x) => n + x.bytes, 0);
const ourBytes = ledger.filter((x) => x.rank !== null).reduce((n, x) => n + x.bytes, 0);
const protectedBytes = total - ourBytes;

/* ---------- ③ 四档窗口对照 ---------- */
const rows = windows.map((w) => {
	const ceiling = w;
	const shareCap = 0.25;
	const plan = planSectionBudget(
		sections.map((s) => ({ name: s.name, text: "x".repeat(s.bytes) })),
		{ ceiling, shareCap, mode: "apply" },
	);
	const applied = applySectionPlan(
		sections.map((s) => ({ name: s.name, text: "x".repeat(s.bytes) })),
		plan,
		{ pointerOf: (s) => `（惰性 〈${s.name}〉｜摘要）指针行替身（实测 ${s.text.length} B → 指针）` },
	);
	return {
		ceiling,
		target: plan.target,
		tier: plan.tier,
		verdict: plan.verdict,
		before: plan.before,
		after: plan.after,
		freed: plan.freed,
		drop: applied.dropped.map((d) => `${d.name}(${kb(d.bytes)})`),
		swap: applied.swapped.map((s) => `${s.name}(${kb(s.before)} → ${kb(s.bytes)})`),
		issues: plan.issues.map((i) => i.code),
	};
});

/* ---------- 输出 ---------- */
if (JSON_OUT) {
	console.log(JSON.stringify({ total, ourBytes, protectedBytes, ledger, rows, ceilingDefault: BUDGET_CEILING.normal }, null, 2));
} else {
	console.log(`段表来源：本插件段取自 prompts/ 与模块函数（真文本）· 宿主段 ${hostJson ? `来自 ${hostJson}` : "为代表清单"}`);
	console.log(
		`内核：常驻 ${Buffer.byteLength(kernel, "utf8")} B（prompts/infinite-gen-5.md）· ` +
			`全量 ${Buffer.byteLength(kernelFull, "utf8")} B（.full.md，仅惰性章节拆分的对照件）· ` +
			`惰性章节本轮装载 ${lazyOut.bytes} B（命中 ${(lazyOut.hits || []).map((h) => h.id).join("+") || "无"}）`,
	);
	console.log(`合计 ${total} B（${kb(total)}）· 本插件可降级 ${ourBytes} B · 受保护 ${protectedBytes} B\n`);
	console.log("① 逐段台账");
	for (const x of ledger) console.log(`   ${pad(x.name, 34)} ${pad(kb(x.bytes), 10)} ${x.verdict}`);
	console.log("\n② 窗口对照（份额固定 25%；mode=apply 看真丢谁）");
	console.log(`   ${pad("窗口", 10)}${pad("目标", 10)}${pad("tier", 8)}${pad("verdict", 9)}${pad("前", 10)}${pad("后", 10)}${pad("省", 10)} 动刀`);
	for (const r of rows) {
		const act = [...r.drop.map((d) => `丢 ${d}`), ...r.swap.map((s) => `降级 ${s}`)].join("；") || "——";
		console.log(`   ${pad(kb(r.ceiling), 10)}${pad(kb(r.target), 10)}${pad(r.tier, 8)}${pad(r.verdict, 9)}${pad(kb(r.before), 10)}${pad(kb(r.after), 10)}${pad(kb(r.freed), 10)} ${act}`);
	}
	console.log("\n③ 结论");
	const first = rows.find((r) => r.freed > 0);
	console.log(
		first
			? `   默认档（256 KiB · 份额 25% = ${kb(rows[0].target)} 目标）：${rows[0].drop.length || rows[0].swap.length ? "会动刀" : "一个字节都不丢"}；` +
					`开始动刀的窗口在 ${kb(first.ceiling)} 上下（目标 ${kb(first.target)}）`
			: "   这几档窗口下都不动刀：本插件段总量还没到份额门槛",
	);
	console.log(`   本插件自己的段合计 ${kb(ourBytes)} —— 系统提示的体量大头在宿主段与对话历史，段预算只治前者。`);
	// 关掉插件能省多少：拿「本插件实际参与的段」与全量内核做差 —— 这是插件的真实成本上限。
	const offSaving = Buffer.byteLength(kernelFull, "utf8");
	console.log(
		`   若要问「关掉本插件能省多少」：常驻段 ${kb(Buffer.byteLength(kernel, "utf8"))} + 本轮惰性 ${lazyOut.bytes} B + ` +
			`批量臂 ${kb(Buffer.byteLength(renderBatchClause({ min: 20 }), "utf8"))} + 路由条款 ${kb(Buffer.byteLength(renderRouterClause(), "utf8"))}` +
			` ≈ ${kb(ourBytes + Buffer.byteLength(kernel, "utf8"))}；全量内核（未拆分）为 ${kb(offSaving)}。`,
	);
}
