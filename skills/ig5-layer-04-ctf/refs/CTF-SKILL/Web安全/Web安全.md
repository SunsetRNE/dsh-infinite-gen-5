# Web 分类 CTF 技能知识库

> CTF 中 Web 题型的综合性知识库，涵盖信息搜集、注入攻击、认证绕过、代码审计等 21 个核心技能方向。

---

## 技能目录

| # | 技能 | 标签 | 简介 |
|---|------|------|------|
| 1 | [信息搜集](Web信息搜集.md) | 域名信息搜集, 个人信息搜集 | 通过公开渠道收集目标信息，包括子域名、Whois、搜索引擎、社交媒体等 |
| 2 | [HTTP 请求](HTTP请求.md) | 来源头伪造, UA头伪造, 返回头分析, 返回内容分析, 请求伪造 | 分析并伪造 HTTP 请求/响应头，利用协议特性绕过访问控制 |
| 3 | [暴力破解](暴力破解.md) | 常规暴力破解, Hash生日攻击, 验证码识别 | 针对登录接口、验证码、哈希碰撞等场景的暴力枚举技术 |
| 4 | [文件泄露](文件泄露.md) | 源码文件泄露, 备份文件泄露, 网站信息泄露 | 利用常见路径字典和备份文件规律获取未授权源代码或敏感信息 |
| 5 | [JS 安全](JS.md) | 混淆逆向 | 对前端 JavaScript 进行逆向分析，提取加密逻辑、API 端点或隐藏功能 |
| 6 | [PHP 安全](PHP.md) | 弱类型, 变量覆盖, 反序列化, 伪协议, 文件包含, 框架漏洞, 模板注入, 代码执行, 命令执行 | PHP 在 CTF 中出现频率最高的语言，涵盖弱类型比较、反序列化、伪协议利用等 |
| 7 | [Python 安全](Python.md) | 命令执行, 沙箱逃逸, 反序列化, 模板注入, 文件读取, 原型链污染 | Flask/Django 框架下的 SSTI、Pickle 反序列化、Python jail 逃逸 |
| 8 | [Java 安全](Java.md) | 反序列化, 模板注入, 命令执行 | Java 反序列化链利用、SpEL 表达式注入、Fastjson 等常见漏洞 |
| 9 | [Node 安全](Node.md) | 命令执行, 原型链污染, VM 沙箱逃逸, 模板注入 | Node.js 原型链污染、沙箱逃逸、Pug/EJS 模板注入 |
| 10 | [Ruby 安全](Ruby.md) | 全局变量, 模板注入 | ERB 模板注入、Ruby 全局变量覆写等技巧 |
| 11 | [Go 安全](Go.md) | 模板注入, 命令执行 | Go 语言 html/template 注入、命令执行利用 |
| 12 | [SQL 注入](SQL注入.md) | 有回显注入, 无回显盲注, WAF绕过, 宽字节注入, 报错注入, 堆叠注入, 文件操作, UDF提权 | 数据库注入的全类型覆盖，从基础联合查询到高级 UDF 提权 |
| 13 | [XSS](XSS.md) | 反射型, 储存型, DOM型, WAF绕过, Electron | 跨站脚本攻击的各种类型及绕过技巧，包括 Electron 应用中的 XSS |
| 14 | [文件上传](文件上传.md) | 前端绕过, 黑白名单绕过, 内容检查绕过, 条件竞争 | 绕过文件上传限制的各种姿势，从 MIME 类型到中间件解析差异 |
| 15 | [SSRF](SSRF.md) | 内网探测, 文件读取, 攻击内网应用, DoS | 服务端请求伪造，利用 URL 跳转、DNS 重绑定等技术攻击内网 |
| 16 | [CSRF](CSRF.md) | 基本利用, JSONP | 跨站请求伪造，利用用户已登录状态发起非预期操作 |
| 17 | [XXE](XXE.md) | Java XXE, 文件读取, 命令执行, 有回显/无回显 | XML 外部实体注入，读取服务器文件或执行 SSRF 攻击 |
| 18 | [Windows 相关](Windows相关.md) | Aspx反序列化, 文件通配符, IIS, NTFS流 | Windows 平台的 ASPX 反序列化、NTFS ADS 绕过上传等特性利用 |
| 19 | [逻辑漏洞](Web逻辑漏洞.md) | 权限绕过, 业务逻辑漏洞, 数据校验绕过 | 利用业务逻辑缺陷绕过权限控制或获取非授权资源 |
| 20 | [NoSQL 注入](NOSQL注入.md) | PHP数组注入, Ruby数组注入, JS注入, MongoShell | 针对 MongoDB 等非关系型数据库的注入攻击技术 |
| 21 | [认证绕过](认证绕过.md) | JWT绕过, HTTP基础验证, Cookie绕过 | 认证机制缺陷利用，涵盖 JWT 攻击、Cookie 伪造等 |

---

## 学习方法建议

1. **基础优先**：从 PHP 安全、SQL 注入、XSS 三个传统重点入手
2. **逐步深入**：掌握基础后学习反序列化、沙箱逃逸等进阶内容
3. **动手实践**：每个技能配合在线靶场（如 DVWA、WebSec、PortSwigger Labs）实操
4. **整理笔记**：记录自己编写的 EXP 和 Payload，形成个人武器库

## 常用在线资源

- [PortSwigger Web Security Academy](https://portswigger.net/web-security)
- [CTFtime](https://ctftime.org)
- [PayloadsAllTheThings](https://github.com/swisskyrepo/PayloadsAllTheThings)
- [HackTricks](https://book.hacktricks.xyz)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

## 相关技能

- [渗透测试](../渗透测试/渗透测试.md)
- [安全杂项](../安全杂项/安全杂项.md)
- [密码学](../密码学/密码学.md)
- [逆向工程](../逆向工程/逆向工程.md)
- [二进制安全](../二进制安全/二进制安全.md)
- [云安全](../云安全/云安全.md)
