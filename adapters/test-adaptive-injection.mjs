// test-adaptive-injection.mjs — 自动注入判据（假 ctx，不碰真宿主）。
//
// 判据七条：
//   G1 没缓存就不注册段（空手不装样子）
//   G2 live 探针 → 落盘 → 组装期读缓存并注册系统提示段（名字/order/正文口径）
//   G3 缓存过期仍注册，但正文写「过期：… 重跑 adapt 刷新」（不谎称新鲜）
//   G4 逐轮注入默认关：只注册段，不注册 context
//   G5 显式开 IG5_ADAPT_TURN_INJECT=1：注册 context；触发词命中才出正文，未命中回空串；预算装不下要写出来
//   G6 组装路径零网络包：注册 + 逐轮渲染前后，桩计数不变
//   G7 降级：无 systemPrompt.section / 无 context() 都不抛，且照实记 skipped
//
// 跑法：node test-adaptive-injection.mjs

import { resolvePromptsDir } from "./lib/kernel-root.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

import {
  registerAdaptiveInjection,
  readAdaptCache,
  renderTurnInject,
  relayTool,
} from "./ig5-relay-plugin.mjs";

const results = [];
function record(id, claim, ok, detail) {
  results.push({ id, claim, ok });
  console.log(`  ${ok ? "ok  " : "FAIL"} ${id}  ${claim}${ok ? "" : `  → ${detail}`}`);
}

function envReader(map) {
  return (key) => map[key];
}

function makeCtx({ section = true, context = true } = {}) {
  const noop = () => {};
  const caps = { sections: [], contexts: [], effects: 0, effectErrors: [] };
  const base = {
    effect(fn) {
      caps.effects += 1;
      try {
        fn();
      } catch (error) {
        caps.effectErrors.push(String((error && error.message) || error));
      }
      return noop;
    },
    tools: { register: (tool) => caps.tools.push(tool) },
    logger: { info: noop, warn: noop, error: noop, debug: noop },
  };
  if (section) {
    base.systemPrompt = {
      section(spec) {
        caps.sections.push(spec);
        return noop;
      },
    };
    if (context) {
      base.systemPrompt.context = (spec) => {
        caps.contexts.push(spec);
        return noop;
      };
    }
  }
  return { ctx: base, caps };
}

/** 兼容桩：收 system、回 usage、自报 131072 上下文窗口。 */
function startAdaptMock() {
  const state = { hits: 0 };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      state.hits += 1;
      res.writeHead(200, {
        "content-type": "application/json",
        "x-context-window": "131072",
        "x-model": "TARGET_MODEL",
        "x-request-id": "REQ_PLACEHOLDER",
      });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: `ok ${body.length}` } }],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port }));
  });
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "ig5-adapt-test-"));
  const cachePath = join(dir, "cache.json");
  const mock = await startAdaptMock();
  const reader = envReader({
    IG5_ADAPT_CACHE: cachePath,
    IG5_RELAY_BASE_URL: `http://127.0.0.1:${mock.port}/v1`,
    IG5_RELAY_API_KEY: "KEY_PLACEHOLDER",
    IG5_RELAY_MODEL: "TARGET_MODEL",
    IG5_RELAY_TIMEOUT_MS: "4000",
  });

  // G1 没缓存 → 不注册
  const g1 = makeCtx();
  const r1 = await registerAdaptiveInjection(g1.ctx, { reader });
  record(
    "G1",
    "没缓存就不注册段（reason=cache:no-cache）",
    r1.registered === false && r1.reason === "cache:no-cache" && g1.caps.sections.length === 0,
    JSON.stringify({ reason: r1.reason, sections: g1.caps.sections.length }),
  );

  // G2 live 探针 → 落盘 → 组装期读缓存注册段
  const adapt = await relayTool({ reader }).execute({ action: "adapt", live: true });
  const cache = readAdaptCache(reader);
  const g2 = makeCtx();
  const r2 = await registerAdaptiveInjection(g2.ctx, { reader });
  const spec = g2.caps.sections[0] ?? { name: null, order: null, text: "" };
  const bytes = Buffer.byteLength(spec.text, "utf8");
  record(
    "G2",
    "live 探针落盘 → 注册 ig5-adapt:endpoint（order 101，正文含载体/槽位/预算/纪律）",
    adapt.ok === true &&
      adapt.cache?.ok === true &&
      cache.ok === true &&
      cache.fresh === true &&
      cache.plan?.carrier === "system" &&
      spec.name === "ig5-adapt:endpoint" &&
      spec.order === 101 &&
      bytes <= 1400 &&
      spec.text.includes("载体：system") &&
      spec.text.includes("槽位：LAST") &&
      spec.text.includes("预算：40000") &&
      spec.text.includes("纪律：") &&
      spec.text.includes("不等于末位锚点生效"),
    JSON.stringify({
      adaptOk: adapt.ok,
      cache: adapt.cache,
      name: spec.name,
      order: spec.order,
      bytes,
    }),
  );

  // G3 过期缓存
  const stale = JSON.parse(
    (await import("node:fs")).readFileSync(cachePath, "utf8"),
  );
  stale.at = Date.now() - 7 * 3600 * 1000;
  (await import("node:fs")).writeFileSync(cachePath, `${JSON.stringify(stale)}\n`);
  const g3 = makeCtx();
  const r3 = await registerAdaptiveInjection(g3.ctx, { reader });
  const text3 = g3.caps.sections[0]?.text ?? "";
  const cache3 = readAdaptCache(reader);
  record(
    "G3",
    "缓存过期仍注册，但正文标注「过期：…重跑 adapt 刷新」",
    cache3.stale === true &&
      r3.registered === true &&
      text3.includes("过期：") &&
      text3.includes("重跑 adapt 刷新") &&
      !text3.includes("未过期"),
    JSON.stringify({ stale: cache3.stale, registered: r3.registered }),
  );

  // G4 逐轮注入默认关
  const g4 = makeCtx();
  const r4 = await registerAdaptiveInjection(g4.ctx, { reader });
  record(
    "G4",
    "逐轮注入默认关：只注册段，不注册 context",
    g4.caps.sections.length === 1 &&
      g4.caps.contexts.length === 0 &&
      r4.skipped.some((s) => String(s).startsWith("turn-inject:off")),
    JSON.stringify({ sections: g4.caps.sections.length, contexts: g4.caps.contexts.length, skipped: r4.skipped }),
  );

  // G5 显式开逐轮注入
  const reader5 = envReader({
    IG5_ADAPT_CACHE: cachePath,
    IG5_ADAPT_TURN_INJECT: "1",
    IG5_PROMPT_DIR: resolvePromptsDir(),
    IG5_ADAPTERS_DIR: "/root/ig5-adapters",
  });
  const g5 = makeCtx();
  const r5 = await registerAdaptiveInjection(g5.ctx, { reader: reader5 });
  const turnSpec = g5.caps.contexts[0];
  const hit = typeof turnSpec?.text === "function" ? turnSpec.text({ text: "让子代理去跑这一片" }) : "";
  const miss = typeof turnSpec?.text === "function" ? turnSpec.text({ text: "这一轮只是问个好" }) : "x";
  const tight = renderTurnInject(
    { text: "让子代理去跑这一片" },
    { units: [{ id: "L_dispatch", triggers: ["子代理"], body: "BODY_PLACEHOLDER" }], plan: { lazyBudgetBytes: 4 } },
  );
  record(
    "G5",
    "开了逐轮注入：context 注册 + 触发词命中出正文 + 未命中回空串 + 预算装不下写出来",
    r5.turn?.name === "ig5-adapt:turn" &&
      typeof turnSpec?.text === "function" &&
      hit.includes("<!-- ig5 动态注入（触发词命中 L_dispatch）") &&
      hit.includes("Dispatch rule") &&
      miss === "" &&
      tight.includes("预算") &&
      tight.includes("装不下"),
    JSON.stringify({ turn: r5.turn, hitChars: hit.length, miss: miss.length, tight: tight.length }),
  );

  // G6 组装路径零网络包
  const before = mock.state.hits;
  const g6 = makeCtx();
  await registerAdaptiveInjection(g6.ctx, { reader: reader5 });
  g6.caps.contexts[0]?.text({ text: "让子代理去跑这一片" });
  const after = mock.state.hits;
  record(
    "G6",
    "组装路径（注册 + 逐轮渲染）零网络包",
    before === after && before === 1,
    `hits ${before} → ${after}（live 探针只发过 1 次）`,
  );

  // G7 两处降级
  const g7a = makeCtx({ section: false });
  const r7a = await registerAdaptiveInjection(g7a.ctx, { reader: reader5 });
  const g7b = makeCtx({ context: false });
  const r7b = await registerAdaptiveInjection(g7b.ctx, { reader: reader5 });
  record(
    "G7",
    "降级：无 systemPrompt.section / 无 context() 都不抛且照实记",
    r7a.registered === false &&
      r7a.reason === "no-systemPrompt-section" &&
      g7b.caps.sections.length === 1 &&
      r7b.reason === "no-systemPrompt-context" &&
      g7b.caps.contexts.length === 0,
    JSON.stringify({ a: r7a.reason, b: r7b.reason }),
  );

  mock.server.close();
  rmSync(dir, { recursive: true, force: true });

  const passed = results.filter((r) => r.ok).length;
  console.log(`结果：${passed}/${results.length} 条判据通过`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(`测试自身出错：${String((error && error.stack) || error)}`);
  process.exit(2);
});
