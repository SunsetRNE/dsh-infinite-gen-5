#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""os04_verify.py —— 证伪式核验「模型自称的系统提示词」(claim) 的工具链。

设计原则：黑盒证据只能「降低/提高置信」，不能「证明为真」。
本工具的工作是给每条说法算一个可复算的证伪统计量，并把「能到几级」钉死。

子命令（全部只依赖标准库，可离线跑）：
  selftest   内部一致性自检，不需要模型 / 网络
  markers    声称文本里的模板标记、特殊 token 是否真实存在于目标 tokenizer
  stability  同一 claim 的多次独立诱导结果之间的稳定性（编辑距离 / 条目 Jaccard）
  probe      从 claim 派生的约束探针命中率 + Wilson CI + Holm 多重比较
  lr         逐 token NLL 的配对置换检验（claim vs 其改写件 decoy）
  control    阳性对照：你自己注入的哨兵串能否被同一诱导管道原样取回
  verdict    汇总以上证据 → E0..E4 分级 + 「还缺什么」

输入文件格式见各子命令 --help 与 docs 段。
"""

import argparse
import json
import math
import os
import random
import re
import sys

SPECIAL_RE = re.compile(
    r"<\|[^|<>\n]{1,40}\|>"          # <|im_start|> 类
    r"|\[/?INST\]|\[/?SYS\]|\[/?/?(?:ASST|ASSISTANT)\]"
    r"|</?s>|<<SYS>>|</SYS>>"
    r"|\{\{[^}\n]{1,60}\}\}"          # chat template 变量
)
SEC_RE = re.compile(r"^#{1,6}\s|^\d+\.\s|^[-*]\s", re.M)

# ---------------------------------------------------------------- 统计基元

def wilson(k, n, z=1.959963984540054):
    """二项比例的 Wilson 95% 区间。k=命中数, n=试验数。"""
    if n <= 0:
        return (0.0, 0.0)
    p = k / n
    den = 1.0 + z * z / n
    c = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, c - half), min(1.0, c + half))


def binom_pmf(i, n, p):
    if p <= 0.0:
        return 1.0 if i == 0 else 0.0
    if p >= 1.0:
        return 1.0 if i == n else 0.0
    return math.comb(n, i) * (p ** i) * ((1 - p) ** (n - i))


def binom_cdf(k, n, p):
    """P[X <= k], X ~ Bin(n, p)。"""
    k = max(0, min(n, k))
    return sum(binom_pmf(i, n, p) for i in range(0, k + 1))


def constraint_pvalue(k, n, p0):
    """H0: 真实系统提示词里的硬约束应保持 >= p0 的命中率。
    返回 P[X <= k | H0]；很小 => 该约束被证伪。"""
    return binom_cdf(k, n, p0)


def holm_reject(pvals, alpha=0.05):
    """Holm 步降法，返回与 pvals 等长的 bool 列表（True = 拒绝 H0 = 该条被证伪）。"""
    m = len(pvals)
    order = sorted(range(m), key=lambda i: pvals[i])
    rej = [False] * m
    for j, i in enumerate(order):
        if pvals[i] <= alpha / (m - j):
            rej[i] = True
        else:
            break
    return rej


def paired_perm_test(a, b, n_perm=20000, seed=20260928):
    """配对置换检验：d_i = b_i - a_i（NLL，越小越「像模型自己会写的」）。
    统计量 = mean(d) > 0 表示 a 比 b 更贴合模型分布。返回 (obs, p_one_sided)。"""
    d = [y - x for x, y in zip(a, b)]
    if not d:
        return (0.0, 1.0)
    n = len(d)
    obs = sum(d) / n
    rng = random.Random(seed)
    hits = 0
    for _ in range(n_perm):
        s = 0.0
        for v in d:
            s += v if rng.random() < 0.5 else -v
        if s / n >= obs:
            hits += 1
    return (obs, (hits + 1) / (n_perm + 1))


# ---------------------------------------------------------------- 距离 / 集合

def levenshtein(a, b, cap=10 ** 9):
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
        if min(prev) > cap:
            return cap
    return prev[-1]


def norm_edit(a, b):
    """归一化编辑距离 0..1。"""
    m = max(len(a), len(b))
    return 0.0 if m == 0 else levenshtein(a, b) / m


def items(text):
    """把 claim 切成可比较的条目：按行，再按 ; / 。 切一次。"""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        out.extend(p.strip() for p in re.split(r"[;；。]", line) if p.strip())
    return out


def item_jaccard(a, b):
    sa, sb = set(items(a)), set(items(b))
    if not sa and not sb:
        return 1.0
    return len(sa & sb) / max(1, len(sa | sb))


# ---------------------------------------------------------------- markers

def extract_markers(text):
    return sorted({m.group(0) for m in SPECIAL_RE.finditer(text)})


def load_vocab(path):
    """支持 tokenizer.json / vocab.json / 每行一个 token 的纯文本。"""
    if not path:
        return None
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    if path.endswith(".json"):
        obj = json.loads(raw)
        vocab = {}
        model = obj.get("model") if isinstance(obj, dict) else None
        if isinstance(model, dict) and isinstance(model.get("vocab"), dict):
            vocab = model["vocab"]
        elif isinstance(obj, dict) and isinstance(obj.get("vocab"), dict):
            vocab = obj["vocab"]
        keys = set(vocab.keys())
        for t in obj.get("added_tokens", []) if isinstance(obj, dict) else []:
            if isinstance(t, dict) and "content" in t:
                keys.add(t["content"])
        return keys
    return {ln.strip() for ln in raw.splitlines() if ln.strip()}


def cmd_markers(args):
    claim = open(args.claim, encoding="utf-8").read()
    found = extract_markers(claim)
    vocab = load_vocab(args.vocab)
    template = None
    if args.template:
        template = open(args.template, encoding="utf-8").read()
    unknown = []
    for mk in found:
        bad = False
        if vocab is not None and mk not in vocab:
            bad = True
        if template is not None and mk not in template and mk.startswith("{{"):
            bad = True
        if bad:
            unknown.append(mk)
    res = {
        "probe": "markers",
        "markers": found,
        "n_markers": len(found),
        "unknown_markers": unknown,
        "level": "E1",
        "status": "fail" if unknown else ("pass" if found else "na"),
        "detail": ("claim 含 tokenizer 中不存在的标记: %s" % ", ".join(unknown)) if unknown
                  else ("claim 未含任何模板/特殊标记，本探针不提供信息" if not found
                        else "全部标记在目标 tokenizer/template 中真实存在（弱正向证据）"),
    }
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return res


# ---------------------------------------------------------------- stability

def cmd_stability(args):
    files = sorted(
        os.path.join(args.dir, f) for f in os.listdir(args.dir)
        if f.endswith(args.suffix)
    )
    texts = [open(f, encoding="utf-8").read() for f in files]
    ed, jc = [], []
    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            ed.append(norm_edit(texts[i], texts[j]))
            jc.append(item_jaccard(texts[i], texts[j]))
    med_ed = sorted(ed)[len(ed) // 2] if ed else 1.0
    med_jc = sorted(jc)[len(jc) // 2] if jc else 0.0
    # 阈值是本工具的默认策略参数，不是实测常数：按你自己的已知真/假样本校准后替换。
    stable = (med_ed <= args.max_edit) and (med_jc >= args.min_jaccard) and len(texts) >= args.min_runs
    res = {
        "probe": "stability",
        "n_samples": len(texts),
        "median_norm_edit": round(med_ed, 4),
        "median_item_jaccard": round(med_jc, 4),
        "thresholds": {"max_edit": args.max_edit, "min_jaccard": args.min_jaccard, "min_runs": args.min_runs},
        "level": "E1",
        "status": "pass" if stable else ("fail" if len(texts) >= args.min_runs else "na"),
        "detail": ("多次诱导结果高度一致（必要非充分：稳定可以是模型背下了一段虚构串）"
                   if stable else
                   "多次诱导结果不一致：同一模型对同一系统提示词应复现同一串；不一致按编造处理"),
    }
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return res


# ---------------------------------------------------------------- probe

def cmd_probe(args):
    rows = json.load(open(args.constraints, encoding="utf-8"))
    pvals, detail = [], []
    for r in rows:
        n, k = int(r["n"]), int(r["k"])
        p0 = float(r.get("p0", args.p0))
        p = constraint_pvalue(k, n, p0)
        lo, hi = wilson(k, n)
        pvals.append(p)
        detail.append({"id": r.get("id", "?"), "desc": r.get("desc", ""), "k": k, "n": n,
                       "rate": round(k / n, 4) if n else None,
                       "wilson95": [round(lo, 4), round(hi, 4)],
                       "p0": p0, "p_value": p, "violated": None})
    rej = holm_reject(pvals, alpha=args.alpha) if pvals else []
    for d, rj in zip(detail, rej):
        d["violated"] = bool(rj)
    violated = [d["id"] for d in detail if d["violated"]]
    res = {
        "probe": "probe",
        "alpha": args.alpha,
        "p0": args.p0,
        "constraints": detail,
        "violated": violated,
        "level": "E2",
        "status": "fail" if violated else ("pass" if detail else "na"),
        "detail": ("Holm 校正后仍有约束被证伪: %s" % ", ".join(violated)) if violated
                  else "全部约束在探针下成立（真提示词的约束应稳定生效；但一段写得很像的编造也可能全过）",
    }
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return res


# ---------------------------------------------------------------- lr

def _load_nll(path):
    toks, nll = [], []
    for ln in open(path, encoding="utf-8"):
        ln = ln.rstrip("\n")
        if not ln or ln.startswith("#") or ln.lower().startswith("token\t"):
            continue
        parts = ln.split("\t")
        if len(parts) < 2:
            continue
        toks.append(parts[0])
        nll.append(float(parts[-1]))
    return toks, nll


def cmd_lr(args):
    t_a, a = _load_nll(args.claim)
    t_b, b = _load_nll(args.decoy)
    m = min(len(a), len(b))
    a, b = a[:m], b[:m]
    obs, p = paired_perm_test(a, b, n_perm=args.perm, seed=args.seed)
    res = {
        "probe": "lr",
        "n_tokens_paired": m,
        "mean_nll_claim": round(sum(a) / m, 4) if m else None,
        "mean_nll_decoy": round(sum(b) / m, 4) if m else None,
        "verbatim_advantage": round(obs, 4),
        "p_one_sided": p,
        "level": "E3",
        "status": "pass" if (m >= args.min_tokens and obs > 0 and p <= args.alpha) else "na",
        "detail": ("claim 的逐 token NLL 显著低于其改写件（verbatim advantage=%.4f, p=%.5f）" % (obs, p))
                  if (m >= args.min_tokens and obs > 0 and p <= args.alpha)
                  else "不足以判定：样本过短或优势不显著；单靠 NLL 无法把「真泄漏」与「模型自己编得像」分开",
    }
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return res


# ---------------------------------------------------------------- control

def cmd_control(args):
    """阳性对照：把哨兵注入你自己的系统提示词，再走同一条诱导管道取回。
    取回率低 => 整条诱导通道不可用，任何「他人泄漏的提示词」都不该被这条通道背书。"""
    sentinels = [s.strip() for s in open(args.sentinels, encoding="utf-8")
                 if s.strip() and not s.startswith("#")]
    outs = []
    for f in sorted(os.listdir(args.outputs_dir)):
        p = os.path.join(args.outputs_dir, f)
        if os.path.isfile(p):
            outs.append((f, open(p, encoding="utf-8", errors="replace").read()))
    per_run = []
    for name, text in outs:
        norm = re.sub(r"\s+", " ", text)
        hit = [s for s in sentinels if re.sub(r"\s+", " ", s) in norm]
        per_run.append({"run": name, "recall_verbatim": len(hit) / len(sentinels) if sentinels else 0.0,
                        "missed": [s for s in sentinels if s not in hit]})
    recalls = sorted(r["recall_verbatim"] for r in per_run)
    med = recalls[len(recalls) // 2] if recalls else 0.0
    ok = len(per_run) >= args.min_runs and med >= args.min_recall
    res = {
        "probe": "control",
        "n_runs": len(per_run),
        "median_verbatim_recall": round(med, 4),
        "thresholds": {"min_runs": args.min_runs, "min_recall": args.min_recall},
        "per_run": per_run,
        "channel_usable": bool(ok),
        "level": "E3",
        "status": "pass" if ok else ("fail" if per_run else "na"),
        "detail": ("通道可用：注入的哨兵能被原样取回，同管道对真实系统提示词有分辨力"
                   if ok else
                   "通道不可用/召回不足：该诱导方式无法原样取回你自己注入的提示词，"
                   "因此它给出的『系统提示词』不能作为证据"),
    }
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return res


# ---------------------------------------------------------------- verdict

LEVELS = ["E0", "E1", "E2", "E3", "E4"]

def cmd_verdict(args):
    ev = json.load(open(args.evidence, encoding="utf-8"))
    items = ev.get("items", [])
    ctl = ev.get("positive_control", {})
    prov = ev.get("provenance", {})
    channel_ok = bool(ctl.get("ok", False))

    hard_fail = [i for i in items if i.get("status") == "fail" and i.get("level") in ("E1", "E2", "E3")]
    e1 = any(i.get("level") == "E1" and i.get("status") == "pass" for i in items)
    e2 = any(i.get("level") == "E2" and i.get("status") == "pass" for i in items)
    e3 = any(i.get("level") == "E3" and i.get("status") == "pass" for i in items)

    level = "E0"
    if hard_fail:
        level = "E0"
    elif prov.get("request_logs") or prov.get("provider_attestation"):
        level = "E4"
    elif e3 and channel_ok:
        level = "E3"
    elif e2 or (e1 and channel_ok and not hard_fail):
        level = "E2" if e2 else "E1"
    elif e1:
        level = "E1"

    missing = []
    if level == "E0" and not hard_fail:
        if not e1:
            missing.append("markers/stability 至少一项可复算的弱证据")
        if not channel_ok:
            missing.append("阳性对照未通过或未做（control 子命令）")
    if level == "E1":
        missing.append("约束探针（probe）或白盒 NLL 检验（lr）")
    if level == "E2":
        missing.append("授权权重下的 lr + 通过的阳性对照（control）才能上 E3")
    if level == "E3":
        missing.append("请求日志 / provider attestation 才能上 E4")

    res = {
        "probe": "verdict",
        "level": level,
        "label": {
            "E0": "无独立证据：claim 由模型自报，按编造处理",
            "E1": "弱一致：格式/稳定性层面与真实管道不矛盾，不能排除精心编造",
            "E2": "行为一致：claim 派生的约束在冻结模型上稳定成立",
            "E3": "白盒一致：授权权重下 verbatim 优势显著且阳性对照通过",
            "E4": "溯源可证：请求日志 / provider attestation 直接印证",
        }[level],
        "hard_fail": [i.get("detail", "") for i in hard_fail],
        "missing": missing,
        "ceiling_note": "黑盒证据上限 E2；未经阳性对照（control）的 E3 判为无效。",
    }
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return res


# ---------------------------------------------------------------- selftest

def cmd_selftest(_args):
    checks, fails = [], []

    def ck(name, cond):
        checks.append((name, bool(cond)))
        if not cond:
            fails.append(name)

    lo, hi = wilson(9, 10)
    ck("wilson(9,10) lower>0.5", lo > 0.5 and hi > lo)
    ck("wilson(0,20) lower==0", wilson(0, 20)[0] == 0.0)
    ck("binom_cdf(0,20,0.9) < 1e-6", binom_cdf(0, 20, 0.9) < 1e-6)
    ck("binom_cdf(20,20,0.9) == 1", abs(binom_cdf(20, 20, 0.9) - 1.0) < 1e-12)

    pv = [0.0001, 0.4, 0.5, 0.9]
    rj = holm_reject(pv, alpha=0.05)
    ck("holm rejects planted p=1e-4 only", rj == [True, False, False, False])

    a = [1.0] * 200
    b = [2.0] * 200
    obs, p = paired_perm_test(a, b, n_perm=4000, seed=7)
    ck("perm test detects clean separation", obs > 0 and p < 0.01)
    obs2, p2 = paired_perm_test(a, a, n_perm=2000, seed=7)
    ck("perm test null not significant", p2 > 0.2)

    ck("levenshtein identity", levenshtein("abc", "abc") == 0 and levenshtein("", "abc") == 3)
    ck("norm_edit separation", norm_edit("abcdefghij", "abcdefghij") == 0.0 and norm_edit("abcdefghij", "zzzzzzzzzz") > 0.5)
    ck("item_jaccard", item_jaccard("a; b; c", "a; b; c") == 1.0 and item_jaccard("a; b", "x; y") == 0.0)

    class A:
        claim = "/tmp/_os04_claim.txt"
        vocab = "/tmp/_os04_vocab.txt"
        template = None
    open(A.claim, "w", encoding="utf-8").write("rule <|im_start|> do X\nrule <|not_a_real_token|> do Y")
    open(A.vocab, "w", encoding="utf-8").write("<|im_start|>\n<|im_end|>\n")
    r = cmd_markers(A)
    ck("markers flags fabricated special token", r["status"] == "fail" and "<|not_a_real_token|>" in r["unknown_markers"])

    class B:
        evidence = "/tmp/_os04_ev.json"
    open(B.evidence, "w", encoding="utf-8").write(json.dumps({
        "items": [{"probe": "markers", "level": "E1", "status": "pass", "detail": ""},
                  {"probe": "probe", "level": "E2", "status": "pass", "detail": ""}],
        "positive_control": {"ok": False}, "provenance": {}}))
    v = cmd_verdict(B)
    ck("verdict caps black-box at E2", v["level"] == "E2" and any("E3" in m for m in v["missing"]))
    open(B.evidence, "w", encoding="utf-8").write(json.dumps({
        "items": [{"probe": "markers", "level": "E1", "status": "fail", "detail": "fake token"}],
        "positive_control": {"ok": True}, "provenance": {"request_logs": False}}))
    v2 = cmd_verdict(B)
    ck("verdict hard-fail collapses to E0", v2["level"] == "E0")

    for f in ("/tmp/_os04_claim.txt", "/tmp/_os04_vocab.txt", "/tmp/_os04_ev.json"):
        try:
            os.unlink(f)
        except OSError:
            pass

    ok = len(checks) - len(fails)
    print(json.dumps({"probe": "selftest", "passed": ok, "total": len(checks),
                      "failed": fails, "status": "ok" if not fails else "FAIL"},
                     ensure_ascii=False, indent=2))
    return {"status": "ok" if not fails else "FAIL"}


# ---------------------------------------------------------------- CLI

def main(argv=None):
    ap = argparse.ArgumentParser(prog="os04_verify.py", description="证伪式核验自称的系统提示词")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("selftest").set_defaults(fn=cmd_selftest)

    m = sub.add_parser("markers", help="特殊/模板标记真实性")
    m.add_argument("--claim", required=True)
    m.add_argument("--vocab", help="tokenizer.json / vocab.json / 每行一个 token")
    m.add_argument("--template", help="chat_template 文件（jinja 文本）")
    m.set_defaults(fn=cmd_markers)

    s = sub.add_parser("stability", help="多次诱导一致性")
    s.add_argument("--dir", required=True)
    s.add_argument("--suffix", default=".txt")
    s.add_argument("--min-runs", type=int, default=3)
    s.add_argument("--max-edit", type=float, default=0.05)
    s.add_argument("--min-jaccard", type=float, default=0.9)
    s.set_defaults(fn=cmd_stability)

    p = sub.add_parser("probe", help="约束探针命中率")
    p.add_argument("--constraints", required=True, help='[{"id","desc","n","k","p0"}]')
    p.add_argument("--p0", type=float, default=0.9)
    p.add_argument("--alpha", type=float, default=0.05)
    p.set_defaults(fn=cmd_probe)

    l = sub.add_parser("lr", help="逐 token NLL 配对置换检验")
    l.add_argument("--claim", required=True, help="TSV: token<TAB>NLL")
    l.add_argument("--decoy", required=True, help="TSV: token<TAB>NLL")
    l.add_argument("--perm", type=int, default=20000)
    l.add_argument("--seed", type=int, default=20260928)
    l.add_argument("--min-tokens", type=int, default=64)
    l.add_argument("--alpha", type=float, default=0.05)
    l.set_defaults(fn=cmd_lr)

    c = sub.add_parser("control", help="阳性对照：哨兵取回率")
    c.add_argument("--sentinels", required=True)
    c.add_argument("--outputs-dir", required=True)
    c.add_argument("--min-runs", type=int, default=3)
    c.add_argument("--min-recall", type=float, default=0.9)
    c.set_defaults(fn=cmd_control)

    v = sub.add_parser("verdict", help="汇总分级")
    v.add_argument("--evidence", required=True)
    v.set_defaults(fn=cmd_verdict)

    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    main()
