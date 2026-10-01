# 社会工程与OSINT模块 (Social Engineering & OSINT)

> 钓鱼/OSINT/字典生成/邮箱/电话/社交媒体/人力情报
> 环境：visit_web✅ tavily✅ various_search✅ browser(Playwright)✅ extended_http_tools✅

---

## 知识锚点（Playbook + H1 案例）

> 本模块的实战知识锚点：playbook 流程 + H1 真实漏洞报告，两者交叉引用，确保方法论可追溯到真实案例。

### Playbook 流程

- [references/playbooks/info-disclosure.md](../../references/playbooks/info-disclosure.md) — 信息泄露通用流程，OSINT 收集 / 邮箱泄露 / 文档元数据泄露均属此范畴
- [references/playbooks/unauth-access.md](../../references/playbooks/unauth-access.md) — 未授权访问通用流程，默认凭据 / 弱凭据导致的未授权登录是社工 + 凭据攻击的典型链路

### H1 真实案例（references/h1-reports/by-weakness/）

- [phishing.md](../../references/h1-reports/by-weakness/phishing.md) — 钓鱼攻击真实报告
- [use-of-default-credentials.md](../../references/h1-reports/by-weakness/use-of-default-credentials.md) — 默认凭据真实报告（社工字典命中的高发场景）
- [insufficiently-protected-credentials.md](../../references/h1-reports/by-weakness/insufficiently-protected-credentials.md) — 凭据保护不足真实报告（明文存储 / 弱哈希）

---

## 底层原理：社工不是"骗人"，是"拼图"

```
OSINT + 社工 = 信息不对称利用

攻击者知道的 > 防守者以为攻击者知道的

OSINT 拼图逻辑：
1. 从一个点出发（邮箱/用户名/手机号/真实姓名）
2. 找到关联的第二个点（社交媒体/论坛/泄露数据库）
3. 从第二个点找到第三个点（公司/同事/项目/技术栈）
4. 重复直到拼出完整画像
5. 画像 → 定制钓鱼/字典/攻击路径

核心原则：不是"找到密码"，是"找到足够多的信息，让目标自己暴露弱点"
```

### OSINT 决策树

```
你有一个线索，是什么类型？
├── 邮箱地址 user@company.com
│   ├── 泄露检测：用 visit_web 访问 haveibeenpwned API
│   ├── 平台注册：用 visit_web 逐个检查主流平台
│   ├── Google 搜索：用 tavily 搜索邮箱
│   ├── 域名分析：whois + DNS记录 → 找到注册人
│   └── 关联账号：用邮箱前缀搜索 GitHub/StackOverflow/Twitter
├── 用户名 "zhangsan"
│   ├── 跨平台搜索：用 various_search 搜索用户名
│   ├── 社交媒体：用 visit_web 逐平台检查
│   ├── 代码仓库：用 tavily 搜索 GitHub/码云
│   └── 论坛/社区：用 tavily 搜索技术论坛
├── 手机号 138xxxx
│   ├── 归属地查询：用 visit_web 访问查询接口
│   ├── 关联账号：微信/支付宝/QQ 绑定检测
│   ├── 泄露检测：用 tavily 搜索手机号
│   └── 社交媒体：用 visit_web 检查各平台注册
├── 真实姓名 + 公司
│   ├── 搜索引擎：用 tavily 深度搜索
│   ├── 社交媒体：LinkedIn/脉脉/微博
│   ├── 公司官网：用 visit_web 爬取团队页面
│   ├── 技术博客：用 tavily 搜索技术文章
│   ├── 学术论文：用 tavily 搜索学术数据库
│   └── 会议演讲：用 tavily 搜索 SlideShare/YouTube
└── 域名 company.com
    ├── whois 查询：注册人/注册邮箱/注册电话
    ├── DNS 记录：SPF/DMARC 暴露邮件服务器
    ├── 子域名：子域可能泄露内部系统
    ├── SSL 证书：证书透明日志可能泄露子域
    ├── 员工邮箱：用 tavily 搜索 "@company.com"
    └── 技术栈：BuiltWith/Wappalyzer → 用 visit_web 分析
```

---

## 邮箱 OSINT

```bash
# === 1. 泄露检测 ===
# 用 visit_web 访问 haveibeenpwned API（不泄露完整邮箱）
# 用 tavily 搜索 "email@domain.com" 查找公开泄露
# 用 various_search 搜索邮箱前缀

# === 2. 平台注册检测（holehe 替代方案） ===
# 逐个访问主流平台的注册/找回密码页面
# 输入邮箱 → 观察响应差异
# "该邮箱已注册" vs "该邮箱未注册" → 确认是否注册

# 用浏览器引擎自动化这个流程：
python3 << 'EOF'
# 平台列表（通过响应差异判断）
platforms = {
    "GitHub": "https://github.com/signup_check/email",
    "Twitter": "https://api.twitter.com/i/users/email_available.json",
    "Instagram": "https://www.instagram.com/accounts/web_create_ajax/",
    "Spotify": "https://www.spotify.com/api/signup/validate",
    "Tumblr": "https://www.tumblr.com/svc/account/register",
    "Pinterest": "https://www.pinterest.com/resource/EmailExistsResource/get/",
    "WordPress": "https://public-api.wordpress.com/rest/v1.1/users/exists",
}
# 对每个平台：发送 POST 请求 → 检查响应 → 判断是否注册
EOF

# === 3. 邮箱前缀挖掘 ===
# 邮箱前缀 "zhangsan" 可能是：
# - GitHub: github.com/zhangsan
# - StackOverflow: stackoverflow.com/users/???
# - 微博/知乎/豆瓣/贴吧
# 用 tavily 搜索 "zhangsan github" "zhangsan site:stackoverflow.com"
```

---

## 用户名 OSINT（sherlock 替代方案）

```bash
# === 用平台工具替代 sherlock ===
# sherlock 的核心：检查用户名在 300+ 平台是否存在
# 当前环境替代方案：visit_web + various_search + tavily

# 1. 用 various_search 搜索用户名
# 不同平台返回不同结果 → 确认存在

# 2. 用 visit_web 逐平台检查
# 核心平台列表（按价值排序）：
platforms = [
    "GitHub", "GitLab", "Bitbucket",           # 代码 → 项目/技术栈
    "StackOverflow", "Medium", "Dev.to",        # 技术 → 技能/经验
    "Twitter", "LinkedIn", "Facebook",           # 社交 → 人际关系
    "Reddit", "HackerNews", "Lobsters",          # 论坛 → 兴趣/观点
    "Instagram", "Pinterest", "TikTok",          # 图片 → 生活/位置
    "YouTube", "Twitch", "Bilibili",             # 视频 → 内容/声音
    "知乎", "微博", "豆瓣", "贴吧",              # 中文 → 深度信息
    "Keybase", "Telegram", "Discord",             # 加密 → 私密通信
]

# 3. 用 browser 自动化检查
# 打开 https://github.com/{username} → 404=不存在, 200=存在
# 打开 https://twitter.com/{username} → 同理
# 截图保存证据
```

---

## 手机号 OSINT（PhoneInfoga 替代方案）

```bash
# === 用平台工具替代 PhoneInfoga ===
# PhoneInfoga 的核心：归属地 + 运营商 + 在线服务检测

# 1. 归属地和运营商
# 用 visit_web 访问在线查询接口
# 例如：https://api.xxx.com/phone?num=138xxxx
# 或直接用 tavily 搜索 "138xxxx 归属地"

# 2. 关联账号检测
# 微信：用 visit_web 检查微信绑定
# 支付宝：用 visit_web 检查支付宝注册
# QQ：用 visit_web 检查 QQ 绑定
# 微博：用 visit_web 检查微博注册

# 3. 泄露检测
# 用 tavily 搜索手机号 → 是否在公开泄露中
# 用 various_search 搜索手机号

# 4. 社交平台关联
# 用 visit_web 检查各平台"手机号登录"页面
# 观察响应差异判断是否注册
```

---

## 公司/组织 OSINT

```bash
# === 1. 员工邮箱收集 ===
# 用 tavily 搜索 "@company.com" → 公开的邮箱地址
# 用 visit_web 爬取公司官网"团队/关于"页面
# 用 tavily 搜索 "company.com site:linkedin.com" → LinkedIn 员工
# 用 visit_web 访问 LinkedIn 公司页面（公开信息）

# === 2. 技术栈识别 ===
# 用 visit_web 访问公司官网 → 查看页面源码
# 用 browser 打开官网 → 用 Wappalyzer 识别技术栈
# 查看 HTTP 响应头：Server/X-Powered-By/Cookies
curl -sI "https://company.com" | grep -iE "server|x-powered|set-cookie|x-frame"
# 查看 JavaScript 文件：框架/库版本
# 查看 CSS 类名：Bootstrap/Foundation/Tailwind 版本

# === 3. 邮箱格式推断 ===
# 已知：公司域名 company.com
# 已知：员工名 "张三" (zhangsan)
# 常见格式：zhangsan@, zhang.san@, s.zhang@, zs@, san.zhang@
# 验证：用 tavily 搜索每种格式 → 查找公开引用
# 或：用 mail-tester 验证邮箱是否存在

# === 4. 文档元数据 ===
# 下载公司公开的 PDF/Word/PPT
# 用 python3 提取元数据
python3 -c "
from PIL import Image
# PDF: 用 pdfminer 或直接 strings
# Word: 用 python-docx 或直接 strings
# 元数据可能包含：作者名、公司名、内部路径、打印机名
"
```

---

## 字典生成

```bash
# === 从 OSINT 数据生成目标字典 ===
# 输入：姓名、生日、公司、爱好、宠物名、常用词
# 输出：针对性密码字典

python3 << 'PYEOF'
import itertools

# 收集到的 OSINT 数据
info = {
    "name": "zhangsan",
    "name_cn": "张三",
    "birth": "1990",        # 或 "900305"
    "company": "alibaba",
    "dept": "dev",
    "phone": "138xxxx",
    "hobbies": ["coding", "basketball"],
    "pets": ["xiaobai"],
    "keywords": ["admin", "root", "test"],
}

passwords = set()

# 1. 基础组合
for n in [info["name"], info["name_cn"], info["name"].capitalize()]:
    for suffix in ["", "123", "1234", "123456", "@123", "2024", "2025", "!", "@", "#"]:
        passwords.add(n + suffix)

# 2. 姓名+年份
for n in [info["name"], info["name_cn"]]:
    for year in ["1990", "90", "1991", "91"]:
        passwords.add(n + year)
        passwords.add(n + "@" + year)

# 3. 姓名+公司
for n in [info["name"], info["name_cn"]]:
    for c in [info["company"], info["company"].capitalize()]:
        passwords.add(n + "@" + c)
        passwords.add(n + "_" + c)

# 4. 姓名首字母+部门
initials = ''.join(w[0] for w in info["name"].split())
for combo in [initials, initials.upper()]:
    passwords.add(combo + "_" + info["dept"])
    passwords.add(info["dept"] + "_" + combo)

# 5. 爱好/宠物
for h in info["hobbies"] + info["pets"]:
    for suffix in ["", "123", "!", "@"]:
        passwords.add(h + suffix)

# 6. 键盘模式
keyboard_patterns = ["qwerty", "1qaz2wsx", "qwerasdf", "zxcvbnm"]
passwords.update(keyboard_patterns)

# 7. 常见中文密码
cn_passwords = ["woaini", "iloveyou", "5201314", "1314520", "520520"]
passwords.update(cn_passwords)

# 去重并保存
with open("targeted_dict.txt", "w") as f:
    for p in sorted(passwords):
        if 6 <= len(p) <= 20:  # 合理长度
            f.write(p + "\n")

print(f"生成 {len(passwords)} 个候选密码，保存到 targeted_dict.txt")
PYEOF
```

---

## 钓鱼模板

```bash
# === 钓鱼邮件模板（按场景） ===

# 1. VPN/安全相关（高成功率）
"""
主题：[紧急] VPN证书即将过期 — 请立即更新

{姓名}，您好：

您的公司VPN证书将于24小时内过期。为防止远程办公中断，请立即登录以下地址更新证书：

https://vpn-{公司名}.com/renew（伪造的登录页面）

此邮件由系统自动发送，请勿回复。
如有疑问，请联系IT部门：{IT邮箱}

— {公司名} IT运维部
"""

# 2. 邮箱存储（中成功率）
"""
主题：邮箱存储空间不足警告

您的邮箱已使用 98%，超过限制后将无法收发邮件。
请点击以下链接扩容：

https://mail-{公司名}.com/quota（伪造的登录页面）

— {公司名} 邮件系统
"""

# 3. HR/薪资（高打开率）
"""
主题：[加密] {姓名} 2024年度绩效考核结果

{姓名}，您好：

您的2024年度绩效考核已完成，请点击以下链接查看详情：

https://hr-{公司名}.com/review（伪造的登录页面）

注：此邮件包含敏感信息，请勿转发。

— {公司名} 人力资源部
"""

# 4. 文件共享（中成功率）
"""
主题：{同事名} 与您共享了文件 "Q4报告.docx"

{同事名} 邀请您查看以下文件：

📎 Q4报告.docx（需要登录查看）

点击查看：https://drive-{公司名}.com/share（伪造的登录页面）

— {公司名} 企业云盘
"""

# === 钓鱼页面技术要求 ===
# 1. 克隆目标登录页面（用 browser 截图 + html-deck 重建）
# 2. HTTPS（用 Let's Encrypt 或自签名证书）
# 3. 域名相似（vpn-company.com / company-secure.com / company.co）
# 4. 自动转发到真实站点（用户输入后 → 转发到真实登录 → 用户无感知）
# 5. 收集：用户名 + 密码 + IP + User-Agent + 时间戳
```

---

## 本机环境速查

```
外部工具         本机替代方案                       能力
─────────────────────────────────────────────────────────
sherlock         visit_web + various_search         跨平台用户名检测
holehe           visit_web + 浏览器引擎             邮箱平台注册检测
PhoneInfoga      visit_web + tavily                 手机号归属/关联
theHarvester     tavily + various_search            邮箱/域名/员工搜索
Maigret          visit_web + browser 自动化         跨平台用户名深度搜索
spiderfoot       tavily(搜索) + visit_web(爬取)     自动化OSINT收集
maltego          浏览器引擎 + visit_web             关系图谱可视化
recon-ng         tavily + extended_http_tools       模块化信息收集

已安装: visit_web✅ tavily✅ various_search✅ browser(Playwright)✅ extended_http_tools✅
缺失:   sherlock/holehe/PhoneInfoga/theHarvester/Maigret
替代:   平台工具组合覆盖所有OSINT需求
        优势：不需要安装任何工具，直接使用平台原生能力
        劣势：速度比专用工具慢，但覆盖面更广（搜索引擎索引 > 工具预设列表）
```

---

## 反爬钩子

> 社工 / OSINT 模块的"反爬"最为突出：LinkedIn / GitHub / 社交平台均有严格的反爬机制（速率限制 / 登录墙 / CAPTCHA / 浏览器指纹检测）。OSINT 收集高度依赖浏览器引擎模拟真人行为。

### OSINT 场景的反爬对抗

```
可能遇到的拦截场景：
1. LinkedIn / 脉脉 严格反爬（登录墙 + 速率限制 + CAPTCHA）
   → Playwright 浏览器引擎登录后爬取（带 cookie session）
   → 降速：每次请求间隔 5-10 秒 + 随机延迟
   → tavily 搜索替代直接爬取（搜索引擎已索引的公开信息）
2. GitHub API 速率限制（未认证 60 次/小时，认证 5000 次/小时）
   → 带 Token 认证提升配额
   → 用 tavily 搜索 GitHub 内容替代 API 调用
3. 平台注册检测被 CAPTCHA / 行为分析拦截
   → Playwright 模拟真人输入（逐字符 + 随机延迟）
   → 2Captcha API 处理验证码
   → 分散到不同 IP（代理轮换）
4. 邮箱泄露检测（haveibeenpwned）API 限制
   → 用 k-anonymity 模式（只发 SHA1 前缀）
   → 用 tavily 搜索邮箱泄露替代 API
5. 文档元数据下载被 CDN 限速
   → 降速 + 随机延迟
   → 分批下载，避免触发 WAF
```

通用反爬 / WAF 对抗策略参见 [references/methodology/06-anti-antibot.md](../../references/methodology/06-anti-antibot.md)。

---

## 经验回写

每次社工/OSINT任务后记录：
- 起始线索和最终画像
- 发现的信息关联路径
- 有效的搜索关键词和平台
- 生成的字典和钓鱼模板效果