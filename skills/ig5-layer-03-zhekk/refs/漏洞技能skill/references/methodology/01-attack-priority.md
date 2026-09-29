# 攻击优先级决策树

> 环境前提：Android proot Ubuntu 24.04 (aarch64 ARM64) | proxychains4 / torsocks IP 隐藏 | Playwright 反爬引擎

## 1. 优先级总排序

```
RCE > 文件写入 > 认证绕过 > SQL注入 > SSRF > 信息泄露 > XSS > 越权
P0      P1         P2         P3       P4      P5         P6    P7
```

| 优先级 | 漏洞类型 | 危害等级 | 典型判定信号 | 第一步动作 |
|--------|----------|----------|--------------|-----------|
| P0 | RCE 远程代码执行 | 严重 | 回显命令输出 / 延时可控 / DNS 带外 | 立即固化证据，停止自动化探测 |
| P1 | 文件写入/上传 | 严重 | 上传后路径可访问 / 写入成功响应 | 验证可执行性（webshell 落地） |
| P2 | 认证绕过 | 严重 | 无 token 访问受保护资源 / 篡改响应 | 构造最小 PoC 复现 |
| P3 | SQL 注入 | 高 | 布尔/延时/联合/报错特征 | sqlmap --batch 验证（仅确认） |
| P4 | SSRF | 高 | 内网响应 / 带外回调 | 确认可达内网段与云元数据 |
| P5 | 信息泄露 | 中 | 状态码 200 + 敏感字段 | 截图 + 脱敏记录 |
| P6 | XSS | 中 | payload 反射/存储/渲染 | 验证 cookie/token 可窃取性 |
| P7 | 越权 | 中 | 不同账号数据交叉可见 | 记录差异对比证据 |

## 2. 决策树

```
入口：发现疑似漏洞点
│
├─ 能否执行任意系统命令？
│   ├─ 是 → P0 RCE → 停止探测，固化证据（见 03-evidence-discipline.md）
│   └─ 否 ↓
├─ 能否向服务器写入/上传文件？
│   ├─ 是 → P1 文件写入 → 验证可执行性
│   └─ 否 ↓
├─ 能否在无凭据/篡改凭据下访问受保护功能？
│   ├─ 是 → P2 认证绕过 → 构造最小 PoC
│   └─ 否 ↓
├─ 输入是否拼入数据库查询且可控？
│   ├─ 是 → P3 SQL注入 → 布尔/延时验证（禁用 --dump）
│   └─ 否 ↓
├─ 能否让服务器发起对内网/外部的请求？
│   ├─ 是 → P4 SSRF → 探测云元数据 169.254.169.254
│   └─ 否 ↓
├─ 响应中是否含未授权敏感数据？
│   ├─ 是 → P5 信息泄露 → 截图脱敏
│   └─ 否 ↓
├─ 输入是否在页面中反射/存储并渲染？
│   ├─ 是 → P6 XSS → 验证上下文（HTML/JS/属性）
│   └─ 否 ↓
└─ 能否访问非自身权限的数据/功能？
    ├─ 是 → P7 越权 → 双账号对比
    └─ 否 → 进入控制缺口猎杀（见 04-control-gap-hunting.md）
```

## 3. 按目标类型的优先级调整

不同目标类型下，优先级会发生偏移。下表标注"提升/降低"相对总排序的变化。

| 目标类型 | 优先提升项 | 优先降低项 | 调整理由 |
|----------|-----------|-----------|----------|
| Web 应用 | 文件上传(P1) | XSS(P6) | Web 上传面广，XCS 噪声大 |
| API 接口 | 认证绕过(P2)、越权(P7) | XSS(P6) | API 无渲染层，越权是核心 |
| 内网渗透 | SSRF(P4)、RCE(P0) | XSS(P6) | 内网打通靠 SSRF/RCE |
| 移动端 | 硬编码密钥(P5)、API越权(P7) | XSS(P6) | 移动端逆向产出密钥+接口 |

## 4. 按时间盒的取舍策略

| 时间盒 | 优先攻击面 | 放弃项 | 详细策略 |
|--------|-----------|--------|----------|
| 6h | 信息泄露、默认凭据、未授权 | RCE 深挖、复杂注入 | 见 `05-srctimebox-priority.md` |
| 单日 | 认证绕过、SQL注入、SSRF | 二进制利用、复杂链 | 快速出货路线 |
| HVV | RCE、文件写入、内网横向 | 低危信息泄露 | 高危优先，多目标轮转 |
| 月度 | 全量覆盖 + 深链挖掘 | 无 | 按本文件 P0-P7 全量推进 |

时间盒不足时的通用取舍原则：

```
剩余时间 < 预估验证成本 × 1.5  →  放弃该点，切换下一个
高优先级信号出现（P0-P2）      →  立即全力投入，暂停其他
```

## 5. 第一步动作命令速查

所有命令通过 proxychains4 隐藏源 IP；Playwright 用于绕过 JS 挑战。

```bash
# P0 RCE 确认（延时法，避免落地文件）
proxychains4 curl -s -o /dev/null -w '%{time_total}' \
  "https://target/api/exec?cmd=ping+-c+3+127.0.0.1"

# P1 文件写入验证（上传后探测可访问性）
proxychains4 curl -s -X POST -F "file=@shell.php" \
  "https://target/upload" -D resp_header.txt
# 确认落地点
proxychains4 curl -s "https://target/uploads/shell.php" | head -5

# P2 认证绕过（去除 token 重放）
proxychains4 curl -s "https://target/api/user/profile" \
  -H "Cookie: " -D - | head -20

# P3 SQL注入（仅布尔确认，不 dump）
proxychains4 sqlmap -u "https://target/item?id=1" --batch \
  --technique=B --level 3 --threads 1 --proxy socks5://127.0.0.1:9050

# P4 SSRF 探测云元数据
proxychains4 curl -s "https://target/fetch?url=http://169.254.169.254/latest/meta-data/"

# Playwright 绕 JS 挑战后抓取（用于信息泄露/XSS 渲染确认）
npx playwright-core launch chromium --proxy-server=socks5://127.0.0.1:9050
```

## 6. 优先级验证信号识别

在投入验证前，先用以下信号快速判定优先级归属，避免在低优先级点浪费过多时间。

| 信号特征 | 判定优先级 | 验证方法 |
|----------|-----------|---------|
| 响应时间随输入可控（3s/5s/10s） | P0 或 P3 | 延时注入确认 RCE vs SQLi |
| 文件上传返回绝对/相对路径 | P1 | 访问返回路径验证落地 |
| 去除 Authorization 头仍返回 200 | P2 | 对比有无头响应差异 |
| 报错含数据库语法/字段名 | P3 | 报错注入确认 |
| URL 参数可控且服务器发起外部请求 | P4 | DNSLog/内网回连确认 |
| 响应体含手机号/身份证/密钥 | P5 | 截图+脱敏 |
| 输入在 HTML 上下文中原样输出 | P6 | 上下文感知 payload 确认 |
| 替换 ID 返回其他用户数据 | P7 | 双账号交叉验证 |

### 信号冲突时的裁决规则

```
多个信号同时出现?
├─ 含 P0 信号 → 一律按 P0 处理（最高优先）
├─ 含 P1 信号 → 按 P1 处理
├─ P3 + P6 同时出现 → 先验证 P3（危害更高），P6 并行记录
├─ P5 + P7 同时出现 → 先 P7（越权价值更高），P5 附带记录
└─ 仅 P6/P7 → 按 ROI 决定（见 05-srctimebox-priority.md）
```

## 7. 与其他方法论的关联

- 漏洞点确认后立即执行：`03-evidence-discipline.md` 证据固化流程
- 遇到 WAF 拦截时切换：`02-bypass-toolkit.md` 四层绕过决策树
- 找不到漏洞点时进入：`04-control-gap-hunting.md` 控制缺口猎杀
- 时间不足时参考：`05-srctimebox-priority.md` 时间盒优先级
