#!/usr/bin/env python3
"""密码工具 — 哈希类型识别+字典生成+在线爆破"""
import argparse, json, subprocess, sys, os, hashlib, re, itertools

HASH_PATTERNS = [
    (r"^[a-f0-9]{32}$", "MD5"),
    (r"^[a-f0-9]{40}$", "SHA1"),
    (r"^[a-f0-9]{56}$", "SHA224"),
    (r"^[a-f0-9]{64}$", "SHA256"),
    (r"^[a-f0-9]{96}$", "SHA384"),
    (r"^[a-f0-9]{128}$", "SHA512"),
    (r"^[a-f0-9]{32}:[a-f0-9]+$", "NTLM"),
    (r"^\$2[ayb]\$[0-9]{2}\$[./A-Za-z0-9]{53}$", "bcrypt"),
    (r"^\$1\$[./A-Za-z0-9]{8}\$[./A-Za-z0-9]{22}$", "MD5(Unix)"),
    (r"^\$5\$[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{43}$", "SHA256(Unix)"),
    (r"^\$6\$[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{86}$", "SHA512(Unix)"),
    (r"^[a-f0-9]{4,}$", "MySQL"),
]

def identify_hash(hash_str):
    for pattern, name in HASH_PATTERNS:
        if re.match(pattern, hash_str, re.I):
            return name
    return "unknown"

def gen_wordlist(info, output="targeted_dict.txt"):
    words = set()
    name = info.get("name", "")
    name_cn = info.get("name_cn", "")
    company = info.get("company", "")
    birth = info.get("birth", "")
    phone = info.get("phone", "")[-4:] if info.get("phone") else ""
    
    for n in [name, name_cn, name.capitalize()]:
        for s in ["", "123", "1234", "123456", "@123", "!", "@", "#"]:
            words.add(n + s)
    for y in [birth, "2024", "2025"]:
        if y: words.add(name + y)
    for c in [company, company.capitalize()]:
        if c: words.add(name + "@" + c)
    if phone: words.add(name + phone)
    
    with open(output, "w") as f:
        for w in sorted(words):
            if 6 <= len(w) <= 20:
                f.write(w + "\n")
    return len(words), output

def crack_hash(hash_str, wordlist, hash_type=None, timeout=60):
    if not hash_type:
        hash_type = identify_hash(hash_str)
    
    type_map = {"MD5": "0", "SHA1": "100", "NTLM": "1000", "SHA256": "1400", "SHA512": "1700", "bcrypt": "3200"}
    mode = type_map.get(hash_type, "0")
    
    # 用 john 尝试
    with open("/tmp/zhekk_hash.txt", "w") as f:
        f.write(hash_str)
    try:
        r = subprocess.run(
            ["john", "--wordlist=" + wordlist, "--format=raw-" + hash_type.lower(), "/tmp/zhekk_hash.txt"],
            capture_output=True, text=True, timeout=timeout
        )
        r2 = subprocess.run(["john", "--show", "/tmp/zhekk_hash.txt"], capture_output=True, text=True)
        os.remove("/tmp/zhekk_hash.txt")
        for line in r2.stdout.split("\n"):
            if ":" in line and "password" not in line.lower():
                parts = line.split(":")
                if len(parts) >= 2:
                    return parts[1]
    except: pass
    return None

def main():
    ap = argparse.ArgumentParser(description="密码工具")
    sub = ap.add_subparsers(dest="cmd")
    
    sp_id = sub.add_parser("identify", help="识别哈希类型")
    sp_id.add_argument("--hash", required=True)
    
    sp_gen = sub.add_parser("wordlist", help="生成字典")
    sp_gen.add_argument("--name", default="user")
    sp_gen.add_argument("--company", default="")
    sp_gen.add_argument("--birth", default="")
    sp_gen.add_argument("-o", "--output", default="targeted_dict.txt")
    
    sp_crack = sub.add_parser("crack", help="破解哈希")
    sp_crack.add_argument("--hash", required=True)
    sp_crack.add_argument("--wordlist", default="/usr/share/wordlists/rockyou.txt")
    sp_crack.add_argument("--type", help="哈希类型")
    
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    
    if args.cmd == "identify":
        htype = identify_hash(args.hash)
        print(json.dumps({"hash": args.hash[:20]+"...", "type": htype}, indent=2) if args.json else f"类型: {htype}")
    elif args.cmd == "wordlist":
        info = {"name": args.name, "company": args.company, "birth": args.birth}
        count, out = gen_wordlist(info, args.output)
        print(json.dumps({"count": count, "output": out}, indent=2) if args.json else f"生成 {count} 个密码, 保存到 {out}")
    elif args.cmd == "crack":
        result = crack_hash(args.hash, args.wordlist, args.type)
        if result:
            print(json.dumps({"found": True, "password": result}, indent=2) if args.json else f"✅ 破解: {result}")
        else:
            print(json.dumps({"found": False}, indent=2) if args.json else "❌ 未破解")
    else:
        print("用法: identify|wordlist|crack")

if __name__ == "__main__":
    main()