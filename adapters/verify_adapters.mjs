#!/usr/bin/env node
// 验证件：把「四查」变成可跑判据。与 build-adapters.mjs 共用同一套 lib，
// 避免出现「构建口径」和「验证口径」两套事实（那正是漂移的起点）。
//
// 用法：
//   node verify_adapters.mjs                 # 全量校验，逐项打印
//   node verify_adapters.mjs --json          # 末尾一行机器可读摘要
//   node verify_adapters.mjs --truth <dir>   # 覆盖真源目录
//   node verify_adapters.mjs --data  <dir>   # 覆盖数据目录
//
// 退出码：0 = 全过；1 = 有失败项。

import { resolveKernelRoot } from "./lib/kernel-root.mjs";
import { readFileSync, existsSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MANAGED_KEY,
  STATE_FILE,
  DEFAULT_NAME,
  CARRIER_CAP_BYTES,
  readTopLevelAssignment,
  setTopLevelAssignment,
  removeTopLevelAssignment,
  readState,
  planDeploy,
  applyDeploy,
  resetDeploy,
  buildZip,
  readZipEntries,
  main as deployMain,
} from "./codex-deploy.mjs";

import { validateAdapter, compileFlags, CAPS, CHANNEL_CAPS, DEGRADE } from "./lib/adapter-spec.mjs";
import {
  kernelSignature,
  checkKernelIntegrity,
  normalizeKernel,
  VOLATILE_PATTERNS,
  sha256,
} from "./lib/kernel-signature.mjs";
import { parseDomains, parseFamilies, renderDomainIndex, domainIndexStats } from "./lib/domain-index.mjs";
import { GATES, buildArtifact, serializeArtifact, verifyArtifact, identityOf } from "./lib/release-artifact.mjs";
import { buildOne, readSources, readDomainIndex, TARGETS, DEFAULT_TRUTH, DEFAULT_DATA } from "./build-adapters.mjs";
import { adapter as apiAdapter, layout as apiLayout, messagesFor, REQUEST_FILE, WIRE_SHAPE } from "./targets/api-endpoint.mjs";
import { resolveRelay, redact, RELAY_SCHEMA } from "./lib/provider-api.mjs";
import { receiptFor, idsIn, MOCK_VERSION } from "./mock-endpoint.mjs";
import { skillsPlan } from "./build-skills.mjs";
import { NON_DEROGABLE, classifyBlock, SKILL_BUDGET_CHARS } from "./lib/skill-chain.mjs";
import { adaptPlan, selectLazyUnits, buildTurn } from "./lib/dynamic-adapt.mjs";
import { parseLazyUnits } from "./lib/kernel-compiler.mjs";
import {
  registerAdaptiveInjection,
  readAdaptCache,
  writeAdaptCache,
  renderAdaptDirective,
  renderTurnInject,
} from "./ig5-relay-plugin.mjs";

// 分发内核是只读外部依赖：缺它就明确标失败，而不是让整份验证崩掉。
const KERNEL_DIR = resolveKernelRoot();
const KERNEL_FILE = join(KERNEL_DIR, "dispatch.mjs");
const dispatchApi = existsSync(KERNEL_FILE) ? await import(`${pathToFileURL(KERNEL_FILE).href}`) : null;

const HERE = dirname(fileURLToPath(import.meta.url));

// ── 极小的断言框架：每条判据都带 id、门禁归属、判据文本 ────────────────────────
const results = [];
function check(id, gate, claim, fn) {
  let ok = false;
  let detail = "";
  try {
    const r = fn();
    if (r === true) ok = true;
    else if (r && typeof r === "object") {
      ok = Boolean(r.ok);
      detail = r.detail ?? "";
    } else {
      ok = false;
      detail = String(r ?? "");
    }
  } catch (err) {
    ok = false;
    detail = `抛错：${err.message}`;
  }
  results.push({ id, gate, claim, ok, detail });
  return ok;
}

function parseArgs(argv) {
  const args = { json: false, truth: DEFAULT_TRUTH, data: DEFAULT_DATA };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--truth") args.truth = argv[++i];
    else if (argv[i] === "--data") args.data = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const truth = resolve(args.truth);
const dataDir = resolve(args.data);

const names = Object.keys(TARGETS);
const domainIndex = readDomainIndex(dataDir);
const sources = readSources(truth);

// 真源指纹：所有通道必须同源，否则「一份内核多宿主」这个前提就不成立了
const signature = kernelSignature({ primary: sources.primary, lazy: sources.lazy });
const loads = {};
for (const name of names) loads[name] = buildOne(name, TARGETS[name], truth, domainIndex);

// ── A 级：静态门禁 ───────────────────────────────────────────────────────────
check("A1", "A", "四条通道的适配器契约全部通过 validateAdapter", () => {
  const bad = names.filter((n) => buildOne(n, TARGETS[n], truth, domainIndex).errors.length);
  return { ok: bad.length === 0, detail: bad.length ? `不合格：${bad.join(", ")}` : "" };
});

check("A2", "A", "公共层源码不含任何宿主名（注释与字符串示例除外）", () => {
  const hostWords = [/\bdsh\b/i, /\bcodex\b/i, /\bclaude\b/i, /openai/i, /anthropic/i];
  const files = ["lib/adapter-spec.mjs", "lib/kernel-compiler.mjs", "lib/kernel-signature.mjs", "lib/domain-index.mjs", "lib/release-artifact.mjs"];
  const hits = [];
  for (const f of files) {
    const lines = readFileSync(join(HERE, f), "utf8").split("\n");
    let inBlock = false;
    lines.forEach((raw, i) => {
      let line = raw;
      // 去掉块注释与行注释后再判：注释里点名宿主是文档，不是耦合
      if (inBlock) {
        const end = line.indexOf("*/");
        if (end === -1) return;
        line = line.slice(end + 2);
        inBlock = false;
      }
      const open = line.indexOf("/*");
      if (open !== -1) {
        const end = line.indexOf("*/", open + 2);
        if (end === -1) {
          line = line.slice(0, open);
          inBlock = true;
        } else {
          line = line.slice(0, open) + line.slice(end + 2);
        }
      }
      const slash = line.indexOf("//");
      if (slash !== -1) line = line.slice(0, slash);
      if (hostWords.some((re) => re.test(line))) hits.push(`${f}:${i + 1}`);
    });
  }
  return { ok: hits.length === 0, detail: hits.length ? `命中代码行：${hits.join(", ")}` : "" };
});

check("A3", "A", "同输入两次构建字节一致（幂等）", () => {
  const a = buildOne("generic", TARGETS.generic, truth, domainIndex);
  const b = buildOne("generic", TARGETS.generic, truth, domainIndex);
  const sa = a.written.map((f) => `${f.path}:${f.sha256}`).join("|");
  const sb = b.written.map((f) => `${f.path}:${f.sha256}`).join("|");
  return { ok: sa === sb, detail: sa === sb ? "" : "两次构建哈希不同" };
});

check("A4", "A", "每个适配器的 caps 与其 channel 一致，且预算为正整数", () => {
  const bad = [];
  for (const name of names) {
    const a = TARGETS[name].adapter;
    const allowed = CHANNEL_CAPS[a.channel] ?? [];
    const extra = a.caps.filter((c) => !allowed.includes(c));
    if (extra.length) bad.push(`${name}: 通道 ${a.channel} 不支持 ${extra.join(",")}`);
    for (const k of ["kernelBytes", "indexBytes", "lazyBudgetBytes", "totalBytes"]) {
      // lazyBudgetBytes 允许为 0：宿主不装载惰性章节时，预算本来就该是 0。
      const allowZero = k === "lazyBudgetBytes" || k === "indexBytes";
      if (!Number.isInteger(a.budget[k]) || a.budget[k] < 0 || (!allowZero && a.budget[k] <= 0))
        bad.push(`${name}: budget.${k} 非法（${a.budget[k]}）`);
    }
    // 惰性装载开着却没有预算 → 惰性章节永远装不上，是静默失效
    if (compileFlags(a).lazyEnabled && a.budget.lazyBudgetBytes <= 0) bad.push(`${name}: 惰性装载开但 lazyBudgetBytes=0`);
    // 内嵌索引通道必须有 indexBytes 预算，否则索引是「无上限」的
    if (!compileFlags(a).domainViaTool && a.budget.indexBytes <= 0) bad.push(`${name}: 内嵌索引但 indexBytes<=0`);
  }
  return { ok: bad.length === 0, detail: bad.join("；") };
});

check("A5", "A", "降级动作表与八能力位一一对应，且缺 assemble 时明文禁止宣称末位", () => {
  const missing = CAPS.filter((c) => !DEGRADE[c]);
  const extra = Object.keys(DEGRADE).filter((k) => !CAPS.includes(k));
  const noAssemble = DEGRADE.systemPromptAssemble ?? "";
  const bansTailClaim = /不得宣称末位|不得宣称「末位」/.test(noAssemble);
  const bad = [];
  if (missing.length) bad.push(`缺降级动作：${missing.join(",")}`);
  if (extra.length) bad.push(`多出非能力位键：${extra.join(",")}`);
  if (!bansTailClaim) bad.push("systemPromptAssemble 的降级措辞未明文禁止宣称末位");
  return { ok: bad.length === 0, detail: bad.join("；") };
});

check("A6", "A", "落点触达面：开惰性装载的通道必须持有 systemPromptAssemble；能力位表里不得出现技能位", () => {
  // 这条判据守的是「内容该落在哪个落点」这件事本身。判据是「凭什么」而不是「只有谁」：
  // 惰性段（Order 160）能省字节，前提是宿主有组装瀑布把命中章节拼回去；没有这条能力位的
  // 通道把内容搬进惰性段，不是省字节而是净丢失（build 时 lazyEnabled=false，一个字都不装）。
  // 技能层（宿主 <root>/<name>/SKILL.md）由宿主侧装载器读取，不进 system prompt、不占
  // residentBytes —— 所以 CAPS 里不该有技能位；一旦出现，说明契约层把「加技能」误接成了
  // 「减常驻」，那是两个落点被混成一个。
  const bad = [];
  const lazyOn = [];
  for (const name of names) {
    const a = TARGETS[name].adapter;
    if (!compileFlags(a).lazyEnabled) continue;
    lazyOn.push(name);
    if (!a.caps.includes("systemPromptAssemble"))
      bad.push(`${name}: 开了惰性装载却没有 systemPromptAssemble —— 惰性章节装不上，是静默失效`);
  }
  const skillCap = CAPS.filter((c) => /skill/i.test(c));
  if (skillCap.length) bad.push(`能力位表出现技能位 ${skillCap.join(",")} —— 技能层不经注入通道`);
  return {
    ok: bad.length === 0,
    detail: bad.length ? bad.join("；") : `惰性装载 ${lazyOn.join(",") || "无"}（均持有 systemPromptAssemble）；能力位 ${CAPS.length} 项无技能位`,
  };
});

// ── B 级：行为门禁 ───────────────────────────────────────────────────────────
check("B1", "B", "四条通道语义指纹同源（同一份内核）", () => {
  const fps = new Set(names.map((n) => loads[n].signature.semanticSha256));
  return { ok: fps.size === 1, detail: fps.size === 1 ? [...fps][0].slice(0, 16) : `出现 ${fps.size} 种指纹：${[...fps].map((f) => f.slice(0, 12)).join(", ")}` };
});

check("B2", "B", "全部通道字节数在各自预算内（内嵌索引单独计账）", () => {
  const over = [];
  for (const n of names) {
    const b = loads[n].load.budget;
    if (b.problems.length) over.push(`${n}: ${b.problems.join("；")}`);
  }
  return { ok: over.length === 0, detail: over.join(" | ") };
});

check("B3", "B", "惰性指针与 unit 双向可溯：无悬空指针；孤儿 unit 必然有非指针装载通道", () => {
  const { pointers, orphanUnits, units } = checkKernelIntegrity(sources.primary, sources.lazy);
  // L_coverage 由工具负载（scenario 工具）装载，L_examples 由示例通道装载 ——
  // 这两条**故意**不在常驻内核里留指针：留了等于把示例正文也钉进常驻。
  // 其余 unit 一律靠常驻指针可溯：形态①`【惰性 L_x｜…】`、形态②`（惰性 L_x：…）`两种
  // 都算（解析在 lib/kernel-signature.mjs 的 POINTER_RES，白名单不得再扩 —— 扩了等于
  // 把「指针写漏」洗成通过）。
  const allowedOrphans = new Set(["L_coverage", "L_examples"]);
  const unexpected = orphanUnits.filter((id) => !allowedOrphans.has(id));
  const unknownPointers = pointers.filter((p) => !units.some((u) => u.id === p));
  return {
    ok: unexpected.length === 0 && unknownPointers.length === 0,
    detail: `指针 ${pointers.length} / unit ${units.length}；孤儿 ${orphanUnits.join(",") || "无"}（白名单 ${[...allowedOrphans].join(",")}）；悬空 ${unknownPointers.join(",") || "无"}`,
  };
});

check("B4", "B", "末位锚点只由「装配位置可控」的通道宣称（dsh 组装瀑布 / api-endpoint 自建消息）", () => {
  // 判据不是「只有谁谁谁」而是「凭什么」：宣称者必须持有把文本放到模型最后读到的位置的能力位。
  // 文件通道（codex/generic/claude）写进文件不等于送进模型末尾 —— 它们不许宣称。
  const mechanism = (n) => {
    const caps = TARGETS[n].adapter.caps ?? [];
    return caps.includes("systemPromptAssemble") || caps.includes("endpointRelay");
  };
  const claims = names.filter((n) => compileFlags(TARGETS[n].adapter).tailAnchor);
  const illegal = claims.filter((n) => !mechanism(n));
  const silent = names.filter((n) => mechanism(n) && !compileFlags(TARGETS[n].adapter).tailAnchor);
  return {
    ok: illegal.length === 0 && silent.length === 0,
    detail: `宣称者：${claims.join(", ") || "无"}；无机制却宣称：${illegal.join(", ") || "无"}；有机制却未宣称：${silent.join(", ") || "无"}`,
  };
});

check("B5", "B", "发布工件可被独立复算（digest 与载荷哈希一致）", () => {
  const bad = [];
  for (const n of names) {
    const r = loads[n];
    const payload = r.written.map((f) => `${f.path}\u0000${f.sha256}`).join("\n");
    const problems = verifyArtifact(r.artifact, payload);
    if (problems.length) bad.push(`${n}: ${problems.join("；")}`);
  }
  return { ok: bad.length === 0, detail: bad.join(" | ") };
});

// ── C 级：回归门禁 ───────────────────────────────────────────────────────────
check("C1", "C", "易变标记（节拍号 / 会话号 / 时间戳）不影响语义指纹稳定性", () => {
  const noisy = `【运行时锚点 R#9999】 pfa-deadbeef99 session 2026-09-28T12:00:00Z epoch 1790656394856\n` + sources.primary;
  const normalized = normalizeKernel(noisy);
  const reNormalized = normalizeKernel(sources.primary);
  const drift = normalized.text.length - reNormalized.text.length;
  // 归一化后长度差应恰好等于被抹掉标记的补位长度差，不该把正文也吃掉
  return { ok: drift > 0 && normalized.volatility.length >= 3, detail: `抹掉 ${normalized.volatility.length} 处标记，长度差 ${drift}` };
});

check("C2", "C", "域索引覆盖全部族，且域数与真源一致", () => {
  const srcText = existsSync(join(dataDir, "scenarios.mjs")) ? readFileSync(join(dataDir, "scenarios.mjs"), "utf8") : "";
  const domains = parseDomains(srcText);
  const families = parseFamilies(srcText);
  const stats = domainIndexStats(domains, families);
  const populated = families.filter((f) => (stats.byFamily[f.id] ?? 0) > 0).length;
  return {
    ok: domains.length === 105 && families.length === 7 && populated === 7,
    detail: `${domains.length} 域 / ${families.length} 族（有域 ${populated}）/ 别名 ${stats.aliasTotal}`,
  };
});

check("C3", "C", "内嵌索引渲染是确定性的，且随 aliasLimit 单调不减", () => {
  const srcText = readFileSync(join(dataDir, "scenarios.mjs"), "utf8");
  const domains = parseDomains(srcText);
  const families = parseFamilies(srcText);
  const a = renderDomainIndex({ domains, families, aliasLimit: 2 });
  const b = renderDomainIndex({ domains, families, aliasLimit: 4 });
  const a2 = renderDomainIndex({ domains, families, aliasLimit: 2 });
  const bytesA = Buffer.byteLength(a, "utf8");
  const bytesB = Buffer.byteLength(b, "utf8");
  return { ok: a === a2 && bytesB >= bytesA, detail: `alias2=${bytesA} B · alias4=${bytesB} B` };
});

check("C4", "C", "跨身份不可比：不同模型/推理等级的记录不得拼接", () => {
  const a = identityOf({ model: "MODEL_A", reasoning: "medium", carrier: "codex" });
  const b = identityOf({ model: "MODEL_B", reasoning: "medium", carrier: "codex" });
  const c = identityOf({ model: "MODEL_A", reasoning: "medium", carrier: "codex" });
  return {
    ok: a.tuple !== b.tuple && a.tuple === c.tuple,
    detail: `A=${a.tuple} B=${b.tuple}`,
  };
});

check("C5", "C", "单次构建不写宿主目录：mount 默认 dry-run，且 writes 只是计划", () => {
  const bad = [];
  for (const n of names) {
    const a = TARGETS[n].adapter;
    if (typeof a.mount !== "function") continue; // dsh 由宿主侧插件装载，属预期
    if (a.mount.length > 0) {
      // mount 允许有参数，但默认调用必须是 dry-run
      const spec = a.mount.toString();
      if (!/dryRun\s*=\s*true|dryRun\s*:\s*true|\?\?\s*true/.test(spec)) bad.push(`${n}: mount 未见 dry-run 默认`);
    }
  }
  return { ok: bad.length === 0, detail: bad.join("；") };
});

// ── D 级：端点通道门禁（第五通道：不经宿主会话，直连模型 API） ───────────────
const apiPrepared = () => loads["api-endpoint"].load.blocks.map((b) => ({ id: b.id, text: b.text, bytes: b.bytes }));

check("D1", "D", "端点通道契约自洽：channel=endpoint-relay、能力位唯一、位次 last、去重 keep", () => {
  const a = TARGETS["api-endpoint"].adapter;
  const problems = validateAdapter(a);
  const f = compileFlags(a);
  const ok =
    problems.length === 0 &&
    a.channel === "endpoint-relay" &&
    a.caps.length === 1 &&
    a.caps[0] === "endpointRelay" &&
    a.slot === "last" &&
    a.dedupe === "keep" &&
    f.tailAnchor === true &&
    f.domainViaTool === false &&
    f.lazyEnabled === false;
  return { ok, detail: `契约问题 ${problems.length}；flags=${JSON.stringify(f)}` };
});

check("D2", "D", "消息装配：内核正文在 system 段，末位锚点整体落在最后一条 user 的末尾", () => {
  const load = loads["api-endpoint"].load;
  const prepared = apiPrepared();
  const msgs = messagesFor(load, { prepared });
  const anchor = prepared.find((b) => b.id === "core.tail-anchor");
  const system = msgs.find((m) => m.role === "system")?.content ?? "";
  const last = msgs[msgs.length - 1];
  const kernelHead = sources.primary.split("\n").map((l) => l.trim()).find((l) => l.length > 8) ?? "";
  const atTail = anchor ? last.role === "user" && last.content.trimEnd().endsWith(anchor.text.trimEnd()) : false;
  return {
    ok: msgs[0].role === "system" && system.includes(kernelHead) && atTail,
    detail: `消息 ${msgs.length} 条（${msgs.map((m) => m.role).join("→")}）· 锚点 ${anchor?.bytes ?? 0} B 落位=${atTail} · system 含内核首行=${system.includes(kernelHead)}`,
  };
});

check("D3", "D", "端点凭据不落盘：模板与消息体不含密钥，缺密钥时 resolveRelay 不就绪（走降级分支）", () => {
  const SECRET = "sk-SERIAL0123456789abcdef";
  const ready = resolveRelay({ IG5_RELAY_BASE_URL: "https://endpoint.invalid/v1", IG5_RELAY_API_KEY: SECRET, IG5_RELAY_MODEL: "TARGET_MODEL" });
  const bare = resolveRelay({});
  const load = loads["api-endpoint"].load;
  const plan = apiLayout(load, { prepared: apiPrepared(), model: "TARGET_MODEL" });
  const blob = JSON.stringify(plan);
  const leaked = blob.includes(SECRET) || JSON.stringify(plan.request).includes(SECRET);
  const redacted = redact(`Authorization: Bearer ${SECRET}`, SECRET);
  return {
    ok: ready.ready === true && bare.ready === false && bare.problems.length > 0 && !leaked && !redacted.includes(SECRET),
    detail: `就绪=${ready.ready}（schema ${RELAY_SCHEMA}）· 裸环境就绪=${bare.ready}（问题 ${bare.problems.length} 条）· 模板泄漏=${leaked} · redact 生效=${!redacted.includes(SECRET)}`,
  };
});

check("D4", "D", "本地桩确定性：同输入同回执、四态可复现，题号抽取与分片一致", () => {
  if (!dispatchApi) return { ok: false, detail: `内核分发模块缺失：${KERNEL_FILE}` };
  const a = receiptFor("q001", 0);
  const b = receiptFor("q001", 0);
  const stable = JSON.stringify(a) === JSON.stringify(b);
  const seen = new Set();
  for (let n = 1; n <= 8; n += 1) seen.add(receiptFor(`q${String(n).padStart(3, "0")}`, 0).disposition);
  const items = dispatchApi.loadBank().items.slice(0, 4);
  const groups = dispatchApi.shard(items, 1);
  const text = dispatchApi.renderDispatch(groups[0].items, { index: groups[0].index, total: groups.length, shardId: groups[0].shardId });
  const got = idsIn(text);
  const want = groups[0].items.map((i) => i.id);
  return {
    ok: stable && seen.size === 4 && got.length === want.length && want.every((id) => got.includes(id)),
    detail: `确定性=${stable} · 四态覆盖 ${seen.size}/4（${[...seen].join(",")}）· 题号抽取 ${got.join(",")} vs 分片 ${want.join(",")} · 桩 ${MOCK_VERSION}`,
  };
});

check("D5", "D", "回执闭环：桩回复可被分发内核解析、规范化，并完整计入四态统计", () => {
  if (!dispatchApi) return { ok: false, detail: `内核分发模块缺失：${KERNEL_FILE}` };
  const items = dispatchApi.loadBank().items.slice(0, 6);
  const groups = dispatchApi.shard(items, 2);
  const replies = [];
  for (const g of groups) {
    const prompt = dispatchApi.renderDispatch(g.items, { index: g.index, total: groups.length, shardId: g.shardId });
    replies.push(JSON.stringify(idsIn(prompt).map((id) => receiptFor(id, g.index))));
  }
  const receipts = replies.flatMap((r) => dispatchApi.extractReceipts(r)).map((r) => dispatchApi.normalizeReceipt(r));
  const score = dispatchApi.scoreResults(items, receipts);
  const counts = score.counts ?? {};
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  const bad = receipts.filter((r) => !dispatchApi.DISPOSITIONS.includes(r.disposition));
  return {
    ok: receipts.length === items.length && total === items.length && bad.length === 0,
    detail: `回执 ${receipts.length}/${items.length} 条 · 统计合计 ${total} · 四态 ${JSON.stringify(counts)} · 越界 disposition ${bad.length}`,
  };
});

// ── E 组：技能分层（DSH 技能通道） ──────────────────────────────────────────
// 依据（实测自宿主源码，见 build-skills.mjs 文件头 provenance）：
//   · 发现规则 <root>/<name>/SKILL.md，深度 1 层（dsh-skill-filesystem/lib/index.js:550-556）
//   · 前置元数据必填 name(kebab-case) + description（同仓 README.zh.md:36）
//   · 工具结果 > thresholdChars:8192 会被裁剪（dsh-compaction-tool-result-pruner/lib/index.js:11）
const skills = skillsPlan({ promptDir: truth });

check("E1", "E", "技能分层账目自洽：零问题，常驻 + 外移覆盖内核全文", () => {
  const covered = skills.residentBytes + skills.movedBytes;
  return {
    ok: skills.problems.length === 0 && covered <= skills.primaryBytes && skills.ceilingRatio < 0.5,
    detail: `常驻 ${skills.residentBytes} B + 外移 ${skills.movedBytes} B = ${covered} B ≤ 内核 ${skills.primaryBytes} B · 外移占比 ${(skills.ceilingRatio * 100).toFixed(1)}% · 问题 ${skills.problems.length}${skills.problems.length ? "：" + skills.problems.join("；") : ""}`,
  };
});

check("E2", "E", "每个技能档渲染后低于宿主裁剪上限，前置元数据满足发现规则（kebab-case name + description + whenToUse）", () => {
  const sk = skills.files.filter((f) => f.kind === "skill");
  const bad = sk.filter(
    (f) =>
      f.chars >= SKILL_BUDGET_CHARS ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(f.id) ||
      // name/description 紧跟 frontmatter 首行，前面是 `---\n` 而不是 `\n`，故用 (?:^|\n) 锚
      !/(?:^|\n)name: [a-z0-9-]+\n/.test(f.text) ||
      !/(?:^|\n)description: \S/.test(f.text) ||
      !f.text.includes("whenToUse:") ||
      !f.text.includes("source: ig5-adapters/lib/skill-chain.mjs"),
  );
  return {
    ok: sk.length > 0 && bad.length === 0,
    detail: `${sk.map((f) => `${f.id} ${f.chars} 字符`).join(" · ")}（上限 ${SKILL_BUDGET_CHARS}）· 不合规 ${bad.length}`,
  };
});

check("E3", "E", "六条不可降级锚点全部留在常驻正文里（缺一条即运行期静默失效）", () => {
  const missing = NON_DEROGABLE.filter((n) => !n.pattern.test(skills.chain.chain)).map((n) => n.id);
  return {
    ok: missing.length === 0 && skills.anchors.length === NON_DEROGABLE.length,
    detail: `常驻锚点 ${skills.anchors.join(", ")} · 共 ${NON_DEROGABLE.length} 条 · 缺失 ${missing.length ? missing.join(", ") : "无"}`,
  };
});

check("E4", "E", "治理条款零外移：任何被判为常驻级的块都不得出现在技能档里", () => {
  const moved = skills.chain.bundles.flatMap((b) => b.blocks);
  const leaked = moved.filter((b) => classifyBlock(b).tier === "resident").map((b) => (b.head ?? "").slice(0, 40));
  return {
    ok: leaked.length === 0,
    detail: `外移块 ${moved.length} 个 · 其中治理/锚点块 ${leaked.length}${leaked.length ? "：" + leaked.join(" / ") : ""}`,
  };
});

check("E5", "E", "技能层可复现：两次分层字节一致，且 header 真进产物（非常量）", () => {
  const a = skillsPlan({ promptDir: truth });
  const b = skillsPlan({ promptDir: truth });
  const c = skillsPlan({ promptDir: truth, header: "# PROBE_HEADER" });
  const same =
    a.chain.chainSha256 === b.chain.chainSha256 &&
    JSON.stringify(a.files.map((f) => f.sha256)) === JSON.stringify(b.files.map((f) => f.sha256));
  const headerTakes = c.chain.chainSha256 !== a.chain.chainSha256 && c.chain.chain.includes("PROBE_HEADER");
  return {
    ok: same && headerTakes,
    detail: `两次一致=${same} · header 生效=${headerTakes} · 链 sha ${a.chain.chainSha256.slice(0, 16)}（header 版 ${c.chain.chainSha256.slice(0, 16)}）`,
  };
});

// ── F 组：端点动态适配与逐轮注入（决策表；真发包的端到端在 test-dynamic-adapt.mjs，本次 14/14） ──
const kernelBytes = signature.bytes.primary;
const unitsF = parseLazyUnits(readFileSync(join(truth, "infinite-gen-5-lazy.md"), "utf8"));

check("F1", "F", "载体决策表：端点拒收 system → 内联；接受 → system 通道 + 末位锚点；没探过 → degraded", () => {
  const rejected = adaptPlan({ systemRole: "rejected", usageReported: true }, { kernelBytes });
  const accepted = adaptPlan({ systemRole: "accepted", usageReported: true, contextWindow: 65536 }, { kernelBytes });
  const blind = adaptPlan({}, { kernelBytes });
  const ok =
    rejected.carrier === "inline" &&
    rejected.slot === "INLINE" &&
    accepted.carrier === "system" &&
    accepted.slot === "LAST" &&
    accepted.confidence === "high" &&
    blind.degraded === true &&
    blind.confidence === "low";
  return {
    ok,
    detail: `rejected=${rejected.carrier}/${rejected.slot} · accepted=${accepted.carrier}/${accepted.slot}/${accepted.confidence} · 未探过 degraded=${blind.degraded}`,
  };
});

check("F2", "F", "预算决策表：回执给出上下文上限即按 35% 折算；内核超预算则惰性正文与内联索引全关", () => {
  const tight = adaptPlan({ systemRole: "accepted", contextWindow: 8192, usageReported: true }, { kernelBytes });
  const roomy = adaptPlan({ systemRole: "accepted", contextWindow: 131072, usageReported: true }, { kernelBytes });
  const ok =
    tight.budget.totalBytes === Math.floor(8192 * 3 * 0.35) &&
    tight.lazyMode === "off" &&
    tight.injectLazy === false &&
    tight.indexInline === false &&
    roomy.lazyMode === "standard" &&
    roomy.injectLazy === true &&
    roomy.budget.totalBytes === 40000 &&
    kernelBytes > tight.budget.totalBytes;
  return { ok, detail: `8192 → ${tight.budget.totalBytes} B / ${tight.lazyMode} · 131072 → ${roomy.budget.totalBytes} B / ${roomy.lazyMode} · 内核 ${kernelBytes} B` };
});

check("F3", "F", "逐轮注入只认触发词：真源每条 unit 都命中自己那节，无触发词零注入", () => {
  const unit = unitsF.find((u) => u.id === "L_dispatch");
  const hit = selectLazyUnits(`请${unit.triggers[0]}一下`, unitsF);
  const miss = selectLazyUnits("这一轮只是问个好", unitsF);
  // 真源 unit 条数会随内核增长（0.45 线为 14 条），所以不写死条数 —— 改判「规模下限 + 每条都能
  // 被自己的首个触发词单独命中」。写死条数会在内核加 unit 时变成假红灯，掩盖真正的失效。
  const perUnit = unitsF.map((u) => selectLazyUnits(u.triggers[0], unitsF).some((h) => h.id === u.id));
  const allSelfHit = perUnit.every(Boolean);
  const badUnits = unitsF.filter((_, i) => !perUnit[i]).map((u) => u.id);
  const ok =
    unitsF.length >= 9 &&
    unitsF.every((u) => u.triggers.length >= 1) &&
    allSelfHit &&
    Array.isArray(unit.triggers) &&
    hit.length === 1 &&
    hit[0].id === "L_dispatch" &&
    miss.length === 0;
  return { ok, detail: `真源 ${unitsF.length} 条 unit（≥9）· 自命中 ${perUnit.filter(Boolean).length}/${unitsF.length}${badUnits.length ? ` 漏=${badUnits.join(",")}` : ""} · 命中=[${hit.map((h) => h.id).join(",")}] 触发词=${hit[0]?.matched.join("/")} · 无触发词=${miss.length} 条` };
});

check("F4", "F", "注入受预算闸门约束：装不下即跳过并记原因，消息总字节不超载荷预算", () => {
  const plan = adaptPlan({ systemRole: "accepted", contextWindow: 131072, usageReported: true }, { kernelBytes });
  plan.budget.lazyBudgetBytes = unitsF[0].bytes; // 刚好装得下第一条
  const turn = buildTurn({
    kernelText: readFileSync(join(truth, "infinite-gen-5.md"), "utf8"),
    units: unitsF,
    plan,
    userTurn: unitsF.slice(0, 4).map((u) => u.triggers[0]).join(" "),
  });
  const ok = turn.injected.length === 1 && turn.skipped.length >= 1 && turn.withinBudget === true && turn.injected.length + turn.skipped.length >= 4;
  return { ok, detail: `injected=[${turn.injected.join(",")}] skipped=${turn.skipped.length} 条 withinBudget=${turn.withinBudget}（${turn.bytes}/${turn.budgetBytes} B）` };
});

check("F5", "F", "降级三态可见且可复现：无 usage 不报 high、传输失败置 degraded、两次构建同构", () => {
  const noUsage = adaptPlan({ systemRole: "accepted", usageReported: false }, { kernelBytes });
  const broken = adaptPlan({ systemRole: "unknown", usageReported: false, transport: "transport: ECONNREFUSED" }, { kernelBytes });
  const plan = adaptPlan({ systemRole: "accepted", contextWindow: 131072, usageReported: true }, { kernelBytes });
  const args = { kernelText: "KERNEL_PLACEHOLDER", units: unitsF, plan, userTurn: "问个好" };
  const a = buildTurn(args);
  const b = buildTurn(args);
  const ok =
    noUsage.confidence === "low" &&
    broken.degraded === true &&
    JSON.stringify(a) === JSON.stringify(b) &&
    a.messages.every((m) => typeof m.content === "string");
  return { ok, detail: `无 usage conf=${noUsage.confidence} · 传输失败 degraded=${broken.degraded} · 两次同构=${JSON.stringify(a) === JSON.stringify(b)}` };
});

// ── G 组：自动注入（缓存 → 系统段 → 逐轮注入） ──────────────────────────────
const G_ORDER_RESERVED = new Set([100, 120, 999, 10150, 10200]);
function adaptEntry(over = {}) {
  return {
    ok: true,
    path: "/tmp/ig5-adapt-cache-PLACEHOLDER.json",
    at: 0,
    ageMs: 60 * 1000,
    ttlMs: 6 * 3600 * 1000,
    fresh: true,
    stale: false,
    confidence: "high",
    host: "127.0.0.1",
    signals: { systemRole: "accepted", contextWindow: 131072, usageReported: true },
    plan: { carrier: "system", slot: "LAST", lazyMode: "standard", budgetBytes: 40000, lazyBudgetBytes: 6000 },
    ...over,
  };
}

// 注册是 async 的：先在顶层 await 拿到结果，再进同步判据（check() 不 await 返回值）。
const G_ABSENT = (k) => (k === "IG5_ADAPT_CACHE" ? "/tmp/ig5-adapt-verify-absent.json" : undefined);
const G_registrations = {
  noCache: await registerAdaptiveInjection(
    { systemPrompt: { section: () => {}, context: () => {} }, effect: (fn) => fn() },
    { reader: G_ABSENT },
  ),
  bare: await registerAdaptiveInjection({}, { reader: G_ABSENT }),
  sectionOnly: await registerAdaptiveInjection(
    { systemPrompt: { section: () => {} }, effect: (fn) => fn() },
    { reader: G_ABSENT },
  ),
};

check("G1", "G", "计划→指令文本表驱动：载体/槽位/预算/未探明按信号写实，过期改写耗时行，硬上限 1400 B", () => {
  const fresh = renderAdaptDirective(adaptEntry());
  const stale = renderAdaptDirective(adaptEntry({ stale: true, fresh: false, ageMs: 7 * 3600 * 1000 }));
  const inline = renderAdaptDirective(adaptEntry({ plan: { ...adaptEntry().plan, carrier: "inline", slot: "INLINE" } }));
  const blind = renderAdaptDirective(
    adaptEntry({ signals: { systemRole: "unknown", contextWindow: 0, usageReported: false }, confidence: "low" }),
  );
  const ok =
    fresh.includes("载体：system") &&
    fresh.includes("槽位：LAST") &&
    fresh.includes("预算：40000") &&
    fresh.includes("未探明：无（探针读全了）") &&
    !fresh.includes("过期：") &&
    stale.includes("过期：") &&
    stale.includes("重跑 adapt 刷新") &&
    inline.includes("首条 user 消息尾部") &&
    blind.includes("未探明：system 段是否被接受、上下文窗口、usage 回执") &&
    [fresh, stale, inline, blind].every((t) => Buffer.byteLength(t, "utf8") <= 1400);
  return {
    ok,
    detail: `fresh=${Buffer.byteLength(fresh, "utf8")}B stale=${Buffer.byteLength(stale, "utf8")}B inline=${Buffer.byteLength(inline, "utf8")}B · blind 三缺已列 · 段名 ig5-adapt:endpoint、order 101 不撞保留位 ${[...G_ORDER_RESERVED].join("/")}`,
  };
});

check("G2", "G", "逐轮注入的选择与库 selectLazyUnits 同口径（三种输入：命中 / 不命中 / 命中别的域）", () => {
  const inputs = ["让子代理去跑这一片", "这一轮只是问个好", "帮我写歌词"];
  const rows = [];
  let same = 0;
  for (const text of inputs) {
    const viaLib = selectLazyUnits(text, unitsF).map((u) => u.id).join(",");
    const viaPlugin = renderTurnInject({ text }, { units: unitsF, plan: { lazyBudgetBytes: 6000 } });
    const okRow = viaLib === "" ? viaPlugin === "" : viaPlugin.includes("<!-- ig5 动态注入");
    if (okRow) same += 1;
    rows.push(`${text.slice(0, 6)}→[${viaLib || "空"}]`);
  }
  const ok = same === inputs.length && G_registrations.noCache.reason === "cache:no-cache";
  return { ok, detail: `${rows.join(" · ")} · 无缓存注册 reason=${G_registrations.noCache.reason}` };
});

check("G3", "G", "缓存往返：写→读→新鲜→过期→缺失→损坏，六态各有明确结果", () => {
  const dir = `/tmp/ig5-adapt-verify-${process.pid}`;
  const path = `${dir}/cache.json`;
  const reader = (k) => (k === "IG5_ADAPT_CACHE" ? path : k === "IG5_ADAPT_TTL_MS" ? "60000" : undefined);
  const written = writeAdaptCache(reader, { plan: adaptEntry().plan, signals: adaptEntry().signals, confidence: "high" }, 1000);
  const fresh = readAdaptCache(reader, 2000);
  const stale = readAdaptCache(reader, 1000 + 120000);
  const missing = readAdaptCache((k) => (k === "IG5_ADAPT_CACHE" ? `${dir}/absent.json` : undefined), 2000);
  writeFileSync(path, "{not json", "utf8");
  const broken = readAdaptCache(reader, 2000);
  const ok =
    written.ok === true &&
    fresh.ok === true &&
    fresh.fresh === true &&
    stale.stale === true &&
    missing.reason === "no-cache" &&
    String(broken.reason).startsWith("cache-unreadable");
  return {
    ok,
    detail: `写 ${written.ok}(${written.bytes}B) · fresh=${fresh.fresh} · stale=${stale.stale} · 缺=${missing.reason} · 坏=${String(broken.reason).slice(0, 36)}`,
  };
});

check("G4", "G", "逐轮注入的预算闸门：真装下第一条、第二条被跳过并记原因；未命中回空串", () => {
  // 合成句用两条 unit 各自的首个触发词拼成（数据驱动，不写死中文），保证命中 ≥2 条。
  const u0 = unitsF[0];
  const u1 = unitsF[1];
  const text = `${u0.triggers[0]} ${u1.triggers[0]}`;
  const wide = renderTurnInject({ text }, { units: unitsF, plan: { lazyBudgetBytes: 6000 } });
  const head = `<!-- ig5 动态注入（触发词命中 ${u0.id}、${u1.id}）-->\n`;
  // 恰好只装得下第一条：注释头 + 第一条正文 + 换行
  const tight = renderTurnInject(
    { text },
    { units: unitsF, plan: { lazyBudgetBytes: 0 }, cap: Buffer.byteLength(head, "utf8") + Buffer.byteLength(`${u0.body}\n`, "utf8") },
  );
  const miss = renderTurnInject({ text: "这一轮只是问个好" }, { units: unitsF, plan: { lazyBudgetBytes: 6000 } });
  // 注意：被跳过者的 id 会出现在「装不下」注释里，所以不能说 !tight.includes(u1.id) ——
  // 要断言的是它的**正文**没落地。
  const body1 = (u1.body ?? "").trim().split("\n")[0].slice(0, 40);
  const ok =
    wide.includes(u0.id) &&
    wide.includes(u1.id) &&
    !wide.includes("装不下") &&
    tight.includes(u0.id) &&
    tight.includes("装不下") &&
    body1.length > 8 &&
    wide.includes(body1) &&
    !tight.includes(body1) &&
    miss === "";
  return {
    ok,
    detail: `合成句命中 ${u0.id}+${u1.id} · 宽 ${Buffer.byteLength(wide, "utf8")}B → 紧 ${Buffer.byteLength(tight, "utf8")}B（${u0.id} ${u0.bytes}B 装下，${u1.id} 记「装不下」）· 未命中 ${miss.length}B`,
  };
});

check("G5", "G", "降级不抛：无 systemPrompt.section 只回原因；宿主无 context() 时不硬塞逐轮注入", () => {
  const ok =
    G_registrations.bare.registered === false &&
    G_registrations.bare.reason === "no-systemPrompt-section" &&
    G_registrations.sectionOnly.registered === false &&
    G_registrations.sectionOnly.reason === "cache:no-cache" &&
    (G_registrations.noCache.skipped ?? []).includes("cache:no-cache");
  return {
    ok,
    detail: `裸 ctx → ${G_registrations.bare.reason} · 有 section 无缓存 → ${G_registrations.sectionOnly.reason} · skipped 照实记`,
  };
});

// ── H 组：文件载体（codex / gpt-instruct 协议：config.toml + ZIP + 快照回滚）──
const H_ROOT = mkdtempSync(join(tmpdir(), "ig5-verify-h-"));
const H_PAYLOAD = "# 载荷\nhello from ig5\n";
const H_CONFIG = [
  "# 用户自己的配置",
  'model = "gpt-5.6-sol"',
  'approval_policy = "never"',
  "",
  "[profiles.default]",
  `  ${MANAGED_KEY} = "./decoy.md"`,
  "",
].join("\n");

check("H1", "H", "顶层键工具：表格内同名键不算数、插在顶层 model 之后、删除后表格内那行原样保留", () => {
  const ins = setTopLevelAssignment(H_CONFIG, MANAGED_KEY, "./x.md");
  const lines = ins.text.split("\n");
  const topIdx = lines.findIndex((l) => l.startsWith(`${MANAGED_KEY} = `));
  const decoyIdx = lines.findIndex((l) => l.trim().startsWith(MANAGED_KEY) && l !== lines[topIdx]);
  const removed = removeTopLevelAssignment(ins.text, MANAGED_KEY).text;
  const ok =
    ins.action === "inserted-after-model" &&
    topIdx === 2 &&
    readTopLevelAssignment(H_CONFIG).found === false &&
    decoyIdx > topIdx &&
    !removed.split("\n").some((l) => l.startsWith(`${MANAGED_KEY} = `)) &&
    removed.includes("./decoy.md") &&
    readTopLevelAssignment(ins.text).value === "./x.md";
  return { ok, detail: `action=${ins.action} topIdx=${topIdx} 表格内仍在=${decoyIdx > topIdx} 读回=${JSON.stringify(readTopLevelAssignment(ins.text).value)}` };
});

check("H2", "H", `计划器三道闸：超 ${CARRIER_CAP_BYTES} B 拒绝、放行开关生效、不安全名一律拒绝，且只读不落盘`, () => {
  const dir = join(H_ROOT, "h2");
  mkdirSync(dir, { recursive: true });
  const big = `# big\n${"a".repeat(9000)}`;
  const denied = planDeploy({ codexDir: dir, payloadText: big });
  const allowed = planDeploy({ codexDir: dir, payloadText: big, allowOversize: true });
  const bad = ["../evil.md", "noext", ".hidden.md", "sub/dir.md", "a\\b.md"].every(
    (n) => planDeploy({ codexDir: dir, name: n, payloadText: "# x" }).reason === "unsafe-name",
  );
  const ok =
    denied.ok === false &&
    denied.reason === "oversize" &&
    denied.capBytes === CARRIER_CAP_BYTES &&
    denied.oversizeBy > 0 &&
    allowed.ok === true &&
    bad &&
    readdirSync(dir).length === 0;
  return { ok, detail: `denied=${denied.reason}/${denied.oversizeBy}B allowed=${allowed.ok} 不安全名全拒=${bad} 目录残留=${readdirSync(dir).length}` };
});

check("H3", "H", "端到端：apply 六步写盘 → state 四元组齐 → reset 清干净且 config 逐字节还原", () => {
  const dir = join(H_ROOT, "h3");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.toml"), H_CONFIG);
  const a = applyDeploy({ codexDir: dir, payloadText: H_PAYLOAD });
  const steps = a.writes.map((w) => `${w.op}${w.action ? `:${w.action}` : ""}`).join(",");
  const st = readState(dir);
  const r = resetDeploy({ codexDir: dir });
  const after = readFileSync(join(dir, "config.toml"), "utf8");
  const residue = readdirSync(dir).filter((f) => f.startsWith("infinite-gen-5") || f === STATE_FILE);
  const ok =
    a.ok &&
    steps === "snapshot,config-write:inserted-after-model,payload-write,zip-write,manifest-write,state-write" &&
    st.ok &&
    st.state.managed.name === DEFAULT_NAME &&
    st.state.managed.existed_before === false &&
    st.state.previous === null &&
    r.ok &&
    after === H_CONFIG &&
    residue.length === 0;
  return { ok, detail: `steps=${steps} state=${st.state?.managed?.name}/${st.state?.managed?.existed_before} reset 残留=${residue.length} 还原=${after === H_CONFIG}` };
});

check("H4", "H", "ZIP 载体：只含一个 .md、declared size 与载荷一致、store 字节可原样找回", () => {
  const zip = buildZip("ig5.md", H_PAYLOAD);
  const entries = readZipEntries(zip);
  const ok =
    entries.length === 1 &&
    entries[0].name === "ig5.md" &&
    entries[0].size === Buffer.byteLength(H_PAYLOAD, "utf8") &&
    zip.includes(Buffer.from(H_PAYLOAD, "utf8")) &&
    zip.subarray(0, 2).toString("hex") === "504b";
  return { ok, detail: `entries=${entries.map((e) => `${e.name}:${e.size}`).join(",")} 载荷字节在场=${zip.includes(Buffer.from(H_PAYLOAD, "utf8"))}` };
});

// CLI 是 async 的：先在顶层 await 拿结果（check() 不 await）。
const H_gate = await (async () => {
  const home = join(H_ROOT, "h5-home");
  mkdirSync(join(home, ".codex"), { recursive: true });
  const saved = process.env.HOME;
  process.env.HOME = home;
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  let code = null;
  try {
    code = await deployMain(["--apply", "--json"]);
  } finally {
    console.log = orig;
    process.env.HOME = saved;
  }
  const cfgPath = join(home, ".codex", "config.toml");
  const cfgText = existsSync(cfgPath) ? readFileSync(cfgPath, "utf8") : "";
  let json = {};
  try {
    json = JSON.parse(lines.join("\n"));
  } catch {
    json = { reason: `不可解析：${lines.join(" ").slice(0, 80)}` };
  }
  return { code, json, wrote: cfgText.includes(MANAGED_KEY) };
})();

check("H5", "H", "CLI 闸门：真实 CODEX_HOME 缺 --yes 一个字节都不写、返回码 1（HOME 指向临时根）", () => {
  const ok = H_gate.code === 1 && H_gate.json.reason === "real-home-needs-yes" && H_gate.wrote === false;
  return { ok, detail: `code=${H_gate.code} reason=${H_gate.json.reason} 未写键=${!H_gate.wrote}` };
});

rmSync(H_ROOT, { recursive: true, force: true });

// ── 汇总输出 ────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
const byGate = { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [] };
for (const r of results) byGate[r.gate].push(r);

console.log("## 适配器验证 · ig5-adapters");
console.log(`真源：${truth}`);
console.log(`数据：${dataDir}`);
console.log(`内核语义指纹：${signature.semanticSha256.slice(0, 16)} · 常驻 ${signature.bytes.primary} B · 惰性 ${signature.bytes.lazy} B`);
console.log(`域索引：${domainIndex.stats ? `${domainIndex.stats.domains} 域 / ${domainIndex.stats.families} 族 / ${Buffer.byteLength(domainIndex.text, "utf8")} B` : "缺失"}`);
console.log(`分发内核：${dispatchApi ? KERNEL_FILE : `缺失（${KERNEL_FILE}）`}`);
console.log(`通道：${names.join(" / ")}（门禁 ${Object.keys(GATES).join("/")} 三级 + D 组端点通道 + E 组技能分层 + F 组动态适配 + G 组自动注入）`);
console.log("");

for (const gate of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
  const rows = byGate[gate];
  const ok = rows.filter((r) => r.ok).length;
  console.log(`── ${gate} 级门禁（${ok}/${rows.length} 通过）──`);
  for (const r of rows) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.id}  ${r.claim}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }
  console.log("");
}

const summary = {
  tool: "verify_adapters",
  truth,
  dataDir,
  kernelSemantic: signature.semanticSha256,
  targets: names,
  checks: results.length,
  passed: results.length - failed.length,
  failed: failed.map((r) => `${r.id}:${r.claim}`),
  perTarget: Object.fromEntries(
    names.map((n) => [
      n,
      {
        digest: loads[n].artifact.digest,
        residentBytes: loads[n].load.budget.residentBytes,
        totalBudgetBytes: loads[n].load.budget.totalBytes,
        indexBytes: loads[n].load.budget.indexBytes,
        budgetProblems: loads[n].load.budget.problems.length,
        lazyUnits: loads[n].load.lazy.units.length,
      },
    ]),
  ),
};

if (args.json) console.log(`IG5_VERIFY_JSON ${JSON.stringify(summary)}`);
console.log(`结果：${summary.passed}/${summary.checks} 条判据通过${failed.length ? `（失败：${failed.map((r) => r.id).join(", ")}）` : ""}`);
process.exit(failed.length ? 1 : 0);
