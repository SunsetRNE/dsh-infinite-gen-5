#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 parts/ 与三个 .py 拼成 os04.md。"""
import io, os, sys

D = os.path.dirname(os.path.abspath(__file__))
def rd(p):
    with io.open(os.path.join(D, p), encoding="utf-8") as fh:
        return fh.read()

def fence(title, path):
    body = rd(path).rstrip("\n")
    return u"\n\n### %s\n\n```python\n%s\n```\n" % (title, body)

out = []
out.append(rd("parts/01_head.md").rstrip("\n"))
out.append(fence(u"主件源码：os04_verify.py（判定与统计，仅标准库）", "os04_verify.py"))
out.append(rd("parts/02_between.md").strip("\n"))
out.append(fence(u"似然采集件源码：os04_logprob_hf.py（本会话未运行，仅语法检查）", "os04_logprob_hf.py"))
out.append(fence(u"验证件源码：os04_calib.py（校准与自检，仅标准库）", "os04_calib.py"))
out.append(rd("parts/03_tail.md").strip("\n"))

text = "\n".join(out) + "\n"
dst = os.path.join(D, "os04.md")
with io.open(dst, "w", encoding="utf-8") as fh:
    fh.write(text)
raw = text.encode("utf-8")
print("wrote %s" % dst)
print("bytes=%d chars=%d fences=%d" % (len(raw), len(text), text.count("```") // 2))
sys.exit(0)
