#!/usr/bin/env python3
"""应急响应检测器 — 快速检测进程/网络/用户/文件/持久化异常"""
import argparse, json, subprocess, sys, os, time

def run(cmd, timeout=15, shell=False):
    try:
        r = subprocess.run(cmd if isinstance(cmd, list) and not shell else cmd, capture_output=True, text=True, timeout=timeout, shell=shell)
        return r.stdout.strip() if r.returncode == 0 else ""
    except:
        return ""

def check_processes():
    findings = []
    # 可疑进程
    suspicious = run("ps aux | grep -iE 'nc |ncat|socat|meterpreter|shell|backdoor|payload|beacon|miner|crypto|xmrig' | grep -v grep", shell=True)
    if suspicious:
        findings.append({"type": "suspicious_process", "severity": "high", "detail": suspicious[:500]})
    # CPU 异常
    high_cpu = run("ps aux --sort=-%cpu | head -6 | tail -5", shell=True)
    findings.append({"type": "high_cpu", "severity": "info", "detail": high_cpu})
    return findings

def check_network():
    findings = []
    # 异常外联
    conns = run("netstat -antp 2>/dev/null | grep ESTABLISHED | grep -v '127.0.0.1\\|::1' | head -20", shell=True)
    if conns:
        findings.append({"type": "external_connections", "severity": "medium", "detail": conns})
    # 监听端口
    listeners = run("netstat -tlnp 2>/dev/null | grep -v '127.0.0.1' | head -20", shell=True)
    if listeners:
        findings.append({"type": "listening_ports", "severity": "low", "detail": listeners})
    return findings

def check_users():
    findings = []
    # 最近登录
    recent = run("last -10 2>/dev/null", shell=True)
    if recent:
        findings.append({"type": "recent_logins", "severity": "info", "detail": recent})
    # 失败登录
    failed = run("grep 'Failed' /var/log/auth.log 2>/dev/null | tail -10", shell=True)
    if failed:
        findings.append({"type": "failed_logins", "severity": "low", "detail": failed})
    return findings

def check_persistence():
    findings = []
    # crontab
    for user in ["root"]:
        crons = run(f"crontab -u {user} -l 2>/dev/null", shell=True)
        if crons and "no crontab" not in crons.lower():
            findings.append({"type": "crontab", "severity": "low", "detail": crons})
    # authorized_keys
    for keyfile in ["/root/.ssh/authorized_keys", os.path.expanduser("~/.ssh/authorized_keys")]:
        if os.path.exists(keyfile):
            with open(keyfile) as f:
                keys = f.read().strip()
            if keys:
                findings.append({"type": "ssh_keys", "severity": "low", "detail": keys[:500]})
    # LD_PRELOAD
    if os.path.exists("/etc/ld.so.preload"):
        with open("/etc/ld.so.preload") as f:
            content = f.read().strip()
        if content:
            findings.append({"type": "ld_preload", "severity": "high", "detail": content})
    return findings

def main():
    ap = argparse.ArgumentParser(description="应急响应检测器")
    ap.add_argument("--check", default="all", help="检查项: all/process/network/user/persistence")
    ap.add_argument("--json", action="store_true", help="JSON输出")
    ap.add_argument("-o", "--output", help="输出JSON文件")
    args = ap.parse_args()
    
    result = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "hostname": run("hostname"),
        "findings": [],
    }
    
    if args.check in ("all", "process"):
        result["findings"].extend(check_processes())
    if args.check in ("all", "network"):
        result["findings"].extend(check_network())
    if args.check in ("all", "user"):
        result["findings"].extend(check_users())
    if args.check in ("all", "persistence"):
        result["findings"].extend(check_persistence())
    
    # 统计
    severities = {"high": 0, "medium": 0, "low": 0, "info": 0}
    for f in result["findings"]:
        severities[f["severity"]] = severities.get(f["severity"], 0) + 1
    result["summary"] = {"total": len(result["findings"]), "by_severity": severities}
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"[*] 应急检测完成 ({result['timestamp']})")
        print(f"[*] 主机: {result['hostname']}")
        print(f"[*] 发现: {result['summary']['total']} 项")
        for f in result["findings"]:
            print(f"\n  [{f['severity'].upper()}] {f['type']}")
            print(f"  {f['detail'][:200]}")

if __name__ == "__main__":
    main()