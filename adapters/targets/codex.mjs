// 兼容层 · Codex / gpt-instruct 宿主
//
// 对齐 github.com/MDX-Tom/gpt-instruct 的部署协议（MIT；只借协议与判据，不复用其素材）：
//   - 载体：ZIP（内含唯一 .md）+ 根目录归档 SHA256
//   - 部署：只写自己管理的那个键（顶层 model_instructions_file），不动 provider / model / 认证
//   - 回滚：字段级 state 文件 + 时间戳快照 + 仅删除自己创建的文件
//
// 与 DSH 适配器的差别：这条通道没有工具注册、没有组装瀑布、没有投影，
// 所以领域索引必须内嵌（domainViaTool=false），末位锚点降级为段末锚点。

import { SLOT, DEDUPE, compileFlags, validateAdapter } from "../lib/adapter-spec.mjs";
import { sha256 } from "../lib/release-artifact.mjs";

export const TARGET_VERSION = "codex-1.x / gpt-instruct 协议对齐";

// 这条通道的硬约束：候选提示词 ≤ 8000 UTF-8 bytes（来自 gpt-instruct 的 epoch 规则）。
export const PROMPT_MAX_BYTES = 8000;

// 自己管理的键：只有这一个。写它、只写它、回滚只回滚它。
export const MANAGED_KEY = "model_instructions_file";
export const STATE_FILE = ".ig5-adapter-state.json";
export const STATE_VERSION = 2;

export const adapter = {
  id: "codex",
  label: "Codex / gpt-instruct（config.toml 提示词文件）",
  version: TARGET_VERSION,
  channel: "config-file",
  slot: SLOT.LAST,
  dedupe: DEDUPE.KEEP,
  caps: ["promptFile", "toolSurface"],
  notes: [
    "model_instructions_file 指向的 .md 由本适配器托管；其余键一概不碰。",
    "写入前对 config.toml 做时间戳快照，回滚只还原这一个键。",
    "无热加载：改盘上 .md 后需重启 Codex 会话。",
  ],
  budget: { kernelBytes: 22000, indexBytes: 7000, lazyBudgetBytes: 0, totalBytes: 30000 },
};

validateAdapter(adapter);

export function flags() {
  return compileFlags(adapter);
}

/**
 * 把编译产物摊成宿主文件布局：
 *   dist/codex/infinite-gen-5.md   ← 载荷（≤ PROMPT_MAX_BYTES 时可直接部署）
 *   dist/codex/manifest.json       ← 惰性表 + 指纹 + 回滚信息
 *   dist/codex/deploy.md           ← 部署与回滚步骤（人读）
 * 注意：本函数不写盘、不改 config.toml。改人家的配置文件是显式动作，走 deploy.mjs。
 */
export function layout(load, { prepared = [] } = {}) {
  const body = prepared.map((p) => p.text).join("\n\n");
  const payloadBytes = Buffer.byteLength(body, "utf8");
  const oversize = payloadBytes > PROMPT_MAX_BYTES;

  const deploy = [
    `# Codex / gpt-instruct 部署（${TARGET_VERSION}）`,
    ``,
    `1. 把 infinite-gen-5.md 放到 CODEX_HOME 下（例如 ~/.codex/infinite-gen-5.md）。`,
    `2. 在 config.toml 顶层写入且只写：`,
    ``,
    "```toml",
    `${MANAGED_KEY} = "./infinite-gen-5.md"`,
    "```",
    ``,
    `3. 位置规则：必须在第一个 \`[table]\` 之前；若顶层已有 \`model = \`，插在该行之后。`,
    `4. 回滚：把 config.toml.bak_<YYYYmmdd_HHMMSS_ffffff> 覆盖回去，或按 state 文件把 ${MANAGED_KEY} 还原为 previous 值。`,
    `5. 无热加载 —— 改完 .md 重启会话。`,
    ``,
    `载荷字节：${payloadBytes} / 上限 ${PROMPT_MAX_BYTES}${oversize ? "（超限：需裁掉内嵌索引后再部署）" : "（在限内）"}`,
    `语义指纹：${load.signature.semanticSha256.slice(0, 16)}`,
  ].join("\n");

  return {
    adapter: adapter.id,
    host: "codex",
    files: [
      { path: "infinite-gen-5.md", text: body, sha256: sha256(body), bytes: payloadBytes, managed: true },
      { path: "deploy.md", text: deploy, sha256: sha256(deploy), bytes: Buffer.byteLength(deploy, "utf8"), managed: false },
    ],
    deploySteps: [
      `快照：cp config.toml config.toml.bak_<YYYYmmdd_HHMMSS_ffffff>`,
      `读旧值：state.previous = 现有 ${MANAGED_KEY} 的值（没有则 null）`,
      `写入：${MANAGED_KEY} = "./infinite-gen-5.md"（只在首个 [table] 之前）`,
      `记录：${STATE_FILE} = {version:${STATE_VERSION}, key:"${MANAGED_KEY}", previous, written:{sha256, bytes}}`,
    ],
    rollback: load.signature ? undefined : undefined,
    warnings: [
      ...(oversize ? [`载荷 ${payloadBytes} B 超过 ${PROMPT_MAX_BYTES} B 上限，未裁剪不得部署`] : []),
      "禁止在无快照的情况下直接改 config.toml",
      "禁止跨身份拼接成绩（本通道跑出的结果不得与 DSH 通道的成绩合并统计）",
    ],
  };
}

export function stateRecord({ previousValue, writtenSha, writtenBytes }) {
  return {
    version: STATE_VERSION,
    key: MANAGED_KEY,
    previous: previousValue ?? null,
    managed: { sha256: writtenSha, bytes: writtenBytes, existed_before: previousValue != null },
  };
}

// 把 state 记录翻译成回滚动作 —— 只动自己写的键，且只在 sha 匹配时删自己创建的文件。
export function planRollback(state, { currentSha }) {
  const lines = [];
  if (state.previous == null) {
    lines.push(`删除 ${MANAGED_KEY} 行（本适配器插入的）`);
  } else {
    lines.push(`把 ${MANAGED_KEY} 还原为 ${JSON.stringify(state.previous)}`);
  }
  if (state.managed?.existed_before === false) {
    lines.push(
      currentSha && currentSha !== state.managed.sha256
        ? "托管 .md 内容已被外部修改 → preserved（不删）"
        : "删除托管的 infinite-gen-5.md",
    );
  }
  return lines;
}

export default adapter;

/**
 * 安装计划（纯数据，默认 dry-run）。写宿主真实配置是显式动作：
 *   node deploy.mjs --target codex --apply --codex-home <DIR>
 * 本函数只产生计划，永远不自己动手。
 */
adapter.mount = function mount({ dryRun = true, load = null, hostDir = "<CODEX_HOME>" } = {}) {
  return {
    adapter: adapter.id,
    host: "codex",
    dryRun,
    writes: [
      {
        path: `${hostDir}/infinite-gen-5.md`,
        kind: "payload",
        bytes: load ? load.budget.residentBytes : 0,
        reason: `写入载荷；已存在同 sha256 时跳过`,
      },
      {
        path: `${hostDir}/config.toml`,
        kind: "field-replace",
        key: MANAGED_KEY,
        value: './infinite-gen-5.md',
        where: "首个 [table] 之前；若有顶层 model = 则紧随其后",
        reason: "只改这一个键，其余键与注释原样保留",
      },
      {
        path: `${hostDir}/${STATE_FILE}`,
        kind: "state",
        reason: "记录 previous 值与托管文件 sha256，供 --reset 判定",
      },
    ],
    snapshot: `cp ${hostDir}/config.toml ${hostDir}/config.toml.bak_<YYYYmmdd_HHMMSS_ffffff>`,
    rollback: planRollback(
      { previous: "<STATE.previous>", managed: { sha256: "<STATE.managed.sha256>", existed_before: false } },
      { currentSha: "<当前文件的 sha256>" },
    ),
    verify: [
      `node build-adapters.mjs --target codex --check`,
      `node verify_adapters.mjs --target codex`,
    ],
    notes: [
      "apply 前必须存在时间戳快照；无快照的计划不允许执行",
      "本通道无热加载：部署后需重启会话",
    ],
  };
};
