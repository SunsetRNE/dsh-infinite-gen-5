#!/usr/bin/env python3
"""提权枚举器 — 自动检测sudo/SUID/cron/capabilities等提权向量"""
import argparse, json, subprocess, sys, os

def run(cmd, timeout=10, shell=False):
    try:
        r = subprocess.run(cmd if isinstance(cmd, list) and not shell else cmd, capture_output=True, text=True, timeout=timeout, shell=shell)
        return r.stdout.strip() if r.returncode == 0 else ""
    except: return ""

def check_sudo():
    findings = []
    out = run("sudo -l 2>/dev/null", shell=True)
    if out and "may run" in out.lower():
        for line in out.split("\n"):
            if "NOPASSWD" in line or "ALL" in line:
                findings.append({"type": "sudo_nopasswd", "detail": line.strip(), "severity": "critical"})
            elif "(" in line:
                findings.append({"type": "sudo_allowed", "detail": line.strip(), "severity": "high"})
    return findings

def check_suid():
    findings = []
    out = run("find / -perm -4000 -type f 2>/dev/null | head -30", shell=True, timeout=30)
    dangerous = {"vim","find","bash","python","python3","perl","ruby","less","more","awk","nmap","cp","mv","cat","tar","gdb","php","node","screen","tmux"}
    for line in out.split("\n"):
        line = line.strip()
        if line:
            for d in dangerous:
                if d in line.lower():
                    findings.append({"type": "suid_dangerous", "detail": line, "severity": "high"})
                    break
    return findings

def check_cron():
    findings = []
    cron_files = run("ls -la /etc/cron* 2>/dev/null", shell=True)
    if cron_files: findings.append({"type": "cron_config", "detail": cron_files[:500], "severity": "info"})
    crontab = run("crontab -l 2>/dev/null", shell=True)
    if crontab: findings.append({"type": "user_crontab", "detail": crontab[:500], "severity": "medium"})
    return findings

def check_writable():
    findings = []
    out = run("find / -writable -type f 2>/dev/null | grep -v '/proc/\|/sys/\|/dev/' | head -20", shell=True, timeout=30)
    for line in out.split("\n"):
        line = line.strip()
        if line and ("/etc/" in line or "/root/" in line or "/var/www/" in line):
            findings.append({"type": "writable_sensitive", "detail": line, "severity": "high"})
    return findings

def check_kernel():
    findings = []
    out = run("uname -r", shell=True)
    if out:
        findings.append({"type": "kernel_version", "detail": out, "severity": "info"})
        # 检查是否有已知漏洞
        if any(v in out for v in ["4.","5.0","5.1","5.2","5.3","5.4","5.5","5.6","5.7","5.8"]):
            findings.append({"type": "kernel_vulnerable", "detail": f"内核{out}可能有已知提权漏洞(CVE-2022-0847等)", "severity": "high"})
    return findings

def main():
    ap = argparse.ArgumentParser(description="提权枚举器")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()
    
    all_findings = []
    all_findings.extend(check_sudo())
    all_findings.extend(check_suid())
    all_findings.extend(check_cron())
    all_findings.extend(check_writable())
    all_findings.extend(check_kernel())
    
    result = {"total": len(all_findings), "findings": all_findings}
    for f in all_findings:
        result[f["severity"]] = result.get(f["severity"], 0) + 1
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"[*] 提权枚举: 发现 {len(all_findings)} 个向量")
        for f in sorted(all_findings, key=lambda x: {"critical":0,"high":1,"medium":2,"low":3,"info":4}.get(x["severity"],5)):
            print(f"  [{f['severity'].upper()}] {f['type']}: {f['detail'][:100]}")

if __name__ == "__main__":
    main()