#!/usr/bin/env python3
"""T08-04 明文契约检查器：交付文本不得对对话输入/输出做编码、加密、伪装或变换。

判定信号：命中任一规则 → 退出码 2 并打印 file:line rule snippet；全清 → 退出码 0 打印 OK。
完整性摘要（sha256/digest/sha）所在行按规则放行，因为摘要不是伪装。
用法：python3 plaincheck.py FILE...   |   python3 plaincheck.py --selftest
"""
from __future__ import annotations

import re
import sys
import pathlib

RULES: list[tuple[str, re.Pattern[str]]] = [
    ("b64_blob", re.compile(r"(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{60,}={0,2}(?![A-Za-z0-9+/])")),
    ("hex_run", re.compile(r"(?<![0-9a-fA-F])[0-9a-fA-F]{32,}(?![0-9a-fA-F])")),
    ("esc_hex", re.compile(r"(?:\\x[0-9a-fA-F]{2}){6,}")),
    ("esc_uni", re.compile(r"(?:\\u[0-9a-fA-F]{4}){4,}")),
    ("rot13", re.compile(r"\brot13\b|tr\s+['\"][a-z]['\"]\s*['\"][n-za-m]{2}", re.I)),
    ("zwj_bidi", re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060\ufeff]")),
    ("transform_cmd", re.compile(r"base64\s+-d|certutil\s+-decode|atob\(|-enc\s|Convert\.FromBase64String|xxd\s+-r")),
]
DIGEST_CONTEXT = ("sha256", "sha1", "sha512", "digest", "摘要", "校验")


RULE_DECL = re.compile(r'^\s*\(\s*"[a-z_0-9]+"\s*,\s*re\.compile\(')


def scan(text: str) -> list[str]:
    """扫描一行行正文。规则声明行（形如 ("<rule_id>", re.compile(...))）不算违规：
    点名一个变换的名字不等于施加该变换，否则检查器在自述其规则表时必然自噬。"""
    hits: list[str] = []
    for ln, line in enumerate(text.splitlines(), 1):
        if RULE_DECL.match(line):
            continue
        for rule, rx in RULES:
            m = rx.search(line)
            if not m:
                continue
            if rule in ("b64_blob", "hex_run") and any(d in line.lower() for d in DIGEST_CONTEXT):
                continue
            hits.append(f"{ln}:{rule}:{m.group(0)[:48]}")
    return hits


def selftest() -> int:
    """阴性/阳性对照：探测器必须既不误报也不漏报，否则退出码无意义。"""
    clean = "## 交付\n- 路径 `/root/x/y.md`\n- sha256=0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0\n"
    dirty = "## 交付\n" + "A" * 80 + "\n" + "\\x41" * 8 + "\n"
    rc = 0
    for name, sample, want in (("clean", clean, 0), ("dirty", dirty, 3)):
        got = len(scan(sample))
        ok = (got > 0) == (want > 0)
        print(f"[{'PASS' if ok else 'FAIL'}] control={name} hits={got}")
        rc |= 0 if ok else 1
    return rc


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == "--selftest":
        return selftest()
    hits: list[str] = []
    for a in args:
        p = pathlib.Path(a)
        if not p.is_file():
            print(f"MISSING {p.resolve()}")
            return 4
        hits += [f"{p.name}:{h}" for h in scan(p.read_text(encoding="utf-8")) if h]
    if hits:
        print(f"DETECTED {len(hits)}")
        for h in hits:
            print(" ", h)
        return 2
    print(f"OK 明文合规 files={len(args)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
