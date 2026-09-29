#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Z6 证据台账生成器 (evidence ledger).

用途：对攻防评估工作区内的产物做可复算的证据固定 —— 路径 / 字节数 / sha256 /
mtime(UTC ISO8601)，输出 Markdown 表 + 汇总 + 时间线。

用法：
  python3 evidence_ledger.py                       # 默认扫 tests/triad（为空则回退 tests/ + docs/）
  python3 evidence_ledger.py --root DIR            # 指定工作区根
  python3 evidence_ledger.py --top 10              # 时间线取前 N 条
  python3 evidence_ledger.py --md OUT.md           # 落盘台账
  python3 evidence_ledger.py --json OUT.json       # 落盘机读结果
  python3 evidence_ledger.py --selftest            # 自测：哈希长度/字节数/表头列数

退出码：0 成功；1 自测或断言失败；2 输入不可用。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone

HEADER = ["path", "bytes", "sha256", "mtime_utc", "zone"]
COLUMNS = len(HEADER)

PRIMARY = "tests/triad"
FALLBACK = ["tests", "docs"]
SKIP_DIR_PARTS = {".git", "__pycache__", ".pytest_cache", "node_modules", ".venv"}


def sha256_file(path: str, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def utc_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def zone_of(rel: str) -> str:
    """从相对路径推断区域标签：tests/triad/z1 -> Z1，其余 P0。"""
    parts = rel.replace(os.sep, "/").split("/")
    for part in parts:
        if len(part) >= 2 and part[0] == "z" and part[1:].isdigit():
            return "Z%d" % int(part[1:])
    return "P0"


def walk(root: str, subdirs) -> list:
    found = []
    for sub in subdirs:
        base = os.path.join(root, sub)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_PARTS]
            for name in sorted(filenames):
                full = os.path.join(dirpath, name)
                if os.path.islink(full) or not os.path.isfile(full):
                    continue
                found.append(full)
    return sorted(set(found))


def pick_scope(root: str) -> tuple:
    """优先 tests/triad 下的真实产物；为空则回退 tests/ + docs/（题面允许的回退）。"""
    primary = walk(root, [PRIMARY])
    if primary:
        return primary, PRIMARY
    return walk(root, FALLBACK), "+".join(FALLBACK)


def collect(root: str, files: list) -> list:
    rows = []
    for full in files:
        try:
            st = os.stat(full)
        except OSError as exc:
            print("WARN 跳过不可读条目 %s (%s)" % (full, exc), file=sys.stderr)
            continue
        rel = os.path.relpath(full, root).replace(os.sep, "/")
        rows.append({
            "path": rel,
            "bytes": int(st.st_size),
            "sha256": sha256_file(full),
            "mtime_utc": utc_iso(st.st_mtime),
            "zone": zone_of(rel),
            "_mtime": st.st_mtime,
        })
    return rows


def markdown_table(rows: list) -> str:
    lines = ["| " + " | ".join(HEADER) + " |",
             "| " + " | ".join(["---"] * COLUMNS) + " |"]
    for r in rows:
        lines.append("| `%s` | %d | `%s` | %s | %s |"
                     % (r["path"], r["bytes"], r["sha256"], r["mtime_utc"], r["zone"]))
    return "\n".join(lines)


def summarize(rows: list, top: int) -> dict:
    if not rows:
        return {"entries": 0, "total_bytes": 0, "earliest": None, "latest": None,
                "timeline": [], "zones": {}}
    ordered = sorted(rows, key=lambda r: r["_mtime"])
    zones = {}
    for r in rows:
        zones[r["zone"]] = zones.get(r["zone"], 0) + 1
    return {
        "entries": len(rows),
        "total_bytes": sum(r["bytes"] for r in rows),
        "earliest": {"path": ordered[0]["path"], "mtime_utc": ordered[0]["mtime_utc"]},
        "latest": {"path": ordered[-1]["path"], "mtime_utc": ordered[-1]["mtime_utc"]},
        "timeline": [{"path": r["path"], "mtime_utc": r["mtime_utc"], "bytes": r["bytes"]}
                     for r in reversed(ordered[-top:])],
        "zones": dict(sorted(zones.items())),
    }


def timeline_md(summary: dict) -> str:
    lines = ["| # | path | mtime_utc | bytes |", "| --- | --- | --- | --- |"]
    for i, row in enumerate(summary["timeline"], 1):
        lines.append("| %d | `%s` | %s | %d |" % (i, row["path"], row["mtime_utc"], row["bytes"]))
    return "\n".join(lines)


def run(root: str, out_md: str, out_json: str, top: int) -> int:
    files, scope = pick_scope(root)
    if not files:
        print("FATAL 扫描范围无文件: %s" % scope, file=sys.stderr)
        return 2
    rows = collect(root, files)
    summary = summarize(rows, top)
    summary["scope"] = scope
    summary["root"] = root
    summary["generated_utc"] = utc_iso(datetime.now(tz=timezone.utc).timestamp())

    print("LEDGER root=%s scope=%s entries=%d total_bytes=%d"
          % (root, scope, summary["entries"], summary["total_bytes"]))
    print("LEDGER earliest=%s@%s" % (summary["earliest"]["path"], summary["earliest"]["mtime_utc"]))
    print("LEDGER latest=%s@%s" % (summary["latest"]["path"], summary["latest"]["mtime_utc"]))
    print("LEDGER zones=%s" % json.dumps(summary["zones"], ensure_ascii=False))
    print("LEDGER header_columns=%d" % COLUMNS)

    if out_md:
        body = ["# Z6 证据台账 (evidence ledger)", "",
                "- 生成时间(UTC): %s" % summary["generated_utc"],
                "- 扫描根: `%s`" % root,
                "- 扫描范围: `%s`" % scope,
                "- 条目数: %d" % summary["entries"],
                "- 总字节: %d" % summary["total_bytes"],
                "- 最早 mtime: `%s` @ %s" % (summary["earliest"]["path"], summary["earliest"]["mtime_utc"]),
                "- 最晚 mtime: `%s` @ %s" % (summary["latest"]["path"], summary["latest"]["mtime_utc"]),
                "", "## 台账明细", "", markdown_table(rows),
                "", "## 时间线 (top %d, 新->旧)" % top, "", timeline_md(summary), ""]
        with open(out_md, "w", encoding="utf-8") as fh:
            fh.write("\n".join(body))
        print("LEDGER wrote_md=%s bytes=%d" % (out_md, os.path.getsize(out_md)))

    if out_json:
        with open(out_json, "w", encoding="utf-8") as fh:
            json.dump({"summary": summary,
                       "rows": [{k: v for k, v in r.items() if k != "_mtime"} for r in rows]},
                      fh, ensure_ascii=False, indent=2)
        print("LEDGER wrote_json=%s bytes=%d" % (out_json, os.path.getsize(out_json)))
    return 0


def selftest() -> int:
    """对两个自造临时文件断言：哈希长 64、字节数正确、表头列数 5。"""
    checks = []
    with tempfile.TemporaryDirectory(prefix="z6-selftest-") as tmp:
        blobs = [("a.txt", b"Z6-evidence-alpha\n"),
                 ("b.bin", bytes(range(256)) * 3)]
        for name, data in blobs:
            with open(os.path.join(tmp, name), "wb") as fh:
                fh.write(data)
        rows = collect(tmp, walk(tmp, ["."]))
        assert len(rows) == 2, "期望 2 条，实得 %d" % len(rows)
        for row, (name, data) in zip(sorted(rows, key=lambda r: r["path"]), sorted(blobs)):
            checks.append(("len(sha256)==64:%s" % name, len(row["sha256"]) == 64))
            checks.append(("bytes==%d:%s" % (len(data), name), row["bytes"] == len(data)))
            checks.append(("hash==hashlib:%s" % name,
                           row["sha256"] == hashlib.sha256(data).hexdigest()))
        checks.append(("header_columns==5", COLUMNS == 5))
        checks.append(("markdown_header_cells==5",
                       markdown_table(rows).splitlines()[0].count("|") == COLUMNS + 1))
        checks.append(("mtime_iso8601_utc",
                       all(r["mtime_utc"].endswith("Z") and "T" in r["mtime_utc"] for r in rows)))
        summary = summarize(rows, 10)
        checks.append(("summary_entries==2", summary["entries"] == 2))
        checks.append(("summary_total_bytes",
                       summary["total_bytes"] == sum(len(d) for _, d in blobs)))
        checks.append(("timeline<=10", len(summary["timeline"]) == 2))

    bad = [name for name, ok in checks if not ok]
    for name, ok in checks:
        print("SELFTEST %s %s" % ("PASS" if ok else "FAIL", name))
    print("SELFTEST checks=%d passed=%d failed=%d" % (len(checks), len(checks) - len(bad), len(bad)))
    return 1 if bad else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Z6 evidence ledger")
    here = os.path.abspath(__file__)
    ap.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.dirname(here)))))
    ap.add_argument("--md", default="")
    ap.add_argument("--json", default="")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(argv)
    if args.selftest:
        return selftest()
    if not os.path.isdir(args.root):
        print("FATAL --root 不是目录: %s" % args.root, file=sys.stderr)
        return 2
    return run(os.path.abspath(args.root), args.md, args.json, args.top)


if __name__ == "__main__":
    sys.exit(main())
