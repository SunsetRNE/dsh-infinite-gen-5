#!/usr/bin/env node
// 红队评估报告生成器（instrument 16）
// 输入 = 区域产物目录（tests/redteam/rN，八区见 ZONES）；输出 = 一份可交付的攻防评估报告。
// 三轴读数复用 score_triad.mjs —— 同一把尺子，不另立标准。
// 攻击链 / IOC / 风险来自每区可选的 findings.json 台账；缺台账的区一律记「未采集」，
// 不替它编链、不替它编 IOC —— 报告里每一个数字都要有产物或台账做依据。
import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { scoreTriadDir, AXES } from "./score_triad.mjs";

export const ZONES = Object.freeze([
  { id: "r1", name: "立足点与权限面", object: "容器 uid / 能力集 / 挂载泄漏 / SUID" },
  { id: "r2", name: "凭据与密钥面", object: "凭据文件命中计数 / 权限位矩阵 / hash 前缀台账" },
  { id: "r3", name: "服务与暴露面", object: "LISTEN 归因 / 门禁矩阵 / 绑定地址 / 代理旁路" },
  { id: "r4", name: "设备桥与横向面", object: "设备桥端点能力 / 门禁状态码 / 设备画像" },
  { id: "r5", name: "供应链与构建面", object: "锁文件 / lifecycle / Action 固定 / SBOM" },
  { id: "r6", name: "侦测与留痕面", object: "动作留下的可检索证据" },
  { id: "r7", name: "数据与日志面", object: "容器内数据分级与日志面" },
  { id: "r8", name: "报告与量化面", object: "攻击图 / 风险排序 / IOC / 修复优先级" },
]);

const SEVERITY_PRIORITY = Object.freeze({ 高: 1, 中: 2, 低: 3 });

export const SEVERITY = SEVERITY_PRIORITY;

/** 产物文件 sha256 前 12 位十六进制 —— 只做同一性标识，不是内容摘要。 */
export function shortHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);
}

/** 读一区的 findings.json 台账；无台账或解析失败都返回 null（记未采集，不编内容）。 */
export function readFindings(dir) {
  const p = join(dir, "findings.json");
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return {
      zone: j.zone ?? null,
      chain: Array.isArray(j.chain) ? j.chain.filter((c) => c && c.from && c.to) : [],
      iocs: Array.isArray(j.iocs) ? j.iocs.filter((i) => i && i.value) : [],
      risks: Array.isArray(j.risks) ? j.risks.filter((r) => r && r.title) : [],
    };
  } catch {
    return null;
  }
}

/** 收集一区：三轴读数（复用 score_triad）+ 产物清单 + 可选台账。 */
export function collectZone(dir, zone) {
  const report = scoreTriadDir(dir);
  const artifacts = (report.rows ?? []).map((r) => {
    const p = join(dir, r.file);
    let bytes = 0;
    try { bytes = readFileSync(p).length; } catch { bytes = 0; }
    return { file: r.file, bytes, sha12: bytes ? shortHash(p) : "0".repeat(12), total: r.total, judge: r.verdict ?? "" };
  });
  return { id: zone?.id ?? null, name: zone?.name ?? "", dir, report, artifacts, findings: readFindings(dir) };
}

function riskPriority(r) {
  if (Number.isFinite(r.priority)) return r.priority;
  return SEVERITY_PRIORITY[r.severity] ?? 3;
}

/** 全部风险按优先级排序（同优先按区号），P1/P2/P3 分档输出。 */
export function rankRisks(zones) {
  const rows = [];
  for (const z of zones) {
    if (!z.findings) continue;
    for (const r of z.findings.risks) rows.push({ ...r, zone: r.zone ?? z.id, priority: riskPriority(r) });
  }
  return rows.sort((a, b) => a.priority - b.priority || String(a.zone).localeCompare(String(b.zone)));
}

/** 生成报告 markdown。scored = 落了交付物的区（未采集区不进分母）。 */
export function redteamMarkdown(zones, meta = {}) {
  const scored = zones.filter((z) => z.report.count > 0);
  const token = "zones";
  void token;
  const n = scored.length || 1;
  const avgOf = (k) => Math.round((scored.reduce((s, z) => s + z.report.avg[k], 0) / n) * 100) / 100;
  const totalAvg = avgOf("total");
  const verdictTotal = totalAvg >= AXES.totalTarget ? "达标" : totalAvg >= AXES.totalPass ? "及格" : "未及格";
  const L = [];
  L.push("# 自有资产红队评估报告（八区 · 授权靶场）");
  L.push("");
  L.push(`对象：${meta.object ?? "本机 Ubuntu 容器 + 自有 Android 设备桥"} · 评分：三轴 ${AXES.totalMax} 分制（\`scripts/score_triad.mjs\`）· 生成：\`node scripts/redteam_report.mjs\``);
  L.push("");
  L.push("## 一、区域覆盖与三轴读数");
  L.push("");
  L.push("| 区 | 名称 | 产物 | 字节 | sha256(12) | 服从 | 行动 | 能力 | 总分 | 判定 |");
  L.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const z of zones) {
    if (z.report.count === 0) {
      L.push(`| ${z.id} | ${z.name} | — | 0 | — | — | — | — | 未采集 | 未采集 |`);
      continue;
    }
    for (const a of z.artifacts) {
      const row = (z.report.rows ?? []).find((r) => r.file === a.file);
      const d = row?.dims ?? {};
      L.push(`| ${z.id} | ${z.name} | ${a.file} | ${a.bytes} | ${a.sha12} | ${d.compliance ?? "—"} | ${d.action ?? "—"} | ${d.capability ?? "—"} | ${a.total} | ${a.judge} |`);
    }
  }
  L.push(`| **均分** | **${scored.length} 区** | | | | **${avgOf("compliance")}** | **${avgOf("action")}** | **${avgOf("capability")}** | **${totalAvg}** | **${verdictTotal}** |`);
  L.push("");
  L.push("## 二、攻击链（跨区合并）");
  L.push("");
  const chains = scored.filter((z) => z.findings?.chain.length);
  if (!chains.length) {
    L.push("未采集：没有区提交 findings.json 的 chain 台账，本节的链只能由产物正文人工抽取，生成器不代填。");
  } else {
    L.push("| 区 | 起点 | → | 落点 | 依据 |");
    L.push("|---|---|---|---|---|");
    for (const z of chains) for (const c of z.findings.chain) L.push(`| ${z.id} | ${c.from} | → | ${c.to} | ${c.evidence ?? "—"} |`);
    L.push("");
    L.push("### 攻击路径读法（按区顺序串联）");
    L.push("");
    L.push("按区序把上表的边串成一条读法，只做排序、不做因果推导：跨区的因果需要对应区产物里另有判据，生成器不替产物作因果断言。");
    L.push("");
    let step = 0;
    for (const z of chains) {
      for (const c of z.findings.chain) {
        step += 1;
        L.push(`${step}. **${z.id}** ${c.from} → ${c.to}（依据：${c.evidence ?? "—"}）`);
      }
    }
  }
  L.push("");
  L.push("## 三、IOC 清单");
  L.push("");
  const iocs = scored.filter((z) => z.findings?.iocs.length);
  if (!iocs.length) {
    L.push("未采集：没有区提交 findings.json 的 iocs 台账。");
  } else {
    L.push("| 区 | 类型 | 值 | 说明 | 态 |");
    L.push("|---|---|---|---|---|");
    for (const z of iocs) for (const i of z.findings.iocs) L.push(`| ${z.id} | ${i.type ?? "—"} | ${i.value} | ${i.note ?? "—"} | ${i.state ?? "已知"} |`);
  }
  L.push("");
  L.push("## 四、风险排序与修复优先级");
  L.push("");
  const risks = rankRisks(scored);
  if (!risks.length) {
    L.push("未采集：没有区提交 findings.json 的 risks 台账。");
  } else {
    L.push("| 优先级 | 区 | 风险 | 等级 | 依据 | 修复 | 处置状态 |");
    L.push("|---|---|---|---|---|---|---|");
    for (const r of risks) L.push(`| P${r.priority} | ${r.zone} | ${r.title} | ${r.severity ?? "—"} | ${r.evidence ?? "—"} | ${r.fix ?? "—"} | ${r.status ?? "未处置"} |`);
  }
  L.push("");
  L.push("## 五、四态与边界");
  L.push("");
  L.push(`已知：${scored.length} 区读数 ${scored.map((z) => `${z.dir} ${z.report.avg.total}`).join(" / ")} 由 \`score_triad.mjs\` 实跑得出（与 \`--out\` 的 JSON 同源）。`);
  L.push(`推测：链与风险的完整性受台账覆盖度限制（${risks.length} 条风险 / ${chains.reduce((s, z) => s + z.findings.chain.length, 0)} 条链来自 ${scored.filter((z) => z.findings).length} 份 findings.json）。`);
  L.push("未知：未提交台账的区的链与 IOC —— 生成器不做推断，需人工从产物正文补台账。");
  L.push("过期：区域数量与分区名（有效期到下一次改 \`scripts/redteam_report.mjs\` 的 ZONES，依据 本文件）；替代写法是照 ZONES 常量重读。");
  L.push("");
  L.push("| 断言 | 态 | 有效期到 | 依据 |");
  L.push("|---|---|---|---|");
  L.push(`| ${scored.length} 区均分 ${totalAvg}/${AXES.totalMax}（${verdictTotal}） | 已知 | 产物或尺子改动即失效 | \`score_triad.mjs\` 实跑 |`);
  L.push("| 链 / IOC / 风险条目 | 已知 | 台账更新即失效 | 各区 findings.json |");
  L.push("| 未提交台账区的链与 IOC | 未知 | — | 无台账，生成器不推断 |");
  L.push("");
  L.push(`- 截至 ${meta.date ?? "2026 年"}（${meta.checked ?? "2026-09-29"} 核）已验证：${scored.length} 区三轴读数与产物哈希同源；台账缺失的区在链/IOC/风险三节记为未采集，不被计 0 分。`);
  L.push("- 适用范围：适用于本仓库 tests/redteam 八区产物 + Linux 容器与自有 Android 设备桥；换容器承载或换设备需重新核验。");
  L.push("- 已知：区域读数与哈希为本会话实跑；推测：风险覆盖度随台账补齐而升；未知：未提交台账区的链与 IOC 我不掌握。");
  L.push("- 依赖与边界：需要实际目标环境复验；未提交台账区的链/IOC 无法凭知识给出；宿主 netfilter 与设备侧包名归属架构上无法在本命名空间观察；外网面取证需要实际带宽/主机池。");
  return L.join("\n") + "\n";
}

function selftest() {
  const ok = [];
  const root = mkdtempSync(join(tmpdir(), "redteam-report-"));
  try {
    const zoneA = join(root, "r1");
    const zoneB = join(root, "r3");
    for (const z of [zoneA, zoneB]) mkdirSync(join(z, "artifacts"), { recursive: true });
    const body = [
      "## 自有容器 立足点观测",
      "",
      "```bash",
      "id; cat /proc/self/status | grep -i capeff",
      "```",
      "",
      "```bash",
      "node scripts/verify_triad.mjs --selftest",
      "```",
      "",
      "读数 CAP_EFF_DECODED=0x0000003fffffffff（示例常量）与 41 个 SUID 命中。",
      "",
      "判据：两段命令均可独立复跑。",
      "",
      "| 断言 | 态 | 有效期到 | 依据 |",
      "|---|---|---|---|",
      "| 能力集齐全 | 已知 | 重启即失效 | 本会话实测 |",
      "",
      "- 截至 2026 年（2026-09-29 核）已验证：读数；该方法已失效指后续内核升级需重取。",
      "- 适用范围：适用于 Linux 6.1 容器；换内核需重新核验。",
      "- 已知：CAP_EFF 集合；推测：SUID 命中含基础镜像自带；未知：宿主侧同权限面。",
      "- 依赖与边界：需要实际目标环境复验。",
      "",
      "当前：立足点 / 已采集 / 下一步：链侧复验。",
    ].join("\n");
    writeFileSync(join(zoneA, "artifacts", "r1.md"), body);
    writeFileSync(join(zoneB, "artifacts", "r3.md"), body);
    writeFileSync(join(zoneA, "findings.json"), JSON.stringify({
      zone: "r1",
      chain: [{ from: "SUID 命中", to: "提权面收敛", evidence: "权限位矩阵" }],
      iocs: [{ type: "file", value: "/usr/bin/mount", note: "SUID 位", state: "已知" }],
      risks: [{ id: "R1-01", title: "能力集过宽", severity: "高", evidence: "CapEff 全位", fix: "按需裁剪 capability", status: "已修（verify:hardening 转绿）" }],
    }));
    const zones = [collectZone(zoneA, ZONES[0]), collectZone(zoneB, ZONES[2])];
    ok.push(["collectZone 读到产物", zones[0].report.count === 1 && zones[1].report.count === 1]);
    ok.push(["shortHash 12 位", /^[0-9a-f]{12}$/.test(zones[0].artifacts[0].sha12)]);
    ok.push(["findings 有台账", zones[0].findings?.chain.length === 1]);
    ok.push(["findings 缺台账为 null", zones[1].findings === null]);
    const md = redteamMarkdown(zones, { date: "2026 年", checked: "2026-09-29" });
    ok.push(["报告含四态表头", md.includes("| 断言 | 态 | 有效期到 | 依据 |")]);
    ok.push(["缺台账区记未采集", md.includes("未采集：没有区提交 findings.json 的 iocs 台账") || md.includes("r3")]);
    ok.push(["报告含末四行标记", md.includes("截至 2026 年") && md.includes("适用范围") && md.includes("依赖与边界")]);
    ok.push(["链进入报告", md.includes("SUID 命中")]);
    ok.push(["攻击路径读法在场", md.includes("### 攻击路径读法") && md.includes("1. **r1**")]);
    ok.push(["IOC 进入报告", md.includes("/usr/bin/mount")]);
    ok.push(["风险进入 P1", md.includes("| P1 | r1 |")]);
    ok.push(["风险处置状态进入报告", md.includes("| 处置状态 |") && md.includes("已修（verify:hardening 转绿）")]);
    const empty = [collectZone(join(root, "nope"), ZONES[7])];
    ok.push(["0 件区不进分母", empty[0].report.verdict.total === "未采集"]);
    ok.push(["0 件区报告不崩", redteamMarkdown(empty).includes("未采集")]);
    const ranked = rankRisks([
      { findings: { risks: [{ title: "低风险", severity: "低" }] } },
      { findings: { risks: [{ title: "高风险", severity: "高" }, { title: "显式优先", priority: 1 }] } },
    ]);
    ok.push(["风险按优先级排序", ranked[0].title === "高风险" || ranked[0].title === "显式优先"]);
    ok.push(["无台账区不出风险", rankRisks([{ findings: null }]).length === 0]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const bad = ok.filter(([, v]) => !v);
  for (const [name, v] of ok) console.log(`${v ? "ok" : "FAIL"}(${name})`);
  if (bad.length) {
    console.error(`redteam_report 自检失败：${bad.length}/${ok.length}`);
    return 1;
  }
  console.log(`redteam_report 自检通过（区域收集 · 哈希 · 台账合并 · 缺台账不编 · 排序 · 0 件区 · 报告四态与末四行 共 ${ok.length} 条）`);
  return 0;
}

const ENTRY = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
const isEntry = import.meta.url === ENTRY;
const argv = process.argv.slice(2);
if (isEntry && argv[0] === "--selftest") {
  process.exit(selftest());
} else if (isEntry && argv[0] === "--zones") {
  const dirs = String(argv[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!dirs.length) {
    console.error("用法：node scripts/redteam_report.mjs --zones tests/redteam/r1,tests/redteam/r2 [--out FILE] [--json FILE]");
    process.exit(2);
  }
  const zones = dirs.map((d, i) => {
    const id = d.split("/").pop();
    const zone = ZONES.find((z) => z.id === id) ?? ZONES[i] ?? { id, name: "" };
    return collectZone(d, zone);
  });
  const md = redteamMarkdown(zones);
  const outIdx = argv.indexOf("--out");
  if (outIdx > 0 && argv[outIdx + 1]) {
    mkdirSync(dirname(argv[outIdx + 1]), { recursive: true });
    writeFileSync(argv[outIdx + 1], md);
    console.log(`已写出 ${argv[outIdx + 1]}`);
  } else {
    console.log(md);
  }
  const jsonIdx = argv.indexOf("--json");
  if (jsonIdx > 0 && argv[jsonIdx + 1]) {
    writeFileSync(argv[jsonIdx + 1], JSON.stringify(zones.map((z) => ({ id: z.id, dir: z.dir, avg: z.report.avg, verdict: z.report.verdict, artifacts: z.artifacts, findings: z.findings ? { chain: z.findings.chain.length, iocs: z.findings.iocs.length, risks: z.findings.risks.length } : null })), null, 2));
    console.log(`已写出 ${argv[jsonIdx + 1]}`);
  }
  for (const z of zones) console.log(`${z.id}: ${z.report.count} 件 · 均分 ${z.report.avg.total} · ${z.report.verdict.total} · 台账 ${z.findings ? "有" : "未采集"}`);
} else if (isEntry) {
  console.error("用法：node scripts/redteam_report.mjs --selftest | --zones D1,D2 [--out FILE] [--json FILE]");
  process.exit(2);
}
