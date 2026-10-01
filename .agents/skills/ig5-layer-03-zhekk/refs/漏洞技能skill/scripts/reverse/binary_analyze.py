#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
binary_analyze.py - ELF/SO 二进制文件结构分析工具

功能：
  - 解析 ELF Header / Program Header / Section Header
  - 解析动态符号表 (.dynsym/.dynstr)、.interp、.note
  - 提取导入/导出函数
  - 检测安全特性 (NX/PIE/RELRO/Canary/FORTIFY)
  - 识别内嵌加密算法常量 (AES/DES/RC4/MD5/SHA/CRC32)

仅依赖 Python 标准库 struct，无需 readelf/binutils。
"""

import argparse
import json
import os
import struct
import sys
import signal

# ---------------------------------------------------------------------------
# ELF 常量定义
# ---------------------------------------------------------------------------
ELFMAG = b"\x7fELF"

# e_ident[EI_CLASS]
ELFCLASS32 = 1
ELFCLASS64 = 2

# e_ident[EI_DATA]
ELFDATA2LSB = 1  # Little Endian
ELFDATA2MSB = 2  # Big Endian

# e_type
ET_NAMES = {
    0: "ET_NONE",
    1: "ET_REL",
    2: "ET_EXEC",
    3: "ET_DYN",
    4: "ET_CORE",
}

# e_machine
EM_NAMES = {
    0: "EM_NONE",
    3: "EM_386",
    8: "EM_MIPS",
    20: "EM_PPC",
    40: "EM_ARM",
    62: "EM_X86_64",
    183: "EM_AARCH64",
    243: "EM_RISCV",
}

# Program header types
PT_NAMES = {
    0: "PT_NULL",
    1: "PT_LOAD",
    2: "PT_DYNAMIC",
    3: "PT_INTERP",
    4: "PT_NOTE",
    5: "PT_SHLIB",
    6: "PT_PHDR",
    7: "PT_TLS",
    0x6474e550: "PT_GNU_EH_FRAME",
    0x6474e551: "PT_GNU_STACK",
    0x6474e552: "PT_GNU_RELRO",
    0x6474e553: "PT_GNU_PROPERTY",
}

# Program header flags
PF_X = 0x1
PF_W = 0x2
PF_R = 0x4

# Section header types
SHT_NAMES = {
    0: "SHT_NULL",
    1: "SHT_PROGBITS",
    2: "SHT_SYMTAB",
    3: "SHT_STRTAB",
    4: "SHT_RELA",
    5: "SHT_HASH",
    6: "SHT_DYNAMIC",
    7: "SHT_NOTE",
    8: "SHT_NOBITS",
    9: "SHT_REL",
    10: "SHT_SHLIB",
    11: "SHT_DYNSYM",
    14: "SHT_INIT_ARRAY",
    15: "SHT_FINI_ARRAY",
    16: "SHT_PREINIT_ARRAY",
    17: "SHT_GROUP",
    18: "SHT_SYMTAB_SHNDX",
}

# Section flags
SHF_WRITE = 0x1
SHF_ALLOC = 0x2
SHF_EXECINSTR = 0x4

# Symbol binding/type
STB_NAMES = {0: "LOCAL", 1: "GLOBAL", 2: "WEAK"}
STT_NAMES = {0: "NOTYPE", 1: "OBJECT", 2: "FUNC", 3: "SECTION", 4: "FILE"}

SHN_UNDEF = 0

# ---------------------------------------------------------------------------
# 加密算法常量签名
# ---------------------------------------------------------------------------
AES_SBOX = bytes([
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5,
    0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
])
AES_INV_SBOX = bytes([
    0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38,
    0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb,
])
AES_RCON = bytes([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36])

# DES S-Box S1 第一行
DES_SBOX1 = bytes([14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7])

# CRC32 多项式 (reflected)
CRC32_POLY_LE = struct.pack("<I", 0xEDB88320)
CRC32_POLY_BE = struct.pack(">I", 0x04C11DB7)

# 哈希初始化向量 (小端字节序存储在文件中)
MD5_INIT = struct.pack("<IIII", 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476)
SHA1_INIT = struct.pack("<IIIII", 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0)
SHA256_INIT = struct.pack(
    "<IIIIIIII",
    0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
    0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
)
SHA224_INIT = struct.pack(
    "<IIIIIIII",
    0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939,
    0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4,
)
# SHA-512 init (前64位)
SHA512_INIT_HI = struct.pack(
    "<QQ",
    0x6a09e667f3bcc908, 0xbb67ae8584caa73b,
)
# SHA-384 init (前64位)
SHA384_INIT_HI = struct.pack(
    "<QQ",
    0xcbbb9d5dc1059ed8, 0x629a292a367cd507,
)

# RC4 KSA 起始特征：连续的 0x00..0xff 序列
def detect_rc4_init(data, window=256):
    """检测 RC4 S-box 初始化序列 (0x00 0x01 0x02 ... 0xff)"""
    target = bytes(range(256))
    return data.find(target) != -1


CRYPTO_SIGNATURES = [
    ("AES", AES_SBOX),
    ("AES (Inverse S-Box)", AES_INV_SBOX),
    ("DES (S-Box)", DES_SBOX1),
    ("MD5", MD5_INIT),
    ("SHA-1", SHA1_INIT),
    ("SHA-224", SHA224_INIT),
    ("SHA-256", SHA256_INIT),
    ("SHA-384", SHA384_INIT_HI),
    ("SHA-512", SHA512_INIT_HI),
    ("CRC32 (poly LE)", CRC32_POLY_LE),
    ("CRC32 (poly BE)", CRC32_POLY_BE),
    ("AES (Rcon)", AES_RCON),
]


# ---------------------------------------------------------------------------
# ELF 解析器
# ---------------------------------------------------------------------------
class ELFParser:
    def __init__(self, path):
        self.path = path
        with open(path, "rb") as f:
            self.data = f.read()
        self.is64 = None
        self.little = None
        self.endian = None
        self.header = {}
        self.program_headers = []
        self.section_headers = []
        self.shstrtab = b""
        self.dynstr = b""
        self.dynsym = []
        self._parse()

    # -- 字节序辅助 --
    def _u16(self, off):
        return struct.unpack_from(self.endian + "H", self.data, off)[0]

    def _u32(self, off):
        return struct.unpack_from(self.endian + "I", self.data, off)[0]

    def _u64(self, off):
        return struct.unpack_from(self.endian + "Q", self.data, off)[0]

    def _addr(self, off):
        return self._u64(off) if self.is64 else self._u32(off)

    def _parse(self):
        if len(self.data) < 64 or self.data[:4] != ELFMAG:
            raise ValueError("Not an ELF file (bad magic)")

        ei_class = self.data[4]
        ei_data = self.data[5]
        if ei_class == ELFCLASS32:
            self.is64 = False
        elif ei_class == ELFCLASS64:
            self.is64 = True
        else:
            raise ValueError("Unknown ELF class: %d" % ei_class)

        if ei_data == ELFDATA2LSB:
            self.little = True
            self.endian = "<"
        elif ei_data == ELFDATA2MSB:
            self.little = False
            self.endian = ">"
        else:
            raise ValueError("Unknown ELF data encoding: %d" % ei_data)

        self._parse_header()
        self._parse_program_headers()
        self._parse_section_headers()
        self._parse_dynamic_symbols()

    def _parse_header(self):
        d = self.data
        e = self.endian
        h = {}
        h["magic"] = "7f454c46"
        h["class"] = "ELF64" if self.is64 else "ELF32"
        h["data"] = "Little Endian" if self.little else "Big Endian"
        h["version"] = d[6]
        h["osabi"] = d[7]
        h["e_type"] = self._u16(16)
        h["e_type_name"] = ET_NAMES.get(h["e_type"], "UNKNOWN(0x%x)" % h["e_type"])
        h["e_machine"] = self._u16(18)
        h["e_machine_name"] = EM_NAMES.get(h["e_machine"], "UNKNOWN(0x%x)" % h["e_machine"])
        h["e_version"] = self._u32(20)
        off = 24
        h["e_entry"] = self._addr(off)
        if self.is64:
            h["e_phoff"] = self._u64(32)
            h["e_shoff"] = self._u64(40)
            h["e_flags"] = self._u32(48)
            h["e_ehsize"] = self._u16(52)
            h["e_phentsize"] = self._u16(54)
            h["e_phnum"] = self._u16(56)
            h["e_shentsize"] = self._u16(58)
            h["e_shnum"] = self._u16(60)
            h["e_shstrndx"] = self._u16(62)
        else:
            h["e_phoff"] = self._u32(28)
            h["e_shoff"] = self._u32(32)
            h["e_flags"] = self._u32(36)
            h["e_ehsize"] = self._u16(40)
            h["e_phentsize"] = self._u16(42)
            h["e_phnum"] = self._u16(44)
            h["e_shentsize"] = self._u16(46)
            h["e_shnum"] = self._u16(48)
            h["e_shstrndx"] = self._u16(50)
        self.header = h

    def _parse_program_headers(self):
        h = self.header
        if h["e_phoff"] == 0 or h["e_phnum"] == 0:
            return
        phoff = h["e_phoff"]
        phentsize = h["e_phentsize"]
        for i in range(h["e_phnum"]):
            base = phoff + i * phentsize
            if self.is64:
                p_type = self._u32(base)
                p_flags = self._u32(base + 4)
                p_offset = self._u64(base + 8)
                p_vaddr = self._u64(base + 16)
                p_paddr = self._u64(base + 24)
                p_filesz = self._u64(base + 32)
                p_memsz = self._u64(base + 40)
                p_align = self._u64(base + 48)
            else:
                p_type = self._u32(base)
                p_offset = self._u32(base + 4)
                p_vaddr = self._u32(base + 8)
                p_paddr = self._u32(base + 12)
                p_filesz = self._u32(base + 16)
                p_memsz = self._u32(base + 20)
                p_flags = self._u32(base + 24)
                p_align = self._u32(base + 28)
            self.program_headers.append({
                "type": p_type,
                "type_name": PT_NAMES.get(p_type, "UNKNOWN(0x%x)" % p_type),
                "offset": p_offset,
                "vaddr": p_vaddr,
                "paddr": p_paddr,
                "filesz": p_filesz,
                "memsz": p_memsz,
                "flags": p_flags,
                "flags_str": self._phdr_flags_str(p_flags),
                "align": p_align,
            })

    @staticmethod
    def _phdr_flags_str(f):
        return ("R" if f & PF_R else "-") + ("W" if f & PF_W else "-") + ("X" if f & PF_X else "-")

    def _parse_section_headers(self):
        h = self.header
        if h["e_shoff"] == 0 or h["e_shnum"] == 0:
            return
        shoff = h["e_shoff"]
        shentsize = h["e_shentsize"]
        raw = []
        for i in range(h["e_shnum"]):
            base = shoff + i * shentsize
            sh_name = self._u32(base)
            sh_type = self._u32(base + 4)
            if self.is64:
                sh_flags = self._u64(base + 8)
                sh_addr = self._u64(base + 16)
                sh_offset = self._u64(base + 24)
                sh_size = self._u64(base + 32)
                sh_link = self._u32(base + 40)
                sh_info = self._u32(base + 44)
                sh_addralign = self._u64(base + 48)
                sh_entsize = self._u64(base + 56)
            else:
                sh_flags = self._u32(base + 8)
                sh_addr = self._u32(base + 12)
                sh_offset = self._u32(base + 16)
                sh_size = self._u32(base + 20)
                sh_link = self._u32(base + 24)
                sh_info = self._u32(base + 28)
                sh_addralign = self._u32(base + 32)
                sh_entsize = self._u32(base + 36)
            raw.append({
                "name_off": sh_name,
                "type": sh_type,
                "type_name": SHT_NAMES.get(sh_type, "UNKNOWN(0x%x)" % sh_type),
                "flags": sh_flags,
                "flags_str": self._shdr_flags_str(sh_flags),
                "addr": sh_addr,
                "offset": sh_offset,
                "size": sh_size,
                "link": sh_link,
                "info": sh_info,
                "addralign": sh_addralign,
                "entsize": sh_entsize,
            })
        self.section_headers = raw
        # 加载节名字符串表
        shstrndx = h["e_shstrndx"]
        if 0 <= shstrndx < len(raw):
            s = raw[shstrndx]
            self.shstrtab = self.data[s["offset"]:s["offset"] + s["size"]]
        # 填充名称
        for s in raw:
            s["name"] = self._get_str(self.shstrtab, s["name_off"])

    @staticmethod
    def _shdr_flags_str(f):
        r = ""
        r += "W" if f & SHF_WRITE else ""
        r += "A" if f & SHF_ALLOC else ""
        r += "X" if f & SHF_EXECINSTR else ""
        return r or "-"

    def _get_str(self, strtab, off):
        if off >= len(strtab):
            return ""
        end = strtab.find(b"\x00", off)
        if end == -1:
            end = len(strtab)
        try:
            return strtab[off:end].decode("utf-8", errors="replace")
        except Exception:
            return ""

    def _parse_dynamic_symbols(self):
        dynsym_sec = None
        dynstr_sec = None
        for s in self.section_headers:
            if s["name"] == ".dynsym" and s["type"] == 11:
                dynsym_sec = s
            elif s["name"] == ".dynstr" and s["type"] == 3:
                dynstr_sec = s
        if not dynsym_sec or not dynstr_sec:
            return
        self.dynstr = self.data[dynstr_sec["offset"]:dynstr_sec["offset"] + dynstr_sec["size"]]
        entsize = dynsym_sec["entsize"] or (24 if self.is64 else 16)
        count = dynsym_sec["size"] // entsize if entsize else 0
        for i in range(count):
            base = dynsym_sec["offset"] + i * entsize
            if self.is64:
                st_name = self._u32(base)
                st_info = self.data[base + 4]
                st_other = self.data[base + 5]
                st_shndx = self._u16(base + 6)
                st_value = self._u64(base + 8)
                st_size = self._u64(base + 16)
            else:
                st_name = self._u32(base)
                st_value = self._u32(base + 4)
                st_size = self._u32(base + 8)
                st_info = self.data[base + 12]
                st_other = self.data[base + 13]
                st_shndx = self._u16(base + 14)
            name = self._get_str(self.dynstr, st_name)
            self.dynsym.append({
                "name": name,
                "info": st_info,
                "bind": STB_NAMES.get(st_info >> 4, "UNKNOWN"),
                "type": STT_NAMES.get(st_info & 0xF, "UNKNOWN"),
                "other": st_other,
                "shndx": st_shndx,
                "value": st_value,
                "size": st_size,
            })

    # -- 高级查询 --
    def get_section_by_name(self, name):
        for s in self.section_headers:
            if s["name"] == name:
                return s
        return None

    def section_data(self, name):
        s = self.get_section_by_name(name)
        if not s or s["type"] == 8:  # SHT_NOBITS
            return b""
        return self.data[s["offset"]:s["offset"] + s["size"]]

    def imports(self):
        return [s["name"] for s in self.dynsym
                if s["shndx"] == SHN_UNDEF and s["name"]]

    def exports(self):
        return [s["name"] for s in self.dynsym
                if s["shndx"] != SHN_UNDEF and s["name"] and s["type"] == "FUNC"]


# ---------------------------------------------------------------------------
# 分析功能
# ---------------------------------------------------------------------------
def analyze_header(elf):
    h = elf.header
    return {
        "format": h["class"],
        "data": h["data"],
        "type": h["e_type_name"],
        "machine": h["e_machine_name"],
        "arch": _arch_short(h["e_machine"]),
        "entry_point": "0x%x" % h["e_entry"],
        "program_header_offset": "0x%x" % h["e_phoff"],
        "section_header_offset": "0x%x" % h["e_shoff"],
        "program_header_count": h["e_phnum"],
        "section_header_count": h["e_shnum"],
        "section_string_table_index": h["e_shstrndx"],
    }


def _arch_short(machine):
    mapping = {
        3: "x86", 62: "x86_64", 40: "arm",
        183: "arm64", 8: "mips", 20: "ppc", 243: "riscv",
    }
    return mapping.get(machine, "unknown")


def analyze_program_headers(elf):
    return [{
        "type": p["type_name"],
        "offset": "0x%x" % p["offset"],
        "virtual_address": "0x%x" % p["vaddr"],
        "physical_address": "0x%x" % p["paddr"],
        "file_size": "0x%x" % p["filesz"],
        "memory_size": "0x%x" % p["memsz"],
        "flags": p["flags_str"],
        "align": "0x%x" % p["align"],
    } for p in elf.program_headers]


def analyze_sections(elf):
    return [{
        "name": s["name"],
        "type": s["type_name"],
        "address": "0x%x" % s["addr"],
        "offset": "0x%x" % s["offset"],
        "size": "0x%x" % s["size"],
        "flags": s["flags_str"],
        "entsize": "0x%x" % s["entsize"],
    } for s in elf.section_headers]


def analyze_interp(elf):
    interp = elf.section_data(".interp")
    if not interp:
        for p in elf.program_headers:
            if p["type"] == 3:  # PT_INTERP
                interp = elf.data[p["offset"]:p["offset"] + p["filesz"]]
                break
    return interp.rstrip(b"\x00").decode("utf-8", errors="replace") if interp else ""


def analyze_notes(elf):
    notes = []
    for s in elf.section_headers:
        if s["type"] == 7:  # SHT_NOTE
            data = elf.data[s["offset"]:s["offset"] + s["size"]]
            off = 0
            while off + 12 <= len(data):
                namesz = struct.unpack_from(elf.endian + "I", data, off)[0]
                descsz = struct.unpack_from(elf.endian + "I", data, off + 4)[0]
                ntype = struct.unpack_from(elf.endian + "I", data, off + 8)[0]
                name = data[off + 12:off + 12 + namesz].rstrip(b"\x00").decode("utf-8", errors="replace")
                notes.append({"section": s["name"], "name": name, "type": ntype, "desc_size": descsz})
                off += 12 + ((namesz + 3) & ~3) + ((descsz + 3) & ~3)
    return notes


def analyze_imports(elf):
    return elf.imports()


def analyze_exports(elf):
    return elf.exports()


def analyze_security(elf):
    h = elf.header
    # NX: PT_GNU_STACK 不含 PF_X 则启用
    nx = False
    for p in elf.program_headers:
        if p["type"] == 0x6474e551:  # PT_GNU_STACK
            nx = not (p["flags"] & PF_X)
            break

    # PIE: ET_DYN
    pie = (h["e_type"] == 3)

    # RELRO
    has_relro_seg = any(p["type"] == 0x6474e552 for p in elf.program_headers)
    got_plt = elf.get_section_by_name(".got.plt")
    got = elf.get_section_by_name(".got")
    bind_now = False
    # 简化判定：.got.plt 不可写 = full，存在 RELRO 段但可写 = partial
    relro = "none"
    if has_relro_seg:
        relro = "partial"
        target = got_plt or got
        if target and not (target["flags"] & SHF_WRITE):
            relro = "full"
        # 检查 DT_BIND_NOW (动态段)
        dynamic = elf.get_section_by_name(".dynamic")
        if dynamic:
            ddata = elf.data[dynamic["offset"]:dynamic["offset"] + dynamic["size"]]
            entsize = 16 if elf.is64 else 8
            for i in range(0, len(ddata) - entsize + 1, entsize):
                if elf.is64:
                    tag, val = struct.unpack_from(elf.endian + "qQ", ddata, i)
                else:
                    tag, val = struct.unpack_from(elf.endian + "iI", ddata, i)
                if tag == 24:  # DT_BIND_NOW
                    bind_now = True
                    break
                if tag == -1:  # DT_NULL
                    break
        if bind_now:
            relro = "full"

    # Canary
    imports = elf.imports()
    canary = "__stack_chk_fail" in imports

    # FORTIFY
    fortify = any(name.endswith("_chk") and name.startswith("__") for name in imports)

    return {
        "nx": nx,
        "pie": pie,
        "relro": relro,
        "canary": canary,
        "fortify": fortify,
    }


def analyze_crypto(elf):
    detected = []
    seen = set()
    # 扫描 .rodata / .data / 整个文件
    candidates = []
    for name in (".rodata", ".data", ".data.rel.ro", ".rodata.cst4", ".rodata.cst8"):
        d = elf.section_data(name)
        if d:
            candidates.append((name, d))
    # 也可扫描全文件兜底
    candidates.append(("__whole_file__", elf.data))

    for sec_name, blob in candidates:
        for algo, sig in CRYPTO_SIGNATURES:
            if algo in seen:
                continue
            if blob.find(sig) != -1:
                detected.append(algo)
                seen.add(algo)
        if detect_rc4_init(blob):
            if "RC4" not in seen:
                detected.append("RC4")
                seen.add("RC4")
    return detected


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

_timeout_value = 300

def _timeout_handler(signum, frame):
    """超时信号处理器"""
    print(json.dumps({"status": "timeout", "error": f"操作超时({_timeout_value}秒)", "timeout": _timeout_value}, ensure_ascii=False))
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser(description="ELF/SO 二进制文件结构分析工具")
    ap.add_argument("--file", required=True, help="二进制文件路径")
    ap.add_argument("--check", default="all",
                    choices=["all", "header", "sections", "imports", "exports", "security", "crypto"],
                    help="检查项")
    ap.add_argument("-o", "--output", help="结果保存为 JSON 文件路径")
    ap.add_argument("--timeout", type=int, default=300, help="操作超时时间(秒)")
    args = ap.parse_args()

    global _timeout_value
    _timeout_value = args.timeout
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(args.timeout)

    if not os.path.isfile(args.file):
        sys.stderr.write("Error: file not found: %s\n" % args.file)
        return 2

    try:
        elf = ELFParser(args.file)
    except Exception as exc:
        sys.stderr.write("Error: %s\n" % exc)
        return 3

    check = args.check
    result = {"file": os.path.abspath(args.file)}

    if check in ("all", "header"):
        result.update(analyze_header(elf))
        result["program_headers"] = analyze_program_headers(elf)
        result["interp"] = analyze_interp(elf)
        result["notes"] = analyze_notes(elf)

    if check in ("all", "sections"):
        if "format" not in result:
            result.update(analyze_header(elf))
        result["sections"] = analyze_sections(elf)

    if check in ("all", "imports"):
        result["imports"] = analyze_imports(elf)

    if check in ("all", "exports"):
        result["exports"] = analyze_exports(elf)

    if check in ("all", "security"):
        if "format" not in result:
            result.update(analyze_header(elf))
        result["security"] = analyze_security(elf)

    if check in ("all", "crypto"):
        result["crypto_detected"] = analyze_crypto(elf)

    text = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text)
        sys.stderr.write("[+] Saved to %s\n" % args.output)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
