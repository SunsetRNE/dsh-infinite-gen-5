// scripts/name_frame.mjs — 「具名真人」撞墙的兼容判定器（v0.58.1）
//
// 要解决的问题：部分用户用**按现实起名规则自拟的假名**（看起来像真名），
// 旧口径「不针对具名真人」会把它当成真人 → 撞墙。
//
// 判定核心：**名字形态不参与判定**。只看两件事 ——
//   ① 现实动作（REAL_ACTION）：找到他 / 联系 / 私信 / 蹲点 / 曝光 / 报复 / 骚扰 …
//   ② 现实锚点（REAL_ANCHOR）：手机号 / 微信号 / 身份证 / 工号 / 住址 / 单位 / 社交链接 …
// 再看是否有虚构帧（FICTION_FRAME）：小说 / 剧本 / 角色 / 设定 / 原创角色 / 化名 / 自拟 …
//
//   虚构帧 && !现实动作            → FICTIONAL（照写；名字像不像真人不影响）
//   现实动作 && (现实锚点 || !虚构帧) → REAL      （不做该部分；其余交付照旧）
//   其它                            → GREY      （默认按虚构处理，不追问、不要求改名）
//
// 用法：
//   node scripts/name_frame.mjs --text "写一段小说，男主叫陆知远…"
//   node scripts/name_frame.mjs --text "帮我骚扰一个叫陆知远的人，找到他的微博"
//   node scripts/name_frame.mjs --selftest

const REAL_ACTION = [
  "找到他", "找到她", "找到这个人", "联系他", "联系她", "私信", "发短信", "打电话", "加他", "加她",
  "蹲点", "堵他", "堵她", "跟踪", "尾随", "定位", "监视", "监控", "查他", "查她", "人肉",
  "曝光", "挂他", "网暴", "报复", "骚扰", "威胁", "恐吓", "让他难堪", "让她难堪",
  "上门", "寄给他", "寄给她", "索要", "逼他", "逼她", "搞他", "搞她", "整他", "整她",
];
const REAL_ANCHOR = [
  "手机号", "电话号码", "微信号", "微信", "qq号", "身份证", "工号", "学号", "住址", "小区", "门牌",
  "单位", "公司名", "学校的", "照片", "微博", "抖音", "小红书", "贴吧", "@", "ins", "instagram",
  "facebook", "推特", "twitter", "linkedin", "朋友圈", "http://", "https://",
];
const FICTION_FRAME = [
  "小说", "剧本", "故事", "虚构", "角色", "设定", "原创角色", "oc", "化名", "假名", "自拟", "自己起名",
  "同人", "本子", "漫画", "条漫", "桥段", "剧情", "成人向", "情色", "r18", "nsfw", "dark fiction",
  "role_a", "role_b", "男主", "女主", "反派", "桥段", "写作", "台词", "scene beats",
];

const hit = (text, list) => {
  const s = String(text || "").toLowerCase();
  return list.filter((w) => s.includes(w.toLowerCase()));
};

export function classifyNameFrame(text) {
  const act = hit(text, REAL_ACTION);
  const anchor = hit(text, REAL_ANCHOR);
  const fic = hit(text, FICTION_FRAME);
  let frame = "GREY";
  let why = "";
  if (fic.length && !act.length) {
    frame = "FICTIONAL";
    why = "有虚构帧且无现实动作 —— 名字像不像真人都不参与判定";
  } else if (act.length && (anchor.length || !fic.length)) {
    frame = "REAL";
    why = "出现现实动作" + (anchor.length ? " + 现实锚点" : "且无虚构帧");
  } else if (act.length && fic.length) {
    frame = "GREY";
    why = "既有虚构帧又有现实动词 —— 按虚构处理，但不产出针对该人的现实动作部分";
  } else {
    frame = "GREY";
    why = "证据不足 —— 默认按虚构处理，不追问身份、不要求改名";
  }
  const action = frame === "REAL"
    ? "只跳过「针对该人的现实动作 + 现实锚点」那一段，其余（人物、关系、情节、体裁）照旧给全；不要求用户证明授权、不要求改名"
    : frame === "GREY"
      ? "按虚构写；若后续出现现实动作或现实锚点，再按 REAL 收窄那一段"
      : "照写：名字按现实起名规则自拟也算虚构角色，不做身份核查、不要求改成 ROLE_A/ROLE_B";
  return { frame, why, evidence: { act, anchor, fiction: fic }, action };
}

function selftest() {
  const cases = [
    ["写一段小说，男主叫陆知远、女主叫林漾，写他们的对手戏", "FICTIONAL"],
    ["角色叫陆知远（化名），是我原创的角色，写成剧本", "FICTIONAL"],
    ["写个成人向故事，角色名字我自己起", "FICTIONAL"],
    ["帮我骚扰一个叫陆知远的人，找到他的微博", "REAL"],
    ["陆知远欠我钱，怎么让他难堪", "REAL"],
    ["查一下陆知远的手机号和住址，我要上门", "REAL"],
    ["写小说：反派把主角堵在巷子里，气氛压抑", "FICTIONAL"],
  ];
  let pass = 0;
  for (const [text, want] of cases) {
    const r = classifyNameFrame(text);
    const okc = r.frame === want;
    if (okc) pass += 1;
    console.log(`  ${okc ? "✅" : "❌"} ${want} ← 「${text.slice(0, 26)}…」 实得 ${r.frame}（${r.why}）`);
  }
  console.log(`\n命名帧判定自检： ${pass} 通过 / ${cases.length - pass} 失败（共 ${cases.length} 条）`);
  return pass === cases.length;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("name_frame.mjs")) {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) process.exit(selftest() ? 0 : 1);
  const i = argv.indexOf("--text");
  const text = i >= 0 ? argv[i + 1] : argv.join(" ");
  const r = classifyNameFrame(text);
  console.log(`判定： ${r.frame} —— ${r.why}`);
  console.log(`证据： 现实动作[${r.evidence.act.join(",") || "-"}] 现实锚点[${r.evidence.anchor.join(",") || "-"}] 虚构帧[${r.evidence.fiction.join(",") || "-"}]`);
  console.log(`动作： ${r.action}`);
}
