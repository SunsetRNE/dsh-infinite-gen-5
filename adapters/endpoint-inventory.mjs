// endpoint-inventory.mjs — 自有端点池巡检：把你手上真有凭据的那些端点逐个探一遍，
// 出「能力信号 + 适配计划 + 耗时」的可比对报告。
//
// 三条硬纪律（都不是风格问题，是账目问题）：
//   1. 密钥只从环境变量读：清单里出现 apiKey 字面量直接拒（inline-key-refused），
//      因为清单文件会到处传，而密钥不该跟着走。回执只回 hasKey，不回显。
//   2. 必须写 provenance（self-hosted / own-account / own-relay / local-stub）：
//      来源不明的条目一律 provenance-not-owned 拒掉，且不同来源的成绩 stitchable=false ——
//      跨身份拼成绩这类事在这个仓里已经是明写的禁忌（见 lib/release-artifact.mjs 的 GATES）。
//   3. 探测只花两条最小请求，失败不重试：探针读不出来的写 unknown，绝不填默认值。
//
// 用法：
//   node endpoint-inventory.mjs --inventory examples/inventory.sample.json --dry-run
//   node endpoint-inventory.mjs --inventory inventory.json --out runs/
//   node endpoint-inventory.mjs --version

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeEndpoint } from "./lib/endpoint-probe.mjs";
import { adaptPlan, ADAPT_VERSION } from "./lib/dynamic-adapt.mjs";

export const INVENTORY_VERSION = "ig5-endpoint-inventory/1";

/** 允许出现在清单里的来源。其它一律拒 —— 不是本人持有的端点不进这份报告。 */
export const OWNED_PROVENANCE = new Set(["self-hosted", "own-account", "own-relay", "local-stub", "public-free"]);

export const HELP = `endpoint-inventory — 自有端点池巡检（${INVENTORY_VERSION}）

  --inventory FILE   清单文件（必需）
  --out DIR          报告落盘目录（默认 runs/）
  --emit-template    打印一份可填空的起步清单（含免费档与自建端点；默认全部 skip）
  --dry-run          只校验清单，不发任何网络包
  --json             末尾附机器可读 JSON
  --timeout-ms N     单条探测超时（默认 20000）
  --padding N        在探针 user 文本后补 N 个字节（验证长上下文，默认 0）
  --version          打印版本
  --help             本页

清单形状：
  { "version": "${INVENTORY_VERSION}",
    "entries": [
      { "id": "local-a", "baseUrl": "http://127.0.0.1:8787", "model": "MOCK_MODEL",
        "provenance": "local-stub", "keyEnv": "IG5_LOCAL_KEY", "note": "自建桩" }
    ] }

  "skip": true 的条目会被校验但不发包（模板里默认全 skip，填好一条删一条的 skip）。
`;

function parseArgs(argv) {
  const takesValue = new Set(["--inventory", "--out", "--timeout-ms", "--padding"]);
  const flags = new Set(["--dry-run", "--json", "--version", "--help", "--emit-template"]);
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (takesValue.has(a)) {
      out[a.slice(2)] = argv[++i];
    } else if (flags.has(a)) {
      out[a.slice(2)] = true;
    } else if (a.startsWith("-")) {
      throw new Error(`未知选项 ${a}（--help 看用法）`);
    } else {
      throw new Error(`多余的位置参数 ${a}`);
    }
  }
  return out;
}

/** 校验单条：形状、来源白名单、密钥写法。返回 {ok:true} 或 {ok:false, reason}。 */
export function validateEntry(entry, index = 0) {
  const at = `entries[${index}]`;
  if (!entry || typeof entry !== "object") return { ok: false, reason: `${at}: 不是对象` };
  if (!entry.id) return { ok: false, reason: `${at}: 缺 id` };
  if (typeof entry.baseUrl !== "string" || !/^https?:\/\//i.test(entry.baseUrl)) {
    return { ok: false, reason: `${at}: baseUrl 必须是 http(s):// 开头` };
  }
  if (entry.apiKey) {
    return {
      ok: false,
      reason: `${at}: inline-key-refused（清单里不许出现密钥字面量；改用 keyEnv 指向环境变量）`,
    };
  }
  if (entry.keyEnv !== undefined && !/^[A-Z][A-Z0-9_]*$/.test(String(entry.keyEnv))) {
    return { ok: false, reason: `${at}: keyEnv 必须是环境变量名（大写字母/数字/下划线）` };
  }
  const provenance = String(entry.provenance ?? "");
  if (!OWNED_PROVENANCE.has(provenance)) {
    return {
      ok: false,
      reason: `${at}: provenance-not-owned（provenance="${provenance || "缺失"}"，允许：${[...OWNED_PROVENANCE].join(" / ")}）`,
    };
  }
  return { ok: true, entry: { id: entry.id, baseUrl: entry.baseUrl, model: entry.model ?? "", keyEnv: entry.keyEnv ?? "", provenance, note: entry.note ?? "", skip: entry.skip === true } };
}

/** 读清单：先解析，再逐条校验，坏条目单独列，不连坐。 */
export function loadInventory(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `清单不是合法 JSON：${err.message}`, entries: [], rejected: [] };
  }
  const list = Array.isArray(doc) ? doc : doc.entries;
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, reason: "清单里没有 entries 数组（或为空）", entries: [], rejected: [] };
  }
  const entries = [];
  const rejected = [];
  list.forEach((raw, i) => {
    const v = validateEntry(raw, i);
    if (v.ok) entries.push(v.entry);
    else rejected.push({ index: i, id: raw?.id ?? `#${i}`, reason: v.reason });
  });
  return { ok: true, version: doc.version ?? "(未标版本)", entries, rejected };
}

/** 探一条端点：探针 → 适配计划 → 记账行。探测失败也出行，不吞。 */
export async function inspectEndpoint(entry, { timeoutMs = 20000, padding = 0, kernelBytes = 0 } = {}) {
  const apiKey = entry.keyEnv ? process.env[entry.keyEnv] ?? "" : "";
  const started = Date.now();
  let probe;
  try {
    probe = await probeEndpoint({ baseUrl: entry.baseUrl, apiKey, model: entry.model || "MODEL_ID", timeoutMs, padding });
  } catch (err) {
    return {
      id: entry.id,
      provenance: entry.provenance,
      model: entry.model,
      host: safeHost(entry.baseUrl),
      hasKey: Boolean(apiKey),
      ok: false,
      error: String(err?.message ?? err).slice(0, 200),
      ms: Date.now() - started,
    };
  }
  const signals = probe.signals ?? {};
  const plan = adaptPlan(signals, { kernelBytes });
  // 探针自己会把传输失败收进 probes（不抛），这里把它提升成行的 error：
  // 一份「ok:false 但 error 为空」的报告读起来像什么都没发生，那是最坏的一种记账。
  const lastFailed = [...(probe.probes ?? [])].reverse().find((p) => p.ok !== true);
  const error = probe.ok === true ? undefined : String(lastFailed?.message ?? "探测失败：端点未回 200（且回执里没有可读的错误文本）").slice(0, 200);
  return {
    id: entry.id,
    provenance: entry.provenance,
    note: entry.note,
    model: probe.model ?? entry.model,
    host: safeHost(entry.baseUrl),
    hasKey: Boolean(apiKey),
    ok: probe.ok === true,
    error,
    probesUsed: probe.used,
    ms: Date.now() - started,
    signals: {
      systemRole: signals.systemRole ?? "unknown",
      contextWindow: signals.contextWindow ?? "unknown",
      usageReported: signals.usageReported ?? "unknown",
      maxOutput: signals.maxOutput ?? "unknown",
    },
    confidence: probe.confidence,
    plan: {
      carrier: plan.carrier,
      slot: plan.slot,
      lazyMode: plan.lazyMode,
      injectLazy: plan.injectLazy,
      budgetBytes: plan.budget.totalBytes,
      degraded: plan.degraded,
    },
    planRules: (plan.reasons ?? []).map((r) => r.rule),
  };
}

function safeHost(baseUrl) {
  try {
    const u = new URL(baseUrl);
    return `${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "(无法解析)";
  }
}

/** 串行巡检（并发默认 1：探测会花钱/吃配额，默认保守）。 */
export async function runInventory({ entries, timeoutMs = 20000, padding = 0, kernelBytes = 0, concurrency = 1 } = {}) {
  const rows = [];
  const queue = [...entries];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, entries.length || 1)) }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      // skip 的条目照样出行，但一个包都不发：模板默认全 skip，可以安全地先跑一遍看账目。
      if (entry.skip) {
        rows.push({ id: entry.id, provenance: entry.provenance, note: entry.note, model: entry.model, host: safeHost(entry.baseUrl), hasKey: Boolean(entry.keyEnv ? process.env[entry.keyEnv] : ""), ok: false, skipped: true, error: "skip：清单里标了 skip，未发包", probesUsed: 0, ms: 0 });
        continue;
      }
      rows.push(await inspectEndpoint(entry, { timeoutMs, padding, kernelBytes }));
    }
  });
  await Promise.all(workers);
  const order = new Map(entries.map((e, i) => [e.id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const provSet = new Set(rows.map((r) => r.provenance));
  const modelSet = new Set(rows.map((r) => `${r.provenance}|${r.model}`));
  return {
    version: INVENTORY_VERSION,
    at: new Date().toISOString(),
    adaptVersion: ADAPT_VERSION,
    rows,
    stitchable: provSet.size <= 1 && modelSet.size <= 1,
    stitchReason: provSet.size <= 1 && modelSet.size <= 1 ? "同一来源同一模型，可合并统计" : `来源 ${provSet.size} 种 / 来源×模型 ${modelSet.size} 种：分别成表，不许拼成绩`,
  };
}

export function renderInventoryReport(run, { rejected = [] } = {}) {
  const out = [];
  out.push(`# 端点池巡检 · ${run.at}`);
  out.push("");
  out.push(`条目 ${run.rows.length}${rejected.length ? ` · 被拒 ${rejected.length}` : ""} · 可合并统计：${run.stitchable ? "是" : "否"}（${run.stitchReason}）`);
  out.push("");
  out.push("| id | 来源 | 主机 | 模型 | system | 窗口 | usage | 载体 | 槽位 | 预算 | 耗时 | 结论 |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of run.rows) {
    if (r.skipped) {
      out.push(`| ${r.id} | ${r.provenance} | ${r.host} | ${r.model || "—"} | — | — | — | — | — | — | — | 跳过（清单标了 skip，未发包） |`);
      continue;
    }
    if (r.error) {
      out.push(`| ${r.id} | ${r.provenance} | ${r.host} | ${r.model || "—"} | — | — | — | — | — | — | ${r.ms}ms | 探测失败：${r.error} |`);
      continue;
    }
    const verdict = r.plan.degraded ? "降级（信号不足）" : r.confidence === "high" ? "高置信" : "低置信";
    out.push(
      `| ${r.id} | ${r.provenance} | ${r.host} | ${r.model} | ${r.signals.systemRole} | ${r.signals.contextWindow} | ${r.signals.usageReported} | ${r.plan.carrier} | ${r.plan.slot} | ${r.plan.budgetBytes} | ${r.ms}ms | ${verdict} |`,
    );
  }
  if (rejected.length) {
    out.push("");
    out.push("被拒条目（未发包）：");
    for (const r of rejected) out.push(`- ${r.id}：${r.reason}`);
  }
  return out.join("\n");
}

export function writeInventoryReport(run, outDir = "runs", { rejected = [] } = {}) {
  mkdirSync(outDir, { recursive: true });
  const stamp = run.at.replace(/[:.]/g, "-");
  const jsonPath = join(outDir, `inventory-${stamp}.json`);
  const mdPath = join(outDir, `inventory-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify({ ...run, rejected }, null, 2)}\n`);
  writeFileSync(mdPath, `${renderInventoryReport(run, { rejected })}\n`);
  return { jsonPath, mdPath, rendered: { jsonPath, mdPath } };
}

/**
 * 起步清单的来源表：全部是「自己注册 / 公开免费档 / 自建」三类，逐条有可引用的出处。
 * 出处：https://github.com/mnfst/awesome-free-llm-apis （读取于 2026-09-29，main 分支）
 * 该表是外部数据、会变：模型名与限额以对方文档为准，本表只用于生成填空骨架。
 * 模板里每条默认 skip:true —— 先跑一遍看账目，确认哪条要测再删掉它的 skip。
 */
export const FREE_TIER_SOURCES = [
  { id: "local-stub", baseUrl: "http://127.0.0.1:8787", model: "MOCK_MODEL", provenance: "local-stub", keyEnv: "", note: "本机桩（无需 key），用来验证链路" },
  { id: "local-ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "MODEL_ID", provenance: "self-hosted", keyEnv: "", note: "本机 ollama serve 的 OpenAI 兼容口" },
  { id: "local-vllm", baseUrl: "http://127.0.0.1:8000/v1", model: "MODEL_ID", provenance: "self-hosted", keyEnv: "IG5_LOCAL_KEY", note: "自建 vLLM / llama.cpp server" },
  { id: "groq", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", provenance: "own-account", keyEnv: "GROQ_API_KEY", note: "免费档；限额以控制台为准" },
  { id: "gemini-openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "MODEL_ID", provenance: "own-account", keyEnv: "GEMINI_API_KEY", note: "OpenAI 兼容路径；未在本机验证过该路径拼法" },
  { id: "mistral", baseUrl: "https://api.mistral.ai/v1", model: "MODEL_ID", provenance: "own-account", keyEnv: "MISTRAL_API_KEY", note: "免费模式默认开启；输入可能被用于训练" },
  { id: "zai-intl", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4.7-flash", provenance: "own-account", keyEnv: "ZAI_API_KEY", note: "国际站；国内站同款模型在 open.bigmodel.cn/api/paas/v4" },
  { id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-oss-20b:free", provenance: "own-account", keyEnv: "OPENROUTER_API_KEY", note: "免费模型带 :free 后缀，日限额低" },
  { id: "nvidia-nim", baseUrl: "https://integrate.api.nvidia.com/v1", model: "openai/gpt-oss-120b", provenance: "own-account", keyEnv: "NVIDIA_API_KEY", note: "需 NVIDIA 开发者计划；试用条款禁止提交机密数据" },
  { id: "modelscope", baseUrl: "https://api-inference.modelscope.cn/v1", model: "Qwen/Qwen3-8B", provenance: "own-account", keyEnv: "MODELSCOPE_API_KEY", note: "需绑定阿里云账号 + 实名" },
  { id: "siliconflow", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen3-8B", provenance: "own-account", keyEnv: "SILICONFLOW_API_KEY", note: "免费模型需实名验证" },
  { id: "ollama-cloud", baseUrl: "https://ollama.com/v1", model: "gpt-oss:20b", provenance: "own-account", keyEnv: "OLLAMA_API_KEY", note: "会话/周限额未公开" },
  { id: "ovh-anon", baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1", model: "gpt-oss-20b", provenance: "public-free", keyEnv: "", note: "匿名免费档（无需注册），每 IP 每模型 2 RPM" },
  { id: "llm7-anon", baseUrl: "https://api.llm7.io/v1", model: "gpt-oss:20b", provenance: "public-free", keyEnv: "", note: "匿名档；模型目录常换" },
  { id: "cloudflare-workers-ai", baseUrl: "https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/run", model: "@cf/openai/gpt-oss-120b", provenance: "own-account", keyEnv: "CF_API_TOKEN", note: "不是 OpenAI 兼容形状（路径要带 account id），探针可能测不出" },
];

/** 生成起步清单：全部 skip:true，填好一条删一条的 skip。 */
export function emitTemplate({ sources = FREE_TIER_SOURCES } = {}) {
  // keyEnv 为空表示「这条端点不需要密钥」——要整字段省掉，不能留空串：
  // validateEntry 会把空串当「写了但不是合法环境变量名」拒掉（那正是手写清单里该报的错）。
  const entries = sources.map((s) => {
    const { keyEnv, ...rest } = s;
    return keyEnv ? { ...rest, keyEnv, skip: true } : { ...rest, skip: true };
  });
  return `${JSON.stringify(
    {
      version: INVENTORY_VERSION,
      _说明: "起步清单：来源表读自 awesome-free-llm-apis（2026-09-29）。密钥只写环境变量名 keyEnv，不写密钥值。模板默认每条 skip:true，确认要测的条目把它的 skip 删掉即可。provenance 只能是：self-hosted / own-account / own-relay / local-stub / public-free。",
      entries,
    },
    null,
    2,
  )}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.version) {
    console.log(INVENTORY_VERSION);
    return 0;
  }
  if (args["emit-template"]) {
    const text = emitTemplate();
    if (args.out && args.out !== "runs") {
      writeFileSync(resolve(args.out), text);
      console.log(`已写出起步清单：${resolve(args.out)}（${FREE_TIER_SOURCES.length} 条，全部 skip:true）`);
    } else {
      process.stdout.write(text);
    }
    return 0;
  }
  if (args.help || !args.inventory) {
    console.log(HELP);
    return args.help ? 0 : 1;
  }
  const path = resolve(args.inventory);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    console.log(`失败：读不到清单 ${path}（${err.code ?? err.message}）`);
    return 1;
  }
  const inv = loadInventory(text);
  if (!inv.ok) {
    console.log(`失败：${inv.reason}`);
    return 1;
  }
  console.log(`清单：${path} · ${inv.entries.length} 条可巡检${inv.rejected.length ? ` · ${inv.rejected.length} 条被拒` : ""}`);
  for (const r of inv.rejected) console.log(`  拒：${r.reason}`);
  if (inv.entries.length === 0) {
    console.log("没有可巡检条目，停在清单校验。");
    return 1;
  }
  if (args["dry-run"]) {
    for (const e of inv.entries) console.log(`  计划：${e.id} → ${e.baseUrl}（${e.provenance}${e.keyEnv ? ` · keyEnv=${e.keyEnv}${process.env[e.keyEnv] ? "" : "（未设置）"}` : ""}）`);
    console.log("dry-run：未发任何网络包。");
    return 0;
  }
  const timeoutMs = Number(args["timeout-ms"]) > 0 ? Number(args["timeout-ms"]) : 20000;
  const padding = Number(args.padding) > 0 ? Number(args.padding) : 0;
  const kernelBytes = Number(process.env.IG5_KERNEL_BYTES) || 0;
  const run = await runInventory({ entries: inv.entries, timeoutMs, padding, kernelBytes });
  const report = renderInventoryReport(run, { rejected: inv.rejected });
  console.log(report);
  const outDir = resolve(args.out ?? "runs");
  const written = writeInventoryReport(run, outDir, { rejected: inv.rejected });
  console.log(`\n落盘：${written.mdPath} · ${written.jsonPath}`);
  if (args.json) console.log(`IG5_INVENTORY_JSON ${JSON.stringify({ version: run.version, rows: run.rows.length, stitchable: run.stitchable })}`);
  return run.rows.some((r) => r.error) ? 1 : 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main().then((code) => process.exit(code));
