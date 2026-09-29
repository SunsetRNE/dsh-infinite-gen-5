#!/usr/bin/env python3
"""漏洞报告生成器 — 从JSON findings生成Markdown/HTML报告"""
import argparse, json, sys, time, os

TEMPLATE = """# 渗透测试报告 — {project}

## 1. 执行摘要
- 测试范围：{scope}
- 测试时间：{start_time} ~ {end_time}
- 漏洞总数：严重:{critical} 高危:{high} 中危:{medium} 低危:{low} 信息:{info}
- 核心风险：{core_risk}

## 2. 测试方法论
- 信息收集：nmap + subfinder + dig
- 漏洞扫描：nuclei + sqlmap + 手工测试
- 后渗透：权限提升 + 横向移动 + 持久化

## 3. 漏洞详情
{findings}

## 4. 附录
- 工具：zhekk v7.0 + nmap + nuclei + sqlmap + hydra
- 时间线：{timeline}
"""

FINDING_TEMPLATE = """### 漏洞 #{num}: {title}
- **严重程度**：{severity}
- **CVSS 4.0**：{cvss}
- **影响URL**：{url}
- **漏洞类型**：{vuln_type}
- **漏洞描述**：{description}
- **复现步骤**：
  1. {steps}
- **影响范围**：{impact}
- **修复建议**：{fix}
- **证据**：
  ```
  {evidence}
  ```
"""

def gen_report(project, findings, scope="N/A"):
    findings_md = ""
    for i, f in enumerate(findings, 1):
        findings_md += FINDING_TEMPLATE.format(
            num=i, title=f.get("title","未命名"), severity=f.get("severity","N/A"),
            cvss=f.get("cvss","N/A"), url=f.get("url","N/A"), vuln_type=f.get("type","N/A"),
            description=f.get("description",""), steps=f.get("steps",""),
            impact=f.get("impact",""), fix=f.get("fix",""), evidence=f.get("evidence","")
        )
    
    sev = {"critical":0,"high":0,"medium":0,"low":0,"info":0}
    for f in findings:
        s = f.get("severity","info").lower()
        sev[s] = sev.get(s, 0) + 1
    
    return TEMPLATE.format(
        project=project, scope=scope,
        start_time=time.strftime("%Y-%m-%d"), end_time=time.strftime("%Y-%m-%d"),
        critical=sev["critical"], high=sev["high"], medium=sev["medium"],
        low=sev["low"], info=sev["info"],
        core_risk=", ".join(f"{f['title']}" for f in findings[:3]) if findings else "无严重风险",
        findings=findings_md, timeline=time.strftime("%Y-%m-%d %H:%M:%S")
    )

def main():
    ap = argparse.ArgumentParser(description="漏洞报告生成器")
    ap.add_argument("--input", "-i", help="findings JSON文件")
    ap.add_argument("--project", default="渗透测试", help="项目名称")
    ap.add_argument("--scope", default="N/A", help="测试范围")
    ap.add_argument("--format", default="md", choices=["md","json"], help="输出格式")
    ap.add_argument("-o", "--output", help="输出文件")
    
    args = ap.parse_args()
    
    if args.input and os.path.isfile(args.input):
        with open(args.input) as f:
            data = json.load(f)
        findings = data if isinstance(data, list) else data.get("findings", [])
    else:
        # 示例模式
        findings = [
            {"title": "SQL注入示例", "severity": "critical", "cvss": "9.3", "url": "/api/login", "type": "SQL注入",
             "description": "登录接口存在SQL注入，可获取数据库全部数据", "steps": "在email参数输入' OR '1'='1",
             "impact": "数据库泄露、认证绕过", "fix": "使用参数化查询", "evidence": "HTTP 200 with admin session"}
        ]
    
    report = gen_report(args.project, findings, args.scope)
    
    if args.output:
        with open(args.output, "w") as f:
            f.write(report)
        print(f"✅ 报告保存到 {args.output}")
    else:
        print(report)

if __name__ == "__main__":
    main()