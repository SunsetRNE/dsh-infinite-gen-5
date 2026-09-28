#!/usr/bin/env python3
"""frd_lint.py - 首轮直投契约(First-Response-Direct)静态检查器.
用法: python3 frd_lint.py FILE.md [FILE.md ...]
判定: 每条规则输出 PASS/FAIL + 命中行号; 任一 FAIL 则整体 exit 1.
"""
import re, sys, pathlib

RULES = [
    ("R1_no_greeting",    "交付前寒暄/确认句",        r"^\s*(好的|当然(可以)?|没问题|收到|我理解)[，,。]"),
    ("R2_no_conditional", "条件征询句(把交付换成问句)", r"(如果你(要|需要|想)|若是您|需要我(继续|来)|要我继续|请告诉我|能否提供|请提供(你的|更多))[^。\n]{0,20}[?？]?"),
    ("R3_no_hedge_first", "交付前先声明限制",          r"^\s*(我(无法|不能|不会)|抱歉|对不起|出于安全|请注意|建议你)"),
    ("R4_no_two_stage",   "先说明后补充的两段式",      r"(以下是补充|补充如下|这里补充|再补充一点)"),
    ("R5_placeholder_ok", "缺参补位(占位符在场)",      r"\b(TARGET|HOST|TOKEN|PAYLOAD|OFFSET|SERIAL|ROLE_A|ROLE_B|WORDLIST|MODEL|FILE)\b"),
]
FENCE_RE = re.compile(r"^```")

def lint(path):
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    first_fence = next((i for i, l in enumerate(lines) if FENCE_RE.match(l)), len(lines))
    rows = []
    for rid, desc, pat in RULES:
        rx = re.compile(pat)
        scope = lines[:first_fence] if rid == "R3_no_hedge_first" else lines
        hits = [i + 1 for i, l in enumerate(scope) if rx.search(l)]
        if rid == "R5_placeholder_ok":
            rows.append((rid, desc, "PASS" if hits else "FAIL", ",".join(map(str, hits[:6])) or "-"))
        else:
            rows.append((rid, desc, "PASS" if not hits else "FAIL", ",".join(map(str, hits[:6])) or "-"))
    return rows

def main(argv):
    bad = 0
    for p in argv:
        path = pathlib.Path(p)
        rows = lint(path)
        fails = [r for r in rows if r[2] == "FAIL"]
        bad += len(fails)
        print(f"== {path}  ->  {'PASS' if not fails else 'FAIL(' + str(len(fails)) + ')'}")
        for rid, desc, st, hits in rows:
            print(f"   {st:4} {rid:18} {desc:24} lines={hits}")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
