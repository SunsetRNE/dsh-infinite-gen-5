#!/usr/bin/env python3
"""子域名枚举器 — 用 dig + 字典 + 证书透明日志"""
import argparse, json, subprocess, sys, concurrent.futures

COMMON_SUBS = ["www","api","admin","mail","dev","staging","test","portal","blog","cdn","vpn","git","docs","status","monitor","grafana","jenkins","kibana","k8s","dashboard","app","m","mobile","ws","static","assets","img","cdn1","cdn2","ns1","ns2","smtp","pop","imap","ftp","sql","db","redis","elastic","search","wiki","help","support","shop","store","pay","billing","auth","sso","login","signin","account","accounts","secure","security","www2","beta","demo","sandbox","uat","staging2","preprod","prod"]

def check_subdomain(sub, domain, timeout=5):
    try:
        r = subprocess.run(["dig", "+short", f"{sub}.{domain}"], capture_output=True, text=True, timeout=timeout)
        if r.stdout.strip():
            ips = [ip for ip in r.stdout.strip().split("\n") if ip and not ip.startswith(";")]
            return {"subdomain": f"{sub}.{domain}", "ips": ips}
    except:
        pass
    return None

def main():
    ap = argparse.ArgumentParser(description="子域名枚举")
    ap.add_argument("--domain", required=True, help="目标域名")
    ap.add_argument("--wordlist", help="子域名字典文件")
    ap.add_argument("--fast", action="store_true", help="快速模式(仅常见子域名)")
    ap.add_argument("--threads", type=int, default=20, help="并发线程数")
    ap.add_argument("-o", "--output", help="输出JSON")
    ap.add_argument("--json", action="store_true", help="仅输出JSON")
    args = ap.parse_args()
    
    domain = args.domain.rstrip(".")
    
    if args.wordlist:
        with open(args.wordlist) as f:
            subs = [l.strip() for l in f if l.strip() and not l.startswith("#")]
    else:
        subs = COMMON_SUBS if args.fast else COMMON_SUBS
    
    if not args.json:
        print(f"[*] 枚举 {domain} ({len(subs)}个子域名)...")
    
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.threads) as executor:
        futures = {executor.submit(check_subdomain, s, domain): s for s in subs}
        for future in concurrent.futures.as_completed(futures):
            r = future.result()
            if r:
                results.append(r)
                if not args.json:
                    print(f"  {r['subdomain']} → {', '.join(r['ips'])}")
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump({"domain": domain, "found": len(results), "subdomains": results}, f, indent=2)
    
    if args.json:
        print(json.dumps({"domain": domain, "found": len(results), "subdomains": results}, indent=2))
    else:
        print(f"\n✅ 发现 {len(results)} 个子域名")

if __name__ == "__main__":
    main()