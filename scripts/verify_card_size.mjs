#!/usr/bin/env node
/**
 * 浮层判决卡片的「整体大小」锚点。
 *
 * 为什么需要它：`verify_ui.mjs` 那套锚点跑在假 DOM 上，只能断言「样式表里写了哪些值」，
 * 管不住「写出来的东西合起来有多高」。v0.19.0 把卡片从 487px 压到 353px（−27.5%），
 * 如果只钉单条规则，别人把三条间距各自改回去一点，规则断言全绿、卡片却胖回去了。
 * 这个脚本把真实渲染尺寸钉成一个带宽：面板高度必须在 [H_MIN, H_MAX] 内。
 *
 * v0.19.0 定稿（也是唯一真源）：
 *   高 353px · 宽 264px（`--window-size=470,760` 下的实测值）
 * 带宽 ±约 5%：字体/抗锯齿的细微差异放行，回退到压缩前的任一版（398 / 487）立刻红。
 *
 * 浏览器查找顺序：`IG5_CHROME` > playwright 缓存 > PATH 里的 chromium / chrome。
 * 找不到浏览器 → 打印 ⚠ 并以 0 退出（环境缺失不算排版回归，但会在输出里显形）。
 *
 * 用法：node scripts/verify_card_size.mjs [--file <preview.html>] [--quiet]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const H_MIN = 335;
const H_MAX = 371;
const W_MIN = 250;
const W_MAX = 292;
const CARD_SECTIONS = 2;

const argv = process.argv.slice(2);
const getArg = (name) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : "";
};
const quiet = argv.includes("--quiet");
const log = (...parts) => {
	if (!quiet) console.log(...parts);
};

let failures = 0;
let checks = 0;
const ok = (name, pass, detail = "") => {
	checks += 1;
	if (!pass) failures += 1;
	console.log(`${pass ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};

function findChrome() {
	const fromEnv = process.env.IG5_CHROME;
	if (fromEnv && existsSync(fromEnv)) return fromEnv;
	const cacheRoot = join(process.env.HOME || "/root", ".cache", "ms-playwright");
	if (existsSync(cacheRoot)) {
		const dirs = readdirSync(cacheRoot)
			.filter((name) => name.startsWith("chromium-"))
			.sort()
			.reverse();
		for (const dir of dirs) {
			for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
				const candidate = join(cacheRoot, dir, rel);
				if (existsSync(candidate)) return candidate;
			}
		}
	}
	for (const bin of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"]) {
		const found = spawnSync("command", ["-v", bin], { shell: true, encoding: "utf8" });
		if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
	}
	return "";
}

// 预览页里有整页示例（§1…§5），只留卡片那两节，量出来的才是卡片本身。
const INJECT =
	'<style>body > *:not(:nth-child(9)):not(:nth-child(10)){display:none !important}' +
	'body{padding:10px 12px 16px !important;margin:0 !important}</style>' +
	'<script>window.addEventListener("load",function(){' +
	'var p=document.querySelector(".dsh-armor5-panel");var r=p?p.getBoundingClientRect():null;' +
	'document.title="MEAS h="+(r?Math.round(r.height):-1)+" w="+(r?Math.round(r.width):-1);});</script></head>';

function buildPreview() {
	const dir = mkdtempSync(join(tmpdir(), "ig5-cardsize-"));
	const target = join(dir, "preview.html");
	const run = spawnSync(process.execPath, ["scripts/verify_ui.mjs", "--emit-html", target], {
		cwd: ROOT,
		encoding: "utf8"
	});
	if (run.status !== 0) {
		console.log("✗ 预览页生成失败：" + (run.stderr || run.stdout || "").trim().split("\n").slice(-3).join(" | "));
		process.exit(1);
	}
	return (run.stdout.match(/[\w./-]*preview-light\.html/) || [target.replace(/preview\.html$/, "preview-light.html")])[0];
}

function measure(chrome, htmlPath) {
	const source = resolve(htmlPath);
	const scoped = join(tmpdir(), "ig5-cardsize-" + Buffer.from(source).toString("hex").slice(0, 24) + ".html");
	writeFileSync(scoped, readFileSync(source, "utf8").replace("</head>", INJECT, 1));
	const run = spawnSync(
		chrome,
		[
			"--headless",
			"--no-sandbox",
			"--disable-gpu",
			"--disable-dev-shm-usage",
			"--hide-scrollbars",
			"--window-size=470,760",
			"--virtual-time-budget=4000",
			"--dump-dom",
			"file://" + scoped
		],
		{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
	);
	const title = (run.stdout || "").match(/<title>MEAS h=(-?\d+) w=(-?\d+)<\/title>/);
	return title ? { h: Number(title[1]), w: Number(title[2]) } : null;
}

console.log("浮层卡片整体尺寸锚点（v0.19.0 定稿：高 353px / 宽 264px）");
const chrome = findChrome();
if (!chrome) {
	console.log("⚠ 本机没找到 Chromium（设 IG5_CHROME 或让 playwright 缓存就位），跳过尺寸量测 —— 不是排版回归，但这次没量到。");
	console.log(`尺寸锚点：0 通过 / 0 失败（跳过 ${CARD_SECTIONS} 项）`);
	process.exit(0);
}
log("  浏览器=" + chrome);
const htmlPath = getArg("--file") || buildPreview();
const box = measure(chrome, htmlPath);
if (!box) {
	ok("能测到卡片渲染尺寸", false, "注入量测脚本后没读回 <title>MEAS …>（预览页结构变了？）");
	console.log(`尺寸锚点：${checks - failures} 通过 / ${failures} 失败`);
	process.exit(1);
}
ok(`能测到卡片渲染尺寸（h=${box.h} w=${box.w}）`, box.h > 0 && box.w > 0);
ok(`面板高度在 [${H_MIN}, ${H_MAX}] 内（定稿 353px）`, box.h >= H_MIN && box.h <= H_MAX, `实测 ${box.h}px`);
ok(`面板宽度不超过 ${W_MAX}px（窄屏靠 min() 自适应）`, box.w > 0 && box.w <= W_MAX, `实测 ${box.w}px`);
ok(`面板宽度不小于 ${W_MIN}px（别压到内容折行）`, box.w >= W_MIN, `实测 ${box.w}px`);
console.log(`尺寸锚点：${checks - failures} 通过 / ${failures} 失败`);
process.exit(failures === 0 ? 0 : 1);
