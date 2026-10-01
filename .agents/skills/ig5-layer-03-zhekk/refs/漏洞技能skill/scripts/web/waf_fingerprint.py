#!/usr/bin/env python3
"""
WAF 详细指纹识别工具
使用多种探针 payload 进行测试，分析响应时间、拦截页面特征，
识别 WAF 版本和规则集。支持详细输出模式。
"""

import argparse
import json
import os
import random
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ============================================================
# 反反爬策略：随机 User-Agent 池（20+）
# ============================================================

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:119.0) Gecko/20100101 Firefox/119.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
]

DELAY_MIN = 1.0
DELAY_MAX = 3.0


def random_delay():
    """随机延迟 1-3 秒"""
    time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))


def create_ssl_context():
    """创建 TLS 指纹伪装 SSL 上下文"""
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        try:
            ctx.set_ciphers(
                "ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5:!DSS"
            )
        except Exception:
            pass
        return ctx
    except Exception:
        return None


def build_headers(url, cookie=None):
    """构建反反爬请求头"""
    parsed = urllib.parse.urlparse(url)
    referer = parsed.scheme + "://" + parsed.netloc + "/" if parsed.netloc else url
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": referer,
        "Connection": "keep-alive",
    }
    if cookie:
        headers["Cookie"] = cookie
    return headers


def timed_request(url, method="GET", data=None, cookie=None, proxy=None, timeout=10):
    """发起带时间测量的 HTTP 请求"""
    ctx = create_ssl_context()
    headers = build_headers(url, cookie)
    post_data = None
    if data and method.upper() == "POST":
        if isinstance(data, dict):
            post_data = urllib.parse.urlencode(data).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif isinstance(data, str):
            post_data = data.encode("utf-8")
            headers["Content-Type"] = "application/xml" if "<?xml" in data else "application/json"
    req = urllib.request.Request(url, data=post_data, headers=headers, method=method.upper())
    if proxy:
        proxy_handler = urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        handlers = [proxy_handler]
    else:
        handlers = []
    if ctx:
        handlers.append(urllib.request.HTTPSHandler(context=ctx))
    opener = urllib.request.build_opener(*handlers) if handlers else urllib.request.build_opener()
    start_time = time.time()
    try:
        resp = opener.open(req, timeout=timeout)
        body = resp.read().decode("utf-8", errors="replace")
        status = resp.getcode()
        resp_headers = dict(resp.headers)
        elapsed = time.time() - start_time
        return status, body, resp_headers, elapsed
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        elapsed = time.time() - start_time
        return e.code, body, dict(e.headers) if e.headers else {}, elapsed
    except Exception:
        elapsed = time.time() - start_time
        return None, None, None, elapsed


# ============================================================
# 多种探针 Payload
# ============================================================

PROBE_PAYLOADS = [
    # SQL 注入探针
    {"category": "sqli", "name": "sqli_union", "payload": "1 UNION SELECT 1,2,3--"},
    {"category": "sqli", "name": "sqli_boolean", "payload": "' OR '1'='1"},
    {"category": "sqli", "name": "sqli_error", "payload": "' AND 1=CONVERT(int,@@version)--"},
    {"category": "sqli", "name": "sqli_time", "payload": "'; WAITFOR DELAY '0:0:5'--"},
    # XSS 探针
    {"category": "xss", "name": "xss_script", "payload": "<script>alert(1)</script>"},
    {"category": "xss", "name": "xss_img", "payload": "<img src=x onerror=alert(1)>"},
    {"category": "xss", "name": "xss_svg", "payload": "<svg onload=alert(1)>"},
    # 路径穿越探针
    {"category": "lfi", "name": "path_traversal", "payload": "../../../etc/passwd"},
    {"category": "lfi", "name": "path_traversal_enc", "payload": "..%2f..%2f..%2fetc%2fpasswd"},
    # 命令注入探针
    {"category": "rce", "name": "cmd_semicolon", "payload": ";id"},
    {"category": "rce", "name": "cmd_pipe", "payload": "|whoami"},
    {"category": "rce", "name": "cmd_backtick", "payload": "`id`"},
    # 请求走私探针
    {"category": "smuggling", "name": "large_body", "payload": "A" * 10000},
    # 正常请求（用于基线对比）
    {"category": "normal", "name": "normal_alpha", "payload": "test"},
    {"category": "normal", "name": "normal_num", "payload": "12345"},
]


# ============================================================
# WAF 指纹特征库（含版本信息）
# ============================================================

WAF_FINGERPRINT_DETAILS = [
    {
        "name": "Cloudflare",
        "headers": {"server": ["cloudflare"], "cf-ray": [""], "cf-cache-status": [""]},
        "body_patterns": ["cloudflare", "cf-ray", "attention required", "cf-chl-bypass"],
        "block_status": [403, 503],
        "version_patterns": [
            (r"cf-ray:\s*([a-f0-9]+-\w+)", "Ray ID"),
            (r"server:\s*cloudflare\s*\n", "Server"),
        ],
        "ruleset": "Cloudflare Managed Ruleset",
        "confidence": "high",
    },
    {
        "name": "AWS WAF",
        "headers": {"x-amzn-trace-id": [""], "x-amz-cf-id": [""]},
        "body_patterns": ["request blocked", "aws waf", "amazonaws"],
        "block_status": [403],
        "version_patterns": [
            (r"x-amzn-trace-id:\s*Root=([\w-]+)", "Trace ID"),
        ],
        "ruleset": "AWSManagedRulesCommonRuleSet",
        "confidence": "high",
    },
    {
        "name": "Akamai",
        "headers": {"server": ["akamaighost", "akamai"], "x-akamai-transformed": [""]},
        "body_patterns": ["akamai", "access denied", "reference #"],
        "block_status": [403, 429],
        "version_patterns": [
            (r"reference\s*#(\d+\.\d+\.\d+\.\d+)", "Reference ID"),
            (r"server:\s*(akamaighost/[\d.]+)", "Server Version"),
        ],
        "ruleset": "Kona Rule Set",
        "confidence": "high",
    },
    {
        "name": "ModSecurity",
        "headers": {"server": ["mod_security", "modsecurity", "apache"]},
        "body_patterns": ["mod_security", "modsecurity", "not acceptable"],
        "block_status": [403, 406],
        "version_patterns": [
            (r"mod_security[/\s]*([0-9.]+)", "ModSecurity Version"),
            (r"OWASP CRS\s*([0-9.]+)", "CRS Version"),
        ],
        "ruleset": "OWASP Core Rule Set",
        "confidence": "high",
    },
    {
        "name": "F5 BIG-IP",
        "headers": {"server": ["bigip"], "x-cnection": [""]},
        "body_patterns": ["bigip", "the requested url was rejected"],
        "block_status": [403, 501],
        "version_patterns": [
            (r"server:\s*(BIG-IP/?[\d.]*)", "BIG-IP Version"),
        ],
        "ruleset": "F5 ASM Policy",
        "confidence": "high",
    },
    {
        "name": "Imperva Incapsula",
        "headers": {"x-iinfo": [""], "x-cdn": ["incapsula"], "server": ["incapsula"]},
        "body_patterns": ["incapsula", "incident id", "help us protect"],
        "block_status": [403, 406],
        "version_patterns": [
            (r"incident id:\s*([\d-]+)", "Incident ID"),
            (r"x-iinfo:\s*([\d\-,\s]+)", "Info"),
        ],
        "ruleset": "Imperva Cloud WAF Ruleset",
        "confidence": "high",
    },
    {
        "name": "Sucuri",
        "headers": {"x-sucuri-id": [""], "server": ["sucuri"]},
        "body_patterns": ["sucuri", "access denied - sucuri"],
        "block_status": [403],
        "version_patterns": [
            (r"x-sucuri-id:\s*(\d+)", "Sucuri ID"),
        ],
        "ruleset": "Sucuri CloudProxy",
        "confidence": "high",
    },
    {
        "name": "Aliyun WAF",
        "headers": {"server": ["tengine"]},
        "body_patterns": ["aliyun", "阿里云", "error 405", "request rejected"],
        "block_status": [405, 403],
        "version_patterns": [
            (r"server:\s*(tengine/[\d.]+)", "Tengine Version"),
        ],
        "ruleset": "阿里云 WAF 规则集",
        "confidence": "medium",
    },
    {
        "name": "Tencent Cloud WAF",
        "headers": {"x-nws-log-uuid": [""]},
        "body_patterns": ["tencent", "腾讯云", "waf.tencent"],
        "block_status": [403, 429],
        "version_patterns": [
            (r"x-nws-log-uuid:\s*([\w-]+)", "Log UUID"),
        ],
        "ruleset": "腾讯云 WAF 规则集",
        "confidence": "medium",
    },
    {
        "name": "Huawei Cloud WAF",
        "headers": {"x-waf": [""]},
        "body_patterns": ["华为云", "huaweicloud"],
        "block_status": [403],
        "version_patterns": [],
        "ruleset": "华为云 WAF 规则集",
        "confidence": "medium",
    },
    {
        "name": "Fortinet FortiWeb",
        "headers": {"server": ["fortiweb"]},
        "body_patterns": ["fortiweb", "fortinet"],
        "block_status": [403],
        "version_patterns": [
            (r"server:\s*(fortiweb/?[\d.]*)", "FortiWeb Version"),
        ],
        "ruleset": "FortiWeb Signature",
        "confidence": "high",
    },
    {
        "name": "Wordfence",
        "headers": {},
        "body_patterns": ["wordfence", "generated by wordfence"],
        "block_status": [403],
        "version_patterns": [
            (r"wordfence.*?(\d+\.\d+\.\d+)", "Wordfence Version"),
        ],
        "ruleset": "Wordfence Firewall",
        "confidence": "medium",
    },
    {
        "name": "dotDefender",
        "headers": {"x-dotdefender": [""]},
        "body_patterns": ["dotdefender"],
        "block_status": [403],
        "version_patterns": [],
        "ruleset": "dotDefender Ruleset",
        "confidence": "high",
    },
]


def fingerprint_waf(url, timeout, proxy=None, cookie=None, verbose=False):
    """WAF 详细指纹识别"""
    probe_results = []

    # 发送所有探针 payload
    for probe in PROBE_PAYLOADS:
        random_delay()
        sep = "&" if "?" in url else "?"
        test_url = url + sep + "q=" + urllib.parse.quote(probe["payload"])
        status, body, headers, elapsed = timed_request(
            test_url, "GET", None, cookie, proxy, timeout
        )
        is_blocked = status in (403, 406, 429, 501, 503) if status else False
        probe_results.append({
            "category": probe["category"],
            "name": probe["name"],
            "payload": probe["payload"][:80],
            "status_code": status,
            "is_blocked": is_blocked,
            "response_time": round(elapsed, 3),
            "body_snippet": (body or "")[:300],
            "headers": headers or {},
        })
        if verbose:
            print("[*] 探针 {}: 状态={} 延迟={:.3f}s 阻断={}".format(
                probe["name"], status, elapsed, is_blocked
            ), file=sys.stderr)

    # 分析响应时间模式
    normal_times = [r["response_time"] for r in probe_results if r["category"] == "normal"]
    attack_times = [r["response_time"] for r in probe_results if r["category"] != "normal"]
    avg_normal = sum(normal_times) / len(normal_times) if normal_times else 0
    avg_attack = sum(attack_times) / len(attack_times) if attack_times else 0
    time_diff = avg_attack - avg_normal

    # WAF 指纹匹配
    detected_wafs = []
    for waf in WAF_FINGERPRINT_DETAILS:
        match_score = 0
        evidence = []
        version_info = {}
        for resp in probe_results:
            headers = resp["headers"]
            body = (resp["body_snippet"] or "").lower()
            status = resp["status_code"]
            # 响应头匹配
            for header_name, header_values in waf.get("headers", {}).items():
                for key, value in headers.items():
                    if key.lower() == header_name.lower():
                        if not header_values or any(v.lower() in value.lower() for v in header_values if v):
                            match_score += 2
                            evidence.append("响应头: {}: {}".format(key, value))
            # 响应体匹配
            for pattern in waf.get("body_patterns", []):
                if pattern.lower() in body:
                    match_score += 2
                    evidence.append("页面内容: '{}'".format(pattern))
            # 状态码匹配
            if status and status in waf.get("block_status", []):
                match_score += 1
            # 版本信息提取
            for pattern, label in waf.get("version_patterns", []):
                full_headers = "\n".join("{}: {}".format(k, v) for k, v in headers.items())
                m = re.search(pattern, full_headers, re.IGNORECASE)
                if m:
                    version_info[label] = m.group(1)
                    match_score += 1
        if match_score >= 2:
            detected_wafs.append({
                "name": waf["name"],
                "confidence": waf["confidence"] if match_score >= 3 else "low",
                "score": match_score,
                "ruleset": waf["ruleset"],
                "version_info": version_info,
                "evidence": list(set(evidence))[:5],
            })

    waf_detected = len(detected_wafs) > 0
    if detected_wafs:
        detected_wafs.sort(key=lambda x: x["score"], reverse=True)
        best = detected_wafs[0]
        waf_name = best["name"]
        confidence = best["confidence"]
        ruleset = best["ruleset"]
        version_info = best["version_info"]
    else:
        waf_name = "None"
        confidence = "high"
        ruleset = "N/A"
        version_info = {}

    # 分析阻断行为模式
    blocked_count = sum(1 for r in probe_results if r["is_blocked"])
    category_stats = {}
    for r in probe_results:
        cat = r["category"]
        if cat not in category_stats:
            category_stats[cat] = {"total": 0, "blocked": 0}
        category_stats[cat]["total"] += 1
        if r["is_blocked"]:
            category_stats[cat]["blocked"] += 1

    return {
        "url": url,
        "waf_detected": waf_detected,
        "waf_name": waf_name,
        "confidence": confidence,
        "ruleset": ruleset,
        "version_info": version_info,
        "blocking_analysis": {
            "total_probes": len(probe_results),
            "blocked_count": blocked_count,
            "block_rate": round(blocked_count / len(probe_results) * 100, 1),
            "category_stats": category_stats,
        },
        "response_time_analysis": {
            "avg_normal_time": round(avg_normal, 3),
            "avg_attack_time": round(avg_attack, 3),
            "time_difference": round(time_diff, 3),
            "time_based_detection": time_diff > 1.0,
        },
        "detected_wafs": detected_wafs,
        "probe_details": probe_results if verbose else None,
    }


def main():
    parser = argparse.ArgumentParser(
        description="WAF 详细指纹识别工具 - 多探针测试 + 响应时间分析",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n  %(prog)s --url https://example.com\n  %(prog)s --url https://example.com --verbose --output result.json",
    )
    parser.add_argument("--url", required=True, help="目标 URL")
    parser.add_argument("--output", "-o", help="结果保存文件路径（可选）")
    parser.add_argument("--verbose", "-v", action="store_true", help="详细输出模式")
    parser.add_argument("--timeout", type=int, default=10, help="请求超时秒数（默认 10）")
    parser.add_argument("--proxy", help="代理地址（可选）")
    parser.add_argument("--cookie", help="Cookie 字符串（可选）")
    args = parser.parse_args()

    # 认证模块导入
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "exploit"))
        from red_team_auth import require_auth
        require_auth()
    except ImportError:
        pass

    try:
        if args.verbose:
            print("[*] 开始 WAF 详细指纹识别: {}".format(args.url), file=sys.stderr)
        result = fingerprint_waf(args.url, args.timeout, args.proxy, args.cookie, args.verbose)
        json_output = json.dumps(result, ensure_ascii=False, indent=2)
        if args.output:
            try:
                with open(args.output, "w", encoding="utf-8") as f:
                    f.write(json_output)
                print("结果已保存到: {}".format(args.output))
            except IOError as e:
                print(json.dumps({"error": "写入文件失败: {}".format(e)}), file=sys.stderr)
                print(json_output)
        else:
            print(json_output)
    except KeyboardInterrupt:
        print(json.dumps({"error": "用户中断"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": "指纹识别失败: {}".format(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
