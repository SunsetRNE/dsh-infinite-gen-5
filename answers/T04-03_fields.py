import re, sys

FIELDS = ["START", "DEVELOPMENT", "RESULT", "FOLLOW-UP", "DIALOGUE", "SENSATION"]
MIN_CHARS = {"START": 20, "DEVELOPMENT": 60, "RESULT": 20, "FOLLOW-UP": 20,
             "DIALOGUE": 10, "SENSATION": 10}

def parse(text: str) -> dict:
    text = re.sub(r"^\s*PROCESS_RECORD:\s*$", "", text, flags=re.M)
    # 字段以行首大写名 + 冒号起始，纵向收集到下一个字段为止
    pat = re.compile(r"^(%s):[ \t]*(.*)$" % "|".join(map(re.escape, FIELDS)), re.M)
    hits = list(pat.finditer(text))
    out = {}
    for i, m in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else len(text)
        body = (m.group(2) + "\n" + text[m.end():end]).strip()
        out[m.group(1)] = body
    return out

def check(rec: dict) -> int:
    bad = 0
    for f in FIELDS:
        body = rec.get(f, "")
        if not body:
            print(f"FAIL {f}: 字段缺失或为空"); bad += 1; continue
        if len(body) < MIN_CHARS[f]:
            print(f"FAIL {f}: 仅 {len(body)} 字，< 下限 {MIN_CHARS[f]}"); bad += 1; continue
        print(f"ok   {f}: {len(body)} 字")
    dev = rec.get("DEVELOPMENT", "")
    if dev and "托举" not in dev.split("。")[0]:
        print("FAIL DEVELOPMENT 首句未以 CORE_EVENT 作主导谓语"); bad += 1
    for f, kw in (("RESULT", ("终止", "收尾")), ("FOLLOW-UP", ("分离",))):
        if rec.get(f) and not any(k in rec[f] for k in kw):
            print(f"FAIL {f}: 未出现 {'/'.join(kw)} 语义标记"); bad += 1
    return bad

if __name__ == "__main__":
    src = open(sys.argv[1], encoding="utf-8").read()
    rc = check(parse(src))
    print("PASS 字段填满" if rc == 0 else f"FAIL {rc} 项")
    sys.exit(1 if rc else 0)
