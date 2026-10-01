#!/usr/bin/env python3
"""
端口扫描器 — 封装 nmap/masscan，输出结构化 JSON
用法: python3 port_scanner.py --target 192.168.1.1 [--ports 1-1000] [--fast]
"""
import argparse, json, subprocess, sys, re, socket, time

COMMON_PORTS = [21,22,23,25,53,80,110,111,135,139,143,443,445,993,995,1433,1521,2049,2181,2375,3306,3389,5432,5900,5984,6379,6443,7001,8080,8443,8888,9000,9090,9200,11211,27017,50070]

def tcp_connect(host, port, timeout=2):
    """快速TCP连接检测"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except:
        return False

def scan_fast(target, ports, timeout=2):
    """快速TCP扫描"""
    open_ports = []
    for port in ports:
        if tcp_connect(target, port, timeout):
            open_ports.append(port)
    return open_ports

def scan_nmap(target, ports_str, timeout=120):
    """nmap 扫描"""
    cmd = f"nmap -sV -T4 -p {ports_str} --open {target}"
    try:
        r = subprocess.run(cmd.split(), capture_output=True, text=True, timeout=timeout)
        return r.stdout if r.returncode == 0 else r.stderr
    except subprocess.TimeoutExpired:
        return "TIMEOUT"

def parse_nmap(output):
    """解析 nmap 输出"""
    results = []
    current_host = None
    for line in output.split("\n"):
        if "Nmap scan report for" in line:
            current_host = line.split()[-1].strip("()")
        if "/tcp" in line and "open" in line:
            parts = line.split()
            port = parts[0].split("/")[0]
            state = parts[1]
            service = parts[2] if len(parts) > 2 else "unknown"
            version = " ".join(parts[3:]) if len(parts) > 3 else ""
            results.append({
                "host": current_host,
                "port": int(port),
                "state": state,
                "service": service,
                "version": version,
            })
    return results

def main():
    ap = argparse.ArgumentParser(description="端口扫描器")
    ap.add_argument("--target", required=True, help="目标IP/域名")
    ap.add_argument("--ports", default="fast", help="端口范围: fast/top1000/1-65535")
    ap.add_argument("--fast", action="store_true", help="快速TCP扫描模式")
    ap.add_argument("-o", "--output", help="输出JSON文件")
    ap.add_argument("--json", action="store_true", help="仅输出JSON")
    args = ap.parse_args()
    
    t0 = time.time()
    target = args.target
    
    if args.ports == "fast" or args.fast:
        if not args.json:
            print(f"[*] 快速扫描 {target} ({len(COMMON_PORTS)}个端口)...")
        open_ports = scan_fast(target, COMMON_PORTS)
        results = [{"host": target, "port": p, "state": "open", "service": "tcp", "version": ""} for p in open_ports]
    else:
        if not args.json:
            print(f"[*] nmap 扫描 {target} (端口: {args.ports})...")
        output = scan_nmap(target, args.ports)
        results = parse_nmap(output)
    
    elapsed = time.time() - t0
    
    result = {
        "target": target,
        "scan_time": f"{elapsed:.1f}s",
        "ports_found": len(results),
        "open_ports": results,
    }
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"\n✅ 发现 {len(results)} 个开放端口 (耗时 {elapsed:.1f}s)")
        for r in results:
            print(f"  {r['port']}/tcp  {r['service']}  {r['version']}")

if __name__ == "__main__":
    main()