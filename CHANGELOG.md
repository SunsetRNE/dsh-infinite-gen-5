# 更新日志

本文件由 `node scripts/changelog.mjs` 从 git 提交（Conventional Commits）生成，请勿手改；
版本段落按提交标题里的 `vX.Y.Z` 切分，未带版本号的提交归入最新段；
每条末尾的短哈希是提交号，最新一条（HEAD）不标哈希 —— 它在「生成 → 提交」之间还会变。

## v0.52.0 — 2026-10-01

### 🐛 修复

- verify_step_inject 去掉版本字面量，过 verify:version 门禁
