# Ruby 安全

## 概述

Ruby 在 CTF Web 题中多以 Ruby on Rails 框架或 Sinatra 轻量框架出现。常见考点包括 ERB 模板注入、Ruby 全局变量/常量的特殊行为、命令执行等。Ruby 的动态特性（如 `send()`、`eval()`、`method_missing()`）为攻击者提供了灵活的利用方式。

## 常见攻击手法

### 1. 模板注入 (SSTI)

- **ERB 模板注入**：
  - ERB 是 Ruby 最常见的模板引擎。检测 Payload：`<%= 7*7 %>` 返回 `49`
  - 基础 RCE：`<%= system('id') %>`
  - 利用 `Kernel` 模块：`<%= Kernel.system('cat /flag') %>`
  - 读取文件：`<%= File.read('/flag') %>` 或 `<%= IO.read('/flag') %>`
  - 利用 `open` 方法：`<%= open('|cat /flag').read %>`（管道前缀执行命令）

- **Slim 模板注入**：
  - `#{7*7}` 检测表达式执行
  - `#{system('id')}` 执行命令

- **Haml 模板注入**：
  - `= system('id')` 检测和执行

- **Rails 中的 SSTI**：
  - `ERB.new(template).result(binding)` 直接渲染用户输入
  - `render` 方法的 `inline` 选项：`render inline: params[:code]`

### 2. 全局变量与常量

Ruby 的全局变量和常量有着特殊的作用域行为，可以被用于绕过限制。

- **全局变量覆写**：
  - `$` 开头的变量为全局变量，可被任意位置修改
  - `$SAFE`：安全级别变量（Ruby < 2.7），修改为 0 可关闭安全限制
  - `$VERBOSE`、`$DEBUG`：输出级别，可泄露调试信息
  - `$LOAD_PATH`：修改加载路径可加载恶意脚本
  - `$0`：当前程序名称，修改后影响某些库的行为

- **常量覆写**：
  - Ruby 中常量可以重新赋值（仅产生警告）
  - `Kernel#system`、`Kernel#exec` 等常量可被重新定义
  - `Object::const_set` 可动态设置常量

- **全局方法覆盖**：
  - `define_method` 可动态定义方法覆盖原有行为
  - `send()` 可调用任意私有方法：`obj.send(:private_method)`

### 3. 命令执行

- **系统命令执行函数**：
  - `` `command` ``（反引号）
  - `system()`、`exec()`、`spawn()`、`popen()`、`IO.popen()`
  - `%x(command)` 字面量语法
  - `Open3.capture2()`、`Open3.capture3()`

- **命令注入**：`system("ping #{params[:ip]}")` 中的参数注入

- **`Kernel#open` 技巧**：`open("| command")` 管道前缀可执行命令；若参数以 `|` 开头，Ruby 的 `open()` 方法会执行系统命令

### 4. 反序列化

- **Marshal.load()**：Ruby 的 `Marshal.load()` 反序列化用户输入时存在 RCE 风险。通过构造恶意序列化数据触发 `_load()`、`marshal_load()` 等回调方法。
- **YAML.load()**：`YAML.load(user_input)` 可以加载任意 Ruby 对象。利用 Payload：
  ```yaml
  --- !ruby/object:ERB
  result: <%= system('id') %>
  ```

### 5. 其他特性

- **method_missing**：当调用不存在的方法时触发。可被用于重定向到危险方法。
- **动态 dispatch**：`send()` 和 `public_send()` 可调用任意方法。
- **符号创建 DoS**：动态创建大量 Symbol 可耗尽服务器内存（Symbol 不会被 GC）。
- **正则表达式 DoS**：精心构造的正则表达式可导致 ReDoS 攻击。

### 6. Rails 特有漏洞

- **Mass Assignment**：`params.permit!` 可导致任意属性赋值
- **不安全反序列化**：Rails 的 `Marshal.load()` 在 session 存储中的应用
- **YAML 列解析**：在 JSON/XML 解析中启用 YAML 列类型时的反序列化风险
- **路由信息泄露**：`/rails/info/routes` 暴露路由表

## 相关工具

| 工具 | 用途 |
|------|------|
| ERB 表达式 | 手动测试模板注入 |
| rails-exploits | Rails 已知漏洞利用 |
| ruby-marshal | Ruby Marshal 反序列化分析 |

## 防御建议

- 避免在 ERB 中直接渲染用户输入的字符串
- 使用 `YAML.safe_load()` 替代 `YAML.load()`
- 不要在 session 存储中使用 `Marshal`
- Rails 应用正确配置 strong parameters

## CTF 中的常见考点

- ERB SSTI 使用 `<%= system('id') %>` 执行命令
- 利用 `open("| command")` 实现 RCE
- `Marshal.load()` 反序列化 RCE
- 全局变量覆写绕过认证或安全检查

## 相关技能

- [Python](Python.md)
- [PHP](PHP.md)
- [模板注入](PHP.md)
