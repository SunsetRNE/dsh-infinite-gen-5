---
name: env-bootstrap
description: 无限五代 在一台陌生/残缺的 Linux 主机上 层：命中 whenToUse 触发词即装载
whenToUse: 在一台陌生 / 残缺的 Linux 主机（含 Android 容器 / aarch64 / 无 CAP 的受限环境）上，
---

# env-bootstrap · 环境探测与工具链重建

## 何时用

- 用户说「恢复环境 / 重新部署编译环境 / 补装 XX 工具链 / 环境坏了」。
- 要在一台**不知道有什么**的机器上装东西 —— 先探后装，别凭记忆猜包名。
- 装完必须给**证据**：不是「已安装」，而是真编译、真跑、真出输出。

## 铁律（每条都有实测代价）

1. **先探后写**：凡涉及机器的事实（内核能力、locale、包源、可用架构），第一步是真调用，拿到字面输出再落笔。
2. **包源决定可用架构**：arm64 机器的 `ports.ubuntu.com` **不提供 amd64**。要 amd64 包必须另加 `[arch=amd64] http://archive.ubuntu.com/ubuntu …`，并给原 deb822 源加 `Architectures: arm64`，否则 `apt update` 会对每个源都试 amd64 并 404。
3. **locale 是隐形的墙**：`LANG` 未设 → JVM 用 ASCII 解路径 → 工作目录含中文就报 `InvalidPathException: Malformed input … ????????????`。装任何 Java 工具前先 `export LANG=C.UTF-8 LC_ALL=C.UTF-8`。
4. **ptrace 分路线**：`PTRACE_TRACEME` 与 `PTRACE_SEIZE` 是两回事。gdb 走 TRACEME 能用；Frida 走 SEIZE，`errno=95 Operation not supported` 就意味着 Frida 注入在这台机器上**架构上不可用** —— 别反复重试，改走 gdb/strace/angr。
5. **/dev/shm 可能不可创建**：Android 容器里 root 也 `mkdir /dev/shm` 会 `Permission denied`。依赖 multiprocessing 信号量的工具（如 ropper）会 `FileNotFoundError`；同功能工具换一个（ROPgadget）。
6. **GUI/Java 类工具的「架构目录」要按它期望的路径放**：Ghidra 找 `Features/Decompiler/os/<os>_<arch>/decompile`；放错目录连日志都不会有（包装脚本根本不被调用）——判据是**包装有没有被执行**，不是有没有报错。
7. **npm 的 allow-scripts 闸门**：`npm i -g` 会跳过依赖的 postinstall（如 esbuild），多数情况不影响运行，但会留告警；`--allow-scripts=<pkg>` 可消音。
8. **每装一件立刻验一件**：`command -v` 只证明装了，不证明能跑。判据用 `--version` + 一次真实调用。

## 五步流程

### 第 0 步 · 探

```bash
# 机器画像：先拿到事实，再决定装什么
infinite_gen5_env          # 宿主探针工具（只读）：OS/arch/uid/资源/网络/包管理器/已装/缺失
uname -a; id; locale; df -h /; free -h | head -2
apt-cache policy <PKG> | head -6      # 包在不在、候选版本是多少
```

### 第 1 步 · 凭据与身份

```bash
# 有备份包就恢复，权限位照抄：目录 700，私钥 600，其余 644
install -d -m 700 ~/.ssh
install -m 600 backup/.ssh/id_ed25519     ~/.ssh/id_ed25519
install -m 644 backup/.ssh/id_ed25519.pub ~/.ssh/id_ed25519.pub
install -m 644 backup/.gitconfig          ~/.gitconfig
ssh -T git@github.com        # 判据：返回 "Hi <user>! You've successfully authenticated"
```

### 第 2 步 · 分层装（顺序固定，层内可并行）

| 层 | 装什么 | 命令 |
|---|---|---|
| L1 系统包 | build-essential / cmake / ninja / binutils / gdb / strace / jq / unzip | `apt-get update && apt-get install -y --no-install-recommends …` |
| L2 运行时 | Python(pip/venv)、Go(tarball)、Rust(rustup)、JDK | 见 `scripts/restore-dev-env.sh` |
| L3 隔离 CLI | pipx / uv / npm -g | `python3 -m pip install --break-system-packages pipx uv` |
| L4 release 件 | Ghidra / jadx / apktool / rizin / frida-server | 一律用 GitHub API 取 `browser_download_url`，别猜文件名 |
| L5 源码构建 | rizin（无 linux 预编译包时） | `meson setup build --prefix=/usr/local --buildtype=release && ninja -C build && ninja -C build install` |

### 第 3 步 · 真验（本步才是交付物）

```bash
bash scripts/verify-env.sh      # 编译链 + 多语言冒烟：真编译真运行
bash scripts/verify-re.sh       # 逆向链：指纹→反汇编→ROP→壳→静态→动态闭环
bash scripts/verify-frida.sh    # 设备/插桩链：版本对齐 + 通道状态 + 本机能力矩阵
```

### 第 4 步 · 记档

把「什么是已知（实测）、什么是推测、什么是未知」分开写进报告；能力上限（例如 SEIZE 不支持）要写进**边界**而不是藏在失败里。

## 本环境的硬上限（照抄结论，省一整轮试错）

见 `references/environment-matrix.md`。摘要：

| 能力 | 本环境 | 替代 |
|---|---|---|
| Frida 注入 | 不可用（`PTRACE_SEIZE` errno=95） | gdb（TRACEME 路线）、strace/ltrace、angr |
| frida-gadget LD_PRELOAD | 段错误 rc=139 | 同上 |
| Ghidra 原生反编译 | 不可用（无 `linux_arm64`，qemu 顶替握手失败） | radare2 `pdc`；或装 rz-ghidra |
| ropper 取 gadget | 崩（无 `/dev/shm` 且建不出来） | ROPgadget（153 条实测） |
| rizin `pdc` | 0.9.1 已移除该命令 | radare2 `pdc` |
| docker/kubectl/BPF | 受限（`capEff=0`） | 用户态等价工具 |

## 反模式（踩过的坑）

- ❌ 猜包名/猜版本号 → ✅ `apt-cache policy` / GitHub API 先查。
- ❌ 装完只看 `command -v` → ✅ 每个工具配一条**真执行**判据。
- ❌ 失败就重试同一条 → ✅ 换证据、换路径；桥/授权类失败只报原话与开关位置。
- ❌ 把「官方支持某架构」当成事实 → ✅ 去它的 `os/` 之类目录里看一眼目录名。
- ❌ 一次调用塞很长的脚本 → ✅ 拆小重发，结果截断按坏包处理。

## 复现

```bash
# 全新机器上一把梭
bash scripts/restore-dev-env.sh --with-go --with-rust --with-jdk
bash scripts/verify-env.sh | tail -4     # 期望 PASS 全过、FAIL=0
```
