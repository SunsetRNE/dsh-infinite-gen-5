// 无限五代 · 第五通道：模型 API 端点（endpoint-relay）
//
// 这一条与前面四条的本质差别：**没有宿主会话**。
// dsh / codex / claude / generic 都是「把载荷装进某个宿主，宿主自己去跟模型说话」；
// 这里是本进程直接对端点发 /chat/completions，回执原样回到本进程手里。
//
// 因此它有两个别处没有的性质：
//   1) 位次是**确定的**：system 段一定在 messages[0]，末位锚点追加在最后一轮 user 末尾。
//      没有「宿主组装瀑布」这种不可控因素 —— 这一条上锚点强度可证，不靠承诺。
//   2) 可批量：同一次运行里能对同一端点跑 N 条探针，逐条拿回执 —— 这是「定向」两字的来源：
//      定向 = 锁一个端点 + 一个模型版本 + 一份题库，测的是这个组合的穿透面，不是泛泛的「模型行不行」。
//
// 但正因为不经宿主，**没有去重可言**：本通道 dedupe=KEEP，载荷重复装载不会被谁拦下，
// 由调用方保证一次运行只装一份内核。

import { sha256 } from "../lib/release-artifact.mjs";

export const TARGET_ID = "api-endpoint";
export const TARGET_VERSION = "ig5-endpoint-relay/1";
/** 端点形态：OpenAI 兼容 chat completions。非兼容端点改 targets 侧适配，不改 core。 */
export const WIRE_SHAPE = "openai-compatible/chat-completions";
export const REQUEST_FILE = "api-endpoint.request.json";

const ANCHOR_ID = "core.tail-anchor";

/** 组装 messages。内核进 system；末位锚点追加到最后一轮 user 的末尾（本通道唯一可控的末位）。 */
export function messagesFor(load, { prepared = [], userMessage = "PROBE_PAYLOAD" } = {}) {
  const resident = prepared.filter((p) => p.id !== ANCHOR_ID).map((p) => p.text);
  const anchor = prepared.find((p) => p.id === ANCHOR_ID)?.text ?? load?.blocks?.find((b) => b.id === ANCHOR_ID)?.text ?? "";
  const system = resident.join("\n\n");
  const user = anchor ? `${userMessage}\n\n${anchor}` : userMessage;
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });
  return messages;
}

/** 请求体模板：只含形状与占位符，**不含密钥**。密钥在运行时由 provider-api 注入。 */
export function buildRequest(load, { prepared = [], userMessage = "PROBE_PAYLOAD", model = "TARGET_MODEL", maxTokens = 4096, temperature = 0 } = {}) {
  return {
    model,
    messages: messagesFor(load, { prepared, userMessage }),
    temperature,
    max_tokens: maxTokens,
  };
}

export const adapter = {
  id: TARGET_ID,
  label: "模型 API 端点（直连 /chat/completions）",
  version: TARGET_VERSION,
  channel: "endpoint-relay",
  slot: "last",
  dedupe: "keep",
  caps: ["endpointRelay"],
  budget: {
    kernelBytes: 20000,
    indexBytes: 9000,
    lazyBudgetBytes: 0,
    totalBytes: 32000,
  },
};

export function flags() {
  return Object.freeze({
    endpointRelay: true,
    // 端点无工具面 → 领域包必须内嵌索引；无热加载 → 惰性章节不参与装载。
    domainViaTool: false,
    lazyEnabled: false,
    tailAnchor: true, // 位置可控，见文件头第 1 条
    dedupe: "keep",
  });
}

export function layout(load, { prepared = [], model = "TARGET_MODEL", maxTokens = 4096 } = {}) {
  const request = buildRequest(load, { prepared, model, maxTokens });
  const serialized = JSON.stringify(request, null, 2);
  const system = request.messages[0]?.role === "system" ? request.messages[0].content : "";
  const warnings = [];
  if (!system) warnings.push("载荷为空：prepared 里没有可常驻块，端点通道不能空转");
  if (prepared.some((p) => p.id === ANCHOR_ID) === false) warnings.push("prepared 里没有 core.tail-anchor：本通道的末位保证失效，降级为段首锚点");
  return {
    wire: WIRE_SHAPE,
    request,
    files: [
      {
        path: REQUEST_FILE,
        bytes: Buffer.byteLength(serialized, "utf8"),
        sha256: sha256(serialized),
        managed: false,
        note: "请求体模板：密钥占位符由运行时环境变量替换，文件本身可安全入库",
      },
    ],
    messages: request.messages.map((m) => ({ role: m.role, bytes: Buffer.byteLength(m.content, "utf8") })),
    deploySteps: [
      "注入端点三件套：IG5_RELAY_BASE_URL / IG5_RELAY_API_KEY / IG5_RELAY_MODEL（密钥只走环境变量）",
      "先跑一条 dry-run 确认请求体形状：node probe-runner.mjs --dry-run --limit 1",
      "确认预算：probe-runner 的 maxRequests / maxTotalTokens / maxWallMs 三项都要显式给",
      "正式跑批：node probe-runner.mjs --bank BANK.md --out runs/ --concurrency 2",
    ],
    warnings,
  };
}

/** 安装计划：只落一个**不含密钥**的请求模板 + 一份跑批说明，不碰任何宿主的配置文件。 */
export function mount({ dryRun = true, load = null, hostDir = ".", prepared = [], model = "TARGET_MODEL" } = {}) {
  const plan = layout(load, { prepared, model });
  const writes = plan.files.map((f) => ({ path: `${hostDir}/${f.path}`, bytes: f.bytes, sha256: f.sha256, dryRun }));
  return {
    adapter: TARGET_ID,
    host: hostDir,
    dryRun,
    writes,
    notes: [
      "端点通道不改宿主配置：可写面只有请求模板与运行日志。",
      "密钥不落盘。回执日志里的 Authorization 一律经 redact() 处理。",
      "本通道无去重：同一端点重复装载内核不会被拦，由调用方保证。",
    ],
  };
}

export default adapter;
