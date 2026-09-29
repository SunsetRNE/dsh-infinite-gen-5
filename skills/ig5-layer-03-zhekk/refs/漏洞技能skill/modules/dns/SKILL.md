# DNS 安全模块

> 区域传送/DNS劫持/隧道/缓存投毒/子域接管/DNSSEC
> 环境：dig✅ nslookup✅ tcpdump✅ tshark✅ dnsrecon(apt install)

---

## 知识锚点（Playbook + H1 案例）

> 本模块的实战知识锚点：playbook 流程 + H1 真实漏洞报告，两者交叉引用，确保方法论可追溯到真实案例。

### Playbook 流程

- [references/playbooks/info-disclosure.md](../../references/playbooks/info-disclosure.md) — 信息泄露通用流程，DNS 区域传送（AXFR）/ 子域枚举 / TXT 记录泄露均属此范畴
- [references/playbooks/unauth-access.md](../../references/playbooks/unauth-access.md) — 未授权访问通用流程，未授权 DNS 区域传送是典型场景

### H1 真实案例（references/h1-reports/by-weakness/）

- [improper-authorization.md](../../references/h1-reports/by-weakness/improper-authorization.md) — 授权缺陷导致 DNS 记录越权读取
- [information-disclosure.md](../../references/h1-reports/by-weakness/information-disclosure.md) — DNS 配置不当导致内部网络结构泄露

---

## 底层原理：DNS 是互联网的"电话本"，控制它 = 控制流量方向

```
DNS 解析链路：
浏览器 → 本地缓存 → /etc/hosts → 路由器DNS → ISP DNS → 根DNS → TLD DNS → 权威DNS

每一跳都可以被攻击：
1. 本地缓存投毒：修改 hosts 文件或 DNS 缓存
2. 路由器劫持：修改路由器 DNS 设置
3. 中间人：拦截 DNS 请求，返回伪造响应
4. 权威DNS：接管过期域名，指向恶意服务器
5. 区域传送：获取完整 DNS 记录，发现内部网络结构
```

### DNS 攻击决策树

```
目标是什么？
├── 信息收集 → 区域传送 + 子域爆破 + 反向DNS
├── 流量劫持 → DNS 投毒 + 伪造响应 + ARP欺骗
├── 数据渗出 → DNS 隧道（iodine/dnscat2）
├── 子域接管 → 检查 CNAME 指向的云服务
└── 可用性攻击 → DNS 放大攻击 + DNSSEC 绕过
```

---

## 信息收集

```bash
# 1. 区域传送 — 获取完整DNS记录
dig axfr @ns1.target.com target.com
dig axfr @ns2.target.com target.com
# 或者用 dnsrecon
dnsrecon -d target.com -t axfr

# 2. 子域爆破
dnsrecon -d target.com -D /usr/share/wordlists/subdomains-top1million-5000.txt -t brt
# 或者用 ffuf + DNS 解析
for sub in $(cat wordlist.txt); do
  result=$(dig +short $sub.target.com)
  [ -n "$result" ] && echo "$sub.target.com → $result"
done

# 3. 反向DNS — 从IP找域名
dig -x 192.168.1.1
# 批量
for ip in 192.168.1.{1..254}; do
  result=$(dig +short -x $ip)
  [ -n "$result" ] && echo "$ip → $result"
done

# 4. DNS 记录类型全收集
for type in A AAAA CNAME MX NS TXT SOA SRV PTR; do
  echo "=== $type ==="
  dig +short target.com $type
done

# 5. SPF/DMARC 记录（邮件安全）
dig +short target.com TXT | grep "spf"
dig +short _dmarc.target.com TXT
```

---

## 子域接管检测

```bash
# 子域接管的核心：CNAME 指向了别人控制的资源
# 如果那个资源被释放了，你就可以接管

# 1. 检查所有子域的 CNAME
dig +short CNAME sub.target.com

# 2. 常见可接管的 CNAME 目标
# AWS S3: sub.target.com.s3.amazonaws.com → 如果bucket不存在，注册它
# GitHub Pages: sub.target.com → 如果用户名不存在，注册它
# Heroku: sub.herokuapp.com → 如果app不存在，创建它
# Azure: sub.cloudapp.net → 如果不存在，创建它
# 检查方法：访问 CNAME 目标，如果返回404或"not found"
curl -s "https://sub.target.com" | grep -i "not found\|no such\|doesn't exist\|not available"

# 3. 自动化检测
python3 << 'EOF'
import subprocess, re

subdomains = ["www", "api", "admin", "mail", "cdn", "dev", "staging", "test"]
domain = "target.com"

for sub in subdomains:
    fqdn = f"{sub}.{domain}"
    result = subprocess.run(['dig', '+short', 'CNAME', fqdn], 
                          capture_output=True, text=True)
    if result.stdout.strip():
        cname = result.stdout.strip().rstrip('.')
        print(f"{fqdn} → CNAME: {cname}")
        # 检查是否可接管
        if any(x in cname.lower() for x in ['s3.amazonaws', 'github.io', 
               'herokuapp', 'cloudapp.net', 'elasticbeanstalk']):
            print(f"  !! 可能可接管: {cname}")
EOF
```

---

## DNS 劫持检测

```bash
# 1. 多源对比 — 不同DNS服务器返回不同结果？
# 可能是本地劫持
dig @8.8.8.8 target.com +short       # Google DNS
dig @1.1.1.1 target.com +short       # Cloudflare DNS
dig @114.114.114.114 target.com +short # 国内DNS
dig @localhost target.com +short     # 本地DNS

# 2. 检查 /etc/hosts
grep "target.com" /etc/hosts
# 如果被修改 → 劫持

# 3. 检查 DNS 缓存
# systemd-resolved
resolvectl query target.com
# 或者
systemd-resolve --status | grep "DNS Servers"

# 4. 抓包分析 DNS 响应
tcpdump -i any port 53 -w dns.pcap
tshark -r dns.pcap -Y "dns.flags.response==1" \
  -T fields -e frame.time -e dns.qry.name -e dns.a
```

---

## DNS 隧道检测

```bash
# DNS 隧道特征：大量异常长的DNS查询
# 正常DNS查询: < 50 字符
# 隧道DNS查询: 100-255 字符

# 1. 抓包分析
tcpdump -i any port 53 -w dns_tunnel.pcap -c 1000

# 2. 用 tshark 分析查询长度
tshark -r dns_tunnel.pcap -Y "dns.flags.response==0" \
  -T fields -e dns.qry.name | \
  awk '{ if (length($0) > 50) print length($0), $0 }' | sort -rn

# 3. 检测异常频率
# 正常: 每分钟几个DNS查询
# 隧道: 每秒几十个DNS查询
tshark -r dns_tunnel.pcap -Y "dns.flags.response==0" \
  -T fields -e frame.time | \
  awk '{print substr($1,1,16)}' | sort | uniq -c | sort -rn | head -10

# 4. 检测 TXT 记录滥用
# TXT 记录可以携带大量数据
tshark -r dns_tunnel.pcap -Y "dns.txt" -T fields -e dns.txt | head -5
```

---

## 本机环境速查

```
已安装: dig✅ nslookup✅ tcpdump✅ tshark✅
需要安装: dnsrecon (apt install dnsrecon) / subfinder (go install)
替代: dig + 自定义脚本覆盖大部分需求
```

---

## 反爬钩子

> DNS 测试中的"反爬"体现为：DNS 速率限制（RRL）、DNSSEC 签名验证、DNS 防火墙 / RPZ 策略、以及权威 DNS 的 AXFR 访问控制。

### DNS 场景的防护对抗

```
可能遇到的拦截场景：
1. 子域爆破被 DNS 速率限制（RRL）拦截
   → 降速：每次查询间隔 1-3 秒 + 随机延迟
   → 分散到多个公共解析器（8.8.8.8 / 1.1.1.1 / 114.114.114.114）
   → 用 DNS-over-HTTPS（DoH）/ DNS-over-TLS（DoT）规避 RRL
2. 区域传送（AXFR）被访问控制拒绝
   → 尝试从不同权威 NS 请求（ns1/ns2/ns3 目标域）
   → 伪造源 IP 为受信任网络（若允许特定网段 AXFR）
3. DNS 隧道被防火墙 / IDS 检测
   → 降低隧道流量频率（正常 DNS 每分钟几个查询）
   → 用合法子域名前缀伪装
   → 分散到多个域名降低特征密度
4. DNS 放大攻击被 Anycast / RPL 防护
   → 仅用于授权测试，验证反射放大系数
   → 测试目标是否开启了 RPL（Response Rate Limiting）
5. 子域接管检测被 CDN / WAF 干扰
   → 直接 dig +short CNAME 确认指向，不依赖 HTTP 访问
   → 用 curl 带自定义 Host 头验证可接管状态
```

通用反爬 / WAF 对抗策略参见 [references/methodology/06-anti-antibot.md](../../references/methodology/06-anti-antibot.md)。