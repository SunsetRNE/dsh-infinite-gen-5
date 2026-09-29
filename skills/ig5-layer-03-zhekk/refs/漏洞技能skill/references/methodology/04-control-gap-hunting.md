# 控制缺口猎杀

> 场景：常规漏洞扫描无果、找不到明确漏洞点时的系统化攻击面发现方法。
> 环境前提：Android proot Ubuntu 24.04 (aarch64) | proxychains4/torsocks | Playwright

## 1. 核心思路

找不到漏洞 ≠ 没有漏洞，而是攻击面未覆盖。按以下流程系统化补全：

```
常规扫描无果
│
├─ Step 1: 端点归类矩阵 — 把所有端点分类到功能×输入维度网格
├─ Step 2: 逐类必测清单 — 按矩阵对每个格子执行必测漏洞
├─ Step 3: JS 文件分析 — 提取隐藏 API/密钥/调试接口
├─ Step 4: 参数发现 — 隐藏参数/调试参数/JSON 扩展
└─ Step 5: 遗漏攻击面 — WebSocket/SSE/旧版API/移动端接口
```

## 2. 端点归类矩阵

将所有发现的端点按「功能类型 × 输入维度」二维分类，确保无遗漏：

| 功能＼输入 | 路径参数 | 查询参数 | 请求体(JSON) | 请求体(Form) | 文件上传 | Header/Cookie |
|-----------|---------|---------|-------------|-------------|---------|--------------|
| 认证/登录 | 越权 | SQLi/爆破 | SQLi/注入 | SQLi/注入 | - | JWT篡改 |
| 数据查询 | IDOR | SQLi/SSRF | NoSQLi | - | - | 越权 |
| 文件操作 | 路径穿越 | - | - | - | webshell/XXE | - |
| 搜索/过滤 | - | SQLi/XSS | 注入 | - | - | - |
| 管理后台 | 认证绕过 | 越权 | 注入 | 注入 | - | 提权 |
| 导出/下载 | 路径穿越 | IDOR | - | - | - | SSRF |
| 通知/推送 | - | SSRF | XSS | - | - | - |
| 第三方回调 | SSRF | SSRF | 注入 | 注入 | - | - |

> 矩阵中每个格子都是一个测试单元，未测试的格子即为「控制缺口」。

## 3. 每类端点的必测漏洞清单

| 端点类型 | 必测漏洞 | 第一动作 |
|----------|---------|---------|
| 认证/登录 | 爆破、SQL注入、JWT篡改、认证绕过 | 去除 token 重放 |
| 数据查询 | IDOR、SQL注入、越权 | 递增/递减 ID 对比 |
| 文件操作 | 路径穿越、任意文件读/写、XXE | `../` 穿越探测 |
| 搜索/过滤 | SQL注入、XSS、通配符注入 | 单引号+特殊字符 |
| 管理后台 | 认证绕过、越权、CSRF | 普通用户访问管理路由 |
| 导出/下载 | IDOR、路径穿越、SSRF | 篡改导出文件 ID |
| 第三方回调 | SSRF、RCE、注入 | 修改回调 URL 为内网 |

确认漏洞后按 `01-attack-priority.md` 优先级处理，按 `03-evidence-discipline.md` 固化证据。

## 4. JS 文件分析方法

前端 JS 文件是隐藏攻击面的金矿。

```bash
# 抓取目标所有 JS 文件
proxychains4 curl -s "https://target.com/" | \
  grep -oE 'src="[^"]+\.js[^"]*"' | sed 's/src="//;s/"//' > js-files.txt

# 批量下载 JS
while read js; do
  proxychains4 curl -s "$js" >> all-js.txt
done < js-files.txt

# 提取 API 端点
grep -oE '(/api/[a-zA-Z0-9/_-]+)' all-js.txt | sort -u > api-endpoints.txt

# 提取密钥/Token（常见 key 命名模式）
grep -oiE '(api[_-]?key|secret|token|password|auth)["\x27]?\s*[:=]\s*["\x27][^"\x27]{8,}' all-js.txt

# 提取调试接口
grep -oiE '(debug|test|dev|internal|admin|backdoor)[a-zA-Z0-9/_-]*' all-js.txt | sort -u

# 提取云存储/第三方服务地址
grep -oE 'https?://[a-zA-Z0-9.-]+\.(amazonaws\.com|aliyuncs\.com|tencentcos\.cn|cloudfront\.net)[^ "'\'']*' all-js.txt
```

## 5. 参数发现方法

### 5.1 隐藏参数

```bash
# 用字典探测隐藏参数（经 proxychains 出网）
proxychains4 ffuf -u "https://target.com/api/user?FUZZ=1" \
  -w /usr/share/wordlists/params.txt \
  -mc 200,302,500 -fs 0 -t 5

# 常见隐藏参数关键词：admin, debug, test, internal, role, isadmin, access, verify
```

### 5.2 调试参数

| 参数名 | 测试目的 |
|--------|---------|
| `debug=1` | 开启调试输出 |
| `test=true` | 测试模式 |
| `admin=true` | 管理员标记 |
| `role=admin` | 角色篡改 |
| `internal=1` | 内部接口标记 |
| `verbose=1` | 详细输出 |

### 5.3 JSON 扩展

```bash
# 向 JSON 请求体追加额外字段，测试是否被后端解析
proxychains4 curl -s -X POST "https://target.com/api/profile" \
  -H "Content-Type: application/json" \
  -d '{"name":"test","role":"admin","is_admin":true,"permissions":["all"]}'
```

## 6. 容易遗漏的攻击面

### 6.1 WebSocket

```bash
# 探测 WebSocket 端点
proxychains4 websocat -v "wss://target.com/ws" --proxy socks5://127.0.0.1:9050
# WebSocket 通常不走 WAF 规则，适合注入/越权测试
```

### 6.2 Server-Sent Events (SSE)

```bash
# 探测 SSE 端点
proxychains4 curl -s -N -H "Accept: text/event-stream" \
  "https://target.com/events" | head -20
```

### 6.3 旧版 API

```bash
# 旧版 API 往往缺少最新安全控制
for ver in v1 v2 v0 beta internal; do
  proxychains4 curl -s -o /dev/null -w "%{http_code} /api/$ver/\n" \
    "https://target.com/api/$ver/users"
done
```

### 6.4 移动端专用接口

```bash
# 移动端接口常缺少 Web 侧的访问控制
proxychains4 curl -s "https://target.com/api/v1-mobile/user/profile" \
  -H "User-Agent: okhttp/4.9.0" -H "X-App-Version: 3.0.0"

# 移动端 API 域名探测
proxychains4 curl -s "https://app.target.com/api/" 
proxychains4 curl -s "https://m.target.com/api/"
```

## 7. 缺口猎杀决策树

```
所有矩阵格子已测且无漏洞?
├─ 否 → 继续测试未覆盖格子（回到第2节）
└─ 是 ↓
   ├─ JS 文件已分析?
   │   ├─ 否 → 执行第4节
   │   └─ 是 ↓
   ├─ 隐藏参数已探测?
   │   ├─ 否 → 执行第5节
   │   └─ 是 ↓
   ├─ 遗漏攻击面已覆盖?
   │   ├─ 否 → 执行第6节
   │   └─ 是 ↓
   └─ 检查时间盒（见 05-srctimebox-priority.md）
       ├─ 有剩余时间 → 深链挖掘（组合漏洞）
       └─ 无剩余时间 → 收尾，记录已覆盖矩阵
```

## 8. 与其他方法论的关联

- 发现漏洞后回到：`01-attack-priority.md` 确定优先级
- 遇到拦截时切换：`02-bypass-toolkit.md` 绕过工具箱
- 侦察结果存入：`03-evidence-discipline.md` 的 `field-journal/recon/`
- 时间不足时参考：`05-srctimebox-priority.md` 决定覆盖范围
