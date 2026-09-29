# 攻击链编排 (Attack Chain Orchestration)

> 多阶段攻击路径规划与自动执行。把散落的模块串成完整的攻击链。
> 环境：本机全部33个工具 + 4引擎联动

---

## 知识锚点（Playbook + H1 案例）

> 攻击链编排覆盖全阶段，以下 playbook 提供每一步的完整攻击手册，H1 案例提供真实漏洞参考，Payload 库提供现成投递载荷。

### 方法论

| 方向 | 路径 |
|------|------|
| 攻击优先级 | `references/methodology/01-attack-priority.md` |
| 绕过工具箱 | `references/methodology/02-bypass-toolkit.md` |
| 证据纪律 | `references/methodology/03-evidence-discipline.md` |
| 反爬/WAF/CDN对抗 | `references/methodology/06-anti-antibot.md` |
| Playbook总索引 | `references/playbooks/00-index.md` |

### Playbook（全量攻击手册）

| 阶段 | 漏洞类型 | Playbook 路径 |
|------|----------|--------------|
| 侦察 | 信息泄露 | `references/playbooks/info-disclosure.md` |
| 侦察 | 未授权访问 | `references/playbooks/unauth-access.md` |
| 突破 | SQL注入 | `references/playbooks/sqli.md` |
| 突破 | XSS | `references/playbooks/xss/00-index.md` |
| 突破 | RCE/反序列化/SSTI/XXE | `references/playbooks/rce/00-index.md` |
| 突破 | SSRF/缓存/Host | `references/playbooks/ssrf-cache-host/00-index.md` |
| 突破 | 路径穿越 | `references/playbooks/path-traversal/00-index.md` |
| 突破 | 文件上传 | `references/playbooks/file-upload/00-index.md` |
| 突破 | 逻辑漏洞 | `references/playbooks/logic-flaws/00-index.md` |
| 突破 | 认证(OAuth/SAML/JWT) | `references/playbooks/oauth-saml-jwt/00-index.md` |
| 突破 | API安全 | `references/playbooks/api-rest/00-index.md` |
| 突破 | GraphQL | `references/playbooks/graphql.md` |
| 突破 | HTTP走私 | `references/playbooks/http-smuggling.md` |
| 突破 | 竞态条件 | `references/playbooks/race-conditions.md` |
| 突破 | DoS | `references/playbooks/dos.md` |
| 突破 | LLM注入 | `references/playbooks/llm-prompt-injection/00-index.md` |
| 突破 | 任意X越权 | `references/playbooks/arbitrary-x-authz.md` |
| 后渗透 | 内网后渗透 | `references/playbooks/intranet-postexp/00-index.md` |
| 移动 | 移动安全 | `references/playbooks/mobile.md` |

### H1 真实案例（跨阶段精选）

| 阶段 | 漏洞类型 | H1 案例路径 |
|------|----------|------------|
| 侦察 | 信息泄露 | `references/h1-reports/by-weakness/information-disclosure.md` |
| 突破 | SQL注入 | `references/h1-reports/by-weakness/sql-injection.md` / `blind-sql-injection.md` |
| 突破 | XSS | `references/h1-reports/by-weakness/cross-site-scripting-xss.md` |
| 突破 | SSRF | `references/h1-reports/by-weakness/server-side-request-forgery-ssrf.md` |
| 突破 | 命令注入 | `references/h1-reports/by-weakness/os-command-injection.md` |
| 突破 | 反序列化 | `references/h1-reports/by-weakness/deserialization-of-untrusted-data.md` |
| 突破 | 越权/IDOR | `references/h1-reports/by-weakness/insecure-direct-object-reference-idor.md` |
| 突破 | 认证绕过 | `references/h1-reports/by-weakness/authentication-bypass.md` |
| 后渗透 | 权限提升 | `references/h1-reports/by-weakness/privilege-escalation.md` |

### Payload 库

| 用途 | Payload 路径 |
|------|-------------|
| SQL注入Payload | `payloads/web/sqli-payloads.md` |
| XSS Payload | `payloads/web/xss-payloads.md` |
| 云元数据Payload | `payloads/web/cloud-payloads.md` |
| WAF绕过 | `payloads/bypass/waf-bypass.md` |
| 反弹Shell | `payloads/network/reverse-shells.md` |
| 提权Payload | `payloads/network/privesc-payloads.md` |
| 内网Payload | `payloads/network/internal-payloads.md` |
| Frida脚本 | `payloads/mobile/frida-scripts.md` |

---

## 底层原理：攻击链不是"步骤列表"，是"因果依赖图"

```
每一步的产出 = 下一步的输入。不是线性执行，而是条件触发。

阶段1 → 信息收集
  产出：子域名、开放端口、指纹、邮箱、员工名
  触发条件：有目标 → 立即执行

阶段2 → 边界突破
  输入：阶段1的产出（子域→Web扫描、端口→服务利用、邮箱→钓鱼）
  产出：初始访问点（WebShell、凭据、会话）
  触发条件：阶段1发现可利用点 → 选择最优路径

阶段3 → 权限提升
  输入：阶段2的初始权限（普通用户、www-data）
  产出：高权限（root、SYSTEM、Domain Admin）
  触发条件：当前权限不足 → 自动提权

阶段4 → 横向移动
  输入：阶段3的高权限 + 阶段1的网络拓扑
  产出：多台主机控制权
  触发条件：内网可达 → 扫描内网 → 横向

阶段5 → 权限维持
  输入：阶段3/4的权限
  产出：持久化后门（SSH密钥、计划任务、WebShell）
  触发条件：权限稳定后 → 植入后门

阶段6 → 痕迹清理
  输入：所有阶段的操作日志
  产出：干净的撤离
  触发条件：任务完成 → 清理
```

---

## 决策框架：根据目标类型选择路径

```
目标是什么？
├── 单个 Web 应用
│   路径：recon → web → exploit → post_exploit → opsec
│   引擎：浏览器抓JS → 终端扫端口 → 终端打漏洞
├── 内网环境
│   路径：recon → network → exploit → post_exploit → network(横向) → opsec
│   引擎：终端扫描 → 终端利用 → 终端横向
├── 移动应用
│   路径：mobile(ADB提取APK) → reverse(反编译) → code_audit(审计) → web(测试API)
│   引擎：ADB提取 → 终端反编译 → 浏览器测试API
├── IoT 设备
│   路径：recon(网络发现) → iot(固件提取) → reverse(逆向) → network(网络利用)
│   引擎：终端扫描 → 终端固件分析 → 终端逆向
├── 红队全链路
│   路径：recon → social(钓鱼) → web(突破) → post_exploit → network(横向) → opsec全程
│   引擎：全部4引擎联动
└── 应急响应/蓝队
    路径：recon(了解自己) → incident(检测) → forensics(取证) → malware(分析)
    引擎：终端分析 → ADB取证
```

---

## 自动编排规则

```bash
# 规则1：信息收集永远第一步
# 规则2：发现Web端口 → 自动触发Web扫描
# 规则3：发现内网主机 → 自动触发内网扫描
# 规则4：获取凭据 → 自动尝试横向移动
# 规则5：每步操作 → opsec 包裹（proxychains/torsocks）
# 规则6：所有关键操作 → 记录日志到 field-journal/

# 执行示例：假设目标 example.com
# AI 自动执行：
# 1. recon → 发现子域: api.example.com, admin.example.com
# 2. web → 扫描 api.example.com → 发现 SQL 注入
# 3. exploit → sqlmap 利用 → 拿到数据库
# 4. report → 生成报告
```

---

## 本机环境速查

```
四引擎：
- 终端(terminal): 所有Linux命令、扫描、利用
- ADB: 移动设备操作、APK提取
- 浏览器(Playwright): JS抓取、SPA端点提取、截图验证
- Shell(Shizuku): Android系统级操作

OPSEC 全程包裹：
- proxychains nmap ...     # 所有扫描
- torsocks curl ...        # 所有Web请求
- screen -S session        # 保持会话不丢失
```

---

## 反爬钩子

> 攻击链每一步都可能遭遇反爬/WAF/CDN/EDR，需在各阶段预判并准备绕过策略。OPSEC 全程包裹。

| 阶段 | 场景 | 应对策略 |
|------|------|----------|
| 信息收集 | 子域爆破/目录扫描被限速 | 降速 + 随机延迟 + proxychains 代理轮换 |
| 信息收集 | JS源码抓取触发Challenge | 浏览器引擎(Playwright)渲染绕过 |
| 边界突破 | Web漏洞利用被WAF拦截 | sqlmap --tamper / 编码绕过 / 浏览器引擎投递 |
| 边界突破 | API爆破被速率限制 | 降速 + 多Token轮换 + X-Forwarded-For |
| 权限提升 | 内网横向被EDR/NDR检测 | Living-off-the-Land + 加密隧道 + 签名工具 |
| 权限维持 | 持久化后门被发现 | 非标准端口 + 非标准路径 + 加密通信 |
| 数据渗出 | 大量数据外传被检测 | 分片传输 + DNS/ICMP隧道 + 加密 |
| 全程 | IP信誉/流量指纹被检测 | proxychains/torsocks包裹 + 浏览器引擎伪装 |

完整对抗手册：`references/methodology/06-anti-antibot.md`

---

## 经验回写

每次攻击链任务完成后记录：
- 完整路径（从信息收集到清理）
- 每个阶段的耗时和产出
- 遇到的障碍和绕过方法
- 有效的技能组合