# Python 程序逆向 (Python Reversing)

## 概述

Python 是 CTF 中常见的编程语言，因其实用性和快速开发能力被广泛使用。Python 程序的逆向与编译型语言（C/C++/Go）有本质不同——Python 代码通常以源码或字节码（`.pyc`）的形式分发，或者通过 PyInstaller / Nuitka 等工具打包为独立的可执行文件。

Python 逆向的核心任务是: 从字节码或打包后的可执行文件中恢复出原始的 Python 源代码，或至少理解其核心逻辑。

---

## 常见分析手法

### 1. PyInstaller 程序解包
PyInstaller 是最流行的 Python 打包工具，将 Python 程序打包为独立的可执行文件。

**打包结构**:
- **Bootloader**: 一个通用的 C 程序（`pyi-launcher`），负责初始化 Python 环境。
- **存档文件 (Archive)**: 包含所有 Python 模块的 `.pyc` 文件（可能被压缩或加密）。
- **依赖 DLL**: Python 解释器和所有依赖的原生库。

**解包步骤**:
1. **识别 PyInstaller**: 查找可执行文件中是否包含 `pyi-windows-manifest` 或特定字符串。
2. **使用 pyinstxtractor**: `python pyinstxtractor.py target.exe` 提取所有文件。
3. **结构分析**:
   - 提取出的文件夹包含 `struct` 格式的 PYZ 存档。
   - 主入口通常是 `entry_point`（可能是 `main.pyc` 或 `__main__.pyc`）。
   - 如果 PyInstaller 版本较新（3.0+），可能使用 `CArchive` 而非旧的 `ZlibArchive`。
4. **解密处理**:
   - 如果程序使用了 `--key` 参数进行加密，需要找到密钥进行解密。
   - 密钥通常嵌入在 bootloader 中，可通过动态调试提取。
   - **工具**: `pyinstxtractor` + `pycrypt`（解密加密的 PyInstaller 存档）。

**应对混淆**:
- PyInstaller 本身不对字节码进行混淆，但配合 `--key` 加密会增加难度。
- 某些程序使用自定义的 PyInstaller 修改版，需针对性分析。

### 2. PYC 反编译
`.pyc` 文件是 Python 的编译字节码，每条指令对应 CPython 虚拟机的操作。

**反编译工具**:

| 工具 | 说明 | 适用版本 |
|------|------|----------|
| **uncompyle6** | 经典反编译器，已停止维护 | Python 2.4 - 3.8 |
| **decompyle3** | uncompyle6 的后续分支 | Python 3.7+ |
| **pycdc** (pycdc/pycdas) | C++ 实现，速度快 | Python 2.7 - 3.10+ |
| **unpyc3** / **pydec** | 其他开源反编译 | 特定版本 |
| **pylingual** | 商业反编译器，支持最新 Python 版本 | Python 3.8 - 3.13 |
| **marstool** | 在线反编译 | Python 3.x |

**字节码版本识别**:
- `.pyc` 文件头部包含 magic number（4 字节），标识 Python 版本。
- `importlib.util.MAGIC_NUMBER` 可查看当前环境的 magic number。
- 已知版本:
  - Python 3.6: `0x33 0x0D 0x0D 0x0A`
  - Python 3.7: `0x42 0x0D 0x0D 0x0A`
  - Python 3.8: `0x55 0x0D 0x0D 0x0A`
  - Python 3.10: `0xA1 0x0D 0x0D 0x0A`
  - Python 3.11: `0xB3 0x0D 0x0D 0x0A`

**反编译失败常见原因**:
- magic number 不匹配（版本不对）。
- 字节码被修改/混淆（自定义操作码）。
- 使用了不支持的语言特性（match-case、海象运算符等新语法）。
- 字节码被压缩或加密。

**手动分析字节码**:
- 使用 Python 内置的 `dis` 模块查看字节码反汇编。
  ```python
  import dis
  with open("file.pyc", "rb") as f:
      f.read(16)  # 跳过 header
      code = marshal.load(f)
  dis.dis(code)
  ```
- 理解 `LOAD_CONST`、`CALL_FUNCTION`、`BUILD_LIST`、`COMPARE_OP` 等指令的含义。

### 3. PYD 逆向
`.pyd` 文件是 Windows 平台的 Python 扩展模块（本质是 DLL），使用 C/Cython 编写。

**分析 PYD 的挑战**:
- PYD 是编译后的原生代码，不能反编译为 Python 源码。
- 需要像逆向 C/C++ 程序一样使用 IDA / Ghidra 分析。

**分析步骤**:
1. **检查导出函数**: PYD 导出的关键函数:
   - `PyInit_<modulename>`: 模块初始化函数，定义模块方法和类型。
   - `PyMethodDef` 数组: 描述了 Python 中可调用的函数。
2. **函数原型识别**: 每个 Python 可调用函数签名为 `PyObject* function(PyObject* self, PyObject* args)`。
3. **类型结构识别**: 识别 `PyArg_ParseTuple`、`Py_BuildValue`、`PyLong_FromLong` 等 API 的调用。
4. **Cython 分析**: Cython 编译的 PYD 包含更复杂的类型结构和引用计数管理代码。

### 4. Nuitka 程序逆向
Nuitka 是 Python 到 C++ 的编译器，将 Python 代码编译为原生可执行文件。

**Nuitka 的特点**:
- 将 Python 代码转换为 C++ 代码，然后使用 C++ 编译器（GCC/MSVC）编译。
- 保留 Python 的语义，但性能更接近原生代码。
- 反编译为原始 Python 源代码极其困难。

**逆向方法**:
1. **识别 Nuitka**: 程序通常很大（嵌入了 Python 运行时和所有依赖）。
2. **字符串分析**: Nuitka 会将 Python 字符串常量保留在可执行文件的 `.rdata` 段中。
3. **函数模式识别**: Nuitka 生成的代码使用整数 ID 表示函数和变量，通过 `switch-case` 跳转到不同的执行路径。
4. **控制流还原**: Nuitka 的目标不是混淆，但编译器优化使得控制流难以直接对应到源码。
5. **可利用的线索**:
   - 错误消息和日志字符串暴露了原始代码结构。
   - 模块/函数名称残留在 `__nuitka_*` 符号中。
6. **工具**: 目前没有现成的 Nuitka 反编译器，需要结合 IDA/Ghidra 手动分析。

### 5. 其他 Python 程序逆向

**Cython 编译产物**:
- Cython 将 Python 代码编译为 C 扩展（`.so` / `.pyd`）。
- 逆向方式同 PYD 分析，但 Cython 生成的 C 代码模式化程度高，有利于识别关键函数。
- 关注 `__pyx_` 前缀的函数和变量。
- **Cython 反编译工具**: 有限，通常只能手动反汇编分析。

**Python 代码保护方案**:
- **Pyarmor**: 加密 Python 源码，运行时解密执行。
  - 使用 `pyarmor` pack 或 obfuscate 模式。
  - 解密逻辑在动态链接的 `_pytransform.*` 文件中。
  - 逆向: 通过动态调试提取解密后的字节码。
- **PyObfuscate**: 混淆 Python 字节码（修改字节码、添加垃圾代码）。
  - 反编译难度取决于混淆强度。
- **code object 加密**: 将 code object 序列化后加密，动态解密后 `exec` 执行。
  - 逆向: 在 `exec` 调用处设置断点，提取解密后的 code object。

**marshal / pickle 数据**:
- 使用 `marshal.load` 或 `pickle.load` 反序列化的对象可能包含恶意代码或隐藏逻辑。
- 反序列化生成的 code object 可以用 `dis` 分析。
- 注意 pickle 序列化的 `__reduce__` 方法可实现任意代码执行。

---

## 相关工具

| 类别 | 工具 | 用途 |
|------|------|------|
| 解包 | pyinstxtractor | 提取 PyInstaller 打包的程序 |
| 解包 | archive_viewer.py (PyInstaller 自带) | 查看 PyInstaller 存档内容 |
| 解包 | pyi-archive_viewer | 交互式查看存档 |
| 反编译 | uncompyle6 / decompyle3 | Python 字节码反编译（< 3.9） |
| 反编译 | pycdc / pycdas | C++ 实现的反编译器（< 3.10） |
| 反编译 | pylingual | 商业反编译器（新版本支持好） |
| 反汇编 | `dis` 模块 (Python 内置) | 查看字节码指令 |
| 反编译 | `marshal` 模块 | 加载/导出序列化 code object |
| PYD 分析 | IDA Pro / Ghidra | 分析原生扩展模块 |
| 提取 | strings / binwalk | 从 Nuitka 编译产物提取字符串 |
| 动态调试 | x64dbg (Windows) / GDB (Linux) | 调试 PYD / Nuitka 编译产物 |

### 逆向流程示例
```bash
# 1. 解包 PyInstaller 生成的可执行文件
python pyinstxtractor.py challenge.exe
cd challenge.exe_extracted/

# 2. 提取主入口文件
# 找到 entry_point（可能被命名为 main.pyc 或 challenge.pyc）

# 3. 反编译 PYC
pycdc main.pyc > main.py

# 4. 如果失败，尝试 uncompyle6
uncompyle6 main.pyc > main.py

# 5. 如果仍然失败，使用 dis 手动分析字节码
python -c "
import dis, marshal
with open('main.pyc', 'rb') as f:
    f.read(16)  # skip header
    code = marshal.load(f)
dis.dis(code)
"
```

---

## 防御/对抗建议

- **使用 PyInstaller + --key**: 加密存档内容，增加提取难度。
- **Nuitka 编译**: 将 Python 代码完全编译为原生代码，基本无法还原。
- **多层打包**: Python 脚本打包为 PyInstaller，内部又嵌入 PYD 扩展和加密数据。
- **反调试检测**: 在 Python 层检测调试器/分析环境。
- **动态代码加载**: 通过 `requests.get(url).text` 动态加载和执行 Python 代码。
- **反反编译**: 修改 `.pyc` 文件的 magic number 或使用自定义字节码。

---

## 相关技能

- [逆向分析基础](逆向分析基础.md)
- [高级语言逆向](高级语言逆向.md)
- [加密与解密](加密与解密.md)
- [Python](../Web安全/Python.md)
- [取证](../安全杂项/取证.md)
