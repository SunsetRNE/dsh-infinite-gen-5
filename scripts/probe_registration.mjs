#!/usr/bin/env node
// 端到端注册探针（v0.41.1）：用「宿主同判据」的桩 ctx 真跑一遍 apply(ctx)，证明六名工具
// 都能通过 tools.register 的硬校验 —— 缺 output.render 会让整份插件激活时抛 TypeError 而
// 完全不加载（2026-09-29 的启动日志：tool "infinite_gen5_relay" must declare output …）。
//
// 用法：node scripts/probe_registration.mjs [插件目录…]
//   缺省按顺序探：仓库自身、运行态副本 ~/.dsh/plugin-src/dsh-infinite-gen-5（存在才探）。
// 退出码：0 = 全部通过；1 = 有目录注册失败。
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const home = process.env.HOME || "/root";
const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [repo, path.join(home, ".dsh/plugin-src/dsh-infinite-gen-5")];

// 与宿主逐字对齐的判据（dsh-tools lib/index.js:2881 的 register 校验）：
// output 是对象、render 是函数、presentationMeta 可缺省但给了就必须是函数。
function hostOutputOk(output) {
  return (
    output !== undefined &&
    typeof output === "object" &&
    typeof output.render === "function" &&
    (output.presentationMeta === undefined || typeof output.presentationMeta === "function")
  );
}

let failed = 0;
for (const dir of targets) {
  const entry = path.join(dir, "index.js");
  if (!existsSync(entry)) {
    console.log(`- 跳过（没有 index.js）：${dir}`);
    continue;
  }
  const registered = [];
  const store = new Map();
  const ctx = {
    systemPrompt: {
      section(spec) {
        store.set(spec.name, spec);
        return () => store.delete(spec.name);
      },
      context() {
        return () => {};
      },
      layers: { merge: () => new Map(store), global: { sections: { entries: () => store.entries() } } },
    },
    tools: {
      register(tool) {
        if (!hostOutputOk(tool && tool.output)) {
          throw new TypeError(
            `tool "${tool && tool.name}" must declare output { schema, render, presentationMeta? }`,
          );
        }
        registered.push(tool.name);
      },
    },
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === "function") return dispose;
    },
    on: () => () => {},
    get: () => undefined,
    inject: () => {},
    logger: { info() {}, warn() {}, debug() {} },
  };
  try {
    const mod = await import(entry);
    mod.apply(ctx);
    console.log(`✓ ${dir} —— 注册 ${registered.length} 名工具：${registered.sort().join(", ")}`);
  } catch (error) {
    failed += 1;
    console.log(`✗ ${dir} —— ${(error && error.message) || String(error)}`);
  }
}
process.exit(failed ? 1 : 0);
