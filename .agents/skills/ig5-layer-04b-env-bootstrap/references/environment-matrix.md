# 环境能力矩阵（本机实测，2026-09-30 核）

主机：Ubuntu 24.04.3 LTS (noble) · aarch64 · 内核 6.1.141-android14-11（Android 容器内）· uid=0(root) · capEff=0000000000000000

## 1. 内核/容器能力

| 能力 | 实测 | 命令 | 后果 |
|---|---|---|---|
| `PTRACE_TRACEME` | 可用 | `ptrace(PTRACE_TRACEME)` → rc=0 | gdb 正常，可下断点、看参数、`finish` |
| `PTRACE_SEIZE` | **不可用** errno=95 | `ptrace(PTRACE_SEIZE,p,0,0)` → rc=-1 | Frida 注入路线整体不可用 |
| `PTRACE_ATTACH` | 不可用 errno=1 | 同上 | 不能 attach 已运行进程 |
| `PTRACE_CONT` | 可用 rc=0 | 同上 | — |
| `/dev/shm` | 不存在且**不可创建**（root 也 Permission denied） | `mkdir /dev/shm` | ropper 等 multiprocessing 工具崩 |
| `capEff` / `capBnd` | 0000000000000000 | `/proc/self/status` | 无 CAP_SYS_ADMIN/CAP_NET_ADMIN/CAP_BPF：docker、tun/tap、原始套接字受限 |
| seccomp | 2（filter） | — | 部分 syscall 被拦 |
| locale | `LANG` 未设、`LC_CTYPE=POSIX`，可用 `C.utf8` | `locale -a` | JVM 以 ASCII 解路径，中文目录必炸 |

## 2. 包源

| 源 | 内容 | 结论 |
|---|---|---|
| `ports.ubuntu.com/ubuntu-ports` | arm64 等非 amd64 架构 | **不含 amd64**，对它查 `binary-amd64` 一定 404 |
| `archive.ubuntu.com/ubuntu` | amd64 / i386 | 装 `libc6:amd64` 一类必须加 `deb [arch=amd64]` 并给原 deb822 源加 `Architectures: arm64` |

deb822 文件位置：`/etc/apt/sources.list.d/ubuntu.sources`（不是 `sources.list`）。

## 3. 工具逐个结论

| 工具 | 结论 | 判据 |
|---|---|---|
| gcc/g++ 13.3.0、make 4.3、cmake 3.28.3、ninja 1.11.1、binutils 2.42 | 可用 | C（链 zlib+OpenSSL 实算 SHA256）、C++17、CMake+Ninja 全流程构建通过 |
| Go 1.27.1 / Rust 1.98.1 / OpenJDK 21.0.12.1 / Node 24.19.0 / Python 3.12.3 | 可用 | 各自真编译真运行 |
| rizin 0.9.1 | 可用（源码构建） | `aa; afl` 出函数表；**无 `pdc`** |
| radare2 5.5.0 | 可用 | `pdc` 产出伪 C |
| Ghidra 12.1.4 | Java 侧可用，**原生反编译不可用** | headless 分析 `/bin/ls` 24s 成功；`os/` 只有 `linux_x86_64`、`win_x86_64` |
| gdb 15.1 / gdb-multiarch | 可用 | 断点命中 + `info args` + `finish` 返回值 |
| angr 10.0.1 | 可用 | 解出 crackme 口令并真跑复验；注意 `claripy` 需走 `angr.claripy` |
| ROPgadget 7.7 | 可用 | aarch64 目标 153 条 unique gadget |
| ropper 1.13.13 | **不可用** | `multiprocessing.SemLock` → `FileNotFoundError`（/dev/shm） |
| one_gadget 1.10.0 | 可用 | gem 装成 |
| upx 4.2.2 | 可用 | pack→unpack sha256 一致 |
| patchelf 0.18.0 / yara 4.5.0 / LIEF 1.0.0 / capstone 5.0.7 | 可用 | 各自真跑判据 |
| frida 17.19.0 | CLI/py 可用；**本机注入不可用** | `NotSupportedError: unable to perform ptrace seize` |
| frida-gadget 17.19.0 linux-arm64 | **不可用** | LD_PRELOAD → SIGSEGV rc=139（script/listen 两模式均崩） |
| jadx 1.5.6 / apktool 3.0.3 | 可用 | `--version` |
| qemu-user-static 8.2.2 | 可用 | 可启动 x86_64 ELF |

## 4. Ghidra 反编译完整证据链（本环境最重要的一条）

1. 官方 zip 的 `Ghidra/Features/Decompiler/os/` 只有 `linux_x86_64`、`win_x86_64`。
2. 首次运行崩溃根因 = locale（不是架构）：`InvalidPathException: Malformed input … /root/????????????`。`LANG=C.UTF-8` 后正常启动。
3. 反编译调用 → `DECOMP_COMPLETED=false` / `DI_OPEN=false`，报 `Unable to create decompiler for program`。
4. 替换 `os/linux_x86_64/decompile` 为 qemu 包装 → **包装完全没被调用**（日志文件不存在）→ 证明那是错的路径。
5. 建 `os/linux_arm_64/decompile`（同一 qemu 包装）→ **包装被调用了**（日志出现 `ARGS:`）→ 路径定位成功。
6. 装 amd64 运行库后 qemu 下反编译器启动并回写 26 字节握手，Ghidra 仍拒绝创建 → **qemu 顶替判负**。
7. 结论：反编译改走 radare2 `pdc`；Ghidra 用于反汇编/自动分析/脚本。

## 5. 设备通道（DSHA）

| 端点 | 实测 | 说明 |
|---|---|---|
| `/app/version`、`/app/device`、`/app/help` | HTTP 000（连不上） | 老版本 App 会把未知路径当 shell 命令；桥不通时**不要反复重试** |
| `adb-shell <cmd>` | `EXECUTION_UNKNOWN: 设备桥响应不完整…（URLError）` `[EXIT=125]` | 原话照录，去 App「设置 → 设备能力授权」查开关 |
| frida-server 17.19.0 android-arm64 | 已备好并核指纹 | `sha256 5e048e8b…2ae9`，59071912 字节，`interpreter /system/bin/linker64` |

## 6. 其他一次性结论

- `npm i -g` 的 `allow-scripts` 闸门会跳过依赖 postinstall（esbuild 告警），`--allow-scripts=<pkg>` 消音。
- rizin 官方 release **没有通用 linux 预编译包**（只有 android/macos/windows/static-x86_64），Linux 上要源码构建。
- 官方 zip 解包后目录名可能与 `ls -d rizin-*` 猜测不符（实际为 `rizin-v0.9.1`），先 `find -maxdepth 2 -name meson.build` 定位。

## 附：本仓库（DSH / 中文工作区）实测补充（2026-09-30）

| 现象 | 判据（复现命令） | 处置 |
|---|---|---|
| 中文路径下自检脚本**静默空转**（exit 0、无输出） | `node scripts/gen_tool_docs.mjs --write` 在 `/root/仓库合集/…` 下无输出；在 ASCII 路径下打印 `TOOLS DOC WROTE …` | 脚本用 `import.meta.url === file://${argv[1]}` 判定主模块，中文路径被百分号编码后永不相等。要么在 ASCII 路径跑，要么把 `argv[1]` 设成编码后的绝对路径 |
| `tools:doc` 一次只补一份文档 | 连跑两次，第二次才报 `过期=无` | 生成后必须跑到注册表自检绿为止，不要「跑一次就提交」 |
| 生成文档内嵌「文档首行摘要」 | `docs/INDEX.md` 里 `UPDATE.md` 那行摘要 | 必须先改 UPDATE/VERSIONS，**再**跑 `tools:doc`，顺序反了 CI 必红 |
| 假渲染器与真机行为不一致 | `react.Fragment(...)` 在假渲染器里可调用，真机抛 `TypeError` | 自检通过 ≠ 真机可用；用 `!SRC.includes("react.Fragment(")` 这类不变量断言兜住 |
| 版本门禁被 vendored 文件撞掉 | `verify:version` 报「未登记的版本号字面量」，位置在 `skills/**/references/**` | 第三方报告里的版本串是巧合，换一个版本号最省事；或登记锚点 |
| 统计库落盘位置与顶层键 | `python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.dsh/infinite-gen-5-stats.json')));print(list(d)[:6])"` | `counters` 是顶层键，`counters.hits.*` 为累计计数；面板读它做「跨重启累计」 |
| `unzip` 在 POSIX locale 下转义文件名 | 解出的文件名叫 `#U4ed3#U5e93#…` | `LC_ALL=C.UTF-8 unzip …`，解完用 CRC 复核 |
