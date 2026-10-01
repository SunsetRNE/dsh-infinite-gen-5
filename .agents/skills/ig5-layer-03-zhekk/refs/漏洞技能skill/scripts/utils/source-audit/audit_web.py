#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Web 前端代码安全审计工具

扫描 JavaScript、HTML、PHP 代码中的安全漏洞，覆盖 DOM XSS、CSRF、Clickjacking、localStorage 滥用、postMessage 等前端安全问题。

输出格式：JSON
"""

import argparse
import json
import os
import re
import sys
from typing import List, Dict, Any


# ============================================================
# 严重等级定义
# ============================================================
SEVERITY_CRITICAL = "critical"
SEVERITY_HIGH = "high"
SEVERITY_MEDIUM = "medium"
SEVERITY_LOW = "low"


# ============================================================
# Web 安全审计规则定义
# ============================================================
WEB_RULES = [
    # --- DOM XSS ---
    {
        "rule": "dom_xss_document_write",
        "regex": r'document\.write\s*\(',
        "severity": SEVERITY_HIGH,
        "description": "使用 document.write() 输出内容，存在 DOM XSS 风险",
        "fix": "使用 textContent 或 createElement 替代 document.write",
        "category": "xss",
    },
    {
        "rule": "dom_xss_innerhtml",
        "regex": r'\.innerHTML\s*=\s*[^;]*',
        "severity": SEVERITY_HIGH,
        "description": "使用 innerHTML 赋值，可能导致 XSS",
        "fix": "使用 textContent 或对内容进行 HTML 转义",
        "category": "xss",
    },
    {
        "rule": "dom_xss_outerhtml",
        "regex": r'\.outerHTML\s*=\s*[^;]*',
        "severity": SEVERITY_HIGH,
        "description": "使用 outerHTML 赋值，可能导致 XSS",
        "fix": "使用安全的 DOM API 替代 outerHTML 赋值",
        "category": "xss",
    },
    {
        "rule": "dom_xss_insert_adjacent",
        "regex": r'\.insertAdjacentHTML\s*\(',
        "severity": SEVERITY_HIGH,
        "description": "使用 insertAdjacentHTML 插入 HTML，可能导致 XSS",
        "fix": "对插入的 HTML 内容进行转义",
        "category": "xss",
    },
    # --- 开放重定向 ---
    {
        "rule": "open_redirect_location",
        "regex": r'(?:window\.)?location\s*=\s*[^;]*(?:input|param|url|href|search|hash)',
        "severity": SEVERITY_HIGH,
        "description": "使用用户输入设置 location，存在开放重定向风险",
        "fix": "使用白名单验证重定向 URL",
        "category": "dangerous",
    },
    {
        "rule": "open_redirect_window_open",
        "regex": r'window\.open\s*\(\s*(?:input|param|url|location|hash|search)',
        "severity": SEVERITY_MEDIUM,
        "description": "window.open 参数可能来自用户输入",
        "fix": "验证 URL 来源，限制可打开的域名",
        "category": "dangerous",
    },
    # --- postMessage 不验证来源 ---
    {
        "rule": "postmessage_no_origin_check",
        "regex": r"addEventListener\s*\(\s*['\"]message['\"]",
        "severity": SEVERITY_HIGH,
        "description": "postMessage 监听器未验证消息来源",
        "fix": "在消息处理前验证 event.origin: if(event.origin !== 'https://expected.com') return;",
        "category": "dangerous",
    },
    # --- localStorage 存储敏感信息 ---
    {
        "rule": "localStorage_sensitive_data",
        "regex": r"localStorage\.setItem\s*\(\s*['\"](?:token|password|secret|api[-_]?key|auth|credential|session)",
        "severity": SEVERITY_MEDIUM,
        "description": "在 localStorage 中存储敏感信息，可被 XSS 攻击窃取",
        "fix": "敏感信息应存储在 HttpOnly Cookie 中，不使用 localStorage",
        "category": "api",
    },
    {
        "rule": "sessionStorage_sensitive_data",
        "regex": r"sessionStorage\.setItem\s*\(\s*['\"](?:token|password|secret|api[-_]?key|auth|credential|session)",
        "severity": SEVERITY_MEDIUM,
        "description": "在 sessionStorage 中存储敏感信息",
        "fix": "敏感信息应存储在 HttpOnly Cookie 中",
        "category": "api",
    },
    # --- eval / Function ---
    {
        "rule": "dangerous_eval",
        "regex": r'\beval\s*\(',
        "severity": SEVERITY_CRITICAL,
        "description": "使用 eval() 执行动态代码，存在代码注入风险",
        "fix": "避免使用 eval()，使用 JSON.parse() 或专用解析器",
        "category": "dangerous",
    },
    {
        "rule": "dangerous_function_constructor",
        "regex": r'new\s+Function\s*\(',
        "severity": SEVERITY_CRITICAL,
        "description": "使用 new Function() 构造函数，存在代码注入风险",
        "fix": "避免使用 new Function()，重构代码逻辑",
        "category": "dangerous",
    },
    {
        "rule": "dangerous_settimeout_string",
        "regex": r'setTimeout\s*\(\s*["\']',
        "severity": SEVERITY_HIGH,
        "description": "setTimeout 使用字符串参数，等价于 eval()",
        "fix": "使用函数引用替代字符串：setTimeout(function(){...}, delay)",
        "category": "dangerous",
    },
    # --- 不安全 CSP ---
    {
        "rule": "unsafe_csp",
        "regex": r'Content-Security-Policy.*(?:unsafe-inline|unsafe-eval)',
        "severity": SEVERITY_MEDIUM,
        "description": "CSP 策略中包含 unsafe-inline 或 unsafe-eval",
        "fix": "移除 unsafe-inline 和 unsafe-eval，使用 nonce 或 hash",
        "category": "clickjacking",
    },
    {
        "rule": "missing_csp",
        "regex": r'<meta[^>]*http-equiv[^>]*(?!Content-Security-Policy)',
        "severity": SEVERITY_LOW,
        "description": "HTML 页面可能缺少 Content-Security-Policy 头",
        "fix": "添加 CSP meta 标签或 HTTP 头",
        "category": "clickjacking",
    },
    # --- CSRF 缺失 ---
    {
        "rule": "csrf_missing_token",
        "regex": r'<form[^>]*method\s*=\s*["\']post["\'][^>]*(?!csrf)(?!token)',
        "severity": SEVERITY_MEDIUM,
        "description": "表单可能缺少 CSRF Token",
        "fix": "在表单中添加 CSRF Token 隐藏字段",
        "category": "csrf",
    },
    # --- Clickjacking ---
    {
        "rule": "clickjacking_no_xfo",
        "regex": r'<!DOCTYPE\s+html>',
        "severity": SEVERITY_LOW,
        "description": "HTML 页面缺少 X-Frame-Options 头，可能被 Clickjacking 攻击",
        "fix": "设置 X-Frame-Options: DENY 或 CSP frame-ancestors",
        "category": "clickjacking",
    },
    # --- 硬编码 API 密钥 ---
    {
        "rule": "hardcoded_api_key_js",
        "regex": r'(?:api[-_]?key|apikey|secret|token)\s*[:=]\s*["\'][A-Za-z0-9_\-]{20,}["\']',
        "severity": SEVERITY_HIGH,
        "description": "JavaScript 中硬编码了 API 密钥",
        "fix": "将 API 密钥移至服务端，不暴露在前端代码中",
        "category": "api",
    },
    # --- 不安全 fetch ---
    {
        "rule": "unsafe_fetch_credentials",
        "regex": r"fetch\s*\([^)]*credentials\s*:\s*['\"]include['\"]",
        "severity": SEVERITY_MEDIUM,
        "description": "fetch 请求携带 credentials: 'include' 但未验证 URL 来源",
        "fix": "仅在信任的同源请求中使用 credentials: 'include'",
        "category": "api",
    },
    # --- jQuery XSS ---
    {
        "rule": "jquery_xss_html",
        "regex": r'\$\s*\([^)]*\)\.html\s*\(',
        "severity": SEVERITY_HIGH,
        "description": "jQuery .html() 方法可能导致 XSS",
        "fix": "使用 .text() 替代 .html()，或对内容进行转义",
        "category": "xss",
    },
    {
        "rule": "jquery_xss_selector",
        "regex": r'\$\s*\(\s*(?:location|window\.location|document\.URL|document\.documentURI|document\.referrer|document\.location\.hash)',
        "severity": SEVERITY_HIGH,
        "description": "jQuery 选择器中使用用户可控数据，可能导致 XSS",
        "fix": "不使用用户输入作为 jQuery 选择器",
        "category": "xss",
    },
    # --- 不安全 href ---
    {
        "rule": "unsafe_href",
        "regex": r'<a\s+[^>]*href\s*=\s*["\'](?:javascript:|data:)',
        "severity": SEVERITY_HIGH,
        "description": "a 标签 href 使用 javascript: 或 data: 协议，存在 XSS 风险",
        "fix": "禁止使用 javascript: 和 data: 协议的 href",
        "category": "xss",
    },
    # --- PHP SQL 注入 ---
    {
        "rule": "php_sql_injection",
        "regex": r'mysql_query\s*\(\s*["\'].*\$_(?:GET|POST|REQUEST|COOKIE)',
        "severity": SEVERITY_CRITICAL,
        "description": "PHP SQL 查询直接拼接用户输入，存在 SQL 注入",
        "fix": "使用 PDO 预处理语句和参数化查询",
        "category": "xss",
    },
    {
        "rule": "php_sql_injection_mysqli",
        "regex": r'mysqli?_query\s*\(\s*[^,]*,\s*["\'].*\$',
        "severity": SEVERITY_CRITICAL,
        "description": "PHP mysqli 查询拼接变量，存在 SQL 注入",
        "fix": "使用 mysqli 预处理语句：mysqli_prepare()",
        "category": "xss",
    },
    # --- PHP 命令注入 ---
    {
        "rule": "php_command_injection",
        "regex": r'(?:system|exec|shell_exec|passthru|popen|proc_open)\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)',
        "severity": SEVERITY_CRITICAL,
        "description": "PHP 命令执行函数直接使用用户输入，存在命令注入",
        "fix": "避免执行系统命令，使用安全替代方案或严格验证输入",
        "category": "dangerous",
    },
    # --- PHP 文件包含 ---
    {
        "rule": "php_file_inclusion",
        "regex": r'(?:include|require|include_once|require_once)\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)',
        "severity": SEVERITY_CRITICAL,
        "description": "PHP 文件包含使用用户输入，存在 LFI/RFI 漏洞",
        "fix": "使用白名单验证文件名，不要包含用户输入",
        "category": "dangerous",
    },
    {
        "rule": "php_eval",
        "regex": r'\beval\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)',
        "severity": SEVERITY_CRITICAL,
        "description": "PHP eval() 直接执行用户输入，存在代码注入",
        "fix": "禁止使用 eval() 执行用户输入",
        "category": "dangerous",
    },
    # --- 不安全 CORS ---
    {
        "rule": "insecure_cors",
        "regex": r"Access-Control-Allow-Origin\s*[:=]\s*['\"]?\*['\"]?",
        "severity": SEVERITY_MEDIUM,
        "description": "CORS 设置为 *，允许任意来源访问",
        "fix": "设置具体的允许来源，不使用通配符 *",
        "category": "api",
    },
]


def _check_file_size(filepath, max_size_mb=5):
    """检查文件大小是否超过限制，返回 (是否在限制内, 文件大小字节)"""
    try:
        size = os.path.getsize(filepath)
        max_bytes = max_size_mb * 1024 * 1024
        if size > max_bytes:
            return False, size
        return True, size
    except OSError:
        return True, 0


def get_source_lines(filepath: str) -> List[str]:
    """读取文件内容并按行分割"""
    # 文件大小检查（限制5MB），超过限制跳过该文件
    ok, size = _check_file_size(filepath, max_size_mb=5)
    if not ok:
        print(f"[警告] 文件过大（{size}字节），跳过 {filepath}", file=sys.stderr)
        return []
    try:
        lines = []
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                lines.append(line)
        return lines
    except Exception as e:
        print(f"[警告] 读取文件失败 {filepath}: {e}", file=sys.stderr)
        return []


def scan_file(filepath: str, check_type: str = "all") -> Dict[str, Any]:
    """扫描单个 Web 文件（JS/HTML/PHP）"""
    lines = get_source_lines(filepath)
    if not lines:
        return {"file": filepath, "total_issues": 0, "issues": [], "summary": {}}

    issues = []
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        # 跳过注释行
        if stripped.startswith("//") or stripped.startswith("<!--") or stripped.startswith("*"):
            continue
        for rule_def in WEB_RULES:
            # 根据检查类型过滤
            if check_type != "all":
                if rule_def["category"] != check_type:
                    continue
            try:
                if re.search(rule_def["regex"], line, re.IGNORECASE):
                    issues.append({
                        "rule": rule_def["rule"],
                        "severity": rule_def["severity"],
                        "file": filepath,
                        "line": i,
                        "code": stripped[:200],
                        "description": rule_def["description"],
                        "fix": rule_def["fix"],
                    })
            except re.error:
                continue

    # 统计
    summary = {SEVERITY_CRITICAL: 0, SEVERITY_HIGH: 0, SEVERITY_MEDIUM: 0, SEVERITY_LOW: 0}
    for issue in issues:
        sev = issue.get("severity", SEVERITY_LOW)
        if sev in summary:
            summary[sev] += 1

    return {
        "file": filepath,
        "total_issues": len(issues),
        "issues": issues,
        "summary": summary,
    }


def scan_directory(dirpath: str, check_type: str = "all") -> List[Dict[str, Any]]:
    """递归扫描目录中的所有 Web 文件"""
    results = []
    web_extensions = (".js", ".html", ".htm", ".php", ".jsx", ".ts", ".tsx", ".vue")
    for root, dirs, files in os.walk(dirpath):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "dist", "build")]
        for fname in files:
            if fname.endswith(web_extensions):
                fpath = os.path.join(root, fname)
                result = scan_file(fpath, check_type)
                results.append(result)
    return results


def main():
    """主函数：解析参数并执行审计"""
    parser = argparse.ArgumentParser(
        description="Web 前端代码安全审计工具 - 检测 DOM XSS、CSRF、Clickjacking、localStorage 滥用等安全问题"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--file", help="要审计的 Web 文件路径（.js/.html/.php）")
    group.add_argument("--dir", help="要递归审计的目录路径")
    parser.add_argument(
        "--check",
        default="all",
        choices=["all", "xss", "csrf", "clickjacking", "crypto", "api", "dangerous"],
        help="检测类型（默认 all）",
    )
    parser.add_argument("-o", "--output", help="结果保存到 JSON 文件（可选）")
    args = parser.parse_args()

    try:
        if args.file:
            if not os.path.isfile(args.file):
                result = {"error": f"文件不存在: {args.file}"}
            else:
                result = scan_file(args.file, args.check)
        else:
            if not os.path.isdir(args.dir):
                result = {"error": f"目录不存在: {args.dir}"}
            else:
                file_results = scan_directory(args.dir, args.check)
                total_issues = sum(r.get("total_issues", 0) for r in file_results)
                summary = {SEVERITY_CRITICAL: 0, SEVERITY_HIGH: 0, SEVERITY_MEDIUM: 0, SEVERITY_LOW: 0}
                all_issues = []
                for r in file_results:
                    for sev, cnt in r.get("summary", {}).items():
                        if sev in summary:
                            summary[sev] += cnt
                    all_issues.extend(r.get("issues", []))
                result = {
                    "directory": args.dir,
                    "total_files": len(file_results),
                    "total_issues": total_issues,
                    "files": file_results,
                    "summary": summary,
                }

        output_json = json.dumps(result, ensure_ascii=False, indent=2)
        print(output_json)

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output_json)

    except Exception as e:
        error_result = {"error": f"审计过程出错: {str(e)}"}
        print(json.dumps(error_result, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
