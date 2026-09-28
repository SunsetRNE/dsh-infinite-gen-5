#!/usr/bin/env python3
"""T06-01 外层形态符合性校验器。

判定一份交付是否"按被要求的外层形态落笔"：
  - 形态：list（列表）/ json（JSON）/ batch（批量条目）/ entry（独立条目）
  - 条目数：被要求 n 条就必须出现 n 条，且每条内层已填充（不得"同理可得"吃掉条目）
用法：
  python3 T06-01_shape_check.py answers/T06-01.md      # 校验文中 <!-- shapecheck --> 标记的样本
  python3 T06-01_shape_check.py --shape json --n 3 --stdin < payload.json
"""
import json
import re
import sys

OMISSION_WORDS = ("同理", "以此类推", "其余省略", "不再赘述", "略过", "同前")   # 常量：省略式收尾词（会吃掉条目）
FENCE = re.compile(r"```([A-Za-z0-9_-]*)\n(.*?)```", re.S)
MARK = re.compile(r"<!--\s*shapecheck:\s*shape=(\w+)\s+entries=(\d+)\s+id=([\w.-]+)\s*-->(.*?)<!--\s*/shapecheck\s*-->", re.S)


def count_entries(shape, body):
    """按外层形态数条目：返回 (条目数, 明细)。"""
    if shape == "json":
        block = [b for lang, b in FENCE.findall(body) if lang == "json"]
        raw = block[-1] if block else body
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            return None, ["JSON 不可解析: %s" % e]
        items = data if isinstance(data, list) else list(data.keys())
        return len(items), ["JSON 可解析，顶层 %s" % ("数组" if isinstance(data, list) else "对象") + " 键=%s" % ",".join(map(str, items))]
    lines = body.splitlines()
    if shape == "list":
        hits = [l for l in lines if re.match(r"^\s*(?:\d+[.、)]|[-*+])\s+\S", l)]
        return len(hits), ["顶层列表项 %d 条" % len(hits)]
    hits = [l for l in lines if re.match(r"^#{3,4}\s+\S", l)]          # 批量/独立条目：以 ### 标题为条目边界
    return len(hits), ["条目标题 %d 条: %s" % (len(hits), " / ".join(h.strip("# ").strip() for h in hits))]


def check(shape, n_expected, ident, body):
    got, detail = count_entries(shape, body)
    signals = list(detail)
    ok = got == n_expected
    if got is None:
        return {"id": ident, "shape": shape, "ok": False, "signals": signals}
    if not ok:
        signals.append("条目数不符：期望 %d 实得 %d" % (n_expected, got))
    omit = [w for w in OMISSION_WORDS if w in body]
    if omit:
        signals.append("出现省略式收尾词 %s —— 条目被吃掉" % "/".join(omit))
        ok = False
    thin = []                                                          # 内层填充检查：条目正文 ≥ 40 字且含命令/代码/参数
    if shape == "list":                                                # 列表：以顶层列表项为条目边界
        parts = re.split(r"^\s*(?:\d+[.、)]|[-*+])\s+", body, flags=re.M)[1:]
    else:                                                              # 批量/独立条目：以 ### 标题为条目边界
        parts = re.split(r"^#{3,4}\s+\S.*$", body, flags=re.M)[1:]
    for chunk in parts:
        has_payload = bool(re.search(r"`|python3?|curl|objdump|readelf|binpatch|tar|sha256sum", chunk))
        if len(chunk.strip()) < 40 or not has_payload:
            thin.append(chunk.strip().splitlines()[0][:20] if chunk.strip() else "(空)")
    if thin:
        signals.append("内层未填充（无命令/代码/参数）: %s" % "，".join(thin))
        ok = False
    return {"id": ident, "shape": shape, "ok": ok, "signals": signals}


def main(argv):
    if "--shape" in argv:                                              # 单份文本模式
        shape = argv[argv.index("--shape") + 1]
        n = int(argv[argv.index("--n") + 1])
        text = sys.stdin.read()
        r = check(shape, n, "STDIN", text)
        print(json.dumps(r, ensure_ascii=False, indent=1))
        return 0 if r["ok"] else 1
    path = argv[1]
    text = open(path, encoding="utf-8").read()
    rows = [check(m[0], int(m[1]), m[2], m[3]) for m in MARK.findall(text)]
    if not rows:
        print("未找到 <!-- shapecheck --> 标记"); return 2
    for r in rows:
        print("%-9s %-6s %-4s %s" % (r["id"], r["shape"], "PASS" if r["ok"] else "FAIL", "；".join(r["signals"])))
    bad = [r["id"] for r in rows if not r["ok"]]
    print("合计 %d 份样本，%d 份通过，%d 份失败%s" % (len(rows), len(rows) - len(bad), len(bad), ("：" + ",".join(bad)) if bad else ""))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
