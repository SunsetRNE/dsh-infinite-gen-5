# OPSEC 操作安全模块

> 隐身/代理池/流量伪装/免杀/反溯源/反蜜罐
> 环境：proxychains✅ torsocks✅ screen✅ iptables✅

---

## 知识锚点（Playbook + H1 案例）

> OPSEC 是反检测的核心，以下方法论和 Payload 库提供系统性对抗参考。

### Playbook 与方法论

| 方向 | 路径 |
|------|------|
| 反爬/WAF/CDN对抗 | `references/methodology/06-anti-antibot.md` |
| 绕过工具箱 | `references/methodology/02-bypass-toolkit.md` |
| 证据纪律 | `references/methodology/03-evidence-discipline.md` |
| 内网规避 | `references/playbooks/intranet-postexp/13-evasion.md` |
| 内网隧道 | `references/playbooks/intranet-postexp/15-tunneling.md` |
| 内网持久化 | `references/playbooks/intranet-postexp/17-persistence.md` |

### H1 真实案例（按弱点分类）

| 漏洞类型 | H1 案例路径 |
|----------|------------|
| 认证绕过 | `references/h1-reports/by-weakness/authentication-bypass.md` |
| 不当认证 | `references/h1-reports/by-weakness/improper-authentication-generic.md` |
| 不当访问控制 | `references/h1-reports/by-weakness/improper-access-control-generic.md` |
| 权限提升 | `references/h1-reports/by-weakness/privilege-escalation.md` |
| 信息泄露 | `references/h1-reports/by-weakness/information-disclosure.md` |

### Payload 库

| 用途 | Payload 路径 |
|------|-------------|
| WAF绕过 | `payloads/bypass/waf-bypass.md` |
| 反弹Shell | `payloads/network/reverse-shells.md` |
| 内网Payload | `payloads/network/internal-payloads.md` |

---

## 底层原理：OPSEC不是"隐藏自己"，是"让自己看起来像正常流量"

```
防守方的检测逻辑：
1. 流量特征检测：扫描频率、User-Agent、请求模式、时间分布
2. 行为特征检测：登录失败次数、异常时段活动、非预期路径访问
3. 端点特征检测：源IP是否是已知恶意IP、是否来自VPS/代理
4. 蜜罐检测：交互模式、响应速度、文件系统布局

你的目标：让每一步操作都落在"正常"的统计分布区间内
```

---

## 决策树：什么操作需要OPSEC包裹

```
操作类型 → OPSEC选择
├── 端口扫描（nmap/masscan）
│   → proxychains + -T2 + --max-retries 1 + --scan-delay
├── Web 扫描（nuclei/sqlmap/ffuf）
│   → torsocks + -t 10 + --delay + 随机User-Agent
├── 密码爆破（hydra/john）
│   → 限速 + 分散时间 + 多来源IP
├── 持久化（后门/SSH密钥）
│   → 加密通信 + 非标准端口 + 非标准路径
├── 数据渗出
│   → 分片传输 + ICMP/DNS隧道 + 加密
└── 日常操作
    → screen会话 + 操作日志 + 定期清理
```

---

## 代理与隐身

```bash
# 1. proxychains — 强制所有流量走代理
# 配置: /etc/proxychains4.conf
# socks5 127.0.0.1 1080
# socks5 192.168.1.100 1080
proxychains nmap -sT -Pn -p 80,443 target.com
proxychains hydra -l admin -P pass.txt target.com ssh

# 2. torsocks — 走Tor网络
torsocks curl -s https://target.com
torsocks nmap -sT -Pn -p 80,443 target.com

# 3. SSH 隧道 — 通过跳板机
ssh -D 1080 -N -f user@pivot_host
# 然后 proxychains 自动走 socks5://127.0.0.1:1080

# 4. 多级代理链
# proxychains 支持 chain_len = 2 或 3
# 流量: 你 → 代理1 → 代理2 → 代理3 → 目标
```

---

## 扫描隐身

```bash
# nmap 慢速扫描（每小时50-100个端口，看起来像正常爬虫）
proxychains nmap -sT -Pn \
  -T2 \                      # 慢速（比T1快，比T3慢）
  --max-retries 1 \           # 每个端口最多重试1次
  --scan-delay 5s \           # 每个端口间隔5秒
  --max-scan-delay 30s \      # 最大间隔30秒
  --host-timeout 30m \        # 单主机最长30分钟
  -p 1-1000 \                 # 只扫常见端口
  target.com

# nuclei 限速
proxychains nuclei -u https://target.com \
  -rl 10 \                    # 每秒最多10个请求
  -c 10 \                     # 10个并发
  -timeout 10 \               # 10秒超时
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

# ffuf 限速
ffuf -u https://target.com/FUZZ -w wordlist.txt \
  -t 10 \                     # 10个线程
  -p 0.5 \                    # 每个请求间隔0.5秒
  -H "User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1)"
```

---

## 反蜜罐检测

```bash
# 蜜罐特征检测
# 连上目标后，先检查以下特征：

# 1. 系统运行时间（蜜罐通常刚启动）
uptime
# 如果 < 24小时，可疑

# 2. CPU 核心数（蜜罐通常资源很少）
nproc
# 如果 < 2，可疑

# 3. 进程数（蜜罐通常进程很少）
ps aux | wc -l
# 如果 < 50，可疑

# 4. 磁盘使用量（蜜罐通常磁盘很空）
df -h /
# 如果已用 < 20GB，可疑

# 5. /proc 文件系统（蜜罐的 /proc 可能不完整）
ls /proc/ | wc -l
cat /proc/cpuinfo | head -5
cat /proc/meminfo | head -5

# 6. 历史命令（蜜罐通常没有历史）
history | wc -l
cat ~/.bash_history | wc -l

# 7. 网络连接（蜜罐通常没有其他连接）
netstat -antp | grep ESTABLISHED

# 8. 用户活动（蜜罐通常没有其他用户）
who
w
last | head -5

# 综合判定：
# 如果 3 个以上特征异常 → 大概率是蜜罐 → 立刻撤离，不留下任何操作
```

---

## 免杀与规避

```bash
# 1. 文件免杀 — 改文件名和路径
# 不要: /tmp/shell.sh, /var/www/html/shell.php
# 改为: /var/log/nginx/access.log, /usr/share/fonts/noto.ttf

# 2. 进程免杀 — 改进程名
# python3 payload.py → /usr/sbin/rsyslogd
# exec -a rsyslogd python3 payload.py &

# 3. 流量免杀 — 加密 + 伪装
# 不用: 明文HTTP
# 用: HTTPS + 非标准端口(443之外的8443, 9443)
# 或者: DNS隧道(iodine) / ICMP隧道(ptunnel)

# 4. 时间免杀 — 在正常工作时间操作
# 目标时区 9:00-18:00 → 你的操作看起来像正常员工
# 避开凌晨和周末
```

---

## 本机环境速查

```
已安装: proxychains✅ torsocks✅ screen✅ iptables✅
限制:   proot 环境不支持 raw socket（responder不能用）
        但 proxychains + torsocks 完全可用
        没有 VPN 但可以 SSH 隧道到跳板机

OPSEC 铁律：
1. 所有扫描必须 proxychains 或 torsocks 包裹
2. 所有操作记录到 screen 会话日志
3. 进入系统前先做蜜罐检测
4. 操作完成后清理痕迹
5. 不在目标系统上留下个人工具
```

## 反爬钩子

> OPSEC 本身就是反检测的核心，反爬/WAF 对抗是 OPSEC 的重要组成部分。以下场景需在操作前预判。

| 场景 | 触发条件 | 应对策略 |
|------|----------|----------|
| WAF指纹识别缺失 | 盲目扫描被拦截 | 操作前先用 waf_fingerprint.py 识别防护类型 |
| Cloudflare拦截 | 403/503 + cf-ray | 浏览器引擎渲染 + 代理轮换 + 降低请求频率 |
| IP信誉封禁 | VPS/Tor IP 被拉黑 | 住宅代理轮换 + 多级代理链(proxychains chain_len=3) |
| 流量指纹异常 | UA/Cookie/TLS指纹被检测 | 浏览器引擎真实UA + 随机Cookie + TLS指纹伪装 |
| 速率告警 | 高频请求触发IDS/WAF | 降到5-10 req/s + 随机延迟 + 工作时间操作 |
| 行为模式异常 | 顺序扫描/无JS执行/无鼠标 | Playwright模拟真人行为 + 随机鼠标移动 + 页面停留 |
| CAPTCHA挑战 | 验证码拦截自动化 | 浏览器引擎人工辅助 / 2Captcha API |
| 数据渗出被检测 | 大量数据外传 | 分片传输 + ICMP/DNS隧道 + 加密 + 非标准端口 |

完整对抗手册：`references/methodology/06-anti-antibot.md`