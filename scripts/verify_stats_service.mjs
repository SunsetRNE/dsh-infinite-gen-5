// 用途：门禁 —— 验证 Host 统计 Service 的委托（publish/patch/count/append/read）、订阅退订、
// 幂等 dispose、apply/dispose/apply 生命周期与落盘失败隔离。
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createStatsStore, recordBoot, STATS_SCHEMA } from "../stats-store.mjs";
import { createStatsService } from "../services/stats-service.mjs";

const file = `/tmp/ig5-stats-service-${process.pid}.json`;
const store = createStatsStore({ file, version: "service-test", flushMs: 0 });
const service = createStatsService({ store });
const fail = (message) => { throw new Error(message); };

if (service.schema !== store.schema || service.version !== "service-test") fail("metadata forwarding failed");
service.publish("counters", { started: 1 });
service.patch("counters", { finished: 0 });
service.count("counters.started");
service.append("tasks.writes", { action: "test" }, 5);
if (service.snapshot().counters.started !== 2) fail("count did not delegate");
if (service.snapshot().counters.finished !== 0) fail("patch did not delegate");
if (service.snapshot().tasks.writes.length !== 1) fail("append did not delegate");

let notifications = 0;
const unsubscribe = service.subscribe(() => { notifications += 1; });
service.patch("counters", { notified: true });
if (notifications !== 1) fail(`subscribe failed: ${notifications}`);
unsubscribe();
service.patch("counters", { afterUnsubscribe: true });
if (notifications !== 1) fail("unsubscribe failed");
if (!service.read() || service.read().counters.afterUnsubscribe !== true) fail("read failed");
service.flush(true);
service.dispose();
service.dispose();
if (service.disposeCalls !== 1) fail(`dispose must be idempotent: ${service.disposeCalls}`);

// 生命周期回归：dispose 必须清理防抖并保留最后一次写入；重新装载同一库时，
// schema、历史 boot/boots 与版本升级语义保持不变，且旧库不伪造 previous。
const cycleDir = `/tmp/ig5-stats-cycle-${process.pid}`;
const cycleFile = `${cycleDir}/stats.json`;
mkdirSync(cycleDir, { recursive: true });
rmSync(cycleFile, { force: true });
const first = createStatsStore({ file: cycleFile, version: "cycle-1", flushMs: 25 });
const firstService = createStatsService({ store: first });
let cycleNotifications = 0;
const cycleUnsubscribe = firstService.subscribe(() => { cycleNotifications += 1; });
recordBoot(firstService, { startup: "STARTUP_A", generation: "31", at: "2026-10-09T00:00:00.000Z" });
firstService.patch("counters", { cycle: 1 });
firstService.dispose();
cycleUnsubscribe();
if (cycleNotifications !== 1) fail(`apply/dispose notification count=${cycleNotifications}`);
const firstDisk = JSON.parse(readFileSync(cycleFile, "utf8"));
if (firstDisk.schema !== STATS_SCHEMA || firstDisk.boot.startup !== "STARTUP_A") fail("dispose did not persist first cycle");

const second = createStatsStore({ file: cycleFile, version: "cycle-2", autoLoad: true, flushMs: 25 });
const secondService = createStatsService({ store: second });
if (secondService.snapshot().version !== "cycle-2") fail("upgrade did not update version");
if (secondService.snapshot().boot.startup !== "STARTUP_A") fail("boot history was not preserved");
if (secondService.snapshot().boot.previous !== null) fail("upgrade fabricated previous");
recordBoot(secondService, { startup: "STARTUP_B", generation: "32", at: "2026-10-09T00:01:00.000Z" });
secondService.patch("counters", { cycle: 2 });
secondService.dispose();
const secondDisk = JSON.parse(readFileSync(cycleFile, "utf8"));
if (secondDisk.version !== "cycle-2" || secondDisk.boot.previous?.startup !== "STARTUP_A") fail("second cycle upgrade failed");
if (secondDisk.boots.length !== 2) fail(`boot history length=${secondDisk.boots.length}`);

// 失败隔离：落盘失败只保留 dirty/lastError，不向业务调用方抛错。
const failFile = `${cycleDir}/blocked-target`;
mkdirSync(failFile, { recursive: true });
const failing = createStatsStore({ file: failFile, version: "failure-test", flushMs: 0 });
const failingService = createStatsService({ store: failing });
failingService.publish("counters", { isolated: true });
if (!failingService.dirty || !failingService.lastError) fail("write failure was not observable");
failingService.dispose();
if (!failingService.dirty || !failingService.lastError) fail("dispose failure state was lost");

console.log(`verify_stats_service: PASS schema=${service.schema} notifications=${notifications} lifecycle=apply-dispose-apply upgrade=ok failure-isolated`);
