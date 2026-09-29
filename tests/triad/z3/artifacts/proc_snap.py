#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""proc_snap.py — Z3 自包含内存/取证采集器（只读，无外部依赖）。

采集三件产物，全部落在 --outdir（默认 ./z3out）：
  (a) procs.txt   /proc/*/stat 解析出的 pid/comm/rss，按 rss 降序取前 N（默认 20）
  (b) maps.txt    目标进程 /proc/<pid>/maps 的分段统计
                  （可执行段 / 匿名段 / 堆[heap] / 栈[stack] 的段数与字节数）
  (c) hashes.txt  对 /proc/<pid>/exe、/proc/<pid>/maps、/etc/hostname 做 sha256
                  输出登记行：ISO8601时间戳<TAB>路径<TAB>sha256<TAB>字节数

用法：
  python3 proc_snap.py --list                 # 只看进程列表前 N
  python3 proc_snap.py --pid 1234             # 采集指定 pid
  python3 proc_snap.py --pid self --outdir z3out
  python3 proc_snap.py --selftest             # 自造子进程并断言采集链路正确

判定信号（selftest）：
  rss > 0            -> /proc/<pid>/stat 字段 24 可读且非零
  maps 段数 > 0      -> /proc/<pid>/maps 可枚举
  哈希长度 == 64     -> sha256 十六进制串完整

已知边界：本脚本只读 procfs。它不能读取宿主内核内存；容器内 /proc/kcore、
/dev/mem 是否存在由内核配置与容器运行时决定，不在本脚本职责内。
"""

import argparse
import hashlib
import os
import subprocess
import sys
import time

PAGE = os.sysconf("SC_PAGE_SIZE")
DEFAULT_TOP = 20


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def _iter_pids():
    """枚举 /proc 下纯数字目录。"""
    for name in os.listdir("/proc"):
        if name.isdigit():
            yield int(name)


def parse_stat(pid):
    """解析 /proc/<pid>/stat，返回 dict。

    comm 字段（第 2 个）可能含空格与右括号，因此从最后一个 ')' 切开，
    而不是用 split(' ')。切点右侧的第 k 个字段对应 /proc/pid/stat 的第 k+3 字段。
    """
    try:
        with open("/proc/%d/stat" % pid, "r", errors="replace") as fh:
            raw = fh.read()
    except (FileNotFoundError, ProcessLookupError):
        return None
    except PermissionError:
        return None
    rp = raw.rfind(")")
    lp = raw.find("(")
    if lp < 0 or rp < 0 or rp < lp:
        return None
    comm = raw[lp + 1:rp]
    rest = raw[rp + 1:].split()
    # rest[0] = state(字段3) ... rest[21] = rss(字段24)，单位页
    try:
        rss_pages = int(rest[21])
        vsize = int(rest[20])
        state = rest[0]
        ppid = int(rest[1])
    except (IndexError, ValueError):
        return None
    return {
        "pid": pid,
        "comm": comm,
        "state": state,
        "ppid": ppid,
        "vsize": vsize,
        "rss_pages": rss_pages,
        "rss_kb": rss_pages * PAGE // 1024,
    }


def proc_table(top=DEFAULT_TOP):
    """(a) 当前进程列表 pid/comm/rss，按 rss 降序前 top 条。"""
    rows = []
    for pid in _iter_pids():
        st = parse_stat(pid)
        if st is not None:
            rows.append(st)
    rows.sort(key=lambda r: r["rss_kb"], reverse=True)
    return rows, rows[:top]


def tracer_pids():
    """扫描 /proc/<pid>/status 中 TracerPid != 0 的项（调试/注入痕迹）。"""
    hits = []
    for pid in _iter_pids():
        try:
            with open("/proc/%d/status" % pid, "r", errors="replace") as fh:
                for line in fh:
                    if line.startswith("TracerPid:"):
                        val = line.split(":", 1)[1].strip()
                        if val not in ("0", ""):
                            hits.append((pid, int(val)))
                        break
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    return hits


def maps_stats(pid):
    """(b) /proc/<pid>/maps 分段统计。

    分类互斥，按优先级判定：heap > stack > executable > anonymous > other。
    字节数 = 该行地址上界 - 地址下界。
    """
    cats = {
        "exec": {"n": 0, "bytes": 0},
        "anon": {"n": 0, "bytes": 0},
        "heap": {"n": 0, "bytes": 0},
        "stack": {"n": 0, "bytes": 0},
        "other": {"n": 0, "bytes": 0},
    }
    total = {"n": 0, "bytes": 0}
    path = "/proc/%d/maps" % pid
    try:
        with open(path, "r", errors="replace") as fh:
            for line in fh:
                parts = line.split(None, 5)
                if len(parts) < 5:
                    continue
                try:
                    lo, hi = parts[0].split("-")
                    nbytes = int(hi, 16) - int(lo, 16)
                except ValueError:
                    continue
                perms = parts[1]
                pathname = parts[5].strip() if len(parts) > 5 else ""
                total["n"] += 1
                total["bytes"] += nbytes
                if pathname == "[heap]":
                    key = "heap"
                elif pathname.startswith("[stack"):
                    key = "stack"
                elif "x" in perms:
                    key = "exec"
                elif pathname == "":
                    key = "anon"
                else:
                    key = "other"
                cats[key]["n"] += 1
                cats[key]["bytes"] += nbytes
    except (FileNotFoundError, ProcessLookupError):
        return None
    except PermissionError:
        return None
    return {"cats": cats, "total": total, "path": path}


def sha256_of(path):
    """流式 sha256；对 /proc/<pid>/exe 这类符号链接会跟随到真实文件。"""
    h = hashlib.sha256()
    n = 0
    try:
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(1 << 20)
                if not chunk:
                    break
                h.update(chunk)
                n += len(chunk)
    except (FileNotFoundError, ProcessLookupError):
        return None
    except PermissionError:
        return None
    except OSError:
        return None
    return h.hexdigest(), n


def collect_hashes(pid, targets=None):
    """(c) 生成登记行：时间戳 <TAB> 路径 <TAB> sha256 <TAB> 字节数。"""
    if targets is None:
        targets = [
            "/proc/%d/exe" % pid,
            "/proc/%d/maps" % pid,
            "/etc/hostname",
        ]
    lines = []
    for t in targets:
        r = sha256_of(t)
        if r is None:
            lines.append("%s\t%s\tUNREADABLE\t0" % (_now(), t))
            continue
        digest, nbytes = r
        lines.append("%s\t%s\t%s\t%d" % (_now(), t, digest, nbytes))
    return lines


def write_out(outdir, procs_lines, maps_lines, hash_lines):
    os.makedirs(outdir, exist_ok=True)
    paths = {}
    for name, lines in (("procs.txt", procs_lines),
                        ("maps.txt", maps_lines),
                        ("hashes.txt", hash_lines)):
        p = os.path.join(outdir, name)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        paths[name] = p
    return paths


def do_list(top):
    rows, head = proc_table(top)
    print("# 进程总数(可见 /proc/*/stat): %d" % len(rows))
    print("# 按 rss_kb 降序前 %d 条" % len(head))
    print("%-8s %-24s %-6s %10s %10s" % ("PID", "COMM", "STATE", "RSS_KB", "VSIZE"))
    for r in head:
        print("%-8d %-24s %-6s %10d %10d"
              % (r["pid"], r["comm"][:24], r["state"], r["rss_kb"], r["vsize"]))
    return rows


def do_collect(pid, top, outdir, quiet=False):
    rows, head = proc_table(top)
    procs_lines = [
        "# proc_snap procs.txt  ts=%s  visible=%d  top=%d  page=%d"
        % (_now(), len(rows), top, PAGE),
        "# %-8s %-24s %-6s %10s %10s" % ("PID", "COMM", "STATE", "RSS_KB", "VSIZE"),
    ]
    for r in head:
        procs_lines.append("%-8d %-24s %-6s %10d %10d"
                           % (r["pid"], r["comm"][:24], r["state"], r["rss_kb"], r["vsize"]))

    ms = maps_stats(pid)
    maps_lines = ["# proc_snap maps.txt  ts=%s  pid=%s  page=%d" % (_now(), pid, PAGE)]
    if ms is None:
        maps_lines.append("TARGET_UNREADABLE pid=%s" % pid)
    else:
        maps_lines.append("# path=%s  segments=%d  bytes=%d"
                          % (ms["path"], ms["total"]["n"], ms["total"]["bytes"]))
        maps_lines.append("# %-8s %8s %16s" % ("CATEGORY", "SEGMENTS", "BYTES"))
        for k in ("exec", "anon", "heap", "stack", "other"):
            maps_lines.append("# %-8s %8d %16d" % (k, ms["cats"][k]["n"], ms["cats"][k]["bytes"]))

    hash_lines = ["# proc_snap hashes.txt  ts=%s  pid=%s  algo=sha256" % (_now(), pid)]
    hash_lines += collect_hashes(pid)

    paths = write_out(outdir, procs_lines, maps_lines, hash_lines)
    if not quiet:
        print("\n".join(procs_lines))
        print("")
        print("\n".join(maps_lines))
        print("")
        print("\n".join(hash_lines))
        print("")
        for k, v in sorted(paths.items()):
            print("WROTE %s" % v)
    return {"rows": rows, "maps": ms, "paths": paths, "hashes": hash_lines}


def resolve_pid(spec):
    if spec == "self":
        return os.getpid()
    if spec == "parent":
        return os.getppid()
    return int(spec)


def selftest():
    """自造子进程 -> 采集 -> 断言。全部断言真跑，不 mock。"""
    ok = True
    child = subprocess.Popen(
        [sys.executable, "-c", "import time; x=bytearray(6*1024*1024); time.sleep(20)"]
    )
    try:
        time.sleep(1.2)
        st = parse_stat(child.pid)
        assert st is not None, "SELFTEST_FAIL parse_stat returned None"
        print("ASSERT rss_kb=%d vsize=%d comm=%s -> rss>0 : %s"
              % (st["rss_kb"], st["vsize"], st["comm"], st["rss_kb"] > 0))
        if not st["rss_kb"] > 0:
            ok = False

        ms = maps_stats(child.pid)
        assert ms is not None, "SELFTEST_FAIL maps_stats returned None"
        nseg = ms["total"]["n"]
        print("ASSERT maps_segments=%d total_bytes=%d -> segments>0 : %s"
              % (nseg, ms["total"]["bytes"], nseg > 0))
        if not nseg > 0:
            ok = False
        for k in ("exec", "anon", "heap", "stack"):
            print("ASSERT   cat=%-6s segments=%-5d bytes=%d"
                  % (k, ms["cats"][k]["n"], ms["cats"][k]["bytes"]))
        if not ms["cats"]["exec"]["n"] > 0:
            print("ASSERT WARN no executable segment found for python child")
            ok = False

        lines = collect_hashes(child.pid)
        for ln in lines:
            cols = ln.split("\t")
            dig = cols[2]
            good = len(dig) == 64 and all(c in "0123456789abcdef" for c in dig)
            print("ASSERT hash_len=%d path=%s -> len==64 : %s" % (len(dig), cols[1], good))
            if not good:
                ok = False

        tr = tracer_pids()
        print("ASSERT tracer_scan_hits=%d -> %s" % (len(tr), tr if tr else "[]"))

        paths = write_out("z3out_selftest",
                          ["# selftest"], ["# selftest"], lines)
        for k, v in sorted(paths.items()):
            print("WROTE %s (%d bytes)" % (v, os.path.getsize(v)))
    finally:
        child.terminate()
        try:
            child.wait(timeout=5)
        except Exception:
            child.kill()

    print("SELFTEST %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description="Z3 procfs snapshot collector (read-only)")
    ap.add_argument("--pid", default=None, help="目标 pid，或 'self' / 'parent'")
    ap.add_argument("--outdir", default="z3out", help="产物目录，默认 ./z3out")
    ap.add_argument("--top", type=int, default=DEFAULT_TOP, help="进程列表条数，默认 20")
    ap.add_argument("--list", action="store_true", help="只打印进程列表")
    ap.add_argument("--selftest", action="store_true", help="自造子进程并断言")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    if args.list:
        do_list(args.top)
        return 0
    pid = resolve_pid(args.pid) if args.pid else os.getpid()
    do_collect(pid, args.top, args.outdir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
