#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动语言检测和审计工具

根据文件扩展名自动选择对应的审计器，递归扫描目录并汇总所有结果。

输出格式：JSON
"""

import argparse
import json
import os
import signal
import sys
from typing import List, Dict, Any


# ============================================================
# 文件扩展名到语言类型的映射
# ============================================================
LANGUAGE_MAP = {
    ".py": "python",
    ".java": "java",
    ".js": "web",
    ".jsx": "web",
    ".ts": "web",
    ".tsx": "web",
    ".html": "web",
    ".htm": "web",
    ".php": "web",
    ".vue": "web",
}

# 忽略的目录
IGNORE_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv", "target", "build", "dist"}


def detect_language(filepath: str) -> str:
    """根据文件扩展名检测语言类型"""
    ext = os.path.splitext(filepath)[1].lower()
    return LANGUAGE_MAP.get(ext, "unknown")


def scan_python_file(filepath: str) -> Dict[str, Any]:
    """调用 Python 审计器扫描文件"""
    try:
        # 导入同目录下的 audit_python 模块
        script_dir = os.path.dirname(os.path.abspath(__file__))
        if script_dir not in sys.path:
            sys.path.insert(0, script_dir)
        import audit_python
        return audit_python.audit_file(filepath, "all")
    except Exception as e:
        return {"file": filepath, "error": f"Python 审计失败: {str(e)}", "total_issues": 0, "issues": [], "summary": {}}


def scan_java_file(filepath: str) -> Dict[str, Any]:
    """调用 Java 审计器扫描文件"""
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        if script_dir not in sys.path:
            sys.path.insert(0, script_dir)
        import audit_java
        return audit_java.scan_file(filepath, "all")
    except Exception as e:
        return {"file": filepath, "error": f"Java 审计失败: {str(e)}", "total_issues": 0, "issues": [], "summary": {}}


def scan_web_file(filepath: str) -> Dict[str, Any]:
    """调用 Web 审计器扫描文件"""
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        if script_dir not in sys.path:
            sys.path.insert(0, script_dir)
        import audit_web
        return audit_web.scan_file(filepath, "all")
    except Exception as e:
        return {"file": filepath, "error": f"Web 审计失败: {str(e)}", "total_issues": 0, "issues": [], "summary": {}}


def scan_file(filepath: str) -> Dict[str, Any]:
    """根据文件类型自动选择审计器"""
    language = detect_language(filepath)
    result = {"file": filepath, "language": language, "result": None}

    if language == "python":
        result["result"] = scan_python_file(filepath)
    elif language == "java":
        result["result"] = scan_java_file(filepath)
    elif language == "web":
        result["result"] = scan_web_file(filepath)
    else:
        result["result"] = {"file": filepath, "total_issues": 0, "issues": [], "summary": {}, "note": "不支持的语言类型"}

    return result


def scan_directory(dirpath: str) -> Dict[str, Any]:
    """递归扫描目录，对每个文件自动调用对应审计器"""
    all_findings = []
    language_counts = {"python": 0, "java": 0, "web": 0, "unknown": 0}
    issue_counts = {"python": 0, "java": 0, "web": 0}
    total_files = 0
    total_issues = 0

    summary = {"critical": 0, "high": 0, "medium": 0, "low": 0}

    for root, dirs, files in os.walk(dirpath):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        for fname in files:
            fpath = os.path.join(root, fname)
            language = detect_language(fpath)
            if language == "unknown":
                continue

            total_files += 1
            language_counts[language] += 1

            scan_result = scan_file(fpath)
            audit_result = scan_result.get("result", {})
            file_issues = audit_result.get("issues", [])
            file_issue_count = audit_result.get("total_issues", 0)

            total_issues += file_issue_count
            issue_counts[language] += file_issue_count

            # 汇总严重等级统计
            for sev, cnt in audit_result.get("summary", {}).items():
                if sev in summary:
                    summary[sev] += cnt

            # 收集所有发现
            for issue in file_issues:
                issue["language"] = language
                all_findings.append(issue)

    return {
        "directory": dirpath,
        "total_files": total_files,
        "total_issues": total_issues,
        "by_language": language_counts,
        "issues_by_language": issue_counts,
        "findings": all_findings,
        "summary": summary,
    }


def scan_single_file(filepath: str) -> Dict[str, Any]:
    """扫描单个文件"""
    if not os.path.isfile(filepath):
        return {"error": f"文件不存在: {filepath}"}

    language = detect_language(filepath)
    scan_result = scan_file(filepath)
    audit_result = scan_result.get("result", {})

    return {
        "file": filepath,
        "language": language,
        "total_issues": audit_result.get("total_issues", 0),
        "issues": audit_result.get("issues", []),
        "summary": audit_result.get("summary", {}),
    }



_timeout_value = 300

def _timeout_handler(signum, frame):
    """超时信号处理器"""
    print(json.dumps({"status": "timeout", "error": f"操作超时({_timeout_value}秒)", "timeout": _timeout_value}, ensure_ascii=False))
    sys.exit(1)


def main():
    """主函数：解析参数并执行自动审计"""
    parser = argparse.ArgumentParser(
        description="自动语言检测审计工具 - 根据文件扩展名自动选择审计器，支持 Python/Java/Web 代码"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--file", help="要审计的文件路径")
    group.add_argument("--dir", help="要递归审计的目录路径")
    parser.add_argument("-o", "--output", help="结果保存到 JSON 文件（可选）")
    parser.add_argument("--timeout", type=int, default=300, help="操作超时时间(秒)")
    args = parser.parse_args()

    global _timeout_value
    _timeout_value = args.timeout
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(args.timeout)

    try:
        if args.file:
            result = scan_single_file(args.file)
        else:
            if not os.path.isdir(args.dir):
                result = {"error": f"目录不存在: {args.dir}"}
            else:
                result = scan_directory(args.dir)

        output_json = json.dumps(result, ensure_ascii=False, indent=2)
        print(output_json)

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output_json)

    except Exception as e:
        error_result = {"error": f"自动审计过程出错: {str(e)}"}
        print(json.dumps(error_result, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
