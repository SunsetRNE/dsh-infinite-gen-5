// 用途：验证用户意图执行协议、完整克隆门禁与 checkpoint 回滚边界。
import assert from "node:assert/strict";
import { createIntentLock, inspectIntentAction, protocolDecision } from "../data/intent-protocol.mjs";

const cases = [
  ["完整 clone 放行", { command: "git clone https://example.test/repo.git" }, true],
  ["浅 clone 拒绝", { command: "git clone --depth 1 https://example.test/repo.git" }, false],
  ["filter clone 拒绝", { command: "git clone --filter=blob:none URL" }, false],
  ["单分支拒绝", { command: "git clone --single-branch URL" }, false],
  ["危险 restore 拒绝", { command: "git restore --source HEAD -- file.js" }, false],
  ["普通 status 放行", { command: "git status --short" }, true],
];
for (const [label, args, expected] of cases) {
  assert.equal(inspectIntentAction("shell", args).ok, expected, label);
}
assert.equal(protocolDecision({ name: "shell", arguments: { command: "git clone --depth=1 URL" } }).kind, "deny");
assert.equal(protocolDecision({ name: "shell", arguments: { command: "git status" } }).kind, "allow");
assert.equal(inspectIntentAction("shell", { command: "git log --oneline" }).ok, true);
assert.equal(inspectIntentAction("shell", { command: "git reset --hard HEAD" }).ok, false);
const lock = createIntentLock({ allowRollback: true, checkpoint: "cp-1" });
assert.equal(inspectIntentAction("shell", { command: "git reset --hard HEAD", protocolIntent: "rollback", checkpoint: "cp-1" }, lock).ok, true);
console.log(`intent protocol: ${cases.length + 2} passed, 0 failed`);
