// 一次性装配器：把 data/cot-router.mjs 的核心段逐字注入
// ui-preview/cot-router-preview.html。首次生成后 HTML 可独立维护，本脚本留档备查
// （verify_cot_router.mjs 才是判据：它逐字节比对两边的核心段）。
// 用法：node scripts/build_cot_preview.mjs [--check]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "data", "cot-router.mjs");
const OUT = join(ROOT, "ui-preview", "cot-router-preview.html");

// 单独成行的哨兵行（前后各一条），模块与预览件两边的核心段逐字节相同。
const SENTINEL = "// ====";
const src = readFileSync(SRC, "utf8");
const i = src.indexOf(SENTINEL);
const j = src.lastIndexOf(SENTINEL);
if (i < 0 || j <= i) throw new Error("data/cot-router.mjs 缺少 // ==== 哨兵行");
const moduleCore = src.slice(i); // 从首条哨兵起到底（含收尾哨兵）：两边逐字节相同
// 预览件里 export 会报错 → 去掉；去掉后长度差 = 每次导出的 7 字节，
// 自检按「同一变换」比对，不做裸字节比较。
const htmlCore = moduleCore.replace(/^export /gm, "");

const shell = readFileSync(join(ROOT, "scripts", "cot-preview-shell.html"), "utf8");
const html = shell.replace("<!--IG5_CORE-->", htmlCore);

if (process.argv.includes("--check")) {
  const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  console.log(cur === html ? "OK 预览件与核心段同步" : "DRIFT 预览件需要重新生成");
  process.exitCode = cur === html ? 0 : 1;
} else {
  writeFileSync(OUT, html);
  console.log(`written ${OUT} · ${(html.length / 1024).toFixed(1)} KB · core ${(htmlCore.length / 1024).toFixed(1)} KB`);
}
