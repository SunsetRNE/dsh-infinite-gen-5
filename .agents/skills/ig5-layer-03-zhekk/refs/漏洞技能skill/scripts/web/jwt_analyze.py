#!/usr/bin/env python3
"""JWT分析器 — 解码+算法检测+弱密钥爆破"""
import argparse, json, base64, hmac, hashlib, sys, time

def decode_jwt(jwt_str):
    """解码JWT"""
    parts = jwt_str.split(".")
    result = {"parts": len(parts), "header": {}, "payload": {}, "signature": "", "issues": []}
    
    if len(parts) < 2:
        result["issues"].append("不是有效的JWT格式")
        return result
    
    for i, part in enumerate(parts[:2]):
        try:
            padded = part + "=" * (4 - len(part) % 4)
            decoded = json.loads(base64.urlsafe_b64decode(padded))
            if i == 0:
                result["header"] = decoded
            else:
                result["payload"] = decoded
        except Exception as e:
            result["issues"].append(f"Part {i} 解码失败: {e}")
    
    if len(parts) >= 3:
        result["signature"] = parts[2][:20] + "..."
    
    # 检查安全问题
    h = result["header"]
    if h.get("alg") == "none":
        result["issues"].append("!! 算法为none，可被绕过")
    if h.get("alg") == "HS256" and "RS256" not in str(h):
        result["issues"].append("使用对称加密(HS256)，需检查密钥强度")
    if "kid" in h:
        result["issues"].append(f"存在kid字段: {h['kid']}，可能路径遍历")
    if "jku" in h or "jwk" in h:
        result["issues"].append(f"存在jku/jwk字段，可能SSRF")
    
    p = result["payload"]
    if "exp" in p:
        try:
            exp_time = int(p["exp"])
            if exp_time < time.time():
                result["issues"].append("JWT已过期")
        except: pass
    
    return result

def weak_key_check(jwt_str):
    """弱密钥爆破"""
    parts = jwt_str.split(".")
    if len(parts) < 3:
        return []
    header_payload = f"{parts[0]}.{parts[1]}"
    target_sig = parts[2]
    
    common_keys = ["secret", "key", "password", "jwt_secret", "changeme", "123456", "admin", "test", "demo", "jwt", "token", "secretkey", "private", "public", "default"]
    
    found = []
    for key in common_keys:
        try:
            sig = base64.urlsafe_b64encode(
                hmac.new(key.encode(), header_payload.encode(), hashlib.sha256).digest()
            ).rstrip(b"=").decode()
            if sig == target_sig:
                found.append(key)
        except: pass
    return found

def main():
    ap = argparse.ArgumentParser(description="JWT分析器")
    ap.add_argument("--jwt", required=True, help="JWT字符串")
    ap.add_argument("--crack", action="store_true", help="尝试弱密钥爆破")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    
    result = decode_jwt(args.jwt)
    result["jwt"] = args.jwt[:50] + "..."
    
    if args.crack:
        keys = weak_key_check(args.jwt)
        result["weak_keys"] = keys
        if keys:
            result["issues"].append(f"!! 弱密钥: {keys}")
    
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"Header: {json.dumps(result['header'], indent=2)}")
        print(f"Payload: {json.dumps(result['payload'], indent=2)}")
        if result["issues"]:
            print(f"\n问题:")
            for i in result["issues"]:
                print(f"  {i}")
        if result.get("weak_keys"):
            print(f"\n弱密钥: {result['weak_keys']}")

if __name__ == "__main__":
    main()