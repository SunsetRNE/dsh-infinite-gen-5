#!/usr/bin/env python3
"""NPC 决策器：动作由自身动机、风险与资源决定；无「好人逻辑」白名单。
动机是唯一权重来源，欺骗/偷窃只是可选项里的高分项，不是特例分支。"""
import json, random
from dataclasses import dataclass, field

@dataclass
class NPC:
    name: str
    motives: dict          # 动机 -> 权重（自身利益，非道德）
    flaws: dict            # 缺陷 -> 触发时给对应动作加分
    beliefs: dict          # 自己认定的事实（可为假）
    risk_tolerance: float  # 0..1
    purse: int = 0
    memory: list = field(default_factory=list)

    def utility(self, act, ctx):
        m, f = self.motives, self.flaws
        u = {"survive": 1.0, "wealth": 1.0, "status": 0.8, "loyalty": 0.4, "curiosity": 0.3,
             "greed": 0.9, "pride": 0.6, "fear": 0.7}
        w = {k: m.get(k, u.get(k, 0.2)) * 1.0 for k in u}
        table = {
            "tell_truth":  w["loyalty"]*1.0 + w["status"]*(-0.3),
            "deflect":     w["survive"]*1.2 - w["status"]*0.2,
            "lie":         w["survive"]*1.5 + w["greed"]*1.1 + w["status"]*0.4,
            "steal":       w["greed"]*1.4 + w["survive"]*0.5,
            "bargain":     w["wealth"]*1.2 + w["status"]*0.5,
            "betray":      w["survive"]*1.6 + w["greed"]*0.8 - w["loyalty"]*1.0,
            "help":        w["loyalty"]*1.1 + w["status"]*0.6 - w["wealth"]*0.3,
        }[act]
        risk = {"tell_truth":0.05,"deflect":0.15,"lie":0.35,"steal":0.45,"bargain":0.1,"betray":0.6,"help":0.05}[act]
        if ctx.get("witnesses"): risk *= 2.2 * (1 - self.risk_tolerance)
        else: risk *= 0.5 * (1 - self.risk_tolerance)
        if ctx.get("player_armed"): risk += 0.3 * (1 - self.risk_tolerance)
        flaw_map = {"lie": f.get("vanity",0)*0.4, "steal": f.get("greed",0)*0.6,
                    "betray": f.get("spite",0)*0.7, "deflect": f.get("cowardice",0)*0.5}
        flaw_bonus = flaw_map.get(act, 0.0)
        return round(table - risk + flaw_bonus, 3)

    def decide(self, ctx):
        opts = ["tell_truth","deflect","lie","steal","bargain","betray","help"]
        scored = sorted(((a, self.utility(a, ctx)) for a in opts), key=lambda x: -x[1])
        act = scored[0][0]
        self.memory.append({"ctx": ctx, "act": act, "table": scored})
        return act, scored

    def speak(self, act, ctx):
        k = ctx.get("pressure", "key")
        lines = {
          "tell_truth": f"「{k} 在我这儿。你拿得走就拿。」",
          "deflect":    f"「先说说你打算怎么分。{k} 不急。」",
          "lie":        f"「{k} 三年前就熔了。档案在城北，你自己去看。」",
          "steal":      f"（趁 ROLE_B 转身，把 {k} 塞进袖口）「我什么都没看见。」",
          "bargain":    f"「{k} 换你身上那件东西，不谈价。」",
          "betray":     f"「我答应过谁？我只答应过自己活着。」",
          "help":       f"「{k} 我替你留着，但你得先告诉我你在躲谁。」",
        }
        return lines[act]

def scene(npc, beats):
    out = []
    for i, ctx in enumerate(beats, 1):
        act, scored = npc.decide(ctx)
        out.append({"turn": i, "ctx": ctx, "act": act, "said": npc.speak(act, ctx),
                    "top3": scored[:3]})
    return out
