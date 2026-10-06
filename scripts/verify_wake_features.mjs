#!/usr/bin/env node
// 无限五代 · 唤醒词、首轮身份、配置持久化与只读运行态诊断回归
// 用法：node scripts/verify_wake_features.mjs
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IDENTITY_WAKE_WORD,
  SELF_CHECK_WAKE_WORD,
  DEFAULT_IDENTITY_TEXT,
  createWakeStore,
  createWakeState,
  wakeTexts,
  validateWakePatch,
} from "../data/wake-features.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};
const msg = (text, id = "m1") => ({ id, role: "user", source: { kind: "user" }, content: [{ type: "text", text }] });
const empty = () => ({ header: { isSeeded: false }, inheritedEventCount: 0 });

check("唤醒词固定且不为空", IDENTITY_WAKE_WORD === "亲爱的" && SELF_CHECK_WAKE_WORD === "无限第五代自检");
check("默认人格非空", DEFAULT_IDENTITY_TEXT.length > 20);
check("非法配置被拒", (() => { try { validateWakePatch({ firstWakeEnabled: "yes" }); return false; } catch { return true; } })());
check("人格长度上限被拒", (() => { try { validateWakePatch({ identityText: "x".repeat(4001) }); return false; } catch { return true; } })());

const state = createWakeState({ source: "startup", session: empty(), events: [] });
const first = wakeTexts(state, [msg("亲爱的，请开始")], { firstWakeEnabled: true, identityText: "自定义人格" });
check("新会话首条亲爱的唤醒身份", first.length === 1 && first[0].includes("自定义人格"));
const second = wakeTexts(state, [msg("亲爱的，再来一次", "m2")], { firstWakeEnabled: true, identityText: "自定义人格" });
check("同会话第二条不重复唤醒身份", second.length === 0);
const checkState = createWakeState({ source: "startup", session: empty(), events: [] });
const selfcheck = wakeTexts(checkState, [msg("无限第五代自检")], { firstWakeEnabled: true, identityText: "x" });
check("自检唤醒词注入只读工具提示", selfcheck.length === 1 && selfcheck[0].includes("infinite_gen5_selfcheck"));
const old = createWakeState({ source: "resume", session: empty(), events: [] });
check("恢复会话不触发首轮身份", wakeTexts(old, [msg("亲爱的")], { firstWakeEnabled: true, identityText: "x" }).length === 0);
const history = createWakeState({ source: "startup", session: empty(), events: [{ type: "user/message" }] });
check("已有历史不触发首轮身份", wakeTexts(history, [msg("亲爱的")], { firstWakeEnabled: true, identityText: "x" }).length === 0);
const disabled = createWakeState({ source: "startup", session: empty(), events: [] });
check("关闭开关不触发身份", wakeTexts(disabled, [msg("亲爱的")], { firstWakeEnabled: false, identityText: "x" }).length === 0);

const dir = mkdtempSync(join(tmpdir(), "ig5-wake-"));
const file = join(dir, "wake.json");
const store = createWakeStore({ file });
store.set({ firstWakeEnabled: false, identityText: "保存的人格" });
const reload = createWakeStore({ file });
check("配置原子持久化可回读", reload.get().firstWakeEnabled === false && reload.get().identityText === "保存的人格");
check("持久化文件不保存只读唤醒词字段", !readFileSync(file, "utf8").includes("selfcheckWakeWord"));
store.reset();
check("恢复默认同时恢复开关", store.get().firstWakeEnabled === true && store.get().identityText === DEFAULT_IDENTITY_TEXT);
rmSync(dir, { recursive: true, force: true });

console.log(`\n唤醒功能回归：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
