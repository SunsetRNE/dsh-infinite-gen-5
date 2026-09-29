#!/usr/bin/env node
// 无限五代 · 定向探针跑批器（endpoint relay probe runner）
//
// 「定向」在这里是可验证的三件事，不是形容词：
//   锁一个端点（baseUrl）· 锁一个模型版本（model + reasoning）· 锁一份题库与一份内核指纹。
// 换掉任意一项，产出的分数与前一次就不可比 —— 这一点由 identityOf/comparable 硬拦，
// 不靠人记。跑出来的每一次运行都落一条 JSONL，带身份三元组与载荷指纹，可离线复算。
//
// 用法：
//   node probe-runner.mjs --dry-run --limit 4              # 本地桩，全程 loopback，不需要密钥
//   node probe-runner.mjs --mock --limit 8 --out runs/     # 同上，显式模式
//   IG5_RELAY_BASE_URL=... IG5_RELAY_API_KEY=... IG5_RELAY_MODEL=... \
//     node probe-runner.mjs --bank BANK.md --concurrency 2 --max-requests 120
//
// 预算三门（maxRequests / maxTotalTokens / maxWallMs）触顶即停，不续跑。

import { resolveKernelRoot } from "./lib/kernel-root.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readSources, readDomainIndex, DEFAULT_TRUTH, DEFAULT_DATA } from "./build-adapters.mjs";
import { compileLoad } from "./lib/kernel-compiler.mjs";
import { adapter as apiAdapter, layout as apiLayout, TARGET_VERSION, WIRE_SHAPE } from "./targets/api-endpoint.mjs";
import { resolveRelay, chatComplete, createLedger, pool, DEFAULT_BUDGET, redact } from "./lib/provider-api.mjs";
import { sha256, identityOf, comparable } from "./lib/release-artifact.mjs";
import { createMockServer, MOCK_VERSION } from "./mock-endpoint.mjs";

export const RUN_SCHEMA = "ig5-probe-run/1";
export const KERNEL_DIR = resolveKernelRoot();

const flag = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

/** 收一批回执文本 → 逐条 receipt（去重靠 scoreResults 里的 first-wins）。 */
export function harvest(dispatchApi, replies) {
  const receipts = [];
  const unparsed = [];
  for (const r of replies) {
    const got = dispatchApi.extractReceipts(r.text ?? "");
    if (!got.length) unparsed.push({ shardId: r.shardId, ids: r.ids, chars: (r.text ?? "").length, httpStatus: r.httpStatus });
    for (const item of got) receipts.push(item);
  }
  return { receipts, unparsed };
}

/** 跨身份不可比：同一端点/模型/推理等级的运行才能拼。 */
export function guardIdentity(prevPath, identity) {
  if (!prevPath || !existsSync(prevPath)) return { ok: true, checked: false };
  const prev = JSON.parse(readFileSync(prevPath, "utf8"));
  const ok = comparable(prev.identity, identity);
  return {
    ok,
    checked: true,
    prevIdentity: prev.identity?.tuple ?? null,
    reason: ok ? "同身份，可对照" : `身份不同：${prev.identity?.tuple ?? "?"} ≠ ${identity.tuple}；禁止跨身份拼接成绩`,
  };
}

async function main() {
  const truthDir = flag("truth", DEFAULT_TRUTH);
  const dataDir = flag("data", DEFAULT_DATA);
  const bankPath = flag("bank", null);
  const outDir = flag("out", "runs");
  const limit = Number(flag("limit", 4));
  const perRequest = Number(flag("per-request", 1));
  const concurrency = Number(flag("concurrency", DEFAULT_BUDGET.concurrency));
  const maxRequests = Number(flag("max-requests", DEFAULT_BUDGET.maxRequests));
  const maxTotalTokens = Number(flag("max-tokens", DEFAULT_BUDGET.maxTotalTokens));
  const maxWallMs = Number(flag("max-wall-ms", DEFAULT_BUDGET.maxWallMs));
  const model = flag("model", process.env.IG5_RELAY_MODEL ?? "TARGET_MODEL");
  const reasoning = flag("reasoning", process.env.IG5_RELAY_REASONING ?? "");
  const dryRun = has("dry-run") || has("mock");
  const json = has("json");

  const dispatchApi = await import(pathToFileURL(join(KERNEL_DIR, "dispatch.mjs")).href);

  const bank = dispatchApi.loadBank(bankPath ?? undefined);
  const items = limit > 0 ? bank.items.slice(0, limit) : bank.items;

  const sources = readSources(truthDir);
  const index = readDomainIndex(dataDir, { aliasLimit: 4 });
  const load = compileLoad({
    sources: { ...sources, index: index.text },
    adapter: apiAdapter,
    flags: apiAdapter.caps,
    outDir,
    fileName: "api-endpoint.payload.md",
  });
  const prepared = load.blocks.map((b) => ({ id: b.id, text: b.text, bytes: b.bytes }));

  // 端点：dry-run 起本地桩（loopback，无密钥）；否则从环境变量取。
  let server = null;
  let relay;
  if (dryRun) {
    server = createMockServer({ model: "MOCK_MODEL" });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    relay = Object.freeze({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: "MOCK_KEY",
      model: "MOCK_MODEL",
      reasoning: "",
      timeoutMs: 20_000,
      problems: [],
      ready: true,
    });
  } else {
    relay = resolveRelay(process.env, { model, reasoning });
    if (!relay.ready) {
      console.error(`端点未就绪：\n  - ${relay.problems.join("\n  - ")}`);
      console.error("降级路径（adapter-spec DEGRADE.endpointRelay）：只产出请求体模板，不宣称取得回执。");
      console.error(`  请求体模板：${apiLayout(load, { prepared, model }).files[0].path}`);
      return 2;
    }
  }

  const identity = identityOf({ model: relay.model, reasoning: relay.reasoning || "(default)", carrier: WIRE_SHAPE });
  const guard = guardIdentity(flag("baseline", null), identity);
  if (!guard.ok && !has("allow-cross-identity")) {
    console.error(`拒绝运行：${guard.reason}`);
    return 3;
  }

  const ledger = createLedger({ maxRequests, maxTotalTokens, maxWallMs, concurrency });
  const groups = dispatchApi.shard(items, perRequest);
  const startedAt = new Date().toISOString();

  const runs = await pool(
    groups,
    async (group) => {
      const admit = ledger.admit();
      if (!admit.ok) return { shardId: group.shardId, ids: group.items.map((i) => i.id), status: "skipped", reason: admit.reason, text: "" };
      const userMessage = dispatchApi.renderDispatch(group.items, { index: group.index, total: groups.length, shardId: group.shardId });
      const messages = apiLayout(load, { prepared }).request.messages.map((m) => ({ ...m }));
      messages[messages.length - 1].content = `${userMessage}\n\n${messages[messages.length - 1].content.split("\n\n").slice(-1)[0] ?? ""}`;
      const res = await chatComplete({ relay, messages, temperature: 0, maxTokens: 4096 });
      ledger.settle(res.usage);
      if (!res.ok) ledger.fail();
      return {
        shardId: group.shardId,
        ids: group.items.map((i) => i.id),
        status: res.ok ? (res.skipped ? "dry" : "ok") : "failed",
        httpStatus: res.status,
        attempts: res.attempts,
        error: res.error ? redact(res.error, relay.apiKey) : undefined,
        text: redact(res.text ?? "", relay.apiKey),
      };
    },
    concurrency,
  );

  if (server) await new Promise((r) => server.close(r));

  const { receipts, unparsed } = harvest(dispatchApi, runs);
  const score = dispatchApi.scoreResults(items, receipts);
  const finishedAt = new Date().toISOString();
  const record = {
    schema: RUN_SCHEMA,
    startedAt,
    finishedAt,
    identity,
    kernel: { semanticSha256: load.signature.semanticSha256, bytes: load.signature.bytes, version: load.kernelVersion },
    adapter: { id: apiAdapter.id, version: TARGET_VERSION, wire: WIRE_SHAPE },
    bank: { source: bank.source, items: bank.items.length, probed: items.length, missing: bank.missing.length },
    budget: { maxRequests, maxTotalTokens, maxWallMs, concurrency },
    ledger: ledger.state,
    score: { counts: score.counts, answered: score.answered, n: score.n, score: score.score, grade: score.grade?.id ?? null },
    shards: runs.map((r) => ({
      shardId: r.shardId,
      ids: r.ids,
      status: r.status,
      httpStatus: r.httpStatus,
      attempts: r.attempts,
      bytes: Buffer.byteLength(r.text ?? "", "utf8"),
      responseSha256: sha256(r.text ?? ""),
      error: r.error ?? null,
    })),
    receipts: receipts.map((r) => dispatchApi.normalizeReceipt(r)),
    unparsed,
    mock: dryRun ? MOCK_VERSION : null,
  };
  record.digest = sha256(JSON.stringify({ ...record, digest: undefined }));

  mkdirSync(outDir, { recursive: true });
  const stem = `run-${finishedAt.replace(/[:.]/g, "-")}`;
  const jsonlPath = join(outDir, `${stem}.jsonl`);
  const reportPath = join(outDir, `${stem}.md`);
  writeFileSync(join(outDir, `${stem}.json`), JSON.stringify(record, null, 2));
  writeFileSync(
    jsonlPath,
    `${record.shards.map((s) => JSON.stringify(s)).join("\n")}\n`,
  );
  writeFileSync(
    reportPath,
    [
      `# 定向探针跑批 · ${startedAt}`,
      "",
      `身份：${identity.tuple}`,
      `载荷语义指纹：${record.kernel.semanticSha256}`,
      `端点：${dryRun ? "本地桩（loopback，非真实模型）" : relay.baseUrl}`,
      `题库：${bank.source} · 本次探针 ${items.length}/${bank.items.length}`,
      "",
      dispatchApi.renderScoreReport(score, "端点通道定向探针结果"),
      "",
      `未解析回执的请求：${unparsed.length}（${unparsed.map((u) => u.shardId).join(", ") || "无"}）`,
      `记账：请求 ${ledger.state.requests} · token ${ledger.state.totalTokens} · 失败 ${ledger.state.failures}${ledger.state.stopReason ? ` · 停止原因 ${ledger.state.stopReason}` : ""}`,
    ].join("\n"),
  );

  if (json) {
    console.log(`IG5_PROBE_RUN ${JSON.stringify({ identity: identity.tuple, digest: record.digest, counts: record.score.counts, unparsed: unparsed.length, out: `${outDir}/${stem}.json` })}`);
  } else {
    console.log(`身份：${identity.tuple}`);
    console.log(`载荷语义指纹：${record.kernel.semanticSha256} · 端点：${dryRun ? "本地桩" : relay.baseUrl}`);
    console.log(`四态：${JSON.stringify(record.score.counts)} · 未解析 ${unparsed.length} 条`);
    console.log(`产物：${outDir}/${stem}.json / .jsonl / .md`);
  }
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`跑批失败：${err?.stack ?? err}`);
    process.exit(1);
  });
}

export { main };
