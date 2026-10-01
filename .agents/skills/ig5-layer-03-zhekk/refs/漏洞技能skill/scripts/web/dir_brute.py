#!/usr/bin/env python3
"""目录爆破器 — 封装 ffuf，输出结构化 JSON"""
import argparse, json, subprocess, sys, os, time, concurrent.futures

COMMON_DIRS = ["admin","login","api","dashboard","wp-admin","backup","config",".git",".env","debug","test","dev","staging","swagger","graphql","phpinfo","phpmyadmin","console","jenkins","actuator","metrics","health","status","robots.txt","sitemap.xml","crossdomain.xml","web.config","server-status",".htaccess","readme","install","setup","upload","uploads","files","static","assets","images","css","js","vendor","node_modules","tmp","temp","logs","backup","old","new","v1","v2","api/v1","api/v2"]

def check_path(url, path, timeout=5):
    try:
        full = url.rstrip("/") + "/" + path.lstrip("/")
        r = subprocess.run(["curl", "-sk", "-m", str(timeout), "-o", "/dev/null", "-w", "%{http_code}|%{size_download}", full], capture_output=True, text=True, timeout=timeout+5)
        if r.returncode == 0:
            parts = r.stdout.strip().split("|")
            code = int(parts[0]) if parts else 0
            size = int(parts[1]) if len(parts) > 1 else 0
            if code not in (404, 400, 500, 502, 503):
                return {"path": path, "code": code, "size": size, "url": full}
    except: pass
    return None

def main():
    ap = argparse.ArgumentParser(description="目录爆破器")
    ap.add_argument("--target", required=True, help="目标URL")
    ap.add_argument("--wordlist", help="字典文件")
    ap.add_argument("--fast", action="store_true", help="快速模式")
    ap.add_argument("--threads", type=int, default=20)
    ap.add_argument("--extensions", default="", help="扩展名: php,asp,aspx,jsp,html,bak,zip")
    ap.add_argument("-o", "--output")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    
    if args.wordlist and os.path.isfile(args.wordlist):
        with open(args.wordlist) as f:
            dirs = [l.strip() for l in f if l.strip() and not l.startswith("#")]
    else:
        dirs = COMMON_DIRS[:30] if args.fast else COMMON_DIRS
    
    if args.extensions:
        exts = args.extensions.split(",")
        dirs = [d for d in dirs] + [f"{d}.{e}" for d in dirs for e in exts]
    
    if not args.json:
        print(f"[*] 目录爆破: {args.target} ({len(dirs)}个路径)...")
    
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.threads) as executor:
        futures = {executor.submit(check_path, args.target, d): d for d in dirs}
        for future in concurrent.futures.as_completed(futures):
            r = future.result()
            if r:
                results.append(r)
                if not args.json:
                    print(f"  [{r['code']}] {r['path']} ({r['size']}B)")
    
    result = {"target": args.target, "found": len(results), "paths": sorted(results, key=lambda x: x["code"])}
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"\n✅ 发现 {len(results)} 个路径")

if __name__ == "__main__":
    main()