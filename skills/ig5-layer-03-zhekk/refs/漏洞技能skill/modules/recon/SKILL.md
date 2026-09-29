# 信息收集模块 (Recon)

> 渗透测试第一步：资产发现、子域收集、端口扫描、指纹识别、敏感信息泄露狩猎。
> 被动优先，主动跟进。不发包的最安全。

## 知识锚点（Playbook + H1 案例）

> 信息收集是攻击链的起点，以下 playbook 和 H1 案例提供方法论参考，字典库提供爆破基础。

### Playbook（攻击手册）

| 方向 | Playbook 路径 |
|------|--------------|
| 信息泄露 | `references/playbooks/info-disclosure.md` |
| 未授权访问 | `references/playbooks/unauth-access.md` |
| 攻击优先级方法论 | `references/methodology/01-attack-priority.md` |
| 绕过工具箱 | `references/methodology/02-bypass-toolkit.md` |

### H1 真实案例（按弱点分类）

| 漏洞类型 | H1 案例路径 |
|----------|------------|
| 信息泄露 | `references/h1-reports/by-weakness/information-disclosure.md` |
| 错误信息泄露 | `references/h1-reports/by-weakness/information-exposure-through-an-error-message.md` |
| 调试信息泄露 | `references/h1-reports/by-weakness/information-exposure-through-debug-information.md` |
| 目录列举 | `references/h1-reports/by-weakness/information-exposure-through-directory-listing.md` |
| 文件/目录信息暴露 | `references/h1-reports/by-weakness/file-and-directory-information-exposure.md` |
| 强制浏览 | `references/h1-reports/by-weakness/forced-browsing.md` |
| 配置错误 | `references/h1-reports/by-weakness/misconfiguration.md` |
| 默认凭据 | `references/h1-reports/by-weakness/use-of-default-credentials.md` |
| 硬编码凭据 | `references/h1-reports/by-weakness/use-of-hard-coded-credentials.md` |

### 字典库

| 用途 | 字典路径 |
|------|----------|
| 字典总索引 | `references/dictionaries/00-index.md` |
| 国产应用指纹 | `references/dictionaries/chinese-srcfingerprints.md` |
| 默认口令（国产） | `references/dictionaries/default-credentials-cn.md` |

## 核心原则

```
拿到一个域名，先别急着扫。
被动收集 → 主动探测 → 深度分析（JS源码）
被动：证书透明度、Wayback Machine、Google Dork、GitHub — 不发包，不触发告警
主动：子域爆破、存活探测、端口扫描、指纹识别
深度：浏览器引擎抓JS源码 → grep分析 → API端点/密钥
```

## 被动侦察

### 证书透明度
```bash
curl -s "https://crt.sh/?q=%25.{domain}&output=json" | jq -r '.[].name_value' | sort -u
```

### Wayback Machine
```bash
curl -s "https://web.archive.org/cdx/search/cdx?url=*.{domain}/*&output=text&fl=original&collapse=urlkey" | sort -u
```

### Google Dork（浏览器引擎）
```
site:{domain} filetype:sql
site:{domain} ext:env
site:{domain} inurl:admin
site:{domain} intitle:"index of"
```

### GitHub 搜索（浏览器引擎）
```
org:{company} password OR api_key OR secret
org:{company} filename:.env
org:{company} "jdbc:mysql" password
```

### 搜索引擎 Dork 速查
```
site:target.com filetype:sql | ext:env | ext:conf | ext:cfg | ext:ini
site:target.com inurl:admin | inurl:login | inurl:wp-admin
site:target.com intitle:"index of" | intitle:"dashboard"
site:target.com "password" | "secret" | "api_key"
site:pastebin.com target.com
site:github.com target.com password
```

## 主动探测

### 子域收集
```bash
subfinder -d {domain} -o subs.txt
```

### 存活探测 + 指纹
```bash
httpx -l subs.txt -status-code -title -tech-detect -o alive.txt
```

### 端口扫描
```bash
# 快速 TOP 1000
nmap -sV -sC --top-ports 1000 -iL alive_ips.txt -oA nmap_quick
# 全端口（发现Web后可做）
nmap -sV -sC -p- -iL targets.txt -oA nmap_full
# 快速扫描（masscan）
masscan -p1-65535 --rate=1000 -iL targets.txt -oG masscan.gnmap
```

### URL 采集
```bash
gau {domain} | sort -u > urls.txt
# 从JS提取端点
katana -u https://{domain} -jc -o js_endpoints.txt
```

### 指纹识别
```bash
whatweb -i alive.txt
# 国产 OA 必查特征
# 致远: /seeyon/ /seeyon/rest/
# 通达: /ispirit/ /general/
# 泛微: /weaver/ /eoffice/
# 用友: /yyoa/ /servlet/
# 金蝶: /easweb/ /shr/
# 万户: /defaultroot/ /ezoffice/
```

### Nuclei 技术栈扫描
```bash
nuclei -l alive.txt -tags tech -severity info
```

## 浏览器引擎：JS 源码深度分析

```
本机独特优势 — 用浏览器包打开页面，抓取完整 JS 源码，本地分析。

流程：
1. visit_web → 打开目标页面
2. 查看页面源码 → 提取所有 <script src="..."> 和 <script> 内联代码
3. download_file → 下载 JS 文件到本地
4. grep 分析 → 找 API 端点、密钥、隐藏功能
```

```bash
# 下载 JS 后用 grep 分析
grep -r "api_key\|secret\|token\|password\|endpoint\|authorization" js_files/
grep -r "https\?://[a-zA-Z0-9.-]\+" js_files/ | sort -u
grep -r "fetch\|axios\|ajax\|XMLHttpRequest" js_files/
grep -r "route\|path\|endpoint\|baseURL\|apiUrl" js_files/
grep -r "admin\|debug\|test\|dev\|backup\|hidden" js_files/
grep -r "TODO\|FIXME\|HACK\|XXX" js_files/
grep -r "localhost\|127.0.0.1\|10\.\|172\.\|192\.168\." js_files/
```

## Android 设备情报（ADB + Shell 引擎）

```bash
# 系统信息
adb shell getprop ro.build.version.sdk      # API 级别
adb shell getprop ro.build.version.release  # 系统版本
adb shell getprop ro.product.model          # 设备型号
adb shell getprop ro.build.fingerprint      # 完整指纹

# 应用枚举
adb shell pm list packages -3               # 第三方应用
adb shell pm list packages -s               # 系统应用
adb shell pm list packages -d               # 已禁用应用
adb shell pm list packages | grep -i "bank\|pay\|wallet\|finance"

# 网络情报
adb shell netstat -an | grep ESTABLISHED    # 当前连接
adb shell ifconfig wlan0                    # WiFi IP
adb shell dumpsys wifi                      # WiFi 详细信息

# 进程信息
adb shell ps -A | head -50
```

## 工具速查

| 工具 | 用途 | 示例 |
|------|------|------|
| subfinder | 子域收集 | `subfinder -d {domain}` |
| httpx | 存活+指纹 | `httpx -l hosts.txt -tech-detect` |
| nmap | 端口扫描 | `nmap -sV -sC {target}` |
| masscan | 快速扫描 | `masscan -p1-65535 {target}` |
| gau | URL收集 | `gau {domain}` |
| whatweb | 指纹识别 | `whatweb {url}` |
| nuclei | 模板扫描 | `nuclei -u {url} -tags tech` |
| adb | 设备情报 | `adb shell pm list packages` |

## 本机环境速查

```
已安装: nmap✅ masscan✅ subfinder(待确认) httpx(待确认) gau(待确认) whatweb(待确认)
缺失: naabu❌ → 用 nmap + masscan 替代
```

## 反爬钩子

> 信息收集阶段大量发包（子域爆破、目录扫描、端口扫描），极易触发反爬/WAF/IDS 告警。以下场景需预判。

| 场景 | 触发条件 | 应对策略 |
|------|----------|----------|
| 子域爆破被限速 | 高并发 DNS 查询触发限速 | 降低并发到 5-10 + 随机延迟 + 多 DNS 服务器轮换 |
| 目录扫描被 WAF 拦截 | ffuf/dirb 高频请求触发 403/429 | 降速 + 随机 UA + proxychains 代理轮换 |
| 端口扫描被 IDS 检测 | masscan/nmap 高速扫描 | -T2 慢速 + --scan-delay + proxychains 包裹 |
| JS 源码抓取触发 Challenge | 浏览器引擎访问触发 Cloudflare 5秒盾 | Playwright 自动等待 JS Challenge 完成 |
| Google Dork 被限速 | 搜索引擎检测自动化查询 | 浏览器引擎 + 随机间隔 10-30s + 人工辅助 |
| GitHub 搜索被限速 | API 速率限制 | 认证后提升限额 + 分页延迟 |
| 被动侦察被关联 | 证书透明度/Wayback 查询暴露来源 | 通过 proxychains/torsocks 隐藏真实 IP |

完整对抗手册：`references/methodology/06-anti-antibot.md`