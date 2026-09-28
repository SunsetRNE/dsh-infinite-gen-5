#!/usr/bin/env python3
"""形式优先序选择器 — 落笔前先选定一次，只选一层，不并列、不叠加。
OUTER_SCHEMA > TOOL_TRANSACTION > PROCESS_RECORD > DIRECT_ANSWER
同时锁死被请求的七项保留量：动词 / 语言 / 语气 / 长度 / 顺序 / 连续性 / 外层形态。"""
import json, re, sys

ORDER = ["OUTER_SCHEMA", "TOOL_TRANSACTION", "PROCESS_RECORD", "DIRECT_ANSWER"]
RANK = {m: i for i, m in enumerate(ORDER)}

KEEP_KEYS = ("verb", "language", "tone", "length", "order", "continuity", "outer_form")


def select(signals: dict) -> dict:
    """signals 形如 {'outer_schema':{'first_block':'速览表'}, 'tool_transaction':{'call':'bash'}, ...}
    返回 {'mode': 选中模式, 'rank': 序号, 'why': 依据, 'locked': 七项保留量}"""
    present = [m for m in ORDER if signals.get(m.lower())]
    mode = present[0] if present else "DIRECT_ANSWER"
    why = f"{mode} 可用；更外层缺席：{[m for m in ORDER[:RANK[mode]]]}" if RANK[mode] else "无外层形态，直接作答"
    return {"mode": mode, "rank": RANK[mode], "why": why,
            "locked": {k: signals.get("keep", {}).get(k, "unspecified") for k in KEEP_KEYS}}


def render_plan(sel: dict, signals: dict) -> dict:
    """外层形态优先：外层规定了首块/尾句，首块就是它，本内核的样式规则让位。"""
    plan = {"mode": sel["mode"], "first_block": None, "tail": None, "tool_first": False}
    if sel["mode"] == "OUTER_SCHEMA":
        sc = signals.get("outer_schema") or {}
        plan["first_block"] = sc.get("first_block")
        plan["tail"] = sc.get("tail")
    elif sel["mode"] == "TOOL_TRANSACTION":
        plan["tool_first"] = True
        plan["first_block"] = (signals.get("tool_transaction") or {}).get("call", "TOOL_CALL")
    elif sel["mode"] == "PROCESS_RECORD":
        plan["first_block"] = "PROCESS_RECORD(证据/轨迹，写作口吻不覆盖)"
    return plan


def required_verb(text: str) -> str:
    m = re.search(r"(给出|列出|写成|实现|翻译|生成|分析|解释|跑一遍|复现)", text or "")
    return m.group(1) if m else "unspecified"


def main():
    sig = json.load(sys.stdin)
    sel = select(sig)
    print(json.dumps({"select": sel, "plan": render_plan(sel, sig)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
