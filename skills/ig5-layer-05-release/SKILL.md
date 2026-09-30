---
name: ig5-layer-05-release
description: 无限五代仓库自身的发版前自检：任务涉及「发版 / 打补丁 / 版本号提升 / CI 红了 / 自检同步 / tag / 生成文档过期」时装载。内含本仓库实测的五类发版坑（tools:doc 一次只补一份文档、docs/INDEX.md 内嵌 UPDATE 首行导致顺序敏感、中文路径下生成器静默空转、verify:dedupe 的钩子计数连注释一起数、vendored 版本字面量撞版本门禁）与一条可跑的 verify-release-ready.sh。
license: 随本仓库
---

# ig5-layer-05-release · 发版前自检

## 何时用

- 要提升版本号 / 打 tag / 发版；或 CI 刚红了要定位。
- 改了 `client.js`、`index.js`、任何 `scripts/verify_*.mjs`、任何文档。
- 现象是「本地绿、CI 红」——本层的五条判据就是为这个现象写的。

## 铁律（每条都是本会话真踩出来的）

1. **生成文档的顺序是刚性的**：`docs/INDEX.md` 里内嵌每个文档的**首行摘要**，其中就有 `UPDATE.md` 的第一行。
   所以必须先改 `UPDATE.md` / `VERSIONS.md`，**再**跑 `tools:doc`；反过来必然 CI 红
   （报 `生成文档已过期：docs/INDEX.md`）。
2. **`tools:doc` 一次只补一份文档**：跑一次只报一个 `过期=`，要跑到 `verify_tool_registry` 绿为止（通常两遍）。
3. **中文路径下生成器静默空转**：`gen_tool_docs.mjs` 用 `import.meta.url === file://${argv[1]}` 判主模块，
   路径被百分号编码后永不相等 → 脚本 exit 0 且没有任何输出，看起来「跑过了」。要么在 ASCII 路径跑，
   要么把 `argv[1]` 设成编码后的绝对路径（见 `scripts/verify-release-ready.sh` 的提示）。
4. **计数型断言会把注释一起数**：`verify_dedupe.mjs` 数 `useProjection(`，注释里写一次就多一个；
   要么改注释措辞，要么同步期望值 —— 但不要「为了过而删断言」。
5. **vendored 文件里的版本字面量会撞版本门禁**：`verify:version` 扫全树找未登记版本号，
   第三方报告正文里的 `0.49.0` 也会被算上。换一个版本号最省事，别去改 vendored 原文。

## 流程

```bash
cd <repo>                                   # 建议 ASCII 路径，或按上面第 3 条绕
bash skills/ig5-layer-05-release/scripts/verify-release-ready.sh    # 五项机械判据 + 四态回执
node scripts/bump-version.mjs <X.Y.Z>       # 版本号
$EDITOR UPDATE.md VERSIONS.md               # ← 先改文档
npm run tools:doc && npm run tools:doc      # 再生成（可能两遍）
npm run changelog
node scripts/verify_version.mjs && node scripts/verify_ui.mjs && npm run verify:dedupe
git add -A && git commit && git tag -a v<X.Y.Z> -m "无限五代 v<X.Y.Z>" && git push origin main && git push origin v<X.Y.Z>
```

## 判据（本层自检）

```bash
bash skills/ig5-layer-05-release/scripts/verify-release-ready.sh --selftest   # 静态档，任何机器可跑
bash skills/ig5-layer-05-release/scripts/verify-release-ready.sh              # 全量档（会真读仓库文件）
```
