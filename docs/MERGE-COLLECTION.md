# 素材融合：三个技能层 + 一个伴生插件（ig5-merge-v1）

把 `合集/` 里四份外部素材编译成**可追溯、可复算、可回滚**的 ig5 资产。全程只做「原样搬运 + 清单钉哈希」，不对素材内容做改写。

## 1. 融合了什么

| 资产 | 类型 | 源 | 结果（实测） |
| --- | --- | --- | --- |
| `ig5-layer-02-codex` | 技能层 | `wb-proxy/codex-skills-v4` + `wb-proxy/codex-skills` + `wb-proxy/memory` | 复制 **736** 个文本文件 / 跳过 **28** 个 / 10,810,185 B；索引 sha256 `5f8d2a142b08bb1d…` |
| `ig5-layer-03-zhekk` | 技能层 | `漏洞技能skill` | 复制 **321** 个 / 跳过 0 / 11,129,206 B；索引 sha256 `1d25f16aab2c2303…` |
| `ig5-layer-04-ctf` | 技能层 | `CTF-SKILL` | 复制 **155** 个 / 跳过 0 / 674,416 B；索引 sha256 `6228997406db9bca…` |
| `dsh-persona-volt` | 伴生插件 | `dsh-persona-volt` | 4 个文件 / 36,299 B；`MERGE-MANIFEST.json` 逐文件钉 sha256 |

三层都插在既有 `ig5-layer-01`（内核技能帧，3325 B，sha256 `89480ddbde94addd…`）之后，编号 02–04，**不改动 01**。

## 2. 编译（源 → 仓内 `skills/`）

```bash
cd /root/dsh-infinite-gen-5
node scripts/merge_collection.mjs --src /root/dsh-infinite-gen-4/合集        # 编译三层，写 skills/<id>/
node scripts/merge_collection.mjs --check                                    # 复算每层清单 sha256 + 字节数
node scripts/merge_collection.mjs --selftest                                 # 夹具自测（含伪造 sha256 必须被抓）
```

判据（本会话实测）：

```text
MERGE SELFTEST OK layers=3 files=736+321+155
MERGE CHECK OK layers=3 root=/root/dsh-infinite-gen-5/skills
```

每层产物 = `SKILL.md`（技能帧，带 `name`/`description` 前置元数据）+ `INDEX.md`（源清单，`indexSha256` 记在 MANIFEST）+ `MANIFEST.json`（`protocol: ig5-merge-v1`）+ `refs/<源相对路径>`（原样副本）。

跳过规则写进清单，逐条带 `reason` 与 `sha256`：非文本扩展名（`.ps1` / `.png` / `.svg` / `.keystore` / `.cjs`）不搬，避免二进制进技能扫描面。28 条跳过全部落在 `ig5-layer-02-codex/MANIFEST.json` 的 `skipped` 数组里。

## 3. 装入宿主技能根

```bash
node scripts/merge_collection.mjs --install ~/.dsh/skills            # dry-run：只打印计划与回滚行
node scripts/merge_collection.mjs --install ~/.dsh/skills --apply    # 真装：先删后拷，再复算目标端清单
```

实测 `MERGE INSTALL OK target=/root/.dsh/skills layers=3`，装后体积 `layer-01 7.5K / layer-04 1.0M / layer-03 12M / layer-02 14M`。

回滚：`rm -rf ~/.dsh/skills/ig5-layer-02-codex ~/.dsh/skills/ig5-layer-03-zhekk ~/.dsh/skills/ig5-layer-04-ctf`（dry-run 会把这行原样打印出来）。

## 4. 伴生插件（VOLT）

`companions/dsh-persona-volt/` 是逐字节副本，`MERGE-MANIFEST.json` 钉每个文件：

| 文件 | 字节 | sha256（前 16 位） |
| --- | --- | --- |
| `lib/index.js` | 2860 | — |
| `cordis.patch.yml` | 25573 | `5eeb096304b373d4` |
| `package.json` | 1925 | `c4657421149f93df` |
| `README.md` | 5941 | `7f8ede12e53e94a7` |

```bash
node scripts/install_companion.mjs --selftest        # COMPANION SELFTEST OK files=4 bytes=36299
node scripts/install_companion.mjs --check           # COMPANION CHECK OK
node scripts/install_companion.mjs --install --apply # 装到 ~/.dsh/plugin-src/dsh-persona-volt
```

实测 `COMPANION INSTALL OK /root/.dsh/plugin-src/dsh-persona-volt（files=4 bytes=36299）`。

**激活是宿主的事**：`~/.dsh/plugin-activations.json` 是加载器账本（fingerprint / startup / loadedAt 都是运行时事实），脚本不手改。装完在 GUI 插件页打开开关，或重启 DSH。

核验一条：

```bash
python3 -c "import json;print('dsh-persona-volt' in json.load(open('/root/.dsh/plugin-activations.json'))['entries'])"
```

插件的唯一依赖 `@deepseek-ai/schemastery` 在 DSH 安装树里存在（`/usr/local/lib/node_modules/@deepseek-ai/schemastery`），所以装载不需要额外 `npm install`。

## 5. 门禁接线

`package.json`：`merge:collection` / `verify:merge` / `companion:check` / `companion:install` / `verify:companion`；`verify:all` 在 `verify:merge` 之后串入 `verify:companion`，与其余 40 余项一起跑。

## 6. 凭据样串脱敏（唯一的内容改写）

素材含公开披露案例原文，里面夹着格式完整的 token / 密钥样串；直推时 GitHub Push Protection 直接以 `GH013` 拦下整条 push（实测命中 AWS 三件套、npm Access Token、Salesforce / Facebook Access Token 等）。编译器因此在写入阶段做一遍替换，**源件一字不动**：

- `SECRET_RULES`（`scripts/merge_collection.mjs`）按前缀族匹配：`jwt`、`private-key-block`、AWS 三件套、`github-token`、`npm-auth-token`、`google-api-key`、`slack-token`、`openai-key`、`stripe/sendgrid/gitlab/digitalocean/shopify/huggingface/pypi/heroku-key`、`salesforce/facebook-access-token`、`slack/discord-webhook`、`google-oauth-token`、`azure-storage-key`；替换体沿用素材既有体例 `«REDACTED:<KIND>»`。
- 命中文件写脱敏文本并记 `sanitized[]`（源 sha256 → 产物 sha256）、`counts.sanitized`；未命中文件仍逐字节 `cpSync`。实测：layer-02 命中 6 文件（`jwt` 6 处）、layer-03 命中 18 文件（`jwt` 20 / `github-token` 4 / `private-key-block` 4 / `google-api-key` 3 / AWS 三件套各 2 / `npm-auth-token` 1）、layer-04 命中 0。
- `--check` 复扫产物（`.md/.txt/.json/.ya?ml/.csv/.toml/.ini/.cfg`），命中即 `MERGE CHECK FAILED`；自检夹具里的 token 也是分段拼装，连自检文件本身都不留完整串。`aws-*` 两条规则带负向前瞻 `(?!«REDACTED)`，避免替换标记自己被复扫自命中。
- 边界：脱敏**只针对高置信前缀族**，不做 `"password": "…"` 泛匹配（会毁掉载荷样例）；判据是「能通过 GitHub 秘密扫描」，不是「内容安全审查」。

## 7. 已知边界

- 融合不保证「素材里写的工具在目标机上存在」——每层的 `refs/` 是知识文本，运行时要按工具链协议现场探测（缺工具是待办，不是阻塞）。
- 三层合计 26 MB 落在技能扫描根；`ig5-layer-02/03` 体积来自源素材本身，不做压缩或摘要，保持原样可复算。
- 跳过清单是唯一白名单：任何以后新增的二进制素材同样进 `skipped` 并记哈希，不会静默丢弃。
