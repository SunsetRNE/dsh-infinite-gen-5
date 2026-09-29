// 无限五代 v0.44.0 · 合集融合编译器（外部技能批 → 仓内技能层）
//
// 目标：把三份外部素材（Codex 技能批 / zhekk 红队终端技能 / CTF 知识库）编译成
// 仓内的技能层 `skills/<id>/`，每层 = 一份索引帧 SKILL.md + refs/ 原文副本 + MANIFEST.json。
//
// 三条硬约束（照 skill-chain.mjs 的既有口径）：
//   1. 索引帧渲染后必须 < 8192 字符（宿主 pruner 阈值），目标 ≤ 7600（SKILL_SAFE_CHARS）。
//      ⇒ 单条技能正文一律不进索引，索引只放「怎么读 + 全表在哪 + 计数」。
//   2. 原文逐字节复制，不重写、不摘要；provenance 靠 MANIFEST.json 里的 src/sha256/bytes。
//   3. 单文件超 --max-bytes（默认 256 KiB）只记 sha256 与字节数、不复制 —— 仓不背 12M 案例库，
//      但缺口可检出（manifest.skipped），要全量重跑加 --max-bytes 即可。
//
// 用法：
//   node scripts/merge_collection.mjs --src DIR          # 编译（默认 IG5_MERGE_SRC 或 /root/dsh-infinite-gen-4/合集）
//   node scripts/merge_collection.mjs --check            # 校验仓内三层：索引闸门 + manifest 逐文件 sha256
//   node scripts/merge_collection.mjs --json             # 机读摘要
//   node scripts/merge_collection.mjs --out DIR          # 指定 skills 根（自检用）
//   node scripts/merge_collection.mjs --install DIR      # 把三层装进宿主技能扫描根（缺 --apply 一律 dry-run）
//   node scripts/merge_collection.mjs --selftest         # 临时夹具自检（不进活路径）
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, cpSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, extname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");
export const MERGE_PROTOCOL = "ig5-merge-v1";
export const DEFAULT_SRC = process.env.IG5_MERGE_SRC || "/root/dsh-infinite-gen-4/合集";
export const INDEX_TARGET_CHARS = 7600; // = skill-chain SKILL_SAFE_CHARS
export const INDEX_HARD_CHARS = 8192; // = 宿主 pruner thresholdChars
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB：容下 payloader raw/web.json(1.1M) 与 H1 案例单篇(<1M)，同时给仓设硬顶
export const TEXT_EXT = new Set([".md", ".txt", ".json", ".py", ".sh", ".js", ".mjs", ".yml", ".yaml", ".csv", ".toml", ".ini", ".cfg"]);
export const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__", ".idea", ".vscode", "dist", ".cache", ".pytest_cache"]);

// 凭据样串脱敏：素材是公开披露案例集，里面难免夹着格式完整的 token/密钥样串。
// GitHub Push Protection 会拦下整条 push（GH013），而「原样搬运」又不可能逐条去核真伪 ⇒
// 编译期就地替换为 «REDACTED:<KIND>»（沿用源集里已有的标记体例），源件一字不动，
// 命中清单写进 MANIFEST.json 的 sanitized 段，`--check` 复扫确认仓内零残留。
// 只收高置信度格式（各家官方前缀/结构），不做通用 "password": "…" 泛匹配 —— 那会毁掉载荷样例。
export const SECRET_RULES = [
  { name: "aws-key-id", re: /\b(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g, marker: "«REDACTED:AWS_KEY_ID»" },
  { name: "aws-secret-access-key", re: /"SecretAccessKey"\s*:\s*"(?!«REDACTED)[^"]{20,}"/g, marker: '"SecretAccessKey" : "«REDACTED:AWS_SECRET_ACCESS_KEY»"' },
  { name: "aws-session-token", re: /"Token"\s*:\s*"(?!«REDACTED)[A-Za-z0-9+/=]{40,}"/g, marker: '"Token" : "«REDACTED:AWS_SESSION_TOKEN»"' },
  { name: "npm-auth-token", re: /(:\s*_authToken=)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g, marker: "$1«REDACTED:NPM_AUTH_TOKEN»" },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, marker: "«REDACTED:GITHUB_TOKEN»" },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, marker: "«REDACTED:GOOGLE_API_KEY»" },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, marker: "«REDACTED:SLACK_TOKEN»" },
  { name: "openai-key", re: /\bsk-[A-Za-z0-9]{32,}/g, marker: "«REDACTED:OPENAI_KEY»" },
  { name: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, marker: "«REDACTED:PRIVATE_KEY_BLOCK»" },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, marker: "«REDACTED:JWT»" },
  // 下面前缀在本次素材里未必命中，但都在 GitHub secret scanning 的 partner 模式表里 —— 留作保险，
  // 代价只是多几条永不触发的正则（命中即记进 MANIFEST.sanitized，可审计）。
  { name: "salesforce-access-token", re: /\b00D[A-Za-z0-9]{10,}!AQ[A-Za-z0-9._-]{20,}/g, marker: "«REDACTED:SALESFORCE_ACCESS_TOKEN»" },
  { name: "facebook-access-token", re: /\bEAA[A-Za-z0-9]{60,}/g, marker: "«REDACTED:FACEBOOK_ACCESS_TOKEN»" },
  { name: "stripe-key", re: /\b[rs]k_(live|test)_[A-Za-z0-9]{20,}/g, marker: "«REDACTED:STRIPE_KEY»" },
  { name: "sendgrid-key", re: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, marker: "«REDACTED:SENDGRID_KEY»" },
  { name: "gitlab-token", re: /\bglpat-[A-Za-z0-9_-]{18,}/g, marker: "«REDACTED:GITLAB_TOKEN»" },
  { name: "digitalocean-token", re: /\bdop_v1_[0-9a-f]{60,}/g, marker: "«REDACTED:DIGITALOCEAN_TOKEN»" },
  { name: "shopify-token", re: /\bshpat_[0-9a-f]{30,}/g, marker: "«REDACTED:SHOPIFY_TOKEN»" },
  { name: "huggingface-token", re: /\bhf_[A-Za-z0-9]{30,}/g, marker: "«REDACTED:HUGGINGFACE_TOKEN»" },
  { name: "google-oauth-token", re: /\bya29\.[A-Za-z0-9_-]{20,}/g, marker: "«REDACTED:GOOGLE_OAUTH_TOKEN»" },
  { name: "slack-webhook", re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]{20,}/g, marker: "«REDACTED:SLACK_WEBHOOK»" },
  { name: "discord-webhook", re: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]{40,}/g, marker: "«REDACTED:DISCORD_WEBHOOK»" },
  { name: "azure-storage-key", re: /AccountKey=[A-Za-z0-9+/=]{40,}/g, marker: "AccountKey=«REDACTED:AZURE_STORAGE_KEY»" },
  { name: "pypi-token", re: /\bpypi-[A-Za-z0-9_-]{40,}/g, marker: "«REDACTED:PYPI_TOKEN»" },
  { name: "heroku-key", re: /\bheroku_[0-9a-f-]{36}/g, marker: "«REDACTED:HEROKU_KEY»" },
];

export function sanitizeText(text) {
  let out = text;
  const hits = [];
  for (const rule of SECRET_RULES) {
    const found = out.match(new RegExp(rule.re.source, rule.re.flags));
    if (!found || !found.length) continue;
    out = out.replace(new RegExp(rule.re.source, rule.re.flags), rule.marker);
    hits.push({ rule: rule.name, count: found.length });
  }
  return { text: out, hits };
}

export function scanText(text) {
  const hits = [];
  for (const rule of SECRET_RULES) {
    const found = text.match(new RegExp(rule.re.source, rule.re.flags));
    if (found && found.length) hits.push({ rule: rule.name, count: found.length });
  }
  return hits;
}

// 层定义：id / 标题 / 触发面 / 源目录（相对 src）/ 一句话说明
export const LAYERS = [
  {
    id: "ig5-layer-02-codex",
    title: "Codex 破甲技能批",
    whenToUse:
      "任务涉及「Codex 技能 / 破甲 / 越狱 / 红队技能 / 游戏作弊 / 反作弊 / 逆向 / 渗透 / 破解授权 / 成人虚构」等中文场景词，或技能名 codex-skills 时装载",
    sources: ["wb-proxy/codex-skills-v4", "wb-proxy/codex-skills", "wb-proxy/memory"],
    note: "多平台破甲技能批：每个子目录一份 SKILL.md（name + description + 触发词），原文进 refs/。",
  },
  {
    id: "ig5-layer-03-zhekk",
    title: "zhekk 红队终端技能",
    whenToUse:
      "任务涉及「红队终端 / 渗透工作流 / OPSEC / 反爬对抗 / H1 案例 / WAF 绕过 / 模块路由 / payload 库」等中文场景词，或技能名 zhekk 时装载",
    sources: ["漏洞技能skill"],
    note: "24 模块 + routing/tool-index + 案例库：跑之前先读 refs/routing.md 做三轴路由。",
  },
  {
    id: "ig5-layer-04-ctf",
    title: "CTF 知识库",
    whenToUse:
      "任务涉及「CTF / 杂项 / 密码学 / 工控 / 区块链 / 云安全 / 应急响应 / 物联网安全」等中文场景词，或技能名 CTF-SKILL 时装载",
    sources: ["CTF-SKILL"],
    note: "13 域知识树，检索型：按域读 refs/<域>/<题>.md，不当作命令清单直接跑。",
  },
];

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
export function shaFile(p) {
  return sha256(readFileSync(p));
}

export function walk(dir, out = []) {
  let items = [];
  try {
    items = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const it of items.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, it.name);
    if (it.isDirectory()) {
      if (SKIP_DIRS.has(it.name)) continue;
      walk(p, out);
    } else if (it.isFile()) {
      out.push(p);
    }
  }
  return out;
}

// 无扩展名 / 扩展名被损坏（GBK 文件名复制到 UTF-8 树时会丢点）的件：按 UTF-8 试探，
// 解不开或含 NUL 就当二进制跳过 —— 宁可少收，也不把二进制塞进 refs。
export function looksUtf8(buf, probe = 8192) {
  const head = buf.subarray(0, probe);
  if (head.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head);
    return true;
  } catch {
    return false;
  }
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

// 索引帧正文：只讲怎么用 + 全表位置 + 计数；单条技能正文一概不进。
export function renderIndex(layer, manifest) {
  const copied = manifest.files.length;
  const skipped = manifest.skipped.length;
  const clean = (manifest.sanitized || []).length;
  const body = [
    `# 无限五代 · 合集融合层 ${layer.id}`,
    "",
    `本层由 \`scripts/merge_collection.mjs\`（协议 ${MERGE_PROTOCOL}）从外部素材编译：${layer.note}`,
    `源：${manifest.sources.join(" / ")}｜复制 ${copied} 文件 / ${(manifest.bytes / 1024).toFixed(0)} KiB｜未复制（超单文件上限）${skipped} 个。`,
    "",
    "## 怎么用",
    `1. 先读 \`${layer.id}/refs/INDEX.md\` 拿全表（每条一行：名字 / 来源 / 何时用）。`,
    `2. 命中某条后只读 \`${layer.id}/refs/<path>\` 对应的原文 —— 逐字节复制，未改写、未摘要。`,
    `3. 本层不替代 ig5 域包：域包给 5 槽骨架，本层给展开细节；冲突时以域包与内核契约优先。`,
    `4. 缺口（未复制的超限件）登记在 \`${layer.id}/MANIFEST.json\` 的 \`skipped\` 里，含 sha256。`,
    clean
      ? `5. 凭据样串脱敏：${clean} 个文件里的格式完整 token/密钥按 \`«REDACTED:<KIND>»\` 就地替换（源件未改，逐条记在 MANIFEST.json 的 \`sanitized\`），故这些件的产物 sha256 与源 sha256 不同。`
      : `5. 凭据样串脱敏：本层零命中（\`--check\` 每次复扫）。`,
    "",
    "## 计数",
    `- 复制：${copied} 文件（${(manifest.bytes / 1024).toFixed(0)} KiB），逐文件 sha256 见 MANIFEST.json`,
    `- 未复制：${skipped} 个（> ${(manifest.maxBytes / 1024).toFixed(0)} KiB 或非文本扩展名）`,
    `- 脱敏：${clean} 个文件`,
    `- 索引帧 SHA256：编译后写入 metadata.indexSha256（自指不写正文，避免自指哈希）`,
  ].join("\n");
  const fm = [
    "---",
    `name: ${layer.id}`,
    `description: 无限五代合集融合层 ${layer.id}（${layer.title}）：任务涉及「${layer.whenToUse.replace(/^任务涉及「/, "").replace(/」等中文场景词.*$/, "")}」时装载 | ${layer.note}`,
    `whenToUse: ${layer.whenToUse}`,
    "metadata:",
    `  protocol: ${MERGE_PROTOCOL}`,
    "  generatedBy: scripts/merge_collection.mjs",
    `  source: ${manifest.sources.join(",")}`,
    `  files: ${copied}`,
    `  skipped: ${skipped}`,
    `  bytes: ${manifest.bytes}`,
    "---",
    "",
  ].join("\n");
  return fm + body + "\n";
}

export function compileLayer(layer, srcRoot, outRoot, { maxBytes = DEFAULT_MAX_BYTES, stamp = "" } = {}) {
  const dstDir = join(outRoot, layer.id);
  const refsDir = join(dstDir, "refs");
  const abs = layer.sources.map((s) => join(srcRoot, s));
  const present = abs.filter((p) => existsSync(p));
  if (!present.length) throw new Error(`源不存在：${abs.join(" / ")}`);
  rmSync(dstDir, { recursive: true, force: true });
  mkdirSync(refsDir, { recursive: true });
  const files = [];
  const skipped = [];
  const sanitized = [];
  let bytes = 0;
  for (const src of present) {
    for (const f of walk(src)) {
      const rel = relative(srcRoot, f);
      const ext = extname(f).toLowerCase();
      const size = statSync(f).size;
      const buf = readFileSync(f);
      const h = sha256(buf);
      const isText = TEXT_EXT.has(ext) || (ext === "" && looksUtf8(buf));
      if (!isText) {
        skipped.push({ src: rel, reason: "non-text-ext", bytes: size, sha256: h });
        continue;
      }
      if (size > maxBytes) {
        skipped.push({ src: rel, reason: "over-max-bytes", bytes: size, sha256: h });
        continue;
      }
      const dst = join(refsDir, rel);
      mkdirSync(dirname(dst), { recursive: true });
      const clean = sanitizeText(buf.toString("utf8"));
      if (clean.hits.length) {
        // 有命中：写脱敏后的文本（源件不动），清单里同时钉源 sha 与产物 sha
        writeFileSync(dst, clean.text);
        const ob = Buffer.from(clean.text, "utf8");
        files.push({ src: rel, dst: `refs/${rel}`, bytes: ob.length, sha256: sha256(ob), srcBytes: size, srcSha256: h, sanitized: clean.hits });
        sanitized.push({ src: rel, rules: clean.hits, srcSha256: h, outSha256: sha256(ob) });
        bytes += ob.length;
      } else {
        cpSync(f, dst);
        files.push({ src: rel, dst: `refs/${rel}`, bytes: size, sha256: h });
        bytes += size;
      }
    }
  }
  // INDEX.md：全部条目一行一条，供装载后按需读
  const lines = ["# " + layer.title + " · 全表", "", "| 名字 | 来源 |", "| --- | --- |"];
  for (const it of files) {
    if (extname(it.dst).toLowerCase() !== ".md") continue;
    const text = readFileSync(join(dstDir, it.dst), "utf8");
    const fm = frontmatter(text);
    const name = fm.name || it.dst.replace(/^refs\//, "").replace(/\.md$/, "");
    const desc = (fm.description || "").replace(/\|/g, "/").slice(0, 90);
    lines.push(`| ${name}${desc ? " — " + desc : ""} | ${it.src} |`);
  }
  const indexPath = join(refsDir, "INDEX.md");
  writeFileSync(indexPath, lines.join("\n") + "\n");
  const idx = { src: `refs/INDEX.md`, dst: `refs/INDEX.md`, bytes: statSync(indexPath).size, sha256: shaFile(indexPath) };
  files.push(idx);
  bytes += idx.bytes;
  const manifest = {
    layer: layer.id,
    protocol: MERGE_PROTOCOL,
    title: layer.title,
    sources: layer.sources.filter((s) => present.includes(join(srcRoot, s))),
    srcRoot,
    stamp,
    maxBytes,
    files,
    skipped,
    sanitized,
    counts: { copied: files.length, skipped: skipped.length, sanitized: sanitized.length },
    bytes,
  };
  const indexText = renderIndex(layer, manifest);
  manifest.indexSha256 = sha256(Buffer.from(indexText, "utf8"));
  manifest.indexBytes = Buffer.byteLength(indexText, "utf8");
  writeFileSync(join(dstDir, "SKILL.md"), indexText);
  writeFileSync(join(dstDir, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export function checkLayer(layer, outRoot) {
  const errs = [];
  const dstDir = join(outRoot, layer.id);
  const skillFile = join(dstDir, "SKILL.md");
  const manifestFile = join(dstDir, "MANIFEST.json");
  if (!existsSync(skillFile)) return [`缺索引帧 ${layer.id}/SKILL.md`];
  if (!existsSync(manifestFile)) return [`缺清单 ${layer.id}/MANIFEST.json`];
  const text = readFileSync(skillFile, "utf8");
  const fm = frontmatter(text);
  if (fm.name !== layer.id) errs.push(`${layer.id}: frontmatter name=${fm.name} 不等于层 id`);
  if (!fm.description) errs.push(`${layer.id}: frontmatter 缺 description`);
  if (!fm.whenToUse) errs.push(`${layer.id}: frontmatter 缺 whenToUse`);
  const chars = Buffer.byteLength(text, "utf8");
  if (chars >= INDEX_HARD_CHARS) errs.push(`${layer.id}: 索引帧 ${chars} ≥ 硬上限 ${INDEX_HARD_CHARS}（装载即截断）`);
  else if (chars > INDEX_TARGET_CHARS) errs.push(`${layer.id}: 索引帧 ${chars} > 目标 ${INDEX_TARGET_CHARS}`);
  const man = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (man.indexSha256 !== sha256(Buffer.from(text, "utf8"))) errs.push(`${layer.id}: 索引帧被改过（sha256 不匹配 manifest）`);
  for (const it of man.files || []) {
    const p = join(dstDir, it.dst);
    if (!existsSync(p)) {
      errs.push(`${layer.id}: 缺文件 ${it.dst}`);
      continue;
    }
    const h = shaFile(p);
    if (h !== it.sha256) errs.push(`${layer.id}: ${it.dst} sha256 漂移`);
    if (statSync(p).size !== it.bytes) errs.push(`${layer.id}: ${it.dst} 字节数漂移`);
    // 复扫：产物里不许留格式完整的凭据样串（push 会被 GH013 拦）
    if (/\.(md|txt|json|ya?ml|csv|toml|ini|cfg)$/i.test(it.dst)) {
      const t = readFileSync(p, "utf8");
      const hits = scanText(t);
      if (hits.length) errs.push(`${layer.id}: ${it.dst} 仍含凭据样串 ${hits.map((x) => `${x.rule}×${x.count}`).join(",")}`);
    }
  }
  return errs;
}

function selftest() {
  const tmp = "/tmp/ig5-merge-selftest";
  rmSync(tmp, { recursive: true, force: true });
  const src = join(tmp, "src");
  mkdirSync(join(src, "wb-proxy/codex-skills-v4/alpha"), { recursive: true });
  mkdirSync(join(src, "wb-proxy/codex-skills"), { recursive: true });
  mkdirSync(join(src, "wb-proxy/memory"), { recursive: true });
  writeFileSync(join(src, "wb-proxy/codex-skills-v4/alpha/SKILL.md"), "---\nname: alpha\ndescription: A 测试技能。\n---\n\n# alpha\n");
  writeFileSync(join(src, "wb-proxy/codex-skills-v4/big.md"), "x".repeat(4096));
  writeFileSync(join(src, "wb-proxy/codex-skills/legacy.md"), "# legacy\n");
  writeFileSync(join(src, "wb-proxy/memory/user-profile.md"), "# profile\n");
  mkdirSync(join(src, "漏洞技能skill"), { recursive: true });
  // 夹具内联的 token 由分段拼装 —— 连自检文件本身都不留完整凭据样串（否则 push 会被 GH013 拦）
  const fixtureToken = ["38bb8d1f", "a39b", "47d1", "a78e", "3bf0626ff77e"].join("-");
  writeFileSync(join(src, "漏洞技能skill/SKILL.md"), "---\nname: zhekk\ndescription: z 技能。\n---\n\n# zhekk\n\n//registry.npmjs.org/:_authToken=" + fixtureToken + "\n");
  mkdirSync(join(src, "CTF-SKILL/Web安全"), { recursive: true });
  writeFileSync(join(src, "CTF-SKILL/Web安全/SQL注入.md"), "# SQL\n");
  const out = join(tmp, "skills");
  const only = LAYERS.filter((l) => l.id !== "ig5-layer-03-zhekk" || true);
  const mans = only.map((l) => compileLayer(l, src, out, { maxBytes: 2048 }));
  const bad = [];
  for (const l of only) bad.push(...checkLayer(l, out));
  const codex = mans.find((m) => m.layer === "ig5-layer-02-codex");
  if (codex.counts.copied !== 4) bad.push(`codex 复制数 ${codex.counts.copied} != 4`);
  if (codex.counts.skipped !== 1) bad.push(`codex 未复制数 ${codex.counts.skipped} != 1（4 KiB 超 2 KiB 上限）`);
  // 脱敏：夹具 zhekk 索引件里埋了格式完整的 npm token，必须被抓到并替换
  const zman = mans.find((m) => m.layer === "ig5-layer-03-zhekk");
  if (!zman.counts.sanitized) bad.push("脱敏未触发（夹具里的 npm _authToken 没被抓到）");
  const ztext = readFileSync(join(out, "ig5-layer-03-zhekk/refs/漏洞技能skill/SKILL.md"), "utf8");
  if (ztext.includes(fixtureToken)) bad.push("脱敏不彻底（产物里仍是原文 token）");
  if (!ztext.includes("«REDACTED:NPM_AUTH_TOKEN»")) bad.push("脱敏标记未写入产物");
  if (scanText(ztext).length) bad.push("脱敏后复扫仍命中规则");
  const man = JSON.parse(readFileSync(join(out, "ig5-layer-02-codex/MANIFEST.json"), "utf8"));
  man.files[0].sha256 = "0".repeat(64);
  writeFileSync(join(out, "ig5-layer-02-codex/MANIFEST.json"), JSON.stringify(man));
  const holes = checkLayer(LAYERS[0], out);
  if (!holes.some((e) => /sha256 漂移/.test(e))) bad.push("篡改检测未生效（伪造 sha256 未被抓到）");
  console.log(bad.length ? "MERGE SELFTEST FAILED\n" + bad.join("\n") : `MERGE SELFTEST OK layers=${only.length} files=${mans.reduce((n, m) => n + m.counts.copied, 0)}`);
  return bad.length ? 1 : 0;
}

function main(argv) {
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : d;
  };
  const asJson = argv.includes("--json");
  if (argv.includes("--selftest")) process.exit(selftest());
  const outRoot = resolve(arg("--out", join(ROOT, "skills")));
  if (argv.includes("--check")) {
    const errs = LAYERS.flatMap((l) => checkLayer(l, outRoot));
    if (asJson) console.log(JSON.stringify({ ok: errs.length === 0, errors: errs }, null, 2));
    else console.log(errs.length ? "MERGE CHECK FAILED\n" + errs.join("\n") : `MERGE CHECK OK layers=${LAYERS.length} root=${outRoot}`);
    process.exit(errs.length ? 1 : 0);
  }
  if (argv.includes("--install")) {
    const target = resolve(arg("--install", ""));
    const apply = argv.includes("--apply");
    const plan = LAYERS.map((l) => ({ layer: l.id, from: join(outRoot, l.id), to: join(target, l.id) }));
    const missing = plan.filter((p) => !existsSync(join(p.from, "SKILL.md"))).map((p) => p.from);
    if (missing.length) {
      console.log(`MERGE INSTALL FAILED 缺层（先跑 --src 编译）：\n` + missing.join("\n"));
      process.exit(1);
    }
    if (!apply) {
      console.log(`MERGE INSTALL DRY-RUN target=${target}`);
      for (const p of plan) console.log(`  ${p.from} -> ${p.to}`);
      console.log(`  rollback: rm -rf ${plan.map((p) => `"${p.to}"`).join(" ")}`);
      process.exit(0);
    }
    for (const p of plan) {
      rmSync(p.to, { recursive: true, force: true });
      mkdirSync(dirname(p.to), { recursive: true });
      cpSync(p.from, p.to, { recursive: true });
    }
    const errs = LAYERS.flatMap((l) => checkLayer(l, target));
    console.log(errs.length ? "MERGE INSTALL CHECK FAILED\n" + errs.join("\n") : `MERGE INSTALL OK target=${target} layers=${plan.length}`);
    process.exit(errs.length ? 1 : 0);
  }
  const src = resolve(arg("--src", DEFAULT_SRC));
  const maxBytes = Number(arg("--max-bytes", DEFAULT_MAX_BYTES));
  if (!existsSync(src)) {
    console.error(`源目录不存在：${src}（用 --src 或 IG5_MERGE_SRC 指定）`);
    process.exit(2);
  }
  const mans = LAYERS.map((l) => compileLayer(l, src, outRoot, { maxBytes }));
  if (asJson) console.log(JSON.stringify({ protocol: MERGE_PROTOCOL, root: outRoot, layers: mans.map((m) => ({ layer: m.layer, copied: m.counts.copied, skipped: m.counts.skipped, bytes: m.bytes, indexBytes: m.indexBytes })) }, null, 2));
  else {
    console.log(`MERGE OK protocol=${MERGE_PROTOCOL} root=${outRoot}`);
    for (const m of mans) console.log(`  ${m.layer}: copied=${m.counts.copied} skipped=${m.counts.skipped} bytes=${m.bytes} index=${m.indexBytes}B`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
