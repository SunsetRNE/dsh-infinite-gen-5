#!/usr/bin/env python3
"""
Nuclei 结果解析器
解析 nuclei 的 JSONL 格式输出，支持去重、排序和多格式报告生成。
"""

import argparse
import json
import os
import signal
import sys
from collections import defaultdict
from datetime import datetime


# ============================================================
# 严重等级排序
# ============================================================

SEVERITY_ORDER = {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
    "info": 4,
    "unknown": 5,
}


def severity_rank(sev):
    """获取严重等级排序值。"""
    return SEVERITY_ORDER.get(str(sev).lower(), 5)


# ============================================================
# JSONL 解析
# ============================================================

def parse_jsonl(filepath):
    """
    解析 nuclei JSONL 输出文件。
    返回 findings 列表。
    """
    findings = []
    if not os.path.isfile(filepath):
        return findings

    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                finding = {
                    "template_id": data.get("template-id", data.get("templateID", "")),
                    "name": data.get("info", {}).get("name", ""),
                    "severity": data.get("info", {}).get("severity", "unknown"),
                    "url": data.get("matched-at", data.get("host", "")),
                    "matched": data.get("matched", data.get("matcher-name", "")),
                    "description": data.get("info", {}).get("description", ""),
                    "reference": data.get("info", {}).get("reference", []),
                    "tags": data.get("info", {}).get("tags", []),
                    "type": data.get("type", ""),
                    "ip": data.get("ip", ""),
                    "timestamp": data.get("timestamp", ""),
                    "raw": data,
                }
                findings.append(finding)
            except json.JSONDecodeError:
                continue

    return findings


# ============================================================
# 去重
# ============================================================

def deduplicate(findings):
    """
    去重：相同模板ID + URL 的结果合并。
    """
    seen = {}
    for f in findings:
        key = (f.get("template_id", ""), f.get("url", ""))
        if key in seen:
            # 合并信息，保留更完整的
            existing = seen[key]
            if not existing.get("description") and f.get("description"):
                existing["description"] = f["description"]
            if not existing.get("reference") and f.get("reference"):
                existing["reference"] = f["reference"]
        else:
            seen[key] = f
    return list(seen.values())


# ============================================================
# 过滤
# ============================================================

def filter_findings(findings, severity_filter=None, filter_json=None):
    """
    按严重等级或自定义规则过滤。
    """
    filtered = findings

    # 严重等级过滤
    if severity_filter:
        sev_list = [s.strip().lower() for s in severity_filter.split(",") if s.strip()]
        filtered = [f for f in filtered if f.get("severity", "").lower() in sev_list]

    # 自定义 JSON 过滤规则
    if filter_json:
        try:
            rules = json.loads(filter_json)
            # 支持的过滤字段：severity, template_id, url_contains, tags
            if "severity" in rules:
                sev_set = set(s.lower() for s in rules["severity"])
                filtered = [f for f in filtered
                            if f.get("severity", "").lower() in sev_set]
            if "template_id" in rules:
                tid_set = set(rules["template_id"])
                filtered = [f for f in filtered
                            if f.get("template_id", "") in tid_set]
            if "url_contains" in rules:
                url_sub = rules["url_contains"]
                filtered = [f for f in filtered
                            if url_sub in f.get("url", "")]
            if "tags" in rules:
                tag_set = set(rules["tags"])
                filtered = [f for f in filtered
                            if tag_set.intersection(set(f.get("tags", [])))]
        except (json.JSONDecodeError, TypeError):
            pass

    return filtered


# ============================================================
# 排序与统计
# ============================================================

def sort_by_severity(findings):
    """按严重等级排序：critical > high > medium > low > info。"""
    return sorted(findings, key=lambda f: severity_rank(f.get("severity", "unknown")))


def compute_stats(findings):
    """
    统计分析：按模板、按URL、按严重等级分组统计。
    """
    by_severity = defaultdict(int)
    by_template = defaultdict(lambda: {"count": 0, "severity": "", "name": ""})
    by_url = defaultdict(int)
    unique_targets = set()

    for f in findings:
        sev = f.get("severity", "unknown").lower()
        by_severity[sev] += 1

        tid = f.get("template_id", "unknown")
        by_template[tid]["count"] += 1
        by_template[tid]["severity"] = sev
        by_template[tid]["name"] = f.get("name", "")

        url = f.get("url", "")
        by_url[url] += 1

        # 提取目标主机
        if url:
            try:
                from urllib.parse import urlparse
                parsed = urlparse(url)
                if parsed.hostname:
                    unique_targets.add(parsed.hostname)
                elif url:
                    unique_targets.add(url.split("/")[0].split(":")[0])
            except Exception:
                unique_targets.add(url)

    # 转换 by_template 为列表
    template_list = [
        {"template": k, "count": v["count"], "severity": v["severity"], "name": v["name"]}
        for k, v in sorted(by_template.items(), key=lambda x: -x[1]["count"])
    ]

    return {
        "by_severity": dict(by_severity),
        "by_template": template_list,
        "unique_targets": len(unique_targets),
    }


# ============================================================
# 格式化输出
# ============================================================

def generate_html_report(findings, stats, input_file):
    """生成 HTML 格式报告。"""
    severity_colors = {
        "critical": "#dc3545",
        "high": "#fd7e14",
        "medium": "#ffc107",
        "low": "#0dcaf0",
        "info": "#6c757d",
        "unknown": "#6c757d",
    }

    html_parts = []
    html_parts.append("<!DOCTYPE html>")
    html_parts.append('<html lang="zh-CN"><head><meta charset="UTF-8">')
    html_parts.append("<title>Nuclei 扫描报告</title>")
    html_parts.append("<style>")
    html_parts.append("body { font-family: Arial, sans-serif; margin: 20px; background: #f8f9fa; }")
    html_parts.append("h1 { color: #333; }")
    html_parts.append(".summary { display: flex; gap: 15px; margin: 20px 0; flex-wrap: wrap; }")
    html_parts.append(".stat-card { background: white; padding: 15px 25px; border-radius: 8px; "
                      "box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }")
    html_parts.append(".stat-card .num { font-size: 28px; font-weight: bold; }")
    html_parts.append(".stat-card .label { color: #666; font-size: 14px; }")
    html_parts.append("table { width: 100%; border-collapse: collapse; background: white; "
                      "border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }")
    html_parts.append("th { background: #343a40; color: white; padding: 12px; text-align: left; }")
    html_parts.append("td { padding: 10px 12px; border-bottom: 1px solid #dee2e6; }")
    html_parts.append("tr:hover { background: #f1f3f5; }")
    html_parts.append(".badge { padding: 3px 10px; border-radius: 12px; color: white; font-size: 12px; }")
    html_parts.append("</style></head><body>")

    html_parts.append(f"<h1>Nuclei 漏洞扫描报告</h1>")
    html_parts.append(f"<p>扫描结果文件: {input_file}</p>")
    html_parts.append(f"<p>生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>")

    # 统计卡片
    html_parts.append('<div class="summary">')
    html_parts.append(f'<div class="stat-card"><div class="num">{len(findings)}</div>'
                      f'<div class="label">总发现</div></div>')
    for sev in ["critical", "high", "medium", "low", "info"]:
        count = stats["by_severity"].get(sev, 0)
        color = severity_colors.get(sev, "#6c757d")
        html_parts.append(
            f'<div class="stat-card"><div class="num" style="color:{color}">{count}</div>'
            f'<div class="label">{sev.upper()}</div></div>'
        )
    html_parts.append(f'<div class="stat-card"><div class="num">{stats["unique_targets"]}</div>'
                      f'<div class="label">受影响目标</div></div>')
    html_parts.append('</div>')

    # 漏洞详情表
    html_parts.append("<h2>漏洞详情</h2>")
    html_parts.append('<table><thead><tr>')
    html_parts.append('<th>严重等级</th><th>模板ID</th><th>名称</th>'
                      '<th>URL</th><th>匹配</th><th>标签</th>')
    html_parts.append('</tr></thead><tbody>')

    for f in findings:
        sev = f.get("severity", "unknown").lower()
        color = severity_colors.get(sev, "#6c757d")
        tags = ", ".join(f.get("tags", [])) if f.get("tags") else ""
        html_parts.append(
            f'<tr>'
            f'<td><span class="badge" style="background:{color}">{sev.upper()}</span></td>'
            f'<td>{f.get("template_id", "")}</td>'
            f'<td>{f.get("name", "")}</td>'
            f'<td><a href="{f.get("url", "")}">{f.get("url", "")}</a></td>'
            f'<td>{f.get("matched", "")}</td>'
            f'<td>{tags}</td>'
            f'</tr>'
        )

    html_parts.append('</tbody></table>')
    html_parts.append('</body></html>')

    return "\n".join(html_parts)


def generate_csv_report(findings):
    """生成 CSV 格式报告。"""
    csv_lines = ["severity,template_id,name,url,matched,description,tags"]

    for f in findings:
        sev = f.get("severity", "")
        tid = f.get("template_id", "")
        name = f.get("name", "").replace('"', '""')
        url = f.get("url", "").replace('"', '""')
        matched = f.get("matched", "").replace('"', '""')
        desc = f.get("description", "").replace('"', '""').replace("\n", " ")
        tags = "|".join(f.get("tags", []))

        csv_lines.append(f'"{sev}","{tid}","{name}","{url}","{matched}","{desc}","{tags}"')

    return "\n".join(csv_lines)


# ============================================================
# 主流程
# ============================================================


_timeout_value = 300

def _timeout_handler(signum, frame):
    """超时信号处理器"""
    print(json.dumps({"status": "timeout", "error": f"操作超时({_timeout_value}秒)", "timeout": _timeout_value}, ensure_ascii=False))
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Nuclei 结果解析器 - 解析 JSONL 输出，支持去重、排序和多格式报告"
    )
    parser.add_argument("--input", required=True,
                        help="nuclei JSONL 输出文件路径")
    parser.add_argument("--filter", default="",
                        help="过滤规则 JSON（可选）")
    parser.add_argument("--severity", default="",
                        help="严重等级过滤（可选）")
    parser.add_argument("--deduplicate", action="store_true", default=True,
                        help="去重（默认开启；保留 default=True 以维持原有默认行为）")
    parser.add_argument("-o", "--output", default="",
                        help="格式化输出文件路径（可选）")
    parser.add_argument("--format", default="json",
                        choices=["json", "html", "csv"],
                        help="输出格式：json/html/csv（默认 json）")

    parser.add_argument("--timeout", type=int, default=300, help="操作超时时间(秒)")
    args = parser.parse_args()

    global _timeout_value
    _timeout_value = args.timeout
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(args.timeout)

    # 解析 JSONL
    findings = parse_jsonl(args.input)

    # 过滤
    findings = filter_findings(findings, args.severity, args.filter)

    # 去重
    if args.deduplicate:
        findings = deduplicate(findings)

    # 排序
    findings = sort_by_severity(findings)

    # 统计
    stats = compute_stats(findings)

    # 根据格式输出
    if args.format == "html":
        html_content = generate_html_report(findings, stats, args.input)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(html_content)
        # 同时输出 JSON 摘要到 stdout
        result = {
            "input": args.input,
            "total_findings": len(findings),
            "by_severity": stats["by_severity"],
            "by_template": stats["by_template"],
            "unique_targets": stats["unique_targets"],
            "format": "html",
            "output_file": args.output,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        print("\n--- HTML Report ---")
        print(html_content)

    elif args.format == "csv":
        csv_content = generate_csv_report(findings)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(csv_content)
        result = {
            "input": args.input,
            "total_findings": len(findings),
            "by_severity": stats["by_severity"],
            "by_template": stats["by_template"],
            "unique_targets": stats["unique_targets"],
            "format": "csv",
            "output_file": args.output,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        print("\n--- CSV Report ---")
        print(csv_content)

    else:  # json
        # 清理 raw 字段
        clean_findings = []
        for f in findings:
            clean = {k: v for k, v in f.items() if k != "raw"}
            clean_findings.append(clean)

        result = {
            "input": args.input,
            "total_findings": len(clean_findings),
            "by_severity": stats["by_severity"],
            "by_template": stats["by_template"],
            "unique_targets": stats["unique_targets"],
            "findings": clean_findings,
        }

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)

        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
