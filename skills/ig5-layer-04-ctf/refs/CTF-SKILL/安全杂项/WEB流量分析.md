# Web 流量分析（Web Traffic Analysis）

## 概述

Web 流量分析是 CTF 网络取证的重要组成部分，通过对 HTTP/HTTPS 流量的分析，提取隐藏数据、还原攻击过程、恢复传输的文件。流量通常以 PCAP（Packet Capture）格式提供，使用 Wireshark 或 tshark 进行分析。

## 常见类型

### HTTP 流量分析
最基础的 Web 流量分析，HTTP 是明文协议，所有内容可直接查看。

**分析要点**：
1. **HTTP 请求**：方法（GET/POST）、URL、Headers、Cookie
2. **HTTP 响应**：状态码、Headers、响应体
3. **POST 数据**：表单数据、JSON 数据、文件上传
4. **Cookie/Session**：会话标识、Auth 令牌
5. **Referer/User-Agent**：请求来源标识

**Wireshark 过滤**：
```
http.request
http.response
http.request.method == "POST"
http.cookie contains "session"
http.content_type contains "image"
```

### TLS/HTTPS 流量分析
加密的 HTTPS 流量需要额外步骤解密。

**解密方法**：
1. **SSLKEYLOGFILE**：使用浏览器导出的会话密钥日志文件
2. **私钥**：如果有服务器的 RSA 私钥，可解密使用该证书的会话
3. **预主密钥**：在 Wireshark 中设置 SSLKEYLOGFILE 环境变量

**Wireshark 配置**：
```
编辑→首选项→Protocols→TLS→(Pre)-Master-Secret log filename
```

### WebShell 流量分析
分析被攻击后的 WebShell 管理工具的流量特征。

#### AntSword（蚁剑）流量分析
**特征**：
- 默认使用 Base64 编码的 POST 数据
- 请求体包含 `eval`、`system`、`assert` 等函数调用
- 编码后的 payload 中包含 `chr`、`ord`、`base64_decode` 等

**解码方法**：
```python
import base64
import urllib.parse

# 提取 POST 数据中的 Base64 编码内容
payload = "..."
decoded = urllib.parse.unquote(payload)
# 需要进一步解析 AntSword 的编码格式
```

#### Godzilla（哥斯拉）流量分析
**特征**：
- 使用 AES 加密交互数据
- 请求体包含加密后的二进制数据
- Payload 在响应中以密文形式返回

**解码**：需要获取 AES 密钥（通常在 Payload 中定义）。

#### Behinder（冰蝎）流量分析
**特征**：
- 动态密钥协商
- 使用 AES 加密交互
- 请求包含密钥交换过程

#### Cobalt Strike 流量分析
**特征**：
- HTTPS 通信
- 特定的 User-Agent
- 心跳包（Meta-data）特征

## 相关工具

- **Wireshark**：图形化抓包分析
- **tshark**：命令行 Wireshark
- **tcpdump**：命令行抓包
- **TShark**：PCAP 分析脚本
- **NetworkMiner**：网络取证分析
- **Xplico**：网络取证工具
- **Bro/Zeek**：网络分析框架

## 防御建议

Web 流量分析主要用于入侵检测和取证分析：
- 部署 Web 应用防火墙（WAF）
- 检测异常流量模式
- 使用 HTTPS 并妥善保管私钥
- 监控 WebShell 流量特征

## 示例思路

```bash
# 使用 tshark 提取 HTTP 对象
tshark -r capture.pcap --export-objects "http,exported_files"

# HTTP 请求统计
tshark -r capture.pcap -Y "http.request" -T fields -e http.host -e http.request.uri

# 提取特定 HTTP 响应
tshark -r capture.pcap -Y "http.response.code == 200" -T fields -e http.file_data

# 解密 HTTPS（使用密钥日志）
tshark -r capture.pcap -o "tls.keylog_file:keylog.txt" -Y "tls" -T fields -e tls.app_data
```

## 相关技能

- [USB流量分析](USB流量分析.md)
- [其他流量分析](其他流量分析.md)
- [日志分析](杂项日志分析.md)
- [XSS](../Web安全/XSS.md)
- [SQL注入](../Web安全/SQL注入.md)
- [流量分析](../应急响应/流量分析.md)
