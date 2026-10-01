# 其他 PWN 技术 (Other PWN)

## 概述

"其他 PWN 技术"涵盖那些不便于归入传统栈/堆/格式化字符串分类的二进制利用方向。这些技术通常针对特定场景或新兴的攻击面，包括 IO_FILE 结构利用、侧信道攻击、Shellcode 编写、Blind-PWN（盲打）、提权利用、解释器 PWN、沙箱逃逸、VM 逃逸以及浏览器 PWN 等。

随着 CTF 题目的多样化发展，这些"非典型"PWN 技术的出现频率越来越高，尤其是在高阶比赛中往往成为决定性的一题。

---

## 常见攻击/分析手法

### 1. IO_FILE 利用
- **原理**: 通过篡改 glibc 中 FILE 结构体（`struct _IO_FILE`）的成员，劫持文件操作流程，在调用 `fread`/`fwrite`/`fclose`/`exit` 等函数时触发代码执行。
- **关键结构**:
  - `_IO_FILE`: 包含文件描述符、缓冲区指针、函数指针表（vtable）。
  - `_IO_FILE_plus`: 包含 `_IO_FILE` 和 vtable 指针。
  - `IO_validate_vtable`: glibc 2.24+ 引入的 vtable 合法性检测。
- **经典手法**:
  - **FSOP (File Stream Oriented Programming)**: 伪造 FILE 结构体使程序调用 `_IO_overflow` 等虚函数时执行恶意代码。
  - **House of Orange**: 通过堆溢出篡改 `_IO_list_all`，利用 `malloc` 触发 `_IO_flush_all_lockp` 遍历 FILE 链。
  - **__free_hook / __malloc_hook 替代**: 当 hook 被禁用时，利用 IO_FILE 作为替代控制流劫持目标。
  - **vtable 绕过**: 通过伪造 vtable 为 `_IO_wstrn_jumps` 等已知合法 vtable，绕过 `IO_validate_vtable` 检测，同时利用 `_IO_wstr_overflow` 等函数执行写操作。

### 2. 侧信道攻击 (Side-Channel Attack)
- **原理**: 通过观察程序执行的时间、功耗、电磁辐射、缓存行为、声音等物理或逻辑侧信道信息，推导出程序内部状态或敏感数据。
- **PWN 中的侧信道**:
  - **时间侧信道**: 根据密码比较、数组访问、字符串比较的耗时差异推断数据。
  - **缓存侧信道 (Cache Attack)**: Flush+Reload, Prime+Probe, Spectre, Meltdown。
  - **错误信息侧信道**: 根据不同的错误类型或格式推断内部状态。
  - **二进制长度侧信道**: 根据输出长度推断比较进度。
- **CTF 中常见场景**:
  - Blind-PWN 中逐位爆破 Canary/PIE/ASLR。
  - 沙箱中的逐字节比较 oracle 漏洞。
  - 利用 `strcmp`/`memcmp` 的比较次数泄露数据。

### 3. Shellcode 编写
- **原理**: 编写一段机器码（Shellcode）在目标进程中执行，通常用于获取 shell、执行系统命令或提权。
- **要求**: "短小精悍"——需要在极小的空间（几十到几百字节）内完成预定功能。
- **经典技巧**:
  - 使用 `push` 和 `mov` 构造参数，避免字符串中的空字节（`\x00`）。
  - 使用 `jmp-call-pop` 技术获得字符串地址。
  - 使用 `xor reg, reg` 清零寄存器而非 `mov reg, 0`。
  - 使用 `shl`/`shr` 消除空字节。
  - 系统调用封装: execve("/bin/sh", NULL, NULL) = syscall 59 (x64)。
  - **多架构**: x86、x64、ARM、MIPS、PowerPC、RISC-V 各有不同的系统调用约定和机器码。
  - **编码器**: 使用 alphanumeric shellcode、decoder stub 绕过字符限制过滤器。

### 4. Blind-PWN (BROP)
- **原理**: Binary ROP (BROP)——在没有目标二进制文件的情况下，通过反复连接目标并观察程序的崩溃/响应模式，逐步提取信息并构建 ROP 链。
- **步骤**:
  1. **泄露栈长度**: 通过逐渐增加输入的偏移量，确定覆盖返回地址所需长度。
  2. **寻找 Stop Gadget**: 定位不会致崩的地址（如 `main` 函数入口或无限循环）。
  3. **寻找 BROP Gadget**: 爆破寻找 `pop rdi; ret` 等关键指令片段。
  4. **读取 GOT / PLT**: 利用找到的 gadget 调用 `write` / `puts` 泄露 GOT 条目，推断 libc 版本。
  5. **构建完整利用**: 根据泄露的 libc 地址计算 system/execve/one-gadget。
- **工具**: bropwn 自动化框架。

### 5. 提权利用 (Privilege Escalation)
- **场景**: 在已经获得低权限 shell 的基础上，利用内核漏洞、setuid 程序、能力（Capabilities）、命名空间配置错误等手段提升至 root 权限。
- **CTF 中常见**:
  - 内核 PWN 题中获得 root shell（详见 [内核漏洞利用](Linux内核漏洞利用.md)）。
  - SUID 辅助程序中的漏洞（栈溢出、格式化字符串、环境变量注入等）。
  - Docker 容器中通过 `--privileged` 模式或挂载 `/var/run/docker.sock` 逃逸到宿主。

### 6. 解释器 PWN (Interpreter PWN)
- **原理**: Python、Lua、JavaScript、PHP 等解释器中存在原生代码（C/C++ 实现部分）的漏洞。
- **常见目标**:
  - Python: `PyObject` 的 UAF/溢出（如 `ctypes` 滥用）、`eval/exec` 沙箱逃逸。
  - Lua: `lua_rawgeti`/`lua_pushstring` 等 C API 的越界操作、注册表操作。
  - JavaScript (V8): JIT 优化错误导致的类型混淆（TurboFan 漏洞）。
  - PHP: `zval` 结构体操作、`php_stream` 利用。
- **特点**: 通常需要在脚本语言层面构造原语，再触发解释器内部的原生代码漏洞。

### 7. Sandbox Escape (沙箱逃逸)
- **原理**: 突破 seccomp、pledge、capsicum、AppArmor、SELinux 等沙箱机制，恢复进程的完整执行能力。
- **seccomp 逃逸**:
  - 绕过黑名单策略: 使用未禁止的系统调用完成同等功能（`openat` 替代 `open`、`execveat` 替代 `execve`）。
  - 禁用位错误: 篡改 `seccomp_filter` 的 BPF 规则（需要内核级写原语）。
  - 二次利用: 通过 ptrace 向未受沙箱限制的子进程注入代码。
  - 文件描述符传递: 通过 Unix socket 传递未受限制的 fd。
- **分析工具**: `seccomp-tools` 查看沙箱规则。

### 8. VM Escape (虚拟机逃逸)
- **原理**: 从 QEMU、VMware、VirtualBox 等虚拟机中逃逸到宿主机。
- **CTF 场景**:
  - QEMU PWN: 攻击 QEMU 设备模拟中的漏洞（如网卡、显卡、USB 控制器）。
  - VM 中的内核漏洞结合 QEMU 的 MMIO/PIO 接口。
  - VMware Guest-to-Host 利用（较罕见，多见于 Pwn2Own）。

### 9. Browser PWN (浏览器 PWN)
- **原理**: 利用浏览器（Chrome/Firefox/Safari/Edge）及其渲染引擎中的漏洞实现远程代码执行。
- **常见组件攻击面**:
  - V8 (Chrome JS 引擎): JIT 编译器的类型混淆、数组越界、Promise 相关漏洞。
  - SpiderMonkey (Firefox JS 引擎): 类似 V8 的 JIT/GC 相关漏洞。
  - WebKit (Safari): JavaScriptCore 引擎 + 渲染层漏洞。
  - Blink 渲染引擎: DOM 操作相关的 UAF、CSS 解析漏洞。
- **利用链构成**:
  1. **Renderer RCE**: 通过 JS 引擎漏洞获得渲染进程的代码执行。
  2. **Sandbox Escape**: 通过浏览器内核漏洞（IPC 层、Mojo 接口等）从沙箱中逃逸。
  3. **系统级利用**: 最终在用户系统上执行任意代码。

---

## 相关工具

| 工具 | 用途 |
|------|------|
| pwntools | Shellcode 编码、BROP 自动化、通用 PWN 框架 |
| seccomp-tools | 查看/分析沙箱 seccomp 规则 |
| one_gadget | 查找 libc 中的 one_gadget |
| shellcraft (pwntools) | 多架构 Shellcode 生成 |
| V8 编译调试版 | V8 PWN 中的调试与分析 |
| QEMU | 多架构模拟、VM Escape 题目调试 |
| bropwn | BROP 自动化工具 |

---

## 防御/对抗建议

- **IO_FILE**: glibc 2.34+ 移除了 `__malloc_hook`/`__free_hook`/`__realloc_hook`，但 IO_FILE 攻击面依然存在；建议开启 `_IO_FLAGS2_FORTIFY` 标志增强 FILE 结构体的完整性检查。
- **侧信道**: 使用恒定时间比较函数（如 `memcmp_consttime`）；禁用超线程（缓解缓存侧信道）；对错误信息做统一格式处理。
- **Shellcode**: 使用 W^X 内存页策略；启用 MPROTECT 限制内存权限变更；使用 ROP 替代 Shellcode 调用路径。
- **沙箱**: 使用白名单而非黑名单策略；谨慎开放 `ptrace`/`personality` 等危险系统调用。
- **浏览器**: 启用站点隔离（Site Isolation）；及时更新 V8/renderer 组件的安全补丁；强化沙箱策略。

---

## 相关技能

- [内存破坏漏洞](内存破坏漏洞.md)
- [栈漏洞利用](栈漏洞利用.md)
- [堆漏洞利用](堆漏洞利用.md)
- [内核漏洞利用](Linux内核漏洞利用.md)
- [代码注入](../逆向工程/代码注入.md)
