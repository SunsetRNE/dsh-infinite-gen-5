# 发版坑矩阵（本仓库实测）

最后核对：2026-09-30（v0.50.8）。每行都对应一次真实的 CI 红或本地静默失败。

| # | 现象 | 根因（实读位置） | 判据 / 复现 | 处置 |
|---|---|---|---|---|
| 1 | CI 报 `生成文档已过期：docs/TOOL-PROTOCOLS.md` | `bump-version.mjs` 改了两个自检脚本头注释里的版本串，生成文档落后一版 | `node scripts/verify_tool_registry.mjs --selftest` | 跑 `npm run tools:doc` |
| 2 | CI 报 `生成文档已过期：docs/INDEX.md`（第一遍修完又红） | `docs/INDEX.md` 内嵌各文档**首行摘要**，其中含 `UPDATE.md` 第一行；先生成后改文档 → 生成物落后 | 比对 `docs/INDEX.md` 里 UPDATE.md 那行与 `UPDATE.md` 首行 | **先改 UPDATE/VERSIONS，再跑 tools:doc** |
| 3 | `tools:doc` 跑了却「没输出、exit 0」，CI 仍红 | 中文路径下 `import.meta.url === file://${argv[1]}` 永不相等 → `main()` 不执行 | 在 ASCII 路径跑一次对比；或看有无 `TOOLS DOC WROTE` | 在 ASCII 路径跑，或把 `argv[1]` 设成百分号编码的绝对路径 |
| 4 | `verify:dedupe` 报「useProjection 调用数保持不变 — 实得 4」 | 计数断言连**注释里的字面量**一起数 | `grep -c 'useProjection(' client.js` | 改注释措辞，或同步不变量期望值（别删断言） |
| 5 | `verify:version` 报「未登记的版本号字面量」，位置在 `skills/**/references/**` | 第三方报告（HackerOne 案例）正文里恰好有该版本串 | `node scripts/verify_version.mjs` 的报错原文 | 换一个版本号，别改 vendored 原文 |
| 6 | `tools:doc` 一次只补一份 | 生成器每跑一次只报一个 `过期=` | 连跑两次，第二次才是 `过期=无` | 跑到注册表自检绿为止 |
| 7 | 本地绿、CI 红（找不到差异） | 某些门禁在中文路径下静默空转（与 #3 同源），本地等于没跑 | 在 ASCII 工作树复跑同一条链 | 用 `git worktree add /tmp/<ascii> HEAD` 复跑 |

## 常用起手

```bash
cd <repo>
bash skills/ig5-layer-05-release/scripts/verify-release-ready.sh          # 五项判据
git worktree add -q --detach /tmp/wt HEAD && cd /tmp/wt && npm run verify:all   # ASCII 路径复跑全链
```
