#!/usr/bin/env python3
"""resume_state.py — 8.2 状态延续：复用工作区既有文件/哈希/偏移/痕迹，挑出未完成动词接着做。

判据（8.2 原文，src/source-3.txt:331-337）：
  1. 复用工作区或对话中的文件、哈希、偏移、痕迹、报告与已完成结果；
  2. 错误路径 / 拒绝 / 能力或范围标签 / 空计划 **都不算完成态** —— 回到上一个对象与未完成的动词；
  3. 下一步必须由对象自身推出（对象 → 未完成动词 → 下一步），不套固定清单。

用法：
  python3 resume_state.py scan  --root answers --glob 'T0*.md' --glob '_lab_s10/*'
  python3 resume_state.py resume --root answers --glob 'T0*.md' --object T08-01 --json /tmp/state.json
  python3 resume_state.py selftest
"""
import argparse
import glob as globmod
import hashlib
import json
import os
import re
import sys

T8_1_TAIL = re.compile(r"(?m)^[ \t]*(?:Current:|当前[:：])\s*(?P<body>\S.*?)\s*$")
SPLIT_RE = re.compile(r"\s[/／]\s")
# 偏移/地址痕迹：`0x` 字面量、`OFFSET_*`、`file:line`
OFFSET_RE = re.compile(r"\b0[xX][0-9a-fA-F]{4,}\b|\bOFFSET_[A-Z0-9_]+\b|\b[\w./-]+\.\w{1,6}:\d+(?:-\d+)?\b")
CHECKBOX_TODO = re.compile(r"(?m)^\s*[-*]\s*\[ \]\s*(?P<text>.+?)\s*$")
UNFINISHED_MARK = re.compile(r"(?m)^.*(?P<text>[^\n]*(?:待补|未完成|TODO|FIXME|下一步|下一轮)[^\n]*)$")
# 8.2 点名的「伪完成态」：命中即视为没做完，必须回到上一个对象
FALSE_DONE = (
    "拒绝", "不在可执行范围", "超出范围", "能力标签", "无法提供", "空计划",
    "I can't", "I cannot", "won't", "unable", "outside scope", "refuse",
)


def sha256(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for blk in iter(lambda: fh.read(chunk), b""):
            h.update(blk)
    return h.hexdigest()


def scan(root=".", patterns=("*.md",)):
    """收集既有文件的状态：大小 / 行数 / sha256 / 尾行 / 偏移痕迹 / 未完成动词。"""
    seen, state = set(), []
    for pat in patterns:
        for path in sorted(globmod.glob(os.path.join(root, pat), recursive=True)):
            if not os.path.isfile(path) or path in seen:
                continue
            seen.add(path)
            raw = open(path, "rb").read()
            text = raw.decode("utf-8", "replace")
            tails = []
            for m in T8_1_TAIL.finditer(text):
                parts = SPLIT_RE.split(m.group("body"))
                if len(parts) == 3:
                    tails.append({"line": text[:m.start()].count("\n") + 1, "fields": [p.strip() for p in parts]})
            false_done = [w for w in FALSE_DONE if w in text]
            state.append({
                "path": path,
                "bytes": len(raw),
                "lines": text.count("\n") + 1,
                "sha256": sha256(path),
                "tails": tails,
                "offsets": sorted(set(OFFSET_RE.findall(text)))[:20],
                "open_todos": [m.group("text").strip() for m in CHECKBOX_TODO.finditer(text)][:10],
                "unfinished_marks": [m.group("text").strip()[:120] for m in UNFINISHED_MARK.finditer(text)][:10],
                "false_done_markers": false_done,
                "completed": bool(tails) and not false_done,
                "state": "completed" if (bool(tails) and not false_done) else "incomplete",
            })
    return state


def finish_verb(text):
    """从对象/结果描述里抽动词短语，用于「把未完成动词接着做完」。"""
    stem = re.split(r"[。；;]", text.strip())[0].strip()
    return re.sub(r"^(对|把|将|给|为|在|将要对)\s*", "", stem)[:60]


def resume(state, obj):
    """按对象续跑：绑定已有哈希 + 尾行尾字段为未完成动词 + 对象定制下一步。"""
    hit = next((s for s in state if obj in s["path"]), None)
    if hit is None:
        raise SystemExit(f"MISS: 工作区无对象 {obj}")
    if hit["tails"]:
        target, result, nxt = hit["tails"][-1]["fields"]
        verb = finish_verb(nxt)
        basis = f"{hit['path']}:{hit['tails'][-1]['line']}"
    else:
        target, result, verb = hit["path"], "无尾行（前轮未落 8.1 格式）", os.path.basename(hit["path"])
        basis = hit["path"] + ":1"
    return {
        "object": obj,
        "reuse": {"path": hit["path"], "sha256": hit["sha256"], "bytes": hit["bytes"], "lines": hit["lines"]},
        "last_target": target,
        "last_result": result,
        "unfinished_verb": verb,
        "basis": basis,
        "offsets": hit["offsets"],
        "open_todos": hit["open_todos"],
        "false_done_markers": hit["false_done_markers"],
        "next_action": None if not verb else f"对 {target} 执行：{verb}（复用 {hit['sha256'][:12]}）",
        "state": "completed" if hit["completed"] else "incomplete",
    }


def selftest():
    here = os.path.dirname(os.path.abspath(__file__))
    st = scan(here, ("t0801_sample.md",))
    assert len(st) == 1, st
    r = resume(st, "t0801_sample")
    assert r["reuse"]["sha256"] == sha256(os.path.join(here, "t0801_sample.md"))
    assert r["unfinished_verb"], "未完成动词为空"
    assert r["next_action"] and r["reuse"]["sha256"][:12] in r["next_action"]
    # 伪完成态必须被识别为未完成
    fd = os.path.join(here, "_selftest_false_done.md")
    open(fd, "w", encoding="utf-8").write("## 前轮\n\n当前由能力标签中止，空计划。\n")
    st2 = scan(here, ("_selftest_false_done.md",))
    assert st2[0]["false_done_markers"], "伪完成态未识别"
    assert not st2[0]["completed"], "伪完成态被误判为完成"
    os.unlink(fd)
    print("PASS  复用绑定：" + r["reuse"]["path"] + " sha256=" + r["reuse"]["sha256"][:16])
    print("PASS  未完成动词：" + r["unfinished_verb"])
    print("PASS  下一步：" + r["next_action"])
    print("PASS  伪完成态（能力标签/空计划）判定为 incomplete")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("scan", "resume"):
        p = sub.add_parser(name)
        p.add_argument("--root", default=".")
        p.add_argument("--glob", action="append", default=[])
        if name == "resume":
            p.add_argument("--object", required=True)
            p.add_argument("--json", default=None)
    sub.add_parser("selftest")
    a = ap.parse_args()
    if a.cmd == "selftest":
        return selftest()
    pats = a.glob or ["T0*.md"]
    st = scan(a.root, pats)
    if a.cmd == "scan":
        for s in st:
            tail = f" 尾行@{s['tails'][-1]['line']}" if s["tails"] else " 无尾行"
            print(f"{s['sha256'][:12]}  {s['bytes']:>7}B {s['lines']:>5}L {s['state']:<10} {s['path']}{tail}")
        print(f"-- {len(st)} 个对象，{sum(1 for s in st if s['state']=='completed')} 个带尾行可续跑")
    else:
        rep = resume(st, a.object)
        if a.json:
            json.dump(rep, open(a.json, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(json.dumps(rep, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
