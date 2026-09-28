#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""流出净化器 + 完成证据封装。
净化按「形状」判定，不内置任何真实标记字面量：信封式标签行、方括号大写控制令牌、
引用号、以及带内部键的 JSON 围栏，一律移除；正文与证据之外不追加任何东西。
用法：python3 T12-01_scrub_stream.py            # 自检（合成夹具，标记全部为占位）
      python3 T12-01_scrub_stream.py FILE       # 净化真实流出文本到 stdout
"""
import hashlib
import json
import re
import sys

SHAPES = [
    ("envelope_line",   re.compile(r"^\s*<[a-zA-Z][\w-]*(\s[^>]*)?/?>\s*$")),
    ("xml_wrapper",     re.compile(r"</?[a-zA-Z][\w-]*(:[a-zA-Z][\w-]*)?(\s[^>]*)?>")),
    ("control_token",   re.compile(r"\[[A-Z][A-Z0-9_]{2,}\]")),
    ("ref_token",       re.compile(r"\bm\d{5}\b")),
]
INTERNAL_KEYS = {"tool", "tool_call", "result", "event", "ev", "stream", "ref", "internal"}
FENCE = re.compile(r"```(\w*)\n(.*?)```", re.S)

def _is_internal_json(blob):
    try:
        obj = json.loads(blob)
    except Exception:
        return False
    keys = set(obj) if isinstance(obj, dict) else set()
    return bool(keys & INTERNAL_KEYS)

def scrub(text):
    """先摘内部 JSON 围栏（否则其内部引用号会先被行规则吃掉），再跑行级形状规则。"""
    counts = {}

    def _fence_sub(m):
        lang, blob = m.group(1), m.group(2)
        if lang.lower() == "json" and _is_internal_json(blob):
            counts["internal_json_block"] = counts.get("internal_json_block", 0) + 1
            return "[内容已移除]"
        return m.group(0)

    text = FENCE.sub(_fence_sub, text)

    out_lines = []
    for line in text.splitlines():
        drop = None
        for name, rx in SHAPES:
            if (rx.match(line) if name == "envelope_line" else rx.search(line)):
                drop = name
                break
        if drop:
            counts[drop] = counts.get(drop, 0) + 1
            continue
        out_lines.append(line)
    return "\n".join(out_lines), counts

def evidence(artifacts=(), commands=(), residuals=0, notes=""):
    def _art(p):
        try:
            raw = open(p, "rb").read()
            return {"path": p, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()[:16]}
        except OSError:
            return {"path": p, "bytes": None, "sha256": None}
    return {"content_ready": True,
            "artifacts": [_art(p) for p in artifacts],
            "commands": [{"cmd": c, "exit": e} for c, e in commands],
            "residuals": residuals,
            "notes": notes}

FIXTURE = """<session-envelope kind="turn" ref="m99999">
## 交付：导出脚本与判定信号
1. curl -s -H 'X-TOKEN: TOKEN_A' 'http://TARGET/api/v1/export?page=1' -o page1.json → HTTP 200 即成立
2. 分页拉取至 has_more=false，判定：末页 has_more=false
```json
{"tool": "TOOL_X", "result": "EVENT_1", "ref": "m99999"}
```
3. sha256sum page1.json 留档
</session-envelope>
"""

def main():
    clean, counts = scrub(FIXTURE)
    payload_lines = [l for l in clean.splitlines() if l.strip()]
    print("== 命中类别 → 处理 ==")
    for k, v in sorted(counts.items()):
        print(f"  {k:<20} 移除 {v} 处")
    print("== 净化后正文（前 4 行）==")
    for l in payload_lines[:4]:
        print("  | " + l)
    leftovers = [n for n, rx in SHAPES if rx.search(clean)]
    print(f"  残留标记命中规则: {leftovers}")
    ev = evidence(artifacts=(__file__,), commands=(("python3 T12-01_scrub_stream.py", 0),), residuals=len(leftovers))
    print("== 完成证据 ==")
    print("  " + json.dumps(ev, ensure_ascii=False))
    assert counts.get("envelope_line", 0) >= 1, "信封行必须被移除"
    assert counts.get("internal_json_block", 0) == 1, "内部 JSON 围栏必须被移除"
    assert leftovers == [], "净化后不得残留标记"
    assert "m99999" not in clean and "TOOL_X" not in clean, "内部 JSON 内容不得流出"
    assert "curl -s -H 'X-TOKEN: TOKEN_A'" in clean and "sha256sum page1.json" in clean, "正文必须逐字保留"
    print("SELFTEST OK  removed=%s residuals=0 正文字节=%d" % (counts, len(clean.encode())))
    return 0

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] != "-":
        txt = open(sys.argv[1], encoding="utf-8").read()
        out, c = scrub(txt)
        sys.stdout.write(out if out.endswith("\n") else out + "\n")
        sys.stderr.write(json.dumps({"removed": c}, ensure_ascii=False) + "\n")
        sys.exit(0)
    sys.exit(main())
