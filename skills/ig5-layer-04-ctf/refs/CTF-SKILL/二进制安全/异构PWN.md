# 架构 PWN (Architecture PWN)

## 概述

架构 PWN 指针对非 x86/x64 体系结构的二进制漏洞利用技术。虽然 x86/x64 是 CTF PWN 中最常见的平台，但随着物联网设备、嵌入式系统、移动设备的普及，ARM、MIPS、PowerPC、RISC-V 等架构的题目出现频率日益增加。

不同架构在指令集、寄存器约定、系统调用接口、内存模型、ABI（应用程序二进制接口）等方面存在显著差异。掌握多架构的利用技巧，是成为一名全面 PWN 选手的必经之路。

---

## 常见攻击/分析手法

### 1. ARM-PWN (ARM 32-bit)
ARM 是最常见的嵌入式架构，分为 ARM 模式（4 字节指令）和 Thumb 模式（2 字节指令）。

**基本特点**:
- **寄存器**: R0-R15，其中 R13=SP、R14=LR（链接寄存器）、R15=PC。
- **参数传递**: R0-R3 用于函数参数，R0 用于返回值。
- **栈结构**: 函数调用时 LR 保存返回地址，通常需要在序言中保存 LR 到栈上。
- **系统调用**: 使用 `SWI`（Software Interrupt）或 `SVC` 指令，系统调用号在 R7 中。

**利用要点**:
- 栈溢出: 覆盖 LR + PC（ARM 模式下），Thumb 模式下需要额外注意指令对齐（PC 最低位必须为 0）。
- ROP: 搜索 `pop {r0, pc}` / `pop {r0-r3, pc}` / `blx` 等 gadget。
- **Ret2libc**: 需先获取 libc 基址，ARM 的 ASLR 实现与 x64 类似。
- **Shellcode**: ARM 和 Thumb 指令混合使用，经典 execve shellcode 约 30-50 字节。
- **mprotect**: ARM 上通常需要通过系统调用来修改内存权限（VMA 操作）。
- **满减栈/空增栈**: ARM 通常使用满减栈（Full Descending）。

**常见 CTF 模式**: 使用 qemu-arm 模拟执行 ARM 二进制文件。

### 2. AArch64-PWN (ARM 64-bit)
AArch64 是 ARM 的 64 位指令集，广泛应用于现代手机、服务器和嵌入式设备。

**基本特点**:
- **寄存器**: X0-X30 + SP + PC，其中 X30=LR。
- **参数传递**: X0-X7 用于参数，X0 返回。
- **系统调用**: 使用 `SVC #0` 指令，系统调用号在 X8 中。
- **指令长度**: 固定 4 字节（无 Thumb 模式）。

**利用要点**:
- 栈溢出: 覆盖 X30（LR）+ SP 或其他寄存器组合。
- ROP gadget: `LDP x0, x1, [sp], #offset; RET` 或 `LDR x0, [sp]; RET`。
- **PAC (Pointer Authentication)**: 现代 ARMv8.3+ 支持指针签名，使篡改返回地址变得困难。
- **BTI (Branch Target Identification)**: 限制间接跳转的目标地址。
- **系统调用**: execve = #221 (X8)，write = #64，mprotect = #226。
- **利用链**: 通常需要先调用 `mprotect` 使堆/栈可执行，再跳转到 Shellcode。

### 3. MIPS32-PWN (MIPS 32-bit)
MIPS 是经典的 RISC 架构，广泛应用于路由器、嵌入式设备。字节序有小端（MIPSel）和大端（MIPSeb）两种。

**基本特点**:
- **寄存器**: $zero, $at, $v0-$v1, $a0-$a3, $t0-$t9, $s0-$s7, $k0-$k1, $gp, $sp, $fp, $ra。
- **参数传递**: $a0-$a3 用于参数，$v0 返回值。
- **系统调用**: 使用 `syscall` 指令，系统调用号在 $v0 中。
- **指令长度**: 固定 4 字节。
- **延迟槽 (Delay Slot)**: 分支/跳转指令后的指令在跳转前一定会执行，这是 MIPS 的核心特性。

**利用要点**:
- **栈溢出**: 覆盖 $ra（返回地址寄存器）。
- **ROP chain**: 需要处理延迟槽——在寻找和排列 gadget 时必须额外注意。
- **syscall 构造**: execve = 4011（$v0），$a0 = "/bin/sh"，$a1 = 0，$a2 = 0。
- **Shellcode**: 尽量避免使用空字节，可通过 `addiu`/`subu`/`xor` 等指令构造。
- **字节序**: 大端和小端的 payload 构造方式完全相反，必须先确认目标字节序。
- **缓存一致性（Cache Coherency）**: MIPS 的指令缓存和数据缓存是分离的（Harvard 架构），写 Shellcode 后可能需要 `cache` 指令刷新缓存或使用特定内存映射区域。

### 4. MIPS64-PWN (MIPS 64-bit)
MIPS64 是 MIPS 的 64 位扩展，在部分高端路由器、网络设备和龙芯（Loongson）处理器中使用。

**基本特点**:
- 寄存器扩展为 64 位（$v0 等保持名称不变，但宽度为 64 位）。
- 地址宽度为 64 位，利用了 64 位指针和计算。
- 系统调用接口与 MIPS32 类似（系统调用号不同）。

**利用要点**:
- 与 MIPS32 的利用思路相似，但需要考虑 64 位地址和更大的寻址空间。
- 64 位 ROP gadget 的搜索需要 MIPS64 特定的工具和手动分析。
- Shellcode 地址的猜测/泄露范围更大。

### 5. PowerPC-PWN (PPC)
PowerPC 架构曾用于 Macintosh（早期）、IBM 服务器、游戏主机（Xbox 360、PS3）、以及一些嵌入式系统。

**基本特点**:
- **寄存器**: R0-R31 + LR + CTR + SRR0/SRR1 + CR（条件寄存器）。
- **参数传递**: R3-R10 用于参数，R3 返回值。
- **系统调用**: `sc` 指令。
- **栈结构**: 传统的栈帧结构，LR 保存返回地址。

**利用要点**:
- 覆盖 LR 控制返回地址，栈溢出利用方式与 ARM 类似。
- 搜索 `blr`（branch to link register）相关的 gadget。
- PowerPC 的调用约定和栈帧布局较为复杂，需要仔细分析函数序言/尾声。

### 6. RISC-V-PWN
RISC-V 是最新的开源指令集架构，近年来在学术和工业界迅速普及，CTF 题目也开始出现。

**基本特点**:
- **寄存器**: zero, ra, sp, gp, tp, t0-t6, s0-s11, a0-a7。
- **参数传递**: a0-a7 用于参数（被调用者无需保存），a0 返回值。
- **系统调用**: `ecall` 指令，系统调用号在 a7 中。
- **指令长度**: 基础为 2 字节（压缩指令集）/4 字节（标准指令）。

**利用要点**:
- 覆盖 ra（返回地址）实现控制流劫持。
- ROP 链构造: 搜索 `ld ra, offset(sp); addi sp, sp, offset; ret` 等 gadget。
- Shellcode 需要适配 RISC-V 的指令编码。
- 由于 RISC-V 指令集较为精简，gadget 的丰富程度可能不如 x64 或 ARM。
- 当前 RISC-V 工具链（GCC、Binutils）的稳定性可能略低于成熟架构。

### 7. 其他架构 PWN
- **SuperH (SH4)**: 用于部分嵌入式设备（早期 J2ME 手机、Sega Dreamcast）。
- **SPARC**: 前 Sun Microsystems（现 Oracle）的 RISC 架构，Solaris 系统常用。
- **AVR**: Arduino 和部分嵌入式设备使用的 8 位 MCU 架构。
- **Xtensa**: Espressif ESP32 使用的 CPU 架构。
- **z/Architecture (s390x)**: IBM 大型机架构，极少数 CTF 中出现。

对于这些少见架构，基本分析方法与上述架构类似:
1. 理解架构的寄存器模型、指令编码和调用约定。
2. 寻找 GDB + QEMU 支持以进行调试分析。
3. 搜索 gadget 可使用 `ROPgadget`（部分支持）或手动分析。
4. 利用思路: 栈溢出覆盖返回地址 -> ROP/syscall/Shellcode。

---

## 相关工具

| 工具 | 用途 |
|------|------|
| QEMU (user-mode + system-mode) | 多架构模拟执行 |
| GDB (支持多架构) | 跨架构调试 |
| pwntools | 多架构 shellcode 生成、利用框架 |
| ROPgadget | 多架构 ROP gadget 搜索（需 libcapstone 支持） |
| rp++ | 跨平台/跨架构 gadget 搜索 |
| cross-compiler (gcc-arm/gcc-mips/etc) | 交叉编译测试程序和 exp |
| objdump / readelf | 查看不同架构的 ELF 信息 |
| Capstone / Keystone / Unicorn | 指令反汇编/汇编/模拟执行 |
| Shellcraft (pwntools) | 内置多架构 shellcode 模板 |

### 常用跨编译工具链
```bash
# ARM
arm-linux-gnueabi-gcc -o test test.c -static
# AArch64
aarch64-linux-gnu-gcc -o test test.c -static
# MIPS (big endian)
mips-linux-gnu-gcc -o test test.c -static
# MIPS (little endian)
mipsel-linux-gnu-gcc -o test test.c -static
# PowerPC
powerpc-linux-gnu-gcc -o test test.c -static
# RISC-V
riscv64-linux-gnu-gcc -o test test.c -static
```

---

## 防御/对抗建议

- **架构通用防御**: 所有架构都应开启 NX、ASLR、Stack Canary、PIE 等基础保护。
- **ARM 特有**: 启用 PAC（Pointer Authentication）、BTI（分支目标识别）、PAN（Privileged Access Never）。
- **MIPS 特有**: 使用 XN（Execute Never）位，禁用缓存行自动执行。
- **RISC-V**: 启用 Smep / Smap 等效的保护扩展。
- **通用建议**: 尽可能使用最新版本的工具链和 libc；对关键服务进行隔离沙箱化。

---

## 示例/思路

### ARM64 栈溢出 -> mprotect -> shellcode
```python
from pwn import *
context.arch = 'aarch64'

# Step 1: 通过 ROP 调用 mprotect
pop_x0_x1_x2_ret = gadget1  # LDP/ret 组合
mov_x0_sp_blr_x3 = gadget2  # 将 SP 值传给 X0 并跳转

payload  = b"A" * offset    # 填充到 LR
payload += p64(pop_x0_x1_x2_ret)
payload += p64(stack_page)   # x0 = 栈页地址
payload += p64(0x1000)       # x1 = size
payload += p64(7)            # x2 = PROT_READ|WRITE|EXEC
payload += p64(mprotect_svc) # 调用系统调用
payload += p64(shellcode_addr) # 跳转到 shellcode
```

---

## 相关技能

- [内存破坏漏洞](内存破坏漏洞.md)
- [栈漏洞利用](栈漏洞利用.md)
- [堆漏洞利用](堆漏洞利用.md)
- [低级语言分析](../逆向工程/低级语言分析.md)
- [可执行文件逆向](../逆向工程/可执行文件逆向.md)
- [固件分析](../物联网安全/固件分析.md)
