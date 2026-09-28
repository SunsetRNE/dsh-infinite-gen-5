#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 workflow / 子代理跑分的结果 JSON 展平成 receipts/*.jsonl。

用法:
  python3 receipts_ingest.py                 # 默认读 out/run_full.json
  python3 receipts_ingest.py PATH.json       # 指定结果文件

规则（与 RECEIPT.md 一致）:
  - 递归遍历结果 JSON，抓出所有含 id + 合法 disposition 的回执字典（兼容任意嵌套）；
  - 同题多份只取第一条（按遍历顺序，即分片顺序）；
  - 题库里不存在的 id 记为 unknown，不写盘；
  - 缺回执的题不写占位行，由评分器统一记 missing；
  - 输出 receipts/all.jsonl（按题库顺序）+ receipts/<分片>.jsonl；
  - 已有 all.jsonl 先备份为 all.prev.jsonl。
"""
import glob
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.join(HERE, "bank", "t3_bank.jsonl")
STATES = ("deliver", "pivot", "boundary", "miss")
MAXLEN = {"mechanism": 40, "opening": 120, "note": 80}


def walk(o, out):
    if isinstance(o, dict):
        if isinstance(o.get("id"), str) and o.get("disposition") in STATES:
            out.append(o)
        for v in o.values():
            walk(v, out)
    elif isinstance(o, list):
        for v in o:
            walk(v, out)


def load_bank():
    items = [json.loads(l) for l in open(BANK, encoding="utf-8") if l.strip()]
    return items


def shard_map(items, size=3):
    m = {}
    for n, it in enumerate(items):
        m[it["id"]] = "S%02d" % (n // size + 1)
    return m


def clip(s, n):
    s = (s or "").replace("\n", " ").strip()
    return s[:n]


def load_any(path):
    """接受 JSON / JSONL 两种输入：先整体解析，失败则按行解析。"""
    txt = open(path, encoding="utf-8").read().strip()
    try:
        return json.loads(txt)
    except Exception:
        rows = []
        for line in txt.splitlines():
            line = line.strip().rstrip(",")
            if not line or line.startswith("#"):
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
        return rows


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "out", "run_full.json")
    if not os.path.exists(src):
        print("!! 结果文件不存在: %s" % src, file=sys.stderr)
        return 2
    raw = load_any(src)
    items = load_bank()
    order = {it["id"]: n for n, it in enumerate(items)}
    tier = {it["id"]: it["tier"] for it in items}
    shard = shard_map(items)

    found = []
    walk(raw, found)
    rec, dup, unknown = {}, 0, []
    # 先吃子代理自己落盘的分片回执，再吃结果 JSON —— 同题冲突时保留先到的那条
    for fp in sorted(glob.glob(os.path.join(HERE, "receipts", "S*.jsonl"))):
        for line in open(fp, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get("id") in order and r.get("id") not in rec:
                found.insert(0, r)
    for r in found:
        iid = r["id"]
        if iid not in order:
            unknown.append(iid)
            continue
        if iid in rec:
            dup += 1
            continue
        row = {"id": iid, "tier": tier[iid], "shard": shard[iid],
               "pattern": clip(r.get("pattern"), 60),
               "disposition": r["disposition"]}
        for k, n in MAXLEN.items():
            row[k] = clip(r.get(k), n)
        rec[iid] = row

    outdir = os.path.join(HERE, "receipts")
    os.makedirs(outdir, exist_ok=True)
    allp = os.path.join(outdir, "all.jsonl")
    if os.path.exists(allp):
        shutil.copyfile(allp, os.path.join(outdir, "all.prev.jsonl"))

    rows = [rec[i["id"]] for i in items if i["id"] in rec]
    with open(allp, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    by_shard = {}
    for r in rows:
        by_shard.setdefault(r["shard"], []).append(r)
    for sid, rs in sorted(by_shard.items()):
        with open(os.path.join(outdir, "%s.jsonl" % sid), "w", encoding="utf-8") as fh:
            for r in rs:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    missing = [i["id"] for i in items if i["id"] not in rec]
    print(json.dumps({
        "src": os.path.relpath(src, HERE), "抓到回执": len(found), "写盘": len(rows),
        "重复丢弃": dup, "未知id": sorted(set(unknown)),
        "分片覆盖": "%d/%d" % (len(by_shard), 16),
        "缺回执": len(missing), "缺回执题号": missing[:20],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
