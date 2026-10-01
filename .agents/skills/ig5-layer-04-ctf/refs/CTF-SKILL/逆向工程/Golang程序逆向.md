# Golang 逆向 (Golang Reversing)

## 概述

Go 语言（Golang）是由 Google 开发的开源编程语言，以其简洁的语法、高效的并发模型（goroutine/channel）和静态链接的编译方式而著称。Go 语言编译的程序通常具有以下特点: 静态链接、内置 runtime、独特的调用约定、丰富的符号信息。

由于 Go 语言的流行，CTF 中 Go 程序的逆向题目越来越多。Go 程序的逆向与传统的 C/C++ 程序有显著差异，需要理解 Go runtime 的结构和 Go 特有的语言特性。

---

## 常见分析手法

### 1. Go 程序特征识别
**文件特征**:
- 静态链接生成巨大的可执行文件（通常 2MB - 20MB+）。
- 导入了大量 `runtime.*` 符号。
- 编译信息在 `.gopclntab` / `.go.buildinfo` 段中。
- 使用 `readelf -a` 可以查看到大量带有 `go` 前缀的符号。

**字符串存储方式**:
- Go 字符串不是以 `\0` 结尾的 C 风格字符串，而是 **长度前缀** 结构: `(data pointer, length)`。
- 在 IDA 中显示为 ASCII 字符串但长度可能混乱。可使用 IDA 的 `GoString` 插件辅助识别。
- 字符串常量存储在 `.rodata` 段中，但通常聚集在一起。

**调用约定 (Calling Convention)**:
- **Go 不使用标准 C ABI**。
- Go 函数通过栈传递所有参数，而非寄存器。
- 返回地址通过栈传递（`RET` 指令从栈上弹出返回地址，但无 `call`/`ret` 配对）。
- Go 的汇编函数（`TEXT` 定义）使用 `NOSPLIT` 和 `WRAPPER` 等标记。
- **关键区别**: Go 的 `call` 指令并不像 C 那样隐式 push 返回地址——Go 的调用约定将返回地址放在栈上的特定位置。

**goroutine 和栈管理**:
- Go 的 goroutine 初始栈很小（通常 2KB-8KB），按需增长。
- 栈溢出检测通过 `stackguard` 实现，在函数序言中检查栈空间。
- 多个 goroutine 共享同一个地址空间，栈非连续但通过 runtime 管理。

### 2. Go 符号恢复
Go 程序在编译时默认包含丰富的调试信息和符号，但新版本的 Go 默认启用符号剥离。

**源符号获取途径**:
- **DWARF 调试信息**: Go 可执行文件中嵌入 DWARF 调试信息（除非使用 `-ldflags="-s -w"` 剥离）。
- **`.gopclntab` 段**: Go 程序的 PC/Line 映射表，包含函数地址到名称的映射。
- **函数名称**: 未经 Strip 的情况下，IDA 可看到所有 Go 函数名（包括 `main.main`、`main.checkPassword` 等）。

**符号恢复工具**:

| 工具 | 说明 |
|------|------|
| **GoReSym** | 最常用的 Go 符号恢复工具，可从 Go 可执行文件中提取函数符号、类型信息 |
| **Redress** | 基于 GoReSym 的符号恢复 + 重命名工具 |
| **IDAGolangHelper (golang_loader_assist)** | IDA Python 插件，加载 Go 符号、恢复类型 |
| **golang_rename** | IDA 插件，重命名 Go 函数名 |

**使用 GoReSym 恢复符号**:
```bash
# 提取符号信息
GoReSym -t target_binary

# 生成 IDA Python 脚本，用于在 IDA 中恢复符号
GoReSym -t target_binary -o restore.py
```

### 3. Go 特有结构识别

**interface / eface / iface**:
- `eface` (empty interface `interface{}`): `{type *Type, data unsafe.Pointer}`。
- `iface` (non-empty interface): `{tab *itab, data unsafe.Pointer}`。
- `itab`: `{inter *interfacetype, _type *_type, hash uint32, _ [4]byte, fun [1]uintptr}`。
- 接口调用通过 `itab.fun[method_index]` 间接跳转。

**slice**:
```go
type slice struct {
    array unsafe.Pointer  // 数据指针
    len   int             // 长度
    cap   int             // 容量
}
```
- slice 操作（append、slice 表达式）在逆向中体现为对这三个字段的操作。

**map**:
- Go 的 map 实现为哈希表（`runtime.hmap`）。
- 包含 `buckets`、`oldbuckets`、`noverflow` 等字段。
- 通过 `runtime.mapassign` / `runtime.mapaccess` / `runtime.mapdelete` 操作。
- 逆向 map 操作需要识别这些 runtime 函数的调用。

**channel**:
- 通过 `runtime.makechan` / `runtime.chansend` / `runtime.chanrecv` 实现。
- `hchan` 结构包含 `buf`、`sendx`、`recvx`、`sendq`、`recvq` 等字段。
- select 语句通过 `runtime.selectgo` 实现。

**goroutine 和 defer**:
- go func(): 通过 `runtime.newproc` 启动新 goroutine。
- defer: 通过 `runtime.deferproc` 注册延迟函数，函数返回前通过 `runtime.deferreturn` 执行。
- 识别 defer 可以理解资源释放和异常处理逻辑。

### 4. Go Runtime 函数识别
Go 程序中有大量的 `runtime.*` 函数，它们是理解程序行为的起点。

**常用 runtime 函数**:
| runtime 函数 | 对应操作 |
|-------------|---------|
| `runtime.makeslice` | 创建 slice |
| `runtime.growslice` | slice 扩容 |
| `runtime.makechan` | 创建 channel |
| `runtime.chansend1` | channel 发送 |
| `runtime.chanrecv1` | channel 接收 |
| `runtime.closechan` | 关闭 channel |
| `runtime.makemap` | 创建 map |
| `runtime.mapassign` | map 赋值 |
| `runtime.mapaccess1` / `runtime.mapaccess2` | map 读取 |
| `runtime.newobject` | 分配对象（`new(T)`） |
| `runtime.convT2E` / `runtime.convT2I` | 值转接口 |
| `runtime.gopanic` / `runtime.gorecover` | panic / recover |
| `runtime.deferproc` / `runtime.deferreturn` | defer 注册 / 执行 |
| `runtime.newproc` | 创建 goroutine |
| `runtime.memequal` | 比较（如字符串相等） |
| `runtime.memhash` | 哈希计算 |
| `runtime.stringiter2` | 字符串遍历 |

### 5. Go 逆向分析流程
```
1. 初步识别:
   - 使用 file 命令确认 ELF/PE
   - 使用 strings 搜索 "runtime." 或 "main." 开头的字符串
   - 确认 Go 编译版本

2. 符号恢复:
   - 如果符号未被剥离，IDA 可直接显示函数名
   - 如果被剥离，使用 GoReSym 或 IDAGolangHelper 恢复

3. 定位 main.main:
   - 程序的入口 main 函数
   - 通常是分析的起点（类似 C 的 main 函数）

4. 分析关键函数:
   - 搜索可疑字符串（如 "flag"、"password"、"correct" 等）
   - 追踪字符串引用定位验证逻辑
   - 分析验证循环、比较操作、加密调用

5. 处理并发:
   - 识别 goroutine 和 channel 使用
   - 理解并发逻辑对分析的影响

6. 动态调试:
   - GDB + Go 运行时可解析 goroutine 信息
   - 通过 Delve (dlv) 调试 Go 程序
   - 设置断点在关键函数
```

---

## 相关工具

| 工具 | 用途 |
|------|------|
| GoReSym | 从 Go 可执行文件提取符号和类型信息 |
| Redress | 恢复 Go 符号并重命名 IDA 中的函数 |
| IDAGolangHelper | IDA Python 插件，辅助 Go 逆向 |
| readelf / objdump | 查看 ELF 结构和 Go 特有段 |
| strings | 提取字符串（包括 Go 的 length-prefix 字符串） |
| GDB / Delve (dlv) | Go 程序动态调试 |
| IDA Pro / Ghidra | 反汇编反编译（需配合 Go 专用插件） |

---

## 防御/对抗建议

- **符号剥离**: 使用 `-ldflags="-s -w"` 编译选项剥离调试符号和 DWARF 信息。
- **代码混淆**: 使用 `garble` 等 Go 代码混淆工具，重命名符号、加密字符串。
- **控制流平坦化**: 手动或使用 LLVM pass 对 Go 程序的二进制进行控制流混淆。
- **反调试**: 在 Go 程序中集成 ptrace 检测等反调试逻辑（通过 `syscall.Ptrace` 或 cgo 调用 C 代码）。
- **关键逻辑下沉**: 将关键算法用 C 语言编写（通过 cgo），编译为原生库，增加逆向难度。

---

## 相关技能

- [逆向分析基础](逆向分析基础.md)
- [高级语言逆向](高级语言逆向.md)
- [Rust程序逆向](Rust程序逆向.md)
