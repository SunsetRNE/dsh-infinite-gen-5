#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""freshness_probe.py — 易变信息时效核验：只报「查到的值 + 来源 URL + 抓取时刻」。

用法:
  python3 freshness_probe.py                 # 查全部目标
  python3 freshness_probe.py --key python    # 只查一个
  python3 freshness_probe.py --json
取不到就写 UNKNOWN(<原因>)，不拿旧知识补值。
"""
import argparse, json, sys, time, urllib.request

UA = "freshness-probe/1.0 (+contact: OPERATOR)"
TARGETS = {
    "python":      ("https://endoflife.date/api/python.json",  "cycles[0].latest"),
    "nodejs_lts":  ("https://nodejs.org/dist/index.json",      "lts_first"),
    "ubuntu_lts":  ("https://endoflife.date/api/ubuntu.json",   "cycles[0].latest"),
    "llamacpp":    ("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", "tag_name"),
    "vllm_pypi":   ("https://pypi.org/pypi/vllm/json",         "info.version"),
    "typescript":  ("https://registry.npmjs.org/typescript/latest", "version"),
}


def dig(obj, path):
    if path == "lts_first":
        return next(x for x in obj if x.get("lts"))["version"]
    for part in path.split("."):
        if part == "cycles[0]":
            obj = obj[0]
        else:
            obj = obj[part]
    return obj


def fetch(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def one(url, path):
    try:
        v = dig(fetch(url), path)
        return {"value": str(v), "source": url, "state": "已知(实测)"}
    except Exception as e:  # 网络/解析/结构变化一律记未知，不猜
        return {"value": "UNKNOWN(%s)" % type(e).__name__, "source": url, "state": "未知"}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", choices=sorted(TARGETS))
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    keys = [a.key] if a.key else sorted(TARGETS)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    out = {}
    for k in keys:
        url, path = TARGETS[k]
        res = one(url, path)
        res["fetched_at_utc"] = now
        out[k] = res
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        for k in keys:
            r = out[k]
            print("%-12s | %-34s | %s | %s" % (k, r["value"], r["state"], r["source"]))
        print("fetched_at_utc=%s" % now)
    return 0


if __name__ == "__main__":
    sys.exit(main())
