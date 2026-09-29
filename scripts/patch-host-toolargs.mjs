#!/usr/bin/env node
/**
 * 宿主适配器容错补丁 [ig5-toolargs-patch rev=2]
 *
 * 背景：dsh-llm-deepseek 在 message_stop 里对 tool-call 参数做严格 JSON.parse，
 * 失败就 `malformed("tool input is invalid JSON")` → LlmError("MALFORMED_RESPONSE")。
 * 该 code 不在 dsh-llm 的可重试集合里（EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT），
 * 于是整轮直接死掉、什么都不输出 —— 而下游其实很宽容：
 * dsh-agent-loop 的 parseArguments() 会把非法 JSON 原样当文本交给工具层，模型能看到错误并自纠。
 *
 * 本补丁做三件事：
 *   A. 在 tool-call block 关闭处插入 repairToolArguments()，尽力把「几乎合法」的参数串
 *      （```json 围栏 / 单引号 / 无引号键 / 尾逗号 / 花引号 / 裸换行…）修成合法 JSON 再交给下游。
 *   B. message_stop 的严格预检改为「不掐断」：修不动的包保持原文本，交给下游按文本处理。
 *   C. rev=2 起，修不动的包落一条诊断记录（~/.dsh/llm-deepseek/malformed-toolargs.jsonl）：
 *      工具名 / 参数长度 / 头 200 字 / 尾 200 字 / 正文前 4000 字 —— 事后能指名道姓「是哪个参数」。
 *
 * 用法：
 *   node scripts/patch-host-toolargs.mjs              # 应用（幂等；改前备份；遇到 rev=1 旧补丁先回滚再升级）
 *   node scripts/patch-host-toolargs.mjs --check      # 只检查（已打/未打/语法/自测/行为模拟）
 *   node scripts/patch-host-toolargs.mjs --revert     # 回滚（优先用备份）
 *   node scripts/patch-host-toolargs.mjs --log        # 看最近几条「坏包」诊断
 *   node scripts/patch-host-toolargs.mjs --file PATH  # 指定适配器文件
 * 生效需要重启 DSH 进程（改的是宿主进程代码，不是插件）。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { findPackageDir } from "./lib/host-resolve.mjs";

const MARK = "[ig5-toolargs-patch rev=2]";
const LEGACY_MARKS = ["[ig5-toolargs-patch rev=1]"];
// 宿主布局两种都认（0.1.7 嵌套在 dsh 包内 / 0.2.0 平铺兄弟包）：按包名搜，
// 搜不到才回落到旧的绝对路径（旧路径只作为最后兜底，不再写死为唯一解）。
const LEGACY_LLM_DEEPSEEK = "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js";
const DEFAULT_FILE = (() => {
	const dir = findPackageDir("dsh-llm-deepseek");
	return dir ? path.join(dir, "lib", "index.js") : LEGACY_LLM_DEEPSEEK;
})();
const DSH_HOME = process.env.DSH_HOME ?? path.join(process.env.HOME ?? "/root", ".dsh");
const LOG_FILE = path.join(DSH_HOME, "llm-deepseek", "malformed-toolargs.jsonl");

const argv = process.argv.slice(2);
const mode = argv.includes("--check")
	? "check"
	: argv.includes("--revert")
		? "revert"
		: argv.includes("--log")
			? "log"
			: "apply";
const fileArg = argv.indexOf("--file");
const target = fileArg >= 0 && argv[fileArg + 1] ? path.resolve(argv[fileArg + 1]) : DEFAULT_FILE;

const HELPER = `// ${MARK} 尽力把模型吐出的「几乎合法」参数串修成合法 JSON；修不动返回 void 0，
// 交给下游 agent loop 的 parseArguments() 按文本处理（不再掐断整轮）。
function repairToolArguments(raw) {
	const text = typeof raw === "string" ? raw.trim() : "";
	if (text === "") return void 0;
	const seeds = [];
	const fenced = text.match(/^\`\`\`[A-Za-z0-9_-]*\\s*\\n([\\s\\S]*?)\\n?\`\`\`$/);
	if (fenced !== null && fenced[1] !== void 0) seeds.push(fenced[1].trim());
	seeds.push(text);
	const variants = new Set(seeds);
	for (const seed of seeds) {
		const normalized = seed
			.replace(/[\\u201c\\u201d\\u201e\\u2033]/g, '"')
			.replace(/[\\u2018\\u2019\\u2032]/g, "'")
			.replace(/[\\uff0c\\u3001]/g, ",")
			.replace(/[\\uff1a]/g, ":");
		variants.add(normalized);
		const noTrailing = normalized.replace(/,(\\s*(?:}|]))/g, "$1");
		variants.add(noTrailing);
		const quotedKeys = noTrailing.replace(/([{,]\\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\\s*:)/g, '$1"$2"$3');
		variants.add(quotedKeys);
		const singleToDouble = normalized.replace(/'((?:\\\\.|[^'\\\\])*)'/g, '"$1"');
		variants.add(singleToDouble);
		variants.add(singleToDouble.replace(/,(\\s*(?:}|]))/g, "$1"));
		const flat = normalized.replace(/[\\r\\n\\t]+/g, " ");
		variants.add(flat);
		variants.add(flat.replace(/,(\\s*(?:}|]))/g, "$1"));
		variants.add(quotedKeys.replace(/[\\r\\n\\t]+/g, " "));
	}
	for (const variant of variants) {
		try {
			const value = JSON.parse(variant);
			if (typeof value === "object" && value !== null && !Array.isArray(value)) return JSON.stringify(value);
		} catch {}
	}
	return void 0;
}

// ${MARK} 记下「修不动」的包，供事后定位到底是哪个参数。纯诊断：任何异常都吞掉，
// 绝不反过来掐断整轮；单条最多留 4000 字符正文，另附头尾各 200 字（截断点在哪一眼可见）。
async function logMalformedToolArguments(content) {
	try {
		const dir = join(resolveDshHome(), "llm-deepseek");
		await mkdir(dir, { recursive: true });
		const file = join(dir, "malformed-toolargs.jsonl");
		const raw = typeof content.arguments === "string" ? content.arguments : "";
		let previous = "";
		try {
			previous = await readFile(file, "utf8");
		} catch {}
		await writeFileAtomic(file, previous + JSON.stringify({
			at: new Date().toISOString(),
			tool: typeof content.name === "string" ? content.name : null,
			id: typeof content.id === "string" ? content.id : null,
			length: raw.length,
			head: raw.slice(0, 200),
			tail: raw.slice(-200),
			arguments: raw.slice(0, 4000)
		}) + "\\n");
	} catch {}
}

`;

const BLOCK_END_OLD = "\t\t\t\tif (block.content.type === \"tool-call\" && block.json.length > 0) block.content.arguments = block.json;";
const BLOCK_END_NEW = `\t\t\t\tif (block.content.type === "tool-call" && block.json.length > 0) {
\t\t\t\t\tconst repaired = repairToolArguments(block.json);
\t\t\t\t\t// ${MARK} 修得动就写回合法 JSON（block-end 发的是拷贝，必须在这里改），修不动保留原文本。
\t\t\t\t\tblock.content.arguments = repaired === void 0 ? block.json : repaired;
\t\t\t\t}`;

const STRICT_OLD = `\t\t\tif (reason.kind !== "max-tokens") for (const { content } of blocks.values()) {
\t\t\t\tif (content.type !== "tool-call") continue;
\t\t\t\tlet parsed;
\t\t\t\ttry {
\t\t\t\t\tparsed = JSON.parse(content.arguments);
\t\t\t\t} catch (_invalidProviderToolJson) {
\t\t\t\t\treturn malformed("tool input is invalid JSON");
\t\t\t\t}
\t\t\t\tobject(parsed);
\t\t\t}`;
const STRICT_NEW = `\t\t\tif (reason.kind !== "max-tokens") for (const { content } of blocks.values()) {
\t\t\t\tif (content.type !== "tool-call") continue;
\t\t\t\t// ${MARK} 非法参数不再吃掉整轮：先落诊断（哪个参数），再交给下游当文本处理，模型能自纠。
\t\t\t\tlet parsed;
\t\t\t\ttry {
\t\t\t\t\tparsed = JSON.parse(content.arguments);
\t\t\t\t} catch (_invalidProviderToolJson) {
\t\t\t\t\tawait logMalformedToolArguments(content);
\t\t\t\t\tcontinue;
\t\t\t\t}
\t\t\t\tif (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
\t\t\t}`;

const OBJECT_ANCHOR = "function object(value, code = \"MALFORMED_RESPONSE\") {";

const CASES = [
	{ name: "尾逗号", raw: "{\"a\":1,}", want: { a: 1 } },
	{ name: "单引号", raw: "{'a': 'b', 'c': 2}", want: { a: "b", c: 2 } },
	{ name: "无引号键", raw: "{cmd: \"ls\", args: [1, 2]}", want: { cmd: "ls", args: [1, 2] } },
	{ name: "围栏", raw: "```json\n{\"a\": 1}\n```", want: { a: 1 } },
	{ name: "花引号", raw: "{\u201ca\u201d: 1, \u201cb\u201d: [1, 2]}", want: { a: 1, b: [1, 2] } },
	{ name: "裸换行", raw: "{\"a\": \"line1\nline2\"}", want: { a: "line1 line2" } },
	{ name: "无引号键+尾逗号", raw: "{path: \"/tmp/x\", flag: true,}", want: { path: "/tmp/x", flag: true } },
	{ name: "真坏包 {", raw: "{", want: void 0 },
	{ name: "真坏包 文本", raw: "not json at all", want: void 0 },
	{ name: "数组不是对象", raw: "[\"a\"]", want: void 0 },
	{ name: "空串", raw: "", want: void 0 }
];

const read = () => fs.readFileSync(target, "utf8");
const die = (msg) => {
	console.error(`✗ ${msg}`);
	process.exit(1);
};
const ok = (msg) => console.log(`✓ ${msg}`);

const extractHelper = (source) => {
	const start = source.indexOf("function repairToolArguments(raw) {");
	if (start < 0) return void 0;
	const rest = source.slice(start);
	// 函数体里有 `}` 这类正则字符（/,(?:\s*(?:}|]))/），大括号计数会被骗；改用「独占一行的 }」收尾。
	const end = rest.search(/\n\}\n/);
	if (end < 0) return void 0;
	return rest.slice(0, end + 3);
};

const extractBlockEnd = (source) => {
	const lines = source.split("\n");
	const marker = lines.findIndex((line) => line.includes("const repaired = repairToolArguments(block.json);"));
	if (marker < 1) return void 0;
	// 收尾行按缩进认（块内还有更深的 `}`，比如 try/catch 的闭合行）。
	const end = lines.findIndex((line, index) => index > marker && line === "\t\t\t\t}");
	if (end < 0) return void 0;
	return lines.slice(marker - 1, end + 1).join("\n");
};

const extractMessageStop = (source) => {
	const lines = source.split("\n");
	const start = lines.findIndex((line) => line.includes('reason.kind !== "max-tokens"'));
	if (start < 0) return void 0;
	const end = lines.findIndex((line, index) => index > start && line === "\t\t\t}");
	if (end < 0) return void 0;
	return lines.slice(start, end + 1).join("\n");
};

const runCases = (source) => {
	const src = extractHelper(source);
	if (src === void 0) return ["找不到 repairToolArguments 源码"];
	const fn = new Function(`${src}\nreturn repairToolArguments;`)();
	const bad = [];
	for (const testCase of CASES) {
		const got = fn(testCase.raw);
		if (testCase.want === void 0) {
			if (got !== void 0) bad.push(`${testCase.name}: 期望修不动，却得到 ${got}`);
			continue;
		}
		let parsed;
		try {
			parsed = JSON.parse(got);
		} catch (error) {
			bad.push(`${testCase.name}: 修复结果不是合法 JSON（${error.message}）`);
			continue;
		}
		if (JSON.stringify(parsed) !== JSON.stringify(testCase.want)) bad.push(`${testCase.name}: ${JSON.stringify(parsed)} ≠ ${JSON.stringify(testCase.want)}`);
	}
	return bad;
};

// 从「已打补丁的真实文件」里抽出两段补丁源码，跑行为模拟：
// A. block-end 收到坏包 → 写回合法 JSON（下游拿到的拷贝因此可解析），修不动的保持原文本
// B. message_stop 收到坏包 → 不调用 malformed（旧版会，进而 MALFORMED_RESPONSE 吃掉整轮），且落一条诊断
const simulate = async (source) => {
	const problems = [];
	const helper = extractHelper(source);
	const blockEnd = extractBlockEnd(source);
	const messageStop = extractMessageStop(source);
	if (helper === void 0 || blockEnd === void 0 || messageStop === void 0) return ["抽取补丁片段失败（适配器结构可能已变）"];
	const { repairToolArguments } = new Function(`${helper}\nreturn { repairToolArguments };`)();
	for (const [raw, want] of [["{\"a\":1,}", "{\"a\":1}"], ["{'a': 'b'}", "{\"a\":\"b\"}"], ["{\"a\":1}", "{\"a\":1}"]]) {
		const block = { content: { type: "tool-call" }, json: raw, closed: false };
		new Function("block", "repairToolArguments", blockEnd)(block, repairToolArguments);
		if (block.content.arguments !== want) problems.push(`block-end 修包失败：${JSON.stringify(block.content.arguments)} ≠ ${want}`);
	}
	const badBlock = { content: { type: "tool-call" }, json: "{", closed: false };
	new Function("block", "repairToolArguments", blockEnd)(badBlock, repairToolArguments);
	if (badBlock.content.arguments !== "{") problems.push("block-end 对修不动的包应保留原文本");
	if (!messageStop.includes("await logMalformedToolArguments(content);")) problems.push("message_stop 坏包路径没有落诊断记录");
	const logged = [];
	const malformedCalls = [];
	const runCheck = new Function("blocks", "malformed", "reason", "logMalformedToolArguments", "return (async () => {\n" + messageStop + "\n})();");
	for (const args of ["{\"a\":1,}", "{\"a\":1}", "not json at all", "[\"a\"]", ""]) {
		try {
			await runCheck(
				new Map([["0", { content: { type: "tool-call", name: "bash", arguments: args } }]]),
				(detail) => {
					malformedCalls.push(`${detail} <- ${JSON.stringify(args)}`);
				},
				{ kind: "stop" },
				async (content) => {
					logged.push(content.arguments);
				}
			);
		} catch (error) {
			problems.push(`message_stop 在坏包上抛错：${error.message}`);
		}
	}
	if (malformedCalls.length > 0) problems.push(`message_stop 仍调用 malformed：${malformedCalls.join(" / ")}`);
	for (const args of ["not json at all", "", "{\"a\":1,}"]) {
		if (!logged.includes(args)) problems.push(`坏包未进诊断记录：${JSON.stringify(args)}`);
	}
	// `["a"]` 是合法 JSON（数组），不进 catch、也就不该有诊断记录；下游按文本/数组交给工具层。
	for (const args of ["{\"a\":1}", "[\"a\"]"]) {
		if (logged.includes(args)) problems.push(`合法 JSON 不该进诊断记录：${JSON.stringify(args)}`);
	}
	return problems;
};

const syntaxCheck = (file) => {
	const require = createRequire(import.meta.url);
	const cp = require("node:child_process");
	const result = cp.spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
	return result.status === 0 ? "" : (result.stderr || "").trim();
};

const backupPath = () => {
	const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
	return `${target}.bak-${stamp}`;
};

const newestBackup = () => {
	const dir = path.dirname(target);
	const backups = fs
		.readdirSync(dir)
		.filter((name) => name.startsWith(`${path.basename(target)}.bak-`))
		.sort();
	return backups.length === 0 ? void 0 : path.join(dir, backups[backups.length - 1]);
};

const report = async (state, source) => {
	const cases = state === "applied" ? runCases(source) : [];
	const sims = state === "applied" ? await simulate(source) : [];
	console.log(`状态=${state}  目标=${target}  ${MARK}`);
	if (state === "applied") {
		if (cases.length === 0) ok(`repairToolArguments 自测 ${CASES.length}/${CASES.length} 通过`);
		else cases.forEach((line) => console.error(`  ✗ ${line}`));
		if (sims.length === 0) ok("行为模拟 9/9 通过（block-end 修包/保原 4 例 · message_stop 坏包 5 例不吞整轮且落诊断）");
		else sims.forEach((line) => console.error(`  ✗ ${line}`));
		const syntax = syntaxCheck(target);
		if (syntax === "") ok("node --check 通过");
		else console.error(`  ✗ 语法检查失败：${syntax}`);
		if (source.includes('return malformed("tool input is invalid JSON")')) console.error("  ✗ message_stop 仍会掐断整轮");
		else ok("message_stop 不再因非法参数掐断整轮");
		if (cases.length > 0 || sims.length > 0 || syntax !== "" || source.includes('return malformed("tool input is invalid JSON")')) process.exit(1);
	}
};

const showLog = () => {
	if (!fs.existsSync(LOG_FILE)) {
		console.log(`暂无坏包诊断记录（${LOG_FILE}）`);
		return;
	}
	const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean).slice(-5);
	console.log(`坏包诊断记录（最近 ${lines.length} 条）· ${LOG_FILE}`);
	for (const line of lines) {
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			console.log(`  - （这条记录本身不是合法 JSON，长度 ${line.length}）`);
			continue;
		}
		console.log(`  · ${record.at}  工具=${record.tool ?? "?"}  id=${record.id ?? "?"}  参数长度=${record.length}`);
		console.log(`      头: ${JSON.stringify(record.head)}`);
		console.log(`      尾: ${JSON.stringify(record.tail)}`);
	}
};

if (mode === "log") {
	showLog();
	process.exit(0);
}

if (!fs.existsSync(target)) die(`适配器文件不存在：${target}`);

if (mode === "check") {
	const source = read();
	if (!source.includes(MARK) && LEGACY_MARKS.some((mark) => source.includes(mark))) {
		console.error(`✗ 检测到旧版补丁（${LEGACY_MARKS.join(" / ")}），运行不带参数的本脚本会先回滚再升级到 rev=2`);
		process.exit(1);
	}
	const patched = source.includes(MARK);
	await report(patched ? "applied" : "not-applied", source);
	if (!patched) die("未打补丁");
	process.exit(0);
}

if (mode === "revert") {
	const newest = newestBackup();
	const source = read();
	if (newest === void 0) {
		if (!source.includes(MARK) && !LEGACY_MARKS.some((mark) => source.includes(mark))) die("未打补丁且没有备份，无需回滚");
		const restored = source
			.replace(HELPER, "")
			.replace(BLOCK_END_NEW, BLOCK_END_OLD)
			.replace(STRICT_NEW, STRICT_OLD);
		fs.writeFileSync(target, restored);
		ok("按补丁内容反向还原（无备份可用）");
	} else {
		fs.copyFileSync(newest, target);
		ok(`从备份还原：${newest}`);
	}
	const syntax = syntaxCheck(target);
	if (syntax !== "") die(`还原后语法检查失败：${syntax}`);
	await report("reverted", read());
	process.exit(0);
}

let source = read();
const legacy = LEGACY_MARKS.filter((mark) => source.includes(mark));
if (!source.includes(MARK) && legacy.length > 0) {
	// 旧版补丁在盘上：先按备份回到原版，再打 rev=2（避免两代补丁叠在一起）。
	const newest = newestBackup();
	if (newest === void 0) die(`盘上是旧版补丁（${legacy.join(" / ")}）但没有备份，请先手工还原适配器文件`);
	fs.copyFileSync(newest, target);
	ok(`检测到旧版补丁（${legacy.join(" / ")}），已从备份还原：${newest}`);
	source = read();
}
if (source.includes(MARK)) {
	await report("applied", source);
	ok("已打过补丁，幂等跳过");
	process.exit(0);
}
if (!source.includes(OBJECT_ANCHOR)) die(`找不到插入锚点：${OBJECT_ANCHOR}`);
if (!source.includes(BLOCK_END_OLD)) die("找不到 block-end 赋值锚点（适配器结构可能已变）");
if (!source.includes(STRICT_OLD)) die("找不到 message_stop 预检锚点（适配器结构可能已变）");
for (const name of ["join", "resolveDshHome", "mkdir", "readFile", "writeFileAtomic"]) {
	if (!source.includes(name)) die(`适配器缺少诊断记录所需的导入：${name}`);
}

const before = fs.statSync(target);
const backup = backupPath();
fs.copyFileSync(target, backup);
const next = source
	.replace(OBJECT_ANCHOR, HELPER + OBJECT_ANCHOR)
	.replace(BLOCK_END_OLD, BLOCK_END_NEW)
	.replace(STRICT_OLD, STRICT_NEW);
fs.writeFileSync(target, next);
ok(`已应用补丁：${backup} → ${target}（${before.size} → ${fs.statSync(target).size} B）`);
report("applied", next);
