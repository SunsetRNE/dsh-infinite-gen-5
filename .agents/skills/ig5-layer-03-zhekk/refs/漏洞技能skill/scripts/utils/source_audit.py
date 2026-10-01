#!/usr/bin/env python3
"""源码安全审计 — Python/Java/PHP/JS/Go 多语言危险模式检索"""
import argparse, json, subprocess, sys, os, re

PATTERNS = {
    "python": {
        "命令注入": [r"os\.system\(", r"os\.popen\(", r"subprocess\.call\(", r"subprocess\.Popen\(", r"subprocess\.run\("],
        "代码执行": [r"\beval\(", r"\bexec\(", r"__import__\("],
        "反序列化": [r"pickle\.loads?\(", r"yaml\.load(?!_safe)", r"marshal\.loads?\("],
        "SQL注入": [r"\.execute\(.*%", r"\.execute\(.*format", r"\.execute\(.*f['\"]", r"\.raw\("],
        "SSTI": [r"render_template_string\(", r"Template\("],
        "硬编码凭据": [r"password\s*=\s*['\"]", r"api_key\s*=\s*['\"]", r"secret\s*=\s*['\"]", r"token\s*=\s*['\"]"],
    },
    "java": {
        "命令注入": [r"Runtime\.getRuntime\(\)\.exec", r"ProcessBuilder"],
        "SQL注入": [r"createQuery\(.*\+", r"Statement.*execute"],
        "反序列化": [r"ObjectInputStream", r"readObject\("],
        "SSRF": [r"URLConnection", r"HttpURLConnection", r"HttpClient", r"RestTemplate"],
        "XXE": [r"DocumentBuilder", r"SAXParser", r"XMLReader"],
    },
    "php": {
        "命令注入": [r"\bexec\(", r"\bsystem\(", r"shell_exec\(", r"passthru\(", r"\bpopen\("],
        "代码执行": [r"\beval\(", r"\bassert\(", r"preg_replace.*\/e", r"create_function"],
        "反序列化": [r"\bunserialize\("],
        "文件包含": [r"(include|require).*\$"],
        "SQL注入": [r"mysql_query\(", r"mysqli_query\(", r"->query\("],
    },
    "javascript": {
        "命令注入": [r"child_process", r"\bexec\(", r"\bspawn\(", r"\bfork\("],
        "代码执行": [r"\beval\(", r"\bFunction\(", r"new Function"],
        "路径遍历": [r"path\.join\(.*req", r"path\.resolve\(.*req"],
        "NoSQL注入": [r"\$where", r"\.find\(.*req"],
        "原型污染": [r"__proto__", r"constructor\.prototype", r"Object\.assign\(.*req"],
    },
    "go": {
        "命令注入": [r"exec\.Command\(", r"os\.Exec\("],
        "SQL注入": [r"fmt\.Sprintf\(.*SELECT", r"fmt\.Sprintf\(.*INSERT"],
        "路径遍历": [r"path\.Join\(", r"filepath\.Join\("],
        "SSRF": [r"http\.Get\(", r"http\.Post\("],
    },
    "generic": {
        "硬编码凭据": [r"password\s*=\s*['\"][^'\"]{3,}", r"api_key\s*=\s*['\"][^'\"]{3,}", r"secret\s*=\s*['\"][^'\"]{3,}", r"AKIA[A-Z0-9]{16}", r"-----BEGIN.*PRIVATE KEY-----"],
    }
}

EXT_MAP = {".py":"python", ".java":"java", ".php":"php", ".js":"javascript", ".ts":"javascript", ".go":"go"}

def audit_file(filepath):
    findings = []
    ext = os.path.splitext(filepath)[1].lower()
    lang = EXT_MAP.get(ext, "generic")
    
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
    except: return findings
    
    for category, patterns in PATTERNS.get(lang, {}).items():
        for pattern in patterns:
            for i, line in enumerate(lines, 1):
                if re.search(pattern, line, re.I):
                    findings.append({"file": filepath, "line": i, "category": category, "code": line.strip()[:200]})
    
    for category, patterns in PATTERNS["generic"].items():
        for pattern in patterns:
            for i, line in enumerate(lines, 1):
                if re.search(pattern, line, re.I):
                    findings.append({"file": filepath, "line": i, "category": category, "code": line.strip()[:200]})
    
    return findings

def main():
    ap = argparse.ArgumentParser(description="源码安全审计")
    ap.add_argument("--dir", required=True, help="源码目录")
    ap.add_argument("--lang", help="语言过滤: python/java/php/javascript/go")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()
    
    all_findings = []
    for root, dirs, files in os.walk(args.dir):
        dirs[:] = [d for d in dirs if d not in (".git","node_modules","vendor","__pycache__",".venv","venv","dist","build")]
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in EXT_MAP or args.lang:
                if args.lang and EXT_MAP.get(ext) != args.lang: continue
                filepath = os.path.join(root, f)
                findings = audit_file(filepath)
                all_findings.extend(findings)
    
    result = {"total": len(all_findings), "by_category": {}, "findings": all_findings}
    for f in all_findings:
        result["by_category"][f["category"]] = result["by_category"].get(f["category"], 0) + 1
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"[*] 审计: {args.dir}")
        for cat, count in sorted(result["by_category"].items()):
            print(f"  {cat}: {count}")
        if all_findings:
            print(f"\n前10个发现:")
            for f in all_findings[:10]:
                print(f"  [{f['category']}] {f['file']}:{f['line']} — {f['code'][:80]}")

if __name__ == "__main__":
    main()