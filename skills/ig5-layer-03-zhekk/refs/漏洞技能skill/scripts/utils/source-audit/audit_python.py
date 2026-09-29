#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Python 源代码安全审计工具

使用 AST + 正则表达式双重检测机制，扫描 Python 代码中的安全漏洞。
检测规则覆盖 SQL 注入、命令注入、路径穿越、XSS、硬编码密钥、SSRF、反序列化等 20+ 类安全问题。

输出格式：JSON
"""

import argparse
import ast
import json
import os
import re
import sys
from typing import List, Dict, Any, Optional
import signal


# ============================================================
# 严重等级定义
# ============================================================
SEVERITY_CRITICAL = "critical"
SEVERITY_HIGH = "high"
SEVERITY_MEDIUM = "medium"
SEVERITY_LOW = "low"


# ============================================================
# 正则规则定义（每条规则包含名称、正则、严重等级、描述、修复建议）
# ============================================================
REGEX_RULES = [
    {
        "rule": "sql_injection_fstring",
        "regex": r'(?:execute|executemany)\s*\(\s*(?:f["\']|f["\'].*\{)',
        "severity": SEVERITY_CRITICAL,
        "description": "SQL 查询中使用了 f-string 格式化字符串，存在 SQL 注入风险",
        "fix": "使用参数化查询，如 cursor.execute('SELECT * FROM users WHERE id=?', (user_id,))",
    },
    {
        "rule": "sql_injection_format",
        "regex": r'(?:execute|executemany)\s*\(\s*["\'].*\.format\s*\(',
        "severity": SEVERITY_CRITICAL,
        "description": "SQL 查询中使用了 .format() 方法拼接，存在 SQL 注入风险",
        "fix": "使用参数化查询替代字符串格式化",
    },
    {
        "rule": "sql_injection_concat",
        "regex": r'(?:execute|executemany)\s*\(\s*["\'].*(?:%s|%d|%r)\s*["\']\s*%\s*\(',
        "severity": SEVERITY_CRITICAL,
        "description": "SQL 查询中使用了 % 格式化拼接，存在 SQL 注入风险",
        "fix": "使用参数化查询，避免使用 % 拼接 SQL 语句",
    },
    {
        "rule": "sql_injection_text",
        "regex": r'text\s*\(\s*f["\']',
        "severity": SEVERITY_CRITICAL,
        "description": "SQLAlchemy text() 中使用了 f-string，存在 SQL 注入风险",
        "fix": "使用绑定参数：text('SELECT * FROM t WHERE id=:id').bindparams(id=user_id)",
    },
    {
        "rule": "command_injection_os_system",
        "regex": r'os\.system\s*\(',
        "severity": SEVERITY_CRITICAL,
        "description": "使用 os.system() 执行命令，存在命令注入风险",
        "fix": "使用 subprocess.run(['cmd', 'arg1'], shell=False) 并验证输入",
    },
    {
        "rule": "command_injection_popen",
        "regex": r'os\.popen\s*\(',
        "severity": SEVERITY_CRITICAL,
        "description": "使用 os.popen() 执行命令，存在命令注入风险",
        "fix": "使用 subprocess.run() 并设置 shell=False",
    },
    {
        "rule": "command_injection_subprocess_shell",
        "regex": r'subprocess\.(?:call|run|Popen|check_output|check_call)\s*\(.*shell\s*=\s*True',
        "severity": SEVERITY_CRITICAL,
        "description": "subprocess 调用时 shell=True，存在命令注入风险",
        "fix": "设置 shell=False，使用列表形式传参",
    },
    {
        "rule": "hardcoded_password",
        "regex": r'(?:password|passwd|pwd)\s*=\s*["\'][^"\']{3,}["\']',
        "severity": SEVERITY_HIGH,
        "description": "代码中硬编码了密码",
        "fix": "从环境变量或配置文件读取密码：os.environ.get('DB_PASSWORD')",
    },
    {
        "rule": "hardcoded_api_key",
        "regex": r'(?:api_key|apikey|api[-_]?secret)\s*=\s*["\'][^"\']{10,}["\']',
        "severity": SEVERITY_HIGH,
        "description": "代码中硬编码了 API 密钥",
        "fix": "将 API 密钥存储在环境变量或密钥管理服务中",
    },
    {
        "rule": "hardcoded_secret",
        "regex": r'(?:secret|secret_key|app_secret)\s*=\s*["\'][^"\']{6,}["\']',
        "severity": SEVERITY_HIGH,
        "description": "代码中硬编码了密钥/Secret",
        "fix": "从环境变量或密钥管理服务读取密钥",
    },
    {
        "rule": "hardcoded_token",
        "regex": r'(?:token|auth_token|access_token)\s*=\s*["\'][^"\']{10,}["\']',
        "severity": SEVERITY_HIGH,
        "description": "代码中硬编码了 Token",
        "fix": "从环境变量或配置中心读取 Token",
    },
    {
        "rule": "ssrf_requests",
        "regex": r'requests\.(?:get|post|put|delete|head|patch)\s*\([^)]*(?:url|host|target|endpoint|uri)',
        "severity": SEVERITY_HIGH,
        "description": "requests 请求 URL 可能来自用户输入，存在 SSRF 风险",
        "fix": "验证和限制请求 URL 的域名/IP，禁止访问内网地址",
    },
    {
        "rule": "ssrf_urllib",
        "regex": r'urllib\.(?:request\.)?urlopen\s*\(',
        "severity": SEVERITY_HIGH,
        "description": "urllib.urlopen 请求 URL 可能来自用户输入，存在 SSRF 风险",
        "fix": "验证 URL 来源，限制可访问的域名和 IP 范围",
    },
    {
        "rule": "pickle_loads",
        "regex": r'pickle\.(?:loads?|load)\s*\(',
        "severity": SEVERITY_CRITICAL,
        "description": "pickle 反序列化不可信数据，可能导致远程代码执行",
        "fix": "避免 pickle 反序列化不可信数据，使用 JSON 等安全格式",
    },
    {
        "rule": "yaml_unsafe_load",
        "regex": r'yaml\.load\s*\([^)]*(?:Loader\s*=\s*yaml\.Loader|Loader\s*=\s*yaml\.FullLoader)',
        "severity": SEVERITY_HIGH,
        "description": "yaml.load 使用不安全的 Loader，可能导致代码执行",
        "fix": "使用 yaml.safe_load() 替代 yaml.load()",
    },
    {
        "rule": "yaml_unsafe_load_no_loader",
        "regex": r'yaml\.load\s*\([^)]*\)\s*(?:#.*)?$',
        "severity": SEVERITY_CRITICAL,
        "description": "yaml.load 未指定 Loader，可能使用不安全的默认加载器",
        "fix": "使用 yaml.safe_load() 替代",
    },
    {
        "rule": "dangerous_eval",
        "regex": r'\beval\s*\(',
        "severity": SEVERITY_CRITICAL,
        "description": "使用 eval() 执行动态代码，存在代码注入风险",
        "fix": "避免使用 eval()，使用 ast.literal_eval() 或专用解析器",
    },
    {
        "rule": "dangerous_exec",
        "regex": r'\bexec\s*\(',
        "severity": SEVERITY_CRITICAL,
        "description": "使用 exec() 执行动态代码，存在代码注入风险",
        "fix": "避免使用 exec()，重构代码逻辑",
    },
    {
        "rule": "weak_hash_md5",
        "regex": r'hashlib\.md5\s*\(',
        "severity": SEVERITY_MEDIUM,
        "description": "使用 MD5 弱哈希算法",
        "fix": "使用 hashlib.sha256 或更强的哈希算法",
    },
    {
        "rule": "weak_hash_sha1",
        "regex": r'hashlib\.sha1\s*\(',
        "severity": SEVERITY_MEDIUM,
        "description": "使用 SHA1 弱哈希算法",
        "fix": "使用 hashlib.sha256 或更强的哈希算法",
    },
    {
        "rule": "tempfile_mktemp",
        "regex": r'tempfile\.mktemp\s*\(',
        "severity": SEVERITY_MEDIUM,
        "description": "tempfile.mktemp() 存在竞争条件漏洞",
        "fix": "使用 tempfile.mkstemp() 替代",
    },
    {
        "rule": "xml_external_entity",
        "regex": r'(?:xml\.dom\.minidom|xml\.etree\.ElementTree|xml\.sax)\.(?:parse|parseString)\s*\(',
        "severity": SEVERITY_HIGH,
        "description": "XML 解析器未禁用外部实体，存在 XXE 漏洞",
        "fix": "使用 defusedxml 库替代标准 XML 解析器",
    },
    {
        "rule": "insecure_random",
        "regex": r'random\.(?:randint|random|choice|randrange)\s*\(',
        "severity": SEVERITY_LOW,
        "description": "使用 random 模块生成随机数，不适用于安全场景",
        "fix": "安全场景使用 secrets 模块：secrets.token_hex()",
    },
    {
        "rule": "django_debug_true",
        "regex": r'DEBUG\s*=\s*True',
        "severity": SEVERITY_HIGH,
        "description": "Django DEBUG 模式开启，生产环境会泄露敏感信息",
        "fix": "生产环境设置 DEBUG=False",
    },
    {
        "rule": "django_allowed_hosts_star",
        "regex": r'ALLOWED_HOSTS\s*=\s*\[.*\*.*\]',
        "severity": SEVERITY_MEDIUM,
        "description": "Django ALLOWED_HOSTS 设置为 ['*']，允许任意域名访问",
        "fix": "设置具体的允许域名列表",
    },
    {
        "rule": "flask_debug_true",
        "regex": r'app\.run\s*\(.*debug\s*=\s*True',
        "severity": SEVERITY_HIGH,
        "description": "Flask debug 模式开启，存在调试器代码执行风险",
        "fix": "生产环境设置 debug=False",
    },
    {
        "rule": "jwt_verify_false",
        "regex": r'verify\s*=\s*False',
        "severity": SEVERITY_CRITICAL,
        "description": "JWT 验证被关闭，任何人可伪造 Token",
        "fix": "始终启用 JWT 签名验证",
    },
    {
        "rule": "jwt_algorithm_none",
        "regex": r'algorithms?\s*=\s*\[.*[\'\"]none[\'\"]',
        "severity": SEVERITY_CRITICAL,
        "description": "JWT 允许 none 算法，可绕过签名验证",
        "fix": "移除 none 算法，仅使用 HS256/RS256 等安全算法",
    },
    {
        "rule": "ssl_verify_false",
        "regex": r'verify\s*=\s*False',
        "severity": SEVERITY_HIGH,
        "description": "SSL 证书验证被关闭，存在中间人攻击风险",
        "fix": "设置 verify=True，确保 SSL 证书验证开启",
    },
    {
        "rule": "redos_nested_quantifiers",
        "regex": r'(\.\*\+|\+\.\*|\.\*\{.*\}.*\{.*\}|\+\+|\*\*)',
        "severity": SEVERITY_MEDIUM,
        "description": "正则表达式中存在嵌套量词，可能导致 ReDoS 拒绝服务",
        "fix": "简化正则表达式，避免嵌套量词或使用原子分组",
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


def regex_scan(filepath: str, lines: List[str], check_type: str) -> List[Dict[str, Any]]:
    """使用正则表达式扫描代码行"""
    issues = []
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        # 跳过注释行
        if stripped.startswith("#"):
            continue
        for rule_def in REGEX_RULES:
            rule_name = rule_def["rule"]
            # 根据检查类型过滤规则
            if check_type != "all":
                category_map = {
                    "sqli": ["sql_injection"],
                    "xss": ["xss"],
                    "crypto": ["weak_hash", "hardcoded", "jwt"],
                    "dangerous": ["dangerous_eval", "dangerous_exec", "command_injection", "pickle", "yaml_unsafe"],
                    "ssrf": ["ssrf"],
                    "command_injection": ["command_injection"],
                    "path_traversal": ["path_traversal"],
                }
                matched = False
                for cat, prefixes in category_map.items():
                    if check_type == cat and any(rule_name.startswith(p) for p in prefixes):
                        matched = True
                        break
                if not matched:
                    continue
            try:
                if re.search(rule_def["regex"], line, re.IGNORECASE):
                    issues.append({
                        "rule": rule_name,
                        "severity": rule_def["severity"],
                        "file": filepath,
                        "line": i,
                        "code": stripped[:200],
                        "description": rule_def["description"],
                        "fix": rule_def["fix"],
                    })
            except re.error:
                continue
    return issues


def ast_scan(filepath: str, source: str, check_type: str) -> List[Dict[str, Any]]:
    """使用 AST 分析代码结构和安全问题"""
    issues = []
    try:
        tree = ast.parse(source, filename=filepath)
    except SyntaxError as e:
        issues.append({
            "rule": "syntax_error",
            "severity": SEVERITY_LOW,
            "file": filepath,
            "line": e.lineno or 0,
            "code": str(e),
            "description": f"语法错误: {e.msg}",
            "fix": "修复语法错误后重新审计",
        })
        return issues
    except Exception:
        return issues

    lines = source.splitlines()

    for node in ast.walk(tree):
        # --- SQL 注入检测：execute 调用中使用了 f-string 或 format ---
        if check_type in ("all", "sqli"):
            if isinstance(node, ast.Call):
                func_name = ""
                if isinstance(node.func, ast.Attribute):
                    func_name = node.func.attr
                elif isinstance(node.func, ast.Name):
                    func_name = node.func.id

                # 检测 execute 中使用 f-string
                if func_name in ("execute", "executemany"):
                    if node.args:
                        first_arg = node.args[0]
                        if isinstance(first_arg, ast.JoinedStr):
                            issues.append({
                                "rule": "sql_injection_fstring_ast",
                                "severity": SEVERITY_CRITICAL,
                                "file": filepath,
                                "line": node.lineno,
                                "code": lines[node.lineno - 1].strip()[:200] if node.lineno <= len(lines) else "",
                                "description": "AST 检测到 execute() 中使用 f-string，存在 SQL 注入风险",
                                "fix": "使用参数化查询，如 cursor.execute('SELECT * FROM t WHERE id=?', (uid,))",
                            })
                        elif isinstance(first_arg, ast.BinOp) and isinstance(first_arg.op, ast.Mod):
                            issues.append({
                                "rule": "sql_injection_mod_ast",
                                "severity": SEVERITY_CRITICAL,
                                "file": filepath,
                                "line": node.lineno,
                                "code": lines[node.lineno - 1].strip()[:200] if node.lineno <= len(lines) else "",
                                "description": "AST 检测到 execute() 中使用 % 格式化，存在 SQL 注入风险",
                                "fix": "使用参数化查询替代 % 格式化",
                            })

                # 检测 text(f"...") SQLAlchemy
                if func_name == "text":
                    if node.args and isinstance(node.args[0], ast.JoinedStr):
                        issues.append({
                            "rule": "sql_injection_text_ast",
                            "severity": SEVERITY_CRITICAL,
                            "file": filepath,
                            "line": node.lineno,
                            "code": lines[node.lineno - 1].strip()[:200] if node.lineno <= len(lines) else "",
                            "description": "SQLAlchemy text() 中使用 f-string，存在 SQL 注入风险",
                            "fix": "使用绑定参数：text('...WHERE id=:id').bindparams(id=uid)",
                        })

        # --- 命令注入检测 ---
        if check_type in ("all", "dangerous", "command_injection"):
            if isinstance(node, ast.Call):
                func_name = ""
                if isinstance(node.func, ast.Attribute):
                    func_name = node.func.attr
                elif isinstance(node.func, ast.Name):
                    func_name = node.func.id

                if func_name in ("system",) and isinstance(node.func, ast.Attribute):
                    if isinstance(node.func.value, ast.Name) and node.func.value.id == "os":
                        issues.append({
                            "rule": "command_injection_os_system_ast",
                            "severity": SEVERITY_CRITICAL,
                            "file": filepath,
                            "line": node.lineno,
                            "code": lines[node.lineno - 1].strip()[:200] if node.lineno <= len(lines) else "",
                            "description": "AST 检测到 os.system() 调用，存在命令注入风险",
                            "fix": "使用 subprocess.run(['cmd'], shell=False)",
                        })

                if func_name in ("call", "run", "Popen", "check_output", "check_call"):
                    if isinstance(node.func, ast.Attribute):
                        if isinstance(node.func.value, ast.Name) and node.func.value.id == "subprocess":
                            for kw in node.keywords:
                                if kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                                    issues.append({
                                        "rule": "command_injection_subprocess_shell_ast",
                                        "severity": SEVERITY_CRITICAL,
                                        "file": filepath,
                                        "line": node.lineno,
                                        "code": lines[node.lineno - 1].strip()[:200] if node.lineno <= len(lines) else "",
                                        "description": "AST 检测到 subprocess 调用中 shell=True",
                                        "fix": "设置 shell=False，使用列表传参",
                                    })

                # 检测 eval/exec
                if func_name in ("eval", "exec"):
                    issues.append({
                        "rule": f"dangerous_{func_name}_ast",
                        "severity": SEVERITY_CRITICAL,
                        "file": filepath,
                        "line": node.lineno,
                        "code": lines[node.lineno - 1].strip()[:200] if node.lineno <= len(lines) else "",
                        "description": f"AST 检测到 {func_name}() 调用，存在代码注入风险",
                        "fix": f"避免使用 {func_name}()，使用安全替代方案",
                    })

        # --- 硬编码密钥检测 ---
        if check_type in ("all", "crypto"):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        var_name = target.id.lower()
                        if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                            val = node.value.value
                            if any(kw in var_name for kw in ("password", "passwd", "pwd", "secret", "api_key", "apikey", "token")):
                                if len(val) >= 3:
                                    issues.append({
                                        "rule": "hardcoded_credential_ast",
                                        "severity": SEVERITY_HIGH,
                                        "file": filepath,
                                        "line": node.lineno,
                                        "code": f"{target.id} = '{val[:10]}...'",
                                        "description": f"AST 检测到硬编码凭据: {target.id}",
                                        "fix": "从环境变量或密钥管理服务读取凭据",
                                    })

        # --- 反序列化检测 ---
        if check_type in ("all", "dangerous"):
            if isinstance(node, ast.Call):
                func_name = ""
                if isinstance(node.func, ast.Attribute):
                    func_name = node.func.attr
                elif isinstance(node.func, ast.Name):
                    func_name = node.func.id

                if func_name in ("loads", "load") and isinstance(node.func, ast.Attribute):
                    if isinstance(node.func.value, ast.Name) and node.func.value.id == "pickle":
                        issues.append({
                            "rule": "pickle_deserialization_ast",
                            "severity": SEVERITY_CRITICAL,
                            "file": filepath,
                            "line": node.lineno,
                            "code": lines[node.lineno - 1].strip()[:200] if node.lineno <= len(lines) else "",
                            "description": "AST 检测到 pickle 反序列化，可能导致远程代码执行",
                            "fix": "避免 pickle 反序列化不可信数据，使用 JSON",
                        })

        # --- 路径穿越检测 ---
        if check_type in ("all", "path_traversal"):
            if isinstance(node, ast.Call):
                func_name = ""
                if isinstance(node.func, ast.Name):
                    func_name = node.func.id
                if func_name == "open" and node.args:
                    arg = node.args[0]
                    # 检查 open() 参数是否来自函数调用（可能是用户输入）
                    if isinstance(arg, ast.Call) or (isinstance(arg, ast.Name) and arg.id not in ("__file__",)):
                        issues.append({
                            "rule": "path_traversal_open_ast",
                            "severity": SEVERITY_HIGH,
                            "file": filepath,
                            "line": node.lineno,
                            "code": lines[node.lineno - 1].strip()[:200] if node.lineno <= len(lines) else "",
                            "description": "open() 参数可能来自用户输入，存在路径穿越风险",
                            "fix": "验证和清洗文件路径，使用 os.path.abspath 和 os.path.basename",
                        })

        # --- 弱哈希检测 ---
        if check_type in ("all", "crypto"):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Attribute):
                    if node.func.attr in ("md5", "sha1") and isinstance(node.func.value, ast.Name) and node.func.value.id == "hashlib":
                        issues.append({
                            "rule": f"weak_hash_{node.func.attr}_ast",
                            "severity": SEVERITY_MEDIUM,
                            "file": filepath,
                            "line": node.lineno,
                            "code": lines[node.lineno - 1].strip()[:200] if node.lineno <= len(lines) else "",
                            "description": f"AST 检测到使用弱哈希算法 {node.func.attr}",
                            "fix": "使用 hashlib.sha256 或更强的哈希算法",
                        })

    return issues


def deduplicate_issues(issues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """去重：相同文件、行号、规则的只保留一条"""
    seen = set()
    result = []
    for issue in issues:
        key = (issue.get("file", ""), issue.get("line", 0), issue.get("rule", ""))
        if key not in seen:
            seen.add(key)
            result.append(issue)
    return result


def audit_file(filepath: str, check_type: str = "all") -> Dict[str, Any]:
    """审计单个 Python 文件"""
    lines = get_source_lines(filepath)
    if not lines:
        return {"file": filepath, "total_issues": 0, "issues": [], "summary": {}}

    source = "".join(lines)

    # 正则扫描
    regex_issues = regex_scan(filepath, lines, check_type)

    # AST 扫描
    ast_issues = ast_scan(filepath, source, check_type)

    # 合并并去重
    all_issues = deduplicate_issues(regex_issues + ast_issues)

    # 统计
    summary = {SEVERITY_CRITICAL: 0, SEVERITY_HIGH: 0, SEVERITY_MEDIUM: 0, SEVERITY_LOW: 0}
    for issue in all_issues:
        sev = issue.get("severity", SEVERITY_LOW)
        if sev in summary:
            summary[sev] += 1

    return {
        "file": filepath,
        "total_issues": len(all_issues),
        "issues": all_issues,
        "summary": summary,
    }


def audit_directory(dirpath: str, check_type: str = "all") -> List[Dict[str, Any]]:
    """递归审计目录中的所有 Python 文件"""
    results = []
    for root, dirs, files in os.walk(dirpath):
        # 跳过常见忽略目录
        dirs[:] = [d for d in dirs if d not in (".git", "__pycache__", "node_modules", ".venv", "venv")]
        for fname in files:
            if fname.endswith(".py"):
                fpath = os.path.join(root, fname)
                result = audit_file(fpath, check_type)
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
        description="Python 源代码安全审计工具 - 检测 SQL 注入、命令注入、XSS、硬编码密钥等安全漏洞"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--file", help="要审计的 Python 文件路径")
    group.add_argument("--dir", help="要递归审计的目录路径")
    parser.add_argument(
        "--check",
        default="all",
        choices=["all", "sqli", "xss", "crypto", "dangerous", "ssrf", "command_injection", "path_traversal"],
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
                result = audit_file(args.file, args.check)
        else:
            if not os.path.isdir(args.dir):
                result = {"error": f"目录不存在: {args.dir}"}
            else:
                file_results = audit_directory(args.dir, args.check)
                # 汇总
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
