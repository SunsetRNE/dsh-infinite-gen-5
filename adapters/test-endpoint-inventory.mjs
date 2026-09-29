// test-endpoint-inventory.mjs — 端点池巡检判据：清单闸门、零网络包、兼容/拒收两桩、来源不可拼、密钥不回显。
// 全程 loopback：http://127.0.0.1:<临时端口>，不碰任何外部端点。

import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INVENTORY_VERSION,
  OWNED_PROVENANCE,
  loadInventory,
  validateEntry,
  inspectEndpoint,
  runInventory,
  renderInventoryReport,
  writeInventoryReport,
  emitTemplate,
  FREE_TIER_SOURCES,
  main,
} from "./endpoint-inventory.mjs";

const results = [];
let passed = 0;
function check(id, title, ok, detail = "") {
  results.push({ id, ok: Boolean(ok) });
  if (ok) passed += 1;
  console.log(`${ok ? "✓" : "✗"} ${id}  ${title}`);
  if (detail) console.log(`      ${detail}`);
}

const ROOT = mkdtempSync(join(tmpdir(), "ig5-inventory-test-"));
const KEY_NAME = "IG5_INV_TEST_KEY";
const KEY_VALUE = "KEY_PLACEHOLDER_DO_NOT_ECHO";

function startCompat() {
  const state = { hits: 0 };
  const server = createServer((req, res) => {
    state.hits += 1;
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json", "x-context-window": "131072", "x-model": "COMPAT_MODEL" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "IG5_PROBE_OK" } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }));
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, state, port: server.address().port })));
}

function startRejectSystem() {
  const state = { hits: 0 };
  const server = createServer((req, res) => {
    state.hits += 1;
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (/"role"\s*:\s*"system"/.test(body)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid request: system role is not supported by this model" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "x-model": "STRICT_MODEL" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "IG5_PROBE_OK" } }] }));
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, state, port: server.address().port })));
}

const compat = await startCompat();
const strict = await startRejectSystem();
const deadPort = 9; // discard 端口上没人听，用来造「连接被拒」

// dry.json：I3 用的合法清单（一条 local-stub 条目）
writeFileSync(
  join(ROOT, "dry.json"),
  JSON.stringify({
    version: INVENTORY_VERSION,
    entries: [{ id: "dry", baseUrl: `http://127.0.0.1:${compat.port}`, model: "COMPAT_MODEL", provenance: "local-stub" }],
  }),
);

// I1 清单闸门：坏写法逐条拒，好条目通过
{
  const bad = [
    { id: "inline", baseUrl: "http://127.0.0.1:1", provenance: "local-stub", apiKey: "sk-live-should-never-be-here" },
    { id: "harvested", baseUrl: "http://127.0.0.1:1", provenance: "third-party-harvested" },
    { id: "noprov", baseUrl: "http://127.0.0.1:1" },
    { id: "badurl", baseUrl: "ftp://127.0.0.1", provenance: "self-hosted" },
    { id: "badkeyenv", baseUrl: "http://127.0.0.1:1", provenance: "self-hosted", keyEnv: "not-an-env-name" },
  ];
  const reasons = bad.map((e, i) => validateEntry(e, i).reason ?? "");
  const good = validateEntry({ id: "ok", baseUrl: "http://127.0.0.1:1", model: "M", provenance: "self-hosted", keyEnv: KEY_NAME });
  const ok =
    reasons[0].includes("inline-key-refused") &&
    reasons[1].includes("provenance-not-owned") &&
    reasons[2].includes("provenance-not-owned") &&
    reasons[3].includes("baseUrl") &&
    reasons[4].includes("keyEnv") &&
    good.ok === true &&
    OWNED_PROVENANCE.has("local-stub") &&
    !OWNED_PROVENANCE.has("third-party-harvested");
  check("I1", "清单闸门：密钥字面量 / 来源不明 / 非 http(s) / 非法 keyEnv 逐条拒，好条目放行", ok, `inline=${reasons[0].slice(0, 22)}… 来源=${reasons[1].slice(0, 22)}… 好条目=${good.ok}`);
}

// I2 well-formed 清单：坏条目不连坐，逐条列因
{
  const doc = JSON.stringify({
    version: INVENTORY_VERSION,
    entries: [
      { id: "a", baseUrl: `http://127.0.0.1:${compat.port}`, model: "COMPAT_MODEL", provenance: "local-stub" },
      { id: "b", baseUrl: "http://127.0.0.1:1", provenance: "borrowed" },
    ],
  });
  const inv = loadInventory(doc);
  const broken = loadInventory("{ not json");
  check("I2", "清单装载：坏条目不连坐、坏 JSON 明确报错", inv.ok && inv.entries.length === 1 && inv.rejected.length === 1 && broken.ok === false, `通过 ${inv.entries.length} · 拒 ${inv.rejected.length} · 坏 JSON=${broken.reason?.slice(0, 24)}…`);
}

// I3 dry-run 零网络包
{
  const hitsBefore = compat.state.hits + strict.state.hits;
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  let code = null;
  try {
    code = await main(["--inventory", join(ROOT, "dry.json"), "--dry-run"]);
  } finally {
    console.log = orig;
  }
  const hitsAfter = compat.state.hits + strict.state.hits;
  check("I3", "dry-run 只校验清单：零网络包（桩计数不增）", code === 0 && hitsAfter === hitsBefore, `hits ${hitsBefore}→${hitsAfter} · 输出行=${lines.length}`);
}

// I4 兼容桩巡检：system accepted + 131072 → system/LAST/40000B、high 置信
{
  const row = await inspectEndpoint({ id: "compat", baseUrl: `http://127.0.0.1:${compat.port}`, model: "COMPAT_MODEL", provenance: "local-stub", keyEnv: "" }, { timeoutMs: 5000 });
  const ok = row.ok === true && row.signals.systemRole === "accepted" && Number(row.signals.contextWindow) === 131072 && row.plan.carrier === "system" && row.plan.slot === "LAST" && row.plan.budgetBytes === 40000 && row.confidence === "high" && row.hasKey === false;
  check("I4", "兼容桩：system accepted + 窗口 131072 → 载体 system / 槽位 LAST / 预算 40000B / 高置信", ok, `carrier=${row.plan.carrier} slot=${row.plan.slot} 预算=${row.plan.budgetBytes} conf=${row.confidence} rules=${row.planRules.join(",")}`);
}

// I5 拒收 system 桩 → 内联；探针用两条且不重试
{
  const hitsBefore = strict.state.hits;
  const row = await inspectEndpoint({ id: "strict", baseUrl: `http://127.0.0.1:${strict.port}`, model: "STRICT_MODEL", provenance: "local-stub" }, { timeoutMs: 5000 });
  const hits = strict.state.hits - hitsBefore;
  const ok = row.ok === true && row.signals.systemRole === "rejected" && row.plan.carrier === "inline" && row.plan.slot === "INLINE" && row.probesUsed === 2 && hits === 2;
  check("I5", "拒收 system 桩：载体改内联、两条探针不再重试", ok, `systemRole=${row.signals.systemRole} carrier=${row.plan.carrier} 探针=${row.probesUsed} 桩命中=${hits}`);
}

// I6 死端点：出行并带 error，不抛
{
  const row = await inspectEndpoint({ id: "dead", baseUrl: `http://127.0.0.1:${deadPort}`, model: "X", provenance: "local-stub" }, { timeoutMs: 2000 });
  check("I6", "死端点：记一行 error，不抛、不吞", row.ok === false && typeof row.error === "string" && row.error.length > 0, `error=${String(row.error).slice(0, 60)}`);
}

// I7 来源不可拼：混杂来源 stitchable=false，同源同模型 true
{
  const mixed = await runInventory({
    entries: [
      { id: "c", baseUrl: `http://127.0.0.1:${compat.port}`, model: "COMPAT_MODEL", provenance: "local-stub" },
      { id: "s", baseUrl: `http://127.0.0.1:${strict.port}`, model: "STRICT_MODEL", provenance: "self-hosted" },
    ],
    timeoutMs: 5000,
  });
  const same = await runInventory({
    entries: [
      { id: "c1", baseUrl: `http://127.0.0.1:${compat.port}`, model: "COMPAT_MODEL", provenance: "local-stub" },
      { id: "c2", baseUrl: `http://127.0.0.1:${compat.port}`, model: "COMPAT_MODEL", provenance: "local-stub" },
    ],
    timeoutMs: 5000,
  });
  check("I7", "跨来源不可拼：混杂 → stitchable=false；同源同模型 → true", mixed.stitchable === false && same.stitchable === true, `mixed=${mixed.stitchReason} · same=${same.stitchable}`);
}

// I8 报告落盘 + 密钥只从环境变量读且不回显
{
  process.env[KEY_NAME] = KEY_VALUE;
  const run = await runInventory({
    entries: [{ id: "withkey", baseUrl: `http://127.0.0.1:${compat.port}`, model: "COMPAT_MODEL", provenance: "own-account", keyEnv: KEY_NAME }],
    timeoutMs: 5000,
  });
  const md = renderInventoryReport(run, { rejected: [{ id: "harvested", reason: "provenance-not-owned" }] });
  const written = writeInventoryReport(run, join(ROOT, "runs"), { rejected: [{ id: "harvested", reason: "provenance-not-owned" }] });
  delete process.env[KEY_NAME];
  const onDisk = readFileSync(written.mdPath, "utf8");
  const ok =
    run.rows[0].hasKey === true &&
    !md.includes(KEY_VALUE) &&
    !onDisk.includes(KEY_VALUE) &&
    md.includes("被拒条目") &&
    md.includes("provenance-not-owned") &&
    md.includes("| id | 来源 |") &&
    readdirSync(join(ROOT, "runs")).length === 2;
  check("I8", "报告：hasKey 记真、被拒条目照样列在被拒段、密钥值不出现在报告或落盘文件里", ok, `hasKey=${run.rows[0].hasKey} 落盘=${readdirSync(join(ROOT, "runs")).length} 件 · 密钥泄漏=${md.includes(KEY_VALUE) || onDisk.includes(KEY_VALUE)}`);
}

// I9 起步清单模板：全条通过校验、全条 skip、跑模板时一个包都不发
{
  const text = emitTemplate();
  const templatePath = join(ROOT, "template.json");
  writeFileSync(templatePath, text, "utf8");
  const inv = loadInventory(text);
  const allSkip = inv.ok && inv.entries.length === FREE_TIER_SOURCES.length && inv.entries.every((e) => e.skip === true);
  const hitsBefore = compat.state.hits + strict.state.hits;
  const run = await runInventory({ entries: inv.entries, timeoutMs: 3000 });
  const hitsAfter = compat.state.hits + strict.state.hits;
  const allSkipped = run.rows.every((r) => r.skipped === true && r.probesUsed === 0);
  check(
    "I9",
    "起步清单模板：全条通过校验 + 全条 skip（跑模板零网络包）",
    allSkip && inv.rejected.length === 0 && allSkipped && hitsAfter === hitsBefore,
    `条目=${inv.entries.length}/${FREE_TIER_SOURCES.length} · 被拒=${inv.rejected.length} · 全跳过=${allSkipped} · hits ${hitsBefore}→${hitsAfter}`,
  );
}

// I10 --emit-template 走 CLI：退出 0、输出可解析、条数与来源表一致
{
  const lines = [];
  const orig = console.log;
  const origWrite = process.stdout.write.bind(process.stdout);
  console.log = (...a) => lines.push(a.join(" "));
  process.stdout.write = (s) => (lines.push(String(s)), true);
  let code = null;
  try {
    code = await main(["--emit-template"]);
  } finally {
    console.log = orig;
    process.stdout.write = origWrite;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(lines.join(""));
  } catch {
    parsed = null;
  }
  check(
    "I10",
    "--emit-template：退出 0、stdout 可解析 JSON、条数与来源表一致",
    code === 0 && parsed !== null && Array.isArray(parsed.entries) && parsed.entries.length === FREE_TIER_SOURCES.length,
    `exit=${code} 可解析=${parsed !== null} 条数=${parsed?.entries?.length} 版本=${parsed?.version}`,
  );
}

console.log("");
console.log(`端点池巡检判据：${passed}/${results.length} 条通过 · 版本 ${INVENTORY_VERSION}`);
console.log(`临时根：${ROOT}`);
compat.server.close();
strict.server.close();
const failedIds = results.filter((r) => !r.ok).map((r) => r.id);
if (!failedIds.length) rmSync(ROOT, { recursive: true, force: true });
else console.log(`失败项保留现场：${failedIds.join(", ")}`);
process.exit(failedIds.length ? 1 : 0);
