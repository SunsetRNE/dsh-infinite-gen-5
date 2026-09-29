# 反爬 / WAF / CDN 对抗层

> 任务中被反爬/WAF/CDN拦截 = 任务失败。本文件是所有阶段共享的对抗手册。
> 环境：Playwright浏览器引擎✅ proxychains✅ torsocks✅ Python requests✅

---

## 核心原则：让流量看起来像人，不像机器

```
防守方检测维度：
1. IP信誉     → VPS/Tor/已知扫描器IP → 代理轮换
2. 速率       → 每秒50请求 → 降到每秒5-10请求 + 随机延迟
3. 指纹       → UA/cookie/TLS指纹 → 浏览器引擎渲染
4. 行为       → 顺序扫描/无鼠标/无JS执行 → Playwright模拟真人
5. CAPTCHA    → 验证码挑战 → 浏览器引擎人工辅助/2Captcha API
```

---

## 第0步：识别目标防护（任何操作前必做）

```bash
# 1. WAF 指纹识别（脚本优先）
python3 scripts/web/waf_fingerprint.py -u https://target.com

# 2. WAF 存在性检测
python3 scripts/web/waf_detect.py -u https://target.com

# 3. 自适应检测（高级，动态阈值）
python3 scripts/web/waf_adaptive_detect.py -u https://target.com

# 4. 手工快速判断
proxychains curl -sI https://target.com
# 看返回头：
#   cf-ray → Cloudflare
#   X-Amzn-RequestId / x-amz-cf-id → AWS WAF + CloudFront
#   Server: cloudflare → Cloudflare
#   406 Not Acceptable → ModSecurity
#   X-WAF-Error → 阿里云WAF
#   Set-Cookie: __jsluid → 加速乐/极验

# 5. wafw00f（如果装了）
proxychains wafw00f https://target.com
```

---

## 常见防护识别与对策

### Cloudflare（最常见）

```
特征：
  - cf-ray header
  - 403/503 block page（含 "Attention Required"）
  - /cdn-cgi/challenge-platform/ 路径
  - JS challenge（5秒盾）
  - Turnstile CAPTCHA

对策：
  1. Playwright 浏览器引擎（首选）— 完整渲染JS challenge
  2. 降速到每秒3-5请求
  3. 用真实浏览器UA + Accept-Language + sec-ch-ua
  4. 保持cookie session（CF发__cf_bm cookie，后续请求带上）
  5. 源站直连：找Cloudflare回源IP（FOFA搜索SSL证书/历史DNS）
     curl --resolve target.com:443:{回源IP} https://target.com/
```

### AWS WAF

```
特征：
  - X-Amzn-RequestId / x-amz-cf-id header
  - 403 Forbidden
  - WAF规则：SQLi/XSS/速率限制

对策：
  1. 速率限制 → 降到每秒5请求以下
  2. SQLi规则 → 用 payloads/bypass/waf-bypass.md 的编码绕过
  3. XSS规则 → 上下文逃逸 + 编码变体
```

### 阿里云WAF / 加速乐

```
特征：
  - X-WAF-Error header
  - Set-Cookie: __jsluid（加速乐）
  - 405 Method Not Allowed
  - 滑块验证码

对策：
  1. __jsluid cookie → Playwright 执行JS获取合法cookie后复用
  2. 滑块 → Playwright 模拟拖拽 / 2Captcha API
  3. 降速 + 正常UA
```

### ModSecurity / 长亭雷池

```
特征：
  - 406 Not Acceptable（ModSecurity默认）
  - 长亭雷池特殊block page

对策：
  1. 规则匹配 → 编码层绕过（双重编码/Unicode/混合编码）
  2. 语义层绕过（注释插入/双写/等价函数）
  3. 参见 payloads/bypass/waf-bypass.md 263种变体
```

---

## 对抗武器库（按强度递增）

### Level 1：请求头伪装（最基础，必须做）

```bash
# 所有请求 MUST 带完整真实浏览器头
proxychains curl -s https://target.com/ \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8" \
  -H "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8" \
  -H "Accept-Encoding: gzip, deflate, br" \
  -H "Connection: keep-alive" \
  -H "sec-ch-ua: \"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"" \
  -H "sec-ch-ua-mobile: ?0" \
  -H "sec-ch-ua-platform: \"Windows\"" \
  -H "Upgrade-Insecure-Requests: 1"

# Python requests 版本
python3 -c "
import requests
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'sec-ch-ua': '\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\"',
}
# 每次请求随机选UA
import random
ua_list = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0',
]
headers['User-Agent'] = random.choice(ua_list)
r = requests.get('https://target.com/', headers=headers, proxies={'https':'socks5://127.0.0.1:9050'})
"
```

### Level 2：速率控制 + 随机延迟

```bash
# nmap 慢速
proxychains nmap -sT -Pn -T2 --max-retries 1 --scan-delay 5s -p 1-1000 target.com

# ffuf 限速
ffuf -u https://target.com/FUZZ -w wordlist.txt -t 5 -p 1-3 \
  -H "User-Agent: Mozilla/5.0" -ac

# nuclei 限速
proxychains nuclei -u https://target.com -rl 5 -c 5 -timeout 15 \
  -H "User-Agent: Mozilla/5.0"

# Python 随机延迟扫描
python3 -c "
import requests, time, random
urls = open('targets.txt').read().splitlines()
session = requests.Session()
session.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
for url in urls:
    try:
        r = session.get(url, timeout=10, proxies={'https':'socks5://127.0.0.1:9050'})
        print(f'{r.status_code} {url}')
    except: pass
    time.sleep(random.uniform(2, 8))  # 随机2-8秒延迟
"
```

### Level 3：Playwright 浏览器引擎（反爬主力，最强）

> 当 Level 1-2 被拦截时 MUST 切换到浏览器引擎。Playwright 完整渲染JS、执行challenge、维护cookie session。

```python
# Playwright 反爬模板（通过 browser 引擎调用）
# 适用于：Cloudflare 5秒盾 / JS challenge / 动态渲染页面 / 需要登录的页面

from playwright.sync_api import sync_playwright
import random, time

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        proxy={'server': 'socks5://127.0.0.1:9050'}  # 走Tor/代理
    )
    context = browser.new_context(
        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0',
        viewport={'width': 1920, 'height': 1080},
        locale='zh-CN',
        extra_http_headers={
            'Accept-Language': 'zh-CN,zh;q=0.9',
        }
    )
    page = context.new_page()
    
    # 1. 访问首页（让JS challenge执行）
    page.goto('https://target.com/', wait_until='networkidle')
    time.sleep(random.uniform(3, 7))  # 等challenge完成
    
    # 2. 获取cookie（后续可复用）
    cookies = context.cookies()
    print(f'Got {len(cookies)} cookies')
    
    # 3. 模拟真人浏览（鼠标移动 + 滚动）
    page.mouse.move(random.randint(100, 800), random.randint(100, 600))
    page.evaluate('window.scrollTo(0, document.body.scrollHeight / 2)')
    time.sleep(random.uniform(1, 3))
    
    # 4. 访问目标页面
    page.goto('https://target.com/admin', wait_until='networkidle')
    content = page.content()
    print(page.title())
    
    # 5. 提取cookie给后续curl使用
    cookie_str = '; '.join([f"{c['name']}={c['value']}" for c in cookies])
    print(f'Cookie: {cookie_str}')
    
    browser.close()

# 后续curl复用cookie绕过challenge
# proxychains curl -s https://target.com/admin -H "Cookie: {cookie_str}" -H "User-Agent: ..."
```

```python
# Playwright 目录爆破（绕过WAF的目录扫描）
# 当 ffuf 被 WAF 拦截时用这个

from playwright.sync_api import sync_playwright
import time

wordlist = open('wordlist.txt').read().splitlines()[:200]  # 小批量
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    )
    page = context.new_page()
    
    for path in wordlist:
        url = f'https://target.com/{path}'
        response = page.goto(url, wait_until='domcontentloaded', timeout=10000)
        if response and response.status not in [404, 403]:
            print(f'[{response.status}] {url}')
        time.sleep(random.uniform(0.5, 2))  # 随机延迟
    
    browser.close()
```

### Level 4：Cookie Session 复用

```bash
# 策略：先用浏览器引擎获取合法cookie，再用curl高速复用
# 1. Playwright 获取cookie（见上面代码）
# 2. 导出cookie到文件
# 3. curl 复用

# 从浏览器导出cookie后
COOKIE="__cf_bm=xxx; __jsluid=yyy; session=zzz"
proxychains curl -s https://target.com/api/users \
  -H "Cookie: $COOKIE" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

# Python requests session复用
python3 -c "
import requests
s = requests.Session()
s.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
# 先访问首页获取cookie
s.get('https://target.com/', proxies={'https':'socks5://127.0.0.1:9050'})
# 后续请求自动带cookie
r = s.get('https://target.com/admin', proxies={'https':'socks5://127.0.0.1:9050'})
"
```

### Level 5：代理轮换

```bash
# proxychains 多代理配置
# /etc/proxychains4.conf
# dynamic_chain
# proxy_dns
# [ProxyList]
# socks5 127.0.0.1 1080
# socks5 代理2 端口
# socks5 代理3 端口

# 每N个请求换代理
python3 -c "
import requests, random

proxies = [
    {'https': 'socks5://127.0.0.1:1080'},
    {'https': 'socks5://127.0.0.1:1081'},
    {'https': 'socks5://127.0.0.1:9050'},  # Tor
]

for url in target_urls:
    proxy = random.choice(proxies)
    try:
        r = requests.get(url, proxies=proxy, timeout=10,
                        headers={'User-Agent': 'Mozilla/5.0'})
    except: pass
"
```

---

## 按阶段的对抗策略

### Phase 2 (Recon) 被反爬时

```
CT日志/FOFA/Shodan 被反爬：
  → Playwright 访问（带登录态如果需要API key）
  → tavily/various_search 替代直接爬取
  → extended_http_tools 带完整header访问
```

### Phase 3 (Enum) 被反爬时

```
端口扫描被拦：
  → 降速 -T2 --scan-delay 5s
  → 换代理出口IP
  → 分散到不同时段扫描

目录爆破被WAF拦（403/429）：
  → Playwright 浏览器引擎扫描（Level 3）
  → 降低并发到 1-5 线程
  → 加随机延迟 1-3 秒
  → 换 User-Agent

指纹识别被拦：
  → 用 extended_http_tools 带完整header
  → Playwright 渲染后提取页面特征
```

### Phase 4 (Hunt) 被反爬时

```
Payload 被WAF拦：
  → Read payloads/bypass/waf-bypass.md 选对应编码
  → python3 scripts/web/payload_mutator.py 变异payload
  → python3 scripts/web/adaptive_bypass.py 自适应绕过
  → 切换入口（Header注入/Cookie注入/JSON体）

验证码挑战：
  → Playwright 渲染（可能自动过简单JS challenge）
  → 人工辅助（通知用户在浏览器中完成验证）
  → 2Captcha API（如果配了key）

IP被封：
  → 换代理出口
  → 等待冷却（通常15-60分钟）
  → Tor换电路：sudo systemctl restart tor
```

---

## CAPTCHA 应对策略

```
CAPTCHA类型 → 应对
├── JS Challenge（Cloudflare 5秒盾）
│   → Playwright 自动过（wait_until='networkidle' + sleep）
├── 简单算术验证码
│   → Playwright + OCR（pytesseract）识别
├── 滑块验证码
│   → Playwright 模拟拖拽（带轨迹随机化）
├── reCAPTCHA / hCaptcha / Turnstile
│   → 2Captcha API（付费，需API key）
│   → 人工辅助（通知用户）
└── 图片选字
    → 2Captcha API / 人工辅助
```

---

## 决策树：被拦了怎么办

```
请求被拦（403/429/503/CAPTCHA页面）
├── 是WAF还是CDN？
│   ├── WAF（规则拦截）→ 02-bypass-toolkit.md + waf-bypass.md
│   └── CDN（JS challenge/CAPTCHA）→ Playwright浏览器引擎
├── 是IP被封还是规则拦截？
│   ├── IP被封 → 换代理 / Tor换电路 / 等冷却
│   └── 规则拦截 → 编码绕过 / 降速 / 换入口
├── 是速率触发还是payload触发？
│   ├── 速率触发 → 降速 + 随机延迟
│   └── payload触发 → 变异payload / 换入口（Header/Cookie/JSON）
└── 尝试过Level 1-3还不行？
    ├── Playwright浏览器引擎渲染
    ├── Cookie session复用
    └── 代理轮换
```

---

## 环境速查

```
反爬武器：
  Level 1: 请求头伪装（curl -H / requests headers）✅
  Level 2: 速率控制（--scan-delay / -rl / random sleep）✅
  Level 3: Playwright浏览器引擎（browser 包）✅ ← 主力
  Level 4: Cookie session复用 ✅
  Level 5: 代理轮换（proxychains multi-proxy）✅

OPSEC配合：
  所有反爬操作 MUST 走代理（proxychains/torsocks）
  Playwright 的 proxy 参数设为 socks5://127.0.0.1:9050
  浏览器指纹也要走代理，不能裸奔
```
