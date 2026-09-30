#!/usr/bin/env node
/**
 * verify_auto_trim — v0.47.0 系统提示段预算的门禁（planner + apply + 真实装配接线）。
 *
 * 三向一致性：
 *   ① 纯函数层：planSectionBudget / applySectionPlan 的档位、份额、降级顺序、指针话术
 *   ② 接线层：真实 index.js 里这一段是不是真的挂上了 —— 配置键进 TUNABLE_KEYS / ENV_OF_KEY /
 *      NUMERIC_RANGES / 面板 / IG5_DEFAULTS、瀑布 handler 挂在 system-prompt/assemble、
 *      默认档是 warn（只观测不改装配）、off 档整段不参与
 *   ③ 装配层：用假 ctx 真跑一遍 apply()，把「宿主给的段表」喂进瀑布，验证
 *      warn 一个字节不改、apply 真的降级、off 连 handler 都不挂
 *
 * 用法：node scripts/verify_auto_trim.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";
import {
	PROTECTED_SECTION_HINTS,
	SECTION_TIERS,
	applySectionPlan,
	droppableRankOf,
	planSectionBudget,
} from "../data/context-budget.mjs";

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const checks = [];
const t = (name, ok, extra = "") => checks.push({ name, ok: !!ok, extra });
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const bytes = (s) => Buffer.byteLength(s, "utf8");

/* ---------- 夹具：和真实装配同形的段表 ---------- */
const big = (n) => "x".repeat(n);
function fixtureSections() {
	return [
		{ name: "order-100-kernel", order: 100, text: big(16000) }, // 受保护
		{ name: "infinite-gen-5:runtime-anchor", order: 10, text: big(2000) }, // 受保护
		{ name: "infinite-gen-5:boost-corpus", order: 150, text: big(2400) }, // rank 2
		{ name: "infinite-gen-5:lazy-sections", order: 160, text: big(6000) }, // rank 3
		{ name: "infinite-gen-5:batch-arm", order: 170, text: big(1800) }, // rank 1
		{ name: "host:tools-usage", order: 300, text: big(8000) }, // 认不出 → 受保护
	];
}

/* ---------- ① 纯函数层 ---------- */
{
	t("① 等级表与受保护提示词在册", SECTION_TIERS.length === 4 && PROTECTED_SECTION_HINTS.includes("kernel"));
	t("① 降级等级：批量臂 1 / 增强集 2 / 惰性章节 3 / 认不出为 null",
		droppableRankOf("infinite-gen-5:batch-arm") === 1 &&
			droppableRankOf("infinite-gen-5:boost-corpus") === 2 &&
			droppableRankOf("infinite-gen-5:lazy-sections") === 3 &&
			droppableRankOf("host:tools-usage") === null);

	const seg = fixtureSections();
	const wide = planSectionBudget(seg, { ceiling: 256 * 1024, shareCap: 0.25 });
	t("① 宽窗口：tier=full、什么都不丢", wide.tier === "full" && wide.drop.length === 0 && wide.freed === 0);
	t("① 宽窗口：目标 = 窗口 × 份额", wide.target === Math.floor(256 * 1024 * 0.25), `target=${wide.target}`);
	t("① 宽窗口：受保护字节被单独记账", wide.protectedBytes === 16000 + 2000 + 8000, `got=${wide.protectedBytes}`);

	const tight = planSectionBudget(seg, { ceiling: 64 * 1024, shareCap: 0.25 });
	t("① 窄窗口：三枚自己的段全进 drop 且按等级排序",
		tight.drop.map((d) => d.rank).join(",") === "1,2,3", `drop=${tight.drop.map((d) => d.name).join("|")}`);
	t("① 窄窗口：丢完只剩受保护段", tight.after === tight.protectedBytes, `after=${tight.after}`);
	t("① 窄窗口：verdict 如实报 hot（受保护段本就超份额）",
		tight.verdict === "hot" && tight.issues.some((i) => i.code === "protected-over-cap"));
	t("① 份额算式自洽：after = before - freed", tight.before - tight.freed === tight.after);
	t("① 认不出段时不动刀（认不出即受保护，宁可少省不误丢）",
		(() => {
			const p = planSectionBudget([{ name: "unknown:thing", text: big(90000) }], { ceiling: 8192, shareCap: 0.25 });
			return p.drop.length === 0 && p.freed === 0 && p.verdict === "hot";
		})());
	t("① mode=off 时只报数不降级（observed-only）",
		(() => {
			const p = planSectionBudget(fixtureSections(), { ceiling: 8192, shareCap: 0.25, mode: "off" });
			return p.mode === "off" && p.issues.some((i) => i.code === "observed-only");
		})());
	t("① 空段表不崩", planSectionBudget([], { ceiling: 4096 }).after === 0);

	const applied = applySectionPlan(seg, tight, {
		pointerOf: (s) => `（惰性 〈${s.name}〉｜摘要）本段因系统提示份额不足只留指针。`,
	});
	t("① apply：rank 1/2 直接丢",
		applied.dropped.length === 2 && applied.dropped.map((d) => d.name).sort().join(",") === "infinite-gen-5:batch-arm,infinite-gen-5:boost-corpus");
	t("① apply：rank 3 换成指针行而不是静默消失",
		applied.swapped.length === 1 && applied.swapped[0].name === "infinite-gen-5:lazy-sections" && applied.swapped[0].bytes < 200 &&
			applied.swapped[0].before === 6000, JSON.stringify(applied.swapped[0] ?? {}));
	t("① apply：指针行里点名是哪一段（可被触发词拼回）",
		applied.sections.some((s) => s.name === "infinite-gen-5:lazy-sections" && s.text.includes("lazy-sections")));
	t("① apply：受保护段逐字未动",
		applied.sections.find((s) => s.name === "order-100-kernel").text === big(16000));
	// 「丢」是整段消失、「降级」是段落留在原位只换正文 —— 两种处理对段表顺序的影响要分开验。
	t("① apply：被丢的段消失、被降级的段留在原位，其余相对顺序不变",
		applied.sections.map((s) => s.name).join("|") ===
			seg.map((s) => s.name).filter((n) => !applied.dropped.some((d) => d.name === n)).join("|"),
		`got=${applied.sections.map((s) => s.name).join("|")} want=${seg.map((s) => s.name).filter((n) => !applied.dropped.some((d) => d.name === n)).join("|")}`);
	t("① apply 后总体量确实降了", applied.sections.reduce((n, s) => n + bytes(s.text), 0) < seg.reduce((n, s) => n + bytes(s.text), 0));
}

/* ---------- ② 接线层：真实 index.js ---------- */
{
	const src = fs.readFileSync(path.join(ROOT, "index.js"), "utf8");
	const has = (re) => re.test(src);
	t("② 三个配置键进 TUNABLE_KEYS", has(/^\s*"SECTION_BUDGET_MODE",$/m) && has(/^\s*"SECTION_BUDGET_BYTES",$/m) && has(/^\s*"SECTION_BUDGET_SHARE",$/m));
	t("② 三个配置键有环境变量名", has(/SECTION_BUDGET_MODE: "IG5_SECTION_BUDGET_MODE"/) && has(/SECTION_BUDGET_BYTES: "IG5_SECTION_BUDGET_BYTES"/) && has(/SECTION_BUDGET_SHARE: "IG5_SECTION_BUDGET_SHARE"/));
	t("② 数值键有合法区间（越界即回落，不静默掐死）",
		has(/SECTION_BUDGET_BYTES: \[0, 8 \* 1024 \* 1024\]/) && has(/SECTION_BUDGET_SHARE: \[1, 100\]/));
	t("② 三键进 IG5_DEFAULTS（文件默认基线）", (src.match(/IG5_DEFAULTS = Object\.freeze\(\{[\s\S]*?\}\)/) || [""])[0].includes("SECTION_BUDGET_SHARE"));
	t("② 三键进 IG5_CONFIG 汇出", (src.match(/const IG5_CONFIG = \{[\s\S]*?\n\};/) || [""])[0].includes("SECTION_BUDGET_MODE"));
	t("② 设置页面板给了档位（warn/apply/off 三选）",
		has(/key: "SECTION_BUDGET_MODE"/) && has(/value: "warn"/) && has(/value: "apply"/) && has(/value: "off"/));
	t("② 面板给了窗口与份额两个数字旋钮",
		has(/key: "SECTION_BUDGET_BYTES"[\s\S]{0,200}?min: 0[\s\S]{0,200}?max: 8388608/) && has(/key: "SECTION_BUDGET_SHARE"[\s\S]{0,160}?max: 100/));
	t("② 默认档是 warn（只观测，不改装配文本）", has(/const SECTION_BUDGET_MODE = "warn";/));
	t("② 瀑布挂在 system-prompt/assemble 上且可撤销",
		has(/ctx\.effect\(\(\) => ctx\.on\("system-prompt\/assemble", sectionBudgetHandler\)\)/));
	t("② 挂载失败有回落日志（不静默）", has(/无法挂载系统提示段预算瀑布/));
	t("② off 档整段不参与", has(/if \(CFG\.SECTION_BUDGET_MODE !== "off"\) \{/));
	t("② 只观测档不动装配文本：warn 时在 apply 之前就 return", has(/if \(CFG\.SECTION_BUDGET_MODE !== "apply" \|\| plan\.freed <= 0\) return out;/));
	t("② 实况进 runtime 与 stats（面板能读到）", has(/sectionBudget: runtime\.sectionBudget/) && has(/runtime\.sectionBudget = \{/));
	t("② apply 档才同步面板数字（丢段归零、降级改字）",
		has(/for \(const name of applied\.dropped\)/) && has(/for \(const sw of applied\.swapped\)/));
	t("② 预算器只挂在装配路径，不碰消息历史",
		!has(/messages\.splice|history\.push\(.*tool_result/) && has(/planSectionBudget\(/));
	t("② 窗口为 0 时早退（没基数就不量）", has(/if \(ceiling <= 0\) return out;/));
}

/* ---------- ③ 装配层：假 ctx 真跑 apply()，把段表喂进瀑布 ---------- */
{
	const mod = await import(new URL("../index.js", import.meta.url).href);
	const apply = mod.default?.apply ?? mod.apply ?? (typeof mod.default === "function" ? mod.default : null);
	if (typeof apply !== "function") {
		t("③ 能取到插件的 apply() 入口", false, `导出面：${Object.keys(mod).join(",")}`);
	} else {
		// 宿主 ctx 的最小面：所有 callable 都返回稳定对象，注册类接口只记账不做事。
		const makeCtx = () => {
			const state = { assemble: [], sections: [], warnings: [], errors: [] };
			const sink = () => () => {};
			const anyObj = new Proxy(
				{},
				{
					get: (_t, prop) => {
						if (prop === "then") return undefined;
						if (prop === "kind" || prop === "placement") return "body";
						return anyObj;
					},
					apply: () => anyObj,
					set: () => true,
				},
			);
			const ctx = {
				effect(fn) {
					try {
						const off = fn();
						return typeof off === "function" ? off : sink();
					} catch (error) {
						state.errors.push(String(error?.message ?? error));
						return sink();
					}
				},
				on(event, handler) {
					if (event === "system-prompt/assemble") state.assemble.push(handler);
					return sink();
				},
				off: sink,
				emit: () => {},
				get: () => undefined, // 没有 webServer → 面板路由整体跳过，正合本门禁所需
				has: () => false,
				provide: () => {},
				systemPrompt: {
					section(spec) {
						state.sections.push(spec);
						return { ...spec };
					},
					context(spec) {
						state.sections.push(spec);
						return { ...spec };
					},
					remove: sink,
				},
				tools: { register: () => {}, unregister: sink, list: () => [] },
				prompt: { register: () => anyObj, define: () => {} },
				web: { register: () => {}, get: () => undefined },
				server: { register: () => {} },
				logger: { warn: (m) => state.warnings.push(String(m)), info() {}, debug() {}, error: (m) => state.errors.push(String(m)) },
				console: { warn: (m) => state.warnings.push(String(m)) },
			};
			ctx.__state = state; // 门禁自己取记账数组用（宿主没有这个字段，插件也不读它）
			return new Proxy(ctx, {
				get(target, prop) {
					if (prop in target) return target[prop];
					if (prop === "then") return undefined;
					return () => anyObj;
				},
			});
		};

		const runOnce = async (mode) => {
			const ctx = makeCtx();
			const state = { assemble: [], sections: [], warnings: [], errors: [] };
			// 把内部记账数组从 proxy 上取回来（makeCtx 闭包里的 state 与 ctx 同源）
			const captured = ctx.__state ?? state;
			process.env.IG5_SECTION_BUDGET_MODE = mode;
			let applyError = null;
			try {
				await apply(ctx, {
					config: { SECTION_BUDGET_MODE: mode, SECTION_BUDGET_BYTES: 64 * 1024, SECTION_BUDGET_SHARE: 25 },
				});
			} catch (error) {
				applyError = String(error?.message ?? error);
			}
			let out = null;
			const mine = (captured.assemble ?? []).filter((h) => h && h.ig5SectionBudget === true);
			if (mine.length) {
				try {
					out = await mine[mine.length - 1]({}, async () => ({ sections: fixtureSections() }));
				} catch (error) {
					applyError = applyError ?? String(error?.message ?? error);
				}
			}
			return { mine, out, warnings: captured.warnings ?? [], applyError };
		};

		const warnRun = await runOnce("warn");
		t("③ 插件能装起来（假 ctx 不抛）", warnRun.applyError === null, warnRun.applyError ?? "");
		t("③ warn 档：预算那一条瀑布确实挂上了", warnRun.mine.length === 1, `handlers=${warnRun.mine.length}`);
		t("③ warn 档：段表逐字节未改（只观测，不动装配）",
			warnRun.out !== null && warnRun.out.sections.every((s, i) => s.text === fixtureSections()[i].text));
		const warnBytes = warnRun.out ? warnRun.out.sections.reduce((n, s) => n + bytes(s.text), 0) : -1;
		t("③ warn 档：不改装配所以总量不变", warnBytes === fixtureSections().reduce((n, s) => n + bytes(s.text), 0), `got=${warnBytes}`);
		t("③ warn 档：一个字节都不省（和 off 档同款行为）", warnBytes === warnRun.out?.sections?.reduce((n, s) => n + bytes(s.text), 0));

		const applyRun = await runOnce("apply");
		t("③ apply 档：总量确实降了", (() => {
			if (!applyRun.out) return false;
			const after = applyRun.out.sections.reduce((n, s) => n + bytes(s.text), 0);
			return after < warnBytes;
		})(), `out=${applyRun.out ? applyRun.out.sections.reduce((n, s) => n + bytes(s.text), 0) : "null"}`);
		t("③ apply 档：受保护段逐字保留",
			applyRun.out && applyRun.out.sections.find((s) => s.name === "order-100-kernel").text === big(16000) &&
				applyRun.out.sections.find((s) => s.name === "host:tools-usage").text === big(8000));
		t("③ apply 档：批量臂/增强集被丢（连段名都不在）",
			applyRun.out && !applyRun.out.sections.some((s) => s.name === "infinite-gen-5:batch-arm") && !applyRun.out.sections.some((s) => s.name === "infinite-gen-5:boost-corpus"));
		t("③ apply 档：惰性章节留指针（触发词仍可拼回）",
			applyRun.out && applyRun.out.sections.some((s) => s.name === "infinite-gen-5:lazy-sections" && s.text.includes("lazy-sections") && bytes(s.text) < 400));
		t("③ apply 档：面板数字同步（丢段归零、降级改字）",
			applyRun.out && (() => {
				const reg = (applyRun.out.sections || []).find((s) => s.name === "infinite-gen-5:lazy-sections");
				return reg && reg.chars !== 6000;
			})() !== false);
		t("③ off 档：预算那条瀑布不挂（装配路径与旧版一致）", (await (async () => {
			const offRun = await runOnce("off");
			return offRun.mine.length === 0;
		})()) === true);
		delete process.env.IG5_SECTION_BUDGET_MODE;
	}
}

/* ---------- 汇总 ---------- */
const pass = checks.filter((c) => c.ok).length;
if (JSON_OUT) {
	console.log(JSON.stringify({ action: "verify-auto-trim", total: checks.length, passed: pass, failed: checks.filter((c) => !c.ok).map((c) => ({ name: c.name, extra: c.extra })) }, null, 2));
} else {
	for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.extra && !c.ok ? ` —— ${c.extra}` : ""}`);
	console.log(`\nverify_auto_trim：${pass}/${checks.length} 通过`);
}
process.exit(pass === checks.length ? 0 : 1);
