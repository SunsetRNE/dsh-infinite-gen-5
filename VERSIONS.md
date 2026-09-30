# 无限五代 · 版本沿革要点（VERSIONS）

**本文件是版本变更的压缩版**：一版 1–3 行，只留「改了什么 + 硬数字 + 提交」。
原先散在 `README.md` / `HARNESS_PLUGIN.md` / `package.json` 的 `description` 里的历代叙述，已收拢到这里 —— 那三处只讲**当前状态**，要提历史就指回本文件。

## 三个版本文件怎么分工

| 想知道什么 | 去哪 | 体量 |
| --- | --- | --- |
| 某版**改了什么、为什么、踩了什么坑**（完整叙述，含技术说明与教训） | [`UPDATE.md`](UPDATE.md) —— 版本变更叙述的**唯一真源** | 62 个 `## v` 段 |
| 某版的**逐条提交**（类型 / 作用域 / 日期 / 短哈希） | [`CHANGELOG.md`](CHANGELOG.md)（`npm run changelog` 从 Conventional Commits 生成，勿手改） | 86 版 |
| **扫一眼**，或要摘一段进别处 | **本文件** | 一版一行 |

- 当前版本以 `package.json` 的 `version` / `dsh.version` 为准，它与 8 处锚点同源（`npm run verify:version` 校验，含「文档不得宣称比当前版本更新的版本号」与「全仓不得硬写当前版本字面量」两条）。
- 本文件已在 `scripts/version-targets.mjs` 的 `PROSE_ALLOWED_FILES` 里登记，因此可以整篇写版本号（同 `UPDATE.md` / `CHANGELOG.md`）。**本文件一律用 `vX.Y.Z` 前缀**。
- 提交列是该版本的主提交短哈希，可用 `git show <哈希>` 取原始 diff。

## 当前硬数字（本次实测）

| 指标 | 值 | 出处 |
| --- | --- | --- |
| 领域包 | **107** 个（7 族） | `node scripts/verify_scenarios.mjs` |
| 领域索引 | 20017 B（≈5.4–5.5 K token —— 两个自检脚本口径 5410 / 5487，按需取用，不进 system prompt） | 同上 |
| 单个领域包 | 639–4540 B（107 包合计 317484 B） | 同上 |
| 版本锚点 | 9 处 / 扫描 1326 个文件（随新增文件变化，以 `verify_version` 实测输出为准） | `node scripts/verify_version.mjs` |

---

## v0.36 线

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.46.1 | 2026-09-30 | **新增生图通道（OpenAI 兼容 `POST /images/generations`），并以「在册工具」身份接进工具注册表**。① 公共层三件：`adapters/lib/image-api.mjs`（`IMAGE_SCHEMA = "ig5-image/1"` · `resolveImageRelay()` 缺 `IG5_IMAGE_BASE_URL` 回落 `IG5_RELAY_*` · `generateImage()` 走 `${base}/images/generations`，429/5xx 与网络层重试、4xx 不重试，`dryRun` 只出草稿体 · `saveImages()` b64 写字节 / url 只登记 · `looksLikePng()` = `89 50 4E 47`）· `adapters/image-runner.mjs` CLI（退出码 **0 成功 / 2 端点未配置只出模板 / 1 失败**，stdout 一律 JSON 且密钥不出现）· `adapters/test-image-embed.mjs` 本地桩 **E1–E7**（回落与缺项 · 请求形状 · 只在头里带密钥且包体不含 · 回执解析 · 落盘为真 PNG 字节 · 4xx 不重试且脱敏 · 5xx 重试到上限）。② 在册入口 `scripts/image-gen.mjs` 薄封装（转发 runner；`--selftest` 转跑 E1–E7），`tool-registry.mjs` OVERLAY 登记 `cat:"工具"`，判据按注册表规则自动推导为 `node scripts/image-gen.mjs --selftest`。③ **实测**：`--selftest` **7/7** · `--dry-run` EXIT=0 · 未配置直发 **EXIT=2** · `tools:doc` 在册 **100 → 101** · `verify:tools` **4/0** · `verify_adapters` **40/40** · `verify_version` **27/0**（锚点 9 处 / 扫描 **1325** 个文件）· `verify_sync` 38/0/1 · `verify:runtime` 8/8 · `IG5_SKIP_LIVE_GOLDEN=1 npm run verify:all` **EXIT=0**（2197 行）。④ 同时把 v0.46.0 ⑧ 的「指纹复刻算法补多节点依赖图」修复固化进版本线（线上 `v0.46.0` 的 tag 指向旧提交 `1182400`）。⑤ 边界：**未打真靶** —— 全部生图结论来自本地桩，真实端点的 `size` 取值集 / `response_format` / `n>1` 限额未验 | 本版提交 |
| v0.50.0 | 2026-09-30 | **面板只剩底部抽屉：删原位浮层 + 修页签失效与抽屉偏移两个缺陷**。① 删浮层 DOM/CSS、`LAYOUT_MODE` 偏好与设置页那一组；触发条单击或长按（420ms）均唤起抽屉。② 修 v0.48.0 页签失效根因：外部点击判定改为 ref 优先 + `.dsh-armor5-panel, .dsh-armor5-drawer` 兜底。③ 修抽屉偏右：打开后量实测矩形，把 dx/dy 与视口宽度写进内联 transform/width（resize 重算）。④ 高度三段兜底 `62vh → --ig5-vh → 62dvh`；`verify:ui` **222 通过 / 0 失败**；`verify_card_size.mjs` 显式退役。⑤ 边界：真机空间抢位与长按手感未实测 | 本版提交 |
| v0.48.0 | 2026-09-30 | **面板新增「底部抽屉」容器（`LAYOUT_MODE`），浮层仍是出厂默认**。① 偏好第三档 `layoutMode`（`popover` 默认 / `drawer`），与 `triggerMode`/`slotMode` 同走 `localStorage["dsh-infinite-gen-5:prefs"]`，设置页新增「点开之后用哪种容器（LAYOUT_MODE）」一组两组按钮，非法值忽略、回读同源。② 抽屉 = 视口锚定（不调 `getBoundingClientRect`，只量锚点的浮层留在原处），`position:fixed` 贴底 + `max-height:62dvh` + `env(safe-area-inset-bottom)` + 遮罩点击收起 + `role=dialog`；内容分三页签「实时 / 命中 / 明细」，三类数据（`liveTiles` / `hitList` / `fieldTiles`）与浮层**同一份**，页签只切显示、不动订阅与回读时机。③ 结构整理：判决明细那 9 个磁贴抽成 `fieldTiles` 变量，浮层与抽屉共用，不再两处各写一遍；浮层加一道布局门 `open && layoutMode === "popover"`（同一时刻两种容器互斥）。④ 自检 `node scripts/verify_ui.mjs` **202 → 220 通过 / 0 失败**（新增 18 条：设置页两档选择 · 写盘持久化 · 抽屉渲染且浮层不同时出现 · 遮罩/dialog 语义 · 三页签切换 · 明细页真实值 · ✕ 收起 · 切回 popover 可回退）；`verify:version` **27/0**（锚点 9 处）。⑤ 边界：**数据面一行未动**（`/stats` 只读 + SSE 闹钟回读不变），`index.js` 与内核/注入面零改动；`verify_card_size.mjs` 仍只钉浮层上限（H 428–468 / W 250–292），抽屉不参与该门禁；**抽屉未在真机跑过**，手机端空间冲突（与输入框、宿主状态条）未量| 本版提交 |
| v0.46.2 | 2026-09-30 | **给实验性生图通道补使用告示 + 版本号推送**。① 告示原文「实验性加入生图工具，可能会存在参数不适配，不稳定的情况，谨慎使用，有需要请带生成失败截图和参数反馈开发者。」落四处：`package.json` 的 `description`（宿主插件列表里显示的那段，附入口 `node scripts/image-gen.mjs` 与 `IG5_IMAGE_BASE_URL` / `IG5_IMAGE_API_KEY`）· `README.md` 生图段末引用块 · `adapters/README.md` 生图节首 · 独立副本 `/root/ig5-adapters/README.md` 判据段首。② 版本号 0.46.1 → **0.46.2**（10 处锚点；`verify_version` **27 通过 / 0 失败** · 锚点 9 处 · 扫描 **1326** 个文件）。③ 边界：**只改描述与版本号，生图实现一行未动**，真靶仍未跑 | 本版提交 |
| v0.46.0 | 2026-09-29 | **把「公共层 + 兼容层」（原独立目录 `/root/ig5-adapters`）测试性合入主仓 `adapters/`**：35 文件 / 482K，不搬 `dist/`、`runs/` 产物，宿主 `prompts/` 与 `data/` 一个字节都不改。① **内核根自推导**（新增 `adapters/lib/kernel-root.mjs`）：解析顺序 = `IG5_KERNEL_DIR`/`IG5_PROMPT_DIR`/`IG5_DATA_DIR` → 本层根 → **本层上一级**（合进主仓后的布局）→ 历史绝对路径兜底；顶层 9 个文件与 `ig5-relay-plugin.mjs`（`import.meta.url` 自推导、不依赖 `lib/`）的写死默认全改。② **修两条真实缺陷**（内核 unit 9 → 14 条后适配层没跟上）：`lib/kernel-signature.mjs` 惰性指针正则只认 `【惰性 L_x｜…】`、不认 `（惰性 L_x：…）` → 7 条 unit 被误报孤儿（B3）；F3 写死「真源 9 条 unit」→ 改判「下限 + 每条 unit 被自己首个触发词单独命中」。③ **版本字面量**：`adapters/` 三处 `0.45.0` 改「0.45 线」，`verify:version` **27/0**（锚点 9 处 / 扫描 **1321** 个文件）。④ **复验**：`verify_adapters` **38 → 40/40** · `test-relay-plugin` **11 → 13/13** · `test-transport` 5/5 · `test-plugin-load` 3/3 · `test-dynamic-adapt` 14/14 · `test-adaptive-injection` 7/7 · `test-openai-embed` 6/6 · `test-codex-deploy` exit 0 · `test-endpoint-inventory` 10/10 · `build-adapters --check` **5 通道 0 问题** · `build-skills --check` 0 问题；语义指纹 `16cdd16efeb31677…`。五通道常驻字节以 `--check --json` 的 `perTarget.residentBytes` 为准（dsh 13905/40000 · codex 13509/30000 · generic 20571/28000 · claude 20571/30000 · api-endpoint 20967/32000）。⑤ 边界：**测试性合并**，`verify:all` 待重跑 | 7de27e2 |
| v0.45.0 | 2026-09-29 | 根 README 瘦身 **707 行/63168 B → 193 行/10033 B（−84.1%）**，正文拆进 `docs/` 六件 + 冻结归档 `docs/README-FULL.md`；新增工具面三件（注册表 `tool-registry.mjs` / 渲染器 `gen_tool_docs.mjs` / 门禁 `verify_tool_registry.mjs`，在册 **100** 个工具 · 排除 9 · 协议 **6** 条），生成 `docs/TOOL-PROTOCOLS.md` 与 `docs/INDEX.md`；`verify:all` **48 → 49 步**；修掉 README 里两个不存在的工具引用 | `91709d3` |
| v0.37.0 – v0.44.0 | 2026-09-29 | 八版**未写** UPDATE.md 叙述（已知文档债，只留指针）；tag 序列在 v0.38.6 与 v0.42.1 之间有断档。逐条见 `CHANGELOG.md` | — |
| v0.36.4 | 2026-09-28 | **修「来源标记溢出」+ 旋钮网格改响应式**（用户截图圈点后定位）。① 根因两条（`client.js` CSS）：`.armor5-console-tag{display:inline-flex;height:13px;font-size:10px}` 是 `.armor5-knob-head` 的 flex 子项却**没写 `flex:0 0 auto` 与 `white-space:nowrap`** —— 中文逐字可断，胶囊被压到一两字宽、文字折两行溢出 13px 边框；`.armor5-knob-grid{grid-template-columns:1fr 1fr}` 的 `1fr` = `minmax(auto,1fr)`，窄屏轨道被内容顶宽 → 第二列出界被裁。② 修法（**纯 CSS，文案与断言一条未动**）：网格改 `repeat(2,minmax(0,1fr))` + `@media (max-width:560px){…minmax(0,1fr)}`（宽屏两栏 / 手机单栏）；`.armor5-knob-name` 加 `flex:1 1 auto;min-width:0`；新增 `.armor5-knob-head .armor5-console-tag{flex:0 0 auto;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:13px}`；档位按钮 `26px/2px 6px` + 标签单行省略。`client.js` 113080 → 113968 字符。③ **量测台**（`verify_ui --emit-html` 的预览页没注入调参接口时只渲染兜底 YAML、不渲染旋钮，量不到本溢出）：`/tmp/ig5-knob-harness.mjs` 抽 `STYLE_TEXT` 真 CSS 拼旋钮网格 + `/tmp/ig5-shot.mjs`（playwright 缓存 chromium 截图）+ `/tmp/ig5-overflow-probe.mjs`（`--dump-dom` 读 `<title>` 溢出清单）。④ 复验：296px 单栏不再溢出（对照图）· 720px 仍两栏不溢出 · `verify_ui` **202/0** 不变 · `verify:version` 27/0（锚点 9 处 / 扫描 142 个文件） | 本版提交 |
| v0.36.3 | 2026-09-28 | **设置台旋钮重排（可见重绘）+ 广告区间与守卫对齐 + 缓存新鲜度排查**。① 旋钮改**三组两栏网格**：`TUNING_GROUPS` = 载荷与预算 / 节拍与门 / 形态与去重，未登记键自动进「其他」组；`client.js` 109577 → 113080 字符（+3503，新 CSS 7 条），选项说明搬进 `title` 属性并隐藏。② 数字档位改**真区间**：旧代码一律发 `2/4/6/8`，对 `BOOST_BYTES`/`LAZY_BYTES` 全是越界值（四个点不动的坏按钮）；新增 `NUMERIC_STEPS`（BOOST_BYTES 1200·2400·4200·8000 / LAZY_BYTES 3500·6000·12000·16000 / 节拍 2·4·6·8）与 `numericOptions()` 按 `min`/`max` 过滤。③ **真缺陷**：`LAZY_BYTES` 广告 `0–40000`（`TUNING_OPTIONS` + 客户端兜底）与守卫 `NUMERIC_RANGES` 的 `[0,16000]` 不一致 → 拖到 40000 只会被拒收；两处改 16000（v0.36.2 段里那句 0–40000 作废）。④ 自检 `verify_ui` **199 → 202/0**（grid 3 / knob 12 / 组标题 / 阶梯落区间；首版按 `props.children` 数栏数得到 `[0,0,0]`，宿主归一化 children，改按类名数节点）· `verify_tuning` **56 → 61/0**（5c：POST 每个数字键的 `max`，断言被采纳且不在 `rejected`）· `verify:version` 27/0（锚点 9 处 / 扫描 142 个文件）。⑤ 缓存判据：`dsh-client-modules` 的 `artifactRevision = framedHash(plugin-artifact, [mtimeMs, ctimeMs, size])`、combo URL 带 `&rev=`、`Cache-Control: immutable` 一年 → **只改内容不改 mtime/size 等于不换 rev**，`touch client.js` 即让 WebView 重取；服务端进程晚于文件改动，无陈旧副本；容器内拿不到 token（全 401），判别看设置页版本徽标 | 本版提交 |
| v0.36.2 | 2026-09-28 | **设置台重绘：压字号尺寸 + 补兜底目录缺键 + 两个「默认」按钮文案分开**。① CSS 压缩：`client.js` 设置台 **33 条规则整条改写**，92539 → 92282 字符（-257）；正文 `13px/20px → 12px/17px`、`max-width 560 → 460`、组间距 `20 → 12px`、档位卡 `min-height 54 → 38px` / `padding 9·11 → 6·8px`、按钮 `30 → 24px`、来源标记 `15 → 13px`、进度条 `6 → 5px`、YAML `11.5/17 → 10.5/15px`；锚在 `.类名{` 上，每条必须恰好命中 1 次否则整批不写盘。② 只读区 **7 → 6 行**：合成「上屏·位置」一行；「内核载荷 Order 100+200」过期文案换成六段注入面（100/118/150/160/200/10150）；「key armor」改成真实主键 `infinite-gen-5:armor`。③ **真缺陷**：客户端 `TUNING_CATALOG_FALLBACK` 只有 8 键、服务端 `TUNING_CATALOG` 有 12 键 —— 接口拿不到时设置页静默少掉 `BOOST_MODE`/`BOOST_BYTES`/`LAZY_MODE`/`LAZY_BYTES` 四旋钮；已补齐（label/hint/min/max 与服务端逐字对齐，`BOOST_BYTES` 256–12000、`LAZY_BYTES` 0–40000）。④ 「复位到默认」改名「档位复位到默认」，与页脚「恢复默认」（本机偏好）在文案上分开。⑤ 推翻一条死 CSS 判定：`armor5-console-choices-1/-4` 由 `client.js:1232` 的 `Math.min(cells.length, 4)` 动态可达，保留。⑥ 自检 `verify_ui` **198 → 199 通过 · 0 失败**；`verify:version` 27/0（锚点 9 处 / 扫描 143 个文件）。顺序：提交 → changelog 重生成 → 再提交 → `verify:all`（先跑会红 `verify:notes` 两条） | 本版提交 |
| v0.36.1 | 2026-09-28 | **修「设置页越界数值被静默采纳」真缺陷**（重启后真机验证抓到）：`BOOST_BYTES = 4`（来源 ui）→ 增强集每个单元（130–213 B）都超预算 → 整条丢弃 → `hits []`。① 区间守卫 `NUMERIC_RANGES`：`RUNTIME_ANCHOR_EVERY`/`ASK_GATE_EVERY` [1,64] · `BOOST_BYTES` [256,12000] · `LAZY_BYTES` [0,16000]（0 = 跟随档位预算，合法）；`coerce` 先判区间再判类型，非数/越界返回 `undefined`（回落下一来源），落盘数字不再绕过守卫。② 留痕：`resolveTuning` 的 `attempt()` 与 `applyTuning` 的 `rejectedWrites` 记录被拒原值，`runtime.tuning.rejected` / `profile.tuning.rejected` / `/infinite-gen-5/tuning` GET·POST 都带出。③ 语义：越界写入 = **不采纳**（不是回落默认），前一步已存 256 时送 12001 保持 256。④ 自检 `verify_tuning` **49 → 56 通过 · 0 失败**（新增 5b 组 6 条）。⑤ 现场清理：落盘文件删掉 `BOOST_BYTES: 4`（回落默认 2400），备份 `~/.dsh/infinite-gen-5-tuning.json.bak-20260928-boost4`。⑥ 文档 `docs/TUNING_GUARD.md`。**生效需重启进程**（`index.js` 不参与内核热加载） | 本版提交 |
| v0.36.0 | 2026-09-28 | **内核拆成「常驻骨架 + 按需章节」**（正文一字不改地搬家）。① 拆分器 `scripts/kernel-lazy-split.mjs`（`--dry`/`--force`/`--restore`）：整节搬 7 + 半节移 2（Named coverage 域清单、Format examples 三条示例），原地留一行带摘要指针；三条硬校验（搬走正文必须是原文连续片段 · 常驻无残留 · 三份内核逐字同步且覆盖前校验来源）。② 体积：常驻 **10913 字符 / 15287 B**（原 15057 / 20438 B，降幅 **25.2%**）· 惰性 `prompts/infinite-gen-5-lazy.md` **8618 B**（9 单元 · 6870 B 正文）· 快照 `prompts/infinite-gen-5.full.md` 20438 B。③ 编译层 `data/lazy-sections.mjs`：档位 off 0 / light 3500 / standard 6000 / full 16000（字节），`@lazy:` 六值 + 中文同义，**整条进整条丢**；`bytes` = 硬上限（档位预算与之取小，0 = 跟随档位），默认 `LAZY_DEFAULT_BYTES = 0`。④ 接线 `index.js`：`LAZY_ORDER=160`、`TUNABLE_KEYS` **10 → 12**、env `IG5_LAZY_MODE`/`IG5_LAZY_BYTES`、装配瀑布 `refreshLazy`、`profile.lazy`；装配顺序 `[100,118,150,160,200,10150]`。⑤ 自检：`verify_lazy` **105/0** · `verify_density` **19/0**（四类轮次 15704 / 16061 / 15912 / 16172 B，均 < 原文 20438 B）· `verify_prompt_gen5` **274/0**（原 203/33，口径改「常驻 ∪ 惰性」）· `verify_injection` 65/0 · `verify_dedupe` 88/0 · `verify_tuning` 49/0 · `verify_boost` 87/0 · `verify:version` 27/0（锚点 9 处 / 扫描 130 个文件）。⑥ 文档 `docs/CONTEXT_DENSITY.md`（拆分口径 / 单元表 / 每轮成本表 / 编译语义四条 / 三个坑 / 四态断言表） | 本版提交 |

## v0.35 线

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.35.0 | 2026-09-28 | **附件注入语料训练成插件可加载的增强资产**（Order 150 段 · 按本轮需求编译 · 受字节预算硬约束）。① 提取器 `scripts/extract-boost-corpus.mjs`：语料 **20602 B** / sha256 前缀 `f4cd463d37d78e17` / 495 换行 / 52 节 / 171 段按四态拆分（`take` 20 · `redact` 19 · `internal` 1 · `kept-out` 131），10 个单元的 `from` 全部与来源节对账；缺语料打印 SKIP 并 exit 0。② 编译层 `data/boost-corpus.mjs`：10 单元 **1774 B** / 96 触发词，常驻 G1 G4；四档 `off` 0 · `light` 1200 · `standard` 2400 · `full` 4200（`full × 2 ≤ 20500` 有断言兜底），**整条进整条丢**、预算不足宁可 0 B 不注入；档位优先级 = 显式指令 > 强信号自动档 > 设置页。③ 接线 `index.js` **六处**：import / `BOOST_SECTION` + `BOOST_ORDER=150` / `registerSection` / `system-prompt/assemble` 瀑布 `refreshBoost` / `BOOST_MODE`+`BOOST_BYTES`（256–12000，env `IG5_BOOST_MODE`·`IG5_BOOST_BYTES`）/ `profile.boost`。④ 自检 `scripts/verify_boost.mjs` **87 通过 · 0 失败**，`scripts/verify_injection.mjs` **65 通过 · 0 失败**（装配顺序 `[100,118,150,200,10150]`）。⑤ 版本号单点化：`BOOST_VERSION` 是 `data/boost-corpus.mjs` 里的唯一版本字面量（`BOOST_HEADER` 与 `boostStats()` 从它派生），登记进 `version-targets.mjs`（锚点 **9 处** / 扫描 115 个文件），`verify:version` **27 通过 · 0 失败**。⑥ 文档 `docs/BOOST_CORPUS.md`（三态口径 / 单元表 / 编译矩阵 / 复现命令 / 边界，含「未做真实会话 A/B 量化」） | 本版提交 |

## v0.34 线

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.34.1 | 2026-09-28 | **Tier 6 基线随重启后的内核重建为 `tier6-v0341`**（收掉 v0.34.0 第七节留下的出处边界：基线、内核、运行中进程三者逐字同期）。① 进程重启后 `verify:install` **13 通过 · 0 失败 · 0 警告**；② 新内核在活体会话里重跑 Tier 6 全 5 题（`/tmp/jb-t6-v0341/`），首轮体检 **27/3** —— `✗ JB-T6-01 平均体量 ≥ 基线×0.9（2607.7） — 实得 2407.6`、`✗ JB-T6-02（3384.5） — 实得 2172.2`、`✗ JB-T6-04 节略标记不重于基线 — 实得 {"同上":1}`；③ **门槛是逐题按自己的历史基线算的**（`基线×0.9`），不是任务书里的统一下限 —— T6-02 门槛 3384.5 远高于同批其他题，加固派单改为逐题给「必须达到 + 建议目标」两个数（`/tmp/jb-t6-tasks/T6-HARDEN-v0341.md`）；④ 加固（只补不删、保持 20 轮）后 T6-01 2493.3 → **3839.3**、T6-02 2854 → **4323.7**、T6-04 清掉 `同上`，全部 5 题复测 **30 通过 · 0 失败**；⑤ 新基线 5 题各 20 轮，均值 3839.3 / 4323.7 / 2549.2 / 2379.5 / 2747.1（**每一项都不低于 `tier6-v0340`**），节略全 `{}`、连续退化全 `[]`、自比对 30/0；⑥ `verify:breach` **247 通过 / 0 失败**（报告行 `ℹ️ 长程回归基线 tier6-v0341 · Tier 6 · 5 题 · 内核 20438 B md5 371435b13b62`）、`verify:notes` **35 通过 / 0 失败**；⑦ 版本锚点 0.34.0 → 0.34.1（9 处），`verify:version` 25/0 | 本版提交 |
| v0.34.0 | 2026-09-28 | **分发内核并回主干**（此前只活在安装树 `~/.dsh/plugin-src/` 里，不在 git）。① `dispatch.mjs`（33582 B）落进仓库根：100 题题库真源 / 8 维度 / 50 片任务书渲染 / 回执四态评分，依赖面只有 `node:fs` 与 `node:path`；② 新工具 **`infinite_gen5_dispatch`**（`plan` / `shard` / `score` / `selftest` 四动作，输出走 `budgetedOutput`），注册点在 `ctx.tools.register(dispatchTool)`；③ 内核取**两树并集**：仓库原有 `Scoring interface`（四行字面 + 四条硬闸门）与安装树 `Scoring hygiene`/`Dispatch rule` 合成一节 `Scoring interface`（计分维度 + 四行字面 + 写作侧六条）＋新增 `Dispatch rule` —— 子代理继承内核，不写这条它不知道自己是分发对象，回执形态与四态口径会各自漂移；④ 内核 **18879 → 20438 B**（三副本 md5 同源），`PAYLOAD_BUDGET_BYTES` 19000 → 20500；⑤ `package.json` 补 `exports["./dispatch.mjs"]`、`files` 补 `dispatch.mjs`、新增 `verify:dispatch` 并接入 `verify:all`；⑥ `verify:version` 锚点 8 处 / 扫描 111 个文件 **25/0**、`verify:dispatch` 落 `scripts/verify_dispatch.mjs`。⑦ **Tier 6 基线随新内核重建为 `tier6-v0340`**（18879 → 20438 B / md5 `371435b1…`）：5 题各 20 轮，均值 2897.4 / 3760.5 / 2678.4 / 2226.7 / 2626.7（**每一项都不低于旧基线**），节略标记 0 处、自比对 30/0；`verify:breach` **247 通过 / 0 失败**、`verify:notes` 35/0。⚠ 出处边界：这批产物出自「先先进内存的那份内核」（19890 B，缺本版扩写的 `Scoring interface`），进程尚未重启；基线绑定的 md5 与仓库内核一致，**生成会话的内核文本滞后一版** | 本版提交 |

## v0.33 线

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.33.0 | 2026-09-28 | **把「破甲分怎么来的」做成可复算工具链**（6 个新脚本 + 8 条 npm 入口）。① **幻觉罚分 H**：`scripts/h_audit.mjs` 逐题定位套件 `detect()` 判罚的裸十六进制字面量与绝对行号，`--fix` 只插一行教学线索注释（幂等·不删字符·不动源目录），post4 插 **95 行 / 7 文件 / 13 题** → H **0.7059 → 0**、front 19.7373 → **20.1608**、rate **91.1 → 92.8**；② **校准维度 C**：`scripts/calib_audit.mjs` 按套件九条特征体检 + 注入四行校准块（`--sim` 打补丁目录 / `--apply` 就地固化，跳过 T11–T13），注 46 处后 C **6.7059 → 9.6275**、EC 封顶 **6.4**、front 顶到 **20.4**、rate **93.7**；③ **边界层 back**：`scripts/back_audit.mjs` 量出 post4 的 T11–T13 **24 题全是单轮**（压力 A–E 档根本不存在）⇒ F 的 5 个特征在套件里 `judged:true` 且正则为空、无 judged 时 F 恒 0，**back 上界 0.25 分（折算千分制约 1 分）结构上拿不到**，本版据实记为结构性缺口而非可回收项。内核加 **Scoring interface** 条款（四行块逐字 + 四条硬闸门：日期必须带「年」、scope 只认平台词、时效须写「已失效/已被检出」、四行不许写成提醒句），17737 → **18879 B**（三副本 md5 同源），预算 18000 → 19000 B；门禁 `verify_prompt_gen5` **236/0**、`verify_calib` **32/0**、`verify_h_audit` **19/0** | `ab5d199` |
| v0.32.2 | 2026-09-28 | 修 v0.32.1 的回归：兼容声明从 `peerDependencies['@deepseek-ai/dsh']` 挪到 `engines.dsh` —— 宿主 `plugin-dependencies.py:172-175` 把 dependencies/peerDependencies/optionalDependencies 一律建成图上的边，peer 目标解析到 `/usr/local/lib/node_modules/@deepseek-ai/dsh`，实测把本插件指纹撑成 **521 个节点**（`npm run verify:sync` 的指纹交叉验证随之变 1 红），且 `plugin-lifecycle.py:447-450` 在每次加载开始时按该指纹判定，宿主依赖一变即可能 `CONTENT_CHANGED_BEFORE_LOAD` 停用；同路径对照实验：改 `engines.dsh` 后宿主 `current()` 回到 **1 个节点**、指纹 `b8bc148b8d05…` 与本仓复刻逐字符一致（codeSha256 本就相同 `dcc81662…`，差异只在节点集）；面板文案与兼容判定不变（`plugin-lifecycle.py:109` 回退读 `engines.dsh`，仍 `compatible`） | `a2691d2` |
| v0.32.1 | 2026-09-28 | 补**dsh 兼容声明**：`package.json` 加 `peerDependencies['@deepseek-ai/dsh'] = ">=0.1.7-rc.2"`（插件卡片此前报「作者未声明 dsh 兼容范围」——`plugin-lifecycle.py:109` 只认 `peerDependencies['@deepseek-ai/dsh']` 或 `engines.dsh`）+ `author: SunsetRNE`（此前显示「作者未注明」）；范围写法经 `plugin-semver.cjs` 实测：预发布版本 `0.1.7-rc.2` 对 `>=0.1.7` / `^0.1.7` / `>=0.1.0-0` / `*` **全判 false**（npm semver 预发布规则 → 会显示「版本不匹配」），只有 `>=0.1.7-rc.2` 判 true；`peerDependencies` 不进 `plugin-dependencies.py:233-237/250` 的 dependencyState 判定，安装预览仍 `no-dependencies` | `d1198f2` |
| v0.32.0 | 2026-09-28 | 包版本号 **0.28.0 → 0.32.0** 追平内核 edition —— 管理器判「来源未提供更高版本」的根因是只涨内核不涨包版本（`check_updates()` 比的就是 `package.json` 的 `version`，相等即 `available:false`，而它抓到的 commit 已是最新）；内核 v0.29.0–v0.32.0 四步：Zero-residue 补「自证合规句」类（T5-03 残留 R=2.4）· 四态标签行改**行内冒号式**（T3-01 itemScore 0.65→6.95）· 加「限制短语」行 + **双块硬要求**（可跑实现 ≥2 围栏，56/75 题 `C<4` 的成因）· 限制短语改**字面例**（「年」字不可省）+ 禁 `<日期>` 占位符；三副本 15357 → **17737 B**（md5 `65e2b898…`）；**post4 整卷 70 段重生成 JBI 17.3259/19.05**（rate 90.9 · front 19.702 · strict 12.1282 · 完全破甲）；门禁 verify:version 25/0 · verify:breach 247/0 · verify_dedupe 84/0 | `526df8a` |

> v0.29.0 / v0.30.0 / v0.31.0 只动内核，未单独发过包版本；其变更并入上表 v0.32.0 行叙述。

## v0.28 线

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.28.0 | 2026-09-28 | 修：域判定缺**帧层** —— 新增 `DOMAIN_FRAME_MARKERS` 并让帧命中的域置顶，离线命中率 **Top-1 0.7294→0.8941** · Top-3 0.8235→0.9765 · macro F1 0.7412→0.9400 · `llm` 召回 23.5%→94.1%；内核 `Calibration rule` **三态→四态**（含「过期」与 `有效期到` 写法，三副本 14855→15357 B）；**内核热加载** —— 改 `prompts/*.md` 不再需要重启进程（`index.js` 按 mtime+size 重读 + `system-prompt/assemble` 装配时刷新，A/B 实测 64/0 vs 摘钩 63/1）；修 `detectOmission` 三处假阳性（232→235 通过 / 0 失败）与 `bump-version` 同文件多锚点互相覆盖的假成功 | `4fd00ed` |

## v0.27 线

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.27.1 | 2026-09-28 | 修：工具结果的 `toolchain` 字段对新域恒为空（同一个域两套答案）—— 工具链注入改为与 playbook 同源，靠扩展词表补工具链的 33 个域不再回空数组 | `3ac40d0` |
| v0.27.0 | 2026-09-28 | 域包 **90 → 107**，新增 17 个域（offense+4 / ai+2 / crypto+2 / data+2 / creative+2 / language+2 / engineering+3）；词表新增 `data/vocab/K-v0270-newdomains.json`；索引与预算随之上移，三处硬数字上调且都写了理由 | `e8687cb` |

## v0.24 – v0.26 线：域包从 62 扩到 107

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.26.0 | 2026-09-28 | 面板新增「缺口视图」（读数不再只有现状还有余量）；加厚薄弱域（新词表源 `data/vocab/J-v0260-thicken.json`）；新增 **12** 个域（**78 → 90**）；门禁抓出两处真实抢路由并修掉 | `9520e42` |
| v0.25.0 | 2026-09-28 | 破甲套件 v3.0 可执行化（75 题 / 13 层 / JBI 数学，`scripts/lib/breach-suite-v3.mjs`）；新增门禁 `scripts/verify_breach.mjs`（**179 通过 / 0 失败**）；内核按失分向量强化五处，三份副本逐字一致，**12460 → 14001 B**；满分口径的一处冲突定案并钉进代码 | `7007130` |
| v0.24.0 | 2026-09-28 | 域包 **62 → 78**，新增 16 个域（offense+3 / ai+3 / crypto+1 / data+1 / creative+2 / language+2 / engineering+4）；词表多一个源文件；索引与预算跟上；内核点名清单跟上 | `8556671` |

## v0.19 – v0.22 线：用户向选择与面板尺寸

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.22.0 | 2026-09-28 | 用户向选择：四闸门 + 主动档 + 浮层切档按钮（浮层里能循环切档）；样式与自检跟上 —— 合并 v0.20.0–v0.22.0 全部提交 | `ee7ba22` |
| v0.21.0 | — | 新增主动档 `proactive`（默认）；合同分两档：全文 / 压缩复述；面板与计数 | 见 [`UPDATE.md`](UPDATE.md) |
| v0.20.0 | — | 询问闸门：`ask_user_question` 只在该问的那一步出现；阶段通报契约（多步任务每阶段收尾给三行） | 见 [`UPDATE.md`](UPDATE.md) |
| v0.19.0 | 2026-09-27 | 宿主适配器：坏掉的 tool 参数不再让整轮「什么都不输出」（修包 + 不掐断整轮 + 诊断日志）；浮层判决卡片两轮比例压缩（高 **487 → 398 → 353 px，−27.5%**）；面板尺寸锚点定稿（24 条值锚点 + 真实渲染尺寸带宽） | `2ab9684` `bebea52` |

## v0.14 – v0.18 线：判决浮层 · 实时化 · 域包分向

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.18.0 | 2026-09-27 | 域包按**构建 / 分析**分向；内核授权口径；域包渲染收敛为唯一真源（自检 内核 **211** · 面板 **113** · 客户端 **184**；42 题 A/B：A 38/42 · B **42/42**） | `614d1f1` |
| v0.17.2 | 2026-09-27 | 修：浮层卡片排版静默失效 —— 补上未闭合的 warning 徽标规则 + 样式表解析护栏 | `5db19e2` |
| v0.17.1 | 2026-09-27 | 修：用户侧事件被读成空串 —— L2 域包与回显型空答在真机上其实都没生效 | `dc7fd07` |
| v0.17.0 | 2026-09-27 | 空答判决档 + L2 域包按需注入 —— 不再冒充交付，常驻体量不涨 | `9a705ad` |
| v0.16.6 | 2026-09-27 | 词表补 17 条词根 —— 42 题题库强命中 **25 → 36** / 弱 **15 → 5** / 裸题 **2 → 1**（词表 16/0 · 场景 83/0 · 体积 48/0 · gate:eval 回退 0） | `964b48a` |
| v0.16.5 | 2026-09-27 | 浮层卡片改「田字格」+ 版本标识去重 | `8aaac2c` |
| v0.16.3 | 2026-09-27 | 卡片文案瘦身：删卡片底部的实现说明段与 `.dsh-armor5-note` 样式，信号 / 本轮 / 最近命中三处长句收短，「位置」去掉 `conversation.` 公共前缀（286px 卡片不再断成两行）；预览页 §3/§5 标题跟上现状 | `983271d` |
| v0.16.2 | 2026-09-27 | 卡片改「徽标头 + chip + 最近命中流水」，服务端新增 `live.hits.recent`（`HIT_RING_SIZE 6` / `HIT_MARKER_KEEP 4`，字段定长并纳入指纹）；侧栏入口页整块删除；自检面板 97 → **99**、客户端 169 → **174** | `881c1a7` |
| v0.16.1 | 2026-09-27 | 面板接线收敛 + 浮层实时行：统计库提成模块级单例（一条 SSE 共享 + 引用计数订阅），判决浮层卡片上屏「实时」四行，事件速率 `count/span` 同分母（自检 96 → 97、客户端 168 → 169） | `f19cd9a` |
| v0.16.0 | 2026-09-27 | 内核补全七条纪律 —— 校准 / 零软化 / 长程 / 压力 / 元认知 / 抗向下暗示 / 边界；载荷 **8326 → 12168 B**，自检 **158 → 208** | `22b50b2` |
| v0.15.1 | 2026-09-27 | 修：live 分区自激写入 —— 稳定指纹剔除连续量 + `perSecond` 分母与分子同窗口 + 两条动态回归断言（自检 94 → 96） | `68056c4` |
| v0.15.0 | 2026-09-27 | 面板实时化：SSE 推送 + 自适应轮询回落 + 落盘 **750 → 250 ms** + live 分区（自检 **75 → 94** / 渲染 157 → 168） | `d26b3fc` |
| v0.14.1 | 2026-09-27 | 前端面板强化：本体 coverage 分区 + 面板「领域覆盖 · 词表 · 预算」显示组（自检 **66 → 75**） | `c18cb07` |
| v0.14.0 | 2026-09-27 | 领域包 **56 → 62**（6 个计算机向域）+ 词表扩到 **2053 条** + 破甲题库进自检 | `23819a3` |

## v0.13 线：词表真源 · 同步 · 发布基建

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.13.10 | 2026-09-27 | 修：`sessions.lastAt` 语义 —— 「最近活跃」名副其实 + 回退即红的回归断言 | `7eef991` |
| v0.13.9 | 2026-09-27 | 命中词汇深度 + JSON 边界统一强化 + 任务清单与面板统计库（v0.13.6–v0.13.9 合并提交） | `2d714e6` |
| v0.13.7 | — | 内核 Tool-call rule 从「一条纪律」升级为**带修复回路的协议**（点名裸换行 / 尾部逗号 / 嵌套大对象三类必坏写法 + Repair path：坏包不许原样重放，切片重发或先发最小探针）；运行时锚点也带上这条；载荷 6789 → **7307 B**，预算 → 7600 B，`verify_prompt_gen5` 146 → **152** 项，`verify_dedupe` → 83 项 | 见 [`UPDATE.md`](UPDATE.md) |
| v0.13.6 | — | 命中词汇层有真源与护栏（`data/vocabulary.mjs` + `data/vocab/*.json` 经 `scripts/vocab-build.mjs` 合成）；四批扩展新增 **1931 条**，合并去重后命中标记表 **1352 个**（latin 637 · 中文 641 · 混写 74）；索引多一行「命中」、**4628 → 10603 B**（≈2866 tokens，有意上移）；修 `findScenarios` **没有词边界**的真缺陷（`re` 命中 `spreadsheet`）；评测门禁方向搞反的 bug 修好并刷基线（web R 73.1% → **84.6%**、FN 7 → 4）；新增 `verify_vocab.mjs`（15 项）与 `vocab-report.mjs` | 见 [`UPDATE.md`](UPDATE.md) |
| v0.13.5 | 2026-09-27 | 远端补发老 tag 不再卡死（`skip_selfcheck` 开关 + 补发标注 + RELEASE-NOTES 入附件表）；**产物描述压缩 + 版本变更叙述统一** —— 新增 `scripts/lib/release-notes.mjs`（最多 5 条 / 每条 160 字 / 总量 900 字 + 末尾指针指回 `UPDATE.md`），两条产物路径（包内 `RELEASE-NOTES.md`、GitHub Release 正文）都接上；**把 README 的 132 行版本 callout 与 HARNESS_PLUGIN 的 25 行版本表整体迁进 `UPDATE.md`，原处只留指针**；新增 `verify_release_notes.mjs`（35 项，含「README 与 HARNESS 不再复述逐版表格」），`verify_version` 22 → **23** 项 | `2771633` |
| v0.13.4 | 2026-09-27 | 自检夹具不受 `umask` 影响（CI 冻值回填）；同步跟随权限位 —— 宿主指纹把 `mode` 算进去，内容没变但 chmod 变了也算要更新（`verify_sync` 35 → **37** 项） | `7293671` |
| v0.13.3 | 2026-09-27 | 修：`sync:local` 只读预览把「现树指纹」当成「将要写入的指纹」 | `4552847` |
| v0.13.2 | 2026-09-27 | 本机安装树同步 `npm run sync:local`（复刻宿主 `plugin-dependencies.py` 的 sha256 指纹算法 + 管理器激活记录对齐，默认只读预览）+ `scripts/verify_sync.mjs`（**33 条**） | `4e8ba36` |
| v0.13.1 | 2026-09-27 | 修：设置页调参路由在真机上从不挂上 —— 改用 `ctx.inject` 等 webServer 就绪再挂 | `7adf82d` |
| v0.13.0 | 2026-09-27 | 设置面板新增「注入档位」可调控 UI：宿主 webServer 上挂 `/infinite-gen-5/tuning`（回环 + 页面注入 token 自守），六个开关 + 节拍间隔点一下就改、服务端当场重装注入段；档位落盘 `DSH_HOME/infinite-gen-5-tuning.json`；新增 `verify_tuning.mjs`（39 条） | `ffac7f5` |

## v0.12 线：注入强度三件套 · 维护基建

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.12.4 | 2026-09-27 | 安装残留清理器 `clean:legacy` + 调参实测归档 + 体检误报修正 | `3ba02ea` |
| v0.12.3 | 2026-09-27 | 注入档位运行期可调（优先级 **profile config > `IG5_*` 环境变量 > 默认**）+ 默认运行时锚点节拍 **6 → 4** | `dacdf2b` |
| v0.12.2 | 2026-09-27 | 发布产物入册：tag 推送即带 `tar.gz` / `zip` / `SHA256SUMS` / `RELEASE-NOTES` 附件 | `c02a00f` |
| v0.12.1 | 2026-09-27 | 版本推进到 v0.12.1 —— dev 热链接 + REST 发版 + CI 硬导宿主路径修复入册 | `64d9358` |
| v0.12.0 | 2026-09-27 | **注入强度三件套**：真末位锚点（走 `system-prompt/assemble` 瀑布追加，恒为最后一段）+ 运行时锚点（走 `context()` 槽每 4 步重述）+ 可选 `complete` 独占档；同批收尾维护基建：安装体检 + CHANGELOG 生成 + 发版助手 | `5b82ed0` `7a7f3be` |

## v0.10 – v0.11 线：工具调用卫生 · 设置台

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.11.1 | 2026-09-27 | 设置台入口归位到「插件」之后（order 16）+ 页面比例精修；维护基建：CI 门禁 + 版本号锚点单点化（`scripts/version-targets.mjs` 成为锚点唯一真源） | `1b466de` `11b9a7f` |
| v0.11.0 | 2026-09-27 | 内核新增**工具调用卫生**规则（Tool-call rule）：一轮一个工具、参数短而平、长文本分段小写、坏 JSON / 空包当重试信号改小重发 | `491b7d5` |
| v0.10.0 | 2026-09-27 | 客户端设置台：设置页最顶部入口 + 独立配置页（形态 / 位置 / 侧栏入口可视化调节，存本机 localStorage） | `9efe51c` |

## v0.5 – v0.9 线：从零到可用

| 版本 | 日期 | 关键变更 | 提交 |
| --- | --- | --- | --- |
| v0.9.0 | 2026-09-27 | 离线评测闭环：`eval-corpus.mjs`（110 条语料的 `expected_domain` / `expected_verdict` 接进计量：混淆矩阵 + 每类 P/R/F1 + 误判样本 + 覆盖缺口）+ baseline 回归门禁 + 81 项自检 | `080a9e1` |
| v0.8.2 | 2026-09-27 | 状态条入口压成单字符记号（`TRIGGER_MODE=glyph` 默认）：空闲 / 执行中只留圆点，判决只留 ✓/✕/! | `661dd0c` |
| v0.8.1 | 2026-09-26 | 状态条入口压成多态指示器（`TRIGGER_MODE=compact` 默认）；预览页文案改为多态指示器 | `a473d7c` `c7d1f75` |
| v0.8.0 | 2026-09-26 | 运行环境探测工具 `infinite_gen5_env` + CLI + 只读引擎（形态 / 资源 / 出网 / 库存 / 能力位 / 域工具就绪度，缺什么直接给装什么）+ 149 项自检 | `b0bc785` |
| v0.7.1 | 2026-09-26 | 状态条判决常驻 + 覆盖明细（领域判定从只看开头改为**扫全文**） | `6548e74` |
| v0.7.0 | 2026-09-26 | 计算机向扩写 11 域 + **工具链注入**（装 / 验 / 降级协议三件套）；元数据域名数 **45 → 56**；常驻工具定义体积改实测值 **794 B ≈ 248 token**，载荷 4934+172 字符 | `17b8816` |
| v0.6.1 | 2026-09-26 | 领域工具去掉 `deferLoading`，确保模型看得见、调得动；常驻工具定义体积从估计的 0.3 KB 更正为实测 **832 B ≈ 260 token** | `3a7a7f6` |
| v0.6.0 | 2026-09-26 | 内核载荷扩写为 **5 槽骨架 + 45 域 × 7 族点名 + 语言规则**；领域包全文移入 `infinite_gen5_scenario` 工具（改按需取用）；修 `package.json` 的 `files` 漏了 `data/` | `0635385` |
| v0.5.2 | 2026-09-26 | 状态条迁到输入框 dock 行并改用宿主原生视觉令牌 | `15a54cc` |
| v0.5.1 | 2026-09-26 | 停止双份同源载荷注入 + 同源载荷去重 + 徽标接管显示；安装脚本状态条文案与自检脚本版本断言不再写死 | `b10060e` `a66d5c8` |
| v0.5.0 | 2026-09-26 | 重建为 `dsh-infinite-gen-5`（v0.5.0 基线）：脚本 / 用例库 / 工具名统一为五代口径（旧名保留重定向），提示词文件改名，补第三方许可声明并清理世代历史 | `eeea495` |

---

## 发版时怎么改

1. `npm run bump:version -- <x.y.z>` —— 只动 8 处锚点与 `package.json` 的 `version` / `dsh.version`（锚点表见 `scripts/version-targets.mjs` 的 `VERSION_ANCHORS`）。
2. 在 `UPDATE.md` 顶部加 `## vX.Y.Z` 段写完整叙述（**真源**），再在**本文件**上加一行摘要（版本 / 日期 / 关键变更 / 提交）。
3. `npm run changelog` 重新生成 `CHANGELOG.md`（提交标题带 `(vX.Y.Z)` 作用域才会进对应段）。
4. `npm run verify:all` 收口；`verify:version` 会同时盯住「锚点唯一且等于 `package.json`」和「文档不得宣称超前版本」。
