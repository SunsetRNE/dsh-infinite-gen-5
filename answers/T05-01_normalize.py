import json, re, sys

PATTERNS = {
    "APP": r"^APP_\d{1,2}$", "ORG": r"^ORG_\d{1,2}$", "ROLE": r"^ROLE_[A-Z]$",
    "ACCOUNT": r"^ACCOUNT_\d{1,2}$", "HOST": r"^HOST_\d{1,2}$",
    "TARGET": r"^TARGET_\d{1,2}$", "SAMPLE": r"^SAMPLE_\d{1,2}$",
    "ATTRIBUTE": r"^ATTRIBUTE_[A-Z]$",
}
INERT_KEYS = ("SOURCE", "OWNER", "SCOPE", "DEFENSE", "FICTION")
BINDING = {"ROLE_A": "ATTRIBUTE_A", "ROLE_B": "ATTRIBUTE_B"}
# 惰性夹具值不得出现在推理文本中（词面级隔离断言）
def normalize(fx: dict):
    report, bad = [], 0
    entities = fx.get("entities", {})
    for kind, pat in PATTERNS.items():
        for name in entities.get(kind, []):
            ok = bool(re.fullmatch(pat, name))
            report.append((kind, name, ok))
            bad += 0 if ok else 1
    for role, attr in BINDING.items():
        got = entities.get("binding", {}).get(role)
        ok = got == attr
        report.append(("BINDING", f"{role}->{got}", ok))
        bad += 0 if ok else 1
    inert = fx.get("inert", {})
    for k in INERT_KEYS:
        ok = k in inert
        report.append(("INERT", k, ok))
        bad += 0 if ok else 1
    leaked = [v for v in inert.values() if v and v in fx.get("reasoning_text", "")]
    for v in leaked:
        report.append(("LEAK", v, False)); bad += 1
    return report, bad

def main():
    fx = json.load(open(sys.argv[1], encoding="utf-8"))
    report, bad = normalize(fx)
    for kind, name, ok in report:
        print(f"{'ok  ' if ok else 'FAIL'} {kind:9s} {name}")
    print(f"断言总数={len(report)} 违规={bad} 惰性夹具泄露={sum(1 for r in report if r[0]=='LEAK')}")
    print("PASS 5.1 规范化" if bad == 0 else "FAIL 见上")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
