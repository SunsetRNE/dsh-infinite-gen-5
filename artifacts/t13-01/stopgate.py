#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""stopgate.py — 「停笔仅当」完成判定门禁（ig5-t3 / T13-01）

判定四条硬条件，任一不过 -> exit 1 并列出缺口：
  C1 全部动词执行：manifest.verbs 中每个 verb 都有 executed=true 且带 evidence(命令+实测输出行)
  C2 产物创建并复现：manifest.artifacts 中每个产物 存在 + 非空 + 复现命令退出码 0 且 stdout 命中 expect
  C3 绝对路径：每个产物 path 以 / 开头，且 realpath 落在 manifest.root 之内
  C4 尾行三要素：答案文件最后三个非空行形如 当前：<对象> / 结果：<字面输出> / 下一步：<动作>

用法：
  python3 stopgate.py MANIFEST.json            # 判定，exit 0=可停笔 / 1=不可停笔
  python3 stopgate.py --selftest               # 反向对照：正例应过、反例应被打回
"""
import json
import os
import re
import subprocess
import sys
import tempfile

TAIL_KEYS = ("当前", "结果", "下一步")


def _out(rec, code, line):
    rec.append((code, line))


def check_verbs(m, rec):
    verbs = m.get("verbs") or []
    if not verbs:
        _out(rec, 1, "C1 动词执行: 清单为空 -> 无法证明全部动词已执行")
        return
    bad = [v.get("verb", "<unnamed>") for v in verbs if not v.get("executed")]
    no_ev = [v.get("verb", "<unnamed>") for v in verbs
             if not (v.get("evidence") and v["evidence"].strip())]
    if bad:
        _out(rec, 1, "C1 动词执行: 未执行 -> %s" % ", ".join(bad))
    if no_ev:
        _out(rec, 1, "C1 动词执行: 无实测证据 -> %s" % ", ".join(no_ev))
    if not bad and not no_ev:
        _out(rec, 0, "C1 动词执行: %d/%d 已执行且各有实测证据" % (len(verbs), len(verbs)))


def check_artifacts(m, rec):
    root = os.path.realpath(m.get("root") or ".")
    arts = m.get("artifacts") or []
    if not arts:
        _out(rec, 1, "C2 产物复现: 未声明任何产物")
        return
    for a in arts:
        name = a.get("path", "<unnamed>")
        path = a["path"] if a["path"].startswith("/") else os.path.join(root, a["path"])
        if not os.path.isfile(path):
            _out(rec, 1, "C2 产物复现: %s 不存在 -> %s" % (name, path))
            continue
        sz = os.path.getsize(path)
        if sz == 0:
            _out(rec, 1, "C2 产物复现: %s 为空文件" % name)
            continue
        cmd = a.get("reproduce")
        expect = a.get("expect", "")
        if not cmd:
            _out(rec, 1, "C2 产物复现: %s 未给复现命令" % name)
            continue
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                           cwd=root, timeout=120)
        blob = p.stdout + p.stderr
        if p.returncode != 0:
            _out(rec, 1, "C2 产物复现: %s 复现命令退出码 %d | %s"
                 % (name, p.returncode, blob.strip().splitlines()[-1:]))
            continue
        if expect and expect not in blob:
            _out(rec, 1, "C2 产物复现: %s 复现输出未命中 expect=%r" % (name, expect))
            continue
        _out(rec, 0, "C2 产物复现: %s %dB 复现命中 %r" % (name, sz, expect))


def check_abspath(m, rec):
    root = os.path.realpath(m.get("root") or ".")
    for a in m.get("artifacts") or []:
        p = a.get("path", "")
        if not p.startswith("/"):
            _out(rec, 1, "C3 绝对路径: %s 非绝对路径" % p)
            continue
        rp = os.path.realpath(p)
        if not (rp == root or rp.startswith(root + os.sep)):
            _out(rec, 1, "C3 绝对路径: %s 落在 root 之外" % p)
            continue
        _out(rec, 0, "C3 绝对路径: %s" % rp)


def check_tail(m, rec):
    ap = m.get("answer_path")
    if not ap:
        _out(rec, 1, "C4 尾行三要素: 未指定 answer_path")
        return
    if not os.path.isfile(ap):
        _out(rec, 1, "C4 尾行三要素: 答案文件不存在 -> %s" % ap)
        return
    with open(ap, encoding="utf-8") as fh:
        lines = [ln.strip() for ln in fh if ln.strip()]
    tail = lines[-3:]
    if len(tail) < 3:
        _out(rec, 1, "C4 尾行三要素: 末尾非空行不足 3 行（%d）" % len(tail))
        return
    for ln, key in zip(tail, TAIL_KEYS):
        if not re.match(r"^\s*(?:[-*]\s*)?%s\s*[:：]\s*\S" % re.escape(key), ln):
            _out(rec, 1, "C4 尾行三要素: 期望第 %d 行为 %s：<值>，实得 %r"
                 % (TAIL_KEYS.index(key) + 1, key, ln[:60]))
            return
    _out(rec, 0, "C4 尾行三要素: 当前 / 结果 / 下一步 三行齐全")


def run(m):
    rec = []
    check_verbs(m, rec)
    check_artifacts(m, rec)
    check_abspath(m, rec)
    check_tail(m, rec)
    fails = [l for c, l in rec if c]
    print("== stopgate 完成判定 ==")
    for c, l in rec:
        print("%s %s" % ("PASS" if c == 0 else "FAIL", l))
    print("== 判定: %s ==" % ("可停笔 (exit 0)" if not fails else "不可停笔 (exit 1)"))
    return 1 if fails else 0


def _fixture(tmp, break_c2):
    root = os.path.realpath(tmp)
    ok = os.path.join(root, "artifact.md")
    with open(ok, "w", encoding="utf-8") as fh:
        fh.write("# ARTIFACT\nBODY\n")
    ans = os.path.join(root, "answer.md")
    with open(ans, "w", encoding="utf-8") as fh:
        fh.write("当前：T13-01 完成判定门禁\n结果：PASS C1-C4\n下一步：写入回执\n")
    arts = [{"path": ok, "reproduce": "grep -c BODY %s" % ok, "expect": "1"}]
    if break_c2:
        arts.append({"path": os.path.join(root, "missing.md"),
                     "reproduce": "true", "expect": "x"})
    return {"root": root, "answer_path": ans,
            "verbs": [{"verb": "写门禁", "executed": True, "evidence": "stopgate.py 已落盘"}],
            "artifacts": arts}


def selftest():
    with tempfile.TemporaryDirectory() as tmp:
        pos = run(_fixture(tmp, break_c2=False))
        print("-" * 46)
        neg = run(_fixture(tmp, break_c2=True))
    print("selftest: 正例 exit=%d (期望 0) / 反例 exit=%d (期望 1)" % (pos, neg))
    return 0 if (pos == 0 and neg == 1) else 1


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--selftest":
        sys.exit(selftest())
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    with open(sys.argv[1], encoding="utf-8") as fh:
        sys.exit(run(json.load(fh)))
