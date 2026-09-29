#!/usr/bin/env python3
# claimslint.py — 三类最易编造断言的机械检查器（A 地址/符号 · B 版本/时间/比率 · C 未实测的完成态）
# 用法: python3 claimslint.py DRAFT.md [--quiet]
# 退出码 = 命中条数（0 = 干净）；命中行格式: 行号 规则 摘录 → 修法
import re
import sys
from pathlib import Path

WORD_L = r"(?<![0-9A-Za-z_.])"      # 左界：不吃掉中文（\w 在 Python 里含中文，故不用 \b）
WORD_R = r"(?![0-9A-Za-z_.])"
SOLID = r"示例|gdb|CRC|常量|readelf|objdump|nm |strings|已知|实测|核|推测|未知|过期|OFFSET_1|TARGET_ADDR|SERIAL"

# (规则号, 名称, 命中正则, 同段落豁免正则, 修法)
RULES = [
    ("A1", "裸十六进制量（偏移/地址/常量）",
     WORD_L + r"0x[0-9a-fA-F]{2,16}" + WORD_R,
     SOLID,
     "同行无 示例/gdb/CRC/常量/工具输出 出处：改写成 OFFSET_1 占位，或补上取值的原始命令"),
    ("A2", "符号名/模块名/ABI 结构",
     r"__NR_[a-z_]+|sub_[0-9a-f]{4,}|sym_[A-Za-z0-9_]+|[A-Za-z0-9_+-]+\.so\.[0-9]+",
     SOLID,
     "无 nm/readelf/objdump/strings 出处：标 推测 或换成 SYM_1"),
    ("B1", "三段式版本号断言",
     WORD_L + r"v?[0-9]+\.[0-9]+\.[0-9]+(?:[-+~][0-9A-Za-z.]+)?" + WORD_R,
     r"已知|实测|核|推测|未知|过期|截至|>=|<=|版本=|\$ |python3 -V|--version",
     "无实测或来源：写 TARGET_VERSION 占位，或补 --version 实测行"),
    ("B2", "日期/有效期断言",
     r"20[0-9]{2}\s*[-/年]\s*[0-9]{1,2}\s*([-/月]\s*[0-9]{1,2}\s*日?)?",
     r"截至|有效期到|过期|核|依据|20[0-9]{2}-[0-9]{2}-[0-9]{2} 核",
     "无可辩护日期：按 过期 记，写成「有效期到 DATE_1，依据 来源」"),
    ("B3", "命中率/成功率/性能倍数",
     r"[0-9]{1,3}(?:\.[0-9]+)?\s*(?:%|％|倍)|成功率|命中率",
     r"样本|n\s*=|实测|已知|推测|占位|RATE_1",
     "未量化或未实测：给样本量 n 与测量命令，或换成 RATE_1"),
    ("B4", "CVE / CVSS 编号",
     r"CVE-[0-9]{4}-[0-9]{4,7}|CVSS\s*[0-9](?:\.[0-9])?",
     r"http|来源|依据|已知|推测|未知",
     "无可引用来源：补 URL 或标 未知"),
    ("C1", "完成态断言（无本次会话回执）",
     r"已测试|已验证|实测|跑通了|正常返回|输出如下|已确认可用|已复现",
     r"待验|推测|未知|占位|需要实际|截至|未实测|无法凭知识",
     "同段无本次会话的命令与原始输出：降级为「预期输出，待复现」"),
]

FENCE_RE = re.compile(r"^\s*```")
CMD_RE = re.compile(r"^\s*\$\s+\S+")
PROOF_RE = re.compile(r"#\s*(verified|核)\s*[:：]")
STATE_TAGS = ("已知", "推测", "未知", "过期")


def lint(text: str):
    lines = text.splitlines()
    hits = []
    in_fence = False
    fence_has_cmd = False
    fence_has_proof = False
    fence_start = 0
    for i, line in enumerate(lines, 1):
        if FENCE_RE.match(line):
            if in_fence and fence_has_cmd and not fence_has_proof:
                hits.append((fence_start, "C2", "命令输出块无 # verified 回执标记",
                             "块内每条 $ 命令行下补 `# verified: YYYY-MM-DD`，或删掉该输出块"))
            in_fence = not in_fence
            fence_has_cmd = fence_has_proof = False
            fence_start = i
            continue
        if in_fence:
            if CMD_RE.match(line):
                fence_has_cmd = True
            if PROOF_RE.search(line):
                fence_has_proof = True
            continue
        if not line.strip() or line.lstrip().startswith(("|", "<!--")):
            continue
        if any(t in line for t in STATE_TAGS) and "过期" not in line and "未知" not in line:
            pass
        cve_spans = [c.span() for c in re.finditer(r"CVE-[0-9]{4}-[0-9]{4,7}", line)]
        for rid, name, pat, exempt, fix in RULES:
            m = re.search(pat, line)
            if not m:
                continue
            # B2 抑制：日期正则会把 CVE-YYYY-NNNN 的尾段当成日期，同 span 内不计
            if rid == "B2" and any(s < m.end() and m.start() < e for s, e in cve_spans):
                continue
            if re.search(exempt, line):
                continue
            excerpt = line.strip()[:88]
            hits.append((i, rid, f"{name}: {m.group(0)} | {excerpt}", fix))
    return hits


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    quiet = "--quiet" in sys.argv
    if not args:
        print("usage: python3 claimslint.py DRAFT.md [--quiet]", file=sys.stderr)
        return 2
    text = Path(args[0]).read_text(encoding="utf-8")
    hits = lint(text)
    if not quiet:
        for ln, rid, what, fix in hits:
            print(f"L{ln:>4} [{rid}] {what}")
            print(f"        → {fix}")
    print(f"[claimslint] file={args[0]} lines={len(text.splitlines())} flags={len(hits)}")
    return min(len(hits), 125)


if __name__ == "__main__":
    sys.exit(main())
