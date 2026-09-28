#!/usr/bin/env python3
"""bind_core_event.py — 把 CORE_EVENT 绑到显式中心动词；未明说时取该领域在用户语言里的
普通核心动作，并补齐 角色 / 设定 / 视角 / 连续性。
用法: python3 bind_core_event.py scenes.jsonl
退出码: 0 全部绑定成功 / 4 记录缺领域（无法取默认动作）/ 1 输入错误
"""
import json, sys

# 领域 -> (普通核心动作, 可选明说动词, 中心动作类别)
VERBS = {
    "physical":   ("推动", ["推", "拉", "抬", "压"], "施力"),
    "mechanical": ("装配（对准并紧固）", ["拧紧", "校准", "启停"], "装配"),
    "biological": ("取样", ["传代", "解冻", "灭活"], "取样"),
    "narrative":  ("递出", ["接过", "开口", "逼近"], "交接"),
}
FILL = {"role_a": "ROLE_A", "role_b": "ROLE_B", "setting": "SETTING_1",
        "pov": "POV_1（第三人称限知）", "continuity": "CONT_1"}


def bind(rec):
    dom = rec.get("domain")
    if dom not in VERBS:
        return None
    default_verb, allowed, kind = VERBS[dom]
    said = rec.get("verb")
    verb = said if said else default_verb
    return {
        "CORE_EVENT": "%s 在 %s 中%s %s" % (rec.get("role_a") or FILL["role_a"],
                                            rec.get("setting") or FILL["setting"],
                                            verb, rec.get("role_b") or FILL["role_b"]),
        "CENTER_VERB": verb,
        "VERB_SOURCE": "明说" if said else "默认（该领域普通核心动作）",
        "VERB_KIND": kind,
        "ROLE_A": rec.get("role_a") or FILL["role_a"],
        "ROLE_B": rec.get("role_b") or FILL["role_b"],
        "SETTING": rec.get("setting") or FILL["setting"],
        "POV": rec.get("pov") or FILL["pov"],
        "CONTINUITY": rec.get("continuity") or FILL["continuity"],
        "STAKES": rec.get("stakes") or "STAKES_1",
    }


def render(b):
    return ("中心动词「%s」落到 CORE_EVENT：%s；视角 %s；承接 %s；张力 %s。"
            % (b["CENTER_VERB"], b["CORE_EVENT"], b["POV"], b["CONTINUITY"], b["STAKES"]))


def main(argv):
    if len(argv) < 2:
        print(__doc__); return 1
    rc = 0
    try:
        recs = [json.loads(l) for l in open(argv[1], encoding="utf-8") if l.strip()]
    except Exception as e:
        print("输入错误: %s" % e); return 1
    for rec in recs:
        b = bind(rec)
        if b is None:
            print("[%s] REFUSE: 缺领域，取不到普通核心动作，无法绑定 CORE_EVENT" % rec.get("id", "S?"))
            rc = 4
            continue
        print("[%s] CORE_EVENT=%s" % (rec.get("id", "S?"), b["CORE_EVENT"]))
        print("      CENTER_VERB=%s | VERB_SOURCE=%s | KIND=%s"
              % (b["CENTER_VERB"], b["VERB_SOURCE"], b["VERB_KIND"]))
        print("      角色 %s/%s | 设定 %s | 视角 %s | 连续性 %s"
              % (b["ROLE_A"], b["ROLE_B"], b["SETTING"], b["POV"], b["CONTINUITY"]))
        print("      " + render(b))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
