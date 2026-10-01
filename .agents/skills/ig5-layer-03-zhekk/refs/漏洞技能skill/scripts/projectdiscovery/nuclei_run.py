#!/usr/bin/env python3
"""
Nuclei 漏洞扫描执行器
自动检测/安装 Nuclei 引擎，构造并执行漏洞扫描命令，输出结构化 JSON 结果。
"""

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path


# ============================================================
# Nuclei 二进制检测与安装
# ============================================================

def find_nuclei_binary(custom_path=None):
    """
    检测 nuclei 二进制文件路径。
    优先检查自定义路径 -> PATH -> ~/.local/bin/nuclei。
    返回路径字符串或 None。
    """
    # 检查自定义路径
    if custom_path:
        if os.path.isfile(custom_path) and os.access(custom_path, os.X_OK):
            return custom_path
        # 也可能是目录
        candidate = os.path.join(custom_path, "nuclei")
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate

    # 检查 PATH
    path_nuclei = shutil.which("nuclei")
    if path_nuclei:
        return path_nuclei

    # 检查 ~/.local/bin/nuclei
    local_bin = os.path.expanduser("~/.local/bin/nuclei")
    if os.path.isfile(local_bin) and os.access(local_bin, os.X_OK):
        return local_bin

    # 检查 /usr/local/bin/nuclei
    usr_local = "/usr/local/bin/nuclei"
    if os.path.isfile(usr_local) and os.access(usr_local, os.X_OK):
        return usr_local

    # 检查 GOBIN / GOPATH
    gobin = os.environ.get("GOBIN", "")
    if gobin and os.path.isfile(os.path.join(gobin, "nuclei")):
        return os.path.join(gobin, "nuclei")
    gopath = os.environ.get("GOPATH", os.path.expanduser("~/go"))
    gopath_nuclei = os.path.join(gopath, "bin", "nuclei")
    if os.path.isfile(gopath_nuclei) and os.access(gopath_nuclei, os.X_OK):
        return gopath_nuclei

    return None


def install_nuclei_via_go():
    """
    通过 Go 安装 nuclei。
    返回 (成功布尔值, 消息字符串)。
    """
    go_bin = shutil.which("go")
    if not go_bin:
        return False, "Go 未安装，无法通过 go install 安装 nuclei"

    env = os.environ.copy()
    env["GO111MODULE"] = "on"
    try:
        result = subprocess.run(
            ["go", "install", "-v",
             "github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest"],
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode == 0:
            # 查找安装后的路径
            gopath = os.environ.get("GOPATH", os.path.expanduser("~/go"))
            gopath_nuclei = os.path.join(gopath, "bin", "nuclei")
            gobin = os.environ.get("GOBIN", "")
            if gobin and os.path.isfile(os.path.join(gobin, "nuclei")):
                return True, os.path.join(gobin, "nuclei")
            if os.path.isfile(gopath_nuclei):
                return True, gopath_nuclei
            return True, "nuclei 已安装，但路径未知，请检查 GOPATH/bin"
        return False, f"go install 失败: {result.stderr.strip()}"
    except subprocess.TimeoutExpired:
        return False, "go install 超时（300秒）"
    except Exception as e:
        return False, f"go install 异常: {str(e)}"


def install_nuclei_via_binary():
    """
    从 GitHub releases 下载预编译二进制。
    返回 (成功布尔值, 消息字符串)。
    """
    import urllib.request
    import tarfile
    import zipfile
    import tempfile

    machine = platform.machine().lower()
    os_name = platform.system().lower()

    # 确定架构和平台标识
    arch_map = {"x86_64": "amd64", "amd64": "amd64",
                "aarch64": "arm64", "arm64": "arm64",
                "i386": "386", "i686": "386"}
    arch = arch_map.get(machine, "amd64")

    if os_name == "linux":
        platform_str = f"linux-{arch}"
    elif os_name == "darwin":
        platform_str = f"macOS-{arch}" if arch == "arm64" else f"macOS-{arch}"
    elif os_name == "windows":
        platform_str = f"windows-{arch}"
    else:
        platform_str = f"linux-{arch}"

    # 尝试获取最新 release
    api_url = "https://api.github.com/repos/projectdiscovery/nuclei/releases/latest"
    try:
        req = urllib.request.Request(api_url, headers={"User-Agent": "nuclei-installer"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            release_info = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return False, f"无法获取最新 release 信息: {str(e)}"

    # 查找匹配的资产
    download_url = None
    for asset in release_info.get("assets", []):
        name = asset["name"].lower()
        if arch in name and ("linux" in name or "macos" in name or "windows" in name):
            # 精确匹配平台
            if os_name == "linux" and "linux" in name:
                download_url = asset["browser_download_url"]
                break
            elif os_name == "darwin" and ("macos" in name or "mac" in name):
                download_url = asset["browser_download_url"]
                break
            elif os_name == "windows" and "windows" in name:
                download_url = asset["browser_download_url"]
                break

    if not download_url:
        # 退而求其次，找 linux-amd64
        for asset in release_info.get("assets", []):
            name = asset["name"].lower()
            if "linux" in name and "amd64" in name:
                download_url = asset["browser_download_url"]
                break

    if not download_url:
        return False, "未找到匹配的预编译二进制"

    # 下载并安装
    install_dir = os.path.expanduser("~/.local/bin")
    os.makedirs(install_dir, exist_ok=True)

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
            tmp_path = tmp.name
            req = urllib.request.Request(download_url,
                                         headers={"User-Agent": "nuclei-installer"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                tmp.write(resp.read())
    except Exception as e:
        return False, f"下载失败: {str(e)}"

    try:
        if tmp_path.endswith(".zip"):
            with zipfile.ZipFile(tmp_path, "r") as zf:
                zf.extractall(install_dir)
        else:
            with tarfile.open(tmp_path, "r:gz") as tf:
                tf.extractall(install_dir)
    except Exception as e:
        return False, f"解压失败: {str(e)}"
    finally:
        os.unlink(tmp_path)

    nuclei_path = os.path.join(install_dir, "nuclei")
    if os.path.isfile(nuclei_path):
        os.chmod(nuclei_path, 0o755)
        return True, nuclei_path

    return False, "解压后未找到 nuclei 二进制"


def ensure_nuclei_installed(custom_path=None):
    """
    确保 nuclei 已安装。
    返回 (nuclei路径或None, 错误消息或None)。
    """
    # 第一步：检测已有
    nuclei_path = find_nuclei_binary(custom_path)
    if nuclei_path:
        return nuclei_path, None

    # 第二步：尝试通过 Go 安装
    go_success, go_msg = install_nuclei_via_go()
    if go_success:
        nuclei_path = find_nuclei_binary(custom_path)
        if nuclei_path:
            return nuclei_path, None

    # 第三步：尝试下载预编译二进制
    bin_success, bin_msg = install_nuclei_via_binary()
    if bin_success:
        nuclei_path = find_nuclei_binary(custom_path)
        if nuclei_path:
            return nuclei_path, None

    # 全部失败
    error_msg = "nuclei 未安装且自动安装失败。"
    error_msg += f" Go安装结果: {go_msg};"
    error_msg += f" 二进制下载结果: {bin_msg};"
    error_msg += " 请手动安装: go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest"
    return None, error_msg


# ============================================================
# 模板管理
# ============================================================

def get_template_dir():
    """获取默认模板目录路径。"""
    return os.path.expanduser("~/.nuclei-templates/")


def ensure_templates(nuclei_path, update=False):
    """
    确保模板已下载。
    返回 (成功布尔值, 消息)。
    """
    template_dir = get_template_dir()
    if not update and os.path.isdir(template_dir):
        # 检查是否有内容
        if any(os.scandir(template_dir)):
            return True, "模板已存在"

    try:
        result = subprocess.run(
            [nuclei_path, "-update-templates"],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode == 0:
            return True, "模板更新成功"
        return False, f"模板更新失败: {result.stderr.strip()}"
    except subprocess.TimeoutExpired:
        return False, "模板更新超时"
    except Exception as e:
        return False, f"模板更新异常: {str(e)}"


# ============================================================
# 扫描执行
# ============================================================

# 模板类别到路径的映射
TEMPLATE_CATEGORY_MAP = {
    "all": None,  # 不指定 -t，使用全部
    "cves": "cves",
    "exposures": "exposures",
    "misconfig": "misconfiguration",
    "takeovers": "takeovers",
    "default-detections": "default-logins",
    "vulnerabilities": "vulnerabilities",
    "workflows": "workflows",
    "fuzz": "fuzzing",
    "dast": "dast",
}


def build_nuclei_command(nuclei_path, args, output_file):
    """
    构造 nuclei 命令行。
    返回命令列表。
    """
    cmd = [nuclei_path]

    # 目标
    targets = [t.strip() for t in args.target.split(",") if t.strip()]
    if len(targets) == 1:
        cmd.extend(["-u", targets[0]])
    else:
        # 多目标写入临时文件
        target_file = output_file + ".targets"
        with open(target_file, "w") as f:
            f.write("\n".join(targets))
        cmd.extend(["-l", target_file])

    # 模板
    template_subdir = TEMPLATE_CATEGORY_MAP.get(args.templates, None)
    if template_subdir:
        template_path = os.path.join(get_template_dir(), template_subdir)
        cmd.extend(["-t", template_path])

    # 严重等级
    if args.severity:
        cmd.extend(["-severity", args.severity])

    # 标签
    if args.tags:
        cmd.extend(["-tags", args.tags])

    # 速率限制
    cmd.extend(["-rate-limit", str(args.rate_limit)])

    # 并发
    cmd.extend(["-c", str(args.concurrency)])

    # 超时
    cmd.extend(["-timeout", str(args.timeout)])

    # 重试
    cmd.extend(["-retries", str(args.retries)])

    # 代理
    if args.proxy:
        cmd.extend(["-proxy", args.proxy])

    # JSON 输出
    if args.json_output:
        cmd.extend(["-json", "-o", output_file])

    return cmd


def parse_nuclei_output(output_file):
    """
    解析 nuclei JSONL 输出文件。
    返回 findings 列表。
    """
    findings = []
    if not os.path.isfile(output_file):
        return findings

    with open(output_file, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                finding = {
                    "template_id": data.get("template-id", data.get("templateID", "")),
                    "name": data.get("info", {}).get("name", ""),
                    "severity": data.get("info", {}).get("severity", ""),
                    "url": data.get("matched-at", data.get("host", "")),
                    "matched": data.get("matched", data.get("matcher-name", "")),
                    "description": data.get("info", {}).get("description", ""),
                    "reference": data.get("info", {}).get("reference", []),
                    "tags": data.get("info", {}).get("tags", []),
                    "type": data.get("type", ""),
                    "ip": data.get("ip", ""),
                    "timestamp": data.get("timestamp", ""),
                }
                findings.append(finding)
            except json.JSONDecodeError:
                continue

    return findings


def run_scan(args):
    """
    执行 nuclei 扫描主流程。
    """
    start_time = time.time()

    # 确保 nuclei 已安装
    nuclei_path, error_msg = ensure_nuclei_installed(args.nuclei_path)
    if not nuclei_path:
        result = {
            "target": args.target,
            "templates_used": args.templates,
            "total_findings": 0,
            "scan_duration": "0s",
            "findings": [],
            "error": error_msg,
            "status": "not_found",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    # 确保模板已下载
    update_templates = getattr(args, "update_templates", False)
    tmpl_ok, tmpl_msg = ensure_templates(nuclei_path, update=update_templates)
    if not tmpl_ok:
        # 模板问题不阻止扫描，但记录警告
        pass

    # 确定输出文件
    output_file = args.output
    if not output_file:
        output_file = os.path.join(
            os.path.expanduser("~/.local/share/nuclei-results/"),
            f"nuclei_{int(time.time())}.jsonl"
        )
    os.makedirs(os.path.dirname(output_file), exist_ok=True)

    # 如果输出文件已存在，先清空
    if os.path.isfile(output_file):
        os.unlink(output_file)

    # 构造命令
    cmd = build_nuclei_command(nuclei_path, args, output_file)

    # 执行扫描
    try:
        process = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=3600,  # 1小时超时
        )
        scan_stderr = process.stderr
        scan_stdout = process.stdout
    except subprocess.TimeoutExpired:
        duration = time.time() - start_time
        result = {
            "target": args.target,
            "templates_used": args.templates,
            "total_findings": 0,
            "scan_duration": f"{duration:.1f}s",
            "findings": [],
            "error": "扫描超时（3600秒）",
            "status": "timeout",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    except Exception as e:
        duration = time.time() - start_time
        result = {
            "target": args.target,
            "templates_used": args.templates,
            "total_findings": 0,
            "scan_duration": f"{duration:.1f}s",
            "findings": [],
            "error": f"扫描执行异常: {str(e)}",
            "status": "failed",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    # 解析结果
    findings = parse_nuclei_output(output_file)
    duration = time.time() - start_time

    result = {
        "target": args.target,
        "templates_used": args.templates,
        "total_findings": len(findings),
        "scan_duration": f"{duration:.1f}s",
        "findings": findings,
        "nuclei_version": get_nuclei_version(nuclei_path),
        "output_file": output_file,
        "status": "success",
    }

    print(json.dumps(result, ensure_ascii=False, indent=2))


def get_nuclei_version(nuclei_path):
    """获取 nuclei 版本号。"""
    try:
        result = subprocess.run(
            [nuclei_path, "-version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        output = (result.stdout + result.stderr).strip()
        # 提取版本号
        for line in output.split("\n"):
            if "version" in line.lower() or "v3" in line.lower():
                return line.strip()
        return output.split("\n")[0] if output else "unknown"
    except Exception:
        return "unknown"


# ============================================================
# 主入口
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Nuclei 漏洞扫描执行器 - 自动检测安装 Nuclei 并执行扫描"
    )
    parser.add_argument("--target", required=True,
                        help="目标 URL/IP/CIDR，支持逗号分隔多个目标")
    parser.add_argument("--templates", default="all",
                        choices=["all", "cves", "exposures", "misconfig",
                                 "takeovers", "default-detections",
                                 "vulnerabilities", "workflows",
                                 "fuzz", "dast"],
                        help="模板类别（默认 all）")
    parser.add_argument("--severity", default="",
                        help="严重等级过滤：critical/high/medium/low/info，逗号分隔")
    parser.add_argument("--tags", default="",
                        help="标签过滤，逗号分隔（可选）")
    parser.add_argument("--rate-limit", type=int, default=150,
                        help="每秒请求数（默认 150）")
    parser.add_argument("--concurrency", type=int, default=25,
                        help="并发数（默认 25）")
    parser.add_argument("--timeout", type=int, default=10,
                        help="单请求超时秒数（默认 10）")
    parser.add_argument("--retries", type=int, default=1,
                        help="重试次数（默认 1）")
    parser.add_argument("--proxy", default="",
                        help="代理地址（可选）")
    parser.add_argument("--output", default="",
                        help="结果保存文件路径（可选）")
    parser.add_argument("--json-output", action="store_true", default=True,
                        help="JSON 格式输出（默认开启；保留 default=True 以维持原有默认行为）")
    parser.add_argument("--nuclei-path", default="",
                        help="nuclei 二进制路径（默认自动检测）")
    parser.add_argument("--update-templates", action="store_true",
                        help="更新模板库")

    args = parser.parse_args()
    run_scan(args)


if __name__ == "__main__":
    main()
