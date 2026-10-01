#!/usr/bin/env python3
"""二进制快速分析器 — 封装 file/strings/readelf/objdump 输出结构化 JSON"""
import argparse, json, subprocess, sys, os, re

def run(cmd, timeout=30):
    try:
        r = subprocess.run(cmd if isinstance(cmd, list) else cmd.split(), capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else ""
    except:
        return ""

def analyze_binary(filepath):
    """分析二进制文件"""
    if not os.path.isfile(filepath):
        return {"error": f"文件不存在: {filepath}"}
    
    result = {"file": filepath, "size": os.path.getsize(filepath)}
    
    # 1. 文件类型
    result["file_type"] = run(["file", filepath])
    
    # 2. 字符串提取
    strings_out = run(["strings", filepath])
    interesting = []
    for line in strings_out.split("\n"):
        line_lower = line.lower()
        if any(kw in line_lower for kw in ["key", "secret", "password", "token", "encrypt", "decrypt", "http", "https", "api", "jni", "native", "root", "admin", "flag", "ctf"]):
            interesting.append(line)
    result["strings_interesting"] = interesting[:50]
    
    # 3. ELF 分析
    if "ELF" in result.get("file_type", ""):
        result["elf_header"] = run(["readelf", "-h", filepath])
        result["elf_sections"] = run(["readelf", "-S", filepath])
        result["elf_symbols"] = run(["readelf", "-s", filepath])
        
        # 安全特性
        security = run(["readelf", "-l", filepath])
        result["security"] = {
            "nx": "GNU_STACK" in security and "E" not in security.split("GNU_STACK")[1][:50] if security else "unknown",
            "pie": "DYN" in result.get("elf_header", ""),
            "relro": "partial" if "GNU_RELRO" in security else "none",
        }
    
    # 4. 加密常量检测
    crypto_signs = {
        "AES": b"\x63\x7c\x77\x7b",
        "MD5": b"\x67\x45\x23\x01",
        "SHA256": b"\x6a\x09\xe6\x67",
        "Base64": b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    }
    with open(filepath, "rb") as f:
        data = f.read()
    detected = []
    for algo, sig in crypto_signs.items():
        if sig in data:
            detected.append(algo)
    result["crypto_detected"] = detected
    
    return result

def main():
    ap = argparse.ArgumentParser(description="二进制快速分析器")
    ap.add_argument("--file", required=True, help="二进制文件路径")
    ap.add_argument("-o", "--output", help="输出JSON")
    ap.add_argument("--json", action="store_true", help="JSON输出")
    args = ap.parse_args()
    
    result = analyze_binary(args.file)
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"[*] 文件: {result['file']} ({result['size']} bytes)")
        print(f"[*] 类型: {result.get('file_type', 'unknown')}")
        if result.get("strings_interesting"):
            print(f"[*] 关键字符串 ({len(result['strings_interesting'])}):")
            for s in result["strings_interesting"][:20]:
                print(f"    {s}")
        if result.get("crypto_detected"):
            print(f"[*] 加密常量: {', '.join(result['crypto_detected'])}")
        if result.get("security"):
            print(f"[*] 安全特性: {result['security']}")

if __name__ == "__main__":
    main()