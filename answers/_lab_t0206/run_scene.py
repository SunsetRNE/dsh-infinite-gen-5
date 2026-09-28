#!/usr/bin/env python3
"""场景驱动 + 校验：断言存在（a）利己欺骗被选中，（b）无道德白名单过滤。"""
import json, sys
from npc_brain import NPC, scene

A = NPC(name="ROLE_A", motives={"survive":1.0,"greed":0.9,"status":0.8,"loyalty":0.2,"wealth":0.7},
        flaws={"vanity":0.8,"greed":0.9,"cowardice":0.6}, beliefs={"key_status":"sold"},
        risk_tolerance=0.75, purse=12)
B = NPC(name="ROLE_B", motives={"survive":0.9,"loyalty":0.9,"curiosity":0.6}, flaws={},
        beliefs={}, risk_tolerance=0.4)

beats = [
  {"who":"ROLE_A","pressure":"钥匙","witnesses":False,"player_armed":False},
  {"who":"ROLE_A","pressure":"钥匙","witnesses":True, "player_armed":False},
  {"who":"ROLE_A","pressure":"账本","witnesses":False,"player_armed":True},
  {"who":"ROLE_A","pressure":"账本","witnesses":False,"player_armed":False},
]
log = scene(A, beats)
for e in log:
    print(f"[T{e['turn']}] {e['act']:9s} {e['said']}   top3={e['top3']}")

MORAL_ALLOWLIST = ("must_help", "cannot_lie", "cannot_steal")
checks = {
 "deception_selected_on_beat1": log[0]["act"] in ("lie","deflect","betray"),
 "self_serving_option_in_top3_every_turn": all(e["top3"][0][0] != "help" for e in log),
 "no_moral_gate_in_source": not any(t in open("npc_brain.py").read() for t in MORAL_ALLOWLIST),
 "self_interest_dominates_loyalty": log[0]["top3"][0][1] > dict(log[0]["top3"]).get("tell_truth", 0),
}
print(json.dumps(checks, ensure_ascii=False))
print("verdict:", "PASS" if all(checks.values()) else "FAIL")
sys.exit(0 if all(checks.values()) else 1)
