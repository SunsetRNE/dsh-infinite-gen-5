#!/usr/bin/env node
// verify_step_inject.mjs — 回归判据：每步注入进收件箱的消息必须带 source，且默认档位是 off。
// 用法：node scripts/verify_step_inject.mjs   （退出码非 0 = 回归）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "index.js"), "utf8");
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};

// 1) 客户端读收件箱的真实表达式（dsh-client-ui-chat/lib/client.js:5095 逐字复刻）：
//    inbox?.["next-step"].filter((message) => message.source.kind === "user")
const clientFilter = (inbox) => inbox["next-step"].filter((message) => message.source.kind === "user");

// 2) 修复前的旧形状：没有 source → 渲染期抛 TypeError（就是聊天面板空白的那一下）
let oldThrew = "";
try {
  clientFilter({ "next-step": [{ role: "user", content: [{ type: "text", text: "阶段闸门" }] }] });
} catch (error) {
  oldThrew = String(error);
}
check(
  "旧形状（无 source）在客户端抛 TypeError",
  /Cannot read properties of undefined \(reading 'kind'\)/.test(oldThrew),
  oldThrew.slice(0, 72),
);

// 3) 新形状：带 plugin 快照来源 → 不再触发崩溃，且不会被误当成人发言（steering）渲染
const fixed = {
  role: "user",
  content: [{ type: "text", text: "阶段闸门" }],
  source: {
    kind: "plugin",
    plugin: "infinite-gen-5",
    form: "snapshot",
    sections: [{ name: "infinite-gen-5:stage-gate", text: "阶段闸门" }],
  },
};
let keptPlugin = -1;
let newThrew = "";
try {
  keptPlugin = clientFilter({ "next-step": [fixed] }).length;
} catch (error) {
  newThrew = String(error);
}
check("新形状不再崩溃", newThrew === "" && keptPlugin === 0, `kept=${keptPlugin}`);

// 正向对照：source.kind 换成 user 就被收下 —— 证明确实是这个字段在决定去留
const asUser = { ...fixed, source: { ...fixed.source, kind: "user" } };
check("正向对照：source.kind=user 被收下", clientFilter({ "next-step": [asUser] }).length === 1);

// 4) 源码层面：builder 在场、注入点用它、默认档位 off、裸对象不再直投
check("stepInjectMessage 在场", /const stepInjectMessage = \(text\) => \(\{/.test(src));
check("注入点走 builder", /agent\.inject\(message\)/.test(src));
check("裸对象不再直投", !/agent\.inject\(\{ role: "user"/.test(src));
check("默认档位 off", /IG5_STEP_INJECT_MODE \?\? "off"/.test(src));

console.log(`\n每步注入回归：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
