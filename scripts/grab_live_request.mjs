#!/usr/bin/env node
/**
 * grab_live_request — 从本会话日志里抠出「一次真实出站请求」的最大近似，落成一个 JSON 请求体。
 *
 * 为什么需要它：预算器的数字如果只在合成夹具上量，就没有说服力。真会话日志（zstd 分帧）
 * 里有真实的 system 文本、工具 schema 与历史消息 —— 用它做素材，裁出来的字节数才是真的。
 *
 * 用法：
 *   node scripts/grab_live_request.mjs --out /tmp/live.json [--session ID] [--dir DIR] [--max-messages N]
 *   node scripts/grab_live_request.mjs --list          # 只列候选会话日志与体量
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

/* ---------- zstd 分帧解压（整包解只出第一帧，必须按魔数切） ---------- */
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
export function decompressFramed(buf) {
	const cuts = [];
	let i = buf.indexOf(MAGIC, 0);
	while (i !== -1) {
		cuts.push(i);
		i = buf.indexOf(MAGIC, i + 4);
	}
	const out = [];
	for (let k = 0; k < cuts.length; k++) {
		const end = k + 1 < cuts.length ? cuts[k + 1] : buf.length;
		const frame = buf.subarray(cuts[k], end);
		try {
			out.push(zlib.zstdDecompressSync(frame).toString("utf8"));
		} catch {
			/* 坏帧跳过：日志是追加写，末帧常常不完整 */
		}
	}
	if (cuts.length === 0) {
		try {
			return zlib.zstdDecompressSync(buf).toString("utf8");
		} catch {
			return "";
		}
	}
	return out.join("");
}

function sessionDirOf(cwd) {
	// 宿主的 slug 规则：把 cwd 里所有非字母数字字符换成 `-`（开头那个 `/` 也算一个），再两端各补一个 `-`。
	// 实测：/root/dsh-infinite-gen-5 → -root-dsh-infinite-gen-5- → 包起来得到 --root-dsh-infinite-gen-5--。
	const slug = `-${cwd.replace(/[^a-zA-Z0-9]/g, "-")}-`;
	const dir = path.join(os.homedir(), ".dsh", "sessions", slug);
	if (fs.existsSync(dir)) return dir;
	// 兜底：目录名不完全按上述规则时，退化成前缀匹配，避免整个工具因一条命名规则而不可用。
	const home = path.join(os.homedir(), ".dsh", "sessions");
	const leaf = cwd.split("/").filter(Boolean).join("-");
	if (fs.existsSync(home)) {
		const hit = fs.readdirSync(home).find((d) => d.startsWith("--") && d.includes(leaf));
		if (hit) return path.join(home, hit);
	}
	return dir;
}

function listLogs(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => {
			const p = path.join(dir, d.name, "session.v4.jsonl.zstd");
			return fs.existsSync(p) ? { id: d.name, path: p, bytes: fs.statSync(p).size } : null;
		})
		.filter(Boolean)
		.sort((a, b) => b.bytes - a.bytes);
}

const argv = process.argv.slice(2);
const argOf = (name, dflt = null) => {
	const i = argv.indexOf(name);
	if (i === -1) return dflt;
	const v = argv[i + 1];
	return v && !v.startsWith("--") ? v : true;
};
const outPath = argOf("--out", "/tmp/ig5-live-request.json");
const dir = argOf("--dir", sessionDirOf(process.cwd()));
const maxMessages = Number(argOf("--max-messages", 200)) || 200;
const wanted = argOf("--session", null);

const logs = listLogs(dir);
if (argv.includes("--list") || logs.length === 0) {
	console.log(`会话目录：${dir}`);
	for (const l of logs) console.log(`  ${l.id}  ${(l.bytes / 1048576).toFixed(1)} MiB`);
	if (logs.length === 0) console.log("（没有找到日志）");
	process.exit(0);
}
const target = wanted && wanted !== true ? logs.find((l) => l.id.startsWith(String(wanted))) ?? logs[0] : logs[0];

const text = decompressFramed(fs.readFileSync(target.path));
const lines = text.split("\n").filter(Boolean);
let systemText = "";
let tools = [];
const messages = [];
const pushMsg = (role, content) => {
	if (!role || !content) return;
	if (!messages.length || messages[messages.length - 1].role !== role || messages[messages.length - 1].content.length > 1) messages.push({ role, content: [] });
	messages[messages.length - 1].content.push(content);
};
for (const line of lines) {
	let ev;
	try {
		ev = JSON.parse(line);
	} catch {
		continue;
	}
	const type = ev.type ?? ev.kind ?? "";
	if (/system-prompt|assemble/.test(type)) {
		const s = ev.system ?? ev.text ?? ev.prompt;
		if (typeof s === "string" && Buffer.byteLength(s) > Buffer.byteLength(systemText)) systemText = s;
	} else if (/tool\/(call|result)/.test(type)) {
		const name = ev.name ?? ev.tool ?? "tool";
		const id = ev.id ?? ev.callId ?? ev.toolCallId ?? `call_${messages.length}`;
		const body = typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result ?? ev.output ?? ev.args ?? ev.input ?? "", null, 1);
		pushMsg("assistant", { type: "tool_use", id, name, input: ev.args ?? ev.input ?? {} });
		pushMsg("user", { type: "tool_result", tool_use_id: id, content: body });
	} else if (/user\/message/.test(type) && typeof (ev.text ?? ev.content) === "string") {
		pushMsg("user", { type: "text", text: ev.text ?? ev.content });
	} else if (/assistant\/message/.test(type) && typeof (ev.text ?? ev.content) === "string") {
		pushMsg("assistant", { type: "text", text: ev.text ?? ev.content });
	}
	if (Array.isArray(ev.tools) && ev.tools.length > tools.length) tools = ev.tools;
}
const trimmed = messages.slice(-maxMessages);
const body = {
	model: "TARGET_MODEL",
	stream: true,
	max_tokens: 8192,
	system: systemText || "（日志里没有捕获到 system，占位）",
	tools: tools.length ? tools : [{ name: "bash", description: "占位工具", input_schema: { type: "object" } }],
	messages: trimmed.length ? trimmed : [{ role: "user", content: [{ type: "text", text: "占位当前轮" }] }],
};
fs.writeFileSync(outPath, JSON.stringify(body));
const bytes = (v) => Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v), "utf8");
console.log(`来源：${path.basename(path.dirname(target.path))}`);
console.log(`日志 ${(target.bytes / 1048576).toFixed(1)} MiB → 解出 ${lines.length} 行`);
console.log(`请求体写到 ${outPath}：${bytes(body)} B（system ${bytes(body.system)} B · tools ${bytes(body.tools)} B · messages ${trimmed.length} 条 ${bytes(body.messages)} B）`);
