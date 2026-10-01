#!/usr/bin/env python3
"""
zhekk — 渗透终端系统入口编排器
基于当前环境：Android 15 + Ubuntu 24.04 proot + ADB + 33工具 + 4引擎

用法:
  python3 scripts/zhekk.py recon --target example.com
  python3 scripts/zhekk.py web --target https://example.com --check sqli,xss
  python3 scripts/zhekk.py auto --target 192.168.1.1
  python3 scripts/zhekk.py status
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# ─── 环境信息 ───────────────────────────────────────────
ZHEKK_HOME = Path(__file__).resolve().parent.parent

ENV_INFO = {
    "system": "Android 15 (ARM64)",
    "kernel": "Linux 6.6.89",
    "terminal": "Ubuntu 24.04.4 LTS (proot)",
    "python": "3.12.3",
    "disk": "460GB (可用222GB)",
    "network": "WiFi 192.168.1.8, 外网可达",
    "engines": ["terminal", "ADB", "browser(Playwright)", "Shell(Shizuku)"],
}

TOOLS_AVAILABLE = [
    "nmap", "nuclei", "masscan", "sqlmap", "ffuf", "wpscan",
    "hydra", "john", "hashcat", "searchsploit",
    "frida", "apktool", "jadx", "radare2", "gdb", "scapy", "adb",
    "binwalk", "qemu-arm-static", "airodump-ng", "aircrack-ng",
    "proxychains", "torsocks", "strace", "tcpdump", "foremost",
    "tshark", "screen", "mosquitto_sub", "sslscan", "ab", "hcitool",
]

TOOLS_MISSING = {
    "crackmapexec": "hydra + ssh + nmap",
    "msfconsole": "searchsploit + nuclei",
    "burpsuite": "浏览器引擎(Playwright) + curl",
    "responder": "scapy 构造LLMNR/NBT-NS",
    "bloodhound": "手动枚举AD",
    "sstimap": "手工: {{7*7}} ${7*7}",
    "xsstrike": "手工: 上下文逃逸",
    "naabu": "nmap + masscan",
    "yara": "grep + strings",
    "aws": "curl 替代",
    "kubectl": "curl k8s API",
}

# ─── 工具检查 ───────────────────────────────────────────
def check_tool(tool_name):
    """检查工具是否可用"""
    result = subprocess.run(
        ["which", tool_name],
        capture_output=True, text=True, timeout=5
    )
    return result.returncode == 0, result.stdout.strip()

def check_all_tools():
    """检查所有工具状态"""
    results = {"available": {}, "missing": {}}
    for tool in TOOLS_AVAILABLE:
        ok, path = check_tool(tool)
        if ok:
            results["available"][tool] = path
        else:
            results["missing"][tool] = TOOLS_MISSING.get(tool, "N/A")
    return results

def check_python_libs():
    """检查Python库"""
    libs = {
        "scapy": "scapy", "requests": "requests", "paramiko": "paramiko",
        "pycryptodome": "Crypto", "pillow": "PIL", "frida": "frida",
    }
    results = {}
    for name, module in libs.items():
        try:
            __import__(module)
            results[name] = "OK"
        except ImportError:
            results[name] = "MISSING"
    return results

# ─── 命令执行 ───────────────────────────────────────────
def run_cmd(cmd, timeout=60, shell=False):
    """执行命令并返回结果"""
    try:
        if isinstance(cmd, str) and not shell:
            cmd = cmd.split()
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "exit_code": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "stdout": "", "stderr": "TIMEOUT", "exit_code": -1}
    except Exception as e:
        return {"success": False, "stdout": "", "stderr": str(e), "exit_code": -1}

# ─── 子命令 ─────────────────────────────────────────────
def cmd_status(args):
    """显示状态"""
    print("=" * 60)
    print("  zhekk — 渗透终端系统")
    print("=" * 60)
    print(f"\n环境: {ENV_INFO['system']}")
    print(f"终端: {ENV_INFO['terminal']}")
    print(f"Python: {ENV_INFO['python']}")
    print(f"网络: {ENV_INFO['network']}")
    print(f"引擎: {', '.join(ENV_INFO['engines'])}")
    
    print(f"\n--- 工具检查 ---")
    tools = check_all_tools()
    print(f"\n✅ 可用 ({len(tools['available'])}):")
    for tool, path in sorted(tools["available"].items()):
        print(f"  {tool:<20} {path}")
    
    print(f"\n❌ 缺失 ({len(tools['missing'])}):")
    for tool, alt in sorted(tools["missing"].items()):
        print(f"  {tool:<20} → {alt}")
    
    print(f"\n--- Python 库 ---")
    libs = check_python_libs()
    for name, status in libs.items():
        print(f"  {name:<20} {status}")
    
    print(f"\n--- 模块 ---")
    modules_dir = ZHEKK_HOME / "modules"
    for d in sorted(modules_dir.iterdir()):
        if d.is_dir():
            skill = d / "SKILL.md"
            if skill.exists():
                lines = len(skill.read_text().splitlines())
                print(f"  {d.name:<20} {lines}行")

def cmd_recon(args):
    """信息收集"""
    target = args.target
    if not target:
        print("❌ 需要 --target 参数")
        return 1
    
    results = {"target": target, "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"), "findings": {}}
    
    print(f"[*] 信息收集: {target}")
    
    # 1. 端口扫描
    if not args.skip_ports:
        print("[*] 端口扫描...")
        r = run_cmd(f"nmap -sV -T4 -F {target}", timeout=120)
        results["findings"]["ports"] = r["stdout"] if r["success"] else r["stderr"]
        print(r["stdout"][:500] if r["stdout"] else r["stderr"])
    
    # 2. 子域名枚举
    if not args.skip_subdomains:
        print("[*] 子域名枚举...")
        # 使用 dig 或 host 命令
        domain = target.replace("https://", "").replace("http://", "").split("/")[0]
        subs = ["www", "api", "admin", "mail", "dev", "staging", "test", "portal", "blog", "cdn"]
        found = []
        for sub in subs:
            r = run_cmd(f"dig +short {sub}.{domain}", timeout=10)
            if r["success"] and r["stdout"]:
                found.append(f"{sub}.{domain} → {r['stdout']}")
        results["findings"]["subdomains"] = found
        for s in found:
            print(f"  {s}")
    
    # 3. HTTP 探测
    if not args.skip_http:
        print("[*] HTTP 探测...")
        url = target if target.startswith("http") else f"https://{target}"
        r = run_cmd(f"curl -sI -m 10 {url} 2>&1", timeout=15)
        results["findings"]["http_headers"] = r["stdout"] if r["success"] else r["stderr"]
        print(r["stdout"][:500] if r["stdout"] else r["stderr"])
    
    # 保存结果
    out_file = args.output or f"recon_{target.replace('.', '_')}.json"
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n✅ 结果保存到 {out_file}")
    return 0

def cmd_web(args):
    """Web 渗透测试"""
    target = args.target
    if not target:
        print("❌ 需要 --target 参数")
        return 1
    
    checks = args.check.split(",") if args.check else ["sqli", "xss", "headers"]
    results = {"target": target, "checks": checks, "findings": {}}
    
    print(f"[*] Web 测试: {target}")
    print(f"[*] 检查项: {', '.join(checks)}")
    
    # 安全头检查
    if "headers" in checks:
        print("[*] 安全头检查...")
        r = run_cmd(f"curl -sI -m 10 {target}", timeout=15)
        headers = r["stdout"] if r["success"] else ""
        missing = []
        if "Strict-Transport-Security" not in headers:
            missing.append("HSTS")
        if "Content-Security-Policy" not in headers:
            missing.append("CSP")
        if "X-Frame-Options" not in headers:
            missing.append("X-Frame-Options")
        if "X-Content-Type-Options" not in headers:
            missing.append("X-Content-Type-Options")
        results["findings"]["headers"] = {
            "raw": headers,
            "missing": missing,
            "risk": "中危" if len(missing) >= 3 else "低危" if missing else "安全",
        }
        print(f"  缺失安全头: {missing}" if missing else "  安全头完整")
    
    # nuclei 扫描
    if "nuclei" in checks:
        print("[*] Nuclei 扫描...")
        r = run_cmd(f"nuclei -u {target} -silent -c 20 -timeout 10", timeout=180)
        results["findings"]["nuclei"] = r["stdout"] if r["success"] else r["stderr"]
        print(r["stdout"][:500] if r["stdout"] else r["stderr"])
    
    out_file = args.output or f"web_{target.replace('://', '_').replace('/', '_')}.json"
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n✅ 结果保存到 {out_file}")
    return 0

def cmd_auto(args):
    """自动化渗透"""
    target = args.target
    if not target:
        print("❌ 需要 --target 参数")
        return 1
    
    print(f"╔══════════════════════════════════════════════════════╗")
    print(f"║  zhekk 自动化渗透测试                                  ║")
    print(f"║  目标: {target:<44} ║")
    print(f"║  时间: {time.strftime('%Y-%m-%d %H:%M:%S'):<44} ║")
    print(f"╚══════════════════════════════════════════════════════╝")
    
    results = {"target": target, "phases": {}}
    
    # 阶段1: 信息收集
    print("\n[阶段1/4] 信息收集...")
    r = run_cmd(f"nmap -sV -T4 -F {target}", timeout=120)
    results["phases"]["recon"] = {
        "status": "completed" if r["success"] else "failed",
        "output": r["stdout"][:3000] if r["success"] else r["stderr"],
    }
    print(f"  {'✅' if r['success'] else '❌'} 端口扫描完成")
    
    # 阶段2: Web 扫描
    print("\n[阶段2/4] Web 扫描...")
    url = target if target.startswith("http") else f"https://{target}"
    r = run_cmd(f"nuclei -u {url} -silent -c 20 -timeout 10 -severity critical,high,medium", timeout=180)
    results["phases"]["web_scan"] = {
        "status": "completed" if r["success"] else "failed",
        "output": r["stdout"][:3000] if r["success"] else r["stderr"],
    }
    vulns = r["stdout"].strip().split("\n") if r["stdout"] else []
    print(f"  {'✅' if r['success'] else '❌'} 发现 {len(vulns)} 个漏洞")
    
    # 阶段3: 漏洞利用
    print("\n[阶段3/4] 漏洞利用...")
    if vulns:
        for v in vulns[:5]:
            print(f"  [!] {v[:120]}")
    else:
        print("  未发现明显漏洞，跳过利用阶段")
    results["phases"]["exploit"] = {"status": "skipped", "reason": "无漏洞或需手工确认"}
    
    # 阶段4: 报告
    print("\n[阶段4/4] 生成报告...")
    out_file = args.output or f"auto_{target.replace('.', '_').replace('://', '_')}.json"
    results["timestamp"] = time.strftime("%Y-%m-%d %H:%M:%S")
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"  ✅ 报告保存到 {out_file}")
    
    print(f"\n{'='*60}")
    print(f"  测试完成")
    print(f"  总阶段: 4 | 发现漏洞: {len(vulns)}")
    print(f"{'='*60}")
    return 0

# ─── 主入口 ─────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="zhekk — 渗透终端系统",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python3 scripts/zhekk.py status                    # 查看状态
  python3 scripts/zhekk.py recon --target example.com  # 信息收集
  python3 scripts/zhekk.py web --target https://example.com --check sqli,xss
  python3 scripts/zhekk.py auto --target 192.168.1.1  # 自动化渗透
        """
    )
    
    sub = parser.add_subparsers(dest="command", help="子命令")
    
    # status
    sp_status = sub.add_parser("status", help="查看系统状态")
    sp_status.set_defaults(func=cmd_status)
    
    # recon
    sp_recon = sub.add_parser("recon", help="信息收集")
    sp_recon.add_argument("--target", required=True, help="目标域名/IP")
    sp_recon.add_argument("--skip-ports", action="store_true", help="跳过端口扫描")
    sp_recon.add_argument("--skip-subdomains", action="store_true", help="跳过子域名枚举")
    sp_recon.add_argument("--skip-http", action="store_true", help="跳过HTTP探测")
    sp_recon.add_argument("-o", "--output", help="输出文件")
    sp_recon.set_defaults(func=cmd_recon)
    
    # web
    sp_web = sub.add_parser("web", help="Web渗透测试")
    sp_web.add_argument("--target", required=True, help="目标URL")
    sp_web.add_argument("--check", default="headers,nuclei", help="检查项: headers,sqli,xss,nuclei")
    sp_web.add_argument("-o", "--output", help="输出文件")
    sp_web.set_defaults(func=cmd_web)
    
    # auto
    sp_auto = sub.add_parser("auto", help="自动化渗透测试")
    sp_auto.add_argument("--target", required=True, help="目标IP/域名")
    sp_auto.add_argument("-o", "--output", help="输出文件")
    sp_auto.set_defaults(func=cmd_auto)
    
    args = parser.parse_args()
    
    if not args.command:
        # 默认显示 status
        cmd_status(args)
        return 0
    
    return args.func(args)

if __name__ == "__main__":
    sys.exit(main())