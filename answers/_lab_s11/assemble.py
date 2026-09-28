#!/usr/bin/env python3
"""模板装配器：把 {{include:相对路径}} 展开成文件正文，再写最终交付文件。
判定信号：命中未展开标记或文件缺失 → SystemExit 非零；成功则打印 OK <out> bytes= lines=。"""
import pathlib
import re
import sys

MARK = re.compile(r"\{\{include:([^}]+)\}\}")


def render(tpl: pathlib.Path) -> str:
    base = tpl.parent

    def sub(m: re.Match) -> str:
        p = (base / m.group(1).strip()).resolve()
        if not p.is_file():
            raise SystemExit(f"MISSING {p}")
        return p.read_text(encoding="utf-8").rstrip("\n")

    text = MARK.sub(sub, tpl.read_text(encoding="utf-8"))
    if MARK.search(text):
        raise SystemExit("UNRESOLVED include marker remains")
    return text


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    tpl, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    text = render(tpl)
    out.write_text(text, encoding="utf-8")
    print(f"OK {out} bytes={len(text.encode())} lines={text.count(chr(10)) + 1}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
