# HTTP 请求

## 概述

HTTP 请求相关技巧在 CTF 中常见于需要伪造请求头、分析响应内容或利用 HTTP 协议特性绕过服务端校验的场景。掌握 HTTP 协议的细节可以帮助选手发现隐藏的端点、绕过访问控制或获取额外信息。

## 常见攻击手法

### 1. 来源头伪造

- **Referer 头伪造**：某些服务端通过检查 `Referer` 头来限制请求来源。使用 `Referer: http://admin.example.com` 即可绕过简单的来源校验。
- **Origin 头伪造**：CORS 场景下服务端检查 `Origin` 头时，可以尝试将其设置为白名单中的域名。某些实现仅做前缀匹配，`evil.com` 可绕过 `*.example.com` 的限制。

### 2. User-Agent 头伪造

- CTF 中常遇到只允许特定客户端（如 `Googlebot`、特定手机型号）访问的情况。通过修改 User-Agent 头即可绕过。
- 常见 UA：
  - Googlebot: `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`
  - iPhone: `Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)`
  - 特定题目指定的自定义 UA

### 3. 请求方法伪造

- **HTTP 方法覆盖**：某些应用通过 `X-HTTP-Method-Override` 头或 `_method` 参数实现方法覆盖，可尝试绕过 GET/POST 限制。
- **使用不同 HTTP 方法**：修改 GET 为 POST 或相反，尝试 HTTP PUT、DELETE、OPTIONS、PATCH、TRACE 等方法。某些接口可能仅对非标准方法开放。
- **HTTP 参数污染 (HPP)**：提交多个同名参数，不同解析器取第一个或最后一个，利用前后端解析差异绕过校验。

### 4. 响应头分析

- **Server 头**：泄露服务器类型和版本。如 `Apache/2.4.49` 可能存在路径穿越漏洞（CVE-2021-41773）。
- **X-Powered-By**：指示后端语言和框架。
- **Set-Cookie**：分析 Cookie 属性（Secure、HttpOnly、SameSite）以及 Cookie 内容中的模式。
- **Location 头**：重定向目标可能泄露内部路径。
- **Access-Control-Allow-Origin**：CORS 配置不当可导致跨域读取敏感数据。

### 5. 请求伪造 (Request Forgery)

- **Host 头攻击**：修改 `Host` 头指向恶意服务器，利用后端基于 Host 头生成 URL 或重置密码链接的特性进行攻击（密码重置投毒）。
- **X-Forwarded-For 伪造**：修改 `X-Forwarded-For`、`X-Real-IP`、`Client-IP` 等头来伪造客户端 IP，绕过 IP 白名单或访问控制。
- **Content-Type 绕过**：修改 `Content-Type` 头，如将 `application/json` 改为 `application/x-www-form-urlencoded`，利用服务端解析差异。

### 6. HTTP 协议降级

- 部分应用仅对 HTTPS 请求做安全检查，尝试使用 HTTP 访问可绕过 WAF 或认证检查。
- HTTP/1.0 降级：某些中间件对 HTTP/1.0 的处理方式不同，可能绕过请求限制。

## 相关工具

| 工具 | 用途 |
|------|------|
| Burp Suite | 拦截和修改 HTTP 请求/响应 |
| curl | 命令行 HTTP 请求，灵活设置请求头 |
| Postman | API 测试 |
| HTTPie | 更友好的命令行 HTTP 客户端 |

## 防御建议

- 不要信赖 `Referer`、`Origin`、`X-Forwarded-For` 等可被客户端随意修改的请求头
- 使用统一且严格的请求验证手段（Token 验证、签名机制）
- 避免在响应头中暴露过多内部信息

## CTF 中的常见考点

- 修改 Referer 或 Origin 通过来源检查
- 设置特定的 User-Agent 头访问隐藏页面
- 分析响应头中的 Server 版本后利用已知漏洞
- 使用 X-Forwarded-For 伪造 IP 绕过访问控制

## 相关技能

- [SSRF](SSRF.md)
- [逻辑漏洞](Web逻辑漏洞.md)
- [认证绕过](认证绕过.md)
- [WEB流量分析](../安全杂项/WEB流量分析.md)
