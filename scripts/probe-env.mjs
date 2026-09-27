#!/usr/bin/env node
// 无限五代 · 运行环境快检 CLI（离线、无依赖、只读）
//
//   node scripts/probe-env.mjs                  # 人类可读摘要（默认）
//   node scripts/probe-env.mjs --json           # 完整 JSON 报告
//   node scripts/probe-env.mjs --no-net         # 不做出网探测（内网/生产机上用）
//   node scripts/probe-env.mjs --fast           # 不查版本号，只查有没有（快一倍以上）
//   node scripts/probe-env.mjs --out report.json
//   node scripts/probe-env.mjs --domains        # 追加每域就绪度表
//
// 退出码：0 正常；2 参数错误。探测失败不会让脚本失败（失败都进 notes）。

import { writeFileSync } from "node:fs";
import { probeEnv, ENV_SCHEMA } from "../data/probe.mjs";

function parseArgv(argv) {
  const options = {
    json: false, net: true, versions: true, domains: false, out: null,
    layers: null, netTimeoutMs: 1500,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--no-net") options.net = false;
    else if (arg === "--fast") { options.versions = false; options.netTimeoutMs = 1000; }
    else if (arg === "--domains") options.domains = true;
    else if (arg === "--out") {
      options.out = argv[++i];
      if (!options.out) return { error: "--out 需要一个路径" };
    } else if (arg === "--layers") {
      const value = argv[++i];
      if (!value) return { error: "--layers 需要一个逗号分隔的层名列表" };
      const allowed = ["shape", "resources", "network", "stock", "capabilities", "device", "domains"];
      const picked = value.split(",").map((x) => x.trim()).filter(Boolean);
      const bad = picked.filter((x) => !allowed.includes(x));
      if (bad.length) return { error: `未知层：${bad.join(",")}（可用：${allowed.join(",")}）` };
      options.layers = picked;
    } else if (arg === "--timeout") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) return { error: "--timeout 需要一个正数（毫秒）" };
      options.netTimeoutMs = value;
    } else if (arg === "-h" || arg === "--help") {
      return { help: true };
    } else {
      return { error: `未知参数：${arg}` };
    }
  }
  return { options };
}

const parsed = parseArgv(process.argv.slice(2));
if (parsed.error) {
  console.error(`probe-env: ${parsed.error}`);
  process.exit(2);
}
if (parsed.help) {
  console.log("用法：node scripts/probe-env.mjs [--json] [--no-net] [--fast] [--domains] [--out FILE] [--layers a,b] [--timeout MS]");
  process.exit(0);
}

const report = await probeEnv(parsed.options);

if (parsed.options.out) {
  writeFileSync(parsed.options.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (parsed.options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`无限五代 · 运行环境快检（${ENV_SCHEMA} · ${report.tookMs} ms）`);
  console.log("─".repeat(64));
  console.log(report.summary);
  if (parsed.options.domains && report.domains) {
    console.log("\n每域就绪度（已装/可查工具数）：");
    for (const row of report.domains) {
      const bar = "█".repeat(Math.round(row.ratio * 10)).padEnd(10, "·");
      console.log(`  ${row.id.padEnd(16)} ${bar} ${String(row.ready).padStart(2)}/${String(row.total).padEnd(2)}` +
        (row.missing.length ? `  缺：${row.missing.join("、")}` : "  ✔"));
    }
  }
  if (report.notes.length) {
    console.log("\n探测备注（都不影响继续干活）：");
    for (const note of report.notes) console.log(`  · ${note}`);
  }
}
