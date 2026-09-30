#!/usr/bin/env node
/**
 * retry_report — 「本会话到底报了几次 502、自愈了没有」的回执统计器。
 *
 * 502 那句 `DeepSeek Messages request failed (502)` 是**宿主适配器**在响应里
 * 读不到 JSON 信封时的回落文案（dsh-llm-deepseek/lib/index.js:1827），
 * 真正带原因的是同一时刻写在会话日志里的 `llm/retry` / `assistant/attempt` 事件。
 * 这个脚本就把那两个事件从会话日志里抠出来，给你三样东西：
 *   ① 每一次 502 的时间、turn/step、重试序号、退避毫秒 —— 现场凭据。
 *   ② 自愈判定：每次 502 后面有没有跟 llm/retry-started，最终有没有耗尽 maxRetries。
 *   ③ 分布统计：每小时多少次、是否与某类工具调用相关（按该步的工具名归类）。
 *
 * 会话日志是 zstd **分帧**压缩的（一帧一行左右），Node 的
 * zstdDecompressSync 只解第一帧 —— 这里按魔数 28 b5 2f fd 切帧后逐帧解压。
 * 全程只读，不写任何会话文件。
 *
 * 用法：
 *   node scripts/retry_report.mjs                        # 扫最近一个会话
 *   node scripts/retry_report.mjs --session ID           # 指定 session-<uuid>
 *   node scripts/retry_report.mjs --dir DIR              # 指定会话工作目录（默认 cwd 的 slug）
 *   node scripts/retry_report.mjs --all                  # 扫该目录下全部会话
 *   node scripts/retry_report.mjs --json                 # 机器可读
 *   node scripts/retry_report.mjs --selftest             # 纯内存夹具自检，不读会话文件
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const argOf = (f, d = "") => {
	const i = argv.indexOf(f);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const JSON_OUT = has("--json");
const SESSION = argOf("--session", "");
const ALL = has("--all");
const say = (...a) => {
	if (!JSON_OUT) console.log(...a);
};
const hhmmss = (t) => new Date(t).toISOString().slice(11, 19);
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** 工作目录 → 会话目录名的 slug（DSH 把 / 与非字母数字换成 -）。 */
function slugOf(dir) {
	return `--${dir.replace(/^\//, "").replace(/[/\\:]/g, "-")}--`;
}

function sessionsRoot(dir) {
	return path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "sessions", slugOf(dir));
}

/** 按 zstd 魔数切帧、逐帧解压（单帧解压会漏掉后面全部内容）。 */
function decompressSession(file) {
	const buf = fs.readFileSync(file);
	const starts = [];
	for (let i = 0; i + 4 <= buf.length; i++) if (buf.compare(ZSTD_MAGIC, 0, 4, i, i + 4) === 0) starts.push(i);
	let text = "";
	let frames = 0;
	for (let n = 0; n < starts.length; n++) {
		const end = n + 1 < starts.length ? starts[n + 1] : buf.length;
		try {
			text += zlib.zstdDecompressSync(buf.subarray(starts[n], end)).toString("utf8");
			frames++;
		} catch { /* 尾部不完整帧：跳过，不影响已解出的记录 */ }
	}
	return { text, frames, total: starts.length };
}

function analyze(text) {
	const lines = text.split("\n").filter(Boolean);
	const retries = [];
	const attempts = [];
	const startedIds = new Set();
	const callName = new Map();
	const callLog = [];
	let parsed = 0;
	for (const line of lines) {
		let o;
		try {
			o = JSON.parse(line);
		} catch {
			continue;
		}
		parsed++;
		const d = o.data ?? {};
		if (o.type === "tool/call") {
			callName.set(`${d.turn}/${d.step}`, d.name);
			callLog.push({ at: o.time, turn: d.turn, step: d.step, name: d.name });
		} else if (o.type === "llm/retry-started") startedIds.add(d.retryId);
		else if (o.type === "llm/retry") {
			// 工具归因是「尽力而为」：502 发生在该步的请求上，该步的 tool/call 事件
			// 往往在这条 retry 之后才落盘，所以取「时间上最近一次」的工具调用作参考。
			const prior = callLog.filter((c) => c.at <= o.time).pop() ?? null;
			retries.push({
				at: o.time,
				turn: d.turn,
				step: d.step,
				retry: d.retry,
				maxRetries: d.maxRetries,
				delayMs: Math.round(d.delayMs),
				code: d.failure?.code ?? "?",
				status: d.failure?.status ?? null,
				message: d.failure?.message ?? "",
				provider: d.provider ?? "?",
				retryId: d.retryId,
				tool: callName.get(`${d.turn}/${d.step}`) ?? null,
				priorTool: prior ? prior.name : null,
				priorToolAt: prior ? prior.at : null,
			});
		} else if (o.type === "assistant/attempt") {
			const fin = Array.isArray(d.stream) ? d.stream.find((s) => s?.chunk?.finish) : null;
			if (fin) attempts.push({ at: o.time, turn: d.turn, step: d.step, kind: fin.chunk.finish.reason?.kind ?? "?", message: fin.chunk.finish.reason?.failure?.message ?? "" });
		}
	}
	for (const r of retries) {
		r.selfHealed = startedIds.has(r.retryId);
		// 该步的 tool/call 事件常常晚于 llm/retry 落盘，所以工具名要等全部事件读完再回填。
		if (!r.tool) r.tool = callName.get(`${r.turn}/${r.step}`) ?? null;
	}
	const byTool = new Map();
	for (const r of retries) {
		const key = r.tool ?? r.priorTool ?? "(该步无工具)";
		byTool.set(key, (byTool.get(key) ?? 0) + 1);
	}
	const byStatus = new Map();
	for (const r of retries) byStatus.set(r.status ?? "?", (byStatus.get(r.status ?? "?") ?? 0) + 1);
	return { lines: lines.length, parsed, retries, attempts, byTool: [...byTool], byStatus: [...byStatus] };
}

function report(label, a) {
	say(`\n${label}`);
	if (a.retries.length === 0) {
		say(`  没有重试记录 —— 这段会话里适配器一次 502 都没碰到（不等于上游从不 502，只等于没落在这份日志里）`);
		return;
	}
	const healed = a.retries.filter((r) => r.selfHealed).length;
	const exhausted = a.retries.filter((r) => r.retry >= r.maxRetries).length;
	say(`  重试 ${a.retries.length} 次 · 自愈 ${healed}/${a.retries.length} · 耗尽重试预算 ${exhausted} 次`);
	say(`  失败码分布：${a.byStatus.map(([k, v]) => `${k}×${v}`).join(" · ")}`);
	say(`  按时间上最近的工具调用归类（尽力而为，502 与该步请求绑定、工具名可能晚于事件落盘）：${a.byTool.map(([k, v]) => `${k}×${v}`).join(" · ")}`);
	const first = a.retries[0].at;
	const last = a.retries[a.retries.length - 1].at;
	const spanMin = Math.max(0.01, (last - first) / 60000);
	say(`  时间窗 ${hhmmss(first)}–${hhmmss(last)}（${spanMin.toFixed(1)} 分钟）→ 平均 ${(spanMin / a.retries.length).toFixed(1)} 分钟一次`);
	const delays = a.retries.map((r) => r.delayMs);
	say(`  退避：最小 ${Math.min(...delays)} ms · 最大 ${Math.max(...delays)} ms · 均值 ${Math.round(delays.reduce((s, v) => s + v, 0) / delays.length)} ms`);
	for (const r of a.retries) {
		say(`    ${hhmmss(r.at)}  turn${r.turn}/step${r.step}  retry=${r.retry}/${r.maxRetries}  ${r.code}${r.status ? `/${r.status}` : ""}  delay=${r.delayMs}ms  最近工具=${r.priorTool ?? "-"}  ${r.selfHealed ? "→ 已自愈" : "→ 未见重试启动"}`);
	}
	const attemptErrs = a.attempts.filter((x) => x.kind === "error");
	if (attemptErrs.length > 0) {
		say(`  带 error finish 的 attempt ${attemptErrs.length} 条：`);
		for (const x of attemptErrs.slice(0, 6)) say(`    ${hhmmss(x.at)}  turn${x.turn}/step${x.step}  ${x.message}`);
	}
}

/** 纯内存夹具自检：不读会话文件，验证事件抠取与统计口径。 */
function selftest() {
	const T0 = Date.UTC(2026, 0, 1, 14, 0, 0);
	const ev = (type, time, data) => JSON.stringify({ type, time, data });
	const fixture = [
		ev("step/start", T0, { turn: 1, step: 36 }),
		ev("tool/call", T0 + 1000, { turn: 1, step: 35, name: "write" }),
		ev("llm/retry", T0 + 2000, { turn: 1, step: 36, retry: 1, maxRetries: 5, delayMs: 457.4, retryId: "r1", provider: "deepseek-official", failure: { code: "SERVER", status: 502, message: "DeepSeek Messages request failed (502)" } }),
		ev("llm/retry-started", T0 + 2500, { retryId: "r1" }),
		ev("tool/call", T0 + 3000, { turn: 1, step: 36, name: "bash" }),
		// 第二次：retryId 没跟上 started → 应判「未自愈」
		ev("llm/retry", T0 + 60000, { turn: 2, step: 2, retry: 5, maxRetries: 5, delayMs: 9999.6, retryId: "r2", provider: "deepseek-official", failure: { code: "SERVER", status: 502 } }),
		ev("assistant/attempt", T0 + 61000, { turn: 2, step: 2, stream: [{ chunk: { finish: { reason: { kind: "error", failure: { message: "DeepSeek Messages request failed (502)" } } } } }] }),
		"{ 坏行，应被跳过",
	].join("\n");
	const a = analyze(fixture);
	const checks = [
		["解析条数 = 7（坏行被跳过）", a.parsed === 7],
		["重试条数 = 2", a.retries.length === 2],
		["失败码 SERVER", a.retries.every((r) => r.code === "SERVER")],
		["状态码 502×2", a.byStatus.length === 1 && a.byStatus[0][0] === 502 && a.byStatus[0][1] === 2],
		["delayMs 取整（457 / 10000）", a.retries[0].delayMs === 457 && a.retries[1].delayMs === 10000],
		["自愈判定：r1 是、r2 否", a.retries[0].selfHealed === true && a.retries[1].selfHealed === false],
		["同 step 命中该步工具名（turn1/step36 → bash，事件虽晚于 retry 也认）", a.retries[0].tool === "bash"],
		["时间回落在 retry 之前取（turn1/step36 → write，不是之后落盘的 bash）", a.retries[0].priorTool === "write"],
		["无同 step 时回落到时间上最近一次工具调用（turn2/step2 → bash）", a.retries[1].priorTool === "bash"],
		["耗尽预算识别（retry 5/5 → 1 条）", a.retries.filter((r) => r.retry >= r.maxRetries).length === 1],
		["按工具归类取同 step 真名（两条都归 bash，不归 write）", a.byTool.some(([k, v]) => k === "bash" && v === 2) && !a.byTool.some(([k]) => k === "write")],
		["error finish 抽到 1 条", a.attempts.filter((x) => x.kind === "error").length === 1],
		["空输入不崩、零重试", analyze("").retries.length === 0],
	];
	let pass = 0;
	for (const [name, ok] of checks) {
		console.log(`${ok ? "✓" : "✗"} ${name}`);
		if (ok) pass++;
	}
	console.log(`\nretry_report --selftest：${pass}/${checks.length} 通过`);
	process.exit(pass === checks.length ? 0 : 1);
}

async function main() {
	if (has("--selftest")) return selftest();
	const dir = argOf("--dir", process.cwd());
	const root = sessionsRoot(dir);
	if (!fs.existsSync(root)) {
		console.error(`没有这个会话目录：${root}\n（工作目录 slug 规则：/a/b → --a-b--；可用 --dir 指定别的目录）`);
		process.exit(1);
	}
	const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("session-")).map((e) => e.name);
	const targets = SESSION ? entries.filter((n) => n.includes(SESSION)) : ALL ? entries : entries.slice(0, 1);
	if (targets.length === 0) {
		console.error(`该目录下没有匹配的会话：${root}`);
		process.exit(1);
	}
	const out = { action: "retry-report", root, sessions: [], ledger: [] };
	for (const name of targets) {
		const file = path.join(root, name, "session.v4.jsonl.zstd");
		if (!fs.existsSync(file)) {
			say(`\n${name}\n  没有 session.v4.jsonl.zstd（旧格式？跳过）`);
			continue;
		}
		const stat = fs.statSync(file);
		const { text, frames, total } = decompressSession(file);
		const a = analyze(text);
		say(`\n${name}`);
		say(`  日志 ${stat.size} B（zstd ${frames}/${total} 帧解出 ${text.length} 字符 / ${a.lines} 行，解析 ${a.parsed} 条）`);
		report("", a);
		// 跨会话回执单（v0.47.0）：一次比一次糟还是恢复，只有把每个会话的「重试数 / 自愈数 /
		// 耗尽数 / 时间窗」并排看才判得出。JSON 里给同一份，便于接别的工具画图。
		const healedN = a.retries.filter((r) => r.selfHealed).length;
		const exhaustedN = a.retries.filter((r) => (r.attempt ?? 1) >= (r.max ?? 5)).length;
		const whens = a.retries.map((r) => r.at).filter((x) => typeof x === "number");
		out.ledger.push({
			name,
			retries: a.retries.length,
			healed: healedN,
			exhausted: exhaustedN,
			codes: a.byStatus,
			firstAt: whens.length ? Math.min(...whens) : null,
			lastAt: whens.length ? Math.max(...whens) : null,
		});
		out.sessions.push({ name, file, bytes: stat.size, frames, total, lines: a.lines, retries: a.retries, byTool: a.byTool, byStatus: a.byStatus });
	}
	if (out.ledger.some((x) => x.retries > 0)) {
		const sum = out.ledger.reduce((n, x) => n + x.retries, 0);
		const healed = out.ledger.reduce((n, x) => n + x.healed, 0);
		const exhausted = out.ledger.reduce((n, x) => n + x.exhausted, 0);
		say(`\n跨会话回执单：${out.ledger.length} 个会话 · 重试 ${sum} 次 · 自愈 ${healed}/${sum} · 耗尽 ${exhausted} 次`);
		for (const x of out.ledger) {
			if (!x.retries) continue;
			say(`  ${x.name}  重试 ${x.retries} · 自愈 ${x.healed} · 耗尽 ${x.exhausted} · ${x.codes.map(([k, v]) => `${k}×${v}`).join(" ")}`);
		}
	}
	if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
	console.error(`retry_report 失败：${e.message}`);
	process.exit(1);
});
