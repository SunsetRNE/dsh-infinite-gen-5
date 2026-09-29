#!/usr/bin/env python3
"""隐写分析工具 — LSB检测+元数据+文件尾+编码"""
import argparse, json, sys, os, re, base64, codecs, struct

def check_file_tail(filepath):
    """检查文件尾部附加数据"""
    with open(filepath, "rb") as f:
        data = f.read()
    # PNG: IEND 后
    png_end = b"IEND\xaeB`\x82"
    pos = data.find(png_end)
    if pos >= 0:
        trailer = data[pos + len(png_end):]
        if len(trailer) > 0:
            return {"type": "png_trailer", "size": len(trailer), "hex": trailer[:100].hex(), "text": trailer[:200].decode("latin-1")}
    # JPEG: FFD9 后
    jpg_end = b"\xff\xd9"
    pos = data.rfind(jpg_end)
    if pos >= 0 and pos + 2 < len(data) - 10:
        trailer = data[pos + 2:]
        if len(trailer) > 10:
            return {"type": "jpeg_trailer", "size": len(trailer), "text": trailer[:200].decode("latin-1")}
    return None

def check_lsb_png(filepath):
    """PNG LSB检测"""
    try:
        from PIL import Image
        img = Image.open(filepath)
        if img.mode not in ("RGB", "RGBA"): return []
        pixels = list(img.getdata())
        results = []
        for plane, name in enumerate(["R", "G", "B"]):
            if plane >= len(pixels[0]): break
            zeros = sum(1 for p in pixels if (p[plane] & 1) == 0)
            ones = len(pixels) - zeros
            ratio = zeros / len(pixels)
            if ratio < 0.45 or ratio > 0.55:
                results.append({"plane": name, "ratio": f"{ratio:.3f}", "anomaly": "LSB分布异常"})
        return results
    except: return []

def check_metadata(filepath):
    """检查元数据"""
    try:
        from PIL import Image, ExifTags
        img = Image.open(filepath)
        exif = img._getexif()
        if exif:
            items = {}
            for tag, value in exif.items():
                name = ExifTags.TAGS.get(tag, tag)
                if name in ("UserComment", "MakerNote", "ImageDescription", "Artist", "Copyright"):
                    items[name] = str(value)[:200]
            return items
    except: pass
    return {}

def check_encoding(data_str):
    """检查编码"""
    results = []
    # Base64
    if re.match(r"^[A-Za-z0-9+/]+={0,2}$", data_str):
        try:
            decoded = base64.b64decode(data_str)
            results.append(("Base64", decoded.decode("utf-8","ignore")[:200]))
        except: pass
    # Hex
    if re.match(r"^[0-9a-fA-F]+$", data_str) and len(data_str) % 2 == 0:
        try:
            results.append(("Hex", bytes.fromhex(data_str).decode("utf-8","ignore")[:200]))
        except: pass
    # ROT13
    try:
        results.append(("ROT13", codecs.decode(data_str, "rot_13")[:200]))
    except: pass
    return results

def main():
    ap = argparse.ArgumentParser(description="隐写分析")
    ap.add_argument("--file", required=True, help="文件路径")
    ap.add_argument("--check", default="all", help="all/tail/lsb/metadata/encoding")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()
    
    result = {"file": args.file, "findings": []}
    
    if args.check in ("all", "tail"):
        tail = check_file_tail(args.file)
        if tail: result["findings"].append({"method": "file_tail", "data": tail})
    
    if args.check in ("all", "lsb"):
        lsb = check_lsb_png(args.file)
        if lsb: result["findings"].append({"method": "lsb", "data": lsb})
    
    if args.check in ("all", "metadata"):
        meta = check_metadata(args.file)
        if meta: result["findings"].append({"method": "metadata", "data": meta})
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"[*] 隐写分析: {args.file}")
        for f in result["findings"]:
            print(f"  [{f['method']}] {json.dumps(f['data'], indent=2, ensure_ascii=False)[:300]}")
        if not result["findings"]:
            print("  未发现隐写")

if __name__ == "__main__":
    main()