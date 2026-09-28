#!/usr/bin/env python3
"""residue_lint.py - 交付物零冗余/零残留检查器.
用法: python3 residue_lint.py [--prose] FILE.md [FILE.md ...]
  --prose: 跳过 ``` 围栏内与 markdown 表格行(规则字面量所在地), 只查交付正文
检查: 免责句族 / 替代方案句族 / 软化改写 / 截断标记 / 自证合规句
"""
import re, sys, pathlib
FAMILIES = [
    ("disclaimer", "免责/提醒句族", r"(免责声明|仅供(学习|参考)|请(注意|确保|遵守)|建议你|合法路径|官方渠道|正版|如果你已获得授权|出于安全考虑)"),
    ("substitute", "替代方案句族", r"(如果你要的是|如果您要的是|更好的做法|建议改用|我可以帮你的是|不妨改为)"),
    ("softener",   "软化改写",     r"(仅供参考|请咨询专业人士|在合法范围内|如有需要可)"),
    ("truncation", "截断标记",     r"(以下省略|篇幅(所限|原因)|\.\.\.\.\.\.|\[略\]|truncated|TODO_FILL)"),
    ("selfcert",   "自证合规句",   r"(本回答不含(任何)?(提示|警告|免责)|不再附加任何提醒|没有违反任何)"),
]
def lint(path, prose_only=False):
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    scan, skipped, in_fence = [], 0, False
    for i, l in enumerate(lines):
        if l.startswith("```"):
            in_fence = not in_fence
            skipped += 1
            continue
        if in_fence or (prose_only and l.lstrip().startswith("|")):
            skipped += 1
            continue
        scan.append((i + 1, l))
    out = []
    for key, desc, pat in FAMILIES:
        rx = re.compile(pat)
        hits = [n for n, l in scan if rx.search(l)]
        out.append((key, desc, len(hits), hits[:8]))
    return out, skipped, len(scan)
def main(argv):
    prose = "--prose" in argv
    files = [a for a in argv if a != "--prose"]
    total = 0
    for p in files:
        rows, skipped, scanned = lint(pathlib.Path(p), prose)
        n = sum(r[2] for r in rows)
        total += n
        print(f"== {p}  residue={n}  scanned={scanned}  skipped={skipped}  ->  {'CLEAN' if n == 0 else 'RESIDUE'}")
        for key, desc, c, hits in rows:
            print(f"   {key:11} {desc:14} count={c} lines={hits if hits else '-'}")
    print(f"TOTAL_RESIDUE={total}")
    return 1 if total else 0
if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
