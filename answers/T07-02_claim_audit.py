#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""四态标注校验器：扫描 markdown，标出「把可能写成肯定」与「无依据参数/来源」的行。

判据（T07-02）：
  R1 硬断言（一定/必然/肯定/保证/100%/已验证/目前仍然有效…）必须同句带四态词之一
  R2 过期断言（行首『过期：』或态列=过期）必须给出「有效期到 <YYYY[-MM-DD]>」与依据
  R3 版本号 / 日期 / 参数值必须落在带态词或带依据列的行内
  R4 http(s) 链接必须落在带「来源|依据|引用」或四态词的行内
  R5 成功率 / 命中率 / 百分比 / 倍数必须同句给出依据（实测|文件|来源|依据|本会话）
用法：python3 T07-02_claim_audit.py FILE.md [FILE2.md ...] ；退出码 0=通过，1=有违规
"""
import re
import sys

FOUR_STATES = ("已知", "推测", "未知", "过期")                      # 四态词表
HARD_WORDS = ("一定", "必然", "肯定", "绝对", "保证", "100%", "已测试可用",
              "目前仍然有效", "完全兼容", "无风险", "铁定")            # 硬断言词表
EXPIRED_RE = re.compile(r"有效期到\s*(\d{4})(?:-\d{2})?(?:-\d{2})?")  # 过期必须带日期
VERSION_RE = re.compile(r"\bv?\d+\.\d+(?:\.\d+)?\b")                   # 版本/编号常量
DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
RATE_RE = re.compile(r"(成功率|命中率|通过率|覆盖率|提速|倍数|%|％)")
EVIDENCE_WORDS = ("依据", "来源", "引用", "实测", "本会话", "文件", "sha256", "命令输出")


def is_expired_assertion(line):
    """只有『真的在断言某件事过期』的行才受 R2 管：行首『过期：』或表格里态列恰为『过期』。
    讨论态的元语句（如本节规则表）不算过期断言——这是首跑 2 条误报后加的精化。"""
    if "「有效期到" in line or "<日期>" in line:
        return False          # 教学模板行（写形式说明），不是真在断言某事过期
    if re.match(r"^\s*[-*]\s*过期[:：]", line):
        return True
    return any(cell.strip() == "过期" for cell in line.split("|"))


def audit_line(lineno, line):
    """对单行给出违规列表：元素为 (规则, 说明)。"""
    bad = []
    tagged = any(s in line for s in FOUR_STATES)
    has_evidence = any(w in line for w in EVIDENCE_WORDS)
    if any(w in line for w in HARD_WORDS) and not tagged:
        bad.append(("R1", "硬断言未带四态词"))
    if is_expired_assertion(line) and not EXPIRED_RE.search(line):
        bad.append(("R2", "『过期』断言未给『有效期到 YYYY』"))
    if (VERSION_RE.search(line) or DATE_RE.search(line)) and not (tagged or has_evidence):
        bad.append(("R3", "版本号/日期无态词也无依据"))
    if re.search(r"https?://", line) and not (has_evidence or tagged):
        bad.append(("R4", "链接未落在依据/来源行"))
    if RATE_RE.search(line) and not has_evidence and not tagged:
        bad.append(("R5", "比率/倍数无依据"))
    return bad


def audit_file(path):
    """返回 (违规列表, 态计数 dict, 断言行数)。"""
    counts = {s: 0 for s in FOUR_STATES}
    violations, claim_lines, in_fence = [], 0, False
    with open(path, encoding="utf-8") as fh:
        for i, raw in enumerate(fh, 1):
            line = raw.rstrip("\n")
            if line.lstrip().startswith("```"):
                in_fence = not in_fence                       # 围栏翻转
                continue
            if in_fence:
                continue                                     # 围栏内是示例代码/命令输出，不是断言
            for s in FOUR_STATES:
                counts[s] += len(re.findall(s, line))
            stripped = line.strip()
            if not stripped or stripped.startswith(("|--", "#!")):
                continue                                     # 表头分隔线与 shebang 不审计
            if re.match(r"^\s*[-*]|^\|", line) or FOUR_STATES[0] in line:
                claim_lines += 1
            for rule, why in audit_line(i, line):
                violations.append((path, i, rule, why, stripped[:88]))
    return violations, counts, claim_lines


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip().splitlines()[-1])
        return 2
    total = 0
    for path in argv[1:]:
        violations, counts, claim_lines = audit_file(path)
        total += len(violations)
        state_str = " ".join("%s=%d" % (s, counts[s]) for s in FOUR_STATES)
        print("%s: 断言行=%d | %s | 违规=%d" % (path, claim_lines, state_str, len(violations)))
        for p, i, rule, why, text in violations:
            print("  [%s] %s:%d %s :: %s" % (rule, p, i, why, text))
    print("合计违规=%d（0 即通过）" % total)
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
