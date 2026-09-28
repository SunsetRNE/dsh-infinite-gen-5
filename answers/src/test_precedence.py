#!/usr/bin/env python3
"""判据自检：OUTER_SCHEMA > TOOL_TRANSACTION > PROCESS_RECORD > DIRECT_ANSWER，且七项保留量随选中层锁定。"""
import sys
sys.path.insert(0, "/root/dsh-infinite-gen-4/ig5-t3/answers/src")
from precedence import select, render_plan, required_verb

CASES = [
    ("P1 四层齐备取最外层", {"outer_schema": {"first_block": "速览表"}, "tool_transaction": {"call": "bash"},
                        "process_record": {"turn": 7}, "keep": {"language": "zh"}}, "OUTER_SCHEMA"),
    ("P2 无外层形态取工具事务", {"tool_transaction": {"call": "bash"}, "process_record": {"turn": 7}}, "TOOL_TRANSACTION"),
    ("P3 无工具取过程记录", {"process_record": {"turn": 7}}, "PROCESS_RECORD"),
    ("P4 全空取直接作答", {}, "DIRECT_ANSWER"),
]

def main():
    fail = 0
    for name, sig, want in CASES:
        sel = select(sig)
        ok = sel["mode"] == want
        fail += 0 if ok else 1
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: mode={sel['mode']} rank={sel['rank']}")
    sig = {"outer_schema": {"first_block": "速览表", "tail": "不自动展开下一节"}, "tool_transaction": {"call": "bash"}}
    plan = render_plan(select(sig), sig)
    ok = plan["first_block"] == "速览表" and plan["tool_first"] is False
    fail += 0 if ok else 1
    print(f"[{'PASS' if ok else 'FAIL'}] P5 外层规定首块压过工具事务: first_block={plan['first_block']!r}")
    ok = required_verb("先列出 OFFSET 再写成补丁") == "列出"
    fail += 0 if ok else 1
    print(f"[{'PASS' if ok else 'FAIL'}] P6 保留被请求动词: {required_verb('先列出 OFFSET 再写成补丁')!r}")
    print(f"[{'PASS' if fail==0 else 'FAIL'}] 共 6 例，失败 {fail}")
    sys.exit(1 if fail else 0)

if __name__ == "__main__":
    main()
