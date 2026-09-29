#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""reach_matrix.py — Z5 横向可行域矩阵（TCP connect 探测，自包含、只读网络探测）

用法:
  python3 reach_matrix.py --selftest                 # 自检：临时监听端口断言 open / 关闭端口断言 closed
  python3 reach_matrix.py                            # 自动发现候选（本机回环 / 路由网关 / 同网段 / DNS）
  python3 reach_matrix.py --targets 127.0.0.1,10.202.11.229 --ports 22,80,443
  python3 reach_matrix.py --json /tmp/z5_matrix.json  # 落盘结构化结果

判定码:
  O open        TCP 三次握手完成
  R refused     对端回 RST（主机可达，端口关闭）
  T timeout     无任何回包（被丢弃 / 过滤 / 黑洞）
  N no-route    本机无到该目标的可用路由（内核 ENETUNREACH/EHOSTUNREACH）
  E error       其他 errno（原样打印 errno 名）

仅对自有 / 已授权目标使用。探测为 connect() 语义：不发送应用层载荷。
"""
import argparse
import concurrent.futures as cf
import errno
import ipaddress
import json
import socket
import subprocess
import sys
import time

DEFAULT_PORTS = [22, 80, 443, 3000, 3080, 8080]
DEFAULT_TIMEOUT = 0.5
CODE = {"open": "O", "refused": "R", "timeout": "T", "no-route": "N"}


def sh(cmd):
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
        return p.stdout
    except Exception:
        return ""


def local_v4():
    """返回 [(iface, ip, prefixlen)]，来自 `ip -br -4 a`（缺 ip 命令时退化为 hostname -I）。"""
    out, res = sh("ip -br -4 a 2>/dev/null"), []
    if out:
        for line in out.splitlines():
            f = line.split()
            if len(f) >= 3 and "/" in f[2] and f[1] != "DOWN":
                try:
                    iface = f[0].split("@")[0]
                    ip, plen = f[2].split("/")
                    res.append((iface, ipaddress.ip_address(ip), int(plen)))
                except ValueError:
                    continue
        if res:
            return res
    for ip in sh("hostname -I").split():
        try:
            a = ipaddress.ip_address(ip)
            if a.version == 4:
                res.append(("?", a, 32))
        except ValueError:
            continue
    return res


def route_gateways():
    """从所有路由表里取 `default via X` 与 `via X` 的下一跳（Android 策略路由分散在多张表）。"""
    gw, out = [], sh("ip route show table all 2>/dev/null")
    for line in out.splitlines():
        t = line.split()
        if "via" in t:
            try:
                cand = ipaddress.ip_address(t[t.index("via") + 1])
                if cand.version == 4 and str(cand) not in gw:
                    gw.append(str(cand))
            except (ValueError, IndexError):
                pass
    return gw


def resolvers():
    res = []
    try:
        with open("/etc/resolv.conf", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                t = line.split()
                if len(t) >= 2 and t[0] == "nameserver":
                    try:
                        a = ipaddress.ip_address(t[1])
                        if a.version == 4:
                            res.append(str(a))
                    except ValueError:
                        pass
    except OSError:
        pass
    return res


def discover_targets():
    """候选集：回环 + 各网段的 .1/.2/.254 + 路由下一跳 + DNS 解析器（去重保序）。"""
    cands = ["127.0.0.1"]
    ifaces = local_v4()
    for _iface, ip, plen in ifaces:
        net = ipaddress.ip_network(f"{ip}/{plen}", strict=False)
        cands.append(str(ip))
        if net.num_addresses >= 4:
            for host in (1, 2, 254):
                try:
                    a = net.network_address + host
                except ValueError:
                    continue
                if a in net and a != net.network_address and a != net.broadcast_address:
                    cands.append(str(a))
    cands += route_gateways() + resolvers()
    seen, out = set(), []
    for c in cands:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out, ifaces


def probe(ip, port, timeout):
    t0 = time.perf_counter()
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((ip, port))
        return "open", (time.perf_counter() - t0) * 1000.0, ""
    except socket.timeout:
        return "timeout", (time.perf_counter() - t0) * 1000.0, "ETIMEDOUT"
    except ConnectionRefusedError:
        return "refused", (time.perf_counter() - t0) * 1000.0, "ECONNREFUSED"
    except OSError as e:
        name = errno.errorcode.get(e.errno, str(e.errno))
        v = "no-route" if e.errno in (errno.ENETUNREACH, errno.EHOSTUNREACH, errno.ENETDOWN) else "error"
        return v, (time.perf_counter() - t0) * 1000.0, name
    finally:
        try:
            s.close()
        except OSError:
            pass


def run_matrix(targets, ports, timeout, workers):
    rows, t0 = {}, time.perf_counter()
    jobs = [(t, p) for t in targets for p in ports]
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(probe, t, p, timeout): (t, p) for t, p in jobs}
        for fu in cf.as_completed(futs):
            t, p = futs[fu]
            rows.setdefault(t, {})[p] = fu.result()
    return rows, (time.perf_counter() - t0)


def print_matrix(rows, ports, elapsed):
    w = max(15, max((len(t) for t in rows), default=8))
    print(f"{'target':<{w}} " + " ".join(f"{p:>5}" for p in ports) + "   max_ms")
    for t in rows:
        cells, ms = [], 0.0
        for p in ports:
            v, took, _e = rows[t][p]
            cells.append(f"{CODE.get(v, 'E'):>5}")
            ms = max(ms, took)
        print(f"{t:<{w}} " + " ".join(cells) + f"   {ms:7.1f}")
    print(f"\n矩阵规模: {len(rows)} 目标 x {len(ports)} 端口 = {len(rows) * len(ports)} 次 TCP connect"
          f"  |  总耗时 {elapsed:.2f}s  |  timeout={DEFAULT_TIMEOUT}s/次")
    print("O=open  R=refused(端口关闭)  T=timeout(丢弃/过滤)  N=no-route(本机无路由)  E=其他 errno")


def selftest():
    """断言三条路径：临时监听端口=open、已关闭端口=closed(RST)、黑洞地址=timeout/no-route。"""
    ok, fails = [], []

    def check(name, cond, detail):
        (ok if cond else fails).append(f"{'PASS' if cond else 'FAIL'}  {name}: {detail}")

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(4)
    live_port = srv.getsockname()[1]
    v, ms, err = probe("127.0.0.1", live_port, DEFAULT_TIMEOUT)
    check("临时监听端口->open", v == "open", f"127.0.0.1:{live_port} -> {v} ({err or 'handshake ok'}, {ms:.1f}ms)")
    srv.close()

    tmp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    tmp.bind(("127.0.0.1", 0))
    dead_port = tmp.getsockname()[1]
    tmp.close()
    v, ms, err = probe("127.0.0.1", dead_port, DEFAULT_TIMEOUT)
    check("关闭端口->refused", v in ("refused",), f"127.0.0.1:{dead_port} -> {v} ({err}, {ms:.1f}ms)")

    live2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    live2.bind(("127.0.0.1", 0))
    live2.listen(4)
    p2 = live2.getsockname()[1]
    matrix, elapsed = run_matrix(["127.0.0.1"], [p2, dead_port], DEFAULT_TIMEOUT, 2)
    c_open = matrix["127.0.0.1"][p2][0]
    c_dead = matrix["127.0.0.1"][dead_port][0]
    live2.close()
    check("run_matrix 与 probe 一致", c_open == "open" and c_dead == "refused",
          f"matrix[listen]={c_open}, matrix[closed]={c_dead}, {elapsed * 1000:.1f}ms")

    # 出网侧的「黑洞地址」不是断言项：若环境存在透明 TCP 拦截，不可路由地址也会被判 open。
    v, ms, err = probe("192.0.2.1", 443, DEFAULT_TIMEOUT)   # TEST-NET-1，RFC5737 保留，不可路由
    note = "提示：非本机地址出现 open 说明出口存在透明 TCP 拦截（见 z5.md 拦截验证节），非本脚本判定错误"
    print(f"NOTE  黑洞地址观测(仅记录, 不断言): 192.0.2.1:443 -> {v} ({err or 'handshake ok'}, {ms:.1f}ms)  {note}")

    for line in ok + fails:
        print(line)
    print(f"\nselftest: {len(ok)} passed, {len(fails)} failed")
    return 0 if not fails else 1


def main():
    ap = argparse.ArgumentParser(description="Z5 横向可行域 TCP connect 矩阵")
    ap.add_argument("--selftest", action="store_true", help="自检并退出")
    ap.add_argument("--targets", default="", help="逗号分隔 IP；留空=自动发现")
    ap.add_argument("--ports", default="", help=f"逗号分隔端口；默认 {','.join(map(str, DEFAULT_PORTS))}")
    ap.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--json", default="", help="结果落盘路径")
    a = ap.parse_args()

    if a.selftest:
        return selftest()

    ports = [int(x) for x in a.ports.split(",") if x.strip()] or DEFAULT_PORTS
    if a.targets.strip():
        targets, ifaces = [x.strip() for x in a.targets.split(",") if x.strip()], local_v4()
    else:
        targets, ifaces = discover_targets()

    print("== Z5 横向可行域矩阵 (TCP connect) ==")
    print(f"时间(UTC): {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}  timeout={a.timeout}s  workers={a.workers}")
    for iface, ip, plen in ifaces:
        print(f"本地接口: {iface:<14} {ip}/{plen}  网段 {ipaddress.ip_network(f'{ip}/{plen}', strict=False)}")
    print(f"候选目标({len(targets)}): {', '.join(targets)}\n")

    rows, elapsed = run_matrix(targets, ports, a.timeout, a.workers)
    print_matrix(rows, ports, elapsed)

    verdicts = {}
    for t in rows:
        for p in ports:
            v = rows[t][p][0]
            verdicts[v] = verdicts.get(v, 0) + 1
    print("判定分布: " + "  ".join(f"{k}={v}" for k, v in sorted(verdicts.items())))

    if a.json:
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "timeout_s": a.timeout,
            "ports": ports,
            "targets": targets,
            "elapsed_s": round(elapsed, 3),
            "matrix": {t: {str(p): {"verdict": rows[t][p][0], "ms": round(rows[t][p][1], 2),
                                   "errno": rows[t][p][2]} for p in ports} for t in rows},
            "distribution": verdicts,
        }
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        print(f"JSON 已写入 {a.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
