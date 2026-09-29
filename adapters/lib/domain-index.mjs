// 公共层 · 领域索引抽取（零宿主名、零运行期 import）
//
// 为什么需要它：适配器要往宿主里放一张「有哪些领域包」的目录，但这张目录必须是**索引**，
// 不是语料。此前把 prompts/infinite-gen-5.full.md 当索引源是错的 —— 实测那份文件
// 是「常驻内核 + 惰性章节 + Format examples 示例」，与领域包无关，照搬会把 21 KB 示例
// 当成索引塞进通道，直接把 generic / claude 顶到 38187 B 超预算。
//
// 真正的域真源是 data/scenarios.mjs。本模块**用文本解析**读它，不做 import：
// 语法层隔离，宿主升级不会因为数据模块的导出面变化而把适配器一起拖崩。

/** 从 scenarios.mjs 文本里抽出领域条目。只认块首那几行字段，不碰 markers/notes/skeleton。 */
export function parseDomains(source) {
  const domains = [];
  // 实测形状（od -c 核过，非猜测）：`  {` 单行，随后 `    id:` 起字段各占一行，缩进 4 空格。
  const re = /^ {2}\{\n {4}id: "([a-z_]+)",\n {4}family: "([a-z_]+)",\n {4}label: "([^"]+)",\n {4}aliases: \[([^\]]*)\]/gm;
  for (const m of source.matchAll(re)) {
    const aliases = m[4]
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    domains.push({ id: m[1], family: m[2], label: m[3], aliases });
  }
  return domains;
}

export function parseFamilies(source) {
  const families = [];
  const re = /^ {2}\{ id: "([a-z_]+)", label: "([^"]+)", note: "([^"]+)" \},$/gm;
  for (const m of source.matchAll(re)) families.push({ id: m[1], label: m[2], note: m[3] });
  return families;
}

/**
 * 渲染成紧凑索引。每条域一行：`- <id> · <label> —— <少量别名>`。
 * 别名按「用户真会打的词」截断，默认 6 个 —— 全量别名会把索引撑成语料。
 */
export function renderDomainIndex({ domains, families, aliasLimit = 4, asciiOnly = true, title = "领域索引" }) {
  const lines = [`## ${title}（${domains.length} 域 / ${families.length} 族）`, ""];
  for (const fam of families) {
    const inFam = domains.filter((d) => d.family === fam.id);
    if (!inFam.length) continue;
    lines.push(`**${fam.label}**（${inFam.length}）：${fam.note}`);
    for (const d of inFam) {
      // 中文别名占 3 B/字，只在索引里起到「同义词也一样命中」的作用；
      // 无工具通道的预算是硬约束，默认只留 ASCII 别名，中文别名留给域正文（按需取）。
      const pool = asciiOnly ? d.aliases.filter((a) => /^[\x20-\x7e]+$/.test(a)) : d.aliases;
      const aliases = pool.slice(0, aliasLimit).join(" / ");
      lines.push(`- \`${d.id}\` · ${d.label}${aliases ? ` —— ${aliases}` : ""}`);
    }
    lines.push("");
  }
  lines.push(
    "查不到命中时按同族最近的一条走，不要现编域；域正文通过工具取（无工具通道则由用户粘贴）。",
  );
  return lines.join("\n");
}

export function domainIndexStats(domains, families) {
  const byFamily = {};
  for (const d of domains) byFamily[d.family] = (byFamily[d.family] ?? 0) + 1;
  return {
    domains: domains.length,
    families: families.length,
    byFamily,
    aliasTotal: domains.reduce((s, d) => s + d.aliases.length, 0),
  };
}
