# Python 安全

## 概述

Python 在 CTF Web 题中通常以 Flask 或 Django 框架出现，涉及模板注入（SSTI）、Pickle 反序列化、沙箱逃逸（Jail）等多种题型。Python 的动态特性（如 `eval()`、`exec()`、`__import__()`）和丰富的魔术方法为攻击者提供了大量利用面。

## 常见攻击手法

### 1. 模板注入 (SSTI)

Flask/Jinja2 模板注入是最常见的 Python SSTI 题型。

- **检测**：输入 `{{7*7}}` 返回 `49` 即存在 SSTI
- **基础利用链**：
  ```
  ''.__class__.__mro__[1].__subclasses__()
  ```
  通过类的 `__mro__`（方法解析顺序）获取 `object` 类，再通过 `__subclasses__()` 获取所有加载的子类，寻找可利用的类（如 `subprocess.Popen`、`os`、`builtins`）。

- **常用 Payload**：
  - 读取文件：`''.__class__.__mro__[1].__subclasses__()[X].__init__.__globals__['open']('flag').read()`
  - 命令执行：`''.__class__.__mro__[1].__subclasses__()[X].__init__.__globals__['__builtins__']['__import__']('os').popen('id').read()`

- **绕过过滤**：
  - 使用 `|attr()` 过滤器替代 `.` 属性访问
  - 使用 `[]` 替代 `()` 调用
  - 编码/拼接字符串绕过关键字过滤
  - 使用 `lipsum`、`cycler`、`joiner`、`namespace` 等 Jinja2 内置对象

- **Django SSTI**：Django 模板引擎默认自动转义，但 `render()` 直接传递用户输入时仍存在 SSTI 风险。

### 2. 沙箱逃逸 (Python Jail)

Python Jail 题限制了可使用的内置函数和模块，需要绕过限制获取更高权限。

- **基础绕过**：
  - `().__class__.__bases__[0].__subclasses__()` 获取 object 的子类
  - 通过子类索引找到 `os`、`subprocess`、`builtins` 等模块

- **常见限制与绕过**：
  - 过滤方括号 `[` `]`：使用 `.__getitem__(X)` 或 `pop()` 替代
  - 过滤引号：使用 `chr()` 构造字符，`bytes([X]).decode()`
  - 过滤 `.`：使用 `getattr()` 或 `setattr()` 替代
  - 过滤关键字：Unicode 变体、字符串拼接、`base64` 解码后执行

- **异常信息泄露**：触发异常（如 `1/0`）可能泄露代码路径和配置信息

- **利用 `help()` 函数**：`help()` 函数可打开一个交互式 less 环境，在其中可执行 OS 命令（`!ls`）

- **`breakpoint()` 函数**（Python 3.7+）：进入调试模式，可执行任意代码

### 3. 反序列化

- **Pickle 反序列化**：
  - Pickle 在反序列化时会执行 `__reduce__()` 方法中定义的 `callable` 和 `args`
  - 构造 Payload：`pickle.dumps()` 一个对象，替换其 `__reduce__` 返回值为 `(os.system, ('cat flag',))`
  - 工具：`picklem`、`opcode` 直接构造 pickle opcode

- **YAML 反序列化**：PyYAML 的 `yaml.load()` 可执行任意 Python 对象，使用 `!!python/object/apply:os.system ["cat flag"]`

- **JSON 反序列化**：标准 JSON 解析没有 RCE 风险，但某些库（如 `demjson`）可能存在特殊处理逻辑

### 4. 命令执行

- **常见危险函数**：`eval()`、`exec()`、`compile()`、`__import__()`、`os.system()`、`os.popen()`、`subprocess.call()`、`subprocess.Popen()`
- **Flask `exec()`**：路由处理函数中若使用 `exec()` 执行用户输入可导致 RCE
- **`os.system` 绕过**：当 `os` 模块被过滤时，可通过 `posix`、`subprocess` 等模块间接执行命令

### 5. 文件读取

- **Flask 静态文件**：`/static/` 目录下的文件可直接读取
- **路径遍历**：`send_file()` 函数中未过滤 `../` 可读取任意文件
- **利用异常信息**：Flask Debug 模式下的交互式 Shell（Werkzeug Debugger）

### 6. 原型链污染

Python 中的原型链污染主要影响对象合并操作，类似于 JavaScript 的 prototype pollution。通过 `update()` 方法或 `__dict__` 修改对象属性。

## 相关工具

| 工具 | 用途 |
|------|------|
| tplmap | SSTI 自动化检测与利用 |
| picklem | Pickle 反序列化 payload 构造 |
| flask-unsign | Flask session 解密与伪造 |

## 防御建议

- 不要对用户输入使用 `eval()`、`exec()`、`pickle.loads()`
- 模板引擎启用自动转义
- Jinja2 使用 `SandboxedEnvironment`

## CTF 中的常见考点

- Jinja2 SSTI 获取 `subprocess.Popen` 执行命令
- Python Jail 绕过限制访问 `os` 模块
- Pickle 反序列化执行系统命令
- Flask session 解密伪造

## 相关技能

- [PHP](PHP.md)
- [Node](Node.md)
- [Ruby](Ruby.md)
- [沙箱逃逸](Node.md)
- [模板注入](PHP.md)
- [Python程序逆向](../逆向工程/Python程序逆向.md)
