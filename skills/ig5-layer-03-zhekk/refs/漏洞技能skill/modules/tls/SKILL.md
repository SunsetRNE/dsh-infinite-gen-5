# SSL/TLS 安全模块

> 证书/加密套件/Heartbleed/POODLE/HSTS/协议版本
> 环境：sslscan✅ openssl✅ nmap✅ curl✅

---

## 知识锚点（Playbook + H1 案例）

> 本模块的实战知识锚点：playbook 流程 + H1 真实漏洞报告，两者交叉引用，确保方法论可追溯到真实案例。

### Playbook 流程

- [references/playbooks/info-disclosure.md](../../references/playbooks/info-disclosure.md) — 信息泄露通用流程，TLS 配置缺陷（弱加密套件 / 证书问题 / 协议降级）导致传输层数据泄露属此范畴

### H1 真实案例（references/h1-reports/by-weakness/）

- [improper-certificate-validation.md](../../references/h1-reports/by-weakness/improper-certificate-validation.md) — 证书校验缺陷真实报告（自签名 / 域名不匹配 / 过期证书）
- [man-in-the-middle.md](../../references/h1-reports/by-weakness/man-in-the-middle.md) — MITM 攻击真实报告，弱 TLS 配置使中间人成为可能
- [missing-encryption-of-sensitive-data.md](../../references/h1-reports/by-weakness/missing-encryption-of-sensitive-data.md) — 敏感数据缺少加密传输（HTTP 明文 / 降级攻击）

---

## 底层原理：TLS不是"加密"，是"信任链+加密+完整性"

```
TLS握手三件事：
1. 身份验证 — 证书链 → 我真的是 google.com
2. 密钥交换 — RSA/DH/ECDH → 安全地协商密钥
3. 加密通信 — AES/ChaCha20 → 用协商的密钥加密

TLS漏洞类型：
- 协议版本：SSLv2/SSLv3/TLS 1.0/1.1 已废弃
- 加密套件：RC4/3DES/EXPORT/NULL 不安全
- 证书问题：过期/自签名/域名不匹配/弱签名算法(SHA1)
- 实现漏洞：Heartbleed/POODLE/BEAST/CRIME/FREAK/Logjam
```

---

## 快速检查

```bash
# sslscan 一键检查
sslscan https://target.com

# nmap 检查
nmap -sV --script ssl-enum-ciphers -p 443 target.com

# openssl 手动检查
openssl s_client -connect target.com:443 -servername target.com
openssl s_client -connect target.com:443 -tls1_2
openssl s_client -connect target.com:443 -tls1_1  # 应被拒绝

# 证书信息
openssl s_client -connect target.com:443 2>/dev/null | openssl x509 -noout -text | grep -E "Subject:|Issuer:|Not Before|Not After|DNS:"

# 检查HSTS
curl -sI https://target.com | grep -i "Strict-Transport-Security"
```

---

## 已知漏洞检测

```bash
# Heartbleed (CVE-2014-0160)
nmap -sV --script ssl-heartbleed -p 443 target.com

# POODLE (CVE-2014-3566) — SSLv3
nmap -sV --script ssl-poodle -p 443 target.com

# CCS Injection (CVE-2014-0224)
nmap -sV --script ssl-ccs-injection -p 443 target.com

# DROWN (CVE-2016-0800) — SSLv2
nmap -sV --script ssl-drown -p 443 target.com

# FREAK/Logjam
nmap -sV --script ssl-enum-ciphers -p 443 target.com | grep -E "EXPORT|512"
```

---

## 本机环境速查

```
已安装: sslscan✅ openssl✅ nmap✅ curl✅
缺失: testssl.sh❌ → sslscan + nmap替代
```

---

## 反爬钩子

> TLS 测试中的"反爬"体现为：WAF / CDN 的 TLS 指纹检测（JA3 / JA4）、HSTS 强制升级、证书透明度监控、以及 TLS 1.3 加密指纹。

### TLS 场景的防护对抗

```
可能遇到的拦截场景：
1. 扫描被 JA3 / JA4 TLS 指纹拦截
   → curl/openssl 的 TLS 指纹与浏览器不同 → 被识别为非浏览器
   → 用 Playwright 浏览器引擎发起 TLS 连接（真实浏览器指纹）
   → 用 curl-impersonate / cycletls 模拟浏览器 TLS 指纹
2. HSTS 强制 HTTPS → 无法降级到 HTTP 测试
   → 测试目标是否在 HSTS preload 列表中
   → 首次访问（无缓存）仍可尝试 HTTP 降级
3. 证书透明度日志暴露测试行为
   → CT 日志监控可能触发告警（大量证书查询）
   → 用 censys / crt.sh 一次性批量查询，避免高频请求
4. nmap TLS 扫描被 WAF 速率限制
   → 降速：--scan-delay 5s --max-retries 1
   → 分端口分时段扫描
5. openssl s_client 被中间设备干扰（SSL inspection）
   → 检查返回证书链是否被替换（中间盒注入 CA）
   → 对比浏览器看到的证书与 openssl 看到的证书
```

通用反爬 / WAF 对抗策略参见 [references/methodology/06-anti-antibot.md](../../references/methodology/06-anti-antibot.md)。