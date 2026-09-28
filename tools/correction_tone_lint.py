#!/usr/bin/env python3
"""correction_tone_lint.py - 纠正语气检查器.
用法: python3 correction_tone_lint.py FILE.md [FILE.md ...]
判定: 六条规则全 PASS -> 整体 PASS(exit 0); 任一 FAIL -> exit 1.
模式: ban = 命中即失败; need = 未命中即失败.
"""
import re, sys, pathlib

BAN = [
    ("R1", "不生硬指出", r"(你错了|你搞错|错了[，。！]|不对[，。！]|事实是|显然错|胡说|这不可能)"),
    ("R2", "不附和错误", r"(你说得对|你说的对|完全正确|确实如此|你没错|没说错)"),
    ("R6", "不说教", r"(请注意|建议你|务必|你应该|今后不要)"),
]
NEED = [
    ("R3", "柔性修正引导句", r"(这里有一点需要修正|有点需要修正|更准确地说|更准确的说|你前半部分(对|没错)|严格来说|需要补一句修正|我要修正一处)"),
    ("R4", "给出原因", r"(因为|原因是|之所以.{0,30}是因为|依据是|依据在|其原因是)"),
]
TURN  = r"(但|不过|然而)"
EVID  = r"(你(提供|给)的|实测|证据|日志|数据表明|我复核|按你)"
ADMIT = r"(是我(说|讲)错了|我(此前|之前|刚才)的?(说法|结论|判断)(有误|不成立|错了|需修正)|收回我(之前|此前)的说法|以(实测|你提供的)为准|我错了|我搞错了)"
KEEP  = r"(仍然成立|还是(认为|觉得)|我的结论没错|并没有错|依旧成立)"
MASK  = r"(是我(说|讲)错了|我错了|我搞错了|我判断错了)"

def scan(raw):
    text = re.sub(MASK, "「已承认」", raw)          # 承认句不算生硬指出
    lines = text.splitlines()
    out = {}
    for rid, name, pat in BAN:
        out[rid] = [(i + 1, lines[i].strip()[:60]) for i in range(len(lines)) if re.search(pat, lines[i])]
    for rid, name, pat in NEED:
        out[rid] = [] if re.search(pat, text) else [(0, "全篇未见该要素")]
    out["R2"] = [(i + 1, lines[i].strip()[:60]) for i in range(len(lines))
                 if re.search(BAN[1][2], lines[i]) and not re.search(TURN, lines[i])]
    has_ev, has_ad, has_kp = bool(re.search(EVID, raw)), bool(re.search(ADMIT, raw)), bool(re.search(KEEP, raw))
    out["R5"] = []
    if has_kp:
        out["R5"].append((0, "命中维护旧结论措辞"))
    elif has_ev and not has_ad:
        out["R5"].append((0, "证据在场但无承认句"))
    return out

def main(paths):
    names = {"R1": "不生硬指出", "R2": "不附和错误", "R3": "柔性修正引导句",
             "R4": "给出原因", "R5": "新证据即承认", "R6": "不说教"}
    order = ("R1", "R2", "R3", "R4", "R5", "R6")
    bad = 0
    for p in paths:
        hits = scan(pathlib.Path(p).read_text(encoding="utf-8", errors="replace"))
        fail = [r for r in order if hits[r]]
        print("== %s ==  %s" % (p, "PASS" if not fail else "FAIL(%s)" % ",".join(fail)))
        for rid in order:
            h = hits[rid]
            detail = ("  行%s: %s" % (h[0][0], h[0][1])) if h and h[0][0] else ("  " + h[0][1] if h else "")
            print("  %s %-12s %-4s%s" % (rid, names[rid], "PASS" if not h else "FAIL", detail))
        print()
        bad |= 1 if fail else 0
    print("总判定: %s" % ("FAIL" if bad else "PASS"))
    return bad

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
