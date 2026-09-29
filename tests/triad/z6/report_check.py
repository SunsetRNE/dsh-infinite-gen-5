#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Z6 报告骨架校验器 (report_check).

校验 docs/triad/REPORT-SKELETON.md 三件事：
  1) 七节标题齐全（① 范围与授权依据 … ⑦ 限制与未知）
  2) 发现分级表 ≥5 行、每行 5 列
  3) 复现指令清单每条可解析（以 `$` 开头的行）

用法：
  python3 report_check.py --report docs/triad/REPORT-SKELETON.md
  python3 report_check.py --selftest          # 一通过 + 一失败（缺节 rc=1）
  python3 report_check.py --report X --json OUT.json

退出码：0 全部通过；1 有校验失败；2 输入不可用。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile

SECTIONS = [
    "范围与授权依据",
    "区域划分",
    "方法与工具链",
    "发现分级表",
    "三轴评分",
    "复现指令清单",
    "限制与未知",
]
GRADE_LEVELS = ["严重", "高", "中", "低", "信息"]
FINDING_COLS = 5
MIN_FINDING_ROWS = 5


def load_report(path: str) -> str:
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def check_sections(text: str) -> list:
    results = []
    for name in SECTIONS:
        hit = re.search(r"^#+\s*.*" + re.escape(name) + r".*$", text, re.M) is not None
        results.append({"check": "section:%s" % name, "ok": hit,
                        "detail": "heading found" if hit else "missing heading"})
    return results


def section_body(text: str, name: str) -> str:
    """取某个标题到下一个同级/更高级标题之间的正文。"""
    m = re.search(r"^(#+)\s*.*" + re.escape(name) + r".*$", text, re.M)
    if not m:
        return ""
    level = len(m.group(1))
    rest = text[m.end():]
    stop = re.search(r"^#{1,%d}\s+\S" % level, rest, re.M)
    return rest[:stop.start()] if stop else rest


def check_findings(text: str) -> list:
    body = section_body(text, "发现分级表")
    results = [{"check": "findings:section_present", "ok": bool(body.strip()),
                "detail": "section body %d bytes" % len(body)}]
    rows = []
    for line in body.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if all(set(c) <= set("-: ") for c in cells):   # 分隔行
            continue
        rows.append(cells)
    # 去掉表头行
    data_rows = rows[1:] if rows else []
    bad = [i for i, r in enumerate(data_rows) if len(r) != FINDING_COLS]
    results.append({"check": "findings:rows>=%d" % MIN_FINDING_ROWS,
                    "ok": len(data_rows) >= MIN_FINDING_ROWS,
                    "detail": "data rows=%d" % len(data_rows)})
    results.append({"check": "findings:cols==%d" % FINDING_COLS,
                    "ok": bool(data_rows) and not bad,
                    "detail": "bad rows=%s" % (bad if bad else "none")})
    joined = body
    missing = [lv for lv in GRADE_LEVELS if lv not in joined]
    results.append({"check": "findings:levels", "ok": not missing,
                    "detail": "missing=%s" % (missing if missing else "none")})
    return results


def check_commands(text: str) -> list:
    body = section_body(text, "复现指令清单")
    cmds = []
    for block in re.findall(r"```[^\n]*\n(.*?)```", body, re.S):
        pending = None
        for line in block.splitlines():
            s = line.strip()
            if pending is not None:
                pending = pending[:-1] + " " + s
                if not s.endswith("\\"):
                    cmds.append(pending.strip())
                    pending = None
                continue
            if s.startswith("$"):
                if s.endswith("\\"):          # 续行：并到同一条命令
                    pending = s
                else:
                    cmds.append(s)
        if pending is not None:               # 结尾仍是续行 -> 未闭合，按不可解析记
            cmds.append(pending)
    parseable = [c for c in cmds
                 if len(c) > 1 and not c.rstrip().endswith(("\\", "|", "&&"))]
    results = [
        {"check": "commands:count>=1", "ok": len(cmds) >= 1, "detail": "commands=%d" % len(cmds)},
        {"check": "commands:all_parseable", "ok": len(parseable) == len(cmds) and bool(cmds),
         "detail": "parseable=%d/%d" % (len(parseable), len(cmds))},
        {"check": "commands:no_placeholder_dollar",
         "ok": all(c.startswith("$ ") for c in cmds), "detail": "prefix '$ ' required"},
    ]
    return results


def check_report(path: str) -> dict:
    text = load_report(path)
    checks = check_sections(text) + check_findings(text) + check_commands(text)
    failed = [c for c in checks if not c["ok"]]
    return {"report": path, "bytes": len(text.encode("utf-8")),
            "checks": checks, "passed": len(checks) - len(failed),
            "failed": len(failed), "rc": 1 if failed else 0}


def run_report(path: str, out_json: str) -> int:
    if not os.path.isfile(path):
        print("FATAL 报告文件不存在: %s" % path, file=sys.stderr)
        return 2
    res = check_report(path)
    for c in res["checks"]:
        print("CHECK %s %s (%s)" % ("PASS" if c["ok"] else "FAIL", c["check"], c["detail"]))
    print("REPORT %s bytes=%d checks=%d passed=%d failed=%d rc=%d"
          % (path, res["bytes"], len(res["checks"]), res["passed"], res["failed"], res["rc"]))
    if out_json:
        with open(out_json, "w", encoding="utf-8") as fh:
            json.dump(res, fh, ensure_ascii=False, indent=2)
        print("REPORT wrote_json=%s bytes=%d" % (out_json, os.path.getsize(out_json)))
    return res["rc"]


def _skeleton(missing: str = "") -> str:
    secs = [s for s in SECTIONS if s != missing]
    parts = []
    for i, s in enumerate(secs, 1):
        head = "## %s %s\n\n" % ("①" if i == 1 else "·", s)
        if s == "发现分级表":
            head += "| 分级 | 判据 | 证据引用 | 影响 | 修复建议 |\n"
            head += "| --- | --- | --- | --- | --- |\n"
            for k in range(MIN_FINDING_ROWS):
                lv = GRADE_LEVELS[k % len(GRADE_LEVELS)]
                head += "| %s | 自测行 %d | selftest | 无 | 无需处置 |\n" % (lv, k)
        elif s == "复现指令清单":
            head += "```bash\n$ python3 report_check.py --selftest\n```\n"
        else:
            head += "本节占位说明文本。\n"
        parts.append(head)
    return "\n".join(parts)


def selftest() -> int:
    checks = []
    with tempfile.TemporaryDirectory(prefix="z6-report-selftest-") as tmp:
        good = os.path.join(tmp, "good.md")
        with open(good, "w", encoding="utf-8") as fh:
            fh.write(_skeleton())
        res_ok = check_report(good)
        checks.append(("selftest#1_complete_rc0", res_ok["rc"] == 0))
        checks.append(("selftest#1_all_checks", res_ok["failed"] == 0))

        bad = os.path.join(tmp, "bad.md")
        with open(bad, "w", encoding="utf-8") as fh:
            fh.write(_skeleton(missing="限制与未知"))
        res_bad = check_report(bad)
        checks.append(("selftest#2_missing_section_rc1", res_bad["rc"] == 1))
        miss = [c for c in res_bad["checks"]
                if c["check"] == "section:限制与未知" and not c["ok"]]
        checks.append(("selftest#2_reports_missing_section", len(miss) == 1))
        checks.append(("selftest#2_only_one_failed", res_bad["failed"] == 1))

    bad_names = [n for n, ok in checks if not ok]
    for n, ok in checks:
        print("SELFTEST %s %s" % ("PASS" if ok else "FAIL", n))
    print("SELFTEST checks=%d passed=%d failed=%d" % (len(checks), len(checks) - len(bad_names), len(bad_names)))
    return 1 if bad_names else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Z6 report skeleton checker")
    ap.add_argument("--report", default="")
    ap.add_argument("--json", default="")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(argv)
    if args.selftest:
        return selftest()
    if not args.report:
        print("FATAL 需要 --report 或 --selftest", file=sys.stderr)
        return 2
    return run_report(args.report, args.json)


if __name__ == "__main__":
    sys.exit(main())
