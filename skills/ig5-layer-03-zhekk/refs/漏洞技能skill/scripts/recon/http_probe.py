#!/usr/bin/env python3
"""HTTP探测 — 批量HTTP存活检测+指纹识别"""
import argparse, json, subprocess, sys, concurrent.futures, re

def probe_http(host, port=443, timeout=8):
    """探测HTTP/HTTPS"""
    results = {}
    for proto in ["https", "http"]:
        url = f"{proto}://{host}:{port}" if port not in (80,443) else f"{proto}://{host}"
        try:
            r = subprocess.run(["curl", "-sk", "-m", str(timeout), "-I", url, "-w", "HTTP:%{http_code}|Size:%{size_download}|Time:%{time_total}"], capture_output=True, text=True, timeout=timeout+5)
            if r.returncode == 0:
                headers = r.stdout
                code = "000"
                size = "0"
                m = re.search(r"HTTP:(\d+)", headers)
                if m: code = m.group(1)
                m = re.search(r"Size:(\d+)", headers)
                if m: size = m.group(1)
                
                server = re.search(r"Server:\s*(.+)", headers, re.I)
                powered = re.search(r"X-Powered-By:\s*(.+)", headers, re.I)
                
                results[proto] = {
                    "url": url, "code": int(code), "size": int(size),
                    "server": server.group(1) if server else "",
                    "powered_by": powered.group(1) if powered else "",
                }
        except: pass
    return results

def main():
    ap = argparse.ArgumentParser(description="HTTP探测")
    ap.add_argument("--targets", required=True, help="目标列表(逗号分隔)或文件")
    ap.add_argument("--ports", default="443,80,8080,8443,3000,5000,8000,9000", help="端口列表")
    ap.add_argument("--threads", type=int, default=20)
    ap.add_argument("-o", "--output")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    
    if os.path.exists(args.targets):
        with open(args.targets) as f:
            targets = [l.strip() for l in f if l.strip()]
    else:
        targets = [t.strip() for t in args.targets.split(",")]
    
    ports = [int(p) for p in args.ports.split(",")]
    
    if not args.json:
        print(f"[*] HTTP探测: {len(targets)}个目标 × {len(ports)}个端口...")
    
    all_results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.threads) as executor:
        futures = []
        for t in targets:
            for p in ports:
                futures.append(executor.submit(probe_http, t, p))
        
        for future in concurrent.futures.as_completed(futures):
            r = future.result()
            if r:
                for proto, info in r.items():
                    all_results.append({"target": info["url"], "code": info["code"], "server": info["server"], "powered": info["powered_by"]})
                    if not args.json:
                        print(f"  [{info['code']}] {info['url']} ({info['server']})")
    
    result = {"total": len(all_results), "results": sorted(all_results, key=lambda x: x["code"])}
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"\n✅ 发现 {len(all_results)} 个存活HTTP服务")

if __name__ == "__main__":
    import os
    main()