#!/usr/bin/env python3
"""
WAF 检测工具
发送探针请求触发 WAF 响应，分析状态码、页面内容、Server 头和 Cookies，
内置 20+ WAF 指纹库，支持 wafw00f 联动检测。
"""

import argparse
import json
import os
import random
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

# 随机延迟范围（秒）
DELAY_MIN = 1.0
DELAY_MAX = 3.0


def random_delay():
    """随机延迟 1-3 秒，规避请求频率检测"""
    time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))


def create_ssl_context():
    """创建 TLS 指纹伪装 SSL 上下文"""
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        # 设置密码套件模拟浏览器 TLS 指纹
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


def make_request(url, method="GET", data=None, cookie=None, proxy=None, timeout=10):
    """发起带反反爬策略的 HTTP 请求"""
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
    # 代理支持
    if proxy:
        proxy_handler = urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        handlers = [proxy_handler]
    else:
        handlers = []
    if ctx:
        handlers.append(urllib.request.HTTPSHandler(context=ctx))
    opener = urllib.request.build_opener(*handlers) if handlers else urllib.request.build_opener()
    try:
        resp = opener.open(req, timeout=timeout)
        body = resp.read().decode("utf-8", errors="replace")
        status = resp.getcode()
        resp_headers = dict(resp.headers)
        return status, body, resp_headers
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        return e.code, body, dict(e.headers) if e.headers else {}
    except Exception:
        return None, None, None


# ============================================================
# WAF 指纹数据库（20+ 种 WAF）
# ============================================================

WAF_FINGERPRINTS = [
    {
        "name": "Cloudflare",
        "headers": {"server": ["cloudflare"], "cf-ray": [""], "cf-cache-status": [""], "cf-mitigated": [""]},
        "body_patterns": ["cloudflare", "cf-ray", "__cf_bm__", "attention required", "cf-chl-bypass"],
        "cookies": ["__cf_bm__", "cf_clearance"],
        "block_status": [403, 503],
        "confidence": "high",
    },
    {
        "name": "AWS WAF",
        "headers": {"x-amzn-trace-id": [""], "x-amz-cf-id": [""]},
        "body_patterns": ["request blocked", "aws waf", "amazonaws"],
        "cookies": [],
        "block_status": [403],
        "confidence": "high",
    },
    {
        "name": "Akamai",
        "headers": {"server": ["akamaighost", "akamai"], "x-akamai-transformed": [""]},
        "body_patterns": ["akamai", "access denied", "reference #"],
        "cookies": [],
        "block_status": [403, 429],
        "confidence": "high",
    },
    {
        "name": "ModSecurity",
        "headers": {"server": ["mod_security", "modsecurity"]},
        "body_patterns": ["mod_security", "modsecurity", "not acceptable", "mod-security"],
        "cookies": [],
        "block_status": [403, 406],
        "confidence": "high",
    },
    {
        "name": "F5 BIG-IP",
        "headers": {"server": ["bigip"], "x-cnection": [""]},
        "body_patterns": ["bigip", "f5 networks", "the requested url was rejected"],
        "cookies": ["bigipserver"],
        "block_status": [403, 501],
        "confidence": "high",
    },
    {
        "name": "Imperva Incapsula",
        "headers": {"x-iinfo": [""], "x-cdn": ["incapsula"], "server": ["incapsula"]},
        "body_patterns": ["incapsula", "incident id", "help us protect your website"],
        "cookies": ["incap_ses_", "visid_incap_"],
        "block_status": [403, 406],
        "confidence": "high",
    },
    {
        "name": "Sucuri",
        "headers": {"x-sucuri-id": [""], "server": ["sucuri"], "x-sucuri-cache": [""]},
        "body_patterns": ["sucuri", "access denied - sucuri"],
        "cookies": [],
        "block_status": [403],
        "confidence": "high",
    },
    {
        "name": "Wordfence",
        "headers": {},
        "body_patterns": ["wordfence", "generated by wordfence"],
        "cookies": [],
        "block_status": [403],
        "confidence": "medium",
    },
    {
        "name": "Barracuda",
        "headers": {"server": ["barracuda"]},
        "body_patterns": ["barracuda", "barra_counter"],
        "cookies": ["barra_counter_session"],
        "block_status": [403],
        "confidence": "high",
    },
    {
        "name": "Fortinet FortiWeb",
        "headers": {"server": ["fortiweb"]},
        "body_patterns": ["fortiweb", "fortinet"],
        "cookies": ["fortiwafsid"],
        "block_status": [403],
        "confidence": "high",
    },
    {
        "name": "Radware",
        "headers": {"server": ["radware"]},
        "body_patterns": ["radware", "access denied"],
        "cookies": [],
        "block_status": [403],
        "confidence": "medium",
    },
    {
        "name": "Tencent Cloud WAF",
        "headers": {"x-nws-log-uuid": [""]},
        "body_patterns": ["tencent", "腾讯云", "waf.tencent"],
        "cookies": [],
        "block_status": [403, 429],
        "confidence": "medium",
    },
    {
        "name": "Aliyun WAF",
        "headers": {"server": ["tengine"]},
        "body_patterns": ["aliyun", "阿里云", "error 405", "request rejected"],
        "cookies": ["aliyungf_tc"],
        "block_status": [405, 403],
        "confidence": "medium",
    },
    {
        "name": "Huawei Cloud WAF",
        "headers": {"x-waf": [""]},
        "body_patterns": ["华为云", "huaweicloud"],
        "cookies": ["hws_"],
        "block_status": [403],
        "confidence": "medium",
    },
    {
        "name": "Baidu Cloud WAF",
        "headers": {"server": ["yunjiasu"]},
        "body_patterns": ["baidu", "百度云", "yunjiasu"],
        "cookies": [],
        "block_status": [403],
        "confidence": "medium",
    },
    {
        "name": "dotDefender",
        "headers": {"x-dotdefender": [""]},
        "body_patterns": ["dotdefender", "dot defender"],
        "cookies": [],
        "block_status": [403],
        "confidence": "high",
    },
    {
        "name": "Citrix Netscaler",
        "headers": {"via": ["netscaler"]},
        "body_patterns": ["netscaler", "citrix"],
        "cookies": [],
        "block_status": [403],
        "confidence": "medium",
    },
    {
        "name": "IBM Web Application Firewall",
        "headers": {"server": ["ibm"]},
        "body_patterns": ["ibm", "datapower"],
        "cookies": [],
        "block_status": [403],
        "confidence": "medium",
    },
    {
        "name": "Edgecast",
        "headers": {"server": ["ecs"]},
        "body_patterns": ["edgecast", "waf.security"],
        "cookies": [],
        "block_status": [403],
        "confidence": "medium",
    },
    {
        "name": "StackPath",
        "headers": {"x-sp-url": [""]},
        "body_patterns": ["stackpath", "maxcdn"],
        "cookies": [],
        "block_status": [403],
        "confidence": "medium",
    },
    {
        "name": "Tencent Cloud EdgeOne",
        "headers": {"x-edge": [""], "eo-log-uuid": [""]},
        "body_patterns": ["edgeone", "edgeone"],
        "cookies": [],
        "block_status": [403, 429],
        "confidence": "medium",
    },
]

# 恶意探针 Payload（用于触发 WAF）
WAF_TEST_PAYLOADS = [
    {"name": "sqli_basic", "payload": "' OR '1'='1", "type": "query"},
    {"name": "sqli_union", "payload": "1 UNION SELECT 1,2,3--", "type": "query"},
    {"name": "xss_script", "payload": "<script>alert(1)</script>", "type": "query"},
    {"name": "xss_img", "payload": "<img src=x onerror=alert(1)>", "type": "query"},
    {"name": "path_traversal", "payload": "../../../etc/passwd", "type": "query"},
    {"name": "cmd_injection", "payload": ";id", "type": "query"},
    {"name": "cmd_whoami", "payload": "|whoami", "type": "query"},
    {"name": "rce_backtick", "payload": "`id`", "type": "query"},
    {"name": "xxe", "payload": "<!ENTITY xxe SYSTEM 'file:///etc/passwd'>", "type": "query"},
    {"name": "large_body", "payload": "A" * 10000, "type": "body"},
]


def check_wafw00f(url):
    """如果 wafw00f 已安装则调用"""
    try:
        import subprocess
        result = subprocess.run(
            ["wafw00f", "-a", url],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            return {"available": True, "output": result.stdout.strip()[:2000]}
    except FileNotFoundError:
        pass
    except Exception:
        pass
    return {"available": False}


def detect_waf(url, timeout, proxy=None, cookie=None):
    """检测目标 URL 是否使用 WAF"""
    # 发送正常请求获取基线
    random_delay()
    baseline_status, baseline_body, baseline_headers = make_request(
        url, "GET", None, cookie, proxy, timeout
    )

    blocked_payloads = []
    allowed_payloads = []
    all_responses = []

    # 发送恶意探针
    for test in WAF_TEST_PAYLOADS:
        random_delay()
        if test["type"] == "query":
            sep = "&" if "?" in url else "?"
            test_url = url + sep + "q=" + urllib.parse.quote(test["payload"])
            status, body, headers = make_request(test_url, "GET", None, cookie, proxy, timeout)
        else:
            status, body, headers = make_request(
                url, "POST", {"input": test["payload"]}, cookie, proxy, timeout
            )
        all_responses.append({
            "payload_name": test["name"],
            "payload": test["payload"][:100],
            "status_code": status,
            "headers": headers,
            "body_snippet": (body or "")[:500],
        })
        if status and status in (403, 406, 429, 501, 503):
            blocked_payloads.append(test["name"])
        else:
            allowed_payloads.append(test["name"])

    # 分析所有响应匹配 WAF 指纹
    detected_wafs = []
    for waf in WAF_FINGERPRINTS:
        match_score = 0
        evidence = []
        for resp_info in all_responses:
            headers = resp_info["headers"] or {}
            body = (resp_info["body_snippet"] or "").lower()
            status = resp_info["status_code"]
            # 响应头匹配
            for header_name, header_values in waf.get("headers", {}).items():
                for key, value in headers.items():
                    if key.lower() == header_name.lower():
                        if not header_values or any(v.lower() in value.lower() for v in header_values if v):
                            match_score += 2
                            evidence.append("响应头匹配: {}: {}".format(key, value))
            # 响应体匹配
            for pattern in waf.get("body_patterns", []):
                if pattern.lower() in body:
                    match_score += 2
                    evidence.append("响应体匹配: '{}'".format(pattern))
            # 状态码匹配
            if status and status in waf.get("block_status", []):
                match_score += 1
                evidence.append("阻断状态码: {}".format(status))
            # Cookie 匹配
            cookie_header = headers.get("Set-Cookie", "") or ""
            for cookie_pattern in waf.get("cookies", []):
                if cookie_pattern.lower() in cookie_header.lower():
                    match_score += 2
                    evidence.append("Cookie匹配: '{}'".format(cookie_pattern))
        if match_score >= 2:
            detected_wafs.append({
                "name": waf["name"],
                "confidence": waf["confidence"] if match_score >= 3 else "low",
                "score": match_score,
                "evidence": evidence[:5],
            })

    waf_detected = len(detected_wafs) > 0 or len(blocked_payloads) > 0
    if detected_wafs:
        detected_wafs.sort(key=lambda x: x["score"], reverse=True)
        best = detected_wafs[0]
        waf_name = best["name"]
        confidence = best["confidence"]
        evidence = best["evidence"]
    else:
        waf_name = "Unknown" if waf_detected else "None"
        confidence = "low" if waf_detected else "high"
        if waf_detected:
            evidence = ["检测到 {} 个 payload 被阻断，但无法确定 WAF 类型".format(len(blocked_payloads))]
        else:
            evidence = ["未检测到 WAF"]

    # 绕过难度评估
    bypass_difficulty = "easy"
    if waf_detected:
        if len(blocked_payloads) >= 4:
            bypass_difficulty = "hard"
        elif len(blocked_payloads) >= 2:
            bypass_difficulty = "medium"

    # wafw00f 联动
    wafw00f_result = check_wafw00f(url)

    return {
        "url": url,
        "waf_detected": waf_detected,
        "waf_name": waf_name,
        "confidence": confidence,
        "evidence": evidence,
        "block_behavior": {
            "blocked_payloads": blocked_payloads,
            "allowed_payloads": allowed_payloads,
        },
        "bypass_difficulty": bypass_difficulty,
        "detected_wafs": detected_wafs,
        "wafw00f": wafw00f_result,
    }


def main():
    parser = argparse.ArgumentParser(
        description="WAF 检测工具 - 发送探针请求识别 WAF 类型",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n  %(prog)s --url https://example.com\n  %(prog)s --url https://example.com --output result.json",
    )
    parser.add_argument("--url", required=True, help="目标 URL")
    parser.add_argument("--output", "-o", help="结果保存文件路径（可选）")
    parser.add_argument("--timeout", type=int, default=10, help="请求超时秒数（默认 10）")
    parser.add_argument("--proxy", help="代理地址（可选，如 http://127.0.0.1:8080）")
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
        result = detect_waf(args.url, args.timeout, args.proxy, args.cookie)
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
        print(json.dumps({"error": "检测失败: {}".format(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
