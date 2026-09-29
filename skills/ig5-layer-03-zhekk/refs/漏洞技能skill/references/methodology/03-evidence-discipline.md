# 证据纪律

> 红线原则：无证据不下结论。每一个漏洞判定都必须有可复现的证据支撑。
> 环境前提：Android proot Ubuntu 24.04 (aarch64) | 所有操作经 proxychains4/torsocks 出网

## 1. 红线规则

| 规则 | 说明 |
|------|------|
| 无证据不下结论 | 未捕获请求/响应/截图的"疑似漏洞"不得写入报告 |
| 证据可复现 | PoC 脚本须能独立复现，不依赖临时会话状态 |
| 敏感数据必脱敏 | 手机号/身份证/密码/Token 在证据中必须打码 |
| 证据链完整 | 请求→响应→截图→PoC 须一一对应，不可缺环 |
| 原始包不篡改 | 保存原始 HTTP 包，脱敏仅作用于副本和截图 |

## 2. 证据收集清单

每个漏洞至少收集以下证据，缺一不可：

```
漏洞证据包 (field-journal/<vuln-id>/)
├── 01-request.txt        原始 HTTP 请求包（含方法/路径/头/体）
├── 02-response.txt       原始 HTTP 响应包（含状态码/头/体）
├── 03-screenshot.png     浏览器/终端截图（含 URL 和时间戳）
├── 04-poc.sh             可独立执行的 PoC 脚本
├── 05-reproduce.log      PoC 执行输出日志
└── 06-meta.yaml          元数据（目标/漏洞类型/CVSS/时间）
```

### 收集命令模板

```bash
# 设置漏洞 ID 与目录
VID="SQLI-20260807-001"
mkdir -p field-journal/$VID

# 保存请求+响应（-D 存头，-o 存体，--include 完整包）
proxychains4 curl -s --include -D field-journal/$VID/02-response.txt \
  "https://target.com/?id=1'+OR+1=1--" \
  -o field-journal/$VID/02-response-body.txt

# 截图（Playwright 无头截图）
node -e "
const {chromium}=require('playwright-core');
(async()=>{
  const b=await chromium.launch({proxy:{server:'socks5://127.0.0.1:9050'}});
  const p=await b.newPage();
  await p.goto('https://target.com/?id=1%27%20OR%201=1--');
  await p.screenshot({path:'field-journal/$VID/03-screenshot.png',fullPage:true});
  await b.close();
})();
"

# PoC 脚本（带 proxychains，可独立复现）
cat > field-journal/$VID/04-poc.sh << 'EOF'
#!/bin/bash
# PoC: SQL Injection (Boolean-based)
proxychains4 curl -s "https://target.com/?id=1'+OR+1=1--"
EOF
chmod +x field-journal/$VID/04-poc.sh
```

## 3. 证据保存规范

### 目录结构

```
field-journal/
├── recon/                    侦察阶段记录
│   ├── endpoints.txt         端点清单
│   └── js-analysis.md        JS 分析结果
├── SQLI-20260807-001/        漏洞证据包（见第2节）
├── SSRF-20260807-002/
└── INFO-20260807-003/
```

### 命名规则

| 类型 | 格式 | 示例 |
|------|------|------|
| 漏洞目录 | `<VULTYPE>-<YYYYMMDD>-<SEQ>` | `SQLI-20260807-001` |
| 证据文件 | `<序号>-<描述>.<ext>` | `01-request.txt` |
| 截图 | `03-screenshot.png` | 含 URL 水印 |
| 元数据 | `06-meta.yaml` | YAML 格式 |

### 元数据模板 (06-meta.yaml)

```yaml
vuln_id: SQLI-20260807-001
target: https://target.com
endpoint: /?id=1
vuln_type: SQL Injection
technique: Boolean-based
severity: High
cvss_4: 8.1
discovered_at: 2026-08-07T14:30:00+08:00
tool: manual + sqlmap-confirm
```

## 4. 敏感数据脱敏规则

| 数据类型 | 脱敏规则 | 示例 |
|----------|----------|------|
| 手机号 | 保留前3后4，中间4位用 `****` | `138****5678` |
| 身份证 | 保留前6后4，中间8位用 `********` | `110101********1234` |
| 密码 | 全部替换为 `***REDACTED***` | `***REDACTED***` |
| Token/Key | 保留前4后4，中间用 `...` | `eyJhb...XkF2` |
| 邮箱 | 用户名首字母+`***`+域名 | `z***@example.com` |
| 银行卡 | 保留后4位 | `**** **** **** 1234` |

### 批量脱敏命令

```bash
# 对响应副本批量脱敏（原始包保留，仅处理副本）
sed -E \
  -e 's/(1[3-9])[0-9]{4}([0-9]{4})/\1****\2/g' \
  -e 's/([0-9]{17})[0-9Xx]/\1********1234/g' \
  -e 's/(Bearer [A-Za-z0-9]{4})[A-Za-z0-9]+([A-Za-z0-9]{4})/\1...\2/g' \
  02-response.txt > 02-response-redacted.txt
```

## 5. 证据链完整性检查清单

每个漏洞提交前逐项核对：

```
[ ] 原始 HTTP 请求包已保存（含完整头和请求体）
[ ] 原始 HTTP 响应包已保存（含状态码和响应体）
[ ] 截图清晰可读，包含目标 URL
[ ] PoC 脚本可独立执行且复现成功
[ ] 执行日志已保存
[ ] 元数据 YAML 已填写完整
[ ] 敏感数据已脱敏（检查响应体/截图）
[ ] 漏洞判定与证据一致（请求中 payload → 响应中效果）
[ ] CVSS 4.0 评分已标注
[ ] 时间戳准确
```

## 6. CVSS 4.0 评分指引

CVSS 4.0 基础指标分三组，按实际漏洞场景选取：

| 指标组 | 指标 | 取值 | 说明 |
|--------|------|------|------|
| 攻击途径 (AV) | 网络可达性 | N/A/L/P | 网络/邻接/本地/物理 |
| 攻击复杂度 (AC) | 利用难度 | L/H | 低/高 |
| 攻击要求 (AT) | 前置条件 | N/P | 无/有 |
| 用户交互 (UI) | 是否需用户参与 | N/A | 无/有 |
| 权限要求 (PR) | 所需权限 | N/L/H | 无/低/高 |
| 影响-机密性 (VC) | 对系统机密性影响 | H/L/N | 高/低/无 |
| 影响-完整性 (VI) | 对系统完整性影响 | H/L/N | 高/低/无 |
| 影响-可用性 (VA) | 对系统可用性影响 | H/L/N | 高/低/无 |

### 快速评分参考

| 漏洞类型 | 典型向量 | 评分区间 |
|----------|---------|---------|
| RCE | AV:N/AC:L/AT:N/UI:N/PR:N/VC:H/VI:H/VA:H | 9.0+ (Critical) |
| SQL 注入 | AV:N/AC:L/AT:N/UI:N/PR:N/VC:H/VI:L/VA:N | 8.0-9.0 (High) |
| SSRF | AV:N/AC:L/AT:N/UI:N/PR:L/VC:H/VI:N/VA:N | 7.0-8.0 (High) |
| 认证绕过 | AV:N/AC:L/AT:N/UI:N/PR:N/VC:H/VI:H/VA:N | 8.0-9.0 (High) |
| 信息泄露 | AV:N/AC:L/AT:N/UI:N/PR:N/VC:L/VI:N/VA:N | 5.0-6.0 (Medium) |
| XSS | AV:N/AC:L/AT:N/UI:A/PR:N/VC:L/VI:L/VA:N | 5.0-6.0 (Medium) |
| 越权 | AV:N/AC:L/AT:N/UI:N/PR:L/VC:H/VI:N/VA:N | 6.0-7.0 (Medium) |

## 7. 与其他方法论的关联

- 漏洞发现流程：`01-attack-priority.md` → 确认后执行本文件证据固化
- 绕过有效变体：`02-bypass-toolkit.md` 的有效 payload 须写入证据链
- 攻击面记录：`04-control-gap-hunting.md` 的侦察结果存入 `field-journal/recon/`
- 时间盒取舍：`05-srctimebox-priority.md` 决定哪些证据需完整收集
