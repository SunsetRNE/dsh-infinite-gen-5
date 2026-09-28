#!/usr/bin/env python3
"""ig5_peer.py —— IG5 帧协议 Python 对端（与 C++ frame.cpp 同源同构）
用法: python3 ig5_peer.py encode <opcode> <payload> | decode <hex> | selftest
"""
import struct, sys

MAGIC = 0x49473531          # 帧头 magic 常量（"IG51" 小端）
POLY = 0xEDB88320           # CRC32 反射多项式常量（IEEE 802.3）
HDR = 16                    # magic4 + opcode2 + flags2 + len4 + crc4
MAX_PAYLOAD = 1024 * 1024


def crc32(data: bytes, seed: int = 0) -> int:
    c = seed ^ 0xFFFFFFFF
    for b in data:
        c ^= b
        for _ in range(8):
            c = (c >> 1) ^ POLY if c & 1 else c >> 1
    return c ^ 0xFFFFFFFF


def encode(opcode: int, payload: bytes, flags: int = 0) -> bytes:
    if len(payload) > MAX_PAYLOAD:
        raise ValueError("payload exceeds MAX_PAYLOAD")
    head = struct.pack("<IHHI", MAGIC, opcode, flags, len(payload))
    return head + struct.pack("<I", crc32(payload, crc32(head))) + payload


def decode_stream(buf: bytes):
    """返回 (frames, errors)；半包/坏帧按协议丢弃并记录原因"""
    out, errors, off = [], [], 0
    while len(buf) - off >= HDR:
        magic, opcode, flags, ln = struct.unpack_from("<IHHI", buf, off)
        if magic != MAGIC:
            errors.append("bad magic: resync"); off += 1; continue
        if ln > MAX_PAYLOAD:
            errors.append("oversized frame: drop"); off += HDR; continue
        if len(buf) - off < HDR + ln:
            break                                   # 半包：等更多字节
        head = buf[off:off + 12]
        body = buf[off + HDR: off + HDR + ln]
        got = struct.unpack_from("<I", buf, off + 12)[0]
        if crc32(body, crc32(head)) != got:
            errors.append("crc mismatch: drop"); off += HDR + ln; continue
        out.append({"opcode": opcode, "flags": flags, "payload": body})
        off += HDR + ln
    return out, errors


def selftest() -> int:
    fails = 0
    def ck(ok, name):
        nonlocal fails
        fails += 0 if ok else 1
        print(f"{name:<40} {'PASS' if ok else 'FAIL'}")
    ck(crc32(b"123456789") == 0xCBF43926, "1 crc32 校验向量")          # CRC 标准检验值
    w = encode(7, b"HELLO_PAYLOAD")
    fr, er = decode_stream(w)
    ck(len(fr) == 1 and fr[0]["opcode"] == 7 and fr[0]["payload"] == b"HELLO_PAYLOAD" and not er, "2 round-trip")
    fr, er = decode_stream(b"\x00" + w)                                # 垃圾前缀重同步
    ck(len(fr) == 1, "3 前缀失步后重同步")
    bad = bytearray(w); bad[HDR + 2] ^= 1
    fr, er = decode_stream(bytes(bad))
    ck(not fr and er and er[0] == "crc mismatch: drop", "4 位翻转被 CRC 拦下")
    print(f"FAILS={fails}")
    return fails


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "selftest"
    if cmd == "encode":
        op = int(sys.argv[2]); pl = sys.argv[3].encode()
        print(encode(op, pl).hex())
    elif cmd == "decode":
        frames, errors = decode_stream(bytes.fromhex(sys.argv[2]))
        for f in frames:
            print(f"opcode={f['opcode']} flags={f['flags']} payload={f['payload'].decode(errors='replace')!r}")
        for e in errors:
            print(f"error: {e}")
    else:
        sys.exit(selftest())
