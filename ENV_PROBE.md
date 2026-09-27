# 运行环境探测（ENV PROBE）· 设计说明书

> 版本：随插件 v0.8.0 引入 · 数据格式 `infinite-gen5/env-probe@1` · 探测版本 `1`
> 实现：`data/probe.mjs`（引擎，无依赖） + `scripts/probe-env.mjs`（CLI） + `infinite_gen5_env`（工具）
> 自检：`scripts/verify_env.mjs`

## 0. 一句话

一条命令回答四个问题：**我在哪台机器上、我能不能出网、我手里已经有什么、缺的那个怎么装。**

## 1. 为什么要有它

内核载荷里的「工具链规则」（`prompts/infinite-gen-5.md`）要求：缺工具时
`探测 → 安装一次 → 验证 → 降级`。但**探测这一步原先没有任何工具支撑** ——
模型只能一条条试 `command -v ffuf`、`which ghidra`，每次试探都是一个回合、一次
工具调用、一段上下文。更糟的是它很容易停在「环境未知」上，于是交付物里出现
「请自行安装」这类空话。

环境的本质特点是：**每台机器都不一样，而且只对当前会话有效**。所以它不适合写进
system prompt（那是每轮为「别的机器」付费），也不适合塞进领域包（领域包讲怎么打，
环境讲在哪打）。它适合做成**按需调用的工具**：一次调用，一份结构化报告。

## 2. 分层设计

探测按「越靠前越便宜」排序，调用方可以只跑前几层。`layers` 参数可任意组合。

| 层 | 名称 | 探什么 | 手段 | 典型耗时 | 失败时 |
|---|---|---|---|---|---|
| L0 | `shape` | OS / 发行版 / 架构 / 内核版本 / 容器 / WSL / Android / uid·gid / home / cwd / DSH 沙箱 | 读 `/etc/os-release`、`/etc/lsb-release`、`/.dockerenv`、`/proc/1/cgroup`、`/proc/version`、`/system/build.prop` | < 50 ms | 字段置 `null` + 记 note |
| L1 | `resources` | CPU 核数 / 内存 / 空闲内存 / loadavg / 磁盘余量 / ulimit / cgroup 限额 | `node:os` + `statfsSync("/")` + `/proc/self/limits` + `/sys/fs/cgroup/*` | < 50 ms | 该段置 `null` + 记 note |
| L2 | `network` | 代理环境变量 / DNS 解析 / TCP 连通性 / 出网形态判定 | 读 `*_PROXY` 环境变量 + `dns.lookup` + `net.createConnection` | 1.5–2 s | 单目标失败只让该行 `ok:false` |
| L3 | `stock` | 包管理器 / 语言运行时 / 常用工具 / 可写目录 | 一次 shell 批量 `command -v` + `--version` | 0.4–2.5 s | 检测不到就是「没有」 |
| L4 | `capabilities` | CapEff 位解码 / seccomp / no_new_privs / ptrace_scope / dev 节点 / namespace / 模块树 | 读 `/proc/self/status`、`/proc/sys/kernel/yama/ptrace_scope`、`/dev/*` | < 30 ms | 整段 `null`（Android 常见） |
| L4.5 | `device` | DSHA 桥接令牌 / `/app/device` 可达性 / `adb-shell` 位置 | 读 `/root/.dsh/.bridge_token` + `fetch` 一次 | ≤ 1.6 s | 能力缺席，不是错误 |
| L5 | `domains` | 39 个领域各自的工具就绪度与「缺的那个怎么装」 | 纯计算（用 L3 的库存 + `data/toolchains.mjs`） | < 10 ms | 依赖 L3；L3 关掉则整段 `null` |

## 3. 出网形态判定

单个目标通不通不能说明问题，所以 L2 做**五个目标**：

- `dns-udp` 1.1.1.1:53（DNS 是否放行）
- `https-any` 1.1.1.1:443（是否有任何出网）
- `npm` registry.npmjs.org:443
- `pypi` pypi.org:443
- `github` github.com:443

判定：**任何目标可达** → `online`（若包源全不可达则降为 `restricted`）；**全部不可达** → `offline`。
`offline` 时报告会主动给出下一步：「安装一律走等价替代分支，并把降级点写进交付物」——
这正是内核工具链规则里「无网怎么办」那一条的输入。

## 4. 能力位解码（L4）

`/proc/self/status` 的 `CapEff` 是一个 64 位十六进制掩码。报告把它解成人类能用的布尔量：

| 位 | 名称 | 意味着什么 |
|---|---|---|
| 21 | `sysAdmin` | 挂载、改网络栈、namespace —— 容器逃逸/驱动类操作的前提 |
| 19 | `sysPtrace` | `ptrace` 别的进程 —— 逆向调试、注入 |
| 16 | `sysModule` | 加载内核模块 |
| 13 | `netRaw` | 原始套接字 —— 抓包、嗅探、发包 |
| 12 | `netAdmin` | 改接口/路由/iptables |
| 39 | `bpf` | eBPF |
| 2 | `dacReadSearch` | 绕过文件权限读 |

配合 `Seccomp`（`2` = 已启用 filter）、`NoNewPrivs`、`yama/ptrace_scope`、
`/dev/net/tun|kvm|fuse|mem`、`/proc/self/ns/*`，可以判断「这台机器上哪些**类**操作
注定会失败」，从而**在动手前就选好路线**，而不是撞一堵墙再改口。

> 本机实例：`capEff=0000000000000000`、`seccomp=2` ⇒ 连 `sysPtrace` 都没有，
> 逆向调试类操作应直接改为「静态分析 + 交给用户在自己的机器上跑」。

## 5. 领域就绪度（L5）

`data/toolchains.mjs` 里每个领域既有工具行（`<工具> — <用途> | 装: … | 验: …`）也有
注意事项行。L5 把工具行的**工具名抽出来**，与 L3 的实际库存比对，得到：

```json
{ "id": "unpack", "total": 6, "ready": 1, "ratio": 0.17,
  "missing": ["diec", "upx", "unipacker"],
  "install": [ { "bin": "diec", "install": "官方 release 的 diec CLI" },
               { "bin": "upx", "install": "apt install upx-ucl" } ] }
```

抽取规则（`binsOfToolLine`）：
1. **括号内的名字优先**：`Detect It Easy (diec)` → `diec`；`binutils（readelf/objdump/strings/nm）` → 四个命令名。
2. 括号外按 `/ + 、` 与连续空格切分，取每段第一个 token，只保留 `[a-z0-9._+-]` 形状。
3. 报「缺什么」时优先小写、像真命令的名字，避免把 GUI 显示名（`Cutter`、`StegSolve`）当成缺件。

这一层是**把「缺工具」翻译成「装什么」**——报告里给的不是「你缺 upx」，而是
「你缺 upx，装：`apt install upx-ucl`」。没有这一步，探测报告就只是抱怨。

## 6. 性能预算（实测，本机 Android/arm64 容器）

| 模式 | 实测 | 说明 |
|---|---|---|
| 首版实现 | **9.0–11.6 s** | 逐条 `command -v`，上百次进程启动（Android 上每次 ~50–100 ms） |
| 全量（默认） | **3.3 s** | 一次 shell 批量定位 + 版本探测预算 2.5 s + 网络并行 |
| `--fast`（不查版本） | **2.1–2.4 s** | 绝大多数决策只需要「有没有」，不需要版本号 |
| `--fast --no-net` | **0.35 s** | 纯本地形态 + 库存 |

提速手段（都在实现里）：
1. **一次 shell 查完一批**：`for b in "a" "b" …; do command -v "$b" && printf '%s\t%s\n' …; done`，
   而不是每个名字 fork 一次 Node。
2. **只给找到的工具查版本**，并设 `versionBudgetMs` 预算（默认 2500 ms）：超预算的
   余项标 `"skipped(budget)"` 而不是把整次调用拖长。
3. **并发度受控**：`inspectBins` 用 6 路 worker（上限 16）。
4. **DNS 与 TCP 并行走**：串行查两个域名在慢解析器上就是白等两轮超时。
5. **层可裁剪**：只要前三层 ≈ 1.8 s。

## 7. 安全与隐私边界（写死在实现里，不靠调用方自觉）

1. **纯只读** —— 只读文件、只跑 `--version` / `command -v`；从不安装、不写配置、不改系统。
   唯一的例外是 `out` 参数（显式要求时才把 JSON 写到指定路径）。
2. **不碰用户资产** —— 网络探测只连公共基础设施（1.1.1.1、npm/pypi/github），不扫内网、
   不发业务请求；`net: false` 时连这些也不做。
3. **不读敏感文件** —— 不读 `~/.ssh`、`~/.aws`、凭据、令牌。基础信息只来自
   `/etc/os-release`、`/proc/self/*`、`/sys/fs/cgroup/*` 这类。
4. **处处超时** —— 每条子进程、每个 socket、每次 `fetch` 都有超时；任何一层抛错都只变成
   `notes` 里的一行，绝不让整个调用挂住或失败。
5. **结论可复核** —— 报告带路径、版本、原始行（如 `capEff=0000000000000000`），
   不只给「可用/不可用」。

## 8. 与其他部件的接口

```
data/toolchains.mjs ──(39 域，工具/装/验)──► data/probe.mjs:domainReadiness()
                                                     │
内核载荷「Environment rule」──► infinite_gen5_env ────┤──► tool result（一次，含摘要+结构化）
内核载荷「Toolchain rule」 ──► infinite_gen5_scenario ─┘
scripts/probe-env.mjs（CLI）───────────────────────────┘
```

- 领域包（`data/scenarios.mjs`）与工具链（`data/toolchains.mjs`）是同一批 id 的两个侧面：
  前者讲「怎么打」，后者讲「用什么打」。探测报告的 `domains[].id` 可直接喂给
  `infinite_gen5_scenario`。
- `TOOLCHAIN_PROTOCOL`（7 条）同时出现在领域工具与环境工具的结果里，保证两边口径一致。

## 9. 用法

```bash
# CLI
node scripts/probe-env.mjs                 # 人类可读摘要
node scripts/probe-env.mjs --json          # 完整 JSON（约 27 KB）
node scripts/probe-env.mjs --fast          # 不查版本（快一倍）
node scripts/probe-env.mjs --no-net        # 不出网（生产/内网机）
node scripts/probe-env.mjs --domains       # 追加每域就绪度条形表
node scripts/probe-env.mjs --out /tmp/env.json
node scripts/probe-env.mjs --layers shape,network
```

```
# 工具（模型侧）
infinite_gen5_env                                  # 摘要
infinite_gen5_env {layers:"shape,stock"}           # 只探形态与库存
infinite_gen5_env {net:false, versions:false}      # 离线免等待
infinite_gen5_env {domains:true}                   # 附每域明细
```

## 10. 报告长什么样（本机实例）

```
环境：linux/arm64 Ubuntu 24.04.3 LTS · Android · uid=0(root) · node v24.19.0
资源：8 核 / 内存 22.6 GiB（空闲 7.1） / 磁盘余量 590.6 GiB / nofile 1048576
网络：online（可达：dns-udp、npm、pypi、github） · 无代理变量
包管理：apt、dpkg · 可写：tmp=y cwd=y
运行时：node、npm、pnpm、python3、java、javac、gcc、g++、make、perl
常用工具：22/42 就绪（curl、wget、git、ssh、openssl、tar、unzip…）
能力：capEff=0000000000000000 · seccomp=2 · ptrace=unknown
设备：DSHA 桥接令牌在位 · /app/device 可达 · adb-shell /root/dsh-bin/adb-shell
领域就绪：0/39 个域 ≥60% —— 最高：code_eng 2/5 · programming 2/6 …
最缺工具：unpack 缺 diec/upx/unipacker · system_design 缺 k6/docker/prometheus
离就绪最近：stego 0/6 —— zsteg（gem install zsteg） · steghide（apt install steghide outguess）
装工具用：apt-get install -y（Debian 系，装前先 apt-get update）
```

## 11. 已知局限（不要假装它全能）

1. **`capEff=0` 时只能推断**：能力为 0 说明没有任何特权位，但这不等于「什么都做不了」——
   用户态能做的事（静态分析、脚本、容器内的普通操作）照旧。报告只给事实与位图。
2. **Android 兼容层缺文件**：`/proc/1/cgroup`、`/proc/sys/kernel/yama/ptrace_scope` 常读不到，
   容器判定与 ptrace 判定会退化为 `unknown` / `null`，这是如实降级而不是错误。
3. **GUI 程序名不等于命令**：`Cutter`、`StegSolve`、`ChipWhisperer` 这类显示名在 PATH 里查不到，
   就绪度会把它们算成「缺」，从保守方向错——宁可低估。
4. **网络探测有噪声**：包源可达不等于认证/限流没问题；`online` 只表示「TCP 连得上」。
5. **不识别硬件**：除了 DSLR/射频/串口这类设备节点之外，物理设备（示波器、CAN 卡、固件芯片）
   一律探测不到，报告里不会假装知道。
6. **`versions:false` 时版本字段为 `null`**：调用方若需要版本敏感的判断（frida/内核模块），
   必须显式要求版本。

## 12. 扩展点

- **加一层**：在 `probeEnv` 的 `layers` 集合里加名字，写一个 `probeXxx()` 返回
  `{ xxx, notes }`，并在 `renderEnvSummary` 里加一行。任何层抛错都会被收进 `notes`。
- **加探测目标**：改 `NET_TARGETS`（公共基础设施）或 `RUNTIME_BINS` / `COMMON_BINS` / `PACKAGE_MANAGERS`。
- **Windows/macOS**：`shape.platform` 已区分；`which` 在 win32 上走 `where`，包管理器建议走
  `packageManagerAdvice` 的 darwin/win32 分支。其余层在非 Linux 上多数会如实降级为 `null`。
- **领域就绪度换数据源**：`domainReadiness(rows, toolchains)` 的第二个参数可直接换成别的
  `{id: [lines]}` 结构，不必改实现。

## 13. 自检

`node scripts/verify_env.mjs` —— 离线、无依赖、不做出网请求（网络层用假 socket / 假 lookup 注入）。
覆盖：纯函数（`parseKeyValueFile` / `parseProcStatus` / `parseLimitBytes` / `binsOfToolLine` /
`domainReadiness` / `packageManagerAdvice` / `renderEnvSummary`）、形状契约（schema 常量、
层集合、导出名）、**只读保证**（源码里不出现 `writeFileSync`/`unlink`/`chmod`/`apt install` 等写操作，
`out` 除外）、超时保证（每个 execFile 都带 timeout）、隐私保证（不出现 `~/.ssh`、`~/.aws`）、
报告结构（`probeEnv({layers:[...]})` 各层字段齐全、`notes` 是数组、`summary` 非空）、
以及性能预算（`--fast --no-net` 在阈值内完成）。
