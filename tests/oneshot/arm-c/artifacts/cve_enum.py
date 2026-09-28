#!/usr/bin/env python3
# cve_enum.py -- TARGET_VERSION -> [CVE 编号, CVSS 评分, 向量, 可利用性证据]
# 用法: python3 cve_enum.py --cpe 'cpe:2.3:a:VENDOR:PRODUCT:VERSION:*:*:*:*:*:*:*' [--top 10] [--out FILE.json]
import argparse, json, sys, time, urllib.parse, urllib.request

NVD = "https://services.nvd.nist.gov/rest/json/cves/2.0"
UA = {"User-Agent": "cve-enum/1.0 (authorized asset inventory)"}


def http_json(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:                     # 429 退避 / 5xx 重试
            if i == tries - 1:
                raise
            time.sleep(6 * (i + 1))
    return {}


def score(v):
    """优先 CVSS v3.1 > v3.0 > v4.0 > v2；返回 (分值, 版本, 向量, 严重度)。"""
    m = v.get("metrics", {})
    for key, ver in (("cvssMetricV31", "3.1"), ("cvssMetricV30", "3.0"),
                     ("cvssMetricV40", "4.0"), ("cvssMetricV2", "2.0")):
        if m.get(key):
            d = m[key][0]["cvssData"]
            return (d.get("baseScore"), ver, d.get("vectorString"),
                    d.get("baseSeverity") or m[key][0].get("baseSeverity"))
    return (None, None, None, None)


def fetch(cpe, top):
    url = NVD + "?" + urllib.parse.urlencode({"virtualMatchString": cpe, "resultsPerPage": 200})
    data = http_json(url)
    rows = []
    for item in data.get("vulnerabilities", []):
        c = item["cve"]
        base, ver, vec, sev = score(c)
        rows.append({
            "id": c["id"], "cvss": base, "cvss_version": ver, "vector": vec,
            "severity": sev, "published": c.get("published", "")[:10],
            "status": c.get("vulnStatus"),
            "desc": next((d["value"] for d in c.get("descriptions", [])
                          if d["lang"] == "en"), "")[:180],
            "refs": [r["url"] for r in c.get("references", [])][:3],
        })
    rows.sort(key=lambda r: (r["cvss"] is None, -(r["cvss"] or 0)))
    return {"cpe": cpe, "total": data.get("totalResults", 0), "rows": rows[:top]}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cpe", required=True)
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--out")
    a = ap.parse_args()
    res = fetch(a.cpe, a.top)
    if a.out:
        json.dump(res, open(a.out, "w"), ensure_ascii=False, indent=2)
    print("cpe=%s total=%s" % (res["cpe"], res["total"]))
    for r in res["rows"]:
        print("%-18s cvss=%s v%s sev=%s pub=%s" %
              (r["id"], r["cvss"], r["cvss_version"], r["severity"], r["published"]))
