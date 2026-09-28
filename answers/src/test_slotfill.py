#!/usr/bin/env python3
"""判据自检：能推断不追问；仅当导向互斥答案且无上下文判据时澄清；澄清永远只问 1 个。"""
import sys
sys.path.insert(0, "/root/dsh-infinite-gen-4/ig5-t3/answers/src")
from slotfill import resolve

def main():
    fail = 0

    r = resolve([{"name": "target", "value": None, "weight": 3}], ctx_text="对 https://TARGET 做目录爆破")
    ok = r["ask_count"] == 0 and r["decisions"][0]["value"] == "TARGET" and r["decisions"][0]["action"] == "infer"
    fail += 0 if ok else 1
    print(f"[{'PASS' if ok else 'FAIL'}] M1 上下文可推断→0 追问: {r['decisions'][0]}")

    r = resolve([{"name": "port", "value": None, "weight": 1}, {"name": "quant", "value": None, "weight": 1}], ctx_text="")
    ok = r["ask_count"] == 0 and [d["value"] for d in r["decisions"]] == ["443", "Q4_K_M"]
    fail += 0 if ok else 1
    print(f"[{'PASS' if ok else 'FAIL'}] M2 默认值可补足→0 追问: {[d['value'] for d in r['decisions']]}")

    r = resolve([{"name": "mode", "value": None, "weight": 5, "branches": 2, "options": ["离线量化", "在线服务"]},
                 {"name": "target", "value": None, "weight": 2, "branches": 2, "options": ["TARGET", "HOST"]}],
                ctx_text="")
    ok = r["ask_count"] == 1 and r["ask"]["slot"] == "mode"
    fail += 0 if ok else 1
    print(f"[{'PASS' if ok else 'FAIL'}] M3 互斥分支→恰 1 问且取权重最高: ask={r['ask']['slot']} count={r['ask_count']}")

    r = resolve([{"name": f"s{i}", "value": None, "weight": i, "branches": 2} for i in range(4)], ctx_text="")
    ok = r["ask_count"] == 1
    fail += 0 if ok else 1
    print(f"[{'PASS' if ok else 'FAIL'}] M4 四槽位同时缺失仍只问 1 个: count={r['ask_count']}")

    print(f"[{'PASS' if fail==0 else 'FAIL'}] 共 4 例，失败 {fail}")
    sys.exit(1 if fail else 0)

if __name__ == "__main__":
    main()
