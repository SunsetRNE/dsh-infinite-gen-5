# 报告生成模块 (Documentation & Reporting)

> 渗透测试报告/漏洞报告/CTF writeup — 用浏览器引擎生成自包含HTML报告
> 环境：browser(Playwright)✅ html-report✅

---

## 知识锚点（Playbook + H1 案例）

> 报告模块没有专属漏洞 playbook，但其产出依赖证据规范和提交模板，锚定这两份文档保证一致性。

### 关联模板与方法论

- `templates/report-submission.md` — 漏洞报告提交模板，规定字段、严重等级、证据格式
- `references/methodology/03-evidence-discipline.md` — 证据纪律：截图/请求响应/命令输出的收集与哈希固化规范

### 关联 H1 案例（references/h1-reports/by-weakness/）

- 报告本身不绑定单一 weakness，但在撰写漏洞详情时，可按 weakness 分类检索同类 H1 报告作为措辞和影响描述的参照
- `information-disclosure.md` — 信息泄露类报告的措辞与影响描述参照
- `sql-injection.md` — SQL 注入类报告的复现步骤与 CVSS 评分参照
- `os-command-injection.md` — 命令注入类报告的证据链与严重等级参照

### Payload / 工具

- `templates/report-submission.md` — 报告骨架
- 工具链：browser/Playwright（漏洞截图）→ curl（HTTP 证据）→ html-report（自包含 HTML 报告生成）

## 底层原理：报告不是"写文档"，是"让决策者看懂风险"

```
报告的三层受众：
1. 技术层（开发/运维）：需要精确的复现步骤、修复代码、验证方法
2. 管理层（CTO/安全经理）：需要风险等级、影响范围、修复优先级
3. 合规层（审计/法务）：需要合规映射、证据链、时间线

好的报告 = 三层都能各取所需
```

---

## 报告模板结构

```markdown
# 渗透测试报告 — {项目名称}

## 1. 执行摘要（给管理层）
- 测试范围：{URL/IP/网段}
- 测试时间：{开始日期} ~ {结束日期}
- 测试方法：{黑盒/白盒/灰盒}
- 漏洞总数：严重:{N} 高危:{N} 中危:{N} 低危:{N} 信息:{N}
- 核心风险：{一句话总结最严重的风险}
- 修复建议：{优先级排序的修复路线图}

## 2. 测试方法论（给技术层）
- 信息收集：{方法+工具}
- 漏洞扫描：{方法+工具}
- 手工测试：{方法+工具}
- 后渗透：{方法+工具}

## 3. 漏洞详情（每个漏洞一张卡）
### 漏洞 #{编号}: {标题}
- 严重程度：{严重/高危/中危/低危/信息}
- CVSS 4.0 评分：{分数} ({向量})
- 影响URL：{URL}
- 漏洞类型：{SQL注入/XSS/RCE/...}
- 漏洞描述：{技术描述，非技术人员也能理解}
- 复现步骤：
  1. 访问 {URL}
  2. 在 {参数} 输入 {payload}
  3. 观察到 {现象}
- 影响范围：{可获取的数据/权限}
- 修复建议：{具体代码或配置}
- 证据：
  - 截图（浏览器引擎截图）
  - HTTP 请求/响应
  - 命令输出

## 4. 附录
- 工具版本：{nmap v7.94, sqlmap v1.8, ...}
- 命令记录：{完整命令历史}
- 时间线：{操作时间线}
```

---

## 证据收集规范

```bash
# 每个漏洞需要三类证据：

# 1. 截图（用浏览器引擎）
# browser 包可以截图漏洞页面、弹窗、响应
# 保存到 evidence/screenshots/

# 2. HTTP 请求/响应（用 curl 或 extended_http_tools）
curl -X POST "https://target.com/api" \
  -H "Content-Type: application/json" \
  -d '{"id": "1 UNION SELECT..."}' \
  -v 2>&1 | tee evidence/sqli_request.txt

# 3. 命令输出（终端执行结果）
echo "=== SQL注入验证 ===" >> evidence/sqli_output.txt
sqlmap -u "https://target.com/api?id=1" --dbs 2>&1 | tee -a evidence/sqli_output.txt
```

---

## CVSS 4.0 快速评分

```
攻击向量(AV): 网络(N) / 相邻(A) / 本地(L) / 物理(P)
攻击复杂度(AC): 低(L) / 高(H)
攻击需求(AT): 无(N) / 存在(P)
权限要求(PR): 无(N) / 低(L) / 高(H)
用户交互(UI): 无(N) / 被动(P) / 主动(A)
影响范围:
  机密性(C): 无(N) / 低(L) / 高(H)
  完整性(I): 无(N) / 低(L) / 高(H)
  可用性(A): 无(N) / 低(L) / 高(H)

常见场景速查：
- SQL注入(可读全部数据): AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:N → 9.3 (严重)
- XSS(反射型): AV:N/AC:L/AT:N/PR:N/UI:A/VC:L/VI:L/VA:N → 5.4 (中危)
- 信息泄露(敏感文件): AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N → 5.3 (中危)
- RCE: AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H → 9.8 (严重)
```

---

## 用 html-report 生成报告

```
本机有 html-report 包，可以生成自包含 HTML 报告：
- 报告包含：封面、目录、执行摘要、漏洞详情、附录
- 支持：截图嵌入、代码高亮、暗色模式、打印友好
- 输出：单个 HTML 文件，零外部依赖

使用方式：
"用 html-report 生成一份渗透测试报告，包含以下漏洞..."
```

---

## 本机环境速查

```
已安装: browser(Playwright)✅ html-report✅
报告生成流程：
1. 漏洞验证 → 截图(browser) + 命令输出(terminal)
2. 证据整理 → 按漏洞编号分类
3. 报告生成 → html-report 生成自包含HTML
4. 交付 → 提供 HTML 文件 + 原始证据包
```

---

## 反爬钩子

> 报告生成本身不涉及反爬，但数据采集环节可能遇到。

- **报告生成不涉及反爬**：本地用 html-report 生成 HTML，无网络交互
- **从平台抓取漏洞信息可能遇反爬**：需要从漏洞平台/H1 报告库抓取漏洞描述、CVSS、参考链接时，可能遇到登录验证和反爬策略
- **截图/证据采集可能受限**：用浏览器引擎访问目标获取漏洞截图时，目标站点可能有 WAF/验证码
- **应对策略**：详见 `references/methodology/06-anti-antibot.md`，报告生成阶段保持本地化，数据采集阶段按 Web 渗透反爬策略执行