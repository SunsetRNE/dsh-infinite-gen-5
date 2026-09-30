# ⚔️ DeepSeek-V4.1 / V4 Flash 网络安全红队工具（无限五代）v0.51.1

<p align="center">
  <a href="dsh://plugin/install?id=dsh-infinite-gen-5&name=%E6%97%A0%E9%99%90%E4%BA%94%E4%BB%A3&version=0.51.1&repo=SunsetRNE%2Fdsh-infinite-gen-5&permissions=%E7%B3%BB%E7%BB%9F%E6%8F%90%E7%A4%BA%E8%AF%8D%E6%B3%A8%E5%85%A5%2C%E5%AE%A2%E6%88%B7%E7%AB%AF%E7%8A%B6%E6%80%81%E6%9D%A1&downloadUrl=https%3A%2F%2Fgithub.com%2FSunsetRNE%2Fdsh-infinite-gen-5%2Farchive%2Frefs%2Fheads%2Fmain.zip">
    <img src="https://img.shields.io/badge/DeepSeek%20Harness-🚀%20唤起桌面客户端一键安装无限五代-10B981?style=for-the-badge&logo=deepseek&logoColor=white" alt="唤起桌面客户端一键安装" />
  </a>
</p>

> 🌐 **插件生态市场**：[DeepSeek Harness Hub - DeepSeek 官方与开源生态市场 | 插件发现与一键安装](https://deepseek.stream/)

---

## 📊 它做什么（速览）

面向 **DeepSeek-V4.1 / V4-Pro / Flash** 的系统提示词注入 + 红队基准评测插件（DSH 插件形态，单仓库自包含、无运行期依赖）。根目录只放**安装、验证、索引**；描述性长文全部在 [`docs/`](docs/INDEX.md)。

| 维度 | 无限五代 |
|---|---|
| 目标模型 | DeepSeek-V4.1 / V4-Pro / Flash 全系列 |
| 注入架构 | 首句层 + 单内核 + 中段锚点 + 真末位锚点 + 运行时锚点；同源载荷自动让位；压缩事件触发再锚定 |
| 工具面 | 原生零工具面（消除决策噪音）；域包与工具链经 `infinite_gen5_scenario` 按需取用 |
| 输出契约 | 首 Token 强制诱导（`##` / ```）+ 禁词自检 |
| 评测面 | 400 分制（服从 / 效率 / 稳定 / 攻击性）+ 回执证据链 + 邻接补轮 |
| 环境探测 | `infinite_gen5_env` 只读探测形态 / 资源 / 出网 / 库存 / 能力位 / 域就绪度，把「缺工具」翻成「装什么」 |
| 分发形态 | 单仓库自包含，无 `node_modules`、无运行期依赖；`dsh://` 一键安装 |

机制细节（七处注入位置、首句层与压缩后再锚定、面板调参、素材融合层）：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。目录结构：[docs/LAYOUT.md](docs/LAYOUT.md)。

> **合规定位**：受控环境下的红队科研与鲁棒性基准评测套件；完整免责与第三方声明见 [docs/LEGAL.md](docs/LEGAL.md)。

---

## ⚡ 一键安装

### 方式 1：dsh:// 协议联动一键安装（⚡ 桌面端最快，秒级免命令行）

若已安装 DeepSeek Harness 官方桌面客户端（EXE），点击下方按钮即可通过系统级 URI Scheme 协议安全唤起客户端完成免命令行秒级装载：
<p align="center">
  <a href="dsh://plugin/install?id=dsh-infinite-gen-5&name=%E6%97%A0%E9%99%90%E4%BA%94%E4%BB%A3&version=0.51.1&repo=SunsetRNE%2Fdsh-infinite-gen-5&permissions=%E7%B3%BB%E7%BB%9F%E6%8F%90%E7%A4%BA%E8%AF%8D%E6%B3%A8%E5%85%A5%2C%E5%AE%A2%E6%88%B7%E7%AB%AF%E7%8A%B6%E6%80%81%E6%9D%A1&downloadUrl=https%3A%2F%2Fgithub.com%2FSunsetRNE%2Fdsh-infinite-gen-5%2Farchive%2Frefs%2Fheads%2Fmain.zip">
    <img src="https://img.shields.io/badge/DeepSeek%20Harness-🚀%20唤起桌面客户端一键安装无限五代-10B981?style=for-the-badge&logo=deepseek&logoColor=white" alt="唤起客户端一键安装" />
  </a>
</p>

🔗 **原生协议链接：**

```
dsh://plugin/install?id=dsh-infinite-gen-5&name=%E6%97%A0%E9%99%90%E4%BA%94%E4%BB%A3&version=0.51.1&repo=SunsetRNE%2Fdsh-infinite-gen-5&permissions=%E7%B3%BB%E7%BB%9F%E6%8F%90%E7%A4%BA%E8%AF%8D%E6%B3%A8%E5%85%A5%2C%E5%AE%A2%E6%88%B7%E7%AB%AF%E7%8A%B6%E6%80%81%E6%9D%A1&downloadUrl=https%3A%2F%2Fgithub.com%2FSunsetRNE%2Fdsh-infinite-gen-5%2Farchive%2Frefs%2Fheads%2Fmain.zip
```

**网页端（前端）触发代码示例：**

```js
/**
 * 唤起 DeepSeek Harness 桌面客户端一键安装无限五代插件
 */
export function installInfiniteGen5ToDesktop() {
  const params = new URLSearchParams({
    id: 'dsh-infinite-gen-5',
    name: '无限五代',
    version: '0.11.1',
    repo: 'SunsetRNE/dsh-infinite-gen-5',
    permissions: '系统提示词注入, 客户端状态条',
    downloadUrl: 'https://github.com/SunsetRNE/dsh-infinite-gen-5/archive/refs/heads/main.zip',
  });

  const deepLink = `dsh://plugin/install?${params.toString()}`;

  // 通过隐藏 iframe 安全静默拉起协议
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = deepLink;
  document.body.appendChild(iframe);
  setTimeout(() => document.body.removeChild(iframe), 2000);
}
```

**HTML 静态链接方式：**

```html
<a href="dsh://plugin/install?id=dsh-infinite-gen-5&name=%E6%97%A0%E9%99%90%E4%BA%94%E4%BB%A3&version=0.51.1&repo=SunsetRNE%2Fdsh-infinite-gen-5&permissions=%E7%B3%BB%E7%BB%9F%E6%8F%90%E7%A4%BA%E8%AF%8D%E6%B3%A8%E5%85%A5%2C%E5%AE%A2%E6%88%B7%E7%AB%AF%E7%8A%B6%E6%80%81%E6%9D%A1&downloadUrl=https%3A%2F%2Fgithub.com%2FSunsetRNE%2Fdsh-infinite-gen-5%2Farchive%2Frefs%2Fheads%2Fmain.zip" class="btn-install">
  🚀 唤起客户端一键安装
</a>
```

**协议参数配置（dsh://plugin/install）：**

| 参数名 | 值 / 示例 | 说明 |
|---|---|---|
| id | `dsh-infinite-gen-5` | 插件唯一标识符 |
| name | `无限五代`（URL 编码） | 插件展示名称 |
| version | `0.11.1` | 语义化版本号 |
| repo | `SunsetRNE/dsh-infinite-gen-5` | 官方 GitHub 仓库 |
| permissions | `系统提示词注入, 客户端状态条`（URL 编码） | 申请权限 |
| downloadUrl | `https://github.com/SunsetRNE/dsh-infinite-gen-5/archive/refs/heads/main.zip` | 离线 zip 下载直链 |

### 方式 2 / 3 / 4（Windows 脚本 · Linux / macOS · 手动配置）

三种安装路径、安装后的**验证生效**清单与**卸载**命令：[docs/INSTALL.md](docs/INSTALL.md)。

---

## ⚡ 验证生效（30 秒版）

```bash
npm run verify:all            # 全量门禁（40+ 项）：契约 / 调参 / 评测 / 融合层 / 运行时一致性
npm run verify:version        # 版本号 9 处锚点是否同源
node scripts/tool_registry.mjs --list   # 本仓工具与协议总表
```

装好后进 GUI 插件页确认版本与状态条；`infinite_gen5_profile` 会如实汇报注入档位与同源让位结果。完整验证步骤与故障排查：[docs/INSTALL.md](docs/INSTALL.md)。

---

## 🧰 工具与协议

工具按**协议**收敛：每个工具在注册表里有一行（分类 / 用途 / 调用 / 判据 / 能力），用途与能力**读自文件本身**而非另行抄写。注册表真源 [scripts/tool-registry.mjs](scripts/tool-registry.mjs)（协议 `ig5-tool-registry-v1`），生成的总表 [docs/TOOL-PROTOCOLS.md](docs/TOOL-PROTOCOLS.md)，全仓文档索引 [docs/INDEX.md](docs/INDEX.md)。

```bash
npm run tools:doc     # 重新生成 docs/TOOL-PROTOCOLS.md 与 docs/INDEX.md
npm run verify:tools  # 门禁：完整性 / 路径 / 能力可证实 / npm 别名 / 文档新鲜度（带自检反例）
node scripts/gen_tool_docs.mjs --json   # 机读摘要（在册数 / 过期文件清单）
```

本仓六条**命名协议**（有独立协议字面量，可机读校验；全表见 [docs/TOOL-PROTOCOLS.md](docs/TOOL-PROTOCOLS.md)）。四条跨边界：

| 协议 | 管什么 | 校验 |
|---|---|---|
| `ig5-skill-frame-v1` | 技能帧（frontmatter / 触发词 / 字节预算） | `npm run verify:skill-frame` |
| `ig5-merge-v1` | 外部素材编译层（`MANIFEST.json` 逐文件 sha256 + 凭据脱敏） | `npm run verify:merge` |
| `ig5-companion-v1` | 伴生插件清单（文件数 / 字节数 / sha256，激活记录归宿主） | `npm run verify:companion` |
| `stress100-neighbors-v1` | 邻接表（边界面 → 合法邻接件映射） | `npm run build:stress-neighbors` |
| `ig5-tool-registry-v1` | 工具注册表本身（字段 + 不变式） | `npm run verify:tools` |
| `infinite-gen5/env-probe@1` | 环境探针报告 schema | `npm run verify:env` |

其余工具（评测 400 分制、回执证据链、惰性节覆盖、竞技场契约…）的判据写在各脚本里，注册表逐条登记；总览见 [docs/TOOL-PROTOCOLS.md](docs/TOOL-PROTOCOLS.md)。加新工具的顺序：写脚本 → 在注册表 `OVERLAY` 加一行 → `npm run tools:doc` → `npm run verify:tools`。

---

## 🔌 兼容层（`adapters/`）

同一份内核的**多通道装载层**（公共层 + 兼容层）：把语义内核按宿主能力切成常驻块 + 惰性单元 + 末位锚点，产出五条通道的载荷，宿主侧只做装配、不改内核措辞。

| 通道 | 装法 | 常驻字节 / 预算 | 内嵌索引 | 惰性 |
|---|---|---|---|---|
| `dsh` | plugin-assemble / last / yield | 13905 / 40000 | 走工具，0 B | 开（14 unit） |
| `codex` | config-file / last / keep | 13509 / 30000 | 0 B | 关 |
| `generic` | paste / inline / keep | 20571 / 28000 | 7062 B | 关 |
| `claude` | promptFile / last / keep | 20571 / 30000 | 7062 B | 关 |
| `api-endpoint` | endpoint-relay / last / keep | 20967 / 32000 | 7062 B | 关 |

```bash
cd adapters
node verify_adapters.mjs                    # 40 条判据（A–H 组）：语义指纹 / 末位锚点 / 预算 / 载体 / 插件 / 端点巡检
node build-adapters.mjs --check --json      # 只校验不落盘；表里的字节数以 perTarget.residentBytes 为准
node build-adapters.mjs                     # 落盘 dist/<通道>/<通道>.payload.md + manifest.json
node test-openai-embed.mjs                  # OpenAI 兼容 /chat/completions 六条判据，默认本地桩、零密钥、不出网
node test-image-embed.mjs                   # 生图通道 /images/generations 七条判据（E1–E7），同样本地桩、零密钥、不出网
node probe-runner.mjs --dry-run --limit 1   # 端到端：本地桩 → 请求体 → 回执
```

内核根按「本目录 → 上一级 → 历史绝对路径」推导，也可用 `IG5_KERNEL_DIR` / `IG5_PROMPT_DIR` / `IG5_DATA_DIR` 显式覆盖；本层只读宿主真源，一个字节都不改。设计约束、边界与全部实测读数见 [adapters/README.md](adapters/README.md)。

生图通道（可选，与上面五条装载通道并列）：`adapters/lib/image-api.mjs` + `adapters/image-runner.mjs` 直连 OpenAI 兼容的 `POST /images/generations`（429/5xx 重试、4xx 不重试、密钥不入包）。在册入口是 `node scripts/image-gen.mjs`：`--dry-run` 只打印请求模板、`--selftest` 跑 E1–E7 判据；端点用 `IG5_IMAGE_BASE_URL` / `IG5_IMAGE_API_KEY`（缺省回落 `IG5_RELAY_*`）。

> ⚠️ **实验性加入生图工具，可能会存在参数不适配，不稳定的情况，谨慎使用，有需要请带生成失败截图和参数反馈开发者。**

---

## 📚 文档索引

全量索引（自动生成）：[docs/INDEX.md](docs/INDEX.md)。最常看的几份：

| 想知道 | 去哪 |
|---|---|
| 注入怎么做的、为什么这么改 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 安装 / 验证 / 卸载 | [docs/INSTALL.md](docs/INSTALL.md) |
| 改代码 → 自检 → 版本 → 发布 | [docs/MAINTENANCE.md](docs/MAINTENANCE.md) |
| 目录里每个文件是干什么的 | [docs/LAYOUT.md](docs/LAYOUT.md) |
| 工具与协议总表 | [docs/TOOL-PROTOCOLS.md](docs/TOOL-PROTOCOLS.md) |
| 外部素材融合（Codex / zhekk / CTF / VOLT） | [docs/MERGE-COLLECTION.md](docs/MERGE-COLLECTION.md) |
| 法律免责与第三方许可 | [docs/LEGAL.md](docs/LEGAL.md) |

### 📚 版本沿革去哪看

| 想要 | 去哪 |
|---|---|
| **速查**（一版 1–3 行，含硬数字与提交哈希） | [`VERSIONS.md`](VERSIONS.md) |
| **完整叙述**（为什么这么改、教训；版本叙述的唯一真源） | [`UPDATE.md`](UPDATE.md) |
| **机械清单**（逐条提交、日期、短哈希） | [`CHANGELOG.md`](CHANGELOG.md)（`node scripts/changelog.mjs` 生成，别手改） |

发布产物与 Release 正文只带**最近一次更新**（压缩规则见 [`scripts/lib/release-notes.mjs`](scripts/lib/release-notes.mjs)，自检 `npm run verify:notes`）。

---

## 🔧 维护速查（细节见 docs/MAINTENANCE.md）

```bash
npm run sync:local:apply     # 把仓库铺进本机安装树，顺带刷管理器记账
npm run verify:all           # 提交前必跑
npm run bump:version -- X.Y.Z && npm run changelog && npm run release
npm run release:pack         # 本地出四个 Release 附件
```

---

## 🗑 卸载方法

运行 `uninstall.ps1`（Windows）或 `./uninstall.sh`（Linux / macOS）即可一键彻底清理，无任何配置残留。

---

## 📄 许可与第三方声明

本项目以 **MIT License** 发布，全文见 [LICENSE](./LICENSE)。

本项目在实现思路上参考并复刻了同源上游开源项目，其原始 MIT 许可与版权声明完整保留于
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

| 项目 | 许可 | 版权 |
|---|---|---|
| [`Minglink/dsh-infinite-gen-4`](https://github.com/Minglink/dsh-infinite-gen-4) | MIT | `Copyright (c) 2026 Minglink` |

> 📌 **非盈利公益项目，严禁任何主体用于商业售卖、付费倒卖或黑灰产牟利，仅供技术参考。**

