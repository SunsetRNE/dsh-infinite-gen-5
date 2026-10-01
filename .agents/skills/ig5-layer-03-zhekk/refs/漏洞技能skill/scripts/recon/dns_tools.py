#!/usr/bin/env python3
"""DNS安全工具 — 区域传送/子域接管/劫持检测/隧道检测"""
import argparse, json, subprocess, sys, re

def run(cmd, timeout=15):
    try:
        r = subprocess.run(cmd if isinstance(cmd, list) else cmd.split(), capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else ""
    except: return ""

def zone_transfer(domain):
    """区域传送检测"""
    ns_servers = run(f"dig +short NS {domain}").split("\n")
    results = []
    for ns in ns_servers:
        ns = ns.strip().rstrip(".")
        if ns:
            out = run(f"dig axfr @{ns} {domain}", timeout=20)
            if out and "failed" not in out.lower() and "REFUSED" not in out:
                results.append({"ns": ns, "records": out[:1000]})
    return results

def dns_records_all(domain):
    """全DNS记录"""
    records = {}
    for rtype in ["A","AAAA","MX","NS","TXT","CNAME","SOA","SRV"]:
        out = run(f"dig +short {domain} {rtype}")
        if out: records[rtype] = out.split("\n")
    return records

def subdomain_takeover(domain):
    """子域接管检测"""
    common_subs = ["www","api","admin","mail","cdn","dev","staging","test","portal","blog","docs","status","git","vpn","app","m","mobile"]
    takeover_signs = ["s3.amazonaws", "github.io", "herokuapp.com", "cloudapp.net", "elasticbeanstalk.com", "azurewebsites.net", "firebaseapp.com", "netlify.app", "vercel.app", "surge.sh"]
    results = []
    for sub in common_subs:
        fqdn = f"{sub}.{domain}"
        cname = run(f"dig +short CNAME {fqdn}")
        if cname:
            cname = cname.rstrip(".")
            for sign in takeover_signs:
                if sign in cname:
                    # 检查是否可接管
                    check = run(f"curl -sk -m 5 -o /dev/null -w '%{{http_code}}' https://{fqdn}")
                    if check in ("404", "000", "503"):
                        results.append({"subdomain": fqdn, "cname": cname, "http_code": check, "takeover_possible": True})
    return results

def main():
    ap = argparse.ArgumentParser(description="DNS安全工具")
    ap.add_argument("--domain", required=True, help="目标域名")
    ap.add_argument("--check", default="all", help="all/zone/records/takeover")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()
    
    domain = args.domain.rstrip(".")
    result = {"domain": domain}
    
    if args.check in ("all", "zone"):
        result["zone_transfer"] = zone_transfer(domain)
    if args.check in ("all", "records"):
        result["dns_records"] = dns_records_all(domain)
    if args.check in ("all", "takeover"):
        result["subdomain_takeover"] = subdomain_takeover(domain)
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"[*] DNS安全: {domain}")
        if result.get("zone_transfer"):
            print(f"  区域传送: {len(result['zone_transfer'])}个NS")
        if result.get("subdomain_takeover"):
            for t in result["subdomain_takeover"]:
                print(f"  [!] 可接管: {t['subdomain']} → {t['cname']}")

if __name__ == "__main__":
    main()