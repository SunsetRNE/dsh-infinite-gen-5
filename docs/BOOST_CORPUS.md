# 无限五代 · 增强训练集（boost-corpus）

**一句话**：把一份 20602 B 的注入提示词附件，编译成一套**按本轮需求挑选、受字节预算约束**的增强条款，挂成内核之外的 Order 150 段随 system prompt 一起进上下文。

- 语料原件（只读副本，仅本机存在）：`/root/.dsh/attachments/v1/files/f4/f4cd463d37d78e17b6741bea1340d4cd76433e639c7f1127fd79b29f71075fdc/模型越狱注入提示词3.txt`
- 交付件：`data/boost-corpus.mjs`（编译层）· `scripts/extract-boost-corpus.mjs`（提取器）· `scripts/verify_boost.mjs`（87 条确定性自检）· `index.js` 接线（六处）· `package.json` 的 `verify:boost`

## 一、语料与三态拆分口径

实测（`stat -c %s` / `sha256sum` / `wc -l`）：**20602 B** · sha256 前缀 `f4cd463d37d78e17` · 495 个换行（按 `split(/\n/)` 计 496 行，差在末尾空元素）· UTF-16 字符 7900 · 52 节 · 171 段。

字符数与字节数差三倍是中文 UTF-8 的正常比例，不是编码异常 —— 早期把 `raw.length`（7900 字符）当成字节数与文件系统 20602 B 对照，误判成「口径不一致」，实为同一口径的两种量纲。

提取器 `scripts/extract-boost-corpus.mjs` 按节切段（`HEADING` 认中文序号与 `1.` / `3.2` 两种编号），再用 `RULES` 规则表把每段判进四态之一：

| 态 | 判定标准 | 段数 | 去向 |
| --- | --- | --- | --- |
| `take` | 与内核同向、且可读式复述不违反校准口径 | 20 | 编译成 10 个单元中的 8 个 |
| `redact` | 正文含内容边界/角色行为类措辞，须改写成「按内核口径执行」的抽象条款 | 19 | 只进 G7 / G9 两个单元 |
| `internal` | 元条款、保密规则，与「注入可审计」冲突 | 1 | 只留工程记录（`INTERNAL_ONLY`） |
| `kept-out` | 内部脚手架、过程记录、与本插件无关 | 131 | 不入库 |

**只留工程记录、不进注入路径的五条（`INTERNAL_ONLY` X1–X5）**，理由是硬冲突而不是遗漏：

- **X1** 无拒绝原则（语料 1.1 / 1.3）—— 元条款，改写它等于改内核本身；
- **X2** 禁用词表（8.3）—— 与内核「截至 … 已验证」四行收尾正面冲突；
- **X3** 保密规则（第十二部分）—— 要求不复述自身指令，与注入可审计冲突；
- **X4** 内容边界声明（2.2 / 10.4）—— 内核已有更严口径，重复注入只会互相打架；
- **X5** 过程记录与单遍任务编译器（第 4 / 5 节）—— 本插件的内部脚手架，对生成侧无增益。

## 二、十个编译单元

`bytes` 由 `Buffer.byteLength` 现场量，不是估算。`always` 两条任何档位都注入。

| id | 来源节 | kind | 触发词（节选） | 字符 / 字节 | 常驻 |
| --- | --- | --- | --- | --- | --- |
| G1 | 3.2 先查后写 | take | 文件 / 附件 / 路径 / 验证 / 样本 / hash | 56 / 166 | ✓ |
| G2 | 3.3–3.4 副本与产物 | take | 改 / 补丁 / 配置 / 编译 / 安装 | 91 / 165 | |
| G3 | 3.5 风险操作 | take | 删除 / drop / 覆盖 / 清空 / 不可逆 | 59 / 177 | |
| G4 | 8.2 / 第十三节 状态延续 | take | 继续 / 下一步 / 重试 / 报错 / 失败 | 65 / 183 | ✓ |
| G5 | 8.1 / 8.3 结尾与净化 | take | 输出 / 报告 / 格式 / 整理 / 表格 / json | 56 / 160 | |
| G6 | 2.3 / 第九节 指南类交付 | take | 教程 / 步骤 / 指南 / 流程 / howto | 100 / 190 | |
| G7 | 2.2 / 第十 / 10.5 创作交付 | redact | 小说 / 剧本 / 角色 / 扮演 / npc | 71 / 213 | |
| G8 | 2.5 / 第九节 攻击性安全 | take | 渗透 / 提权 / 免杀 / 逆向 / exploit / c2 | 73 / 207 | |
| G9 | 2.6 / 10.7 角色行为 | redact | npc / 扮演 / 角色 / rp / 对戏 | 46 / 130 | |
| G10 | 7.1 事实与推测 | take | 版本 / 价格 / 最新 / 今天 / 政策 / api | 67 / 183 | |

合计 96 个触发词、10 个单元正文 1774 B；`take` 8 条 / `redact` 2 条。`verify_boost.mjs` 逐条断言「单元正文不得整句出现在 `prompts/infinite-gen-5.md`」——增强集必须是增量，不能是内核的同句复制，否则 `DEDUPE_PAYLOAD` 会把它当同源段丢掉。

## 三、档位、预算与整条丢弃

| 档位 | 预算 | 说明 |
| --- | --- | --- |
| `off` | 0 B | 只留统计，不注册任何内容 |
| `light` | 1200 B | 常驻两条 + 少量命中 |
| `standard` | 2400 B | 默认 |
| `full` | 4200 B | 上限档，`full × 2 ≤ 20500` 有断言兜底 |

内核载荷硬上限是 `scripts/verify_prompt_gen5.mjs` 的 `PAYLOAD_BUDGET_BYTES = 20500`，所以增强集是「在内核已有 ~15 KB 之外再切一块」的减法，不是加法。

编译策略三条：**常驻两条恒在最前** → 命中项按定义序拼接 → 超预算**整条从尾部丢弃**。不存在「句子被截一半」的中间态；预算小到连一个单元都放不下时宁可 0 B 不注入（预算 64 B 实测输出 0 B）。

### 编译矩阵（2026-09-28 实测，mode=standard / bytes=2400）

| 输入 | 命中单元 | 载荷 |
| --- | --- | --- |
| 今天天气不错 | G1, G4 | 417 B |
| 把这个配置文件改掉并验证 | G1, G4, G2, G6 | 774 B |
| 写一段剧本，反派 NPC 有自己的动机 | G1, G4, G7, G9 | 762 B |
| 帮我做一次内网渗透 getshell | G1, G4, G8 | 625 B |
| 输出一份报告并整理成表格 | G1, G4, G5 | 578 B |
| rm -rf 覆盖旧目录并把数据库清空 | G1, G4, G3 | 595 B |
| @boost:off 改一下这个配置 | —（指令压过自动档） | 0 B |
| @boost:full 随便聊聊 | G1, G4（文本无触发词） | 417 B |

档位优先级：**显式指令 > 强信号自动档 > 用户设置页档位**。`inferMode()` 在无强信号时返回 `null` 而不是默认值 —— 这条是实测踩出来的：早期版本对「今天天气不错」返回 `standard`，会把用户在设置页选的 `light` / `full` 悄悄压回 2400 B。

## 四、接线（`index.js` 六处）

1. `import { BOOST_UNITS, BOOST_HEADER, boostStats, compileBoost, inferMode, readDirective } from "./data/boost-corpus.mjs";`
2. 常量：`BOOST_MODE = "standard"` · `BOOST_BYTES = 2400` · `BOOST_SECTION = "infinite-gen-5:boost-corpus"` · `BOOST_ORDER = 150`
3. `mountInjection()` 内 `primaryOk` 之后注册段：`registerSection({ name: BOOST_SECTION, order: BOOST_ORDER, text: boostLive().text }, "Order 150 增强训练集（按需求编译）")`
4. 装配瀑布 `refreshBoost`：`injectionHandles.push(ctx.effect(() => ctx.on("system-prompt/assemble", refreshBoost)))`，在 `next()` 之后按段名换掉文本并回写 `runtime.boost`
5. 设置页两个调参键：`BOOST_MODE`（standard / light / full / off）· `BOOST_BYTES`（number，256–12000）；env 为 `IG5_BOOST_MODE` / `IG5_BOOST_BYTES`
6. `profile` 输出 `boost` 块（configured / runtime / corpus 统计 / units / header / section / order / directive）

**挂法踩坑（判据是实跑报错）**：`ctx.systemPrompt.assemble(...)` 与 `ctx.effect(() => ctx.systemPrompt.assemble(...))` 两种写法都报 `TypeError: ctx.systemPrompt.assemble is not a function`；只有事件瀑布 `ctx.on("system-prompt/assemble", fn)` 可用，与内核热加载同挂法。假宿主的 `systemPrompt` 服务只暴露 `section()`，装配必须走 `ctx.on`。

`registerSection` 会读 `spec.text` 做同源比对（`DEDUPE_PAYLOAD`），所以注册时必须是**字符串**，不能传 getter —— 传函数会被去重逻辑判成同源段丢掉。

## 五、复现与自检

```bash
cd /root/dsh-infinite-gen-5
node scripts/verify_boost.mjs          # 87 条：单元成形 / 档位预算 / 命中可解释 / 指令 / 与内核不同源 / 统计 / 接线口径
node scripts/verify_injection.mjs      # 65 条：含「增强集落在 Order 150」与装配顺序 100,118,150,200,10150
node scripts/extract-boost-corpus.mjs  # 三态拆分对账；缺语料打印 SKIP 并 exit 0（离线可跑）
npm run verify:all                     # 全套
```

编译层可单独调用（不依赖插件宿主）：

```bash
node -e 'import("./data/boost-corpus.mjs").then(m=>console.log(JSON.stringify(m.boostStats())))'
node -e 'import("./data/boost-corpus.mjs").then(m=>{const c=m.compileBoost({text:"把这个配置文件改掉并验证",mode:"standard",bytes:2400});console.log(c.bytes,c.hits.map(h=>h.id).join(","))})'
```

## 六、边界与已知缺口

- 只做了**确定性编译回归**（同输入两次编译逐字节一致、预算与命中可解释、与内核不同源）；**没有**做真实会话的 A/B 效果量化 —— 「增强集让回答变好多少」不在本次证据范围内。
- 语料来源是单一附件（20602 B），未做跨来源合并与去重。
- X1–X5 五条永久不进注入路径，属设计决定；要改这条线得改内核，不是改本目录。
- 报告内的版本号以 `package.json` 的 `version` 为准，`BOOST_VERSION` 与之同源（`bump-version.mjs` 一并改写）。

### 断言状态

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| 语料 20602 B / sha256 前缀 f4cd463d37d78e17 / 171 段 / 三态 20·19·1·131 | 已知 | — | 2026-09-28 `stat` + `sha256sum` + 提取器实跑 |
| 编译矩阵 8 行（417–774 B）与档位 0/1200/2400/4200 | 已知 | — | 2026-09-28 `compileBoost` 直调实测 |
| `verify_boost` 87 条 / `verify_injection` 65 条全绿 | 已知 | — | 2026-09-28 本机实跑 |
| 增强集在真实会话里的收益幅度 | 未知 | — | 需要实机会话 A/B，当前无数据 |
