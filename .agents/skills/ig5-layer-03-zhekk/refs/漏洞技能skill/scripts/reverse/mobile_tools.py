#!/usr/bin/env python3
"""移动安全工具 — APK信息/组件导出/ADB操作"""
import argparse, json, subprocess, sys, os, re, xml.etree.ElementTree as ET

def run(cmd, timeout=30, shell=False):
    try:
        r = subprocess.run(cmd if isinstance(cmd, list) and not shell else cmd, capture_output=True, text=True, timeout=timeout, shell=shell)
        return r.stdout.strip() if r.returncode == 0 else r.stderr.strip()
    except: return ""

def apk_info(apk_path):
    """APK基本信息"""
    info = {}
    if os.path.exists(apk_path):
        info["size"] = os.path.getsize(apk_path)
        info["file_type"] = run(["file", apk_path])
    info["aapt"] = run(f"aapt dump badging {apk_path} 2>/dev/null", shell=True)[:2000]
    for line in info.get("aapt", "").split("\n"):
        if "package:" in line:
            m = re.search(r"name='([^']+)'.*versionCode='([^']+)'.*versionName='([^']+)'", line)
            if m: info["package"], info["version_code"], info["version_name"] = m.group(1), m.group(2), m.group(3)
        if "sdkVersion:" in line:
            m = re.search(r"sdkVersion:'(\d+)'", line)
            if m: info["min_sdk"] = m.group(1)
        if "targetSdkVersion:" in line:
            m = re.search(r"targetSdkVersion:'(\d+)'", line)
            if m: info["target_sdk"] = m.group(1)
    return info

def apk_exported_components(apk_path):
    """导出组件检测"""
    if not os.path.exists(apk_path):
        return []
    # 用apktool解包manifest
    tmp = "/tmp/zhekk_apk_audit"
    run(f"rm -rf {tmp} && apktool d -s -f {apk_path} -o {tmp}", shell=True, timeout=60)
    manifest = f"{tmp}/AndroidManifest.xml"
    components = []
    if os.path.exists(manifest):
        try:
            tree = ET.parse(manifest)
            root = tree.getroot()
            for comp_type in ["activity", "service", "receiver", "provider"]:
                for el in root.iter(comp_type):
                    name = el.get("{http://schemas.android.com/apk/res/android}name", "")
                    exported = el.get("{http://schemas.android.com/apk/res/android}exported", "")
                    if exported == "true" or (exported == "" and any(el.findall(f".//intent-filter"))):
                        components.append({"type": comp_type, "name": name, "exported": True})
        except: pass
    run(f"rm -rf {tmp}", shell=True)
    return components

def adb_devices():
    """ADB设备列表"""
    return run(["adb", "devices"])

def adb_packages():
    """已安装包列表"""
    return run("adb shell pm list packages 2>/dev/null", shell=True)

def main():
    ap = argparse.ArgumentParser(description="移动安全工具")
    sub = ap.add_subparsers(dest="cmd")
    
    sp_info = sub.add_parser("info", help="APK信息")
    sp_info.add_argument("--apk", required=True)
    
    sp_comp = sub.add_parser("components", help="导出组件")
    sp_comp.add_argument("--apk", required=True)
    
    sp_adb = sub.add_parser("adb", help="ADB设备")
    sp_adb.add_argument("--action", default="devices", help="devices/packages")
    
    ap.add_argument("--json", action="store_true")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()
    
    result = {}
    
    if args.cmd == "info":
        result = apk_info(args.apk)
    elif args.cmd == "components":
        comps = apk_exported_components(args.apk)
        result = {"components": comps, "total": len(comps)}
    elif args.cmd == "adb":
        if args.action == "packages":
            result = {"packages": adb_packages()}
        else:
            result = {"devices": adb_devices()}
    else:
        # 默认显示设备
        result = {"devices": adb_devices()}
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(json.dumps(result, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()