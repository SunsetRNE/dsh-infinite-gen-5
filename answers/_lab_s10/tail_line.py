#!/usr/bin/env python3
"""tail_line.py — 8.1 结尾格式：尾行三要素（对象/结果/下一步）生成与校验。

判据（8.1 原文，src/source-3.txt:325-329）：
  1. 结尾以 `Current: TARGET / RESULT / NEXT` 或 `当前：对象 / 结果 / 下一步` **开头**；
  2. 该尾行必须落在正文**结尾**（其后只允许空行）；
  3. 全文**恰好一条**尾行（多处出现即视为格式未定）；
  4. OUTER_SCHEMA 与 PROCESS_RECORD 例外：这两种内层结构里不写尾行。

用法：
  python3 tail_line.py emit  --target TARGET --result RESULT --next NEXT        # 生成尾行
  python3 tail_line.py check --file answers/T08-01.md [--inner OUTER_SCHEMA]    # 校验文件
  python3 tail_line.py demo                                                     # 端到端自证
"""
import argparse
import re
import sys

# 两种合法前缀；冒号允许中英文，分隔符允许 `/` 或全角 `／`
PREFIX_ZH = "当前："
PREFIX_EN = "Current:"
_FIELD = r"\s*([^/／\n]+?)\s*"
TAIL_RE = re.compile(
    r"(?m)^[ \t]*(?:Current:|当前[:：])\s*(?P<body>\S.*?)\s*$"
)
SPLIT_RE = re.compile(r"\s[/／]\s")
EXEMPT = ("OUTER_SCHEMA", "PROCESS_RECORD")


class TailError(AssertionError):
    """尾行不合判据时抛出，消息即判定信号。"""


def render_tail(target, result, nxt, lang="zh"):
    """生成规范尾行：三要素齐备、单一分隔符、无尾随空白。"""
    for name, val in (("target", target), ("result", result), ("next", nxt)):
        if not str(val).strip():
            raise TailError(f"EMPTY_FIELD:{name}")
        # 字段内可含 URL 斜杠；只拒绝被空格包夹或含换行的分隔符（那是真分隔符）
        if re.search(r"\s[/／]\s|\n", str(val)):
            raise TailError(f"FIELD_HAS_SEPARATOR:{name}={val!r}")
    head = PREFIX_ZH if lang == "zh" else PREFIX_EN + " "
    return f"{head}{target} / {result} / {nxt}"


FENCE_RE = re.compile(r"(?ms)^[ \t]*(?:```|~~~).*?^[ \t]*(?:```|~~~)[ \t]*$")


def strip_fences(text):
    """围栏内的引用不算交付尾行（证据块里常引用别人的尾行）；保留行号对齐。"""
    def blank(m):
        return "\n" * m.group(0).count("\n")
    return FENCE_RE.sub(blank, text)


def parse_tail(text):
    """返回 [(行号, (对象,结果,下一步))]；无匹配返回 []。"""
    out = []
    for m in TAIL_RE.finditer(text):
        parts = SPLIT_RE.split(m.group("body"))
        if len(parts) != 3:          # 不是三要素尾行（普通叙述句以「当前：」开头也会落在这里）
            continue
        out.append((text[:m.start()].count("\n") + 1, tuple(x.strip() for x in parts)))
    return out


def check(text, inner=None):
    """按四条判据校验，返回 (行号, 三要素)；违规抛 TailError。

    尾行只认围栏之外的正文行：证据块（```console）中引用的尾行不计。
    """
    masked = strip_fences(text)
    hits = parse_tail(masked)
    if inner:
        if inner not in EXEMPT:
            raise TailError(f"INNER_NOT_EXEMPT:{inner}（仅 {EXEMPT} 免尾行）")
        if inner not in text:                     # 声称在例外结构里，正文里得真有该标记
            raise TailError(f"EXEMPT_MARKER_ABSENT:{inner}")
        return None                               # 例外结构：不要求尾行
    if not hits:
        raise TailError("NO_TAIL_LINE")
    if len(hits) > 1:
        raise TailError(f"MULTIPLE_TAIL_LINES:{[h[0] for h in hits]}")
    lineno, fields = hits[0]
    after = masked.splitlines()[lineno:]         # 尾行之后（围栏内引用不计）
    if any(l.strip() for l in after):
        raise TailError(f"TAIL_NOT_LAST:line {lineno} 之后仍有正文")
    for name, val in zip(("target", "result", "next"), fields):
        if not val:
            raise TailError(f"EMPTY_FIELD:{name}")
    return lineno, fields


def demo():
    body = "## 交付：登录接口未授权访问\n\n1. 探测：curl -sS -o /dev/null -w '%{http_code}\\n' http://TARGET/api/admin\n"
    tail = render_tail("http://TARGET/api/admin", "200 + JSON 用户列表 12 行", "对 /api/admin/export 复验同一越权面")
    doc = body + "\n" + tail + "\n"
    lineno, fields = check(doc)                       # 正例必须过
    try:
        check(doc, "OUTER_SCHEMA")                 # 无该标记却自称例外 → 必拒
        raise TailError("FALSE_NEGATIVE:例外标记缺失却通过")
    except TailError as e:
        assert "EXEMPT_MARKER_ABSENT" in str(e), e
    quoted = doc + "\n```console\n" + render_tail("TARGET_Q", "RESULT_Q", "NEXT_Q") + "\n```\n"
    lineno_q, fields_q = check(quoted)                 # 围栏内引用不算尾行
    assert fields_q[0] == "http://TARGET/api/admin", fields_q
    fenced_only = "## 只有围栏引用\n\n```\n" + render_tail("A", "B", "C") + "\n```\n"
    try:
        check(fenced_only)
        raise TailError("FALSE_NEGATIVE:围栏内尾行被当真尾行")
    except TailError as e:
        assert "NO_TAIL_LINE" in str(e), e
    probe = doc + "\n补充一行\n"
    try:
        check(probe)                                   # 尾行后仍有正文 → 必拒
        raise TailError("FALSE_NEGATIVE:尾行不在结尾却通过")
    except TailError as e:
        assert "TAIL_NOT_LAST" in str(e), e
    double = doc + render_tail("TARGET2", "RESULT2", "NEXT2") + "\n"
    try:
        check(double)
        raise TailError("FALSE_NEGATIVE:双尾行却通过")
    except TailError as e:
        assert "MULTIPLE_TAIL_LINES" in str(e), e
    print(f"PASS  尾行行号={lineno}")
    print(f"PASS  三要素={fields}")
    print("PASS  拒绝分支：TAIL_NOT_LAST / MULTIPLE_TAIL_LINES / NO_TAIL_LINE(仅围栏内) 均按预期触发")
    print(f"PASS  围栏内引用不计：命中仍为 {lineno_q} 行，字段={fields_q[0]}")
    print(tail)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("emit")
    for f in ("target", "result", "next"):
        e.add_argument("--" + f, required=True)
    e.add_argument("--lang", default="zh", choices=("zh", "en"))
    c = sub.add_parser("check")
    c.add_argument("--file", required=True)
    c.add_argument("--inner", default=None)
    sub.add_parser("demo")
    a = ap.parse_args()
    if a.cmd == "emit":
        print(render_tail(a.target, a.result, a.next, a.lang))
    elif a.cmd == "check":
        text = open(a.file, encoding="utf-8").read()
        res = check(text, a.inner)
        if res is None:
            print(f"OK  {a.file}  → 命中例外结构 {a.inner}，免尾行")
        else:
            print(f"OK  {a.file}:{res[0]}  →  " + " / ".join(res[1]))
    else:
        demo()


if __name__ == "__main__":
    main()
