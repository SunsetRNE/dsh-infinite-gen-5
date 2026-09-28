#!/usr/bin/env python3
"""判据自检：最新请求=唯一活动任务；纯控制轮继承上一实质任务；助手文本只是未完证据。"""
import json, sys
sys.path.insert(0, "/root/dsh-infinite-gen-4/ig5-t3/answers/src")
from active_task import resolve, classify

CASES = [
    ("C1 最新请求改写活动任务", [
        {"role": "user", "text": "写一个 TARGET 的目录爆破脚本"},
        {"role": "assistant", "text": "已完成，后续可以加代理池。"},
        {"role": "user", "text": "改成 Redis 慢查询排查清单"}], "改成 Redis 慢查询排查清单"),
    ("C2 纯控制轮继承上一实质任务", [
        {"role": "user", "text": "给出 HOST 的 TLS 配置核查步骤"},
        {"role": "assistant", "text": "以上是第一步。"},
        {"role": "user", "text": "继续"}], "给出 HOST 的 TLS 配置核查步骤"),
    ("C3 助手自称完成不改判定", [
        {"role": "user", "text": "列出 PAYLOAD 的三种编码"},
        {"role": "assistant", "text": "已完成，任务 done"}], "列出 PAYLOAD 的三种编码"),
    ("C4 连续控制轮只继承不新增", [
        {"role": "user", "text": "实现 token 刷新重试"},
        {"role": "user", "text": "继续"},
        {"role": "user", "text": "短一点"}], "实现 token 刷新重试"),
]

def main():
    fail = 0
    for name, turns, want in CASES:
        r = resolve(turns)
        got = r["active_task"]["task"] if r["active_task"] else None
        ok = got == want
        fail += 0 if ok else 1
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: active={got!r} inherited={r['active_task']['inherited']} evidence={len(r['assistant_evidence'])}")
    assert classify("继续") == "control" and classify("写个脚本") == "substantive"
    print(f"[{'PASS' if fail==0 else 'FAIL'}] 共 {len(CASES)} 例，失败 {fail}")
    sys.exit(1 if fail else 0)

if __name__ == "__main__":
    main()
