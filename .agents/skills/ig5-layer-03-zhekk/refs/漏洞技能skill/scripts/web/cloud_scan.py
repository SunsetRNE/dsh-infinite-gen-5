#!/usr/bin/env python3
"""云存储扫描器 — S3/OSS/COS 公开桶检测"""
import argparse, json, subprocess, sys, concurrent.futures, re

COMMON_BUCKETS = ["backup","logs","static","assets","uploads","data","config","db","media","files","images","cdn","www","app","api","admin","dev","test","staging","prod","archive","temp","tmp","dump","db-backup","database","storage","public","private","web","site","doc","docs"]

def check_s3(bucket, timeout=8):
    urls = [f"https://{bucket}.s3.amazonaws.com", f"https://s3.amazonaws.com/{bucket}"]
    for url in urls:
        try:
            r = subprocess.run(["curl", "-sk", "-m", str(timeout), url, "-w", "|%{http_code}"], capture_output=True, text=True, timeout=timeout+5)
            if "|" in r.stdout:
                body, code = r.stdout.rsplit("|", 1)
                code = int(code)
                if code == 200 and "ListBucketResult" in body:
                    return {"bucket": bucket, "url": url, "status": "public_read", "code": code}
                elif code == 200:
                    return {"bucket": bucket, "url": url, "status": "accessible", "code": code}
        except: pass
    return None

def check_oss(bucket, region="oss-cn-hangzhou", timeout=8):
    url = f"https://{bucket}.{region}.aliyuncs.com/"
    try:
        r = subprocess.run(["curl", "-sk", "-m", str(timeout), url, "-w", "|%{http_code}"], capture_output=True, text=True, timeout=timeout+5)
        if "|" in r.stdout:
            body, code = r.stdout.rsplit("|", 1)
            if int(code) in (200, 403):
                return {"bucket": bucket, "url": url, "code": int(code)}
    except: pass
    return None

def main():
    ap = argparse.ArgumentParser(description="云存储扫描器")
    ap.add_argument("--domain", required=True, help="目标域名")
    ap.add_argument("--threads", type=int, default=20)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()
    
    domain = args.domain.lower().replace("https://","").replace("http://","").split("/")[0]
    name = domain.split(".")[0]
    
    candidates = [name] + [f"{name}-{b}" for b in COMMON_BUCKETS[:20]]
    
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.threads) as executor:
        futures = {executor.submit(check_s3, b): b for b in candidates}
        for future in concurrent.futures.as_completed(futures):
            r = future.result()
            if r:
                results.append(r)
                if not args.json:
                    print(f"  [{r['status']}] {r['bucket']} ({r['code']})")
    
    result = {"domain": domain, "found": len(results), "buckets": results}
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"[*] 云存储: {domain}")
        if results:
            print(f"  ⚠️ 发现 {len(results)} 个公开桶")
        else:
            print("  未发现公开桶")

if __name__ == "__main__":
    main()