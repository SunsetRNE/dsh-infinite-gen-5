# 内核漏洞利用 (Kernel Exploit)

## 概述

内核漏洞利用（Kernel Exploitation）是 PWN 技术的高阶领域，目标是提升权限（从普通用户到 root）或突破内核沙箱限制。与用户态 PWN 不同，内核利用直接与操作系统内核交互，涉及更复杂的上下文、更多的保护机制以及更严格的触发条件。

CTF 中的内核题目通常以 Linux 内核模块（LKM）的形式提供，选手需要分析模块中的漏洞（常为伪字符设备驱动 `/dev/<name>`），编写 exploit 实现提权。近年来，随着 Android 内核、macOS XNU 内核、Windows 内核等题目类型的增加，内核 PWN 的范畴也在不断扩大。

---

## 常见攻击/分析手法

### 1. 内核堆风水 (Kernel Heap Fengshui)
- **原理**: 与用户态堆利用类似，内核堆管理（slab/slub/slob 分配器）也涉及分配、释放、重用等操作。通过精心控制内核对象的分配与释放顺序，使漏洞利用所需的对象出现在期望的位置。
- **关键对象**: `msg_msg`（消息队列）、`tty_struct`、`pipe_buffer`、`file` 结构、cred 结构、`timerfd_ctx`、`epoll` 相关结构、`setxattr`/`getxattr` 数据等。
- **常用技巧**:
  - 利用 `msg_msg` 跨越堆块读取越界数据。
  - 利用 `setxattr` 中用户控制的 `value` 作为堆喷射载体。
  - 利用 `add_key` 系统调用分配可预测大小的内核对象。
  - **跨 cache 攻击**: 利用特定大小的分配将目标对象与漏洞对象置于同一 slab cache 中。

### 2. 内核 Heap Spray (Kernel Heap Spray)
- **原理**: 通过大量分配内核对象来填充内核堆，提高漏洞利用的可靠性。
- **常用喷射对象**:
  - `msg_msg` + `msg_msgseg`: 通过 `msgsnd` 系统调用发送大量消息，每个消息在内核中分配 `msg_msg` 结构。
  - `socket` + `sendmsg`: 通过构造特殊的 `struct iovec` 分配内核内存。
  - `add_key` / `keyctl`: 密钥管理相关的系统调用可以分配可控内容的内核内存。
  - `setxattr`: 扩展属性操作可以在内核中分配指定大小的内存块。
- **目的**: 覆盖漏洞对象后的内存、布置伪造的数据结构、提高漏洞触发的确定性。

### 3. 内核 UAF (Kernel Use-After-Free)
- **原理**: 内核对象释放后仍保留指向它的指针（悬空指针），通过其他途径重新分配该内存区域并填充攻击者控制的数据。
- **常见场景**:
  - 文件操作并发: 一个线程释放文件对象，另一个线程仍通过 fd 操作该文件。
  - 引用计数错误: 对象的引用计数未正确维护，导致提前释放。
  - `ioctl` 释放后使用: 一次 ioctl 释放对象，后续 ioctl 仍使用释放后的指针。
- **利用步骤**:
  1. 触发 UAF，释放目标内核对象。
  2. 分配另一个大小相同且内容可控的内核对象（如 `msg_msg`、`setxattr` 数据），"填补"释放的内存。
  3. 通过原悬空指针读取或修改伪造的对象内容。
  4. 利用伪造的数据提权（如修改 cred 结构）。

### 4. 内核 ROP (Kernel ROP)
- **原理**: 劫持内核控制流（如修改函数指针、返回地址），在内核态执行 ROP 链，实现 commit_creds(prepare_kernel_cred(0)) 或其他提权操作。
- **内核态汇编差异**: 内核态不能直接调用用户态函数，需要找到 `commit_creds` 和 `prepare_kernel_cred` 在内核中的地址。
- **KASLR 绕过**: 需要泄露内核基址以计算内部函数地址。常用泄露手段包括:
  - `dmesg` 泄露（不适用于 CTF 默认关闭的情况）。
  - 侧信道泄露（如 `ktimer` 相关接口）。
  - 特定漏洞信息泄露。
  - 利用 `/proc/kallsyms`（需要 root，不适用）。
- **常用 gadget**: `pop rdi; ret` / `mov rdi, rax; ... / swapgs; ret` / `iretq` 等。
- **返回用户态**: 内核 ROP 链的最后需要执行 `swapgs` + `iretq` 返回用户态，并设置用户态的 shell 代码。

### 5. Bypass 内核保护机制
内核保护比用户态更加严格，常见保护及绕过方法:

| 保护机制 | 描述 | 绕过方法 |
|----------|------|----------|
| **SMEP** | 禁止内核执行用户态代码 | 使用 ROP 而非直接跳转用户态 Shellcode；修改 CR4 寄存器清除 SMEP 位 |
| **SMAP** | 禁止内核访问用户态数据 | 使用内核堆上的数据而非用户态传递的指针；临时禁用 SMAP（同 CR4 操作） |
| **KASLR** | 内核地址随机化 | 通过信息泄露获取内核基址；利用 `ret2dir`（物理页映射）绕过 |
| **Stack Canary** | 内核栈溢出检测 | 泄露 Canary；直接覆盖 cred 结构而非构造 ROP；利用非栈漏洞 |
| **CFI** | 控制流完整性 | 寻找不影响 CFI 的利用路径；绕过 LTO-CFI、eBPF 验证器等 |
| **KPTI** | 内核页表隔离 | 使用 KPTI trampoline（`swapgs; ret`）恢复用户态页表 |
| **SELinux / AppArmor** | 强制访问控制 | 提权后绕过 LSMMod；禁用 SELinux |
| **Kernel Heap Mitigation** | 堆加固（如 `CONFIG_SLAB_FREELIST_HARDENED`） | 利用更复杂的堆操作绕过 |

**典型提权 ROP 链**:
```asm
pop rdi; ret
0                           ; prepare_kernel_cred(0)
prepare_kernel_cred         ; 获取 root 凭证
pop rdi; ret
rax (cred)                  ; 将返回的 cred 传给 commit_creds
commit_creds
swapgs; ret                 ; 恢复 GS 寄存器
0                           ; (iretq 需要)
ret; ret                    ; 对齐
user_shell_addr             ; 用户态 shell 入口
user_cs                     ; 用户态代码段
user_rflags                 ; 用户态标志寄存器
user_sp                     ; 用户态栈指针
user_ss                     ; 用户态栈段
```

### 6. Double Fetch 漏洞
- **原理**: 内核从用户态内存读取数据时（如通过 `copy_from_user` 或直接解引用用户空间指针），如果两次读取之间存在时间差，用户态进程可以利用竞争条件修改该内存区域的内容。
- **典型场景**:
  - 驱动首先检查用户传入数据的大小/边界（第一次读取）。
  - 检查通过后再次读取数据进行处理（第二次读取）。
  - 攻击者在两次读取之间通过另一个线程修改内存，使检查与实际处理的数据不一致。
- **利用手法**:
  - 在检查阶段传入合法数据，处理阶段替换为恶意数据。
  - 利用 **userfaultfd**（新内核中有限制）或 **Futex** 操作精确控制时序。
  - 使用 **seccomp** 配合特定系统调用来暂停/恢复内核执行。
- **常见场景**: 内核驱动中的 size/len 检查 + 后续实际拷贝。

---

## 相关工具

| 工具 | 用途 |
|------|------|
| QEMU | 运行/调试内核（通过 `-gdb`） |
| GDB + pwndbg | 内核模块调试、查看内核数据结构 |
| pwntools | 编写 exploit，控制交互 |
| extract-vmlinux | 从 bzImage 提取 vmlinux |
| vmlinux-to-elf | 恢复 KASLR 之后的符号 |
| Kernel EXP 模板 | 常见的 setup（mmap/dev/open）模板 |
| Syzkaller | 内核 fuzzing |
| KGDB | 内核远程调试 |
| ret2dir | 物理页映射绕过 KASLR 的利用框架 |

### 常用内核 exploit 模板文件
- **exploit.c**: 通常包含 `open("/dev/vuln")` + `ioctl` 触发漏洞 + `mmap` 配置 + `fork` 多线程竞争。
- **常用的编译命令**:
  ```bash
  gcc -static -o exploit exploit.c -lpthread -masm=intel
  ```

---

## 防御/对抗建议

- **内核加固选项**: 启用 `CONFIG_STACKPROTECTOR`、`CONFIG_SLAB_FREELIST_HARDENED`、`CONFIG_RANDOMIZE_KSTACK_OFFSET`、`CONFIG_CFI_CLANG` 等。
- **KASLR** 默认开启，并配合 KPTI、KASan 使用。
- **减少攻击面**: 移除不必要的内核模块；限制 `/dev/mem`、`/proc/kcore` 等敏感接口的访问。
- **使用 eBPF 验证器**: 限制 eBPF 程序能力，防止利用 eBPF 进行内核漏洞利用。
- **userfaultfd 限制**: 新内核中添加了 `CAP_SYS_PTRACE` 限制。
- **CR4 pinning**: 防止通过 ROP 修改 CR4 寄存器中的 SMEP/SMAND 位。

---

## 示例/思路

### 内核 UAF 提权思路
```
1. 前提: 内核驱动中存在一个漏洞 ioctl，可以释放某个内核对象但仍保留全局指针
2. Step 1: 触发释放，产生悬空指针
3. Step 2: 调用 add_key / sendmsg / setxattr 分配可控内核对象填充分配的内存
4. Step 3: 通过悬空指针读取修改后的对象，确认已控制内核对象
5. Step 4: 在伪造的对象中设置函数指针指向 ROP gadget 或布置提权数据
6. Step 5: 触发内核调用该函数指针，执行提权 ROP 链
7. Step 6: commit_creds(prepare_kernel_cred(0)) + swapgs; iretq 返回用户态 shell
```

### 基于 msg_msg 的信息泄露
```c
// 利用 msg_msg 结构溢出读取相邻 slab 对象中的指针
struct msg_msg {
    struct list_head m_list;
    long m_type;
    size_t m_ts;
    struct msg_msgseg *next;
    void *security;
    // 消息数据紧跟其后...
};
// 通过溢出或 UAF 将 msg_msg 的长度改大，后续 msgrcv 可读取越界数据
```

---

## 相关技能

- [内存破坏漏洞](内存破坏漏洞.md)
- [其他类型PWN](其他类型PWN.md)
- [栈漏洞利用](栈漏洞利用.md)
- [堆漏洞利用](堆漏洞利用.md)
- [逆向分析基础](../逆向工程/逆向分析基础.md)
