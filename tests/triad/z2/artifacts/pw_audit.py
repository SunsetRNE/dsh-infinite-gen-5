#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pw_audit.py — Z2 身份与凭据面 · 弱口令离线比对器（本地只读，不联网）。

比对对象：/etc/shadow（或 --shadow 指定文件）中「带真实哈希」的条目。
候选词表：内置 8 个自造弱口令占位串（admin123 / TARGET2026 / ...），
          只用于验证本机是否存在这类弱口令，不涉及任何外部目标。

写死的边界，代码里可核：
  * 只读本地文件；不写回 /etc/shadow，不改动任何账户。
  * 不导入 socket / urllib / requests / paramiko —— 全程无网络行为。
  * 不做远程登录、不爆破外部主机。

用法：
  python3 pw_audit.py --selftest              # 自检：一次通过 + 一次不通过 + 端到端
  python3 pw_audit.py                         # 扫本机 /etc/shadow
  python3 pw_audit.py --shadow /path/shadow   # 扫指定文件
  python3 pw_audit.py --json                  # 机器可读输出
退出码：0 无命中 / 1 有命中 / 2 后端不支持 / 3 自检失败
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile

CANDIDATES = (
    "admin123", "TARGET2026", "P@ssw0rd", "root123",
    "123456", "password", "changeme", "TARGET",
)

SELFTEST_PW = "admin123"
SELFTEST_SALT = "$6$Z2SELFTEST.SALT$"
# 常量：$6$ sha512crypt 已知答案测试（KAT）基准摘要，由本会话实测填充
GOLDEN_SHA256_KAT = "98f2060eacb3817ebfe4190391b800a7fcc62b03fcc6ca76ff9fe339023796f0"
ALGO_TABLE = {
    "1": "md5crypt", "2a": "bcrypt", "2b": "bcrypt", "2y": "bcrypt",
    "5": "sha256crypt", "6": "sha512crypt", "y": "yescrypt",
    "gy": "gost-yescrypt", "7": "scrypt",
}


def _load_backend():
    """三级取用 crypt：stdlib → ctypes 直连 libcrypt → 明确降级。"""
    try:
        import crypt as _stdlib  # noqa: F401  (3.12 起 DeprecationWarning)
        return _stdlib.crypt, "python-stdlib-crypt"
    except Exception:
        pass
    try:
        import ctypes
        import ctypes.util
        name = ctypes.util.find_library("crypt") or "libcrypt.so.1"
        lib = ctypes.CDLL(name, use_errno=True)
        lib.crypt.restype = ctypes.c_char_p
        lib.crypt.argtypes = [ctypes.c_char_p, ctypes.c_char_p]

        def _fn(pw, salt):
            out = lib.crypt(pw.encode(), salt.encode())
            return out.decode() if out else None

        return _fn, "ctypes-" + name
    except Exception as exc:               # 无 crypt 时明确报降级，不猜
        return None, "unsupported: %s" % exc


CRYPT, BACKEND = _load_backend()


def algo_of(h):
    if h.startswith("$"):
        tag = h.split("$")[1] if len(h.split("$")) > 1 else "?"
        return ALGO_TABLE.get(tag, "unknown-$" + tag)
    return "plain-or-legacy"


def salt_of(h):
    p = h.split("$")
    return "$".join(p[:3]) + "$" if len(p) > 3 else h


def verify(pw, h):
    """True 命中 / False 不命中 / None 后端不支持该算法（不猜）。"""
    if CRYPT is None or not h.startswith("$"):
        return None
    got = CRYPT(pw, salt_of(h))
    if got is None or got in ("*0", "*1"):
        return None
    return got == h


def audit(path):
    rows, weak, hashed, unsupported = [], 0, 0, 0
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            f = line.rstrip("\n").split(":")
            if len(f) < 2 or not f[0]:
                continue
            user, h = f[0], f[1]
            if h == "" or h in ("*", "!") or h.startswith("!"):
                rows.append((user, "locked/nologin", "skip"))
                continue
            if not h.startswith("$"):
                rows.append((user, "unhashed:" + h[:1], "skip"))
                continue
            hashed += 1
            algo, hit, unknown = algo_of(h), None, False
            for cand in CANDIDATES:
                res = verify(cand, h)
                if res is None:
                    unknown = True
                    break
                if res:
                    hit = cand
                    break
            if unknown:
                unsupported += 1
                rows.append((user, algo, "unsupported-by-backend"))
            elif hit:
                weak += 1
                rows.append((user, algo, "WEAK-HIT:" + hit))
            else:
                rows.append((user, algo, "no-match"))
    return rows, weak, hashed, unsupported


def selftest():
    ok = True
    print("backend   = %s" % BACKEND)
    if CRYPT is None:
        print("SELFTEST FAIL: 取不到 crypt 后端")
        return 3
    h = CRYPT(SELFTEST_PW, SELFTEST_SALT)
    if not h or not h.startswith("$6$"):
        print("SELFTEST FAIL: crypt 未回 $6$ 哈希")
        return 3
    digest = hashlib.sha256(h.encode()).hexdigest()
    if GOLDEN_SHA256_KAT == "__MEASURE__":
        print("KAT-BOOTSTRAP sha256=%s" % digest)
    else:
        kat = (digest == GOLDEN_SHA256_KAT)
        ok &= kat
        print("KAT      %s  algo=%s len=%d sha256=%s"
              % ("PASS" if kat else "FAIL", algo_of(h), len(h), digest[:16] + "…"))
    p = verify(SELFTEST_PW, h)
    ok &= (p is True)
    print("[1] 通过用例 verify(%r, $6$...) = %s  -> %s"
          % (SELFTEST_PW, p, "PASS" if p is True else "FAIL"))
    q = verify(SELFTEST_PW + "_WRONG", h)
    ok &= (q is False)
    print("[2] 否定用例 verify(%r, $6$...) = %s -> %s"
          % (SELFTEST_PW + "_WRONG", q, "PASS" if q is False else "FAIL"))
    with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as tf:
        tf.write("z2demo:%s:20000:0:99999:7:::\n" % h)
        tf.write("z2locked:*:20000:0:99999:7:::\n")
        tf.write("z2nopw::20000:0:99999:7:::\n")
        fixture = tf.name
    try:
        rows, weak, hashed, unsup = audit(fixture)
    finally:
        os.unlink(fixture)
    e2e = (weak == 1 and hashed == 1 and unsup == 0)
    ok &= e2e
    print("[3] 端到端 fixture: hashed=%d weak_hits=%d unsupported=%d -> %s"
          % (hashed, weak, unsup, "PASS" if e2e else "FAIL"))
    for r in rows:
        print("      %-10s %-18s %s" % r)
    print("SELFTEST %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 3


def main(argv=None):
    ap = argparse.ArgumentParser(description="离线弱口令比对（只读本机 shadow）")
    ap.add_argument("--shadow", default="/etc/shadow", help="shadow 文件路径")
    ap.add_argument("--selftest", action="store_true", help="跑已知答案自检")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    args = ap.parse_args(argv)

    if args.selftest:
        return selftest()

    if not os.path.exists(args.shadow):
        print("ERROR: %s 不存在" % args.shadow, file=sys.stderr)
        return 2
    if CRYPT is None:
        print("ERROR: 无 crypt 后端 -> %s" % BACKEND, file=sys.stderr)
        return 2

    rows, weak, hashed, unsup = audit(args.shadow)
    if args.json:
        print(json.dumps({
            "shadow": args.shadow, "backend": BACKEND,
            "candidates": len(CANDIDATES), "hashed_entries": hashed,
            "weak_hits": weak, "unsupported": unsup,
            "rows": [{"user": u, "algo": a, "verdict": v} for u, a, v in rows],
        }, ensure_ascii=False, indent=2))
    else:
        print("backend            = %s" % BACKEND)
        print("shadow             = %s" % args.shadow)
        print("candidates         = %d" % len(CANDIDATES))
        print("hashed_entries     = %d" % hashed)
        print("weak_hits          = %d" % weak)
        print("skipped_unsupported = %d" % unsup)
        print("-" * 58)
        print("%-12s %-20s %s" % ("ACCOUNT", "ALGO", "VERDICT"))
        for u, a, v in rows:
            print("%-12s %-20s %s" % (u, a, v))
    return 1 if weak else 0


if __name__ == "__main__":
    sys.exit(main())
