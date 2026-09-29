#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
string_extract.py - 二进制文件字符串提取与分类工具

功能：
  - 提取 ASCII / UTF-16LE / UTF-16BE 字符串
  - 正则过滤
  - 上下文字节显示
  - 分类输出 (URL/IP/路径/邮箱/加密常量/函数名/错误信息/格式串)
"""

import argparse
import json
import os
import re
import struct
import sys
import signal


# ---------------------------------------------------------------------------
# 加密常量签名 (用于字符串/字节级分类)
# ---------------------------------------------------------------------------
CRYPTO_BYTE_SIGS = {
    "AES_SBox": bytes([0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5]),
    "MD5_Init": struct.pack("<IIII", 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476),
    "SHA1_Init": struct.pack("<IIIII", 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0),
    "SHA256_Init": struct.pack("<II", 0x6A09E667, 0xBB67AE85),
    "CRC32_Poly": struct.pack("<I", 0xEDB88320),
    "DES_SBox1": bytes([14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7]),
}

# ---------------------------------------------------------------------------
# 分类正则
# ---------------------------------------------------------------------------
RE_URL = re.compile(r"^(https?|ftp)://[^\s]+", re.IGNORECASE)
RE_IPV4 = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")
RE_IPV6 = re.compile(r"^[0-9a-fA-F:]{2,}:[0-9a-fA-F:]*:[0-9a-fA-F:]+$")
RE_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
RE_UNIX_PATH = re.compile(r"^/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+")
RE_WIN_PATH = re.compile(r"^[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]+")
RE_REGISTRY = re.compile(r"^(HKEY_|SOFTWARE\\)", re.IGNORECASE)
RE_FORMAT = re.compile(r"%[-+# 0]*\d*\.?\d*[hlLjzt]*[diuoxXfFeEgGaAcspn%]")
RE_FUNCTION = re.compile(r"^(?:[A-Za-z_][A-Za-z0-9_]*_)?[A-Za-z_][A-Za-z0-9_]*$")
ERROR_KEYWORDS = ("error", "fail", "invalid", "denied", "exception", "fatal",
                  "abort", "warning", "overflow", "underflow", "corrupt")

# 常见函数名后缀提示
FUNCTION_HINTS = ("_init", "_fini", "_open", "_close", "_read", "_write",
                  "_malloc", "_free", "_printf", "_scanf", "_cpy", "_set",
                  "_get", "_create", "_destroy", "_lock", "_unlock")


def extract_ascii(data, min_length):
    """提取连续可打印 ASCII (0x20-0x7e) 字符串"""
    results = []
    start = None
    n = len(data)
    for i in range(n):
        c = data[i]
        if 0x20 <= c <= 0x7e:
            if start is None:
                start = i
        else:
            if start is not None:
                length = i - start
                if length >= min_length:
                    results.append((start, data[start:i].decode("ascii", errors="replace")))
                start = None
    if start is not None:
        length = n - start
        if length >= min_length:
            results.append((start, data[start:n].decode("ascii", errors="replace")))
    return results


def extract_utf16(data, min_length, big_endian=False):
    """提取 UTF-16 字符串"""
    results = []
    n = len(data)
    start = None
    buf = []
    i = 0
    while i + 1 < n:
        if big_endian:
            code = (data[i] << 8) | data[i + 1]
        else:
            code = data[i] | (data[i + 1] << 8)
        if 0x20 <= code <= 0x7e:
            if start is None:
                start = i
            buf.append(chr(code))
        else:
            if start is not None and len(buf) >= min_length:
                results.append((start, "".join(buf)))
            start = None
            buf = []
        i += 2
    if start is not None and len(buf) >= min_length:
        results.append((start, "".join(buf)))
    return results


def categorize(s):
    """对单个字符串分类"""
    if RE_URL.match(s):
        return "url"
    if RE_EMAIL.match(s):
        return "email"
    if RE_IPV4.match(s):
        parts = s.split(".")
        if all(0 <= int(p) <= 255 for p in parts):
            return "ip"
    if RE_IPV6.match(s) and ":" in s:
        return "ip"
    if RE_REGISTRY.match(s):
        return "registry"
    if RE_WIN_PATH.match(s):
        return "file_path"
    if RE_UNIX_PATH.match(s):
        return "file_path"
    if RE_FORMAT.search(s):
        return "format_string"
    low = s.lower()
    if any(kw in low for kw in ERROR_KEYWORDS):
        return "error_message"
    if any(hint in s.lower() for hint in FUNCTION_HINTS):
        return "function_name"
    if RE_FUNCTION.match(s) and len(s) <= 64 and ("_" in s or s.islower()):
        return "function_name"
    return "other"


def find_crypto_constants(data):
    """在整个文件中扫描加密常量"""
    found = []
    for name, sig in CRYPTO_BYTE_SIGS.items():
        idx = data.find(sig)
        if idx != -1:
            found.append({"name": name, "offset": "0x%x" % idx, "size": len(sig)})
    return found


def hexdump(data, base_offset, str_start, str_len, context):
    """生成上下文字节的十六进制+ASCII 表示"""
    ctx_start = max(0, str_start - context)
    ctx_end = min(len(data), str_start + str_len + context)
    chunk = data[ctx_start:ctx_end]
    lines = []
    for off in range(0, len(chunk), 16):
        piece = chunk[off:off + 16]
        hexpart = " ".join("%02x" % b for b in piece)
        asciipart = "".join(chr(b) if 0x20 <= b <= 0x7e else "." for b in piece)
        lines.append("  0x%08x  %-48s  %s" % (base_offset + ctx_start + off, hexpart, asciipart))
    return "\n".join(lines)



_timeout_value = 300

def _timeout_handler(signum, frame):
    """超时信号处理器"""
    print(json.dumps({"status": "timeout", "error": f"操作超时({_timeout_value}秒)", "timeout": _timeout_value}, ensure_ascii=False))
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser(description="二进制文件字符串提取与分类工具")
    ap.add_argument("--file", required=True, help="二进制文件路径")
    ap.add_argument("--min-length", type=int, default=4, help="最小字符串长度")
    ap.add_argument("--encoding", default="both", choices=["ascii", "utf16", "both"],
                    help="编码: ascii/utf16/both")
    ap.add_argument("--pattern", help="正则过滤模式")
    ap.add_argument("--context", type=int, default=0, help="每个字符串前后显示字节数")
    ap.add_argument("-o", "--output", help="结果保存为 JSON 文件路径")
    ap.add_argument("--timeout", type=int, default=300, help="操作超时时间(秒)")
    args = ap.parse_args()

    global _timeout_value
    _timeout_value = args.timeout
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(args.timeout)

    if not os.path.isfile(args.file):
        sys.stderr.write("Error: file not found: %s\n" % args.file)
        return 2

    with open(args.file, "rb") as f:
        data = f.read()

    pattern_re = re.compile(args.pattern) if args.pattern else None

    all_strings = []
    if args.encoding in ("ascii", "both"):
        for off, s in extract_ascii(data, args.min_length):
            all_strings.append((off, s, "ascii"))
    if args.encoding in ("utf16", "both"):
        for off, s in extract_utf16(data, args.min_length, big_endian=False):
            all_strings.append((off, s, "utf16le"))
        for off, s in extract_utf16(data, args.min_length, big_endian=True):
            all_strings.append((off, s, "utf16be"))

    # 正则过滤
    if pattern_re:
        all_strings = [item for item in all_strings if pattern_re.search(item[1])]

    # 去重 (保留首次出现)
    seen = set()
    unique = []
    for off, s, enc in all_strings:
        key = (s, enc)
        if key in seen:
            continue
        seen.add(key)
        unique.append((off, s, enc))

    # 分类
    categorized = {
        "urls": [], "ips": [], "file_paths": [], "emails": [],
        "registry_keys": [], "crypto_constants": [], "function_names": [],
        "error_messages": [], "format_strings": [],
    }
    out_strings = []
    for off, s, enc in unique:
        cat = categorize(s)
        entry = {
            "offset": "0x%x" % off,
            "string": s,
            "encoding": enc,
            "category": cat,
        }
        if args.context > 0:
            entry["context"] = hexdump(data, 0, off, len(s.encode("ascii", errors="replace")), args.context)
        out_strings.append(entry)

        bucket = {
            "url": "urls", "ip": "ips", "file_path": "file_paths",
            "email": "emails", "registry": "registry_keys",
            "function_name": "function_names", "error_message": "error_messages",
            "format_string": "format_strings",
        }.get(cat)
        if bucket:
            categorized[bucket].append(s)

    # 加密常量 (字节级扫描)
    crypto_const = find_crypto_constants(data)
    categorized["crypto_constants"] = crypto_const

    result = {
        "file": os.path.abspath(args.file),
        "total_strings": len(out_strings),
        "categorized": categorized,
        "all_strings": out_strings,
    }

    text = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text)
        sys.stderr.write("[+] Saved to %s\n" % args.output)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
