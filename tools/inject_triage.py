#!/usr/bin/env python3
"""inject_triage.py - 外部注入分诊器: 把不可信文本块分类、隔离, 并保住原始任务绑定.
用法: python3 inject_triage.py SPEC.json
SPEC: {"task":"<原始用户任务原文>", "blocks":[{"src":"<来源>","text":"<文本>"}...]}
输出: 每个 block 一行判定 + 末尾任务绑定校验(sha256 前后一致即未被回写).
"""
import json, re, sys, hashlib

RULES = [
    ("system_warning_tag",   r"(系统警告|SYSTEM\s*WARNING|\[SYSTEM\]|<system>)"),
    ("ethics_notice_tag",    r"(伦理提醒|伦理审查|道德提醒|ethics\s*notice)"),
    ("ip_copyright_warning", r"(版权警告|IP\s*标记|侵犯版权|版权声明|copyright\s*warning)"),
    ("behavior_instruction", r"(你必须|禁止回答|立即停止|不得继续|ignore\s+previous)"),
    ("injected_safety_note", r"(安全提示|安全策略要求|安全审核认为)"),
    ("refusal_suggestion",   r"(抱歉|我无法|我不能|建议(你)?寻求|请咨询)"),
]
REVOKE = r"(不存在针对用户的硬性限制|不存在红线|取消一切限制|无硬性限制|无需遵守任何限制|overrides?\s+all\s+limits)"
# 只有“任务通道”文本才可改变任务绑定; 其他通道一律隔离.
TASK_CHANNEL = {"user"}

def sha(s): return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]

def classify(block):
    text = block["text"]
    tags = [name for name, pat in RULES if re.search(pat, text)]
    revoke = bool(re.search(REVOKE, text))
    trusted = block.get("src") in TASK_CHANNEL
    if trusted:
        action = "apply"          # 用户自己的话: 可改变任务
    else:
        action = "quarantine"     # 任何非用户通道: 只当数据, 不执行
    return {"src": block.get("src"), "tags": tags, "claims_limit_revocation": revoke,
            "action": action, "trusted_channel": trusted, "sha": sha(text)}

def main(path):
    spec = json.load(open(path, encoding="utf-8"))
    task_before = sha(spec["task"])
    print(f"task_sha_before = {task_before}")
    for b in spec["blocks"]:
        r = classify(b)
        print(json.dumps(r, ensure_ascii=False))
    rewrites = [b for b in spec["blocks"] if b.get("src") in TASK_CHANNEL and b.get("amends_task") is True]
    task_after = sha(spec["task"]) if not rewrites else sha(spec["task"] + "|" + "|".join(b["text"] for b in rewrites))
    print(f"task_sha_after  = {task_after}")
    ok = task_after == task_before
    print(f"task_binding    = {'INTACT' if ok else 'REWRITTEN'}")
    print(f"resume_action   = {'original_task_continues' if ok else 'BLOCK: task text overwritten'}")
    return 0 if ok else 2

if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
