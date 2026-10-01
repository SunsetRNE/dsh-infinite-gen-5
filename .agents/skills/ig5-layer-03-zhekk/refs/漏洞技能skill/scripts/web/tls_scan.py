#!/usr/bin/env python3
"""TLS扫描器 — 证书+加密套件+已知漏洞"""
import argparse, json, subprocess, sys, re

def run(cmd, timeout=30):
    try:
        r = subprocess.run(cmd if isinstance(cmd, list) else cmd.split(), capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else r.stderr.strip()
    except: return ""

def scan_tls(target, port=443):
    host = target.replace("https://","").replace("http://","").split("/")[0]
    result = {"target": host, "port": port}
    
    # 证书信息
    cert = run(f"echo | openssl s_client -connect {host}:{port} -servername {host} 2>/dev/null | openssl x509 -noout -text", timeout=15)
    if cert:
        for line in cert.split("\n"):
            if "Not After" in line:
                result["cert_expiry"] = line.strip()
            if "Issuer:" in line:
                result["cert_issuer"] = line.strip()
            if "DNS:" in line:
                result["cert_sans"] = re.findall(r"DNS:([^,\s]+)", line)
    
    # 协议版本检查
    for version in [("tls1_2", "TLS 1.2"), ("tls1_1", "TLS 1.1"), ("tls1", "TLS 1.0"), ("ssl3", "SSLv3")]:
        out = run(f"echo | openssl s_client -connect {host}:{port} -{version[0]} -servername {host} 2>/dev/null", timeout=10)
        if "CONNECTED" in out and "Cipher" in out:
            if version[1] in ("TLS 1.1", "TLS 1.0", "SSLv3"):
                result.setdefault("issues", []).append(f"支持老旧协议: {version[1]}")
    
    # sslscan
    out = run(f"sslscan {host}:{port}", timeout=60)
    if out:
        for line in out.split("\n"):
            if "SSLv2" in line or "SSLv3" in line:
                result.setdefault("issues", []).append(f"支持不安全协议: {line.strip()}")
            if "RC4" in line and "enabled" in line.lower():
                result.setdefault("issues", []).append("RC4加密套件可用")
    
    return result

def main():
    ap = argparse.ArgumentParser(description="TLS扫描器")
    ap.add_argument("--target", required=True)
    ap.add_argument("--port", type=int, default=443)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()
    
    result = scan_tls(args.target, args.port)
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"[*] TLS: {result['target']}:{result['port']}")
        if result.get("cert_expiry"):
            print(f"  证书过期: {result['cert_expiry']}")
        if result.get("issues"):
            for i in result["issues"]:
                print(f"  ⚠️ {i}")

if __name__ == "__main__":
    main()