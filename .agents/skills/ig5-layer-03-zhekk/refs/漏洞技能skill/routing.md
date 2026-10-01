# zhekk 路由矩阵

按目标类型、用户意图和工具链，将任务路由到最合适的模块。此矩阵默认强制执行。

## CRITICAL: 路由判定执行协议

1. **`MUST` 先完成 Phase 0 OPSEC**（SKILL.md 启动契约第4步），确认出口 IP 已隐藏，再执行任何操作
2. **`MUST` 反爬对抗检查**（启动契约第5步），确认目标防护并选择对抗策略（见 `references/methodology/06-anti-antibot.md`）
3. `MUST` 先完成路由再执行，不允许"先做再补路由"
4. `MUST` 输出路由依据（目标类型/意图/工具链至少命中一项）
5. `MUST NOT` 因为"看起来差不多"把任务塞进不匹配模块
6. `MUST` 在路由未命中时联网补充方法论，并提议新增模块
7. **`MUST` 漏洞探测时按 Phase 4 路由表读取对应 playbook**，不准凭记忆出 payload

## 5+1 阶段工作流路由

```
Phase 0 OPSEC → Phase 1 Intake → Phase 2 Recon → Phase 3 Enum → Phase 4 Hunt → Phase 5 Report
     ↓                                    ↓                ↓             ↓              ↓
 modules/opsec/                    modules/recon/    modules/recon/  按下表路由    modules/docs/
 + 06-anti-antibot.md              (被动)            (主动)          + playbooks/   + templates/
```

## 按目标类型

| 目标 | 主模块 | 备选 | Phase 4 Playbook |
|------|--------|------|-----------------|
| 域名/URL/Web应用 | `modules/web/` | `modules/recon/` | 按入口信号选（见 SKILL.md Phase 4 路由表） |
| API/REST/GraphQL | `modules/web/` | `modules/cloud/` | `playbooks/api-rest/` / `playbooks/graphql.md` |
| 内网/域控/AD | `modules/network/` | `modules/recon/` | `playbooks/intranet-postexp/` |
| Android APK/手机 | `modules/mobile/` | `modules/reverse/` | `playbooks/mobile.md` |
| iOS/IPA | `modules/mobile/` | `modules/reverse/` | `playbooks/mobile.md` |
| 二进制/ELF/So/EXE | `modules/reverse/` | `modules/exploit/` | — |
| AWS/Azure/K8s | `modules/cloud/` | `modules/network/` | `playbooks/ssrf-cache-host/` |
| IoT/固件/路由器 | `modules/iot/` | `modules/reverse/` | `playbooks/unauth-access.md` |
| LLM/ChatBot/AI | `modules/llm/` | `modules/web/` | `playbooks/llm-prompt-injection/` |
| 人/社工/钓鱼 | `modules/social/` | `modules/recon/` | — |
| WiFi/蓝牙/RFID | `modules/wireless/` | `modules/network/` | — |
| 内存/磁盘/PCAP | `modules/forensics/` | `modules/stego/` | — |
| 图片/音频(隐写) | `modules/stego/` | `modules/forensics/` | — |
| 源代码 | `modules/code_audit/` | `modules/web/` | `playbooks/rce/` / `playbooks/sqli.md` |
| 恶意样本 | `modules/malware/` | `modules/reverse/` | — |
| DNS | `modules/dns/` | `modules/recon/` | — |
| TLS/证书 | `modules/tls/` | `modules/recon/` | — |
| 完整渗透/红队/HW | `modules/attack_chain/` | 按阶段分发 | 全量 playbook |
| 被入侵系统 | `modules/incident/` | `modules/forensics/` | — |
| 压力测试 | `modules/ddos/` | — | `playbooks/dos.md` |
| 协议实现 | `modules/fuzzer/` | `modules/reverse/` | — |

## 按用户意图

| 用户说 | 路由 | Playbook |
|--------|------|---------|
| 扫描/信息收集/子域/端口 | `modules/recon/` | — |
| SQL注入/XSS/RCE/SSRF/SRC挖洞 | `modules/web/` | 按漏洞类型选 |
| 内网/横向/域控/AD/Kerberos | `modules/network/` | `intranet-postexp/` |
| APK/手机/ADB/Frida/移动 | `modules/mobile/` | `mobile.md` |
| 提权/持久化/痕迹清理 | `modules/post_exploit/` | `intranet-postexp/` |
| 代理/隐身/免杀/绕过 | `modules/opsec/` | `06-anti-antibot.md` |
| 云/AWS/S3/Azure/K8s | `modules/cloud/` | `ssrf-cache-host/` |
| Prompt注入/LLM/AI安全 | `modules/llm/` | `llm-prompt-injection/` |
| 固件/binwalk/仿真/IoT | `modules/iot/` | — |
| 社工/钓鱼/OSINT/字典 | `modules/social/` | — |
| WiFi/BLE/无线/近源 | `modules/wireless/` | — |
| 逆向/脱壳/反编译/So | `modules/reverse/` | `mobile.md` |
| 完整渗透/红队/全流程 | `modules/attack_chain/` | 全量 |
| 取证/内存/PCAP/恢复 | `modules/forensics/` | — |
| 隐写/图片隐藏 | `modules/stego/` | — |
| 源码审计/代码安全 | `modules/code_audit/` | `rce/` / `sqli.md` |
| 恶意软件/病毒/YARA | `modules/malware/` | — |
| 区域传送/DNS隧道/劫持 | `modules/dns/` | — |
| 证书/TLS/SSL | `modules/tls/` | — |
| 写报告/出报告 | `modules/docs/` | `templates/report-submission.md` |
| 应急/入侵/被黑 | `modules/incident/` | — |
| 压测/CC/DDOS | `modules/ddos/` | `dos.md` |
| 模糊测试/Fuzz | `modules/fuzzer/` | — |

## 跨模块路径（5+1 阶段映射）

```
Web渗透:     Phase0(opsec) → Phase2(recon) → Phase3(recon) → Phase4(web+playbook) → Phase5(docs)
移动渗透:    Phase0(opsec) → Phase2(recon) → Phase3(mobile) → Phase4(mobile+playbook) → Phase5(docs)
红队全流程:  Phase0(opsec) → Phase1(attack_chain) → Phase2(recon) → Phase3(recon) → Phase4(按路由表) → Phase5(docs)
内网渗透:    Phase4(network) → Phase4(post_exploit) → Phase4(intranet-postexp playbook)
取证:        forensics → stego → reverse → code_audit
恶意软件:    malware → reverse → forensics
应急响应:    incident → forensics → network → code_audit → incident
```

## 知识层路由（Phase 4 漏洞探测时按此表选 playbook）

| 入口信号 | Playbook | H1 案例 |
|---|---|---|
| Actuator/Swagger/默认端口/弱密码 | `playbooks/unauth-access.md` | `use-of-default-credentials.md` |
| .git/.svn/.env/heapdump | `playbooks/info-disclosure.md` | `information-disclosure.md` |
| ID可遍历/任意X越权 | `playbooks/arbitrary-x-authz.md` | `insecure-direct-object-reference-idor.md` |
| 密码重置/支付/验证码 | `playbooks/logic-flaws/00-index.md` | `business-logic-errors.md` |
| OAuth/SAML/JWT | `playbooks/oauth-saml-jwt/00-index.md` | `authentication-bypass.md` |
| REST API/BOLA | `playbooks/api-rest/00-index.md` | `improper-authorization.md` |
| 用户输入进DB | `playbooks/sqli.md` | `sql-injection.md` |
| 反序列化/SSTI/XXE/RCE | `playbooks/rce/00-index.md` | `deserialization-of-untrusted-data.md` |
| URL入参/缓存/Host | `playbooks/ssrf-cache-host/00-index.md` | `server-side-request-forgery-ssrf.md` |
| 文件路径/LFI/RFI | `playbooks/path-traversal/00-index.md` | `path-traversal.md` |
| 上传点 | `playbooks/file-upload/00-index.md` | `unrestricted-upload-of-file-with-dangerous-type.md` |
| 输入回显HTML/JS | `playbooks/xss/00-index.md` | `cross-site-scripting-xss*.md` |
| 反代+CL/TE | `playbooks/http-smuggling.md` | `http-request-smuggling.md` |
| GraphQL | `playbooks/graphql.md` | `information-disclosure.md` |
| 并发/TOCTOU | `playbooks/race-conditions.md` | `concurrent-execution-*.md` |
| ReDoS/不限速 | `playbooks/dos.md` | `uncontrolled-resource-consumption.md` |
| APK/IPA | `playbooks/mobile.md` | `improper-export-of-android-*.md` |
| LLM agent/prompt | `playbooks/llm-prompt-injection/00-index.md` | `llm01-prompt-injection.md` |
| 已拿shell/内网 | `playbooks/intranet-postexp/00-index.md` | `privilege-escalation.md` |

## 路由判定输出模板

```
[路由] 目标:xxx | 意图:xxx | 模块:modules/xxx/ | Phase:x | Playbook:xxx | 下一步:xxx
```
