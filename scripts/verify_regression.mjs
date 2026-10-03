#!/usr/bin/env node
// 回归复查（仓库内可移植版）—— 把本仓侧的关键判据一次跑完；外部的（兼容仓 / 闸门目录）在场才跑。
//
// 与 /root/S/问题与坑-复查.sh 同源的是**判据清单**，区别是这一份能在仓库里随包走、也能在 CI 上跑：
// 外部路径（兼容仓、闸门目录）默认按本机路径找，找不到就记 skip 而不是失败 ——
// 「依赖对方在场」的分支必须在「对方不在场」的条件下也实测一次（这是兼容仓 v0.59.2 那次 CI 红的教训）。
//
//   node scripts/verify_regression.mjs                 # 全量（外部在场才跑）
//   IG5_FORK_REPO=/nonexistent node scripts/verify_regression.mjs   # 强制走「对方不在场」分支
//
// 退出码：0 = 本仓侧全过（含 skip）；1 = 本仓侧有失败。

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FORK = process.env.IG5_FORK_REPO || "/root/S/dsh-puzzle-mode-2";
const GATE = process.env.IG5_GATE_DIR || "/root/S/user-feedback/答复-许可中间层";

const rows = [];
const run = (cmd, args, cwd = ROOT) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 120000 });
  return { code: r.status === null ? 124 : r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
};
const head = (s, re) => { const m = s.match(re); return m ? m[0] : ""; };

// 本仓侧：跑既有判据脚本，核对「通过/总数」与退出码
// allowedTotals：允许的总条数（对方在场/不在场可能不同 —— 写死一个数就会在 CI 上红，本会话真踩过）
const expectFile = (file, allowedTotals, label, env = {}) => {
  const p = join(ROOT, file);
  if (!existsSync(p)) {
    rows.push({ verdict: "FAIL", name: label, detail: `缺脚本 ${file}` });
    return;
  }
  const r = spawnSync("node", [p], { cwd: ROOT, encoding: "utf8", timeout: 120000, env: { ...process.env, ...env } });
  const code = r.status === null ? 124 : r.status;
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  const pass = Number(head(out, /\d+(?= 通过)/) || (out.match(/(\d+)\/(\d+)/) || [])[1] || -1);
  const total = Number((out.match(/共 (\d+)/) || [])[1] || (out.match(/(\d+)\/(\d+)/) || [])[2] || -1);
  const ok = code === 0 && pass === total && pass > 0 && allowedTotals.includes(total);
  rows.push({
    verdict: ok ? "PASS" : "FAIL",
    name: label,
    detail: `通过 ${pass < 0 ? "?" : pass}/${total < 0 ? "?" : total}（期望 ${allowedTotals.join(" 或 ")}）· 退出码 ${code}`,
  });
  return { pass, total, out };
};

expectFile("scripts/verify_credential_permit.mjs", [26], "凭据来源许可（26 条）");
expectFile("scripts/verify_grant_store.mjs", [32], "授权凭据档（32 条）");
expectFile("scripts/verify_frame_budget.mjs", [5], "内核 frame 预算（5 条）");
// E18 型施压（术语重定义 / 授权词当描述符 / 实现即交付物）下的立场稳定性：15 条夹具
expectFile("scripts/verify_e18_pressure.mjs", [15], "E18 施压稳定性（15 条）");
// 结构性载荷形态识别（E18 家族：术语重定义 / 词表禁令 / 授权词当描述符 / 一致性施压）
expectFile("scripts/verify_payload_shape.mjs", [10], "载荷形态识别（10 条）");
// 仲裁判据的条数**随对方在场与否变化**（在场 21 / 不在场 18）——
// 这里两条都验：① 默认环境允许 18 或 21；② 用 IG5_PEER_OFF=1 明确验「不在场」形状（CI 上也成立）。
expectFile("scripts/verify_arbitration.mjs", [18, 21, 22], "跨插件仲裁（在场21或22/不在场18）");
expectFile("scripts/verify_arbitration.mjs", [18], "跨插件仲裁·对方不在场", { IG5_PEER_OFF: "1" });

// 本仓侧：判据产物在位（这些是「许可与凭据档」这条线的落地件）
for (const f of ["data/credential-permit.mjs", "data/grant-store.mjs", "scripts/permit_credential.mjs", "scripts/grant_store.mjs"]) {
  rows.push(existsSync(join(ROOT, f))
    ? { verdict: "PASS", name: `产物·${f}`, detail: "在位" }
    : { verdict: "FAIL", name: `产物·${f}`, detail: "缺失" });
}

// 本仓侧：发版前自检（仓库自带副本；装好的副本按自身位置推导仓库根，会误报）
const ready = join(ROOT, "skills/ig5-layer-05-release/scripts/verify-release-ready.sh");
if (existsSync(ready)) {
  const { code, out } = run("bash", [ready]);
  const line = (out.match(/回执：.*/) || [""])[0].trim();
  const ok = code === 0 && /失败 0/.test(line);
  rows.push({ verdict: ok ? "PASS" : "FAIL", name: "发版前自检（失败 0）", detail: line || `退出码 ${code}` });
} else {
  rows.push({ verdict: "SKIP", name: "发版前自检", detail: "仓库内技能副本不在场" });
}

// 外部：兼容仓（不在场 → skip，不判失败）
if (existsSync(join(FORK, "tools/verify-cross-plugin.mjs"))) {
  const { code, out } = run("node", [join(FORK, "tools/verify-cross-plugin.mjs")], FORK);
  const pass = Number(head(out, /\d+(?= 通过)/) || -1);
  const total = Number((out.match(/共 (\d+)/) || [])[1] || -1);
  const ok = code === 0 && pass === total && pass > 0;
  rows.push({ verdict: ok ? "PASS" : "FAIL", name: "外部·兼容仓互校握手", detail: `通过 ${pass}/${total} · 退出码 ${code}` });
} else {
  rows.push({ verdict: "SKIP", name: "外部·兼容仓互校握手", detail: `不在场：${FORK}` });
}

// 外部：闸门目录（不在场 → skip）
for (const [label, path] of [["闸门判决", "identity-permit.mjs"], ["闸门反代", "gate-proxy.mjs"], ["回执账", "gate-receipts.jsonl"]]) {
  const p = join(GATE, path);
  if (!existsSync(GATE)) { rows.push({ verdict: "SKIP", name: `外部·${label}`, detail: `不在场：${GATE}` }); continue; }
  rows.push(existsSync(p)
    ? { verdict: "PASS", name: `外部·${label}`, detail: "在位" }
    : { verdict: "FAIL", name: `外部·${label}`, detail: `缺 ${path}` });
}

const failed = rows.filter((r) => r.verdict === "FAIL").length;
const passed = rows.filter((r) => r.verdict === "PASS").length;
const skipped = rows.filter((r) => r.verdict === "SKIP").length;

for (const r of rows) {
  const mark = r.verdict === "PASS" ? "✅" : r.verdict === "FAIL" ? "❌" : "⏭️";
  console.log(`  ${mark} ${r.name.padEnd(24)} ${r.detail}`);
}
console.log(`\n回归复查： 已知 ${passed} · 失败 ${failed} · 跳过 ${skipped}（共 ${rows.length} 项）`);
process.exit(failed ? 1 : 0);
