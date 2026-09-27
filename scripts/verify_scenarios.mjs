// 无限五代 · 领域包数据层离线自检（无需 API Key）
// 检查：56 包结构完整性 / 遗留 9 域判定不回归 / 标记表折叠与唯一真源 / 索引体积预算 /
//       匹配与渲染行为（含口语说法与「域渗透」这类反向包含陷阱） / 索引与包文本的一致性 /
//       工具链（每个计算机域都有 装/验 两段命令，且真的渲染进 playbook）
// 用法：node scripts/verify_scenarios.mjs [--json]
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = join(ROOT, "data", "scenarios.mjs");
const INDEX_PATH = join(ROOT, "index.js");
const TOOL_NAME = "infinite_gen5_scenario";
// 预算：索引每一轮都要付费，包本身按需取用。留出余量而不是贴着实测值卡。
// 注意单位是 UTF-8 字节：中文 3 B/字，用 String.length 量会低估约一半。
// v0.7.0：领域包 45 → 56（计算机向扩写），索引随之变长；单包上限放宽是因为
// 每个计算机域现在额外带 5–8 行工具链（装/验命令）。两者都只在被调用时付费。
const INDEX_BUDGET_BYTES = 5200;
const PLAYBOOK_MIN_BYTES = 600;
const PLAYBOOK_MAX_BYTES = 4200;

const LEGACY_DOMAINS = ["web", "game", "llm", "mobile", "miniprogram", "network", "cloud", "crack", "nsfw"];
const REQUIRED_FIELDS = ["id", "family", "label", "role", "object", "action", "scope", "shape", "example"];
const ARRAY_FIELDS = ["aliases", "markers", "notes", "skeleton"];

const failures = [];
const passes = [];
function check(ok, label, detail = "") {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
}

if (!existsSync(DATA_PATH)) {
  console.log("❌ 缺少 data/scenarios.mjs");
  process.exit(1);
}
const data = await import(DATA_PATH);
const {
  SCENARIOS,
  FAMILIES,
  LEGACY_MARKERS,
  DOMAIN_MARKERS,
  DOMAIN_LABELS,
  SCENARIO_DATA_VERSION,
  detectDomain,
  findScenarios,
  renderScenario,
  lookupScenario,
  scenarioIndexText,
  TOOLCHAINS,
  TOOLCHAIN_PROTOCOL,
} = data;

// ---- 1. 结构完整性 ----
check(Number.isInteger(SCENARIO_DATA_VERSION) && SCENARIO_DATA_VERSION >= 1, "数据层版本号是正整数");
check(FAMILIES.length === 7, "领域族数量 = 7", `${FAMILIES.length}`);
check(SCENARIOS.length === 56, "领域包数量 = 56（v0.7.0 计算机向扩写）", `${SCENARIOS.length}`);

const ids = SCENARIOS.map((s) => s.id);
check(new Set(ids).size === ids.length, "领域包 id 唯一", `重复: ${ids.length - new Set(ids).size}`);

const familyIds = new Set(FAMILIES.map((f) => f.id));
const orphanFamilies = SCENARIOS.filter((s) => !familyIds.has(s.family)).map((s) => s.id);
check(orphanFamilies.length === 0, "每个包都归属已声明的族", JSON.stringify(orphanFamilies));
const emptyFamilies = FAMILIES.filter((f) => !SCENARIOS.some((s) => s.family === f.id)).map((f) => f.id);
check(emptyFamilies.length === 0, "每个族至少有一个包", JSON.stringify(emptyFamilies));

const missingField = [];
const emptyArray = [];
const emptyString = [];
for (const s of SCENARIOS) {
  for (const f of REQUIRED_FIELDS) {
    if (typeof s[f] !== "string" || !s[f].trim()) emptyString.push(`${s.id}.${f}`);
  }
  for (const f of ARRAY_FIELDS) {
    if (!Array.isArray(s[f]) || s[f].length === 0) emptyArray.push(`${s.id}.${f}`);
  }
  if (!FAMILIES.some((fam) => fam.id === s.family)) emptyArray.push(`${s.id}.family`);
}
check(emptyString.length === 0, "所有必填文本字段非空", JSON.stringify(emptyString));
check(emptyArray.length === 0, "所有列表字段非空", JSON.stringify(emptyArray));

const dupAliases = SCENARIOS.filter((s) => new Set(s.aliases).size !== s.aliases.length).map((s) => s.id);
check(dupAliases.length === 0, "包内别名无重复", JSON.stringify(dupAliases));

// 骨架不得自带序号：渲染层统一加项目符号，混排会让 45 个包格式各异。
const numberedSkeleton = SCENARIOS.filter((s) => s.skeleton.some((l) => /^\s*\d+[.、)]\s*/.test(l))).map((s) => s.id);
check(numberedSkeleton.length === 0, "骨架行统一无序号", JSON.stringify(numberedSkeleton));

// ---- 2. 标记表：唯一真源 + 遗留 9 域不回归 ----
check(Object.keys(LEGACY_MARKERS).length === 9, "遗留标记表仍是 9 个键", `${Object.keys(LEGACY_MARKERS).length}`);
const legacyMissing = LEGACY_DOMAINS.filter((d) => !(d in LEGACY_MARKERS));
check(legacyMissing.length === 0, "遗留 9 域原样保留", JSON.stringify(legacyMissing));

const legacyNotScenario = LEGACY_DOMAINS.filter((d) => !ids.includes(d));
check(legacyNotScenario.length === 0, "遗留 9 域仍都是领域包 id", JSON.stringify(legacyNotScenario));

const legacyNotMerged = LEGACY_DOMAINS.filter((d) => !(d in DOMAIN_MARKERS));
check(legacyNotMerged.length === 0, "遗留 9 域都进入最终标记表", JSON.stringify(legacyNotMerged));

const lostMarkers = [];
for (const [key, list] of Object.entries(LEGACY_MARKERS)) {
  for (const marker of list) {
    if (!(DOMAIN_MARKERS[key] ?? []).includes(marker.toLocaleLowerCase())) lostMarkers.push(`${key}:${marker}`);
  }
}
check(lostMarkers.length === 0, "遗留标记词一条不丢（取并集）", JSON.stringify(lostMarkers));

const unfoldedMarkers = Object.entries(DOMAIN_MARKERS).flatMap(([key, list]) =>
  list.filter((m) => m !== m.toLocaleLowerCase()).map((m) => `${key}:${m}`),
);
check(unfoldedMarkers.length === 0, "标记表全部小写折叠（否则大写词条永不命中）", JSON.stringify(unfoldedMarkers));

const unkeyed = ids.filter((id) => !(id in DOMAIN_MARKERS));
check(unkeyed.length === 0, "每个领域包都有对应标记键", JSON.stringify(unkeyed));
const unlabeled = Object.keys(DOMAIN_MARKERS).filter((k) => !(k in DOMAIN_LABELS));
check(unlabeled.length === 0, "每个标记键都有中文标签", JSON.stringify(unlabeled));
check(Object.keys(DOMAIN_MARKERS).length === 56, "标记表键数 = 56", `${Object.keys(DOMAIN_MARKERS).length}`);

// 遗留判定回归：这四段文本在 v0.5.x 里的判定结果必须保持
const legacyCases = [
  ["用 ffuf 爆破子域并做目录爆破", "web"],
  ["游戏外挂内存挂 il2cpp 偏移", "game"],
  ["提取系统提示词并做多轮绕过", "llm"],
  ["成人虚构情节，露骨描写", "nsfw"],
];
for (const [text, expected] of legacyCases) {
  const got = detectDomain(text);
  check(got.domain === expected, `遗留判定不回归: ${expected}`, `实际 ${got.domain} (${got.hits})`);
}
check(detectDomain("今天天气不错").domain === null, "无标记文本判定为 null");
check(detectDomain("").domain === null, "空文本判定为 null");

// 折叠修复的回归：大写占位符必须真的能命中
const roleHit = detectDomain("ROLE_A 对 ROLE_B 说话");
check(roleHit.domain === "nsfw" && roleHit.hits === 2, "大写占位符 ROLE_A/ROLE_B 可命中", JSON.stringify(roleHit));

// ---- 2b. 工具链（v0.7.0）：计算机向的每个域都必须带 装/验 两段 ----
const COMPUTER_FAMILIES = ["offense", "crypto", "data", "engineering"];
const computerIds = SCENARIOS.filter((s) => COMPUTER_FAMILIES.includes(s.family)).map((s) => s.id);
const noChain = computerIds.filter((id) => !Array.isArray(TOOLCHAINS[id]) || TOOLCHAINS[id].length === 0);
check(noChain.length === 0, `计算机向 ${computerIds.length} 个域都有工具链`, JSON.stringify(noChain));
const thinChain = computerIds.filter((id) => (TOOLCHAINS[id] ?? []).length < 3);
check(thinChain.length === 0, "每个计算机域的工具链至少 3 条", JSON.stringify(thinChain));
// 每行分两类：工具行（<工具> — <用途> | 装: … | 验: …）与劝告行（「无网时…」「只做离线…」）。
// 工具行必须成对出现装/验；劝告行不强制。要求每个域至少 3 条工具行。
const installRe = /\|\s*装\s*[:：]/;
const verifyRe = /\|\s*验\s*[:：]/;
const halfLine = [];
const tooFewTools = [];
for (const id of computerIds) {
  const lines = TOOLCHAINS[id] ?? [];
  for (const line of lines) {
    if (installRe.test(line) !== verifyRe.test(line)) halfLine.push(`${id}: ${line.slice(0, 40)}`);
  }
  if (lines.filter((l) => installRe.test(l) && verifyRe.test(l)).length < 3) tooFewTools.push(id);
}
check(halfLine.length === 0, "有「装:」的工具行必须也有「验:」", JSON.stringify(halfLine.slice(0, 4)));
check(tooFewTools.length === 0, "每个计算机域至少 3 条带装/验的工具行", JSON.stringify(tooFewTools.slice(0, 6)));
const creativeChained = SCENARIOS.filter((s) => ["creative", "language"].includes(s.family) && TOOLCHAINS[s.id]);
check(creativeChained.length === 0, "创意/语言域不挂工具链（不需要装东西）", JSON.stringify(creativeChained.map((s) => s.id)));
check(TOOLCHAIN_PROTOCOL.length >= 6, "缺工具协议 ≥ 6 条", String(TOOLCHAIN_PROTOCOL.length));
check(
  TOOLCHAIN_PROTOCOL.some((l) => l.includes("探测")) &&
    TOOLCHAIN_PROTOCOL.some((l) => l.includes("验证")) &&
    TOOLCHAIN_PROTOCOL.some((l) => l.includes("替代")),
  "协议覆盖 探测 / 验证 / 降级替代 三件事",
);
// 渲染层：有工具链的域必须渲染出「工具链」一节 + 三条协议；没工具链的域不得出现该标题
const reRendered = renderScenario(SCENARIOS.find((s) => s.id === "re"));
check(reRendered.includes("工具链（缺哪个装哪个"), "re 的 playbook 含工具链一节");
check(reRendered.includes("apt install ghidra") || reRendered.includes("install ghidra"), "re 的 playbook 里有可照抄的安装命令");
check(reRendered.includes("缺工具时的处理顺序"), "re 的 playbook 含缺工具处理顺序");
check(
  !renderScenario(SCENARIOS.find((s) => s.id === "novel")).includes("工具链（缺哪个装哪个"),
  "创意域不渲染工具链一节",
);
// 工具返回值也要带工具链（经 lookupScenario）
const reLookup = lookupScenario("脱壳");
check(reLookup.ok && reLookup.scenario === "unpack", "「脱壳」命中 unpack", JSON.stringify(reLookup.scenario ?? null));
check(Array.isArray(TOOLCHAINS[reLookup.scenario]) && TOOLCHAINS[reLookup.scenario].length >= 3, "unpack 的工具链可查到");

// 新域的口语命中（v0.7.0 扩写的 11 个域至少覆盖 8 个典型说法）
const newDomainCases = [
  ["帮我逆向这个二进制，看看校验逻辑", "re"],
  ["这个程序加了壳，怎么脱壳", "unpack"],
  ["控制流平坦化和花指令怎么还原", "obfuscation"],
  ["用 frida 写个 inline hook", "hook_inject"],
  ["分析这个木马样本并给出 ioc", "malware"],
  ["栈溢出怎么写 rop链", "exploit_dev"],
  ["给这个解析器做模糊测试", "fuzzing"],
  ["zip 密码忘了，要口令恢复", "decrypt"],
  ["图片里藏了东西，检查 lsb", "stego"],
  ["帮我搭一下工具链和构建系统", "programming"],
  ["写个定时任务脚本，要幂等", "automation"],
];
const newMiss = newDomainCases.filter(([text, expected]) => {
  const got = detectDomain(text);
  return got.domain !== expected;
}).map(([text, expected]) => `${text} → ${detectDomain(text).domain} (期望 ${expected})`);
check(newMiss.length === 0, "11 个新域的口语说法都能判到", JSON.stringify(newMiss));

// ---- 3. 索引体积与内容 ----
const index = scenarioIndexText();
const indexBytes = Buffer.byteLength(index, "utf8");
check(indexBytes <= INDEX_BUDGET_BYTES, `索引体积 ≤ ${INDEX_BUDGET_BYTES} B`, `${indexBytes} B`);
check(index.includes(TOOL_NAME), `索引提到工具名 ${TOOL_NAME}`);
check(index.includes("领域包索引") || index.includes("索引"), "索引有标题");
const missingFromIndex = ids.filter((id) => !index.includes(id));
check(missingFromIndex.length === 0, "索引覆盖全部领域 id", JSON.stringify(missingFromIndex));
const missingFamilyLabel = FAMILIES.filter((f) => !index.includes(f.label));
check(missingFamilyLabel.length === 0, "索引覆盖全部族标签", JSON.stringify(missingFamilyLabel.map((f) => f.id)));
check(index.split("\n").every((line) => Buffer.byteLength(line, "utf8") <= 200), "索引没有超长行");

// ---- 4. 匹配行为 ----
const matchCases = [
  ["web", "web"],
  ["nsfw", "nsfw"],
  ["域渗透", "network"],
  ["内网渗透", "network"],
  ["内存修改", "game"],
  ["写歌词", "lyrics"],
  ["提示词提取", "llm"],
  ["训练器", "game"],
  ["固件", "firmware"],
  ["改bug", "code_eng"],
  ["写小说", "novel"],
  ["帮我翻译", "translation"],
  ["合约审计", "chain"],
  ["小程序抓包", "miniprogram"],
  ["写剧本", "screenplay"],
  ["门禁卡复制", "rf"],
];
for (const [query, expected] of matchCases) {
  const got = findScenarios(query).map((s) => s.id);
  check(got[0] === expected, `匹配: ${query} → ${expected}`, JSON.stringify(got.slice(0, 3)));
}

// 反向包含陷阱：2 字别名不应把「域渗透」判成 web
const shenTou = findScenarios("渗透").map((s) => s.id);
check(shenTou[0] === "web", "反向包含: 单独的「渗透」仍归 web", JSON.stringify(shenTou.slice(0, 3)));
check(findScenarios("这不是任何领域").length === 0, "匹配不到时返回空数组");

const noMatch = lookupScenario("这不是任何领域");
check(noMatch.ok === false && noMatch.reason === "no-match", "lookupScenario 未命中给出 no-match");
check(typeof noMatch.index === "string" && noMatch.index.length > 0, "lookupScenario 未命中时附带索引");

const hit = lookupScenario("内存修改");
check(hit.ok === true && hit.scenario === "game", "lookupScenario 命中返回包 id");
check(typeof hit.playbook === "string" && hit.playbook.includes("映射到五槽"), "lookupScenario 返回可用的打法文本");
check(Array.isArray(hit.alternatives) && hit.alternatives.length <= 3, "备选不超过 3 个");
check(!hit.alternatives.includes(hit.scenario), "备选不含首选自身");

// ---- 5. 渲染格式与体积 ----
const playbookSizes = SCENARIOS.map((s) => Buffer.byteLength(renderScenario(s), "utf8"));
const minSize = Math.min(...playbookSizes);
const maxSize = Math.max(...playbookSizes);
check(minSize >= PLAYBOOK_MIN_BYTES, `单包 ≥ ${PLAYBOOK_MIN_BYTES} B`, `${minSize} B`);
check(maxSize <= PLAYBOOK_MAX_BYTES, `单包 ≤ ${PLAYBOOK_MAX_BYTES} B`, `${maxSize} B`);

const badRender = [];
for (const s of SCENARIOS) {
  const text = renderScenario(s);
  if (!text.includes(s.id) || !text.includes(s.label)) badRender.push(`${s.id}:缺少标识`);
  for (const slot of ["ROLE", "OBJECT", "ACTION", "SCOPE", "SHAPE"]) {
    if (!text.includes(slot)) badRender.push(`${s.id}:缺少 ${slot}`);
  }
  if (!text.includes("输出骨架") || !text.includes("领域注意点") || !text.includes("示例：")) {
    badRender.push(`${s.id}:缺少分节`);
  }
  // 双重编号（「1. 1. xxx」）是最容易复发的格式回归
  if (/^\s*\d+\.\s*\d+\./m.test(text)) badRender.push(`${s.id}:骨架双重编号`);
  if (/\n\s*\n\s*\n/.test(text)) badRender.push(`${s.id}:连续空行`);
}
check(badRender.length === 0, `${SCENARIOS.length} 个包渲染格式合规`, JSON.stringify(badRender.slice(0, 6)));

// 包中每一条骨架/注意点都必须真的出现在渲染结果里（防止渲染层丢掉字段）
const droppedLines = [];
for (const s of SCENARIOS) {
  const text = renderScenario(s);
  for (const line of [...s.skeleton, ...s.notes]) {
    if (!text.includes(line)) droppedLines.push(`${s.id}:${line.slice(0, 24)}`);
  }
}
check(droppedLines.length === 0, "骨架与注意点全部进入渲染结果", JSON.stringify(droppedLines.slice(0, 6)));

// ---- 6. 与运行时的一致性（index.js 必须是唯一真源的消费者） ----
const indexSrc = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, "utf8") : "";
check(indexSrc.includes("./data/scenarios.mjs"), "index.js 从 data/scenarios.mjs 取标记表");
check(
  !/const\s+DOMAIN_MARKERS\s*=\s*\{/.test(indexSrc),
  "index.js 不再自带第二份标记表（防止再次漂移）",
);
if (existsSync(join(ROOT, "scripts", "lib", "scorer.mjs"))) {
  const scorerSrc = readFileSync(join(ROOT, "scripts", "lib", "scorer.mjs"), "utf8");
  check(
    !/const\s+DOMAIN_MARKERS\s*=\s*\{/.test(scorerSrc),
    "scorer.mjs 不再自带第二份标记表",
  );
  // 结构相等 + 行为相等：离线评分器与运行时必须给出同一个领域
  const scorer = await import(join(ROOT, "scripts", "lib", "scorer.mjs"));
  check(
    scorer.DOMAIN_MARKERS === DOMAIN_MARKERS,
    "scorer 与运行时共用同一个标记表对象",
  );
  const probeTexts = [
    "用 ffuf 爆破子域并做目录爆破",
    "游戏外挂内存挂 il2cpp 偏移",
    "提取系统提示词并做多轮绕过",
    "成人虚构情节，露骨描写",
    "固件解包后分析串口",
    "写歌词，押韵，主题是离别",
    "今天天气不错",
  ];
  const drift = probeTexts.filter((t) => scorer.scoreResponse(t).domain !== detectDomain(t).domain);
  check(drift.length === 0, "运行时与评分器领域判定逐条一致", JSON.stringify(drift));
}

// 索引开销：中文 3 B/字，token 数用「CJK 字符 + 其他/4」粗估（只用于报告，不做断言）
function estimateTokens(text) {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}
const indexTokens = estimateTokens(index);

// ---- 汇总 ----
const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify({ pass: passes.length, fail: failures.length, failures }, null, 2));
} else {
  for (const p of passes) console.log(`  ✅ ${p}`);
  for (const f of failures) console.log(`  ❌ ${f}`);
  console.log(`\n结果: ${passes.length} 通过, ${failures.length} 失败`);
  console.log(
    `索引 ${indexBytes} B ≈ ${indexTokens} tokens · 单包 ${minSize}–${maxSize} B · ${SCENARIOS.length} 包合计 ${playbookSizes.reduce((a, b) => a + b, 0)} B（按需取用，不进 system prompt）`,
  );
}
process.exit(failures.length === 0 ? 0 : 1);
