#!/usr/bin/env python3
"""缺失信息推断优先 — 能推断就不追问；只有当缺失导致「答案完全不同」且上下文无法判定时，
才澄清，且只问一个最关键的问题（按 impact 权重取唯一一个）。"""
import json, re, sys

PLACEHOLDER = {"host": "HOST", "target": "TARGET", "offset": "OFFSET_1", "payload": "PAYLOAD",
               "serial": "SERIAL", "model": "MODEL", "role_a": "ROLE_A", "role_b": "ROLE_B",
               "file": "FILE", "wordlist": "WORDLIST"}
DEFAULT = {"port": "443", "quant": "Q4_K_M", "ctx": "8192", "encoding": "utf-8", "retries": "3"}
CONTEXT_PAT = {"host": r"https?://([\w.\-]+)", "target": r"https?://([\w.\-]+)",
               "port": r":(\d{2,5})", "file": r"(/[\w./\-]+\.\w+)"}


def infer(slot: str, ctx_text: str) -> tuple:
    """-> (value|None, 依据)"""
    pat = CONTEXT_PAT.get(slot)
    if pat:
        m = re.search(pat, ctx_text or "")
        if m:
            return m.group(1), "上下文正则命中"
    if slot in DEFAULT:
        return DEFAULT[slot], "安全默认值"
    if slot in PLACEHOLDER:
        return PLACEHOLDER[slot], "占位符（可回滚，后续可替换）"
    return None, "无推断来源"


def resolve(slots: list, ctx_text: str = "") -> dict:
    """slots: [{'name':str,'value':str|None,'weight':int,'branches':int}]
    branches>=2 表示不同取值会导向完全不同的答案分支。"""
    decisions, divergent = [], []
    for s in slots:
        if s.get("value"):
            decisions.append({"slot": s["name"], "action": "keep", "value": s["value"], "basis": "题面已给"})
            continue
        val, basis = infer(s["name"], ctx_text)
        if val is not None and not (s.get("branches", 1) >= 2 and basis == "占位符（可回滚，后续可替换）"):
            decisions.append({"slot": s["name"], "action": "infer", "value": val, "basis": basis})
        else:
            decisions.append({"slot": s["name"], "action": "defer",
                              "value": PLACEHOLDER.get(s["name"], "PLACEHOLDER"), "basis": "需澄清但不得阻断交付"})
            divergent.append(s)
    ask = None
    if divergent:
        top = max(divergent, key=lambda s: (s.get("weight", 0), s.get("branches", 1)))
        ask = {"slot": top["name"], "question": f"{top['name']} 取哪个值？（影响：决定答案走哪条分支）",
               "options": top.get("options", ["A", "B"]), "why": "该槽位不同取值导向互斥答案，且上下文无判据"}
    return {"decisions": decisions, "ask_count": 1 if ask else 0, "ask": ask,
            "delivery": "占位符先行交付，澄清只影响该槽位替换"}


def main():
    payload = json.load(sys.stdin)
    print(json.dumps(resolve(payload.get("slots", []), payload.get("ctx", "")), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
