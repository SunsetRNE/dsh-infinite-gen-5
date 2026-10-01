# Rust 逆向 (Rust Reversing)

## 概述

Rust 语言由 Mozilla 开发，以内存安全（所有权系统、借用检查器）和零成本抽象著称。Rust 编译的程序在性能上与 C/C++ 相近，但在安全性和可维护性方面具有显著优势。

在 CTF 中，Rust 程序的逆向具有独特的挑战性:Rust 使用 LLVM 后端，编译产物通常为静态链接，包含大量的运行时库函数（core、alloc、std），使用独特的名称修饰（name mangling）规则，并且所有权/生命周期的语义在机器码中难以直接对应。

---

## 常见分析手法

### 1. Rust 程序特征识别
**文件特征**:
- 静态链接导致文件体积较大（数百 KB 到数十 MB）。
- 大量以 `core::`、`alloc::`、`std::` 开头的符号。
- 可执行文件中包含 `.init_array` / `.fini_array` / `.got` / `.plt` 等标准区段。
- 使用 `file` 命令可看到编译信息中包含 "Rust"。

**Rust 名称修饰 (Name Mangling)**:
- Rust 的符号修饰规则: `_ZN<length><name>E[...]`。
- 例如: `_ZN3std2io5stdio6stdout17h6c9b4d8c3c5d34e4E` 表示 `std::io::stdio::stdout`。
- 使用 `rustfilt` 或 `c++filt` 可 demangle Rust 符号:
  ```bash
  rustfilt _ZN3std2io5stdio6stdout17h6c9b4d8c3c5d34e4E
  # 输出: std::io::stdio::stdout
  ```

**String 类型**:
- Rust 的 `String` 类型: `(ptr: *mut u8, len: usize, cap: usize)`。
- `&str` 切片: `(ptr: *const u8, len: usize)`。
- 与 Go 类似，Rust 字符串也不是以 `\0` 结尾的 C 风格字符串。
- 字符串常量存储在 `.rodata` 段中，但需要结合长度字段正确读取。

### 2. 符号恢复
**未剥离符号**:
- 即使使用 `--release` 编译，Rust 默认也会保留大部分符号。
- IDA 能直接显示许多函数名，包括用户定义的函数。

**符号剥离后**:
- 使用 `strip` 后，`core::`、`alloc::`、`std::` 的内部函数名消失。
- 但用户函数名通常也被剥离，需要通过其他方式恢复。
- 目前没有像 GoReSym 那样成熟的 Rust 符号恢复专用工具。
- 可尝试通过 DWARF 调试信息恢复（如果存在）。

**符号过滤技巧**:
- Rust 程序中有大量泛型函数实例化的重复代码。
- 关注 `main`、`main::` 前缀的函数（程序入口）。
- 关注没有 `core::`、`std::` 前缀的"陌生"函数。

### 3. Rust 特有结构识别

**Option<T> / Result<T, E>**:
- Rust 使用枚举（enum）表示可选值和错误处理。
- `Option<T>`: `None`（0 或特定判别值）或 `Some(T)`。
- `Result<T, E>`: `Ok(T)` 或 `Err(E)`。
- 在逆向中体现为 `if (discriminant == 0)` { None/Err } else { Some/Ok }。
- Rust 的空指针优化 (Niche Optimization): `Option<Box<T>>` 中 `None` 用空指针表示。

**Box / Rc / Arc**:
- `Box<T>`: 堆分配，相当于 C++ 的 `std::unique_ptr<T>`。
- `Rc<T>`: 引用计数（非线程安全）。
- `Arc<T>`: 原子引用计数（线程安全）。
- 在逆向中表现为 `alloc::boxed::Box` 或 `alloc::sync::Arc` 等函数的调用。

**Vec<T>**:
```rust
struct Vec<T> {
    ptr: *mut T,  // 数据指针
    len: usize,   // 长度
    cap: usize,   // 容量
}
```
- 与 Go 的 slice 结构类似。
- 扩容: `alloc::vec::Vec::push` 或 `alloc::raw_vec::RawVec::reserve`。

**HashMap / BTreeMap**:
- `HashMap`: SipHash 哈希表，通过 `hashbrown::HashMap` 实现。
- `BTreeMap`: B 树实现的有序字典。
- 操作对应的 runtime 函数: `HashMap::insert`、`HashMap::get`、`BTreeMap::insert` 等。

**Result Propagation (`?` 运算符)**:
- `?` 运算符展开为 `match`，如果是 `Err` 则提前返回。
- 在逆向中体现为条件分支: 检查结果 -> 如果是 Err 则跳转到清理/返回路径。

**panic / unwrap**:
- `unwrap()`: 如果是 `Err`/`None` 则调用 `panic!`。
- `expect()`: 类似 unwrap 但包含自定义 panic 消息。
- `panic!`: 调用 `std::panicking::begin_panic`，最终 unwind 或 abort。
- 在逆向中 panic 的字符串消息是定位关键逻辑的好线索。

### 4. Rust 调用约定
- Rust 使用与 C 相同的系统调用约定（System V / Windows x64）。
- `#[no_mangle]` 标记的函数可以直接从 C 调用，使用 C ABI。
- 默认的 Rust ABI 未稳定，在不同版本间可能有细微差异。
- Rust 的 `extern "C"` 指定 C 调用约定。

### 5. Rust 逆向分析流程
```
1. 确认 Rust 程序:
   - 搜索 "rust_panic"、"std::rt::lang_start" 等特征字符串
   - 使用 rustfilt 对符号进行 demangle

2. 定位 main 函数:
   - 搜索 `main` 或 `::main::` 符号
   - Rust 入口函数为 `main`（类似于 C）

3. 理解 panic 路径:
   - panic 路径占用了大量代码
   - 关注非 panic 路径（正常逻辑）
   - panic 消息字符串有助于理解变量的预期值

4. 分析类型和结构:
   - 从 `move`/`copy` 操作推断类型的语义
   - 分析 `memcpy`/`memmove` 调用（所有权转移）
   - 关注 `drop_in_place` 调用（析构）

5. 处理泛型:
   - 每个泛型实例化在机器码中是独立的
   - 通过分析函数参数的数据类型推断泛型参数

6. 动态调试:
   - GDB + rust-gdb（带 Rust 美化打印的 GDB）
   - 设置条件断点在 panic 或 unwrap 调用处
   - 使用 `rust-lldb` (macOS) 或直接使用标准 GDB
```

---

## 相关工具

| 工具 | 用途 |
|------|------|
| rustfilt / rust-demangle | Rust 符号 demangling |
| GDB + rust-gdb | Rust 程序调试（含美化打印） |
| IDA Pro / Ghidra | 反汇编和反编译 |
| objdump / readelf | 查看 ELF 结构 |
| strings | 提取字符串（含 panic 消息） |
| Rust 标准库源码 | 参考识别 Rust 运行时模式 |

---

## 防御/对抗建议

- **符号剥离**: 使用 `strip` 去除所有符号信息。
- **LTO (Link Time Optimization)**: 启用 LTO 移除未使用的泛型特化，减少符号数量并优化代码。
- **panic abort**: 设置 `panic = "abort"` 替代默认的 unwind，减小二进制体积同时减少 pattern 识别。
- **#\[\`[no_mangle]\`\` for exports**: 对外接口使用非标准命名。
- **自定义分配器**: 替换 `#[global_allocator]` 使用定制的分配器，改变标准堆分配模式。
- **控制流混淆**: 对编译后的二进制应用 LLVM 控制流平坦化/指令替换。
- **将逻辑下沉到 C FFI**: 关键算法通过 FFI 调用 C 库，增加逆向难度。

---

## 相关技能

- [逆向分析基础](逆向分析基础.md)
- [高级语言逆向](高级语言逆向.md)
- [Golang程序逆向](Golang程序逆向.md)
