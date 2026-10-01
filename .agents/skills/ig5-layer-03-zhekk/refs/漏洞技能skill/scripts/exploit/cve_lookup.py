#!/usr/bin/env python3
"""
CVE查询匹配工具
通过NVD API和GitHub Advisory Database查询CVE信息
支持关键词搜索、CVE ID直接查询、产品版本匹配、严重等级过滤
"""

import argparse
import json
import sys
import re
import urllib.parse
import urllib.request
import urllib.error
import ssl

# NVD API端点
NVD_API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
# GitHub Advisory Database API
GITHUB_ADVISORY_URL = "https://api.github.com/advisories"

# 请求超时时间（秒）
REQUEST_TIMEOUT = 15

# 严重等级映射
SEVERITY_ORDER = {"critical": 4, "high": 3, "medium": 2, "low": 1, "none": 0}


def create_ssl_context():
    """创建SSL上下文，兼容不同Python版本"""
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    except Exception:
        return None


def make_request(url, headers=None):
    """发起HTTP GET请求"""
    req_headers = {
        "User-Agent": "vuln-exploit-cve-lookup/1.0",
        "Accept": "application/json",
    }
    if headers:
        req_headers.update(headers)

    req = urllib.request.Request(url, headers=req_headers)
    ctx = create_ssl_context()

    try:
        if ctx:
            resp = urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT, context=ctx)
        else:
            resp = urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT)
        data = resp.read().decode("utf-8", errors="replace")
        return json.loads(data)
    except urllib.error.HTTPError as e:
        print(f"  [!] HTTP错误 {e.code}: {e.reason}", file=sys.stderr)
        return None
    except urllib.error.URLError as e:
        print(f"  [!] URL错误: {e.reason}", file=sys.stderr)
        return None
    except json.JSONDecodeError:
        print("  [!] JSON解析失败", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  [!] 请求异常: {e}", file=sys.stderr)
        return None


def parse_cvss_v3(metrics):
    """从NVD metrics中解析CVSS v3评分"""
    if not metrics:
        return None, None

    # 优先CVSS v3.1，其次v3.0
    for key in ["cvssMetricV31", "cvssMetricV30"]:
        if key in metrics and metrics[key]:
            for entry in metrics[key]:
                cvss_data = entry.get("cvssData", {})
                score = cvss_data.get("baseScore")
                severity = cvss_data.get("baseSeverity")
                vector = cvss_data.get("vectorString")
                if score is not None:
                    return score, severity

    return None, None


def parse_affected_versions(configurations):
    """解析受影响的版本范围"""
    if not configurations:
        return "未知"

    versions = []
    for config in configurations:
        for node in config.get("nodes", []):
            for cpe_match in node.get("cpeMatch", []):
                criteria = cpe_match.get("criteria", "")
                # 提取产品信息
                parts = criteria.split(":")
                if len(parts) >= 6:
                    vendor = parts[3]
                    product = parts[4]
                    version = parts[5]

                    start = cpe_match.get("versionStartIncluding") or cpe_match.get(
                        "versionStartExcluding"
                    )
                    end = cpe_match.get("versionEndIncluding") or cpe_match.get(
                        "versionEndExcluding"
                    )

                    if start and end:
                        versions.append(f"{product} {start} - {end}")
                    elif end:
                        versions.append(f"{product} <= {end}")
                    elif start:
                        versions.append(f"{product} >= {start}")
                    elif version and version != "*":
                        versions.append(f"{product} {version}")

    if versions:
        # 去重
        unique = list(dict.fromkeys(versions))
        return "; ".join(unique[:5])
    return "未知"


def check_exploit_availability(cve_id, references):
    """检查是否有公开的exploit"""
    exploit_indicators = [
        "exploit-db.com",
        "exploit-db",
        "metasploit",
        "packetstorm",
        "github.com",
        "poc",
        "proof-of-concept",
        "shellcode",
        "rce",
        "remote code execution",
    ]

    ref_urls = [r.get("url", "") if isinstance(r, dict) else str(r) for r in (references or [])]
    for url in ref_urls:
        url_lower = url.lower()
        for indicator in exploit_indicators:
            if indicator in url_lower:
                return True

    # 检查描述中是否提到exploit
    return False


def parse_nvd_cve(item):
    """解析NVD格式的CVE条目"""
    cve = item.get("cve", {})
    cve_id = cve.get("id", "未知")

    # 描述
    descriptions = cve.get("descriptions", [])
    description = "未知"
    for desc in descriptions:
        if desc.get("lang") == "en":
            description = desc.get("value", "未知")
            break
    if description == "未知" and descriptions:
        description = descriptions[0].get("value", "未知")

    # CVSS评分
    cvss_score, severity = parse_cvss_v3(cve.get("metrics", {}))
    if cvss_score is None:
        cvss_score = 0.0
    if severity is None:
        if cvss_score >= 9.0:
            severity = "critical"
        elif cvss_score >= 7.0:
            severity = "high"
        elif cvss_score >= 4.0:
            severity = "medium"
        elif cvss_score > 0:
            severity = "low"
        else:
            severity = "none"

    # 受影响版本
    affected = parse_affected_versions(cve.get("configurations", []))

    # 参考链接
    references = cve.get("references", [])
    ref_urls = [r.get("url", "") for r in references if isinstance(r, dict)]

    # 是否有exploit
    exploit_available = check_exploit_availability(cve_id, references)

    # 发布和修改日期
    published = cve.get("published", "")
    modified = cve.get("lastModified", "")

    return {
        "id": cve_id,
        "description": description,
        "cvss": cvss_score,
        "severity": severity.lower(),
        "affected_versions": affected,
        "references": ref_urls,
        "exploit_available": exploit_available,
        "published": published,
        "modified": modified,
    }


def query_nvd_by_keyword(keyword, limit=20):
    """通过NVD API关键词搜索"""
    params = urllib.parse.urlencode({"keyword": keyword, "resultsPerPage": min(limit, 200)})
    url = f"{NVD_API_URL}?{params}"
    print(f"  [*] 查询NVD: keyword={keyword}", file=sys.stderr)
    data = make_request(url)
    if data is None:
        return None

    cves = []
    for item in data.get("vulnerabilities", []):
        cves.append(parse_nvd_cve(item))

    return cves


def query_nvd_by_cve_id(cve_id):
    """通过NVD API直接查询CVE ID"""
    params = urllib.parse.urlencode({"cveId": cve_id})
    url = f"{NVD_API_URL}?{params}"
    print(f"  [*] 查询NVD: cveId={cve_id}", file=sys.stderr)
    data = make_request(url)
    if data is None:
        return None

    cves = []
    for item in data.get("vulnerabilities", []):
        cves.append(parse_nvd_cve(item))

    return cves


def query_nvd_by_product(product, version=None, limit=20):
    """通过NVD API按产品查询"""
    # 使用虚拟匹配字符串
    search_term = f"cpe:2.3:a:*:{product.lower()}:{version}:*:*:*:*:*:*:*" if version else product
    params = {}
    if version:
        params["virtualMatchString"] = search_term
    else:
        params["keyword"] = product
    params["resultsPerPage"] = min(limit, 200)

    url = f"{NVD_API_URL}?{urllib.parse.urlencode(params)}"
    print(f"  [*] 查询NVD: product={product}, version={version}", file=sys.stderr)
    data = make_request(url)
    if data is None:
        return None

    cves = []
    for item in data.get("vulnerabilities", []):
        cves.append(parse_nvd_cve(item))

    # 如果指定了版本，过滤匹配的
    if version:
        version_pattern = re.compile(re.escape(version), re.IGNORECASE)
        filtered = []
        for cve in cves:
            if version_pattern.search(cve["affected_versions"]) or version_pattern.search(
                cve["description"]
            ):
                filtered.append(cve)
        return filtered[:limit] if filtered else cves[:limit]

    return cves[:limit]


def query_github_advisory(keyword=None, cve_id=None, limit=20):
    """降级使用GitHub Advisory Database API"""
    print("  [*] 降级使用GitHub Advisory Database API", file=sys.stderr)

    params = {"per_page": min(limit, 100)}
    if cve_id:
        params["cve_id"] = cve_id
    elif keyword:
        params["ecosystem"] = "pip"  # 默认生态系统

    url = f"{GITHUB_ADVISORY_URL}?{urllib.parse.urlencode(params)}"
    data = make_request(url, headers={"Accept": "application/vnd.github+json"})

    if data is None or not isinstance(data, list):
        return None

    cves = []
    for item in data:
        cve_id_val = item.get("cve_id", item.get("ghsa_id", "未知"))
        if keyword and keyword.lower() not in item.get("summary", "").lower():
            continue

        severity = item.get("severity", "medium").lower()
        cvss_scores = item.get("cvss", {})
        cvss_score = cvss_scores.get("score", 0.0) if cvss_scores else 0.0

        references = item.get("references", [])
        ref_urls = []
        for ref in references:
            if isinstance(ref, dict):
                ref_urls.append(ref.get("url", ""))
            else:
                ref_urls.append(str(ref))

        cves.append(
            {
                "id": cve_id_val,
                "description": item.get("summary", "未知"),
                "cvss": cvss_score,
                "severity": severity,
                "affected_versions": item.get("vulnerable_version_range", "未知"),
                "references": ref_urls,
                "exploit_available": check_exploit_availability(cve_id_val, references),
                "published": item.get("published_at", ""),
                "modified": item.get("updated_at", ""),
            }
        )

    return cves[:limit]


def filter_by_severity(cves, severity):
    """按严重等级过滤"""
    if not severity:
        return cves

    severity_lower = severity.lower()
    min_level = SEVERITY_ORDER.get(severity_lower, 0)
    return [c for c in cves if SEVERITY_ORDER.get(c.get("severity", "none"), 0) >= min_level]


def search_cves(args):
    """主搜索逻辑"""
    cves = None
    query_desc = ""

    # 1. 按CVE ID查询
    if args.cve_id:
        query_desc = f"CVE-ID: {args.cve_id}"
        cves = query_nvd_by_cve_id(args.cve_id)
        if cves is None or len(cves) == 0:
            cves = query_github_advisory(cve_id=args.cve_id)

    # 2. 按产品+版本查询
    elif args.product:
        query_desc = f"Product: {args.product}"
        if args.version:
            query_desc += f" Version: {args.version}"
        cves = query_nvd_by_product(args.product, args.version, args.limit)
        if cves is None or len(cves) == 0:
            cves = query_github_advisory(keyword=args.product, limit=args.limit)

    # 3. 按关键词查询
    elif args.keyword:
        query_desc = f"Keyword: {args.keyword}"
        cves = query_nvd_by_keyword(args.keyword, args.limit)
        if cves is None or len(cves) == 0:
            cves = query_github_advisory(keyword=args.keyword, limit=args.limit)

    else:
        print("错误: 请指定 --keyword, --cve-id 或 --product", file=sys.stderr)
        return None

    if cves is None:
        cves = []

    # 按严重等级过滤
    if args.severity:
        cves = filter_by_severity(cves, args.severity)

    # 限制结果数量
    cves = cves[: args.limit]

    result = {
        "query": query_desc,
        "total_results": len(cves),
        "cves": cves,
    }

    return result


def main():
    parser = argparse.ArgumentParser(
        description="CVE查询匹配工具 - 查询NVD和GitHub Advisory Database中的CVE信息"
    )
    parser.add_argument("--keyword", help='关键词搜索，如"Apache 2.4"')
    parser.add_argument("--cve-id", help="直接CVE编号，如CVE-2021-44228")
    parser.add_argument("--product", help="产品名称")
    parser.add_argument("--version", help="版本号")
    parser.add_argument(
        "--severity",
        choices=["critical", "high", "medium", "low"],
        help="严重等级过滤",
    )
    parser.add_argument("--limit", type=int, default=20, help="结果数量（默认20）")
    parser.add_argument("-o", "--output", help="结果保存文件路径（可选）")

    args = parser.parse_args()

    if not any([args.keyword, args.cve_id, args.product]):
        parser.error("请至少指定 --keyword, --cve-id 或 --product 之一")

    print("=" * 60, file=sys.stderr)
    print("CVE查询匹配工具", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    result = search_cves(args)

    if result is None:
        print("\n查询失败，请检查网络连接或参数", file=sys.stderr)
        sys.exit(1)

    output_json = json.dumps(result, ensure_ascii=False, indent=2)

    # 保存到文件
    if args.output:
        try:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output_json)
            print(f"\n[*] 结果已保存到: {args.output}", file=sys.stderr)
        except IOError as e:
            print(f"\n[!] 保存文件失败: {e}", file=sys.stderr)

    # 输出到stdout
    print(output_json)

    # 摘要信息
    print(f"\n{'=' * 60}", file=sys.stderr)
    print(f"查询: {result['query']}", file=sys.stderr)
    print(f"共找到 {result['total_results']} 条结果", file=sys.stderr)
    if result["cves"]:
        print("\nTop CVEs:", file=sys.stderr)
        for cve in result["cves"][:5]:
            print(
                f"  - {cve['id']} (CVSS: {cve['cvss']}, {cve['severity']}) "
                f"{'[EXPLOIT]' if cve['exploit_available'] else ''}",
                file=sys.stderr,
            )
    print("=" * 60, file=sys.stderr)


if __name__ == "__main__":
    main()
