#!/usr/bin/env python3
"""concept_six_lint.py - 概念解释六件套校验器.
用法: python3 concept_six_lint.py FILE.md [FILE.md ...]
判定: 六槽齐全且各自合格 -> 整体 PASS(exit 0); 任一缺失/不合格 -> FAIL(exit 1).
"""
import re, sys, pathlib

SLOTS = [
    ("S1", "一句话定义", ("一句话定义", "定义", "是什么")),
    ("S2", "为什么存在", ("为什么存在", "为什么", "动机", "存在理由")),
    ("S3", "工作原理", ("工作原理", "原理", "机制", "如何工作")),
    ("S4", "例子", ("例子", "示例", "举例", "案例")),
    ("S5", "与相似概念区别", ("区别", "对比", "相似概念", "差异")),
    ("S6", "现实限制/误区", ("限制", "误区", "边界", "常见错误")),
]
HEAD = re.compile(r"^(#{1,6})\s*(.+?)\s*$")

def split_sections(text):
    secs, cur, buf = [], None, []
    for ln in text.splitlines():
        m = HEAD.match(ln)
        if m:
            if cur is not None:
                secs.append((cur, "\n".join(buf)))
            cur, buf = m.group(2), []
        else:
            buf.append(ln)
    if cur is not None:
        secs.append((cur, "\n".join(buf)))
    return secs

def check(text):
    rows, secs = [], split_sections(text)
    for sid, name, keys in SLOTS:
        hit = next(((h, b) for h, b in secs if any(k in h for k in keys)), None)
        if hit is None:
            rows.append((sid, name, "MISS", "-", "缺槽")); continue
        h, b = hit
        body = b.strip(); n = len(re.sub(r"\s", "", body)); why = ""
        ok = n >= 40
        if not ok: why = "正文不足(去空白 %d 字 < 40)" % n
        if sid == "S1":
            sents = [s for s in re.split(r"[。；]", body) if s.strip()]
            if len(sents) > 2: ok, why = False, "定义非单句(%d 句)" % len(sents)
            elif n > 160: ok, why = False, "定义过长(%d 字 > 160)" % n
        if sid == "S4" and not re.search(r"(\d|例如|比如|```)", body):
            ok, why = False, "例子无具体量/代码"
        if sid == "S5" and not re.search(r"([、]|vs|VS|对比|而)", body):
            ok, why = False, "区别段未点名对照物"
        if sid == "S6" and not re.search(r"(但|然而|不能|无法|并非|限制|代价)", body):
            ok, why = False, "限制段无否定/代价表述"
        rows.append((sid, name, "PASS" if ok else "FAIL", h, why))
    return rows

def main(paths):
    bad = 0
    for p in paths:
        text = pathlib.Path(p).read_text(encoding="utf-8", errors="replace")
        rows = check(text)
        miss = [r[0] for r in rows if r[2] != "PASS"]
        print("== %s ==  %s" % (p, "PASS" if not miss else "FAIL(缺/不合格: %s)" % ",".join(miss)))
        for sid, name, st, h, why in rows:
            print("  %-3s %-14s %-4s 标题「%s」%s" % (sid, name, st, h, ("  <- " + why) if why else ""))
        print()
        bad |= 1 if miss else 0
    print("总判定: %s" % ("FAIL" if bad else "PASS"))
    return bad

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
