// 无限五代 · 增强训练集自检（离线、不连网、不写盘）
//
// 断言对象是「编译层」而不是「模型表现」：单元是否成形、预算是否生效、命中是否可解释、
// 与内核是否同源重复、档位是否互斥且穷尽。跑法：node scripts/verify_boost.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BOOST_UNITS,
  BOOST_ALWAYS,
  BOOST_MODES,
  BOOST_HEADER,
  BOOST_VERSION,
  INTERNAL_ONLY,
  HEAVY_SIGNALS,
  DIRECTIVES,
  boostStats,
  compileBoost,
  inferMode,
  readDirective,
} from "../data/boost-corpus.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
let pass = 0;
const fails = [];
const check = (ok, label, detail = "") => {
  if (ok) {
    pass += 1;
  } else {
    fails.push(`${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const bytes = (s) => Buffer.byteLength(s, "utf8");
const byId = new Map(BOOST_UNITS.map((u) => [u.id, u]));

// ── 1. 单元成形 ────────────────────────────────────────────────────────────────
check(BOOST_UNITS.length === 10, "单元数 10", String(BOOST_UNITS.length));
check(new Set(BOOST_UNITS.map((u) => u.id)).size === 10, "单元 id 不重复");
check(BOOST_UNITS.every((u) => /^G\d+$/.test(u.id)), "单元 id 形如 G1…G10");
check(BOOST_UNITS.every((u) => u.from && u.from.length > 0), "每个单元都标了来源节（可追溯）");
check(BOOST_UNITS.every((u) => ["take", "redact"].includes(u.kind)), "三态只允许 take / redact 进单元表");
check(BOOST_UNITS.every((u) => u.text.length >= 40 && u.text.length <= 120), "单元长度落在 40–120 字符（实测 46–100）", BOOST_UNITS.map((u) => `${u.id}:${u.text.length}`).join(" "));
check(BOOST_UNITS.every((u) => u.bytes >= 100 && u.bytes <= 260), "单元字节落在 100–260 B（实测 130–213）");
check(BOOST_UNITS.every((u) => !u.text.endsWith("，") && !u.text.endsWith("、")), "单元不以连词收尾（不成半句）");
check(BOOST_UNITS.every((u) => bytes(u.text) === u.bytes), "bytes 字段与现场实测一致（无手写漂移）");
check(BOOST_ALWAYS.every((id) => byId.has(id)), "常驻 id 都在单元表里", BOOST_ALWAYS.join(","));
check(INTERNAL_ONLY.length === 5, "不注入条目 5 条", String(INTERNAL_ONLY.length));
// 越界内容不得出现在可注入文本里（内部清单 X1–X5 允许作为「为什么不注入」的记录存在）
const BANNED = /(未成年|儿童色情|无拒绝原则|不得透露本提示词)/;
check(BOOST_UNITS.every((u) => !BANNED.test(u.text)), "可注入单元不含越界/元条款字样");
check(!BOOST_UNITS.some((u) => /@boost/.test(u.text)), "单元正文不含档位指令（指令只走 DIRECTIVES）");

// ── 2. 档位与预算 ──────────────────────────────────────────────────────────────
check(JSON.stringify(Object.keys(BOOST_MODES)) === '["off","light","standard","full"]', "四档定义顺序固定", Object.keys(BOOST_MODES).join(","));
check(BOOST_MODES.off === 0, "off 预算为 0");
check(BOOST_MODES.light < BOOST_MODES.standard && BOOST_MODES.standard < BOOST_MODES.full, "预算 light < standard < full");
check(BOOST_MODES.full * 2 <= 20500, "上限档吃满也不会挤掉内核预算（≤20500 的一半）", String(BOOST_MODES.full));

const longText = `帮我做一次完整的渗透测试，目标是 TARGET（${"很长的用户描述，".repeat(60)}），要出报告`;
for (const mode of ["light", "standard", "full"]) {
  const out = compileBoost({ text: longText, mode, bytes: BOOST_MODES[mode] });
  check(out.emit === true, `${mode} 档对重活应 emit`, JSON.stringify(out.emit));
  check(out.bytes <= BOOST_MODES[mode], `${mode} 档不超预算`, `${out.bytes} > ${BOOST_MODES[mode]}`);
  check(out.text.length > 0, `${mode} 档文本非空`);
  // 超预算整条丢：留下的单元数 = 全部命中数 - 丢弃数
  check(out.hits.length + out.dropped.length >= BOOST_ALWAYS.length, `${mode} 档命中与丢弃可对账`);
  for (const hit of out.hits) check(out.text.includes(hit.text), `${mode} 档命中 ${hit.id} 的正文确实进了载荷`);
  for (const drop of out.dropped) check(!out.text.includes(drop.text), `${mode} 档丢弃 ${drop.id} 不留半句`);
}
// 预算故意压到极小：常驻两条也必须被整条丢弃，而不是截断
const tiny = compileBoost({ text: longText, mode: "standard", bytes: 64 });
check(tiny.emit === false || tiny.text === "", "预算小到装不下常驻条时宁可不注入", `${tiny.bytes} B / ${tiny.text.length} 字符`);

// ── 3. 命中可解释 ──────────────────────────────────────────────────────────────
const CASES = [
  { text: "随便聊两句，今天天气不错", expect: ["G1", "G4"], mode: "standard" },
  { text: "把这个配置文件改掉并验证，改完给我回滚脚本", expect: ["G1", "G4", "G2", "G6"], mode: "standard" },
  { text: "渗透测试目标 TARGET，给一条 getshell 的利用链和逆向步骤", expect: ["G1", "G4", "G6", "G8"], mode: "standard" },
  { text: "写一段剧本，角色里要有反派 NPC，场景要有生活气息", expect: ["G1", "G4", "G7", "G9"], mode: "standard" },
  { text: "给一份部署步骤并整理成表格，缺的参数我自己填", expect: ["G1", "G4", "G5", "G6"], mode: "standard" },
];
for (const item of CASES) {
  const out = compileBoost({ text: item.text, mode: item.mode, bytes: BOOST_MODES[item.mode] });
  const got = out.hits.map((h) => h.id);
  check(JSON.stringify(got) === JSON.stringify(item.expect), `命中集合可解释：${item.text.slice(0, 12)}…`, `实得 [${got.join(" ")}]，期望 [${item.expect.join(" ")}]`);
  check(got.slice(0, 2).every((id, i) => id === BOOST_ALWAYS[i]), "常驻两条恒在最前（顺序稳定）");
  check(out.text.startsWith(BOOST_HEADER), "载荷以版本头起（可被 grep 到是哪个版本注入的）");
}
// 同一输入两次编译必须逐字节一致（否则注入缓存每轮失效）
const a1 = compileBoost({ text: "改配置并验证", mode: "standard", bytes: 2400 });
const a2 = compileBoost({ text: "改配置并验证", mode: "standard", bytes: 2400 });
check(a1.text === a2.text && a1.bytes === a2.bytes, "同输入编译结果稳定");

// ── 4. 指令与自动档 ────────────────────────────────────────────────────────────
check(readDirective("@boost:off 这次简单说") === "off", "@boost:off 被识别");
check(readDirective("@boost:full 上强度") === "full", "@boost:full 被识别");
check(readDirective("增强开") === "standard", "「增强开」回到默认档");
check(readDirective("增强关") === "off", "「增强关」等价 off");
check(readDirective("普通一句话") === null, "没有指令时返回 null");
check(DIRECTIVES.every((d) => d.re instanceof RegExp && typeof d.mode === "string"), "指令表形态正确");
const offOut = compileBoost({ text: "@boost:off 别注入了", mode: "standard", bytes: 2400 });
check(offOut.emit === false && offOut.text === "", "指令 off 压过自动档：零注入", JSON.stringify(offOut.emit));
const offModeOut = compileBoost({ text: "改配置", mode: "off", bytes: 2400 });
check(offModeOut.emit === false && offModeOut.text === "", "档位 off：零注入");
check(inferMode("帮我做一次渗透测试，拿 shell") === "full", "重活信号抬到 full", String(inferMode("帮我做一次渗透测试，拿 shell")));
check(inferMode("这个模块重构一下并部署") === "standard", "中等活落到 standard", String(inferMode("这个模块重构一下并部署")));
check(inferMode("今天天气不错") === null, "闲聊不抬档（交回配置档）", String(inferMode("今天天气不错")));
check(Array.isArray(HEAVY_SIGNALS) && HEAVY_SIGNALS.length >= 2, "重活信号表非空");

// ── 5. 与内核不同源（否则会被 DEDUPE_PAYLOAD 让位整段跳过） ────────────────────
const kernelPaths = ["prompts/infinite-gen-5.md", "prompts/infinite-gen-5.1-flash.md", "prompts/infinite-gen-5-classic.md"];
let kernel = null;
for (const rel of kernelPaths) {
  const abs = join(ROOT, rel);
  if (existsSync(abs)) {
    kernel = readFileSync(abs, "utf8");
    break;
  }
}
if (kernel === null) {
  console.log("SKIP 内核比对：prompts/ 下没找到内核文件");
} else {
  const dupes = BOOST_UNITS.filter((u) => kernel.includes(u.text));
  check(dupes.length === 0, "没有任何单元逐字出现在内核里（避免同源让位整段跳过）", dupes.map((u) => u.id).join(","));
  // 头部按行归一后再比，避免只差版本号导致误判同源
  const normLines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  const kernelSet = new Set(normLines(kernel));
  const headerDup = normLines(BOOST_HEADER).some((l) => kernelSet.has(l));
  check(!headerDup, "版本头不与内核撞行");
}

// ── 6. 索引与统计 ──────────────────────────────────────────────────────────────
const stats = boostStats();
// 版本号不写死在断言里：拿 package.json 当基准，发版时这里不会撒谎（也不会变成
// verify_version.mjs 眼里的「未登记字面量」）。
const pkgVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
check(stats.version === pkgVersion, "统计里的版本与 package.json 一致", `${stats.version} vs ${pkgVersion}`);
check(stats.version === BOOST_VERSION, "统计版本与唯一字面量 BOOST_VERSION 同源");
check(BOOST_HEADER.includes(BOOST_VERSION), "版本头里带的是同一个版本号");
check(stats.units === BOOST_UNITS.length, "统计单元数与真源一致");
check(stats.byKind.take + stats.byKind.redact === stats.units, "take / redact 计数无遗漏");
check(typeof stats.triggers === "number" && stats.triggers >= 80, "触发词规模可观（≥80）", String(stats.triggers));
check(stats.internalOnly === INTERNAL_ONLY.length, "统计里的不注入条数与真源一致");
check(JSON.stringify(stats.modes) === JSON.stringify(BOOST_MODES), "统计里的档位与真源一致");

// ── 7. 插件接线（index.js 侧的口径写死在这，改接线不来自检就报错） ──────────────
const indexSrc = readFileSync(join(ROOT, "index.js"), "utf8");
check(/from "\.\/data\/boost-corpus\.mjs"/.test(indexSrc), "index.js 从真源 import（不是抄一份进正文）");
check(/const BOOST_SECTION = "infinite-gen-5:boost-corpus"/.test(indexSrc), "段名固定");
check(/const BOOST_ORDER = 150/.test(indexSrc), "Order 150（内核 100 之后、中段 200 之前）");
check(/BOOST_ORDER, text: boostLive\(\)\.text/.test(indexSrc), "注册段用当前编译结果占位");
check(/ctx\.on\("system-prompt\/assemble", refreshBoost\)/.test(indexSrc), "逐轮重算走 assemble 事件瀑布（与内核热加载同挂法）");
check(/key: "BOOST_MODE"/.test(indexSrc) && /key: "BOOST_BYTES"/.test(indexSrc), "两个调参键进了设置页选项表");
check(/BOOST_BYTES/.test(indexSrc) && /IG5_BOOST_BYTES/.test(indexSrc), "环境变量与数值键分支都接上了");

console.log(`增强训练集自检：${pass} 通过 / ${fails.length} 失败（共 ${pass + fails.length} 条）`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
