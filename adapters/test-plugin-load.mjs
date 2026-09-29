// test-plugin-load.mjs — 打过补丁的 dsh-infinite-gen-5/index.js 能不能加载、apply 后工具是否齐。
//
// 判据三条：
//   P1 模块图能加载（含补丁新增的 ./ig5-relay-plugin.mjs），默认导出是函数
//   P2 假 ctx 调 apply()：不抛错，或抛出「需要哪个宿主 API」——后者是环境边界，不是补丁错
//   P3 注册到的工具名覆盖既有四件 + 补丁两件（infinite_gen5_relay / infinite_gen5_skills）
//
// 跑法：node test-plugin-load.mjs [--plugin /root/dsh-infinite-gen-5/index.js]

import { resolveKernelRoot } from "./lib/kernel-root.mjs";

const pluginPath =
  (process.argv.includes("--plugin") && process.argv[process.argv.indexOf("--plugin") + 1]) ||
  resolveKernelRoot() + "/index.js";

const EXPECTED_BASE = ["infinite_gen5_profile", "infinite_gen5_scenario", "infinite_gen5_env", "infinite_gen5_dispatch"];
const EXPECTED_PATCH = ["infinite_gen5_relay", "infinite_gen5_skills"];

const results = [];
function record(id, claim, ok, detail) {
  results.push({ id, claim, ok, detail: detail ?? null });
  console.log(`  ${ok ? "ok  " : "FAIL"} ${id}  ${claim}${ok ? "" : `  → ${detail}`}`);
}

function makeFakeCtx(caps) {
  const noop = () => {};
  const chainable = new Proxy(noop, { get: () => chainable, apply: () => chainable });
  const base = {
    tools: {
      register(tool) {
        caps.tools.push(tool);
        return noop;
      },
    },
    effect(fn) {
      caps.effects += 1;
      try {
        fn();
      } catch (error) {
        caps.effectErrors.push(String((error && error.message) || error));
      }
      return noop;
    },
    systemPrompt: {
      section(spec) {
        caps.sections.push(spec);
        return noop;
      },
      context(spec) {
        caps.contexts.push(spec);
        return noop;
      },
      assemble: chainable,
    },
    logger: { info: noop, warn: noop, error: noop, debug: noop },
  };
  return new Proxy(base, {
    get(target, key) {
      if (key in target) return target[key];
      return chainable;
    },
  });
}

async function main() {
  const caps = { tools: [], effects: 0, effectErrors: [], sections: [], contexts: [] };

  let mod;
  try {
    mod = await import(pluginPath);
  } catch (error) {
    record("P1", "模块图能加载（含补丁 import）", false, String((error && error.message) || error));
    return finish();
  }
  record("P1", "模块图能加载（含补丁 import）", typeof mod.default === "function" || typeof mod.apply === "function", `default=${typeof mod.default} apply=${typeof mod.apply}`);

  const apply = mod.apply ?? mod.default;
  let applyError = null;
  try {
    const out = apply(makeFakeCtx(caps));
    if (out && typeof out.then === "function") await out;
  } catch (error) {
    applyError = String((error && error.message) || error);
  }
  const missingApi = applyError && /is not a function|undefined|cannot read/i.test(applyError) ? applyError : null;
  record(
    "P2",
    "假 ctx 调 apply() 不因补丁报错",
    applyError === null,
    applyError ? `需要宿主 API 或环境：${applyError.slice(0, 160)}（本机无 DSH 宿主，属边界）` : "无错误",
  );

  const names = caps.tools.map((t) => t.name);
  const haveBase = EXPECTED_BASE.filter((n) => names.includes(n));
  const havePatch = EXPECTED_PATCH.filter((n) => names.includes(n));
  const ok = haveBase.length === EXPECTED_BASE.length && havePatch.length === EXPECTED_PATCH.length;
  record(
    "P3",
    "工具注册覆盖既有四件 + 补丁两件",
    ok,
    `既有 ${haveBase.length}/4${haveBase.length !== 4 ? `（缺 ${EXPECTED_BASE.filter((n) => !names.includes(n)).join(",")}）` : ""} · 补丁 ${havePatch.length}/2 · 实际注册 ${names.length} 件`,
  );

  return finish();
}

function finish() {
  const passed = results.filter((r) => r.ok).length;
  console.log(`结果：${passed}/${results.length} 条判据通过`);
  console.log(`（P2 未过时请看 detail 里点名缺的宿主 API —— 那是环境边界，不是补丁缺陷）`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
