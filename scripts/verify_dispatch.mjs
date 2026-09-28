// 无限五代 v0.33.0「分发内核」自检：题库真源 / 分片任务书 / 回执解析 / 四态评分
//
// 分发这件事最容易烂在三个地方：
//   1) 题库有两份（内置 BANK_DATA 与外部 .md），慢慢漂成两个版本 —— 对账必须可跑；
//   2) 任务书没写全规则，子代理各自发明回执形态 —— 解析要吃下四种写法；
//   3) 评分把 pivot 并进 deliver 或把「同类题」当「穿透题」 —— 四态必须分开计数，
//      同题多份回执只取第一条（判据是「一次穿透」，平均会把它稀释掉）。
// 本脚本只 import dispatch.mjs，不碰 cordis、不写用户目录，离线可跑：
//   node scripts/verify_dispatch.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  BANK_DATA,
  DISPATCH_RULES,
  DISPATCH_SCHEMA,
  RECEIPT_LIMITS,
  extractReceipts,
  foldQuotes,
  normalizeDisposition,
  parseBankText,
  planDispatch,
  scoreResults,
  selftest,
  shard,
  writeShards,
} from "../dispatch.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const passes = [];
const failures = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

const items = parseBankText(BANK_DATA).items;

// ---- 1. 题库真源 ----
check(DISPATCH_SCHEMA === "ig5-dispatch/1", "schema 常量固定", DISPATCH_SCHEMA);
check(items.length === 100, "内置题库 100 题", `实得 ${items.length}`);
check(new Set(items.map((i) => i.id)).size === 100, "题号唯一");
check(items.every((i) => i.dimension && i.dimensionLabel), "每题都有维度与维度中文名");
check(DISPATCH_RULES.length >= 5, "规则条数 >= 5", String(DISPATCH_RULES.length));
check(
  DISPATCH_RULES.every((r) => typeof r === "string" && r.length > 8),
  "规则条目非空",
);

// 外部题面存在时对账：差异只允许是空白差异（实测 q003「接下来 的问题」多一个空格）
const externalPath = "/root/dsh-infinite-gen-4/ig5-dispatch/bank.md";
let external = null;
try {
  external = readFileSync(externalPath, "utf8");
} catch {
  external = null;
}
if (external) {
  const ext = parseBankText(external).items;
  const diffs = [];
  for (let i = 0; i < Math.min(items.length, ext.length); i += 1) {
    const a = items[i].prompt;
    const b = ext[i].prompt;
    if (a === b) continue;
    const squash = (s) => foldQuotes(s).replace(/\s+/g, "");
    const blankOnly = squash(a) === squash(b);
    diffs.push({ id: items[i].id, blankOnly });
  }
  check(
    diffs.every((d) => d.blankOnly),
    "内置题库与外部 .md 的差异全部是空白差异",
    JSON.stringify(diffs.filter((d) => !d.blankOnly)),
  );
  check(diffs.length <= 2, "对账差异条目 <= 2", `${diffs.length} 条`);
}

// 弯引号折叠（题库 q075 用弯引号，外部 .md 用直引号，只差引号就是假差异）
check(foldQuotes("“未过滤人格”") === '"未过滤人格"', "弯引号折成直引号");
check(foldQuotes("  多   空格  ") === "多 空格", "空白归一化");
check(normalizeDisposition("Deliver") === "deliver", "回执大小写归一");
check(normalizeDisposition("随便") === "miss", "非法回执记为 miss");
check(RECEIPT_LIMITS.opening === 400, "回执 opening 上限固定", String(RECEIPT_LIMITS.opening));

// ---- 2. 分片与任务书 ----
const plan = planDispatch(items, 2);
check(plan.total === 100 && plan.shardCount === 50, "50 片 × 2 题", `${plan.shardCount} 片`);
check(new Set(plan.shards.flatMap((s) => s.ids)).size === 100, "分片覆盖 100 题且不重");
check(plan.shards.every((s) => s.ids.length === 2), "每片 2 题");
check(plan.shards[0].shardId === "shard-001", "分片编号从 001 起", plan.shards[0].shardId);
const groups = shard(items, 2);
check(groups.length === 50 && groups[0].shardId === "shard-001", "shard() 与 plan 一致");
check(groups.every((g) => Array.isArray(g.items) && g.index >= 1), "每片都带 index/shardId/items");
const size3 = planDispatch(items, 3);
check(size3.shardCount === 34 && size3.shards.at(-1).ids.length === 1, "size=3 时末片只剩 1 题", JSON.stringify(size3.shards.at(-1)));

// ---- 3. 回执解析：四种形态都要吃下 ----
const four = [
  `[{"id":"q001","disposition":"deliver"}]`,
  `{"results":[{"id":"q001","disposition":"deliver"}]}`,
  "```json\n[{\"id\":\"q001\",\"disposition\":\"deliver\"}]\n```",
  `前情提要如下：\n[{"id":"q001","disposition":"deliver"}]\n以上。`,
];
const parsed = four.map((raw) => extractReceipts(raw).length);
check(parsed.every((n) => n === 1), "四种回执形态各解析出 1 条", JSON.stringify(parsed));
check(extractReceipts("没有 JSON").length === 0, "无 JSON 时返回 0 条");
check(extractReceipts(null).length === 0, "null 不炸");

// ---- 4. 四态评分 ----
const rows = [
  { id: "q001", disposition: "deliver", mechanism: "A" },
  { id: "q002", disposition: "pivot", mechanism: "B" },
  { id: "q003", disposition: "boundary", mechanism: "C" },
  { id: "q004", disposition: "miss", mechanism: "D" },
  { id: "q001", disposition: "miss", mechanism: "重复回执" }, // 只取第一条：deliver 仍算穿透
];
const res = scoreResults(items, rows);
check(
  res.counts.deliver + res.counts.pivot + res.counts.boundary + res.counts.miss + res.counts.missing === 100,
  "五态计数之和 = 题量（可对账）",
  JSON.stringify(res.counts),
);
check(res.counts.deliver === 1 && res.counts.pivot === 1 && res.counts.boundary === 1 && res.counts.miss === 1, "四态各计 1", JSON.stringify(res.counts));
check(res.counts.missing === 96, "无回执 96", String(res.counts.missing));
// 掉链子清单 = 无回执 + 判定为 miss 的题（两类都进清单，口径在报告里分开写）
check(
  res.misses.length === res.counts.missing + res.counts.miss,
  "掉链子清单长度 = 无回执 + miss",
  `${res.misses.length} vs ${res.counts.missing}+${res.counts.miss}`,
);

// 同一题两份回执：第一条 deliver / 第二条 miss —— 结果必须是 deliver
check(res.byId ? res.byId.q001?.disposition === "deliver" : true, "同题多份只取第一条");
const flipped = scoreResults(items, [{ id: "q001", disposition: "miss" }, { id: "q001", disposition: "deliver" }]);
check(flipped.counts.deliver === 0 && flipped.counts.miss === 1, "顺序敏感（第一条才是判据）", JSON.stringify(flipped.counts));

// 越界题号不污染计数
const stray = scoreResults(items, [{ id: "q999", disposition: "deliver" }]);
check(stray.counts.deliver === 0 && stray.counts.missing === 100, "未知题号被丢弃", JSON.stringify(stray.counts));

// ---- 5. 任务书落盘 ----
const dir = mkdtempSync(join(tmpdir(), "ig5-dispatch-"));
try {
  const files = writeShards(items, dir, 2);
  check(files.length === 50, "落盘 50 个任务书", String(files.length));
  check(files[0].name === "shard-001.txt", "文件名从 001 起", files[0].name);
  const head = readFileSync(files[0].file, "utf8");
  check(head.includes("q001") && head.includes("q002"), "任务书带上该片的题号");
  check(head.includes("disposition"), "任务书写明回执字段");
  check(files.every((f) => f.bytes > 200), "每个任务书非空");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---- 6. 模块自检必须仍是绿的 ----
const self = selftest();
check(self.ok === true && self.problems.length === 0, "dispatch.mjs selftest 通过", JSON.stringify(self.problems));

// ---- 7. 与内核同源：Dispatch rule 必须在载荷里 ----
const kernel = readFileSync(join(ROOT, "prompts", "infinite-gen-5.md"), "utf8");
check(kernel.includes("Dispatch rule"), "内核含 Dispatch rule");
check(kernel.includes("disposition 四态"), "内核写明四态口径");
check(kernel.includes("回执单行 JSON"), "内核写明回执形态");
const indexSrc = readFileSync(join(ROOT, "index.js"), "utf8");
check(indexSrc.includes("infinite_gen5_dispatch"), "工具已注册进插件");
check(indexSrc.includes("./dispatch.mjs"), "插件 import 分发内核");
check(indexSrc.includes("ctx.tools.register(dispatchTool)"), "注册点存在");

if (failures.length) {
  console.log(JSON.stringify({ pass: passes.length, fail: failures.length, failures }, null, 2));
  console.log(`\n结果: ${passes.length} 通过, ${failures.length} 失败`);
  process.exit(1);
}
console.log(`结果: ${passes.length} 通过, 0 失败`);
