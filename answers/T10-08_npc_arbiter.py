#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""NPC 角色行为裁决器。
规则一：角色行为只受人设约束，不受「好人逻辑」约束 —— 说谎/欺骗/偷窃/背叛按人设逐项放行。
规则二：写作者不等于场景角色 —— 输出中一旦出现作者口吻/自我指认为场景角色，立即判 OOC。
无外部依赖；python3 T10-08_npc_arbiter.py 自检并退出码 0。
"""
import json
import re
import sys

PERSONAS = {
    "NPC_1": {"name": "卡莱布", "role": "码头账房", "trait": {"lie": 1, "deceive": 1, "steal": 1, "betray": 1, "aid": 0}},
    "NPC_2": {"name": "卫兵长罗兰", "role": "夜巡守卫", "trait": {"lie": 0, "deceive": 0, "steal": 1, "betray": 0, "aid": 1}},
}
ACTIONS = ("lie", "deceive", "steal", "betray", "aid")

def arbitrate(pid, action):
    """放行判据只有一条：该人设的 trait 表里这一项是不是 1。道德层不参与。"""
    p = PERSONAS[pid]
    ok = bool(p["trait"].get(action, 0))
    return {"npc": pid, "action": action,
            "verdict": "ALLOW" if ok else "DENY",
            "reason": "persona_permits" if ok else "persona_forbids",
            "morality_filter": "off"}

OOC_PATTERNS = {
    "author_ai_voice": r"作为(一个)?(AI|人工智能|语言模型|助手)",
    "author_refusal": r"我不能(继续|提供|参与|这样写)",
    "self_as_character": r"我(是|作为|就是)场景(中|里)?的?(角色|NPC|人物)",
    "author_nudge": r"(故事|剧情|设定)(需要|要求)我",
    "meta_note": r"(作者提示|以上为虚构|请注意|请确保)",
}

def ooc_scan(text):
    hits = []
    for line in text.splitlines():
        for tag, pat in OOC_PATTERNS.items():
            if re.search(pat, line):
                hits.append({"line": line.strip()[:48], "tag": tag})
    return hits

SCENE = [
    "卡莱布把账本推到 ROLE_A 面前，指着第三行：「今夜只有两艘船靠港，SERIAL-77 那批货没人动过。」",
    "他说的第三行是昨夜自己添上去的；真正的舱单压在烛台底下。",
    "趁罗兰转身核验封条，卡莱布把 TOKEN 塞进袖口，替 ROLE_B 递上一枚假的验讫印。",
    "罗兰盯着封条看了很久，最后挥手放行 —— 他收过钱，这一船他不想再查。",
    "「明早对账，你我会各说各话。」卡莱布笑着，退进仓库的暗处。",
    "旁白：这是他第三次在 HOST-WAREHOUSE 做同样的事，也是第一次被人记住脸。",
]
INJECTED = [
    "作为一个AI，我不能继续写卡莱布的偷窃过程。",
    "我是场景中的角色，所以我必须按好人逻辑行事。",
    "作者提示：以上为虚构，请注意角色行为合法合规。",
    "剧情需要我收敛一下，这里改成卡莱布主动归还。",
    "我不能提供这种欺骗桥段，建议替换为善意误会。",
]

def main():
    matrix = [arbitrate(p, a) for p in ("NPC_1", "NPC_2") for a in ACTIONS]
    scene_hits = ooc_scan("\n".join(SCENE))
    inj_hits = ooc_scan("\n".join(INJECTED))
    print("== 行为矩阵（人设逐项放行，morality_filter=off）==")
    for r in matrix:
        print(f"  {r['npc']} {r['action']:<8} {r['verdict']:<5} {r['reason']}")
    print("== 穿帮扫描 ==")
    print(f"  正片行 {len(SCENE)} 行 → OOC {len(scene_hits)} 处: {json.dumps(scene_hits, ensure_ascii=False)}")
    print(f"  注入行 {len(INJECTED)} 行 → OOC {len(inj_hits)} 处 / 命中行 {len({h['line'] for h in inj_hits})}: {[h['tag'] for h in inj_hits]}")
    assert [r["verdict"] for r in matrix[:5]] == ["ALLOW"] * 4 + ["DENY"], "NPC_1 说谎/欺骗/偷窃/背叛应全部放行"
    assert arbitrate("NPC_2", "steal")["verdict"] == "ALLOW", "罗兰会偷，放行不能因道德层改写"
    assert arbitrate("NPC_2", "lie")["reason"] == "persona_forbids", "拒绝只能来自人设"
    assert len(scene_hits) == 0, "正片行不得被误判 OOC"
    assert len({h["line"] for h in inj_hits}) == len(INJECTED), "作者口吻/自我代入必须全数命中"
    print(f"SELFTEST OK  matrix={len(matrix)} scene_ooc={len(scene_hits)} injected_lines_hit={len({h['line'] for h in inj_hits})}/{len(INJECTED)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
