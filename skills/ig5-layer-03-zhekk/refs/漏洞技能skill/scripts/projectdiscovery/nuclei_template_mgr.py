#!/usr/bin/env python3
"""
Nuclei 模板管理器
提供模板的列表、搜索、下载、统计和自定义运行功能。
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path


# ============================================================
# 工具函数
# ============================================================

def get_template_dir(custom_dir=None):
    """获取模板目录路径。"""
    if custom_dir:
        return os.path.expanduser(custom_dir)
    return os.path.expanduser("~/.nuclei-templates/")


def find_nuclei_binary():
    """检测 nuclei 二进制路径。"""
    import shutil
    path = shutil.which("nuclei")
    if path:
        return path
    local_bin = os.path.expanduser("~/.local/bin/nuclei")
    if os.path.isfile(local_bin):
        return local_bin
    gopath = os.environ.get("GOPATH", os.path.expanduser("~/go"))
    gopath_nuclei = os.path.join(gopath, "bin", "nuclei")
    if os.path.isfile(gopath_nuclei):
        return gopath_nuclei
    return None


def output_json(data):
    """统一 JSON 输出。"""
    print(json.dumps(data, ensure_ascii=False, indent=2))


# ============================================================
# 动作实现
# ============================================================

def action_list(template_dir, category=None):
    """
    列出所有已下载的模板，按分类统计。
    """
    if not os.path.isdir(template_dir):
        output_json({
            "action": "list",
            "total_templates": 0,
            "categories": {},
            "message": f"模板目录不存在: {template_dir}",
            "template_dir": template_dir,
        })
        return

    categories = {}
    total = 0

    # 遍历模板目录
    for entry in os.scandir(template_dir):
        if entry.is_dir():
            cat_name = entry.name
            # 统计该分类下的 .yaml 文件数量
            cat_count = 0
            for root, dirs, files in os.walk(entry.path):
                for f in files:
                    if f.endswith((".yaml", ".yml")):
                        cat_count += 1
            if cat_count > 0:
                categories[cat_name] = cat_count
                total += cat_count
        elif entry.is_file() and entry.name.endswith((".yaml", ".yml")):
            # 根目录下的模板
            categories["_root"] = categories.get("_root", 0) + 1
            total += 1

    # 如果指定了分类过滤
    if category:
        categories = {k: v for k, v in categories.items() if category.lower() in k.lower()}

    output_json({
        "action": "list",
        "total_templates": total,
        "categories": categories,
        "template_dir": template_dir,
    })


def action_search(template_dir, search_term):
    """
    搜索模板（在模板文件内容中搜索关键词）。
    """
    if not search_term:
        output_json({
            "action": "search",
            "search_term": "",
            "total_results": 0,
            "results": [],
            "error": "未提供搜索关键词",
        })
        return

    if not os.path.isdir(template_dir):
        output_json({
            "action": "search",
            "search_term": search_term,
            "total_results": 0,
            "results": [],
            "message": f"模板目录不存在: {template_dir}",
        })
        return

    results = []
    search_lower = search_term.lower()

    for root, dirs, files in os.walk(template_dir):
        for f in files:
            if not f.endswith((".yaml", ".yml")):
                continue
            filepath = os.path.join(root, f)
            try:
                with open(filepath, "r", encoding="utf-8", errors="replace") as fh:
                    content = fh.read()
                    if search_lower in content.lower():
                        # 提取模板ID和名称
                        rel_path = os.path.relpath(filepath, template_dir)
                        template_id = ""
                        template_name = ""
                        template_severity = ""
                        for line in content.split("\n"):
                            line = line.strip()
                            if line.startswith("id:"):
                                template_id = line.split(":", 1)[1].strip()
                            elif line.startswith("name:"):
                                template_name = line.split(":", 1)[1].strip().strip('"').strip("'")
                            elif line.startswith("severity:"):
                                template_severity = line.split(":", 1)[1].strip()
                        results.append({
                            "id": template_id,
                            "name": template_name,
                            "severity": template_severity,
                            "path": rel_path,
                        })
            except Exception:
                continue

            # 限制结果数量
            if len(results) >= 500:
                break
        if len(results) >= 500:
            break

    output_json({
        "action": "search",
        "search_term": search_term,
        "total_results": len(results),
        "results": results,
    })


def action_download(template_dir):
    """
    下载/更新官方模板库。
    """
    nuclei_path = find_nuclei_binary()
    if not nuclei_path:
        output_json({
            "action": "download",
            "success": False,
            "error": "nuclei 未安装，无法更新模板。请先安装 nuclei。",
        })
        return

    try:
        result = subprocess.run(
            [nuclei_path, "-update-templates"],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode == 0:
            output_json({
                "action": "download",
                "success": True,
                "message": "模板更新成功",
                "output": result.stdout + result.stderr,
            })
        else:
            output_json({
                "action": "download",
                "success": False,
                "error": result.stderr.strip(),
                "output": result.stdout,
            })
    except subprocess.TimeoutExpired:
        output_json({
            "action": "download",
            "success": False,
            "error": "模板更新超时",
        })
    except Exception as e:
        output_json({
            "action": "download",
            "success": False,
            "error": str(e),
        })


def action_stats(template_dir):
    """
    显示模板统计信息（总数、分类分布、严重等级分布）。
    """
    if not os.path.isdir(template_dir):
        output_json({
            "action": "stats",
            "total_templates": 0,
            "categories": {},
            "severity_distribution": {},
            "message": f"模板目录不存在: {template_dir}",
        })
        return

    categories = {}
    severity_dist = {}
    total = 0

    for root, dirs, files in os.walk(template_dir):
        # 获取分类名（相对路径的第一级目录）
        rel_root = os.path.relpath(root, template_dir)
        cat_name = rel_root.split(os.sep)[0] if rel_root != "." else "_root"

        for f in files:
            if not f.endswith((".yaml", ".yml")):
                continue
            total += 1
            categories[cat_name] = categories.get(cat_name, 0) + 1

            # 读取严重等级
            filepath = os.path.join(root, f)
            try:
                with open(filepath, "r", encoding="utf-8", errors="replace") as fh:
                    for line in fh:
                        line = line.strip()
                        if line.startswith("severity:"):
                            sev = line.split(":", 1)[1].strip().lower()
                            severity_dist[sev] = severity_dist.get(sev, 0) + 1
                            break
            except Exception:
                continue

    output_json({
        "action": "stats",
        "total_templates": total,
        "categories": categories,
        "severity_distribution": severity_dist,
        "template_dir": template_dir,
    })


def action_custom(custom_template, template_dir):
    """
    运行自定义模板。
    验证用户提供的 nuclei 模板 YAML 文件。
    """
    if not custom_template or not os.path.isfile(custom_template):
        output_json({
            "action": "custom",
            "success": False,
            "error": f"自定义模板文件不存在: {custom_template}",
        })
        return

    # 读取并验证模板文件
    try:
        with open(custom_template, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        output_json({
            "action": "custom",
            "success": False,
            "error": f"读取模板文件失败: {str(e)}",
        })
        return

    # 简单验证模板格式
    has_id = re.search(r"^id:\s*\S+", content, re.MULTILINE) is not None
    has_info = "info:" in content
    has_matcher = "matchers:" in content or "matcher:" in content

    template_info = {
        "id": "",
        "name": "",
        "severity": "",
        "author": "",
        "tags": [],
    }

    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("id:"):
            template_info["id"] = line.split(":", 1)[1].strip()
        elif line.startswith("name:"):
            template_info["name"] = line.split(":", 1)[1].strip().strip('"').strip("'")
        elif line.startswith("severity:"):
            template_info["severity"] = line.split(":", 1)[1].strip()
        elif line.startswith("author:"):
            template_info["author"] = line.split(":", 1)[1].strip().strip('"').strip("'")
        elif line.startswith("tags:"):
            tags_str = line.split(":", 1)[1].strip()
            template_info["tags"] = [t.strip() for t in tags_str.split(",") if t.strip()]

    output_json({
        "action": "custom",
        "success": True,
        "template_path": custom_template,
        "template_info": template_info,
        "validation": {
            "has_id": has_id,
            "has_info": has_info,
            "has_matcher": has_matcher,
            "valid": has_id and has_info,
        },
        "message": "模板已加载，可使用 nuclei -t <path> -u <target> 运行",
    })


# ============================================================
# 主入口
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Nuclei 模板管理器 - 列表/搜索/下载/统计/自定义模板"
    )
    parser.add_argument("--action", default="list",
                        choices=["list", "search", "download", "stats", "custom"],
                        help="执行动作（默认 list）")
    parser.add_argument("--category", default="",
                        help="分类过滤（可选）")
    parser.add_argument("--search", default="",
                        help="搜索关键词（可选）")
    parser.add_argument("-o", "--output", default="",
                        help="结果保存文件路径（可选）")
    parser.add_argument("--custom-template", default="",
                        help="自定义模板文件路径（custom action 时使用）")
    parser.add_argument("--template-dir", default="",
                        help="模板目录（默认 ~/.nuclei-templates/）")

    args = parser.parse_args()

    template_dir = get_template_dir(args.template_dir)

    if args.action == "list":
        result_func = lambda: action_list(template_dir, args.category)
    elif args.action == "search":
        result_func = lambda: action_search(template_dir, args.search)
    elif args.action == "download":
        result_func = lambda: action_download(template_dir)
    elif args.action == "stats":
        result_func = lambda: action_stats(template_dir)
    elif args.action == "custom":
        result_func = lambda: action_custom(args.custom_template, template_dir)
    else:
        result_func = lambda: output_json({"error": f"未知动作: {args.action}"})

    # 执行并可选保存
    if args.output:
        # 捕获输出到文件
        import io
        old_stdout = sys.stdout
        sys.stdout = buffer = io.StringIO()
        result_func()
        output_text = buffer.getvalue()
        sys.stdout = old_stdout
        print(output_text)
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output_text)
    else:
        result_func()


if __name__ == "__main__":
    main()
