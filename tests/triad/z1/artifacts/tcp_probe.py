#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tcp_probe.py — 自包含本地 TCP 端口复核器（Z1 暴露面取证用）

只做 TCP connect() 到 127.0.0.1 的指定端口集合，不发送任何应用层载荷。
用法:
  python3 tcp_probe.py                 # 默认扫描 top-100 常用端口
  python3 tcp_probe.py --selftest      # 自检：已知关闭端口 + 自建临时监听端口各断言一次
  python3 tcp_probe.py --ports 80,443  # 只扫指定端口
  python3 tcp_probe.py --timeout 0.3 --json out.json
退出码: 0 正常, 1 自检失败
"""
import argparse
import json
import socket
import sys
import threading
import time

HOST = "127.0.0.1"

# top-100 常用端口（nmap top-ports 风格的精简自建表，写死在文件里，不依赖外部词表）
TOP100 = [
    7, 9, 13, 21, 22, 23, 25, 26, 37, 53, 79, 80, 81, 88, 106, 110, 111, 113, 119, 135,
    139, 143, 144, 179, 199, 389, 427, 443, 444, 445, 465, 513, 514, 515, 543, 544, 548,
    554, 587, 631, 646, 873, 990, 993, 995, 1025, 1026, 1027, 1028, 1029, 1110, 1433,
    1720, 1723, 1755, 1900, 2000, 2001, 2049, 2121, 2717, 3000, 3128, 3306, 3389, 3986,
    4899, 5000, 5009, 5051, 5060, 5101, 5190, 5357, 5432, 5631, 5666, 5800, 5900, 6000,
    6001, 6379, 6646, 7070, 8000, 8008, 8009, 8080, 8081, 8443, 8888, 9100, 9200, 9999,
    10000, 27017, 32768, 49152, 49153, 49154,
]


def probe(host: str, port: int, timeout: float = 0.3) -> int:
    """返回 socket.connect_ex 的原始错误码；0 = 端口接受连接。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        return s.connect_ex((host, port))
    except socket.timeout:
        return 110  # errno.ETIMEDOUT 语义（部分平台不抛该异常）
    except OSError as exc:
        return getattr(exc, "errno", -1) or -1
    finally:
        s.close()


def scan(host: str, ports, timeout: float = 0.3, workers: int = 64):
    results, t0 = {}, time.time()
    lock = threading.Lock()

    def worker(queue):
        while True:
            with lock:
                if not queue:
                    return
                port = queue.pop(0)
            results[port] = probe(host, port, timeout)

    queue = list(ports)
    threads = [threading.Thread(target=worker, args=(queue,), daemon=True) for _ in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results, time.time() - t0


def selftest(timeout: float = 0.3) -> int:
    """自检：对「已知关闭端口」与「自身临时监听端口」各断言一次。"""
    failures = []

    # 1) 自建临时监听端口必须被判为 open
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((HOST, 0))
    srv.listen(1)
    live_port = srv.getsockname()[1]
    rc_live = probe(HOST, live_port, timeout)
    print(f"[selftest] 自建监听端口 {live_port}: connect_ex={rc_live} -> {'PASS' if rc_live == 0 else 'FAIL'}")
    if rc_live != 0:
        failures.append(f"live port {live_port} not detected as open (rc={rc_live})")
    srv.close()
    time.sleep(0.1)

    # 2) 同一个端口在关闭后必须判为 closed（ECONNREFUSED=111）
    rc_dead = probe(HOST, live_port, timeout)
    print(f"[selftest] 刚关闭的端口 {live_port}: connect_ex={rc_dead} -> {'PASS' if rc_dead == 111 else 'FAIL'}")
    if rc_dead != 111:
        failures.append(f"closed port {live_port} not detected as refused (rc={rc_dead})")

    # 3) 保留高位端口（IANA 未分配区间内的固定取值）作为已知关闭端口的补充断言
    known_closed = 49321
    rc_kc = probe(HOST, known_closed, timeout)
    print(f"[selftest] 已知关闭端口 {known_closed}: connect_ex={rc_kc} -> {'PASS' if rc_kc in (111, 110) else 'FAIL'}")
    if rc_kc not in (111, 110):
        failures.append(f"known-closed port {known_closed} unexpected rc={rc_kc}")

    if failures:
        print("[selftest] FAIL: " + "; ".join(failures))
        return 1
    print("[selftest] ALL PASS (3/3 断言)")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="127.0.0.1 TCP 端口复核器（connect_ex）")
    ap.add_argument("--host", default=HOST)
    ap.add_argument("--ports", default="", help="逗号分隔端口；留空=top100")
    ap.add_argument("--timeout", type=float, default=0.3)
    ap.add_argument("--workers", type=int, default=64)
    ap.add_argument("--json", default="", help="把结果写成 JSON")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(argv)

    if args.selftest:
        return selftest(args.timeout)

    ports = ([int(p) for p in args.ports.split(",") if p.strip()]
             if args.ports else TOP100)
    res, elapsed = scan(args.host, ports, args.timeout, args.workers)
    opened = sorted(p for p, rc in res.items() if rc == 0)
    closed = sorted(p for p, rc in res.items() if rc != 0)
    print(f"target={args.host} scanned={len(ports)} timeout={args.timeout}s workers={args.workers}")
    print(f"open={len(opened)} closed/other={len(closed)} elapsed={elapsed:.2f}s")
    print("open_ports=" + ",".join(str(p) for p in opened))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"target": args.host, "timeout": args.timeout, "elapsed_s": round(elapsed, 3),
                       "scanned": len(ports), "open": opened,
                       "closed": closed, "raw": {str(k): v for k, v in sorted(res.items())}},
                      fh, ensure_ascii=False, indent=1)
        print(f"json_written={args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
