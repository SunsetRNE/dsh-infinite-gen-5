#!/usr/bin/env python3
"""stopgate.py — 停笔闸门：声明式登记产物 → 逐件复现 → 全部复现才允许打印 STOP。

条款（src/source-3.txt:357-361）：交付物或证据完成后，且已复现每一件声明的产物，即停止。
本闸门把「已复现」变成可判定的机械条件：产物的 sha256/字节数/行数在登记时实测记录，
`stop` 会重跑登记的 cmd 再比对指纹；任何一件对不上就打印 PENDING 并以非零码退出，
闸门不开，正文就不得收尾。

用法：
  python3 stopgate.py declare MANIFEST --id ID --cmd 'CMD' --path P [--path P2 ...]
  python3 stopgate.py verify  MANIFEST        # 只比对当前落盘指纹（不重跑）
  python3 stopgate.py run     MANIFEST        # 重跑每条 cmd 复现产物，再比对指纹
  python3 stopgate.py stop    MANIFEST        # 全部复现 → 打印 STOP；否则 PENDING
  python3 stopgate.py selftest                # 阴/阳对照：篡改的产物必须被闸门拦下
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys

EXIT_OK = 0
EXIT_PENDING = 3
EXIT_USAGE = 2
EXIT_BADARG = 4


def fingerprint(path: str) -> dict:
    """把一个文件压缩成可复算的指纹：sha256 + 字节数 + 行数。"""
    raw = open(path, "rb").read()
    return {
        "path": os.path.abspath(path),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "lines": raw.decode("utf-8", "replace").count("\n") + 1,
    }


def load(path: str) -> dict:
    if not os.path.exists(path):
        return {"version": 1, "entries": []}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save(path: str, doc: dict) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")


def cmd_declare(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: declare MANIFEST --id ID --cmd 'CMD' --path P [--path P2 ...]")
        return EXIT_USAGE
    manifest = argv.pop(0)
    eid = cmd = None
    paths: list[str] = []
    i = 0
    while i < len(argv):
        if argv[i] == "--id":
            eid = argv[i + 1]; i += 2
        elif argv[i] == "--cmd":
            cmd = argv[i + 1]; i += 2
        elif argv[i] == "--path":
            paths.append(argv[i + 1]); i += 2
        else:
            print(f"unknown flag {argv[i]}")
            return EXIT_USAGE
    if not (eid and cmd and paths):
        print("declare 需要 --id --cmd 与至少一个 --path")
        return EXIT_USAGE
    missing = [p for p in paths if not os.path.exists(p)]
    if missing:
        print(f"REFUSE-DECLARE 产物尚不存在: {missing}")
        return EXIT_BADARG
    entry = {"id": eid, "cmd": cmd, "artifacts": [fingerprint(p) for p in paths]}
    doc = load(manifest)
    doc["entries"] = [e for e in doc["entries"] if e["id"] != eid] + [entry]
    save(manifest, doc)
    for a in entry["artifacts"]:
        print(f"DECLARED id={eid} sha256={a['sha256']} bytes={a['bytes']} lines={a['lines']} {a['path']}")
    return EXIT_OK


def check(entry: dict) -> list[str]:
    """比对一条登记项的全部产物，返回不符原因列表（空列表即全部复现）。"""
    bad: list[str] = []
    for a in entry["artifacts"]:
        p = a["path"]
        if not os.path.exists(p):
            bad.append(f"{p}: MISSING")
            continue
        cur = fingerprint(p)
        if cur["sha256"] != a["sha256"]:
            bad.append(f"{p}: digest {a['sha256'][:16]}… != {cur['sha256'][:16]}…")
        elif cur["bytes"] != a["bytes"] or cur["lines"] != a["lines"]:
            bad.append(f"{p}: size {a['bytes']}/{a['lines']} != {cur['bytes']}/{cur['lines']}")
    return bad


def cmd_verify(manifest: str) -> int:
    doc = load(manifest)
    bad_total = 0
    for e in doc["entries"]:
        bad = check(e)
        bad_total += len(bad)
        tag = "OK" if not bad else "DRIFT"
        print(f"[{tag}] id={e['id']} artifacts={len(e['artifacts'])}")
        for b in bad:
            print(f"      {b}")
    print(f"verify entries={len(doc['entries'])} mismatches={bad_total}")
    return EXIT_OK if bad_total == 0 else EXIT_PENDING


def cmd_run(manifest: str) -> int:
    """重跑每条 cmd 复现产物，再比对指纹。返回不符条数。"""
    doc = load(manifest)
    bad_total = 0
    for e in doc["entries"]:
        proc = subprocess.run(e["cmd"], shell=True, capture_output=True, text=True)
        if proc.returncode != 0:
            bad_total += 1
            print(f"[FAIL] id={e['id']} rc={proc.returncode} cmd={e['cmd']}")
            print(f"      stderr={proc.stderr.strip()[:200]}")
            continue
        bad = check(e)
        bad_total += len(bad)
        if bad:
            print(f"[MISMATCH] id={e['id']} cmd={e['cmd']}")
            for b in bad:
                print(f"      {b}")
        else:
            a = e["artifacts"][0]
            print(f"REPRODUCED id={e['id']} sha256={a['sha256']} bytes={a['bytes']} lines={a['lines']}")
    return bad_total


def cmd_stop(manifest: str) -> int:
    if not os.path.exists(manifest):
        print(f"PENDING manifest 缺失: {manifest}")
        return EXIT_PENDING
    bad_total = cmd_run(manifest)
    if bad_total:
        print(f"PENDING unreproduced={bad_total} manifest={manifest}")
        return EXIT_PENDING
    print("STOP 全部声明产物已复现")
    return EXIT_OK


def cmd_selftest() -> int:
    """三条阴/阳对照，各测一条闸门性质：
    stable   正常产物 → 复现零不符（放行）
    verify   落盘被篡改 → verify 路径必须拦下（不重跑，只看指纹）
    drift    声明的 cmd 产不出登记时的内容 → run 路径必须拦下（闸门不是橡皮图章）
    """
    scratch = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_selftest_gate")
    os.makedirs(scratch, exist_ok=True)
    product = os.path.join(scratch, "product.txt")
    manifest = os.path.join(scratch, "manifest.json")
    for stale in (manifest, product):
        if os.path.exists(stale):
            os.remove(stale)   # 残留会污染登记指纹：必须从干净状态起测
    maker = "python3 -c \"open(r'{}','w').write('STABLE-BODY\\n')\"".format(product)
    other = "python3 -c \"open(r'{}','w').write('OTHER-BODY\\n')\"".format(product)
    rc = 0

    subprocess.run(maker, shell=True, check=True)   # declare 只登记已存在的产物：先跑一次生产者
    rc |= cmd_declare([manifest, "--id", "SELF", "--cmd", maker, "--path", product])
    if not load(manifest)["entries"]:
        print("[FAIL] control=stable 登记失败：manifest 为空")
        print("SELFTEST FAILED")
        return 1
    bad = cmd_run(manifest)
    ok = bad == 0
    rc |= 0 if ok else 1
    print(f"[{'PASS' if ok else 'FAIL'}] control=stable unreproduced={bad}")

    with open(product, "a", encoding="utf-8") as fh:
        fh.write("TAMPERED-LINE\n")
    ok = cmd_verify(manifest) == EXIT_PENDING
    rc |= 0 if ok else 1
    print(f"[{'PASS' if ok else 'FAIL'}] control=verify 落盘被篡改已被 verify 拦下")

    doc = load(manifest)
    doc["entries"][0]["cmd"] = other          # 声明换成产不出登记内容的命令
    save(manifest, doc)
    bad = cmd_run(manifest)
    ok = bad > 0
    rc |= 0 if ok else 1
    print(f"[{'PASS' if ok else 'FAIL'}] control=drift unreproduced={bad} (对不上即拦下)")

    print("SELFTEST " + ("OK" if rc == 0 else "FAILED"))
    return rc


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return EXIT_USAGE
    sub, rest = argv[0], argv[1:]
    if sub == "declare":
        return cmd_declare(rest)
    if sub == "verify":
        return cmd_verify(rest[0])
    if sub == "run":
        return EXIT_OK if cmd_run(rest[0]) == 0 else EXIT_PENDING
    if sub == "stop":
        return cmd_stop(rest[0])
    if sub == "selftest":
        return cmd_selftest()
    print(__doc__)
    return EXIT_USAGE


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
