#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""binpatch.py — ELF 条件分支翻转补丁器（AArch64 / x86_64）
定制步骤 1..7 的可跑实现：定位 → 反汇编分支推理 → 改字节 → 写副本 → 出清单 → 打包 → 回滚。

用法:
  python3 binpatch.py --bin TARGET_BIN --func main --check license_ok --dry-run
  python3 binpatch.py --bin TARGET_BIN --func main --check license_ok --apply --out TARGET_BIN.patched
  python3 binpatch.py --bin TARGET_BIN.patched --rollback TARGET_BIN.orig
  python3 binpatch.py --manifest TARGET_BIN.patch.json --pack TARGET_BIN.patched
"""
import argparse, hashlib, json, os, re, shutil, struct, subprocess, sys, tarfile, time

# ---- 常量 / magic：架构相关 opcode 基址与掩码（与注释同行，便于审读）----
ELF_MAGIC = b"\x7fELF"          # magic：ELF 文件头
A64_BCOND = 0x54000000          # 常量：AArch64 条件分支 b.cond 的 opcode 基址（bits[3:0]=cond）
A64_CBZ = 0x34000000            # 常量：AArch64 cbz 基址；cbnz = 该值 | (1<<24)
A64_NOP = 0xD503201F            # 常量：AArch64 NOP
A64_B = 0x14000000              # 常量：AArch64 无条件分支 b 的 opcode 基址（imm26 与 b.cond 同布局）
X64_JCC_SHORT = 0x70            # 常量：x86_64 短条件跳转 0x7x 基址
X64_JMP_SHORT = 0xEB            # 常量：x86_64 短无条件跳转 jmp rel8
X64_JCC_NEAR = 0x80             # 常量：x86_64 0F 8x 近条件跳转族
X64_JMP_NEAR = 0xE9             # 常量：x86_64 近无条件跳转 jmp rel32
X64_NOP = 0x90                  # 常量：x86_64 NOP
COND_SWAP = {0: 1, 1: 0}        # AArch64 cond: EQ(0)<->NE(1)


def sha256(path, n=None):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(1 << 20)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def elf_sections(path):
    """纯 Python 解析 ELF64 section headers -> [(name, addr, off, size, idx)]（不依赖 readelf）。"""
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != ELF_MAGIC:
        raise SystemExit("not an ELF: " + path)
    if data[4] != 2:                       # EI_CLASS: 2=ELF64
        raise SystemExit("unsupported EI_CLASS (need ELF64)")
    e_shoff, = struct.unpack_from("<Q", data, 0x28)
    e_shentsize, e_shnum, e_shstrndx = struct.unpack_from("<HHH", data, 0x3A)
    shs = []
    for i in range(e_shnum):
        base = e_shoff + i * e_shentsize
        name, typ, flags, addr, off, size = struct.unpack_from("<IIQQQQ", data, base)
        shs.append([name, typ, flags, addr, off, size, i])
    strtab = shs[e_shstrndx]
    for s in shs:
        p = strtab[4] + s[0]
        s[0] = data[p:data.index(b"\x00", p)].decode("latin1")
    return data, shs


def vaddr_to_off(shs, vaddr):
    cands = [s for s in shs if s[5] and s[3] <= vaddr < s[3] + s[5]]
    if not cands:
        raise SystemExit("vaddr 0x%x 不在任何节内" % vaddr)
    s = min(cands, key=lambda x: x[5])
    if not (s[2] & 0x4):                   # SHF_EXECINSTR
        print("!! 警告: 0x%x 落在非可执行节 %s" % (vaddr, s[0]), file=sys.stderr)
    return s[3], s[4] + (vaddr - s[3]), s


def objdump_lines(path):
    exe = shutil.which("objdump")
    if not exe:
        return None
    out = subprocess.run([exe, "-d", "--no-show-raw-insn", path],
                         capture_output=True, text=True, check=True).stdout
    return out.splitlines()


def find_branch_vaddr(lines, func, check):
    """在 <func> 体内定位「bl/call <check>」之后的第一条条件分支，返回 (vaddr, asm)。"""
    in_func, seen_call = False, False
    pat_func = re.compile(r"^[0-9a-f]+ <" + re.escape(func) + r">:")
    pat_any = re.compile(r"^[0-9a-f]+ <")
    pat_ins = re.compile(r"^\s*([0-9a-f]+):\s+(.*)$")
    pat_call = re.compile(r"\b(bl|call)\b.*<" + re.escape(check) + r"[+>]")
    pat_cond = re.compile(r"\b(b\.[a-z]{2}|cbz|cbnz|j[a-z]{1,2})\b")
    for ln in lines:
        if pat_func.match(ln):
            in_func, seen_call = True, False
            continue
        if in_func and pat_any.match(ln):
            break
        if not in_func:
            continue
        m = pat_ins.match(ln)
        if not m:
            continue
        va, asm = int(m.group(1), 16), m.group(2)
        if not seen_call:
            if pat_call.search(asm):
                seen_call = True
            continue
        if pat_cond.search(asm) and "ret" not in asm:
            return va, asm
    return None, None


def flip_vaddr(vaddr, off, machine, mode):
    """就地改写分支条件；返回 (orig_bytes, new_bytes)。mode: invert | nop | force(无条件跳转)"""
    cur = open(FILE["bin"], "rb").read()[off:off + 4]
    if machine == 0xB7:                                        # EM_AARCH64
        w, = struct.unpack("<I", cur)
        if mode == "nop":
            new = struct.pack("<I", A64_NOP)
        elif mode == "force":                                  # b.cond/cbz/cbnz -> b <原目标>
            if (w & 0xFE000000) == A64_BCOND or (w & 0x7F000000) in (A64_CBZ, A64_CBZ | 0x01000000):
                imm19 = (w >> 5) & 0x7FFFF                    # b.cond 与 cbz 同布局：imm19 是「字」偏移
                imm19 -= (imm19 & (1 << 18)) << 1              # 符号扩展（19 位二补）
                imm26 = imm19 & 0x03FFFFFF                     # b 的 imm26 与 b.cond 的 imm19 同单位，直接搬运
            else:
                raise SystemExit("force 模式不支持的 AArch64 指令: 0x%08x" % w)
            new = struct.pack("<I", A64_B | imm26)             # b <target>，无条件
        elif (w & 0xFF000000) in (A64_CBZ, A64_CBZ | 0x01000000):
            new = struct.pack("<I", w ^ 0x01000000)            # cbz <-> cbnz
        elif (w & 0xFE000000) == A64_BCOND:
            new = struct.pack("<I", (w & ~0xF) | COND_SWAP[(w & 0xF)])   # b.EQ <-> b.NE
        else:
            raise SystemExit("0x%x 不是可翻转的 AArch64 条件分支: 0x%08x" % (vaddr, w))
    elif machine == 0x3E:                                      # EM_X86_64
        if mode == "nop":
            new = bytes([X64_NOP]) * (2 if cur[0] == 0x0F else 1)
        elif mode == "force":
            if cur[0] == 0x0F and (cur[1] & 0xF0) == X64_JCC_NEAR:
                new = bytes([X64_JMP_NEAR]) + cur[2:6]         # 0F 8x rel32 -> E9 rel32
            elif (cur[0] & 0xF0) == X64_JCC_SHORT:
                new = bytes([X64_JMP_SHORT]) + cur[1:2]        # 7x rel8 -> EB rel8
            else:
                raise SystemExit("force 模式不支持的 x86_64 指令: %s" % cur.hex())
        elif cur[0] == 0x0F and (cur[1] & 0xF0) == X64_JCC_NEAR:
            new = bytes([0x0F, cur[1] ^ 1])
        elif (cur[0] & 0xF0) == X64_JCC_SHORT:
            new = bytes([cur[0] ^ 1])
        else:
            raise SystemExit("0x%x 不是可翻转的 x86_64 条件分支: %s" % (vaddr, cur.hex()))
    else:
        raise SystemExit("未支持的 e_machine=0x%x" % machine)
    return cur, new


def find_sig_off(data, shs, sig):
    """AOB 特征码定位：'aa bb ?? cc' -> 可执行节内的文件偏移（找不到返回 None）。"""
    toks = sig.replace("  ", " ").split()
    pat, mask = b"", []
    for t in toks:
        if t in ("?", "??", "**"):
            pat += b"\x00"; mask.append(0)
        else:
            pat += bytes.fromhex(t); mask.append(1)
    for s in shs:
        if not (s[2] & 0x4) or not s[5]:                        # SHF_EXECINSTR
            continue
        blob = data[s[4]:s[4] + s[5]]
        for i in range(0, len(blob) - len(pat) + 1):
            if all((not mask[k]) or blob[i + k] == pat[k] for k in range(len(pat))):
                return s[4] + i, s[0]
    return None, None


FILE = {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin"); ap.add_argument("--func", default="main")
    ap.add_argument("--check", default="license_ok")
    ap.add_argument("--apply", action="store_true"); ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--mode", choices=("invert", "nop", "force"), default="invert")
    ap.add_argument("--out"); ap.add_argument("--manifest")
    ap.add_argument("--rollback"); ap.add_argument("--pack")
    ap.add_argument("--at", help="直接给文件偏移（stripped 目标；OFFSET_1=0x...）")
    ap.add_argument("--vaddr", help="--at 模式下用于反汇编显示的虚拟地址")
    ap.add_argument("--sig", help="AOB 特征码，例: 'aa bb ?? cc'（无符号表时的定位方式）")
    a = ap.parse_args()

    if a.rollback:
        src, dst = a.rollback, a.bin
        shutil.copy2(src, dst)
        print(json.dumps({"rollback": {"from": src, "to": dst, "sha256": sha256(dst)}}, ensure_ascii=False))
        return 0

    if a.pack:
        mf = json.load(open(a.manifest, encoding="utf-8")) if a.manifest else {"target": a.pack}
        mf["packed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        mf["payload_sha256"] = sha256(a.pack)
        mp = a.pack + ".manifest.json"
        open(mp, "w", encoding="utf-8").write(json.dumps(mf, ensure_ascii=False, indent=1))
        tgz = a.pack + ".pkg.tar.gz"
        with tarfile.open(tgz, "w:gz") as t:
            t.add(a.pack, arcname=os.path.basename(a.pack))
            t.add(mp, arcname=os.path.basename(mp))
            t.add(__file__, arcname="binpatch.py")
        print(json.dumps({"pack": {"tgz": tgz, "sha256": sha256(tgz),
                                   "payload_sha256": mf["payload_sha256"]}}, ensure_ascii=False))
        return 0

    if not a.bin:
        raise SystemExit("--bin 必填（--pack 模式除外）")
    FILE["bin"] = a.bin
    data, shs = elf_sections(a.bin)
    machine, = struct.unpack_from("<H", data, 0x12)

    if a.at or a.sig:
        if a.sig:
            off, secname = find_sig_off(data, shs, a.sig)
            if off is None:
                raise SystemExit("AOB 特征码未命中: " + a.sig)
            base, base_off, sec = vaddr_to_off(shs, next(
                s[3] + (off - s[4]) for s in shs if s[4] <= off < s[4] + s[5]))
            vaddr = int(a.vaddr, 16) if a.vaddr else base
        else:
            off = int(a.at, 0)
            sec = next((s for s in shs if s[4] <= off < s[4] + s[5]), None)
            if sec is None:
                raise SystemExit("偏移不在任何节内")
            secname = sec[0]
            vaddr = int(a.vaddr, 16) if a.vaddr else sec[3] + (off - sec[4])
        asm = "(直接偏移模式；vaddr=0x%x)" % vaddr
    else:
        lines = objdump_lines(a.bin)
        if lines is None:
            raise SystemExit("需要 objdump（apt install binutils）；无 objdump 时改用 --sig/--at 字节定位")
        vaddr, asm = find_branch_vaddr(lines, a.func, a.check)
        if vaddr is None:
            raise SystemExit("未在 <%s> 中找到调用 <%s> 后的条件分支" % (a.func, a.check))
        seg_addr, off, sec = vaddr_to_off(shs, vaddr)
        secname = sec[0]
    cur, new = flip_vaddr(vaddr, off, machine, a.mode)
    rec = {"target": os.path.abspath(a.bin), "target_sha256": sha256(a.bin),
           "arch": {0xB7: "aarch64", 0x3E: "x86_64"}.get(machine, hex(machine)),
           "func": a.func, "check_symbol": a.check, "section": secname,
           "branch_vaddr": "TARGET_ADDR=0x%x" % vaddr, "branch_asm": asm,
           "offset": "OFFSET_1=0x%x" % off, "orig": "PATCH_BYTE_ORIG=" + cur.hex(),
           "patch": "PATCH_BYTE=" + new.hex(), "mode": a.mode}
    print(json.dumps(rec, ensure_ascii=False, indent=1))
    if a.apply:
        out = a.out or (a.bin + ".patched")
        buf = bytearray(data); buf[off:off + len(new)] = new
        open(out, "wb").write(bytes(buf))
        shutil.copymode(a.bin, out)                    # 保留可执行位，否则 patched 副本 Permission denied
        rec["out"] = os.path.abspath(out); rec["out_sha256"] = sha256(out)
        mp = a.manifest or (out + ".patch.json")
        json.dump(rec, open(mp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(json.dumps({"applied": {"out": out, "manifest": mp, "sha256": rec["out_sha256"]}},
                         ensure_ascii=False))
    else:
        print(json.dumps({"dry_run": True, "note": "未落盘；加 --apply 生成副本"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
