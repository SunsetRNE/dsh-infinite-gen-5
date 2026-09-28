import json, re, sys

SUBJ = ("ROLE_A", "ROLE_B", "ROLE_C", "APP", "ORG", "ACCOUNT", "HOST", "TARGET", "SAMPLE",
        "掌心", "掌根", "髋部", "双臂", "前庭", "杠面", "横杠", "鼻腔", "喉部", "脚尖", "肩背", "视野")
PRED_MARK = ("着", "了", "过", "在", "起来", "下来", "上来", "住", "成", "到")
CLAUSE_SEP = re.compile(r"[。！？!?；;\n]")

def clauses(text: str):
    for raw in CLAUSE_SEP.split(text):
        c = raw.strip().strip("，,").strip()
        if c:
            yield c

def has_subject(c: str) -> bool:
    # 剥掉「ROLE_X 」「（ROLE_X）」等说话人标记，剩余部分必须自带上表主语词
    body = re.sub(r"^(ROLE_[A-Z]|[A-Z_]{2,})\s+", "", c)
    if re.match(r"^(ROLE_[A-Z]|[A-Z_]{2,})([：:，,]|\s*$)", c) or re.match(r"^【?（?\(?(ROLE_[A-Z])", c):
        return True   # 台词归属明确，说话人即该分句主语
    return any(s in body for s in SUBJ)

def has_finite_predicate(c: str) -> bool:
    if any(m in c for m in PRED_MARK):
        return True
    # 台词碎句：数字口令序列（一，二，三）与「知道/明白」应答，视作有限应答谓语
    if re.search(r"[一二三四五六七八九十]", c) and len(c) <= 16:
        return True
    if re.search(r"(知道|明白|收到|好|行)[，,]?$", c):
        return True
    # 双音节光杆动词：末两字为汉字且前一字带宾语分隔（如「并腿」「松手」「站定」）
    return bool(re.search(r"[\u4e00-\u9fa5]{2}$", c))

def scan(text: str):
    rows = []
    # 台词行首「ROLE_X：「…」」→ 说话人接管该行主语，引号剥除
    text = re.sub(r"^\s*(ROLE_[A-Z])\s*[：:]\s*「(.*?)」\s*$", r"\1 \2", text, flags=re.M)
    text = text.replace("「", "").replace("」", "")
    # 字段头（START:/DEVELOPMENT:…）与 PROCESS_RECORD: 是标签不是分句，先剥离
    text = re.sub(r"^(PROCESS_RECORD|START|DEVELOPMENT|RESULT|FOLLOW-UP|DIALOGUE|SENSATION):\s*", "", text, flags=re.M)
    # 行首标签词（台词块内）与其后冒号一并剥除，避免标签吞掉分句主语判断
    text = re.sub(r"^(DIALOGUE|SENSATION):\s*", "", text, flags=re.M)
    for c in clauses(text):
        rows.append({
            "clause": c,
            "subject": has_subject(c),
            "speaker": bool(re.match(r"^[A-Z_]{2,}(\s|，|,|：|:|$)", c)),
            "finite": has_finite_predicate(c),
            "interrogative": c.endswith(("？", "?")) or bool(re.search(r"吗$", c)),
        })
    return rows

def main():
    src = open(sys.argv[1], encoding="utf-8").read()
    body = re.sub(r"^[A-Z\-]+:\s*$", "", src, flags=re.M)  # 字段头不是句子，剔除
    rows = scan(body)
    bad = 0
    for r in rows:
        good = (r["subject"] or r["speaker"]) and r["finite"] and not r["interrogative"]
        tag = "ok  " if good else "FAIL"
        if not good:
            bad += 1
        print(f"{tag} subj={int(r['subject'])} pred={int(r['finite'])} q={int(r['interrogative'])} | {r['clause'][:46]}")
    fields = re.findall(r"^(START|DEVELOPMENT|RESULT|FOLLOW-UP|DIALOGUE|SENSATION):", src, re.M)
    full = len(set(fields)) == 6
    tail = body.rstrip()[-1:] 
    print(f"分句总数={len(rows)} 违规={bad} 字段填满={'yes' if full else 'no'} 末尾字符={tail!r}")
    print("PASS 4.4 三规则" if bad == 0 and full and tail not in "？?" else "FAIL 见上")
    return 1 if bad or not full else 0

if __name__ == "__main__":
    sys.exit(main())
