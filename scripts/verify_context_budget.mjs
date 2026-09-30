#!/usr/bin/env node
/**
 * verify_context_budget — data/context-budget.mjs 的独立自检（不依赖 CLI）。
 *
 * 七块：
 *   ① 分账与预检：四笔账相加关系、verdict 分档
 *   ② 裁剪正确性：按字节安全切、不切出半个汉字、标记里含被裁字节数
 *   ③ 三级瘦身：A/B/C 各自能省、且 B 只留最新一遍、C 只落轮边界
 *   ④ 契约不变量：孤儿回执 / 未闭合调用 / 同条消息重复 id 都要被抓
 *   ⑤ 性质测试：200 组随机历史 × 3 档预算 —— 瘦身后必须合同、当前轮必须原样、要么在预算内要么明确报超
 *   ⑥ 幂等：对已瘦身结果再瘦一次，体量不再变（不会越裁越小到失控）
 *   ⑦ CLI 冒烟：--messages 走 stdin、--json 出机器可读、超预算时不加 --force 拒写
 *
 * 用法：node scripts/verify_context_budget.mjs [--json] [--quick]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
	BUDGETER_VERSION,
	account,
	checkInvariants,
	clipText,
	dedupeBodies,
	dropOldest,
	normalizeBlockOrder,
	preflight,
	roughTokens,
	slimResults,
	trim,
} from "../data/context-budget.mjs";

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const QUICK = argv.includes("--quick");
const checks = [];
const t = (name, ok, extra = "") => checks.push({ name, ok: !!ok, extra });
const bytes = (v) => Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v), "utf8");

/* ---------- 夹具 ---------- */
function mulberry(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let x = Math.imul(a ^ (a >>> 15), 1 | a);
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
}

/** 生成一段「像真会话」的历史：assistant 调工具 → user 回执，偶尔夹大回执与重复正文。 */
function genHistory(rnd, turns) {
	const ms = [];
	let idn = 0;
	for (let i = 0; i < turns; i++) {
		const calls = 1 + Math.floor(rnd() * 2);
		const ids = [];
		const useBlocks = [];
		for (let c = 0; c < calls; c++) {
			const id = `toolu_${idn++}`;
			ids.push(id);
			useBlocks.push({ type: "tool_use", id, name: ["bash", "read", "grep"][Math.floor(rnd() * 3)], input: { cmd: "x".repeat(5) } });
		}
		ms.push({ role: "assistant", content: [{ type: "text", text: `第 ${i} 轮说明` }, ...useBlocks] });
		const results = ids.map((id) => {
			const kind = rnd();
			const body =
				kind < 0.3 ? "P".repeat(6000 + Math.floor(rnd() * 4000)) // 大回执
					: kind < 0.5 ? "R".repeat(3000) // 与别的轮重复的正文
						: `小回执 ${id}`;
			return { type: "tool_result", tool_use_id: id, content: body };
		});
		ms.push({ role: "user", content: results });
	}
	ms.push({ role: "user", content: [{ type: "text", text: "当前轮需求：给我方案" }] });
	return { system: "S".repeat(200), tools: [{ name: "bash", description: "d", input_schema: { type: "object" } }], messages: ms };
}

/* ---------- ① 分账与预检 ---------- */
{
	const b = genHistory(mulberry(7), 3);
	const a = account(b);
	t("① 分账：四笔账之和 + JSON 信封 = 总数", a.partsSum + a.envelopeBytes === a.total, `sum=${a.partsSum} env=${a.envelopeBytes} total=${a.total}`);
	t("① 分账：信封只占小头（< 5% 或 < 256 B）", a.envelopeBytes < Math.max(256, a.total * 0.05), `env=${a.envelopeBytes}`);
	t("① 分账：当前轮被标出且只有一条", a.per.filter((x) => x.current).length === 1);
	t("① 分账：top5 按体量降序", a.top.every((x, i) => i === 0 || a.top[i - 1].bytes >= x.bytes));
	t("① 预检：预算极大给 ok", preflight(b, { ceiling: 10 ** 8 }).verdict === "ok");
	t("① 预检：刚好 1 倍给 ok / 1.5 倍给 warn / 3 倍给 hot",
		preflight(b, { ceiling: a.total }).verdict === "ok" &&
		preflight(b, { ceiling: Math.floor(a.total / 1.5) }).verdict === "warn" &&
		preflight(b, { ceiling: Math.floor(a.total / 3) }).verdict === "hot");
	t("① 预检：超预算时给建议", preflight(b, { ceiling: 1024 }).advice.length > 0);
	t("① token 粗估：CJK 比同长度 ASCII 更贵", roughTokens("中".repeat(40)) > roughTokens("a".repeat(40)));
}

/* ---------- ② 裁剪正确性 ---------- */
{
	const s = "开头".repeat(300) + "中间".repeat(300) + "结尾".repeat(300);
	const r = clipText(s, 600, "测试裁剪");
	t("② 裁剪后不超过上限", bytes(r.text) <= 600 + 80, `after=${bytes(r.text)}`);
	t("② 被裁字节数 > 0", r.clipped > 0);
	t("② 标记里写明被省略字节数", r.text.includes(`${r.omitted} B`) && r.text.includes(`原文 ${r.before} B`));
	t("② 标记自报的省略数与实际省下数一致（差值 = 标记自身开销）",
		r.before - r.after === r.omitted - r.markerBytes, `before-after=${r.before - r.after} omitted-marker=${r.omitted - r.markerBytes}`);
	t("② 不切出半个汉字（重新编码再解码一致）", Buffer.from(r.text, "utf8").toString("utf8") === r.text);
	const same = clipText("短文本", 600);
	t("② 未超上限时原样返回", same.clipped === 0 && same.text === "短文本");
	t("② cap=0 时不裁（保护调用方）", clipText(s, 0).clipped === 0);
}

/* ---------- ③ 三级瘦身 ---------- */
{
	const big = "Z".repeat(20000);
	const hist = [
		{ role: "assistant", content: [{ type: "tool_use", id: "a1", name: "bash", input: {} }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "a1", content: big }] },
		{ role: "assistant", content: [{ type: "tool_use", id: "a2", name: "bash", input: {} }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "a2", content: big }] }, // 与上一条同正文
		{ role: "user", content: [{ type: "text", text: "当前轮" }] },
	];
	const A = slimResults(hist, { toolResultCap: 1000 });
	t("③ A：省下字节", A.freed > 0, `freed=${A.freed}`);
	t("③ A：回执 block 数量不变（只裁正文）", A.messages[1].content.length === 1 && A.messages[1].content[0].type === "tool_result");
	t("③ A：tool_use_id 原样保留", A.messages[1].content[0].tool_use_id === "a1");
	t("③ A：不动当前轮", JSON.stringify(A.messages.at(-1)).includes("当前轮"));
	t("③ A：不变量仍通过", checkInvariants(A.messages).ok);

	const B = dedupeBodies(hist, { dedupeMinBytes: 1000 });
	t("③ B：省下字节", B.freed > 0, `freed=${B.freed}`);
	t("③ B：只留最新一遍（a1 折叠、a2 原样）",
		String(B.messages[1].content[0].content).includes("重复正文 20000 B") &&
		String(B.messages[1].content[0].content).includes("同摘要") &&
		String(B.messages[3].content[0].content).length === 20000 &&
		String(B.messages[3].content[0].content).startsWith("ZZZZ"));
	t("③ B：折叠桩里写清原大小与摘要", String(B.messages[1].content[0].content).includes("B") && String(B.messages[1].content[0].content).includes("同摘要"));

	const C = dropOldest(hist, { needBytes: 30000, minKeepMessages: 3 });
	t("③ C：确实丢了整轮", C.dropped > 0, `dropped=${C.dropped}`);
	t("③ C：丢完仍是合法历史", C.invariants.ok);
	t("③ C：首条不是回执载体", !(C.messages[0].content ?? []).some?.((b) => b?.type === "tool_result"));
	t("③ C：当前轮仍在", JSON.stringify(C.messages.at(-1)).includes("当前轮"));

	const norm = normalizeBlockOrder([{ role: "assistant", content: [{ type: "tool_result", tool_use_id: "x", content: "r" }, { type: "tool_use", id: "x", name: "t", input: {} }] }]);
	t("③ N：tool_use 被前移到前面", norm.messages[0].content[0].type === "tool_use");
	t("③ N：顺序反了也能通过契约（配对按同条消息）", checkInvariants(norm.messages).ok);
}

/* ---------- ④ 契约不变量 ---------- */
{
	t("④ 孤儿回执被抓", !checkInvariants([{ role: "user", content: [{ type: "tool_result", tool_use_id: "z", content: "x" }] }]).ok);
	t("④ 未闭合调用被抓", !checkInvariants([{ role: "assistant", content: [{ type: "tool_use", id: "q", name: "t", input: {} }] }]).ok);
	t("④ 同条消息重复 id 被抓", !checkInvariants([{ role: "assistant", content: [{ type: "tool_use", id: "q", name: "t", input: {} }, { type: "tool_use", id: "q", name: "t", input: {} }] }]).ok);
	t("④ 无 id 的调用被抓", !checkInvariants([{ role: "assistant", content: [{ type: "tool_use", name: "t", input: {} }] }]).ok);
	t("④ 跨轮复用 id 只记录不判坏", (() => {
		const r = checkInvariants([
			{ role: "assistant", content: [{ type: "tool_use", id: "q", name: "t", input: {} }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "q", content: "1" }] },
			{ role: "assistant", content: [{ type: "tool_use", id: "q", name: "t", input: {} }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "q", content: "2" }] },
		]);
		return r.ok && r.reusedIds.length === 1;
	})());
	t("④ 合法历史不误报", checkInvariants(genHistory(mulberry(11), 2).messages).ok);
}

/* ---------- ⑤ 性质测试 ---------- */
let propRuns = 0;
let propFail = "";
{
	const rounds = QUICK ? 40 : 200;
	const ceilings = [65536, 16384, 4096];
	for (let i = 0; i < rounds && !propFail; i++) {
		const rnd = mulberry(1000 + i);
		const body = genHistory(rnd, 2 + Math.floor(rnd() * 6));
		const lastBefore = JSON.stringify(body.messages.at(-1));
		for (const ceiling of ceilings) {
			const r = trim(body, { ceiling });
			propRuns++;
			if (!r.invariants.ok) propFail = `第 ${i} 组 ceiling=${ceiling} 不变量坏：${JSON.stringify(r.invariants.issues[0])}`;
			else if (JSON.stringify(r.body.messages.at(-1)) !== lastBefore) propFail = `第 ${i} 组 ceiling=${ceiling} 当前轮被改动`;
			else if (r.after > ceiling && !r.overBudget) propFail = `第 ${i} 组 ceiling=${ceiling} 超预算却未标记`;
			else if (r.after > r.before) propFail = `第 ${i} 组 ceiling=${ceiling} 瘦身后反而变大`;
		}
	}
	t(`⑤ 性质测试 ${propRuns} 次（随机历史 × 3 档预算）全合同`, propFail === "", propFail);
}

/* ---------- ⑥ 幂等 ---------- */
{
	const body = genHistory(mulberry(42), 5);
	const once = trim(body, { ceiling: 16384 });
	const twice = trim(once.body, { ceiling: 16384 });
	t("⑥ 幂等：对已瘦身结果再瘦，体量不再变小", twice.after === once.after, `${once.after} → ${twice.after}`);
	t("⑥ 幂等：二次仍合同", twice.invariants.ok);
	t("⑥ 幂等：二次仍不动当前轮", JSON.stringify(twice.body.messages.at(-1)) === JSON.stringify(once.body.messages.at(-1)));
}

/* ---------- ⑦ CLI 冒烟 ---------- */
{
	const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
	const cli = path.join(repo, "scripts", "trim_request.mjs");
	const tmp = path.join("/tmp", `ig5-trim-${Date.now()}.json`);
	fs.writeFileSync(tmp, JSON.stringify(genHistory(mulberry(99), 4)));
	let ok = true;
	let note = "";
	try {
		const out = execFileSync(process.execPath, [cli, "--messages", tmp, "--budget", "16384", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		const j = JSON.parse(out);
		ok = j.result && j.result.freed >= 0 && j.ceiling === 16384;
		note = `freed=${j.result?.freed}`;
	} catch (e) {
		ok = false;
		note = `CLI 失败：${e.message?.slice(0, 120)}`;
	}
	t("⑦ CLI：--messages + --json 可跑通并出 JSON", ok, note);

	let refused = false;
	try {
		execFileSync(process.execPath, [cli, "--messages", tmp, "--budget", "64", "--out", "/tmp/ig5-should-not-write.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (e) {
		refused = e.status === 2;
	}
	t("⑦ CLI：超预算且不加 --force 时以退出码 2 拒写", refused);

	const stdoutRun = execFileSync(process.execPath, [cli, "--messages", "-", "--budget", "65536"], { encoding: "utf8", input: fs.readFileSync(tmp, "utf8"), stdio: ["pipe", "pipe", "pipe"] });
	t("⑦ CLI：stdin（--messages -）可用", stdoutRun.includes("预检") && stdoutRun.includes("分账"));
	t("⑦ CLI：--selftest 全绿", (() => {
		try {
			const s = execFileSync(process.execPath, [cli, "--selftest"], { encoding: "utf8" });
			return /(\d+)\/\1 通过/.test(s.trim().split("\n").at(-1));
		} catch {
			return false;
		}
	})());
	fs.rmSync(tmp, { force: true });
	fs.rmSync("/tmp/ig5-should-not-write.json", { force: true });
}

/* ---------- 汇总 ---------- */
const pass = checks.filter((c) => c.ok).length;
if (JSON_OUT) {
	console.log(JSON.stringify({ action: "verify-context-budget", version: BUDGETER_VERSION, total: checks.length, passed: pass, failed: checks.filter((c) => !c.ok).map((c) => ({ name: c.name, extra: c.extra })) }, null, 2));
} else {
	for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.extra && !c.ok ? ` —— ${c.extra}` : ""}`);
	console.log(`\nverify_context_budget（${BUDGETER_VERSION}）：${pass}/${checks.length} 通过`);
}
process.exit(pass === checks.length ? 0 : 1);
