#!/usr/bin/env node
/**
 * trim_request — 出站请求体的前置预算器（CLI）。
 *
 * 用途：502 / 413 有一类是**请求体太大**，而宿主的报错只给状态码、不给体量。
 * 这个脚本把「这一轮出门要带多少字节」变成可核对的数字，并提供三级瘦身：
 *   A 裁大工具回执 → B 折叠重复正文 → C 丢最旧的完整轮
 * 每一级都保持宿主的协议不变量（调用/回执配对、顺序、历史闭合），且**永不动当前轮**。
 *
 * 用法：
 *   node scripts/trim_request.mjs --messages REQ.json          # 只预检，报账
 *   node scripts/trim_request.mjs --messages REQ.json --budget 262144
 *   node scripts/trim_request.mjs --messages REQ.json --out /tmp/slim.json --force
 *   node scripts/trim_request.mjs --messages - < REQ.json      # stdin
 *   node scripts/trim_request.mjs --messages REQ.json --json   # 报告转 stderr 之外走 JSON
 *   node scripts/trim_request.mjs --selftest                   # 纯夹具自检，不读文件
 *
 * 退出码：0 在预算内 · 2 超出预算或契约不合法 · 1 输入/IO 错。
 * 实现在 data/context-budget.mjs（纯函数，可单独 import）。
 */
import fs from "node:fs";
import path from "node:path";
import {
	BUDGET_CEILING,
	DEFAULT_CEILING_BYTES,
	account,
	checkInvariants,
	preflight,
	roughTokens,
	trim,
} from "../data/context-budget.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const argOf = (f, d = "") => {
	const i = argv.indexOf(f);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const JSON_OUT = has("--json");
const say = (...a) => {
	if (!JSON_OUT) console.log(...a);
};
const num = (v, d) => {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : d;
};
const kb = (b) => `${(b / 1024).toFixed(1)} KiB`;

/** 认三种壳：{body:{...}} / {messages:[...]} / {request:{messages:[...]}}；也接受裸数组。 */
function unwrap(raw) {
	if (Array.isArray(raw)) return { messages: raw };
	const b = raw?.body ?? raw?.request ?? raw;
	if (Array.isArray(b?.messages)) return b;
	throw new Error("输入里找不到 messages 数组（认 {body:{messages}} / {messages} / {request:{messages}} / 裸数组）");
}

function readInput(spec) {
	if (spec === "-") return fs.readFileSync(0, "utf8");
	const p = path.resolve(spec);
	if (!fs.existsSync(p)) throw new Error(`没有这个文件：${p}`);
	return fs.readFileSync(p, "utf8");
}

function selftest() {
	const big = "x".repeat(9000);
	const mk = (turns) => {
		const ms = [];
		for (let i = 0; i < turns; i++) {
			ms.push({ role: "assistant", content: [{ type: "text", text: `a${i}` }, { type: "tool_use", id: `t${i}`, name: "bash", input: {} }] });
			ms.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: big }] });
		}
		ms.push({ role: "user", content: [{ type: "text", text: "当前轮需求" }] });
		return { system: "S".repeat(100), tools: [], messages: ms };
	};
	const body = mk(6);
	const checks = [];
	const acc = account(body);
	checks.push(["分账总数等于实际体量", acc.total > 0 && acc.systemBytes > 0 && acc.currentBytes > 0]);
	checks.push(["当前轮被标出来", acc.per[acc.per.length - 1].current === true]);
	checks.push(["预检在不超预算时给 ok", preflight(body, { ceiling: 10 ** 7 }).verdict === "ok"]);
	checks.push(["预检在超 2 倍预算时给 hot", preflight(body, { ceiling: 1000 }).verdict === "hot"]);

	for (const ceiling of [20000, 8000, 4000, 2000]) {
		const t = trim(body, { ceiling });
		checks.push([`ceiling=${ceiling}：瘦身后在预算内`, t.after <= ceiling]);
		checks.push([`ceiling=${ceiling}：不变量全过`, t.invariants.ok === true]);
		checks.push([`ceiling=${ceiling}：当前轮原样保留`, JSON.stringify(t.body.messages.at(-1)).includes("当前轮需求")]);
	}
	const low = trim(body, { ceiling: 2000 });
	checks.push(["低预算时确实动了 tier C", low.log.some((l) => l.tier === "C" && l.dropped > 0)]);
	checks.push(["丢轮只落在轮边界（首条不是回执载体）", !((low.body.messages[0]?.content ?? []).some?.((b) => b?.type === "tool_result") ?? false)]);
	checks.push(["超小预算下也不产生孤儿回执", checkInvariants(low.body.messages).issues.every((i) => i.code !== "orphan-tool-result")]);

	// 非法输入要被抓
	checks.push(["孤儿回执被抓", checkInvariants([{ role: "user", content: [{ type: "tool_result", tool_use_id: "zz", content: "x" }] }]).ok === false]);
	checks.push(["未闭合调用被抓", checkInvariants([{ role: "assistant", content: [{ type: "tool_use", id: "q1", name: "t", input: {} }] }]).ok === false]);
	checks.push(["同条消息重复 id 被抓", checkInvariants([{ role: "assistant", content: [{ type: "tool_use", id: "q1", name: "t", input: {} }, { type: "tool_use", id: "q1", name: "t", input: {} }] }]).ok === false]);

	// 顺序归一化
	const messy = [{ role: "assistant", content: [{ type: "tool_result", tool_use_id: "x", content: "r" }, { type: "tool_use", id: "x", name: "t", input: {} }] }];
	checks.push(["block 顺序归一：tool_use 前移", checkInvariants(trim({ messages: messy }, { ceiling: 10 ** 6 }).body.messages).ok === true]);

	// 三种壳都能解
	checks.push(["壳 {body:{messages}} 可解", unwrap({ body: { messages: [] } }).messages.length === 0]);
	checks.push(["壳 {messages} 可解", unwrap({ messages: [] }).messages.length === 0]);
	checks.push(["壳 {request:{messages}} 可解", unwrap({ request: { messages: [] } }).messages.length === 0]);
	checks.push(["裸数组可解", unwrap([]).messages.length === 0]);
	checks.push(["坏壳抛错", (() => { try { unwrap({ nope: 1 }); return false; } catch { return true; } })()]);
	checks.push(["token 粗估为正", roughTokens("你好 world") > 0]);

	let pass = 0;
	for (const [name, ok] of checks) {
		console.log(`${ok ? "✓" : "✗"} ${name}`);
		if (ok) pass++;
	}
	console.log(`\ntrim_request --selftest：${pass}/${checks.length} 通过`);
	process.exit(pass === checks.length ? 0 : 1);
}

function main() {
	if (has("--selftest")) return selftest();
	const spec = argOf("--messages", "");
	if (!spec) {
		console.error("用法：node scripts/trim_request.mjs --messages REQ.json [--budget 262144] [--out FILE] [--force] [--dry-run] [--json] [--selftest]");
		console.error(`--budget 可用档位：${Object.entries(BUDGET_CEILING).map(([k, v]) => `${k}=${v}`).join(" / ")}（不填默认 ${DEFAULT_CEILING_BYTES}）`);
		process.exit(1);
	}
	const budgetArg = argOf("--budget", "");
	const ceiling = BUDGET_CEILING[budgetArg] ?? num(budgetArg, DEFAULT_CEILING_BYTES);
	let raw;
	try {
		raw = unwrap(JSON.parse(readInput(spec)));
	} catch (e) {
		console.error(`读输入失败：${e.message}`);
		process.exit(1);
	}

	const pre = preflight(raw, { ceiling });
	const inv0 = checkInvariants(raw.messages);
	const dry = has("--dry-run");

	say(`预检：体量 ${pre.total} B（${kb(pre.total)}） / 预算 ${ceiling} B（${kb(ceiling)}） → ${pre.verdict}`);
	say(`分账：system ${pre.systemBytes} B · 工具 schema ${pre.toolsBytes} B · 历史 ${pre.historyBytes} B · 当前轮 ${pre.currentBytes} B · 消息 ${pre.messages} 条`);
	say(`粗估 token：${roughTokens(JSON.stringify(raw))}（CJK 1/字、其余 4 B/token，仅作量级参考）`);
	if (pre.top.length > 0) say(`最吃预算：${pre.top.map((x) => `#${x.index}(${x.role} ${x.bytes} B${x.current ? " 当前轮" : ""})`).join(" · ")}`);
	if (!inv0.ok) {
		say(`⚠ 输入本身不满足宿主契约，有 ${inv0.issues.length} 个问题：`);
		for (const x of inv0.issues.slice(0, 5)) say(`   - ${x.code} @${x.index}：${x.msg}`);
	}

	const result = trim(raw, { ceiling });
	say(`\n瘦身后：${result.before} B → ${result.after} B（省 ${result.freed} B，${((result.freed / Math.max(1, result.before)) * 100).toFixed(1)}%）`);
	for (const l of result.log) {
		if (l.tier === "N") say(`  级 N：顺序归一 ${l.moved} 条`);
		else if (l.tier === "A") say(`  级 A 裁大回执：省 ${l.freed} B（单条上限 ${l.cap} B，动 ${l.actions.length} 处）`);
		else if (l.tier === "B") say(`  级 B 折叠重复正文：省 ${l.freed} B（阈值 ${l.floor} B，动 ${l.actions.length} 处）`);
		else if (l.tier === "C") say(`  级 C 丢最旧完整轮：省 ${l.freed} B（丢 ${l.dropped} 条${l.blockedByMinKeep ? "，触到保留下限" : ""}）`);
	}
	if (result.log.length === 0) say("  无需瘦身（已在预算内）");
	say(`契约复检：${result.invariants.ok ? "通过" : `不通过（${result.invariants.issues.length} 个问题）`}${result.invariants.reusedIds.length > 0 ? ` · 跨轮复用 id ${result.invariants.reusedIds.length} 个（宿主接受，仅记录）` : ""}`);
	if (result.overBudget) say(`⚠ 仍超预算 ${result.after - ceiling} B —— 剩余内容已在保留下限内，继续裁会破坏上下文；考虑换档或分轮发送`);
	if (pre.advice.length > 0) for (const a of pre.advice) say(`  · ${a}`);

	const outPath = argOf("--out", "");
	if (outPath && !dry) {
		if (result.overBudget && !has("--force")) {
			console.error(`拒绝写出：仍超预算 ${result.after - ceiling} B（要写就加 --force）`);
			process.exit(2);
		}
		const p = path.resolve(outPath);
		fs.writeFileSync(p, JSON.stringify(result.body, null, 2));
		say(`已写出瘦身后的请求体：${p}`);
	}

	if (JSON_OUT) {
		// 默认不吐整条 log（真实长会话能到几千条，JSON 会膨胀到 MB 级，管道里反而读不回来）；
		// 需要逐条明细时加 --verbose。
		const verbose = has("--verbose");
		const byTier = {};
		for (const l of result.log) {
			const k = l.tier ?? l.kind ?? "?";
			byTier[k] = byTier[k] ?? { tier: k, entries: 0, freed: 0, touched: 0 };
			byTier[k].entries++;
			byTier[k].freed += l.freed ?? 0;
			byTier[k].touched += l.count ?? l.touched ?? l.moved ?? 0;
		}
		console.log(
			JSON.stringify(
				{
					action: "trim-request",
					ceiling,
					pre: { verdict: pre.verdict, total: pre.total, systemBytes: pre.systemBytes, toolsBytes: pre.toolsBytes, historyBytes: pre.historyBytes, currentBytes: pre.currentBytes, envelopeBytes: pre.envelopeBytes, messages: pre.messages, adviceCount: pre.advice.length },
					result: {
						before: result.before,
						after: result.after,
						freed: result.freed,
						ratio: result.before > 0 ? Number((result.freed / result.before).toFixed(4)) : 0,
						messagesIn: result.messagesIn,
						messagesOut: result.messagesOut,
						overBudget: result.overBudget,
						byTier: Object.values(byTier),
						log: verbose ? result.log : undefined,
						logEntries: result.log.length,
						invariants: { ok: result.invariants.ok, issues: result.invariants.issues.slice(0, 20), reusedCount: result.invariants.reusedIds.length, reusedSample: result.invariants.reusedIds.slice(0, 5) },
					},
					out: outPath || null,
				},
				null,
				2,
			),
		);
	}
	process.exit(result.invariants.ok && !result.overBudget ? 0 : 2);
}

main();
