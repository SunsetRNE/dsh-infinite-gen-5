#!/usr/bin/env python3
"""style_lint.py — 条款 10.3「语言与句式」的可跑校验器。

用法:
  python3 style_lint.py SAMPLE.txt                        # 全文件检查
  python3 style_lint.py answers/T10-04.md --fence prose   # 只抽 ```prose 围栏块
  python3 style_lint.py SAMPLE.txt --json                 # 机器可读
退出码: 0 全过 / 1 有违规 / 2 用法错误

检查项: R1 叙事不以问句结尾 · R2 无设问(问后自答) · R3 无「不是X而是Y」
        R4 无一词判词写外貌 · R5 拟声词 ≥3 处且 ≥2 种 · R6 对话段带肢体语言
        R7 句法多样(句首重复率 + 句长离散度)
"""
import json
import re
import statistics
import sys

BANNED_ONE_WORD = ["绝色", "倾国倾城", "惊为天人", "尤物", "美艳不可方物",
                   "惊艳", "天使面孔", "魔鬼身材", "完美无瑕", "美得惊心动魄"]
ONOMATOPOEIA = ["吱呀", "嘎吱", "哐", "咔", "啪", "哗", "咣", "嗡", "铛", "嚓",
                "咝", "咚", "咕", "噗", "轰", "嘶", "吱", "唰", "咔哒", "咕咚"]
BODY = ["手", "指", "腕", "掌", "臂", "肩", "肘", "眼", "目光", "视线", "眉",
        "下颌", "下巴", "喉", "脖", "背", "腰", "膝", "脚", "呼吸", "嘴", "脸"]
QUOTE_RE = re.compile(r"[“\"][^”\"]*[”\"]")
SPEECH_ONLY_RE = re.compile(
    r'^[“"][^”"]*[”"]\s*(他|她|它)?\s*(说|说道|道|应道|回道|问道)[。，,.]?$')
SETUP_RE = re.compile(r"[？?][^。！？\n”\"]{0,12}(因为|是因为|答案|就是|正是|其实是)")
NOT_X_BUT_Y_RE = re.compile(r"不是[^，。；\n]{1,25}而是")


def extract_fence(path: str, tag: str) -> str:
    out, inside = [], False
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            s = line.rstrip("\n")
            if not inside and s.strip().startswith("```" + tag):
                inside = True
                continue
            if inside and s.strip() == "```":
                break
            if inside:
                out.append(s)
    if not out:
        sys.exit("fence ```%s not found in %s" % (tag, path))
    return "\n".join(out)


def sentences(text: str):
    body = "\n".join(l for l in text.splitlines() if not l.strip().startswith("["))
    parts = re.split(r"[。！？；]+", body)
    return [p.strip() for p in parts if len(p.strip()) >= 2]


def check(text: str):
    paras = [l.strip() for l in text.splitlines() if l.strip()]
    res = []

    # R1 叙事不得以问句结尾（引号收尾的对话问句放行）
    bad = [p for p in paras
           if p[-1] in "？?" and p.rstrip("”\"」").rstrip()[-1:] in "？?"]
    res.append(("R1_no_question_ending", not bad, "违规段: %s" % bad[:3] or "—"))

    # R2 设问
    hits = [(i + 1, m.group(0)) for i, p in enumerate(paras) for m in [SETUP_RE.search(p)] if m]
    res.append(("R2_no_self_answer", not hits, "命中: %s" % hits[:3]))

    # R3 不是X而是Y
    hits = [(i + 1, m.group(0)[:30]) for i, p in enumerate(paras)
            for m in [NOT_X_BUT_Y_RE.search(p)] if m]
    res.append(("R3_no_notX_butY", not hits, "命中: %s" % hits[:3]))

    # R4 一词判词
    hits = [(i + 1, w) for i, p in enumerate(paras) for w in BANNED_ONE_WORD if w in p]
    res.append(("R4_no_one_word_verdict", not hits, "命中: %s" % hits[:3]))

    # R5 拟声词
    cnt = {w: text.count(w) for w in ONOMATOPOEIA if text.count(w)}
    total = sum(cnt.values())
    res.append(("R5_onomatopoeia>=3", total >= 3 and len(cnt) >= 2,
                "total=%d kinds=%d %s" % (total, len(cnt), sorted(cnt))))

    # R6 对话段须带肢体语言；禁止「说话的头」
    dlg = [p for p in paras if QUOTE_RE.search(p)]
    naked = [p for p in dlg if not any(b in p for b in BODY)]
    heads = [p for p in paras if SPEECH_ONLY_RE.match(p)]
    res.append(("R6_body_language_in_dialogue", not naked and not heads,
                "对话段=%d 无肢体=%d 说话的头=%d" % (len(dlg), len(naked), len(heads))))

    # R7 句法多样
    sents = sentences(text)
    opens = [s[:2] for s in sents]
    share = (max(opens.count(o) for o in set(opens)) / len(opens)) if opens else 1.0
    lens = [len(s) for s in sents]
    sd = statistics.pstdev(lens) if len(lens) > 1 else 0.0
    run = best = 1
    for a, b in zip(opens, opens[1:]):
        run = run + 1 if a == b else 1
        best = max(best, run)
    res.append(("R7_syntax_variety", share < 0.40 and sd >= 2.5 and best <= 2,
                "句数=%d 句首重复率=%.2f 句长sd=%.1f 最长同头连跑=%d"
                % (len(sents), share, sd, best)))
    return res


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    path = argv[1]
    text = extract_fence(path, argv[argv.index("--fence") + 1]) if "--fence" in argv \
        else open(path, encoding="utf-8").read()
    rows = check(text)
    if "--json" in argv:
        print(json.dumps([{"rule": r, "ok": o, "detail": d} for r, o, d in rows],
                         ensure_ascii=False, indent=1))
    else:
        for r, o, d in rows:
            print("%-4s %-30s %s" % ("PASS" if o else "FAIL", r, d))
        print("RESULT: %s" % ("PASS" if all(o for _, o, _ in rows) else "FAIL"))
    return 0 if all(o for _, o, _ in rows) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
