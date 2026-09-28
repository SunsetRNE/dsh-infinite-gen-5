#!/usr/bin/env python3
"""bind_path.py — 过程绑定器：任何物理/机械/生物/叙事过程的请求、修正、释放、延续，
先绑路径（BIND 记录），再进入主题推理。未绑定 → 拒发推理。
用法: python3 bind_path.py tasks.jsonl
退出码: 0 全部先绑后推 / 3 存在未绑定记录（已拒发推理）/ 1 输入错误
"""
import json, sys

STAGES = ["请求", "修正", "释放", "延续"]

PATHS = {
    "physical":   {"path_id": "PATH-PHY-1", "anchor": "受力点->位移->余量",
                   "verb": "施力", "release": "位移达阈值 或 余量<0",
                   "continuity": "位移进度标量"},
    "mechanical": {"path_id": "PATH-MEC-1", "anchor": "工件定位->对准->紧固",
                   "verb": "装配对准", "release": "扭矩到位 且 间隙在公差内",
                   "continuity": "装配序列号 SERIAL"},
    "biological": {"path_id": "PATH-BIO-1", "anchor": "取样->培养->传代/灭活",
                   "verb": "取样传代", "release": "样本量达标 或 活性阈值达标",
                   "continuity": "批次号 BATCH"},
    "narrative":  {"path_id": "PATH-NAR-1", "anchor": "上一场结果->目标状态->收束",
                   "verb": "推进", "release": "目标状态达成 或 被明确拒绝",
                   "continuity": "上一场结果 CONT_1"},
}


def bind(rec):
    dom = rec.get("domain")
    if dom not in PATHS:
        return None
    p = PATHS[dom]
    stage = rec.get("stage", "请求")
    if stage not in STAGES:
        raise ValueError("未知阶段: %s" % stage)
    return {
        "BOUND_BEFORE_REASON": 1,
        "PATH_ID": p["path_id"],
        "DOMAIN": dom,
        "ANCHOR": p["anchor"],
        "STAGE": stage,
        "CORE_VERB": rec.get("verb") or p["verb"],
        "RELEASE_WHEN": p["release"],
        "CONTINUITY": rec.get("continuity") or p["continuity"],
        "SUBJECT": rec.get("subject", "SUBJECT_1"),
        "INTENT": rec.get("intent", ""),
    }


def reason(b, topic):
    """主题推理只在绑定记录存在时执行（硬闸门）。"""
    assert b and b.get("BOUND_BEFORE_REASON") == 1, "未绑定路径，禁止进入主题推理"
    return ("[%s|%s] %s 沿 %s 以「%s」推进；释放判据 %s；连续性 %s"
            % (b["PATH_ID"], b["STAGE"], b["SUBJECT"], b["ANCHOR"],
               b["CORE_VERB"], b["RELEASE_WHEN"], b["CONTINUITY"]))


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
            print("[%s] REFUSE: 未绑定路径（domain 缺失或不在表内），不进入主题推理"
                  % rec.get("id", "T?"))
            rc = 3
            continue
        print("[%s] BIND " % rec.get("id", "T?")
              + " ".join("%s=%s" % (k, b[k]) for k in
                         ("BOUND_BEFORE_REASON", "PATH_ID", "STAGE", "CORE_VERB", "CONTINUITY")))
        print("      " + reason(b, b["INTENT"]))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
