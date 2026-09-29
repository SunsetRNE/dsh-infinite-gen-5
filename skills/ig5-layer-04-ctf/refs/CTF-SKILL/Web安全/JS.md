# JS 安全

## 概述

JavaScript 在前端 Web 应用中扮演核心角色。CTF 中 JS 相关的挑战主要涉及代码混淆、加密算法逆向、前端逻辑漏洞等。选手需要通过分析和还原混淆后的 JS 代码来理解前端校验逻辑、加密算法或隐藏的 API 端点。

## 常见攻击手法

### 1. JS 代码混淆与逆向

- **基本混淆手段**：
  - 变量名重命名：`var a = 1, b = 2` 替换可读变量名
  - 字符串编码：使用 `base64`、`unicode`、`hex` 编码隐藏字符串
  - 控制流扁平化：将顺序代码改为 switch-case 结构
  - 死代码注入：插入无用代码干扰分析
  - 属性名动态访问：`obj['x' + 'y']` 代替 `obj.xy`
- **在线反混淆工具**：
  - [Beautifier.io](https://beautifier.io/) - JS 代码格式化
  - [JS Nice](http://jsnice.org/) - 代码自动命名和反混淆
  - [UnPacker](https://matthewfl.com/unPacker.html) - 解包 eval 混淆

### 2. 前端加密逻辑绕过

- CTF 中常见前端实现加密（如 RSA、AES），加密后的数据发送到后端。若后端信任前端加密，可以通过：
  - **直接调用后端 API**：绕过前端加密逻辑直接发送请求
  - **分析加密函数**：在浏览器 DevTools Console 中调用加密函数
  - **修改加密参数**：篡改加密前的明文数据
- **Hook 技术**：使用 `console.log` 或断点调试拦截敏感函数调用

### 3. Cookie 与 LocalStorage 分析

- 前端存储的 Token、SessionID 可直接读取
- LocalStorage 中可能存储了用于后续请求的认证信息
- 浏览器 DevTools 的 Application 面板查看所有存储

### 4. 前端框架安全

- **Vue/React 开发模式**：React 开发模式可能输出详细的错误信息和组件树
- **Source Map**：生产环境若保留了 `.map` 文件，可恢复原始源码
- **AJAX 请求分析**：Network 面板查看所有 XHR/Fetch 请求，发现未在页面展示的 API

### 5. JS 原型链污染（前端场景）

- 前端 JS 中若存在不安全的对象合并操作（如 `$.extend`、`Object.assign`），可尝试污染 `Object.prototype` 来改变对象行为。
- 典型影响：修改全局配置对象、绕过条件检查。

### 6. WebAssembly (WASM) 逆向

- 部分 CTF 题目使用 WASM 实现核心逻辑以增加逆向难度
- WASM 逆向工具：`wasm-decompile`、`wasm2wat`、`wasm2c`

## 相关工具

| 工具 | 用途 |
|------|------|
| Chrome DevTools | JS 调试、断点、网络分析 |
| Beautifier.io | JS 美化格式化 |
| JS Nice | JS 反混淆与变量重命名 |
| wasm2wat / wasm-decompile | WASM 反编译 |
| Frida | JS Hook 与动态分析 |

## 防御建议

- 前端加密不能替代后端安全校验，所有校验必须在服务端重复执行
- 生产环境删除 Source Map 文件
- 减少混淆 JS 中的敏感信息硬编码

## CTF 中的常见考点

- 反混淆 JS 代码找到隐藏的加密密钥或 flag
- 分析前端加密函数并反向计算原始输入
- 在 DevTools Console 中直接调用未文档化的函数
- 通过 Source Map 恢复 Vue/React 源码

## 相关技能

- [PHP](PHP.md)
- [Python](Python.md)
- [Node](Node.md)
- [认证绕过](认证绕过.md)
- [高级语言逆向](../逆向工程/高级语言逆向.md)
