#!/usr/bin/env node
/**
 * boot_attest 门禁（v0.38.3）—— 校验「启动自证」这一段真代码。
 *
 * 被测对象是 stats-store.mjs 的 recordBoot()：index.js 在 createStatsStore() 之后直接调它，
 * 所以这里跑的就是生产路径，不是副本。
 *
 * 为什么要有这道门禁：DSHA 环境下插件管理器的「确认/审阅」事务被原生闸门拦下
 * （DSHA_NATIVE_REVIEW_REQUIRED → changed:false / application:'failed'，profile 里不落
 * .plugin-manager/run.json），停一次 DSH 再起就没有任何落盘面能回答「上次确认过没有」。
 * 这段自证必须做到两件事，缺一条都算门禁失败：
 *   ① 每次启动都留下可核凭据（世代号 + startup uuid + 库路径）；
 *   ② 上一次的确认快照跨重启保留；旧库没有 startup 时**不臆造**「上次确认」。
 *
 * 用法：node scripts/verify_boot_attest.mjs
 * 退出码：0 = 全通过；1 = 有失败。
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStatsStore, emptyStats, recordBoot, STATS_SCHEMA } from "../stats-store.mjs";

const dir = mkdtempSync(join(tmpdir(), "ig5-boot-attest-"));
const file = join(dir, "infinite-gen-5-stats.json");

const results = [];
const check = (name, ok, detail = "") => {
  results.push([name, Boolean(ok), detail]);
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const DSHA_ENV = { DSHA_WEB_GENERATION: "31", DSHA_NATIVE_PLUGIN_MANAGER: "1", DSHA_ANDROID_RUNTIME: "1" };

try {
  // ── 1. 首次启动：写上本次世代与 startup，且不编造「上次」 ────────────────────
  const s1 = createStatsStore({ version: "T.0.0", file, autoLoad: true, flushMs: 0 });
  const b1 = recordBoot(s1, { env: DSHA_ENV, startup: "STARTUP_A", at: "2026-09-29T10:00:00.000Z", statsFile: file });
  check("首启写入世代号", b1.generation === "31", `generation=${b1.generation}`);
  check("首启写入 startup uuid", b1.startup === "STARTUP_A", `startup=${b1.startup}`);
  check("首启 previous 为空（不臆造）", b1.previous === null, `previous=${JSON.stringify(b1.previous)}`);
  check("识别 DSHA 原生闸门", b1.nativePluginManager === true && b1.dsha === true, `dsha=${b1.dsha} npm=${b1.nativePluginManager}`);

  // ── 2. 重启一次：上一次确认快照必须跨进程保留 ──────────────────────────────
  const s2 = createStatsStore({ version: "T.0.0", file, autoLoad: true, flushMs: 0 });
  const b2 = recordBoot(s2, {
    env: { ...DSHA_ENV, DSHA_WEB_GENERATION: "32" },
    startup: "STARTUP_B",
    at: "2026-09-29T11:00:00.000Z",
    statsFile: file,
  });
  check("重启后世代号更新", b2.generation === "32", `generation=${b2.generation}`);
  check("重启后 startup 换新", b2.startup === "STARTUP_B" && b2.startup !== b1.startup, `startup=${b2.startup}`);
  check("保留上次确认（startup）", b2.previous?.startup === "STARTUP_A", `previous.startup=${b2.previous?.startup}`);
  check("保留上次确认（世代）", b2.previous?.generation === "31", `previous.generation=${b2.previous?.generation}`);
  check("保留上次确认（时刻）", b2.previous?.at === "2026-09-29T10:00:00.000Z", `previous.at=${b2.previous?.at}`);

  // ── 3. 盘上真读到这些字段（面板读的是文件，不是内存）────────────────────────
  const disk = JSON.parse(readFileSync(file, "utf8"));
  check("盘上 schema 未变", disk.schema === STATS_SCHEMA, `schema=${disk.schema}`);
  check("盘上 boot 是本次启动", disk.boot?.startup === "STARTUP_B", `disk.boot.startup=${disk.boot?.startup}`);
  check("盘上启动历史按序累积", Array.isArray(disk.boots) && disk.boots.length === 2 &&
    disk.boots[0].generation === "31" && disk.boots[1].generation === "32",
  `boots=${(disk.boots || []).map((b) => b.generation).join("→")}`);

  // ── 4. 旧库（本版之前，boot 里没有 startup）：宁可不写上次，也不编 ──────────
  const legacyFile = join(dir, "legacy.json");
  const legacyDoc = emptyStats("T.0.0", "2026-09-29T09:00:00.000Z");
  legacyDoc.boot = { at: "2026-09-29T09:00:00.000Z", pid: 1234, version: "LEGACY.0.0" };
  writeFileSync(legacyFile, `${JSON.stringify(legacyDoc, null, 2)}\n`, "utf8");
  const s3 = createStatsStore({ version: "T.0.0", file: legacyFile, autoLoad: true, flushMs: 0 });
  const b3 = recordBoot(s3, { env: DSHA_ENV, startup: "STARTUP_C", at: "2026-09-29T12:00:00.000Z", statsFile: legacyFile });
  check("旧库升级后不臆造上次确认", b3.previous === null, `previous=${JSON.stringify(b3.previous)}`);

  // ── 5. 读侧键齐全（面板不必判 undefined）───────────────────────────────────
  const skeleton = emptyStats("T.0.0");
  const bootKeys = ["at", "pid", "version", "generation", "startup", "dsha", "nativePluginManager", "previous"];
  check("骨架保留 boot 全键", bootKeys.every((k) => k in skeleton.boot), `缺=${bootKeys.filter((k) => !(k in skeleton.boot)).join(",") || "无"}`);
  check("骨架保留 boots 分区", Array.isArray(skeleton.boots) && skeleton.boots.length === 0, `boots=${JSON.stringify(skeleton.boots)}`);
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 临时目录清不掉不影响判定 */
  }
}

const failed = results.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(`\nboot_attest 门禁失败：${results.length} 条中 ${failed.length} 条不成立 —— ${failed.map(([n]) => n).join(" · ")}`);
  process.exit(1);
}
console.log(`\nboot_attest 门禁通过（共 ${results.length} 条 · 世代保留 / 跨重启上次确认 / 旧库不臆造 / 读侧键齐全）`);
