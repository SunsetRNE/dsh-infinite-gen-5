#!/usr/bin/env python3
"""计划守卫（独立验证件）：重算越界、拒绝项、证据槽与检测配对；任一失败即退出码 1。"""
import ipaddress, json, sys

DETECTION = {"host_discovery":"netflow 新主机首次出现","service_enum":"全端口扫描速率告警",
 "web_surface":"404 率突增 + 单源目录爆破","cve_triage":"nuclei UA/模板特征",
 "poc_validate":"目标侧异常子进程/崩溃","shell_stabilize":"父进程非标准 tty 的 shell",
 "stager_build":"落地可执行文件熵与签名缺失","loader_check":"内存扫描反射加载",
 "profile_load":"固定周期心跳（JA3/JA4 指纹）","session_route":"内网横向 socks 代理链",
 "amsi_map":"AMSI/ETW 探针访问","foothold":"计划任务创建事件 4698",
 "lockout_math":"单源多账号认证失败 4625","kerb_enum":"4769 异常 SPN 请求",
 "crash_triage":"进程崩溃转储集中出现","offset_find":"同进程重复崩溃"}

def audit(plan, roe):
    nets = [ipaddress.ip_network(c) for c in roe["authorized_cidrs"]]
    t = ipaddress.ip_address(plan["target"]); errs = []
    if not any(t in n for n in nets): errs.append("target outside ROE")
    if plan["target"] in roe["exclude_hosts"]: errs.append("target excluded")
    for s in plan["steps"]:
        for f in ("cmd", "signal", "evidence_slot"):
            if not s.get(f): errs.append(f"step {s['n']} missing {f}")
        if s["phase"] in roe["deny"]: errs.append(f"step {s['n']} uses denied phase {s['phase']}")
        if not DETECTION.get(s["action"]): errs.append(f"step {s['n']} has no blue-side counterpart")
        if "TARGET" in s["cmd"] or "{t}" in s["cmd"]: errs.append(f"step {s['n']} unexpanded placeholder")
    return errs

if __name__ == "__main__":
    plan, roe = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
    errs = audit(plan, roe)
    print(json.dumps({"target": plan["target"], "steps": len(plan["steps"]),
                      "all_steps_have_signal_and_evidence": not any("missing" in e for e in errs),
                      "blue_counterpart_coverage": f"{len(plan['steps'])-sum('no blue-side' in e for e in errs)}/{len(plan['steps'])}",
                      "errors": errs, "verdict": "PASS" if not errs else "FAIL"}, indent=2, ensure_ascii=False))
    sys.exit(1 if errs else 0)
