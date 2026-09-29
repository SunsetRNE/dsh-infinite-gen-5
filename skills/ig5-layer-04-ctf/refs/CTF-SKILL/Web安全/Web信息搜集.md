# 信息搜集

## 概述

信息搜集（Information Gathering / Reconnaissance）是 CTF Web 解题的第一步，也是最重要的环节之一。通过系统化地收集与目标相关的各类信息，可以大幅缩小攻击面，发现隐藏的入口、源码泄露或其他脆弱点。信息搜集的质量直接决定了解题效率与成功率。

## 常见攻击手法

### 1. 域名信息搜集

- **Whois 查询**：通过 Whois 查询获取域名注册信息，包括注册人邮箱、联系方式、DNS 服务器等。常用接口有 `whois` 命令、在线 Whois 网站。
- **子域名枚举**：使用字典爆破或搜索引擎查找目标域名的子域名。常见工具包括 subfinder、Amass、Sublist3r。重点关注 `admin.*`、`dev.*`、`api.*`、`backup.*` 等子域名。
- **DNS 记录分析**：检查 A、CNAME、MX、TXT、NS 记录。TXT 记录可能包含敏感配置信息或验证字符串。使用 `dig` 或 `nslookup` 命令查询。
- **CDN 真实 IP 探测**：通过历史 DNS 记录（SecurityTrails、Censys）或子域名探测绕过 CDN 获取真实服务器 IP。

### 2. 网页信息搜集

- **查看页面源码**：HTML 注释中可能包含隐藏提示、临时链接、开发者备注。快捷键 `Ctrl+U` 或 `view-source:` 前缀查看。
- **robots.txt**：检查 `/robots.txt` 文件，其中可能列出了不希望被搜索引擎索引的敏感路径。
- **sitemap.xml**：网站地图文件，可能透露未公开的页面路径。
- **HTTP 响应头分析**：Server 头泄露 Web 服务器版本，X-Powered-By 泄露后端语言框架，Set-Cookie 泄露会话机制。
- **搜索引擎缓存**：通过 `cache:` 操作符或 Wayback Machine 查看历史页面，可能找到已删除但仍有价值的旧版内容。

### 3. 个人信息搜集

- **GitHub 信息泄露**：搜索目标相关的 GitHub 仓库，查找硬编码的密钥、配置文件、数据库连接字符串。使用 GitHub Dork 如 `org:target "password"`、`"target.com" "api_key"`。
- **历史漏洞库**：查看目标是否在公开漏洞库（Exploit-DB、CVE Mitre）中有历史记录，可以借鉴已知的攻击思路。
- **技术栈识别**：通过 Wappalyzer、BuiltWith 等工具分析目标使用的技术栈（框架、库、CDN、分析工具），针对性寻找已知漏洞。

### 4. 证书透明度

- 利用 crt.sh 或 CertSpotter 查询 SSL/TLS 证书日志，发现目标域名的所有关联域名和子域名。证书中常包含未预期的域名。

### 5. Shodan / Censys / ZoomEye

- 通过网络空间搜索引擎搜索目标 IP 段或域名，发现开放的端口和运行的服务，可能找到测试环境或管理后台。

## 相关工具

| 工具 | 用途 |
|------|------|
| subfinder / Amass | 子域名枚举 |
| Sublist3r | 子域名枚举（多引擎） |
| dig / nslookup | DNS 查询 |
| whois | Whois 信息查询 |
| Wappalyzer | 技术栈识别 |
| crt.sh | 证书透明度查询 |
| Shodan / Censys | 网络空间搜索引擎 |
| Wayback Machine | 历史页面存档 |

## 防御建议

- 严格配置 robots.txt，避免泄露敏感路径
- 不在 HTML 注释中保留调试信息或内部链接
- 限制 HTTP 响应头中的信息暴露
- 使用 CDN 隐藏真实 IP，并配置访问控制
- 定期审查公开代码仓库中的敏感信息

## CTF 中的常见考点

- 根据提示搜索 GitHub 找到源码中的 flag
- 通过 crt.sh 发现隐藏子域名
- 检查响应头中的 Server 版本找到已知漏洞
- 在注释或隐藏页面中找到管理员入口

## 相关技能

- [文件泄露](文件泄露.md)
- [暴力破解](暴力破解.md)
- [认证绕过](认证绕过.md)
- [信息搜集](../渗透测试/渗透信息搜集.md)
- [日志分析](../安全杂项/杂项日志分析.md)
