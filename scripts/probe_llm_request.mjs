#!/usr/bin/env node
/**
 * probe_llm_request — 「502 为什么来」的可跑取证器（无限五代 · 排障件）。
 *
 * 它做四件事，只有带 --live 才真的出网：
 *   ① 体检：把一份请求体过 data/payload-contract.mjs 的契约检查 —— 结构上有没有
 *      「必然被上游拒掉」的错（孤儿 tool_result / 未闭合调用 / 重复调用 id /
 *      非法 JSON 参数串 / content 缺失 / 工具缺 schema / 白名单外字段），
 *      以及体量落在哪一档。纯函数，不联网。
 *   ② 端点取证：--live 时真发一条最小请求，把 状态码 / 上游 request-id /
 *      响应体前 400 字 / SSE 里的 error 事件 全抠出来 ——
 *      「DeepSeek Messages request failed (502)」这句模板串不带原因，
 *      原因只在这四样里。
 *   ③ 尺寸扫描：--scan 用同一份请求体按 --scan-steps 逐级加 padding 重发，
 *      找出「从多大开始挂」。这是把 502 定性成「体量问题」还是「协议问题」的实测法。
 *   ④ 复现：--messages FILE 把一整份真实请求体喂进 ①；--pad N 给 ② 定基准尺寸。
 *
 * 用法：
 *   node scripts/probe_llm_request.mjs                          # 体检探针体 + 报告端点（不出网）
 *   node scripts/probe_llm_request.mjs --live                   # 真发最小请求（messages 端点）
 *   node scripts/probe_llm_request.mjs --live --pad 200000      # 真发一条 200 KB 请求体
 *   node scripts/probe_llm_request.mjs --live --scan            # 尺寸扫描（连发数条，按量计费）
 *   node scripts/probe_llm_request.mjs --messages FILE          # 体检真实请求体 JSON
 *   node scripts/probe_llm_request.mjs --live --messages FILE   # 发这份真实请求体
 *   node scripts/probe_llm_request.mjs --selftest               # 纯自检（契约层 + 诊断层，不联网）
 *   node scripts/probe_llm_request.mjs --json                   # 机器可读输出
 *
 * 环境变量：
 *   DEEPSEEK_BASE_URL  messages 端点根（默认 https://api.deepseek.com/anthropic）
 *   DEEPSEEK_API_KEY   密钥（缺省退回 ~/.dsh/.credentials.yaml 的 refs.DEEPSEEK_API_KEY）
 *   DEEPSEEK_MODEL     模型名（默认 deepseek-chat）
 *   IG5_RELAY_BASE_URL / IG5_RELAY_API_KEY  chat/completions 通道（可选）
 */
import fs from "node:fs";
import path from "node:path";
import { findPackageDir } from "./lib/host-resolve.mjs";
import { inspectBody, diagnoseHttp, scanStreamErrors, PAYLOAD_CONTRACT_VERSION, bandOf, byteLengthOf } from "../data/payload-contract.mjs";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const argOf = (flag, fallback = "") => {
	const i = argv.indexOf(flag);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const JSON_OUT = has("--json");
const LIVE = has("--live");
const SELFTEST = has("--selftest");
const SCAN = has("--scan");
const PROTOCOL = argOf("--protocol", "messages");
const MESSAGES_FILE = argOf("--messages", "");
const PAD = Number(argOf("--pad", "0")) || 0;
const SCAN_STEPS = (argOf("--scan-steps", "0,50000,200000,1000000,4000000")).split(",").map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n >= 0);
const TIMEOUT_MS = Number(argOf("--timeout", "30000")) || 30000;

const PROBE_PROMPT = "只回一个词：pong";
const RESULTS = [];

const paint = (() => {
	const tty = Boolean(process.stdout.isTTY) && !JSON_OUT;
	const wrap = (code) => (s) => (tty ? `\u001b[${code}m${s}\u001b[0m` : s);
	return { red: wrap("31"), green: wrap("32"), yellow: wrap("33"), dim: wrap("2"), bold: wrap("1") };
})();
const say = (...a) => {
	if (!JSON_OUT) console.log(...a);
};
const record = (entry) => RESULTS.push(entry);
const pass = (name, extra = "") => {
	record({ name, ok: true, extra });
	say(`  ${paint.green("✓")} ${name}${extra ? ` ${paint.dim(extra)}` : ""}`);
};
const fail = (name, extra = "") => {
	record({ name, ok: false, extra });
	say(`  ${paint.red("✗")} ${name}${extra ? ` ${paint.dim(extra)}` : ""}`);
};

/** 从 ~/.dsh/.credentials.yaml 里掏 refs.<name> 的值（只读，不打印明文）。 */
function keyFromCredentials(name) {
	const home = process.env.DSH_HOME || path.join(process.env.HOME ?? "/root", ".dsh");
	const file = path.join(home, ".credentials.yaml");
	try {
		const raw = fs.readFileSync(file, "utf8");
		const m = raw.match(new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, "mu"));
		return m ? m[1] : "";
	} catch {
		return "";
	}
}

function hostAdapterInfo() {
	try {
		const dir = findPackageDir("dsh-llm-deepseek");
		if (!dir) return { found: false, error: "两种宿主布局都没搜到 dsh-llm-deepseek" };
		const entry = path.join(dir, "lib", "index.js");
		const stat = fs.statSync(entry);
		let version = "?";
		try {
			version = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
		} catch { /* 版本读不到不影响诊断 */ }
		return { found: true, version, file: entry, bytes: stat.size };
	} catch (error) {
		return { found: false, error: error.message };
	}
}

function resolveEndpoint() {
	const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/anthropic").replace(/\/+$/, "");
	const key = process.env.DEEPSEEK_API_KEY || keyFromCredentials("DEEPSEEK_API_KEY");
	const relay = (process.env.IG5_RELAY_BASE_URL || "").replace(/\/+$/, "");
	const relayKey = process.env.IG5_RELAY_API_KEY || keyFromCredentials("IG5_RELAY_API_KEY");
	return { baseUrl, key, hasKey: Boolean(key), relay, relayKey, hasRelayKey: Boolean(relayKey) };
}

/** 合成一份与宿主出站同形的探针请求体（字段白名单照 dsh-llm-deepseek 1755-1796）。 */
function probeBody(protocol = "messages", pad = 0) {
	const filler = pad > 0 ? "x".repeat(pad) : "";
	if (protocol === "chat") {
		return {
			model: process.env.IG5_RELAY_MODEL || "deepseek-chat",
			stream: false,
			max_tokens: 16,
			messages: [{ role: "system", content: `你是探针。${filler}` }, { role: "user", content: PROBE_PROMPT }],
		};
	}
	return {
		model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
		stream: true,
		max_tokens: 16,
		thinking: { type: "disabled" },
		system: `你是探针。只回一个词。${filler}`,
		messages: [{ role: "user", content: PROBE_PROMPT }],
	};
}

function runContract(label, body) {
	say(`\n${paint.bold(`① 请求体契约体检 — ${label}`)}`);
	const report = inspectBody(body);
	const { stats } = report;
	say(`  体量 ${stats.bytes} B（${(stats.bytes / 1048576).toFixed(2)} MiB）· 风险带 ${stats.band.id} · 消息 ${stats.messages} 条（user+assistant ${stats.roles}）`);
	say(`  system ${stats.systemBytes} B · tools ${stats.toolBytes} B · 粗估 ${stats.estTokens} token`);
	if (stats.largest.length > 0) say(`  最大三条：${stats.largest.map((m) => `#${m.index}(${m.role}) ${m.bytes} B`).join(" · ")}`);
	for (const issue of report.issues) {
		const mark = issue.level === "error" ? paint.red("✗") : paint.yellow("!");
		say(`  ${mark} [${issue.code}] ${issue.where} — ${issue.detail}`);
		say(`      ${paint.dim(`修：${issue.fix}`)}`);
	}
	if (report.issues.length === 0) say(`  ${paint.green("✓")} 结构上没有被必然拒掉的错`);
	record({ step: "contract", label, ok: report.ok, issues: report.issues.length, stats });
	return report;
}

async function httpProbe(target) {
	const { url, headers, body, label } = target;
	const started = Date.now();
	const payload = JSON.stringify(body);
	let response = null;
	let text = "";
	let transportError = null;
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
		response = await fetch(url, { method: "POST", headers, body: payload, signal: controller.signal });
		clearTimeout(timer);
		text = await response.text();
	} catch (e) {
		transportError = e;
	}
	const ms = Date.now() - started;
	const diag = diagnoseHttp({
		status: response ? response.status : void 0,
		headers: response ? response.headers : void 0,
		bodyText: text,
		contentType: response && response.headers ? (response.headers.get("content-type") || "") : "",
		requestBytes: Buffer.byteLength(payload, "utf8"),
	});
	return {
		label,
		url,
		ms,
		requestBytes: Buffer.byteLength(payload, "utf8"),
		responseBytes: Buffer.byteLength(text, "utf8"),
		diag,
		streamErrors: scanStreamErrors(text),
		transportError: transportError ? `${transportError.name}: ${transportError.message}` : null,
		textHead: text.slice(0, 400),
	};
}

function reportHttp(result) {
	say(`\n${paint.bold(`② 端点取证 — ${result.label}`)}`);
	say(`  POST ${result.url}`);
	say(`  请求 ${result.requestBytes} B → 响应 ${result.responseBytes} B · ${result.ms} ms`);
	if (result.transportError) {
		say(`  ${paint.red("✗")} 连接层就失败了：${result.transportError}`);
		for (const a of result.diag.advice) say(`      ${paint.dim(a)}`);
		return false;
	}
	const status = result.diag.status ?? 0;
	const okStatus = status >= 200 && status < 300 && result.streamErrors.length === 0;
	say(`  ${okStatus ? paint.green("✓") : paint.red("✗")} status=${status} · 定性=${result.diag.cause}${result.diag.upstreamRequestId ? ` · 上游 request-id=${result.diag.upstreamRequestId}` : ""}`);
	if (result.diag.detail) say(`  错误详情：${result.diag.detail}`);
	if (result.diag.looksHtml) say(`  ${paint.yellow("!")} 回的是 HTML 错误页 → 请求大概率没到模型`);
	if (result.diag.bodyHead && !result.diag.detail) say(`  响应体前 400 字：${String(result.diag.bodyHead).replace(/\s+/g, " ").slice(0, 400)}`);
	for (const e of result.streamErrors) say(`  ${paint.yellow("!")} 流内 error 事件 [${e.type}] ${e.message}`);
	for (const a of result.diag.advice) say(`      ${paint.dim(a)}`);
	return okStatus;
}

function loadMessages(file) {
	const doc = JSON.parse(fs.readFileSync(file, "utf8"));
	if (doc && doc.body && typeof doc.body === "object") return { label: file, body: doc.body };
	if (doc && Array.isArray(doc.messages)) return { label: file, body: doc };
	if (doc && doc.request && typeof doc.request === "object" && Array.isArray(doc.request.messages)) return { label: file, body: doc.request };
	throw new Error(`${file} 里没找到请求体（认 {body:{...}}、{messages:[...]}、{request:{messages:[...]}} 三种壳）`);
}

function selftest() {
	say(paint.bold("自检 — 契约层 + 诊断层（不联网）"));
	const good = {
		model: "deepseek-chat",
		stream: true,
		max_tokens: 64,
		thinking: { type: "enabled" },
		output_config: { effort: "high" },
		system: "内核段",
		messages: [
			{ role: "user", content: "hi" },
			{ role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "bash", input: { command: "ls" } }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "a\nb" }, { type: "text", text: "继续" }] },
		],
		tools: [{ name: "bash", description: "run", input_schema: { type: "object", properties: { command: { type: "string" } } } }],
	};
	const goodReport = inspectBody(good);
	goodReport.ok && goodReport.issues.length === 0 ? pass("合法体零告警") : fail("合法体零告警", `issues=${goodReport.issues.map((i) => i.code).join(",")}`);

	const orphan = inspectBody({ model: "m", messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_x", content: "x" }] }] });
	orphan.issues.some((i) => i.code === "orphan-tool-result") ? pass("抓到孤儿 tool_result") : fail("抓到孤儿 tool_result");

	const open = inspectBody({ model: "m", messages: [{ role: "assistant", content: [{ type: "tool_use", id: "c1", name: "bash", input: {} }] }] });
	open.issues.some((i) => i.code === "history-ends-open") ? pass("抓到未闭合调用") : fail("抓到未闭合调用");

	const dup = inspectBody({ model: "m", messages: [
		{ role: "assistant", content: [{ type: "tool_use", id: "same", name: "a", input: {} }, { type: "tool_use", id: "same", name: "b", input: {} }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "same", content: "ok" }] },
	] });
	dup.issues.some((i) => i.code === "dup-tool-id") ? pass("抓到重复调用 id") : fail("抓到重复调用 id");

	const badArgs = inspectBody({ model: "m", messages: [
		{ role: "assistant", content: [{ type: "tool_use", id: "c2", name: "write", input: '{"file":"a.txt",}' }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "c2", content: "ok" }] },
	] });
	badArgs.issues.some((i) => i.code === "tool-args-not-json") ? pass("抓到非法 JSON 参数串") : fail("抓到非法 JSON 参数串");

	const noSchema = inspectBody({ model: "m", messages: [{ role: "user", content: "hi" }], tools: [{ name: "t" }] });
	noSchema.issues.some((i) => i.code === "tool-no-schema") ? pass("抓到工具缺 schema") : fail("抓到工具缺 schema");

	const noContent = inspectBody({ model: "m", messages: [{ role: "user", content: void 0 }] });
	noContent.issues.some((i) => i.code === "no-content") ? pass("抓到 content 缺失（会被 JSON 丢掉）") : fail("抓到 content 缺失");

	const extra = inspectBody({ model: "m", messages: [{ role: "user", content: "hi" }], some_new_field: 1 });
	extra.issues.some((i) => i.code === "extra-keys") ? pass("抓到白名单外字段") : fail("抓到白名单外字段");

	const pair = inspectBody({ model: "m", messages: [
		{ role: "assistant", content: [{ type: "tool_use", id: "k", name: "a", input: {} }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "k", content: "r" }] },
	] });
	pair.ok && pair.issues.filter((i) => i.code.startsWith("orphan") || i.code.startsWith("call-without")).length === 0
		? pass("配对调用与结果不误报")
		: fail("配对调用与结果不误报", JSON.stringify(pair.issues.map((i) => i.code)));

	const big = inspectBody({ model: "m", system: "x".repeat(5_000_000), messages: [{ role: "user", content: "hi" }] });
	big.band.id === "hot" ? pass("体量分带 hot", `${(big.stats.bytes / 1048576).toFixed(2)} MiB`) : fail("体量分带 hot", big.band.id);
	bandOf(1000).id === "ok" ? pass("体量分带 ok") : fail("体量分带 ok");

	const gateway = diagnoseHttp({ status: 502, headers: { "content-type": "text/html" }, bodyText: "<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>" });
	gateway.cause === "gateway-plain-error" && gateway.looksHtml ? pass("定性网关 HTML 502", gateway.cause) : fail("定性网关 HTML 502", gateway.cause);

	const upstream = diagnoseHttp({ status: 502, headers: { "content-type": "application/json", "x-request-id": "req_abc" }, bodyText: JSON.stringify({ error: { type: "api_error", message: "upstream connect error or disconnect/reset before headers" } }) });
	upstream.cause === "upstream-5xx" && upstream.detail.includes("upstream connect error") && upstream.upstreamRequestId === "req_abc" ? pass("抠出上游错误详情与 request-id") : fail("抠出上游错误详情与 request-id", JSON.stringify(upstream));

	diagnoseHttp({ status: 413, bodyText: "" }).cause === "too-large" ? pass("定性 413 体量超限") : fail("定性 413 体量超限");
	const rl = diagnoseHttp({ status: 429, headers: { "retry-after": "7" }, bodyText: "" });
	rl.cause === "rate-limit" && rl.retryAfter === "7" ? pass("定性 429 并读 Retry-After") : fail("定性 429 并读 Retry-After");
	diagnoseHttp({ status: 400, bodyText: '{"error":{"message":"messages: at least one message is required"}}' }).cause === "bad-request" ? pass("定性 400 结构非法") : fail("定性 400 结构非法");
	diagnoseHttp({ status: 401, bodyText: "" }).cause === "auth" ? pass("定性 401 鉴权") : fail("定性 401 鉴权");
	diagnoseHttp({ bodyText: "" }).cause === "transport" ? pass("定性连接层失败") : fail("定性连接层失败");

	const inBand = scanStreamErrors('event: message_start\ndata: {"type":"message_start"}\n\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\ndata: [DONE]\n');
	inBand.length === 1 && inBand[0].type === "error" ? pass("抠出流内 error 事件") : fail("抠出流内 error 事件", JSON.stringify(inBand));

	byteLengthOf("中文abc") === 9 ? pass("utf8 字节数正确") : fail("utf8 字节数正确", String(byteLengthOf("中文abc")));
	inspectBody(good).stats.estTokens > 0 ? pass("token 粗估非零") : fail("token 粗估非零");

	const failed = RESULTS.filter((r) => r.ok === false);
	say(`\n自检 ${RESULTS.length - failed.length}/${RESULTS.length} 通过`);
	if (JSON_OUT) console.log(JSON.stringify({ action: "selftest", version: PAYLOAD_CONTRACT_VERSION, passed: RESULTS.length - failed.length, total: RESULTS.length, failed: failed.map((f) => f.name) }, null, 2));
	if (failed.length > 0) process.exit(1);
}

function headersFor(protocol, endpoint) {
	if (protocol === "chat") {
		return { "content-type": "application/json", ...(endpoint.hasRelayKey ? { authorization: `Bearer ${endpoint.relayKey}` } : {}) };
	}
	return {
		"content-type": "application/json",
		"anthropic-version": "2023-06-01",
		accept: "text/event-stream",
		...(endpoint.hasKey ? { "x-api-key": endpoint.key, authorization: `Bearer ${endpoint.key}` } : {}),
	};
}

function urlFor(protocol, endpoint) {
	if (protocol === "chat") {
		if (!endpoint.relay) return "";
		return /\/chat\/completions$/.test(endpoint.relay) ? endpoint.relay : `${endpoint.relay}/chat/completions`;
	}
	return `${endpoint.baseUrl}/v1/messages`;
}

const hostOnly = (u) => String(u || "").replace(/^(https?:\/\/[^/]+).*/u, "$1");

async function main() {
	if (SELFTEST) {
		selftest();
		return;
	}
	const out = { action: LIVE ? "probe-live" : MESSAGES_FILE ? "inspect-file" : "inspect", version: PAYLOAD_CONTRACT_VERSION, steps: [] };

	const adapter = hostAdapterInfo();
	const endpoint = resolveEndpoint();
	const protocol = PROTOCOL === "chat" ? "chat" : "messages";
	if (!JSON_OUT) {
		say(paint.bold("0) 环境"));
		say(`  宿主适配器：${adapter.found ? `dsh-llm-deepseek@${adapter.version}（${adapter.bytes} B）` : paint.yellow(`未找到（${adapter.error}）`)}`);
		say(`  ${protocol === "chat" ? "chat/completions" : "messages"} 端点：${hostOnly(urlFor(protocol, endpoint) || endpoint.baseUrl)} · 密钥 ${(protocol === "chat" ? endpoint.hasRelayKey : endpoint.hasKey) ? "已就位" : paint.yellow("未配置（--live 会 401）")}`);
		say(`  另一通道：${protocol === "chat" ? `messages ${hostOnly(endpoint.baseUrl)}` : endpoint.relay ? `relay ${hostOnly(endpoint.relay)}` : paint.dim("relay 未配置")}`);
	}
	out.steps.push({ step: "env", adapter, endpoint: { baseUrl: endpoint.baseUrl, hasKey: endpoint.hasKey, relay: endpoint.relay, hasRelayKey: endpoint.hasRelayKey } });

	const body = MESSAGES_FILE ? loadMessages(MESSAGES_FILE).body : probeBody(protocol, PAD);
	const label = MESSAGES_FILE ? `真实请求体 ${MESSAGES_FILE}` : `合成探针体（${protocol}${PAD > 0 ? ` + ${PAD} B padding` : ""}）`;
	const report = runContract(label, body);
	out.steps.push({ step: "contract", label, ok: report.ok, stats: report.stats, issues: report.issues });

	if (LIVE) {
		const url = urlFor(protocol, endpoint);
		if (!url) {
			say(`\n${paint.yellow("!")} 该通道端点未配置，跳过取证`);
		} else if (SCAN) {
			say(`\n${paint.bold("② 尺寸扫描 — 逐级加 padding 找挂点")}`);
			const headers = headersFor(protocol, endpoint);
			const rows = [];
			for (const size of SCAN_STEPS) {
				const scanned = MESSAGES_FILE ? { ...loadMessages(MESSAGES_FILE).body } : probeBody(protocol, size);
				if (MESSAGES_FILE && size > 0) scanned.system = `${scanned.system ?? ""}${"x".repeat(size)}`;
				const result = await httpProbe({ label: `pad≈${(size / 1024).toFixed(0)} KiB`, url, headers, body: scanned });
				const status = result.diag.status ?? 0;
				const ok = result.transportError === null && status >= 200 && status < 300;
				rows.push({ reqBytes: result.requestBytes, status: result.diag.status, cause: result.diag.cause, ok, ms: result.ms, streamErrors: result.streamErrors.length });
				say(`  ${ok ? paint.green("✓") : paint.red("✗")} ${(result.requestBytes / 1024).toFixed(0)} KiB → status=${result.diag.status ?? "transport"} · ${result.diag.cause} · ${result.ms} ms${result.diag.detail ? ` · ${result.diag.detail}` : ""}`);
			}
			out.steps.push({ step: "scan", rows });
			const firstBad = rows.find((r) => !r.ok);
			say(`\n  ${firstBad ? `挂点：${(firstBad.reqBytes / 1024).toFixed(0)} KiB（status=${firstBad.status ?? "transport"}，${firstBad.cause}）` : "全档通过：这一段的体量不是问题"}`);
		} else {
			const result = await httpProbe({ label: `${protocol} 端点`, url, headers: headersFor(protocol, endpoint), body });
			const ok = reportHttp(result);
			out.steps.push({ step: "live", label: result.label, url: result.url, ms: result.ms, requestBytes: result.requestBytes, responseBytes: result.responseBytes, diag: result.diag, streamErrors: result.streamErrors, transportError: result.transportError, ok });
		}
	} else if (!JSON_OUT) {
		say(`\n${paint.dim("② 跳过端点取证（未加 --live）。真发一条最小请求：node scripts/probe_llm_request.mjs --live")}`);
	}

	if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
	else {
		const bad = out.steps.filter((s) => s.ok === false);
		say(`\n${paint.bold(bad.length === 0 ? "结论：本次体检没抓到会让请求失败的点" : `结论：抓到 ${bad.length} 处问题，逐条修完再复跑`)}`);
	}
	if (out.steps.some((s) => s.ok === false && s.step === "contract")) process.exitCode = 2;
}

main().catch((error) => {
	console.error(`probe_llm_request 失败：${error.message}`);
	process.exit(1);
});
