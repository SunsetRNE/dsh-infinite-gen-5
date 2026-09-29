#!/usr/bin/env python3
"""OSINT信息收集 — 封装whois/DNS/邮箱/技术栈识别"""
import argparse, json, subprocess, sys, re, socket

def run(cmd, timeout=15):
    try:
        r = subprocess.run(cmd if isinstance(cmd, list) else cmd.split(), capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else ""
    except: return ""

def whois_lookup(domain):
    """WHOIS查询"""
    return run(["whois", domain], timeout=20)

def dns_records(domain):
    """DNS记录收集"""
    records = {}
    for rtype in ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA"]:
        out = run(["dig", "+short", domain, rtype])
        if out: records[rtype] = out.split("\n")
    return records

def email_format(domain):
    """邮箱格式推断"""
    formats = []
    name = domain.split(".")[0]
    formats.append(f"{name}@")
    formats.append(f"admin@{domain}")
    formats.append(f"info@{domain}")
    formats.append(f"contact@{domain}")
    formats.append(f"support@{domain}")
    return formats

def tech_stack(url):
    """技术栈检测"""
    url = url if url.startswith("http") else f"https://{url}"
    headers = run(["curl", "-sk", "-m", "10", "-I", url])
    tech = {}
    if "Server:" in headers:
        tech["server"] = re.search(r"Server:\s*(.+)", headers, re.I).group(1) if re.search(r"Server:", headers, re.I) else ""
    if "X-Powered-By:" in headers:
        tech["powered_by"] = re.search(r"X-Powered-By:\s*(.+)", headers, re.I).group(1) if re.search(r"X-Powered-By:", headers, re.I) else ""
    if "Set-Cookie:" in headers:
        cookies = re.findall(r"Set-Cookie:\s*([^=]+)", headers, re.I)
        tech["cookies"] = cookies
    return tech

def main():
    ap = argparse.ArgumentParser(description="OSINT信息收集")
    ap.add_argument("--target", required=True, help="目标域名")
    ap.add_argument("--check", default="all", help="all/whois/dns/email/tech")
    ap.add_argument("-o", "--output", help="输出JSON")
    ap.add_argument("--json", action="store_true", help="JSON输出")
    args = ap.parse_args()
    
    target = args.target.replace("https://", "").replace("http://", "").split("/")[0]
    result = {"target": target}
    
    if args.check in ("all", "whois"):
        result["whois"] = whois_lookup(target)[:2000]
    if args.check in ("all", "dns"):
        result["dns"] = dns_records(target)
    if args.check in ("all", "email"):
        result["email_formats"] = email_format(target)
    if args.check in ("all", "tech"):
        url = f"https://{target}" if not target.startswith("http") else target
        result["tech_stack"] = tech_stack(url)
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"[*] OSINT: {target}")
        if "dns" in result:
            for rtype, vals in result["dns"].items():
                print(f"  {rtype}: {', '.join(vals[:3])}")
        if "tech_stack" in result:
            for k, v in result["tech_stack"].items():
                print(f"  {k}: {v}")
        if "email_formats" in result:
            print(f"  邮箱格式: {', '.join(result['email_formats'][:5])}")

if __name__ == "__main__":
    main()