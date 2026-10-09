// 用途：静态门禁 —— 扫描全仓，禁止在 Service 实现、stats-store 与兼容验证之外出现旧统计别名调用。
// 接收者正则必须覆盖生产侧真实标识符（statsSink 就是 Service 本身，见 index.js 的 attachStatsSink）。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const rootPath = new URL(root).pathname;
const failures = [];
const allowed = [
  /services[\\/]stats-service\.mjs$/,
  /stats-store\.mjs$/,
  /scripts[\\/]verify_.*\.mjs$/,
  /scripts[\\/]probe_registration\.mjs$/,
];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name.startsWith(".")) continue;
    const path = join(dir, name.name);
    if (name.isDirectory()) walk(path);
    else if (/\.(?:js|mjs)$/.test(name.name)) files.push(path);
  }
};
walk(rootPath);
// 本期收口：接收者加 statsSink/sink —— 旧正则只认字面 stats/store/statsStore，
// 而生产侧句柄叫 statsSink（statsSinkOf() 也返回它），于是 9 处调用点长期在盲区里。
const pattern = /\b(?:stats|sink|statsSink|store|statsStore)\.(?:set|bump|push|onChange)\s*\(/g;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!pattern.test(text)) { pattern.lastIndex = 0; continue; }
  pattern.lastIndex = 0;
  const rel = file.slice(rootPath.length).replaceAll("\\", "/");
  if (!allowed.some((re) => re.test(rel))) failures.push(`${rel}: 发现未允许的旧别名调用`);
}
if (failures.length) {
  console.error("verify_stats_alias_gate: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`verify_stats_alias_gate: PASS scanned=${files.length} allowed=service/store/compat-tests`);
}
