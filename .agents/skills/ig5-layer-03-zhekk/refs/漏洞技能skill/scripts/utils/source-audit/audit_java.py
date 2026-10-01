#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Java 源代码安全审计工具

通过正则表达式检测 Java 代码中的安全漏洞，覆盖 SQL 注入、命令注入、XXE、反序列化、不安全加密等 15+ 类安全问题。

输出格式：JSON
"""

import argparse
import json
import os
import re
import sys
from typing import List, Dict, Any
import signal


# ============================================================
# 严重等级定义
# ============================================================
SEVERITY_CRITICAL = "critical"
SEVERITY_HIGH = "high"
SEVERITY_MEDIUM = "medium"
SEVERITY_LOW = "low"


# ============================================================
# Java 安全审计规则定义
# ============================================================
JAVA_RULES = [
    # --- SQL 注入 ---
    {
        "rule": "sql_injection_execute_query",
        "regex": r'executeQuery\s*\(\s*["\'].*(?:\+|\s*concat\s*\()',
        "severity": SEVERITY_CRITICAL,
        "description": "Statement.executeQuery() 中使用字符串拼接 SQL，存在 SQL 注入风险",
        "fix": "使用 PreparedStatement 参数化查询：ps.setString(1, userInput)",
        "category": "sqli",
    },
    {
        "rule": "sql_injection_execute",
        "regex": r'\.execute\s*\(\s*["\'].*\+',
        "severity": SEVERITY_CRITICAL,
        "description": "Statement.execute() 中使用字符串拼接 SQL",
        "fix": "使用 PreparedStatement 参数化查询",
        "category": "sqli",
    },
    {
        "rule": "sql_injection_string_concat",
        "regex": r'(?:String\s+sql|String\s+query)\s*=\s*["\'].*(?:\+|%\s*.*\+)',
        "severity": SEVERITY_CRITICAL,
        "description": "SQL 语句使用字符串拼接构造，存在注入风险",
        "fix": "使用 PreparedStatement 和参数化查询",
        "category": "sqli",
    },
    {
        "rule": "sql_injection_format",
        "regex": r'String\.format\s*\(\s*["\']SELECT',
        "severity": SEVERITY_HIGH,
        "description": "SQL 语句使用 String.format() 构造，存在注入风险",
        "fix": "使用 PreparedStatement 参数化查询",
        "category": "sqli",
    },
    # --- 命令注入 ---
    {
        "rule": "command_injection_runtime_exec",
        "regex": r'Runtime\.getRuntime\s*\(\s*\)\.exec\s*\(',
        "severity": SEVERITY_CRITICAL,
        "description": "Runtime.exec() 执行外部命令，存在命令注入风险",
        "fix": "使用 ProcessBuilder 并对输入进行严格验证",
        "category": "dangerous",
    },
    {
        "rule": "command_injection_process_builder",
        "regex": r'new\s+ProcessBuilder\s*\(',
        "severity": SEVERITY_HIGH,
        "description": "使用 ProcessBuilder 执行命令，需验证输入参数",
        "fix": "对命令参数进行白名单验证，避免拼接用户输入",
        "category": "dangerous",
    },
    # --- XSS ---
    {
        "rule": "xss_println_user_input",
        "regex": r'response\.getWriter\s*\(\s*\)\.println\s*\(',
        "severity": SEVERITY_HIGH,
        "description": "直接输出到响应可能存在 XSS 风险",
        "fix": "对输出内容进行 HTML 转义：StringEscapeUtils.escapeHtml4()",
        "category": "xss",
    },
    {
        "rule": "xss_set_attribute",
        "regex": r'request\.setAttribute\s*\(\s*["\'].*["\']\s*,\s*\w+',
        "severity": SEVERITY_MEDIUM,
        "description": "将用户输入设置到请求属性，渲染时可能产生 XSS",
        "fix": "对用户输入进行 HTML 转义后再设置",
        "category": "xss",
    },
    # --- 路径穿越 ---
    {
        "rule": "path_traversal_new_file",
        "regex": r'new\s+File\s*\(\s*(?:request\.|userInput|input|param)',
        "severity": SEVERITY_HIGH,
        "description": "使用用户输入构造文件路径，存在路径穿越风险",
        "fix": "验证和清洗文件路径，使用 Path.normalize() 检查",
        "category": "dangerous",
    },
    {
        "rule": "path_traversal_file_input_stream",
        "regex": r'new\s+FileInputStream\s*\(\s*(?:request\.|userInput|input|param)',
        "severity": SEVERITY_HIGH,
        "description": "使用用户输入构造文件输入流，存在路径穿越风险",
        "fix": "验证文件路径，限制访问目录范围",
        "category": "dangerous",
    },
    # --- 反序列化 ---
    {
        "rule": "deserialization_read_object",
        "regex": r'ObjectInputStream.*readObject\s*\(\s*\)',
        "severity": SEVERITY_CRITICAL,
        "description": "ObjectInputStream.readObject() 反序列化不可信数据，可能导致 RCE",
        "fix": "使用白名单反序列化过滤器或 JSON 等安全格式",
        "category": "deserialization",
    },
    {
        "rule": "deserialization_xmldecoder",
        "regex": r'XMLDecoder\s*\(',
        "severity": SEVERITY_CRITICAL,
        "description": "XMLDecoder 反序列化 XML 数据，可能导致 RCE",
        "fix": "避免使用 XMLDecoder，使用安全的 XML 解析方式",
        "category": "deserialization",
    },
    # --- 硬编码密码 ---
    {
        "rule": "hardcoded_password",
        "regex": r'(?:password|passwd|pwd)\s*=\s*"[^"]{3,}"',
        "severity": SEVERITY_HIGH,
        "description": "代码中硬编码了密码",
        "fix": "从配置文件或环境变量读取密码",
        "category": "crypto",
    },
    {
        "rule": "hardcoded_secret",
        "regex": r'(?:secret|api[-_]?key|token)\s*=\s*"[^"]{10,}"',
        "severity": SEVERITY_HIGH,
        "description": "代码中硬编码了密钥/Token",
        "fix": "从配置中心或环境变量读取密钥",
        "category": "crypto",
    },
    # --- SSRF ---
    {
        "rule": "ssrf_url_openconnection",
        "regex": r'new\s+URL\s*\(\s*(?:request\.|userInput|url|target|endpoint)',
        "severity": SEVERITY_HIGH,
        "description": "使用用户输入构造 URL 并打开连接，存在 SSRF 风险",
        "fix": "验证 URL 域名白名单，禁止访问内网地址",
        "category": "ssrf",
    },
    {
        "rule": "ssrf_httpurlconnection",
        "regex": r'HttpURLConnection.*connect\s*\(\s*\)',
        "severity": SEVERITY_MEDIUM,
        "description": "HttpURLConnection 连接可能来自用户输入",
        "fix": "验证目标 URL，限制可访问的地址范围",
        "category": "ssrf",
    },
    # --- XXE ---
    {
        "rule": "xxe_document_builder",
        "regex": r'DocumentBuilderFactory\.newInstance\s*\(\s*\)',
        "severity": SEVERITY_HIGH,
        "description": "DocumentBuilderFactory 未禁用外部实体，存在 XXE 风险",
        "fix": "设置 factory.setFeature(\"http://apache.org/xml/features/disallow-doctype-decl\", true)",
        "category": "dangerous",
    },
    {
        "rule": "xxe_sax_parser",
        "regex": r'SAXParserFactory\.newInstance\s*\(\s*\)',
        "severity": SEVERITY_HIGH,
        "description": "SAXParserFactory 未禁用外部实体，存在 XXE 风险",
        "fix": "设置 factory.setFeature(\"http://apache.org/xml/features/disallow-doctype-decl\", true)",
        "category": "dangerous",
    },
    {
        "rule": "xxe_xml_reader",
        "regex": r'XMLReaderFactory\.createXMLReader\s*\(\s*\)',
        "severity": SEVERITY_HIGH,
        "description": "XMLReader 未设置安全特性，存在 XXE 风险",
        "fix": "设置 reader.setFeature(\"http://apache.org/xml/features/disallow-doctype-decl\", true)",
        "category": "dangerous",
    },
    # --- 不安全加密 ---
    {
        "rule": "insecure_crypto_des",
        "regex": r'Cipher\.getInstance\s*\(\s*["\']DES["\']',
        "severity": SEVERITY_HIGH,
        "description": "使用 DES 弱加密算法",
        "fix": "使用 AES-256-GCM 替代 DES",
        "category": "crypto",
    },
    {
        "rule": "insecure_crypto_ecb",
        "regex": r'Cipher\.getInstance\s*\(\s*["\']AES/ECB',
        "severity": SEVERITY_HIGH,
        "description": "使用 AES ECB 模式，不安全",
        "fix": "使用 AES/GCM/NoPadding 或 CBC 模式并使用随机 IV",
        "category": "crypto",
    },
    {
        "rule": "insecure_crypto_no_iv",
        "regex": r'Cipher\.getInstance\s*\(\s*["\']AES["\']\s*\)',
        "severity": SEVERITY_MEDIUM,
        "description": "AES 未指定模式和 IV，默认使用 ECB 模式",
        "fix": "使用 AES/GCM/NoPadding 并提供随机 IV",
        "category": "crypto",
    },
    # --- 不安全随机 ---
    {
        "rule": "insecure_random_math",
        "regex": r'Math\.random\s*\(\s*\)',
        "severity": SEVERITY_LOW,
        "description": "Math.random() 不适用于安全场景",
        "fix": "安全场景使用 SecureRandom",
        "category": "crypto",
    },
    {
        "rule": "insecure_random_util_random",
        "regex": r'new\s+Random\s*\(\s*\)',
        "severity": SEVERITY_LOW,
        "description": "java.util.Random 不适用于安全场景",
        "fix": "安全场景使用 SecureRandom",
        "category": "crypto",
    },
    # --- SpEL 注入 ---
    {
        "rule": "spel_injection",
        "regex": r'parser\.parseExpression\s*\(\s*(?:request\.|userInput|input|param)',
        "severity": SEVERITY_CRITICAL,
        "description": "SpEL 表达式使用用户输入，存在表达式注入风险",
        "fix": "避免将用户输入作为 SpEL 表达式执行",
        "category": "dangerous",
    },
    # --- 不安全重定向 ---
    {
        "rule": "open_redirect",
        "regex": r'response\.sendRedirect\s*\(\s*(?:request\.|userInput|input|param|url)',
        "severity": SEVERITY_HIGH,
        "description": "使用用户输入进行重定向，存在开放重定向风险",
        "fix": "使用白名单验证重定向 URL",
        "category": "dangerous",
    },
    # --- JNDI 注入 ---
    {
        "rule": "jndi_injection",
        "regex": r'(?:InitialContext|ctx)\.lookup\s*\(\s*(?:request\.|userInput|input|param)',
        "severity": SEVERITY_CRITICAL,
        "description": "JNDI lookup 使用用户输入，存在 JNDI 注入风险（如 Log4Shell）",
        "fix": "避免 JNDI lookup 用户可控数据，使用白名单",
        "category": "dangerous",
    },
    # --- 不安全文件上传 ---
    {
        "rule": "insecure_file_upload",
        "regex": r'(?:getOriginalFilename|getFileName)\s*\(\s*\)',
        "severity": SEVERITY_MEDIUM,
        "description": "文件上传未验证文件类型，可能上传恶意文件",
        "fix": "验证文件扩展名和 MIME 类型，使用白名单",
        "category": "dangerous",
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
    """扫描单个 Java 文件"""
    lines = get_source_lines(filepath)
    if not lines:
        return {"file": filepath, "total_issues": 0, "issues": [], "summary": {}}

    issues = []
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        # 跳过注释行
        if stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*"):
            continue
        for rule_def in JAVA_RULES:
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
    """递归扫描目录中的所有 Java 文件"""
    results = []
    for root, dirs, files in os.walk(dirpath):
        dirs[:] = [d for d in dirs if d not in (".git", "target", "build", "node_modules")]
        for fname in files:
            if fname.endswith(".java"):
                fpath = os.path.join(root, fname)
                result = scan_file(fpath, check_type)
                results.append(result)
    return results



_timeout_value = 300

def _timeout_handler(signum, frame):
    """超时信号处理器"""
    print(json.dumps({"status": "timeout", "error": f"操作超时({_timeout_value}秒)", "timeout": _timeout_value}, ensure_ascii=False))
    sys.exit(1)


def main():
    """主函数：解析参数并执行审计"""
    parser = argparse.ArgumentParser(
        description="Java 源代码安全审计工具 - 检测 SQL 注入、命令注入、XXE、反序列化等安全漏洞"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--file", help="要审计的 Java 文件路径")
    group.add_argument("--dir", help="要递归审计的目录路径")
    parser.add_argument(
        "--check",
        default="all",
        choices=["all", "sqli", "xss", "crypto", "dangerous", "ssrf", "deserialization"],
        help="检测类型（默认 all）",
    )
    parser.add_argument("-o", "--output", help="结果保存到 JSON 文件（可选）")
    parser.add_argument("--timeout", type=int, default=300, help="操作超时时间(秒)")
    args = parser.parse_args()

    global _timeout_value
    _timeout_value = args.timeout
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(args.timeout)

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
