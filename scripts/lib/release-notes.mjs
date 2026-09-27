// 无限五代 · 发布正文的压缩器（纯函数，零依赖）
//
// 为什么存在：CHANGELOG 是「清单」，逐版全文贴进 Release 正文与包内 RELEASE-NOTES.md
// 等于把历史复制到产物里。产物描述只该带**最近一次更新**，全量叙述留在仓库内
// 《更新文档》UPDATE.md（见 scripts/version-targets.mjs 的 PROSE_ALLOWED_FILES）。
//
// 压缩规则（都可被 opts 覆盖，自检脚本 verify_release_notes.mjs 锁死默认值）：
//   1) 只取该 tag 那一段（`## vX.Y.Z ` 到下一个二级标题）；
//   2) 段落里的 `### ✨ 新特性` 这类分类标题不单独占行，改成给该组条目打 emoji 前缀；
//   3) 每条太长就截断（默认 160 字，溢出以 `…` 结尾）；
//   4) 最多留 maxBullets 条（默认 5），被丢掉的条数写成一行「其余 N 条」；
//   5) 总量超 maxChars（默认 900）也停手，避免大版本刷屏；
//   6) 末尾统一挂一行指针，指回仓库内《更新文档》。
//
// 用法：
//   import { releaseNotes, buildReleaseNotes } from "./lib/release-notes.mjs";
//   const notes = releaseNotes(changelogText, "v0.13.5");        // 直接拿正文
//   const info  = buildReleaseNotes(changelogText, "v0.13.5");   // 还要统计（自检用）

export const NOTES_POINTER =
  "> 只列最近一次更新（压缩过）。全量版本变更见仓库内《更新文档》[`UPDATE.md`](UPDATE.md)（随包附上）。";

export const NOTES_LIMITS = Object.freeze({
  maxBullets: 5,
  maxCharsPerBullet: 160,
  maxChars: 900,
});

/** 该 tag 在 CHANGELOG 里的那一段（未压缩，原样）。找不到返回 null。 */
export function changelogSection(changelog, tag) {
  const text = String(changelog ?? "");
  const start = text.indexOf("## " + tag + " ");
  if (start < 0) return null;
  const next = text.indexOf("\n## ", start + 1);
  return (next < 0 ? text.slice(start) : text.slice(start, next)).trimEnd();
}

/**
 * 把一段 CHANGELOG 压成发布正文。
 * @returns {{ found: boolean, text: string, heading: string|null, bullets: string[],
 *            dropped: number, truncatedBullets: number, chars: number }}
 */
export function buildReleaseNotes(changelog, tag, opts = {}) {
  const { maxBullets, maxCharsPerBullet, maxChars } = { ...NOTES_LIMITS, ...opts };
  const section = changelogSection(changelog, tag);
  if (!section) {
    const text = `## ${tag}\n\n（CHANGELOG 里还没有 ${tag} 段：提交标题请带 (${tag}) 作用域）\n\n${NOTES_POINTER}\n`;
    return { found: false, text, heading: null, bullets: [], dropped: 0, truncatedBullets: 0, chars: text.length };
  }

  const lines = section.split("\n");
  const heading = lines[0].trim(); // `## vX.Y.Z — YYYY-MM-DD`
  const bullets = [];
  let emoji = "";
  let truncatedBullets = 0;

  for (const line of lines.slice(1)) {
    const h = line.match(/^###\s+(\S+)\s*(.*)$/);
    if (h) {
      emoji = h[1]; // 分类标题只取开头的记号（✨ 新特性 → ✨）
      continue;
    }
    const b = line.match(/^-\s+(.*\S)\s*$/);
    if (!b) continue;
    let text = b[1];
    // 同一段里被 changelog.mjs 重复列出的条目（同一提交进了两组）只留一次
    if (bullets.some((x) => x.text === text)) continue;
    if (text.length > maxCharsPerBullet) {
      text = text.slice(0, maxCharsPerBullet - 1).trimEnd() + "…";
      truncatedBullets += 1;
    }
    bullets.push({ emoji, text });
  }

  const kept = [];
  let used = 0;
  for (const item of bullets) {
    if (kept.length >= maxBullets) break;
    const rendered = `- ${item.emoji ? item.emoji + " " : ""}${item.text}`;
    if (used + rendered.length > maxChars) break;
    used += rendered.length;
    kept.push(rendered);
  }
  const dropped = bullets.length - kept.length;
  if (dropped > 0) kept.push(`- …其余 ${dropped} 条见《更新文档》\`UPDATE.md\` / \`CHANGELOG.md\``);

  const text = [heading, "", ...kept, "", NOTES_POINTER, ""].join("\n");
  return { found: true, text, heading, bullets: kept, dropped, truncatedBullets, chars: text.length };
}

/** 只想要正文时用这个。 */
export function releaseNotes(changelog, tag, opts = {}) {
  return buildReleaseNotes(changelog, tag, opts).text;
}
