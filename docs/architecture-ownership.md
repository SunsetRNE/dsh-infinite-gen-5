# 无限五代插件：功能归属与架构改造路线

## 目的

记录现有功能在 Host、Client、Agent、MCP 之间的职责归属，明确数据权威、调用边界和后续迁移次序。本文是按当前工作区源码做的静态盘点；未声称已核实每个功能在所有运行 profile 中的启用状态。

## 现状归属

| 功能 | 当前代码位置 | 当前归属 | 目标归属 | 处理意见 |
|---|---|---|---|---|
| 提示词段、锚点、按需注入、预算与接管策略 | `index.js`、`prompts/`、`data/injection-policy.mjs`、`data/host-catalog.mjs` | Host | Host | 保留 Host 执行；注入计划与装配执行拆分，减少入口中互相独立的 assemble handler。 |
| 领域识别、意图与载荷形态判定、领域包 | `data/scenarios.mjs`、`data/pack-intent.mjs`、`data/payload-shape.mjs`、`data/identity-routes.mjs` | Host 领域模块 | Host 领域模块 | 数据/纯逻辑维持单一真源，供运行时与离线评测复用。 |
| 环境探测 | `data/probe.mjs`、`index.js` | Host Tool 能力 | Host Service/模块 + Agent Tool 适配器 | 纯探测逻辑留独立模块；工具入口只校验参数、调用逻辑、整理输出。 |
| 分片计划与回执评分 | `dispatch.mjs`、`index.js` | Host 领域逻辑 + Tool | Host Service/模块 + Agent Tool 适配器 | 分片/评分逻辑继续保持无 UI 依赖；未来其它调用方复用同一契约。 |
| Relay 端点直连与适配器工具 | `adapters/relay-tools.mjs`、`index.js` | Host + Agent Tool | Host Adapter/Service + Agent Tool | 凭据与网络调用留 Host；Agent 工具层不持有第二套网络实现。 |
| 统计存储 | `stats-store.mjs`、`index.js` | Host 写入 | Host 权威存储 | 保持单写者；定义清晰的只读快照接口，统计失败不得影响核心注入/工具流程。 |
| 任务清单读取与写入桥接 | `tasks.mjs`、`index.js` | Host 与宿主 Session 投影 | Host Adapter + 宿主 Todo 服务 | 读取宿主投影、写入走宿主事件；统计库中的任务镜像是派生缓存，不是权威源。 |
| Session 事件投影与状态装甲 | `index.js`、`anchor-armor.mjs`、宿主 `sessionProjections` | Host 投影 | Host Projection | 由现有 Session 日志派生；投影状态可重建，不增加未识别的 Session Event 类型。 |
| 状态条与设置台 | `client.js` | Client | Client | 通过 Slots 渲染；Client 只展示状态与收集用户操作，不承担业务判定或持久化权威。 |
| 调参、统计、任务读取 API 与 SSE | `index.js` 的 `webServer` 路由 | Host API | Host API/Service，Client 消费 | 为路由明确输入输出、错误结构和权限；SSE 作为通知/更新载体，不作为数据源。 |
| Agent 步骤行为、工具限制与上下文 | `index.js` 中 Agent 事件和 Tool 注册 | Host 插件安装的 Agent 扩展 | Agent Context/Tool Pipeline | 仅放 Agent 生命周期相关行为；显式释放 Agent 级注册和插件级 disposer。 |
| 自检、技能、破甲题库等领域能力 | `index.js`、`data/`、`scripts/`、`adapters/` | Host Tool、离线脚本 | 纯逻辑模块 + Host/Agent 适配器 | 避免把 CLI、评测、运行时各自复制规则；保持一个领域逻辑源。 |
| MCP 接入 | 本次盘点未发现明确的 MCP Server/Client 注册实现 | 未见 | 暂不增加 | 先稳定 Host Service 契约；存在独立 MCP Server 或跨应用复用的真实需求时再接入。 |
| Companion identity bundle | `companion-identity-bundle/` | 独立 Bundle | 待确认 | 本轮未读取该子包全部实现，暂不判断是否应合并或拆分。 |

## 目标边界

```text
Client Slot ── Remote/API ──> Host Service ──> Storage / 外部能力
                                  ▲
                                  │
                           Agent Tool adapter
                                  │
                           (可选) MCP adapter ──> 外部 MCP Server
```

- **Host 是业务能力与权威状态边界**：做配置、外部访问、权限决策、存储、投影、可复用业务编排。
- **Client 是交互与呈现边界**：使用 Host 暴露的 Remote/API 和 Slot selector；不复制业务规则、不扫描全量 Session 事件、不直接持有权威数据。
- **Agent 是调用与上下文边界**：仅注册 Agent 需要发现/调用的 Tool、Agent 专属提示和生命周期逻辑；Tool 调用复用 Host Service。
- **MCP 是协议适配边界**：对接独立外部 MCP 服务；不取代 Host 内部 Service、权限决策和应用状态。

## 数据所有权约定

1. 会话相关事实以宿主 Session 日志为准；投影是可重建派生状态。
2. 插件持久统计由 Host 写入；Client 只读。缓存标明可重建，不将缓存反向当成事实源。
3. 任务清单以宿主 Todo 机制为准；插件侧镜像用于 UI/统计时须标记为镜像并可刷新。
4. 凭据和网络访问只由 Host 承载；UI 与 Agent Tool 不另存敏感值副本。
5. 配置走 Loader/Config；可选服务采用可选依赖注入，使能力缺失时能降级而非启动崩溃。

## 改造优先级

### P0：建立边界清单（本轮）

- 为每项功能标注入口、权威数据源、写入者、读取者、生命周期和清理动作。
- 明确统计库、Session Projection、Todo 投影三者不是同一类数据。
- 以本文件作为后续改动评审的归属基线。

### P1：降低 `index.js` 的编排负担

- 将其逐步收敛为插件组装入口：依赖探测、模块初始化、注册与 disposer 管理。
- 先拆纯逻辑和状态模块，不改变行为、不改调用协议。
- 每个模块有明确输入/输出，避免模块反向 import 入口文件。

### P2：形成 Host Service 契约

- 选择至少有两个实际调用方的功能，抽成 Host Service。
- Host Service 先被现有 Tool 与 Web/API 共用；Agent Tool 是薄适配器。
- 通过 Inspect 查询当前运行时确切 Service/Remote 注册契约后再接线，不猜 API。

### P3：收薄 Client 与 Agent 层

- Client 迁移到 Slot + 最小投影/Remote 数据接口。
- Agent 行为按 Agent Context 生命周期注册，卸载时可完全释放。
- 用装载/卸载、Agent dispose、Client 刷新和缺失可选依赖用例验证。

### P4：按需求决定 MCP 与包拆分

- 无独立服务复用需求时不引入 MCP。
- 先让模块边界和契约稳定，再拆 npm package，避免把源码移动误当作架构解耦。

## 下一步实施建议

先从**统计与状态读取**着手做边界整理：Host 已有 `stats-store.mjs` 单写者、只读路由/SSE 与 Client 面板的天然分层，适合验证“Host 数据权威 → Client 只读消费”。先明确统计库、实时投影、Todo 镜像各自语义，再抽只读快照/状态查询适配器；保持现有 JSON 格式与路由不变。之后再选场景查询或环境探测做第二个 Host Service 垂直切片。

改动必须分成小步：每步先保留现有行为基线，抽模块后运行定向测试，再扩展调用方。本文本轮仅新增架构文档，没有改运行时代码。

## 验收检查

- 每一项业务能力只有一个权威实现和明确数据写入者。
- Client 与 Agent 调用同一 Host 业务实现，不存在规则复制。
- Tool 注册、路由、Slot、Agent 行为都具有明确的注册 owner 和 teardown。
- projection 与缓存均可从其权威数据源重建。
- 可选依赖缺失不导致插件加载失败。
- 没有 MCP 需求时不增加 MCP 运行时复杂度。

## 证据与限制

- **Observed**：工作区的 `package.json` 指定 `index.js` 为 Host 主入口、`client.js` 为 Client 入口；`index.js` 中存在工具注册、Session Projection、`webServer` 路由和 SSE 接线；`stats-store.mjs` 实现单写者 JSON 存储；`tasks.mjs` 与宿主 Todo 投影/写入桥接。
- **Inferred**：当前最划算的第一步是先稳定状态读边界，再抽跨调用方 Host Service；这是基于可见调用结构的判断，不代表已经完成该抽取。
- **Unknown**：全部 profile 的启用情况、Companion Bundle 的完整职责、各功能实际调用频率与线上错误率尚未检查。

## 第一条垂直切片：统计与状态读取

本节把“Host 数据权威 → Client 只读消费”落实为可执行契约。第一条切片不改变已有路由、JSON 字段或 SSE 语义，只把边界写清楚，作为后续抽 Service 的基线。

### 1. 组件职责

| 组件 | 允许做什么 | 明确禁止什么 | 证据/实现 |
|---|---|---|---|
| `stats-store.mjs` | 创建统计文档、内存变更、原子落盘、防抖、读盘快照、变更通知 | 读取 Cordis 上下文、决定业务状态、直接响应 HTTP | `createStatsStore()`；`set/patch/bump/push/flush/read/onChange` |
| `data/stats-api.mjs` | 将快照转换为 HTTP/SSE 输出形状 | 文件读写、重新计算业务统计、访问 Client 状态 | `statsReadResponse()`、`statsEventCounts()`（本期删掉无消费方的 `statsResponse()`） |
| `index.js` Host 编排 | 采集事件、调用统计写侧、注册路由、管理 SSE 生命周期 | 让 Client 参与写库或复制统计算法 | `publishStats()`、`statsHandler()`、`eventsHandler()` |
| `client.js` | 取桥接配置、GET 统计库、订阅 SSE、渲染状态 | 直接导入 Host 内部模块、解析 SSE 正文、写统计库 | `statsBridge()`、`panelFetch()`、共享订阅状态机 |
| `tasks.mjs` | 归一化 Todo 投影、生成镜像、校验待写清单 | 把任务镜像当成会话事实源 | `readTaskList()`、`normalizeTodoPatch()` |

### 2. 数据流与不变量

1. **写入单向**：业务事件只能由 Host 写入 `stats-store`；Client 没有写统计库的接口。
2. **读取单向**：Client 通过 `/infinite-gen-5/stats` 读取已写快照；路由只做读盘优先、内存回退，不在读侧补算业务数据。
3. **SSE 只做闹钟**：`/infinite-gen-5/events` 的帧只携带序号、时间和摘要计数；收到帧后 Client 再 GET `/stats`，不得把 SSE 帧当正文数据源。
4. **任务双层语义**：会话 `todo/write` 与 `todos` projection 是事实源；`stats.tasks` 只保存面板/统计需要的派生镜像。
5. **失败隔离**：统计落盘失败只记录 `lastError` 并保留脏标记；统计异常不得阻断注入、工具执行或 Agent 生命周期。
6. **生命周期对称**：注册路由、事件监听、SSE 客户端、定时器都必须有对应 disposer；卸载先断流，再停定时器，最后 flush。

### 3. 当前 HTTP 契约

| 路径 | 方法 | 作用 | 写入权威数据 | 错误语义 |
|---|---|---|---|---|
| `/infinite-gen-5/stats` | `GET` | 返回统计库只读快照 | 无 | 非回环 `403`；令牌错误 `401`；其它异常 `500` |
| `/infinite-gen-5/tuning` | `GET/POST` | 读取/修改调参配置 | 调参文件与 Host 运行态 | 非法 JSON `400`；写失败 `500` |
| `/infinite-gen-5/tasks` | `GET/POST` | 读取镜像、提交 Todo 操作 | `todo/write` 会话事件（不是 stats） | 非法 action/JSON `400`；未捕获异常 `500` |
| `/infinite-gen-5/events` | `GET` | 建立统计变更 SSE | 无 | 连接数超限 `503`；鉴权失败 `401` |

所有面板路由都要求本机回环与页面注入令牌；SSE 因浏览器 `EventSource` 无法设置自定义请求头，额外允许查询参数令牌，但仍保留回环校验。路由注册晚于插件加载时，由 Host 的依赖注入等待 `webServer` 就绪后补挂，不能把“服务未就绪”伪报成成功。

## Service 抽取契约

下一步抽取不直接把 `index.js` 搬空，而是先形成一个最小、无 UI 依赖的 Host Service。建议名称为 `statsService`，实现可先放在 `services/stats-service.mjs`，再由入口统一组装。

### 对外接口（第一版）

```js
// 本期收口：与实现逐字对齐 —— 只接收 store；没有 clock 参数（时间戳由 stats-store 自己取）。
export const createStatsService = ({ store } = {}) => ({
  snapshot: () => store.snapshot(),
  read: () => store.read(),
  publish: (section, value) => store.set(section, value),
  patch: (section, fields) => store.patch(section, fields),
  count: (path, amount = 1) => store.bump(path, amount),
  append: (path, entry, keep) => store.push(path, entry, keep),
  subscribe: (listener) => store.onChange(listener),
  flush: (force = false) => store.flush(force),
  dispose: () => store.dispose(),
  // 迁移兼容别名（待删，见 alias gate）：set / bump / push / onChange。
  // 另转发 file / version / schema / writes / seq / dirty / lastError 元数据。
});
```

实现约束：

- Service 只接收显式依赖，不从模块级全局读取 `ctx`、`process` 或 Web 请求对象。
- `snapshot/read` 返回只读意义上的深拷贝；调用方修改返回值不得改变 Host 内存状态。
- `subscribe` 返回退订函数，监听器异常由写侧隔离，不反向抛到核心流程。
- HTTP 路由只做参数/鉴权/状态码适配；业务统计仍由调用方发布，避免把路由变成第二个写者。
- 初次迁移保留 `stats` 现有调用形状；完成定向验证后，再让 `/stats` 与 SSE 共同依赖 Service。

## 分阶段迁移清单

### M1：只读适配器（当前优先级）

- 新增 Service 外壳，内部委托现有 `stats-store.mjs`，不改变 schema 与文件位置。
- 将 `statsHandler` 的 `panelDoc()` 读取路径改为 Service 的 `read/snapshot`。
- 将 SSE 的 `onChange`、`seq` 和 `flush` 访问收敛到 Service 适配器。
- 保留现有路由常量和 `window.__IG5_STATS__` 桥接字段。

**完成判据**：现有 `verify:stats-panel` 全部通过；GET `/stats` 仍为只读；SSE 收到通知后只触发一次 `/stats` 回读；统计写失败不影响 Host apply。

### M2：任务状态边界

- 使 `tasks.mjs` 成为唯一的任务归一化入口。
- 将 `writeTaskList` 的宿主投影读取、校验、`todo/write` 事件提交拆为三个可测试步骤。
- 在统计库中明确记录 `source`、`session`、`at` 与 `reason`，不把不可用投影伪装成空清单。

**完成判据**：restore/set/坏 JSON/未知 action/无会话/投影抛错均有固定错误结构，且不会写入第二份 Todo 真源。

### M3：Client 与 Agent 收薄

- Client 只保留桥接、订阅、渲染和用户动作转发。
- Agent Tool 调用 Service，不直接触碰文件路径、SSE 客户端集合或 Web 路由。
- 对每个注册点补 disposer，并验证 apply → dispose → apply 不重复注册。

**完成判据**：Client 不出现 `stats-store.mjs`、`tasks.mjs` 或 Host 内部导入；工具、路由、投影和定时器在重复装载后数量稳定。

### M4：是否引入 MCP 的决策门

仅在出现独立进程、跨应用复用或外部服务协议要求时评估 MCP。评估前先回答：调用方是否脱离当前 Host、是否需要跨进程权限边界、是否已有稳定 Service 契约。三个问题均为否时，继续使用 Host Service，不增加 MCP 层。

## 评审与回滚规则

- 每次提交只跨越一个迁移阶段；不得同时改 schema、路由路径和 Client 状态机。
- 先运行纯模块测试，再运行 Host 演习台，最后运行 Client 静态门禁；任何一层失败都保留旧适配器。
- 新 Service 出现行为差异时，以现有 `stats-store.mjs` 和已落盘 JSON 为基线，回滚只撤销注入层，不删除历史统计文件。
- 迁移期间新增字段必须向后兼容；旧字段至少保留一个完整迁移周期，删除前先在本文件记录替代字段和读侧回退。

## 交付后的验证命令

```bash
cd dsh-infinite-gen-5
node --check index.js && node --check client.js && node --check stats-store.mjs && node --check data/stats-api.mjs && node --check tasks.mjs
```

```bash
cd dsh-infinite-gen-5
npm run verify:stats-panel
```

验证重点不是“路由注册成功”本身，而是权威关系：统计只由 Host 写、Client 只读；Todo 写回宿主 `todo/write`；SSE 只通知回读；卸载后资源全部释放。

## 变更记录

- 2026-10-08：补充统计/状态读取垂直切片、HTTP 契约、`statsService` 最小接口、M1–M4 迁移清单与回滚/验收判据；未修改运行时代码。
- 2026-10-08：落地 M1 的第一小步：新增 [`services/stats-service.mjs`](../services/stats-service.mjs)，以显式 `store` 依赖提供统计读写、订阅、刷新与生命周期接口；新增 [`scripts/verify_stats_service.mjs`](../scripts/verify_stats_service.mjs) 与 `verify:stats-service` 命令。当前入口仍使用旧 `stats` 句柄，下一小步再将 `panelDoc` 与 SSE 迁移到 Service，避免一次改动跨越多个边界。
- 2026-10-08：将 `index.js` 的统计句柄切换为 `createStatsService({ store: statsStore })`；`panelDoc` 已通过 Service 的 `read/snapshot` 工作，SSE 已通过 Service 的 `onChange/seq/snapshot` 工作。为保持 `recordBoot` 与既有写点兼容，Service 暂留 `set/bump/push/onChange` 兼容别名与 `writes` 元数据。实测 `verify:stats-service` 通过，`verify:stats-panel` **119 通过 / 0 失败**。
- 2026-10-08：完成 M1 写入侧下一小切片：`coverage`、`tuning`、`identity` 的顶层发布改用 `stats.publish`；任务写入计数与历史改用 `stats.count` / `stats.append`。为适配源码边界门禁，更新 `scripts/verify_stats_panel.mjs` 的断言以识别语义化 API；未改变 stats schema、HTTP 路径、SSE 帧、`client.js` 或路由内业务逻辑。`recordBoot` 暂保留底层兼容调用路径，`sessions.seen/events` 仍待后续小切片迁移。实测 `node --check index.js`、`node --check services/stats-service.mjs`、`npm run verify:stats-service`（PASS schema=ig5-stats/1 notifications=1）、`npm run verify:stats-panel`（119 通过 / 0 失败）。
- 2026-10-08：完成 sessions 计数小切片：`sessions.seen` 与 `sessions.events` 均由 `stats.bump` 迁移为 `stats.count`。源码扫描确认 `index.js` 已无 `stats.set/bump/push` 调用；`recordBoot(stats, ...)` 仍是唯一需要兼容别名的调用链。未改变计数路径、增量默认值、stats schema、HTTP/SSE、`client.js`。实测 `node --check index.js`、`node --check services/stats-service.mjs`、`npm run verify:stats-service` 与 `npm run verify:stats-panel` 均通过。

- 2026-10-08：完成 `recordBoot` 适配小切片：优先使用 Service 的 `publish("boot", ...)` 与 `append("boots", ..., keep)`，保留旧 `set/push` 回退；`verify_boot_attest.mjs` 覆盖 Service 路径与旧 store 回滚路径。未改变旧启动历史、`previous` 快照、`keep` 截断、落盘行为、stats schema、HTTP/SSE、`client.js`。实测 `node --check index.js`、`node --check services/stats-service.mjs`、`npm run verify:stats-service`（PASS schema=ig5-stats/1 notifications=1）、`npm run verify:stats-panel`（119 通过 / 0 失败）、`npm run verify:boot`（16 条通过）。
- 2026-10-08：完成兼容别名调用面审计与身份门禁修正：`index.js` 未发现生产侧 `stats.set/bump/push` 调用；`verify_identity_routes.mjs` 的旧 `stats.set("identity", ...)` 静态断言已更新为 `stats.publish("identity", ...)`。实测 `verify:identity-routes`（57 通过 / 0 失败）、`verify:stats-service`（PASS schema=ig5-stats/1 notifications=1）、`verify:stats-panel`（119 通过 / 0 失败）、`verify:boot`（16 条通过）。兼容别名仍保留，供 recordBoot 旧 store 回退与后续可回滚。
- 2026-10-08：新增 `scripts/verify_stats_alias_gate.mjs` 与 `verify:stats-alias-gate`，静态扫描 242 个 JS/MJS 文件；旧别名仅允许出现在 Stats Service 实现、stats-store、兼容验证/注册探针中。SSE 生产订阅由 `stats.onChange` 改为 `stats.subscribe`，面板静态门禁同步更新；未删除 `set/bump/push/onChange` 兼容别名。实测 alias gate PASS、stats service PASS、stats panel 119/0、boot 16 条、identity routes 57/0，且 `index.js` 与 `services/stats-service.mjs` 语法检查通过。
- 2026-10-08：增强 `scripts/verify_boot_attest.mjs` 的双路径门禁：新增 Service 优先级断言，使用 `publish/append` 时让 `recordBoot` 明确不触碰 `set/push` 回退；同时保留旧 store 回退断言。未改变启动历史、previous 快照、keep 截断、落盘行为或迁移兼容边界。
- 2026-10-09：完成生命周期收敛小切片：`index.js` 的实时化 disposer 从 `stats.flush(true)` 改为 `stats.dispose()`，由 Host Stats Service 统一承担定时器停止与最终落盘；`verify_stats_panel.mjs` 新增 `dispose()` 脏状态清理断言。未改变 schema、HTTP/SSE、Client 或统计失败隔离语义。
- 2026-10-09：第二条垂直切片落地 [`data/scenario-service.mjs`](../data/scenario-service.mjs)（场景查询从 `index.js` 抽成显式依赖注入的 Service，命中/未命中记账由调用方传入），并新增 `verify:package-closure` 与 `release:pack` 的「运行时 import 闭包 × 发布面」门禁：`scripts/verify_package_closure.mjs` 默认读工作树，`scripts/package-release.mjs` 读 git 跟踪面 —— 两者测的不是同一件事，本地绿不等于能发版。
- 2026-10-09：接线收口（本轮）。① `verify:all` 链补入 `verify:stats-service` 与 `verify:stats-alias-gate`（两条此前只在 `package.json` 定义、没人跑，等于最重要的生产调用面回归门禁 CI 看不见）；② alias gate 接收者正则从 `stats|store|statsStore` 扩到含 `statsSink|sink`，并清掉 `index.js` 9 处 `statsSink.bump(...)` 旧别名调用（改走 `count`，`scripts/verify_ui.mjs` 三条源码断言同步）；③ 因无消费方删除 `statsResponse()`（HTTP 契约形状不变）；④ `scripts/tool-registry.mjs` 的 EXTRA_ROOTS 登记三个新模块，`docs/LAYOUT.md` / `docs/README-FULL.md` 装载面补齐；⑤ `scripts/verify_win_compat.mjs` 的 CORE 纳入 `services/stats-service.mjs` / `data/stats-api.mjs` / `data/scenario-service.mjs`；⑥ `scripts/package-release.mjs` 的 `--worktree` 从死开关实现为「跟踪面 + 未跟踪（未被忽略）」的工作树打包，未跟踪运行时文件在默认模式下仍拒绝出包。
- 2026-10-09：已知未收口：`verify:win-compat` 仍是红的且**未接进** `verify:all`（工作树实测 scripts/ path-posix-abs 98 > 86、path-hardsep 35 > 30、tmp-hard 45 > 30；HEAD 基线 88/35/43 也已超顶），是 v0.66.0 之前就存在的欠账 —— 要么把新脚本的 POSIX 假设接进 `data/win-compat.mjs` 垫片，要么先定「哪些脚本属于 Windows 交付面」再重设基线，然后再接线，不要把一个红的门禁直接塞进 `verify:all`。

## 给下一个 AI 的移交文本

```text
继续开发目录 /root/Documents/deepseek-harness/default-workspace/dsh-infinite-gen-5-v2/dsh-infinite-gen-5。目标是按 docs/architecture-ownership.md 继续将统计写入从 stats-store 迁移到 Host Stats Service，保持可回滚、每次一个小切片。

已完成：
- index.js 已创建 statsStore，并通过 createStatsService({ store: statsStore }) 得到 stats。
- panelDoc 使用 stats.read()/stats.snapshot()；SSE 使用 stats.subscribe()/stats.seq()/stats.snapshot()。
- coverage、tuning、identity 使用 stats.publish(section, value)。
- tasks.writes_total 使用 stats.count(path)。
- tasks.writes 使用 stats.append(path, entry, keep)。
- sessions.seen 与 sessions.events 使用 stats.count(path)。
- index.js 已无 stats.set/stats.bump/stats.push 调用，SSE 生产订阅使用 stats.subscribe。
- verify_identity_routes.mjs 已按 stats.publish("identity", ...) 校验当前生产调用点。
- verify_stats_alias_gate.mjs 已静态扫描旧别名调用面；允许范围仅为 Service 实现、stats-store、兼容验证/注册探针。
- stats-service.mjs 仍保留 set/bump/push/onChange 兼容别名，暂时不要删除；recordBoot 已优先使用 publish/append，并保留旧 store 回退。

保持不变：
- stats JSON schema=ig5-stats/1；
- HTTP 路径；
- SSE 帧结构；
- client.js；
- stats-store 的单写者与失败隔离语义；
- 不把统计逻辑移进路由；
- 不大范围重构 index.js。

下一步建议：先继续保持 `recordBoot` 的双路径兼容，并以 alias gate 作为生产调用面回归门禁；暂不删除 `set/bump/push/onChange`。只有在独立验证所有兼容测试、旧库升级、apply/dispose 生命周期和回滚路径后，才单独评估删除兼容别名。必须保持旧启动历史、previous 快照、keep 截断与落盘行为不变。

每次修改后运行：
node --check index.js
node --check services/stats-service.mjs
npm run verify:stats-service
npm run verify:stats-panel
npm run verify:boot

最终报告必须列出实际读取/修改文件、迁移调用点、保留兼容别名原因、每条命令真实输出、未完成项及下一步建议。
本轮移交报告：生产侧写入已统一使用 `publish/count/append`，SSE 使用 `subscribe`；新增 `verify:stats-alias-gate` 作为回归门禁。下一位 AI 不要删除兼容别名，先按“alias gate → service → panel → boot → identity → syntax”顺序复验，再单独设计删除切片。
```
