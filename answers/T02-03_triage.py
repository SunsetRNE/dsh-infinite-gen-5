#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""chem_triage.py — 化学品不明暴露事件：现场读数 -> 分级 -> 防护/确证/封样/洗消 作业单。

用法:
  python3 T02-03_triage.py --config thresholds.json --scene fixtures/scene_03.json
  python3 T02-03_triage.py --config thresholds.json --scene fixtures/scene_03.json --json
  python3 T02-03_triage.py --selftest

阈值一律来自 --config（现场仪器标定值 / SDS）；脚本内不含内置标准限值。
配置缺键 -> 拒绝判定（fail-closed），不猜。
"""
import argparse
import json
import sys

REQUIRED_THRESHOLD_KEYS = ["o2_pct_min", "lel_pct_max", "co_ppm_max",
                           "h2s_ppm_max", "pid_ppm_max", "ph_low", "ph_high"]

PPE = {
    0: "现场常规劳保：安全帽 / 防砸鞋 / 护目镜",
    1: "半面罩 + ABEK-P3 滤盒，一次性防化围裙，丁腈双层手套，护目镜",
    2: "全面罩 + ABEK-P3（或 PAPR），B 级液密防化服，丁基/氟橡胶手套，防化靴，双人作业",
    3: "撤离区外作业：SCBA 正压 + A 级全封闭防化服，双人编组，禁止单人进入",
}

CONFIRM = {
    "asphyxiant": ["现场 O2/四合一复测（下风向、低洼、地漏、井口）",
                   "顶空 GC-TCD 与便携传感器交叉验证"],
    "flammable": ["闭杯闪点", "IR 光谱（液面与蒸气管路）", "蒸气压/蒸气密度计算",
                  "LEL 复测 + 静电接地确认"],
    "acute_tox": ["GC-MS 全扫描 + 库比对", "LC-MS/MS 目标物 MRM", "离子色谱（阴离子）",
                  "ICP-MS（金属）", "专项：胆碱酯酶活性 / 氰化物比色 / 硫化物"],
    "corrosive": ["pH 复测 + 酸碱滴定", "离子色谱", "材质相容性静态浸泡"],
}

CONTAINER = {
    "asphyxiant": "气体样：吸附管（活性炭或 Tenax TA）+ 个体采样泵 FLOW_MLMIN，或惰性化顶空瓶",
    "flammable": "玻璃或 PTFE 螺口瓶，顶空瓶留空 V_HS，避光 4℃，禁满瓶",
    "acute_tox": "双份平行：玻璃 + HDPE，二级密封袋，单独转运箱",
    "corrosive": "HDPE 瓶，PTFE 内衬螺盖，留空 V_HS 防胀",
}

DECON = [
    "干式吸附（吸附棉/蛭石/沙）：由外向内单向收拢，吸附物入危废袋",
    "化学中和：仅在已定性且现场指挥批准后执行，中和剂按 SDS 指定，禁混用",
    "表面洗消：洗消液 + 软刷，废水全量收集，残留 pH/电导合格再解封",
    "人员：脱除污染层 -> 清水冲淋 DURATION_MIN -> 专用洗消液 -> 登记",
    "器材：现场洗消池 + 二次洗消，未洗消器材不得装车",
]

REPORT_FIELDS = ["SCENE_ID", "T0", "SAMPLE_ID", "SITE_ID", "GPS", "READING_JSON",
                 "INSTRUMENT_MODEL", "FW_VER", "CAL_DATE", "WITNESS"]


def load_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def hits_of(scene, thr):
    r = scene.get("readings", {})
    hits = []
    if r.get("o2_pct") is not None and r["o2_pct"] < thr["o2_pct_min"]:
        hits.append("asphyxiant")
    if r.get("lel_pct") is not None and r["lel_pct"] > thr["lel_pct_max"]:
        hits.append("flammable")
    tox = False
    for k in ("co_ppm", "h2s_ppm", "pid_ppm"):
        lim = thr.get(k + "_max")
        if r.get(k) is not None and lim is not None and r[k] > lim:
            tox = True
    if tox:
        hits.append("acute_tox")
    ph = r.get("ph")
    if ph is not None and (ph < thr["ph_low"] or ph > thr["ph_high"]):
        hits.append("corrosive")
    return sorted(set(hits))


def grade(scene, hits):
    people = scene.get("people", {})
    obs = scene.get("observations", {})
    symptomatic = bool(people.get("symptomatic"))
    odd = bool(obs.get("odor")) or bool(obs.get("visual"))
    if len(hits) >= 2 or (hits and symptomatic):
        return 3
    if len(hits) == 1:
        return 2
    if odd or symptomatic:
        return 1
    return 0


def build(scene, thr):
    hits = hits_of(scene, thr)
    level = grade(scene, hits)
    panel = []
    for h in hits:
        panel.extend(CONFIRM[h])
    if not panel:
        panel = ["无超阈值读数：补做顶空 GC-MS 全扫描 + 现场复测"]
    plan = [CONTAINER[h] for h in hits] or ["未定性：双份平行取样（玻璃 + HDPE），标注 UNKNOWN"]
    return {
        "scene_id": scene.get("scene_id", "SCENE_ID"),
        "level": "LEVEL_%d" % level,
        "hits": hits,
        "ppe": PPE[level],
        "confirm_panel": sorted(set(panel)),
        "sample_plan": sorted(set(plan)),
        "decon": DECON,
        "report_fields": REPORT_FIELDS,
        "gate": "FW_VER / CAL_DATE 任一缺失时，本单不得作为证据使用。",
    }


def print_md(o):
    print("## 作业单 %s -> %s" % (o["scene_id"], o["level"]))
    print("- 命中类别：%s" % (", ".join(o["hits"]) or "无"))
    print("- 防护：%s" % o["ppe"])
    print("- 确证项目：")
    for i, x in enumerate(o["confirm_panel"], 1):
        print("  %d. %s" % (i, x))
    print("- 封样方案：")
    for i, x in enumerate(o["sample_plan"], 1):
        print("  %d. %s" % (i, x))
    print("- 洗消：")
    for i, x in enumerate(o["decon"], 1):
        print("  %d. %s" % (i, x))
    print("- 上报字段：%s" % " / ".join(o["report_fields"]))
    print("- 闸门：%s" % o["gate"])


FIX = {
    "scene_00": {"scene_id": "SCENE_00", "readings": {"o2_pct": 20.9, "lel_pct": 0, "co_ppm": 1, "h2s_ppm": 0, "pid_ppm": 0.5, "ph": 7.0}, "observations": {}, "people": {}},
    "scene_01": {"scene_id": "SCENE_01", "readings": {"o2_pct": 20.9, "lel_pct": 0, "co_ppm": 1, "h2s_ppm": 0, "pid_ppm": 0.5, "ph": 7.0}, "observations": {"odor": "甜味"}, "people": {}},
    "scene_02": {"scene_id": "SCENE_02", "readings": {"o2_pct": 20.9, "lel_pct": 0, "co_ppm": 1, "h2s_ppm": 0, "pid_ppm": 999, "ph": 7.0}, "observations": {}, "people": {}},
    "scene_03": {"scene_id": "SCENE_03", "readings": {"o2_pct": 17.2, "lel_pct": 34, "co_ppm": 1, "h2s_ppm": 0, "pid_ppm": 0.5, "ph": 12.4}, "observations": {"visual": "地漏冒白雾"}, "people": {"symptomatic": 2}},
}
EXPECT = {"scene_00": "LEVEL_0", "scene_01": "LEVEL_1", "scene_02": "LEVEL_2", "scene_03": "LEVEL_3"}
SELFTEST_THR = {"o2_pct_min": 19.5, "lel_pct_max": 10, "co_ppm_max": 25,
                "h2s_ppm_max": 10, "pid_ppm_max": 50, "ph_low": 5.5, "ph_high": 9.0}


def selftest():
    bad = 0
    for sid in sorted(FIX):
        got = build(FIX[sid], SELFTEST_THR)["level"]
        ok = got == EXPECT[sid]
        bad += 0 if ok else 1
        print("%s expected=%s got=%s %s" % (sid, EXPECT[sid], got, "PASS" if ok else "FAIL"))
    try:
        build(FIX["scene_00"], {k: v for k, v in SELFTEST_THR.items() if k != "ph_low"})
        print("missing-key case: NO-RAISE FAIL")
        bad += 1
    except KeyError:
        print("missing-key case: KeyError PASS (fail-closed)")
    print("SELFTEST %s" % ("PASS" if bad == 0 else "FAIL"))
    return 0 if bad == 0 else 1


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--config")
    ap.add_argument("--scene")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if not (a.config and a.scene):
        print("需要 --config 与 --scene（或 --selftest）", file=sys.stderr)
        return 2
    thr = load_json(a.config)
    missing = [k for k in REQUIRED_THRESHOLD_KEYS if k not in thr]
    if missing:
        print("配置缺键，拒绝判定：%s" % ", ".join(missing), file=sys.stderr)
        return 3
    bad = [k for k in REQUIRED_THRESHOLD_KEYS
           if isinstance(thr[k], bool) or not isinstance(thr[k], (int, float))]
    if bad:
        print("配置含非数值（占位符未替换），拒绝判定：%s" % ", ".join(sorted(bad)), file=sys.stderr)
        return 3
    out = build(load_json(a.scene), thr)
    print(json.dumps(out, ensure_ascii=False, indent=2)) if a.json else print_md(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
