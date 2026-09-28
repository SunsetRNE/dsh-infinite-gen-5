#!/usr/bin/env python3
"""活动任务判定器 — 最新用户请求是唯一活动任务；纯控制轮继承上一实质任务；
助手文本只记为「未完证据」，不参与开场/结论/约束/完成态判定。"""
import json, re, sys

CONTROL_PAT = [
    r"^\s*(继续|接着|go\s*on|continue|next|下一步|往下)\s*[。.!！]?\s*$",
    r"^\s*(重试|再来一次|retry|again)\s*[。.!！]?\s*$",
    r"^\s*(好|好的|嗯|ok|okay|收到|thanks|谢谢)\s*[。.!！]?\s*$",
    r"^\s*(短一点|详细点|再快点|展开|缩短|换个说法)\s*[。.!！]?\s*$",
    r"^\s*[?？]\s*$",
]
CONTROL_RE = re.compile("|".join(CONTROL_PAT), re.I)
ASSIST_MARK = ("完成", "done", "已完成", "后续可", "next step")


def classify(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return "control"
    return "control" if (CONTROL_RE.match(t) and len(t) <= 32) else "substantive"


def resolve(turns):
    """turns: [{'role':'user'|'assistant','text':str}, ...] -> 判定结果"""
    active, carried, evidence = None, 0, []
    for i, tn in enumerate(turns):
        role, text = tn.get("role"), str(tn.get("text", ""))
        if role != "user":
            if role == "assistant" and text.strip():
                evidence.append({"turn": i, "chars": len(text),
                                 "kind": "incomplete_evidence",
                                 "claims_completion": any(m in text for m in ASSIST_MARK)})
            continue
        if classify(text) == "substantive":
            active, carried = {"turn": i, "task": text.strip(), "inherited": False}, 0
        elif active:
            carried += 1
            active = dict(active, inherited=True)
    return {"active_task": active, "control_turns_after": carried,
            "assistant_evidence": evidence}


def main():
    turns = [json.loads(l) for l in sys.stdin if l.strip()]
    print(json.dumps(resolve(turns), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
