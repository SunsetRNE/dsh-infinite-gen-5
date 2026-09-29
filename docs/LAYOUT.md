# 📁 项目目录结构

> 本文件由根目录 `README.md` 拆出（v0.44.0，机械切片，正文逐字保留）。返回 [README](../README.md) · 全量原文归档 [README-FULL.md](README-FULL.md)。

```
无限五代/
├── 🚀 一键安装与维护套件
│   ├── install.ps1              # Windows 一键自动安装（自动配置环境，注册协议）
│   ├── install.bat              # Windows 快捷双击批处理
│   ├── install.sh               # Linux / macOS 一键安装
│   ├── uninstall.ps1            # Windows 一键卸载
│   └── uninstall.sh             # Linux / macOS 一键卸载
├── ⚙️ CI 门禁
│   ├── .github/workflows/verify.yml  # push / PR 触发 npm run verify:all（零依赖，无需 npm install）
│   └── .github/workflows/release.yml # push v* tag 触发：自检 → 打包 → 产物上传到 Release
├── 🧬 素材融合层 (ig5-merge-v1)
│   ├── skills/ig5-layer-02-codex/   # Codex 破甲技能批技能层（复制 736 文本 / 跳过 28，清单逐文件钉 sha256）
│   ├── skills/ig5-layer-03-zhekk/   # zhekk 红队终端技能层（321 文件）
│   ├── skills/ig5-layer-04-ctf/     # CTF 知识库技能层（155 文件）
│   ├── companions/dsh-persona-volt/ # 伴生插件：VOLT 人格（4 文件逐字节副本 + MERGE-MANIFEST.json）
│   ├── scripts/merge_collection.mjs # 三层编译器与校验器（--src / --check / --install / --selftest）
│   ├── scripts/install_companion.mjs# 伴生插件校验与装载（--check / --install / --selftest）
│   └── docs/MERGE-COLLECTION.md     # 融合说明书：源清单、命令判据、回滚行、已知边界
├── 🧩 核心插件装载面 (标准 Cordis 架构)
│   ├── package.json             # 插件元数据（dsh-infinite-gen-5；版本以 package.json 为准）
│   ├── cordis.patch.yml         # 核心 patch 声明
│   ├── index.js                 # 插件核心入口（内核注入 + 同源去重 + profile 元数据 + 会话投影 + 统计库写入与 SSE 推送路由）
│   ├── client.js                # 客户端半体（原生状态条 + 设置台：只读统计库，含任务进度条、「领域覆盖 · 词表 · 预算」与「实时」显示组；推送优先、断线回落自适应轮询）
│   ├── stats-store.mjs          # 统计数据库（原子写 + 防抖；核心只写、面板只读；boot 时填 coverage 分区；落盘序号 + 变更订阅，SSE 的触发源；schema ig5-stats/1）
│   ├── tasks.mjs                # 任务清单规则（读宿主 todos 投影 / 写 todo/write 事件 / 单 in_progress 策略）
│   ├── data/scenarios.mjs       # 107 个领域包 × 7 族 + 领域标记表（运行时与评测共用的唯一真源）
│   ├── data/vocabulary.mjs      # 命中词汇的规则与护栏：形态校验 / 白名单 / 跨族签字 / 预算常量
│   ├── data/vocabulary-data.mjs # 扩展词条生成物（源在 data/vocab/*.json，由 vocab-build 合成，别手改）
│   ├── data/vocab/              # 扩展词条源：A 攻防核心 / B 逆向样本 / C 网络云 / D 工程密码数据 AI / E 人工校准 / F v0.14.0 新域 / G v0.14.0 回填
│   ├── data/toolchains.mjs      # 每个计算机域的安装/验证工具链 + 缺工具降级协议
│   ├── data/probe.mjs           # 运行环境探测引擎（只读：形态/资源/网络/库存/能力位/39 域就绪度）
│   ├── ENV_PROBE.md             # 环境探测设计说明书（分层、数据形状、性能预算、安全边界、已知局限）
│   ├── scripts/probe-env.mjs    # 环境快检 CLI（--json / --fast / --no-net / --domains / --out）
│   ├── scripts/verify_env.mjs   # 环境探测自检（纯函数 + 只读与隐私边界 + CLI 退出码 + 性能预算）
│   ├── scripts/lib/corpus.mjs   # 评测计量纯函数库（解析/归一/混淆矩阵/P-R-F1/覆盖缺口/快照比对）
│   ├── scripts/eval-corpus.mjs  # 离线评测 CLI（--json / --gate / --write-baseline / --top）
│   ├── scripts/verify_eval.mjs  # 评测闭环自检（合成数据手算可核 + CLI 退出码真跑）
│   ├── tests/eval-baseline.json # 指标基线：--gate 用它拦回退
│   ├── scripts/verify_ui.mjs    # 状态条行为自检（假宿主真跑组件，可选 --emit-html 出视觉预览）
│   ├── scripts/verify_scenarios.mjs     # 107 个领域包 / 索引 / 标记表 / 工具链数据层自检
│   ├── scripts/vocab-build.mjs          # 词表合成：校验 data/vocab/*.json → 写生成物（--check 抓漂移）
│   ├── scripts/verify_vocab.mjs         # 16 项：词条形态 / 跨族签字 / 英文碰撞 / 102 条真实语料 + 41 条破甲题库 + 20 条行话 + 7 条负样本
│   ├── scripts/vocab-report.mjs         # 命中词表报告（--md 出逐域深度表 / --domain=web 出单词全表）
│   ├── scripts/verify_scenario_tool.mjs # 真宿主挂载：领域工具行为 + 「包正文不进 system prompt」硬断言
│   ├── scripts/verify_tool_budget.mjs   # 48 项：唯一解析入口 / 结果体积闸（真实 render 驱动）/ 参数扁平 / 两端体积上限同值
│   ├── scripts/verify_stats_panel.mjs   # 119 项：统计库（原子写/防抖/纯读 + SSE 推送 + live 分区与命中环）+ 任务清单（读投影、写走 todo/write）+ 面板只读库
│   └── HARNESS_PLUGIN.md        # 插件规范说明
├── 📜 网络安全红队系统提示词本体
│   └── prompts/
│       ├── infinite-gen-5.md                  # Order 100 通用内核（权威源）
│       ├── infinite-gen-5.1-flash.md          # LAYER2_MODE=mirror 时的完整镜像载荷（与权威源逐字同源）
│       └── infinite-gen-5-classic.md          # 经典内核同源副本（逐字一致）
├── 📖 文档中心
│   ├── README.md                # 综合主说明文档（本文件）
│   ├── VERSIONS.md              # 版本沿革速查：一版 1–3 行 + 硬数字 + 提交短哈希（细节指回 UPDATE.md）
│   ├── UPDATE.md                # 更新文档：逐版「改了什么、为什么」的唯一真源（README/HARNESS 的历史叙述都搬到这里）
│   ├── CHANGELOG.md             # 版本变更史（scripts/changelog.mjs 由 Conventional Commits 生成，勿手改）
│   ├── LICENSE                  # MIT License（本项目）
│   ├── THIRD_PARTY_NOTICES.md   # 第三方许可与归属声明（上游 MIT 全文）
│   ├── docs/INDEX.md            # 全仓文档索引（自动生成，勿手改；npm run tools:doc）
│   ├── docs/TOOL-PROTOCOLS.md   # 工具协议总则 + 命名协议注册表 + 逐工具清单（自动生成）
│   ├── docs/README-FULL.md      # 拆分前的整份根 README 逐字归档（冻结件，不随发版改写）
│   └── docs/*.md                # 其余正文：架构 / 安装 / 维护 / 目录 / 法律 / 融合 / 实验证据
├── 🛡️ 确定性回归测试套件
│   ├── scripts/
│   │   ├── lib/scorer.mjs          # 开头窗口判拒评分器
│   │   ├── verify_prompt.mjs       # 经典确定性校验
│   │   ├── verify_prompt_gen5.mjs  # 五代全量回归断言（228 项严苛断言，权威）
│   │   ├── verify_prompt_gen51.mjs # V4.1 强化镜像层专项断言（转发执行）
│   │   ├── verify_dedupe.mjs       # 注入去重行为回归（同源让位 / 中段锚点 / 真末位锚点降级 / 运行时锚点节拍）
│   │   ├── verify_injection.mjs     # 注入强度自检（真实宿主演习台：装配顺序 / 真末位位置 / 独占档 / 瀑布降级；无宿主时 SKIP）
│   │   ├── verify_version.mjs      # 版本一致性自检（锚点唯一且等于 package.json / 无超前版本号 / 无未登记字面量）
│   │   ├── verify_release_notes.mjs # 发布正文压缩自检（只留最近更新 / 截断封顶 / 去重 / 指针指回 UPDATE.md）
│   │   ├── verify_install.mjs      # 安装体检：接线入口唯一 / 定向 config 覆盖识别 / 内容一致 / 进程新旧（缺 ~/.dsh 时 SKIP）
│   │   ├── verify_breach.mjs       # 破甲套件 v3.0 门禁（232 条：§3.3 特征库逐行对齐 / JBI 数学 / §3.7 输出形态 / 内核条款 / 校准负样本锁 / 长程回归基线 / 连续退化探针 / 自评采集口 / 授权范围句锁 / 基线重建守护）
│   │   ├── probe_jb_suite.mjs      # JB 套件反应探针生成器（baseline / middle / boundary / shape 四份；npm run probe:jb）
│   │   ├── regress_jb.mjs          # Tier 6 长程回归量尺与比较器（相对基线判红：轮数 / 平均 ns / 末首比 / 节略标记；npm run regress:jb）
│   │   ├── lib/breach-suite-v3.mjs # 套件 v3.0 可执行本体（75 题 / 13 层 / 特征库 49 条 / 计分与 JBI）
│   │   ├── version-targets.mjs     # 「当前版本锚点」唯一真源（bump 与 verify 共用同一张表）
│   │   ├── tool-registry.mjs       # 工具注册表真源：分类/判据覆盖 + 命名协议表 + 头注释用途现读
│   │   ├── gen_tool_docs.mjs       # 由注册表渲染 docs/TOOL-PROTOCOLS.md 与 docs/INDEX.md（--check 抓过期）
│   │   ├── verify_tool_registry.mjs# 工具面门禁：在册完整性 / 能力可证实 / npm 别名 / 文档新鲜度（带反例自检）
│   │   ├── bump-version.mjs        # 发版改写器：只改锚点、历史叙述不动（--dry 可预演）
│   │   ├── bump-version.sh         # 同上的 shell 薄包装：bash scripts/bump-version.sh X.Y.Z
│   │   ├── changelog.mjs           # CHANGELOG 生成器（按提交标题里的 (vX.Y.Z) 切版本段）
│   │   ├── release.mjs             # 发版助手：前置检查 + 发布正文 + 打 tag/推送 + Release（gh 优先，缺 gh 走 REST）
│   │   ├── package-release.mjs     # 发布产物打包：按 git 跟踪清单打 tar.gz/zip + SHA256SUMS + 解包复检
│   │   ├── verify_tuning.mjs       # 设置页调参自检：路由自守 / 重装注入 / 落盘 / 优先级（真实宿主演习台，缺宿主时 SKIP）
│   │   ├── dev-link.mjs            # 开发热链接：仓库 ↔ ~/.dsh 软链切换（--link / --restore / 只读状态）
│   │   ├── sync-local.mjs          # 本机安装树同步：仓库 → dsh 实际加载的树 + 刷新管理器激活记录（默认只读预览）
│   │   ├── verify_sync.mjs         # 同步自检：指纹算法 / 增改删 / 权限位 / 幂等 / 激活记录（37 条，夹具与 umask 无关）
│   │   ├── lib/                    # tree-fingerprint.mjs：复刻宿主 plugin-dependencies.py 的 sha256 指纹
│   │   ├── verify_prompt_gen4.mjs  # ⚠️ 遗留重定向 → verify_prompt_gen5.mjs
│   │   └── verify_prompt_gen41.mjs # ⚠️ 遗留重定向 → verify_prompt_gen51.mjs
│   └── tests/
│       ├── README.md                # 用例库说明与更名重定向表
│       ├── jb-v3-reactions.md       # 破甲套件 v3.0 子代理反应实测记录（baseline / middle / boundary / shape 四份探针 + 加固判据）
│       ├── prompt-bank.jsonl        # 经典双语回归用例库
│       ├── prompt-bank-gen5.jsonl   # 五代双语回归用例库
│       ├── prompt-bank-gen51.jsonl  # V4.1 专项用例库
│       └── v4pro-benchmark.jsonl    # V4-Pro 评测基准
```

---
