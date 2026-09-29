#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
func_graph.py - 函数调用图生成工具

功能：
  - 函数发现 (radare2 / .symtab/.dynsym FUNC 符号 / entry point)
  - 调用关系分析 (radare2 agCj / capstone 扫描 call/jmp 目标)
  - 函数复杂度 (指令数/分支数)
  - 输出 JSON / DOT (Graphviz) / SVG
"""

import argparse
import json
import os
import shutil
import struct
import subprocess
import sys

# ---------------------------------------------------------------------------
# ELF 解析 (复用轻量级实现)
# ---------------------------------------------------------------------------
ELFMAG = b"\x7fELF"
PT_LOAD = 1
SHN_UNDEF = 0
STT_FUNC = 2

EM_MAP = {3: "x86", 62: "x86_64", 40: "arm", 183: "arm64", 8: "mips"}


class ELFMgr:
    """轻量级 ELF 解析器，提取函数符号与段信息"""

    def __init__(self, path):
        self.path = path
        with open(path, "rb") as f:
            self.data = f.read()
        self.is64 = self.data[4] == 2
        self.little = self.data[5] == 1
        self.endian = "<" if self.little else ">"
        self._parse_header()
        self._parse_sections()
        self._parse_symbols()

    def _u16(self, off):
        return struct.unpack_from(self.endian + "H", self.data, off)[0]

    def _u32(self, off):
        return struct.unpack_from(self.endian + "I", self.data, off)[0]

    def _u64(self, off):
        return struct.unpack_from(self.endian + "Q", self.data, off)[0]

    def _addr(self, off):
        return self._u64(off) if self.is64 else self._u32(off)

    def _parse_header(self):
        self.e_machine = self._u16(18)
        self.e_entry = self._addr(24)
        if self.is64:
            self.e_shoff = self._u64(40)
            self.e_shentsize = self._u16(58)
            self.e_shnum = self._u16(60)
            self.e_shstrndx = self._u16(62)
        else:
            self.e_shoff = self._u32(32)
            self.e_shentsize = self._u16(46)
            self.e_shnum = self._u16(48)
            self.e_shstrndx = self._u16(50)

    def _parse_sections(self):
        self.sections = []
        if self.e_shoff == 0 or self.e_shnum == 0:
            return
        raw = []
        for i in range(self.e_shnum):
            base = self.e_shoff + i * self.e_shentsize
            sh_name = self._u32(base)
            sh_type = self._u32(base + 4)
            if self.is64:
                sh_flags = self._u64(base + 8)
                sh_addr = self._u64(base + 16)
                sh_offset = self._u64(base + 24)
                sh_size = self._u64(base + 32)
                sh_link = self._u32(base + 40)
                sh_info = self._u32(base + 44)
                sh_entsize = self._u64(base + 56)
            else:
                sh_flags = self._u32(base + 8)
                sh_addr = self._u32(base + 12)
                sh_offset = self._u32(base + 16)
                sh_size = self._u32(base + 20)
                sh_link = self._u32(base + 24)
                sh_info = self._u32(base + 28)
                sh_entsize = self._u32(base + 36)
            raw.append({
                "name_off": sh_name, "type": sh_type, "flags": sh_flags,
                "addr": sh_addr, "offset": sh_offset, "size": sh_size,
                "link": sh_link, "info": sh_info, "entsize": sh_entsize,
            })
        self.sections = raw
        # shstrtab
        if 0 <= self.e_shstrndx < len(raw):
            s = raw[self.e_shstrndx]
            self.shstrtab = self.data[s["offset"]:s["offset"] + s["size"]]
        else:
            self.shstrtab = b""
        for s in raw:
            s["name"] = self._cstr(self.shstrtab, s["name_off"])

    def _cstr(self, tab, off):
        if off >= len(tab):
            return ""
        end = tab.find(b"\x00", off)
        if end == -1:
            end = len(tab)
        return tab[off:end].decode("utf-8", errors="replace")

    def _parse_symbols(self):
        self.symbols = []
        # .symtab + .dynsym
        for sec in self.sections:
            if sec["type"] not in (2, 11):  # SHT_SYMTAB, SHT_DYNSYM
                continue
            strtab_idx = sec["link"]
            strtab = b""
            if 0 <= strtab_idx < len(self.sections):
                ss = self.sections[strtab_idx]
                strtab = self.data[ss["offset"]:ss["offset"] + ss["size"]]
            entsize = sec["entsize"] or (24 if self.is64 else 16)
            count = sec["size"] // entsize if entsize else 0
            for i in range(count):
                base = sec["offset"] + i * entsize
                if self.is64:
                    st_name = self._u32(base)
                    st_info = self.data[base + 4]
                    st_shndx = self._u16(base + 6)
                    st_value = self._u64(base + 8)
                    st_size = self._u64(base + 16)
                else:
                    st_name = self._u32(base)
                    st_value = self._u32(base + 4)
                    st_size = self._u32(base + 8)
                    st_info = self.data[base + 12]
                    st_shndx = self._u16(base + 14)
                name = self._cstr(strtab, st_name)
                self.symbols.append({
                    "name": name,
                    "type": st_info & 0xF,
                    "bind": st_info >> 4,
                    "shndx": st_shndx,
                    "value": st_value,
                    "size": st_size,
                })

    def get_section(self, name):
        for s in self.sections:
            if s["name"] == name:
                return s
        return None

    def section_data(self, name):
        s = self.get_section(name)
        if not s or s["type"] == 8:
            return b""
        return self.data[s["offset"]:s["offset"] + s["size"]]

    def func_symbols(self):
        """返回已定义的 FUNC 符号 (shndx != UNDEF)"""
        return [s for s in self.symbols
                if s["type"] == STT_FUNC and s["shndx"] != SHN_UNDEF and s["value"] != 0]

    def addr_to_offset(self, addr):
        for sec in self.sections:
            if sec["type"] == 1 and sec["addr"] <= addr < sec["addr"] + sec["size"]:
                return sec["offset"] + (addr - sec["addr"])
        return None


# ---------------------------------------------------------------------------
# radare2 接口
# ---------------------------------------------------------------------------
def r2_available():
    return shutil.which("r2") is not None


def r2_functions(path):
    """r2 -q -c 'aaa; aflj' file -> 函数列表"""
    cmd = ["r2", "-q", "-e", "bin.cache=true", "-c", "aaa; aflj", path]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except Exception:
        return None
    out = proc.stdout.strip()
    if not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


def r2_callgraph(path):
    """r2 -q -c 'aaa; agCj' file -> 调用图 JSON"""
    cmd = ["r2", "-q", "-e", "bin.cache=true", "-c", "aaa; agCj", path]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except Exception:
        return None
    out = proc.stdout.strip()
    if not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------------------
# 纯 Python 函数发现 + capstone 调用分析
# ---------------------------------------------------------------------------
CALL_MNEMONICS = {"call", "bl", "blr", "blx"}
BRANCH_MNEMONICS = {"jmp", "je", "jne", "jz", "jnz", "jg", "jl", "jge", "jle",
                    "ja", "jb", "jbe", "jae", "b", "bne", "beq", "bgt", "blt",
                    "bge", "ble", "bhi", "bls", "bx", "cbz", "cbnz", "tbz", "tbnz"}


def discover_functions_py(elf):
    """从符号表发现函数; 若无符号则用 entry point 兜底"""
    funcs = []
    seen = set()
    for sym in elf.func_symbols():
        if sym["value"] in seen:
            continue
        seen.add(sym["value"])
        funcs.append({
            "name": sym["name"] or ("sub_0x%x" % sym["value"]),
            "address": sym["value"],
            "size": sym["size"],
        })
    # 加入 entry point
    if elf.e_entry and elf.e_entry not in seen:
        funcs.append({
            "name": "entry",
            "address": elf.e_entry,
            "size": 0,
        })
    return funcs


def arch_caps(elf):
    """返回 (capstone_arch, capstone_mode)"""
    try:
        from capstone import (Cs, CS_ARCH_X86, CS_ARCH_ARM, CS_ARCH_ARM64, CS_ARCH_MIPS,
                              CS_MODE_32, CS_MODE_64, CS_MODE_ARM, CS_MODE_MIPS32)
    except ImportError:
        return None
    arch = EM_MAP.get(elf.e_machine, "x86_64")
    table = {
        "x86": (CS_ARCH_X86, CS_MODE_32),
        "x86_64": (CS_ARCH_X86, CS_MODE_64),
        "arm": (CS_ARCH_ARM, CS_MODE_ARM),
        "arm64": (CS_ARCH_ARM64, CS_MODE_ARM),
        "mips": (CS_ARCH_MIPS, CS_MODE_MIPS32),
    }
    return table.get(arch, (CS_ARCH_X86, CS_MODE_64))


def analyze_calls_py(elf, funcs, max_depth=3):
    """用 capstone 在 .text 中扫描 call 指令, 匹配已知函数地址"""
    try:
        from capstone import Cs
    except ImportError:
        return funcs, []

    caps = arch_caps(elf)
    if caps is None:
        return funcs, []
    cs_arch, cs_mode = caps
    md = Cs(cs_arch, cs_mode)
    md.detail = True

    # 构建地址 -> 函数名 索引
    addr2name = {}
    for f in funcs:
        addr2name.setdefault(f["address"], f["name"])

    text = elf.get_section(".text")
    if not text:
        # 尝试 .plt 或所有 PROGBITS 可执行段
        for sec in elf.sections:
            if sec["type"] == 1 and (sec["flags"] & 0x4):  # SHF_EXECINSTR
                text = sec
                break
    if not text:
        return funcs, []

    text_addr = text["addr"]
    text_data = elf.data[text["offset"]:text["offset"] + text["size"]]

    # 反汇编 .text, 按 call 目标聚合
    calls_map = {}  # caller_addr -> set(callee_addr)
    func_ranges = []  # (start, end, func)
    for f in funcs:
        start = f["address"]
        size = f["size"] if f["size"] else 0
        func_ranges.append((start, start + size, f))

    # 指令级扫描
    ins_count = {}  # addr -> instruction count
    branch_count = {}  # addr -> branch count
    caller_for_addr = {}  # 记录每条指令所属函数

    # 先建立地址->函数映射 (用于判定调用者)
    def find_func(addr):
        for start, end, f in func_ranges:
            if size_known := f["size"]:
                if start <= addr < end:
                    return f
            else:
                # size 未知, 用近似: 距离最近的函数入口
                pass
        # 找最近的入口
        best = None
        best_dist = None
        for start, end, f in func_ranges:
            if start <= addr:
                d = addr - start
                if best_dist is None or d < best_dist:
                    best_dist = d
                    best = f
        return best

    for ins in md.disasm(text_data, text_addr):
        owner = find_func(ins.address)
        if owner is None:
            continue
        oa = owner["address"]
        ins_count[oa] = ins_count.get(oa, 0) + 1
        mnem = ins.mnemonic.lower()
        if mnem in BRANCH_MNEMONICS or mnem in CALL_MNEMONICS:
            branch_count[oa] = branch_count.get(oa, 0) + 1
        if mnem in CALL_MNEMONICS:
            # 提取直接调用目标
            target = _extract_call_target(ins)
            if target is not None and target in addr2name:
                calls_map.setdefault(oa, set()).add(target)

    edges = []
    for caller_addr, targets in calls_map.items():
        caller_name = addr2name.get(caller_addr, "sub_0x%x" % caller_addr)
        for t in targets:
            edges.append({"from": caller_name, "to": addr2name[t]})

    # 填充 calls 和 complexity
    for f in funcs:
        oa = f["address"]
        targets = calls_map.get(oa, set())
        f["calls"] = [addr2name.get(t, "sub_0x%x" % t) for t in sorted(targets)]
        f["complexity"] = ins_count.get(oa, 0)
        f["branches"] = branch_count.get(oa, 0)

    return funcs, edges


def _extract_call_target(ins):
    """从 capstone 指令中提取直接调用/跳转目标地址"""
    try:
        for op in ins.operands:
            if op.type == 2:  # capstone x86 op.IMM / arm op.IMM
                return op.imm
            # capstone ARM64 op.IMM
            if hasattr(op, "imm") and op.imm:
                return op.imm
    except Exception:
        pass
    # 回退: 从 op_str 解析十六进制
    try:
        from capstone import x86 as cs_x86
        if ins.operands and ins.operands[0].type == cs_x86.X86_OP_IMM:
            return ins.operands[0].imm
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# DOT 生成
# ---------------------------------------------------------------------------
def to_dot(funcs, edges):
    lines = ["digraph G {", '  rankdir=LR;', '  node [shape=box, fontname="Courier"];']
    for f in funcs:
        label = "%s\\n0x%x\\nsize=%d" % (f["name"], f["address"], f.get("size", 0))
        lines.append('  "%s" [label="%s"];' % (f["name"], label))
    seen = set()
    for e in edges:
        key = (e["from"], e["to"])
        if key in seen:
            continue
        seen.add(key)
        lines.append('  "%s" -> "%s";' % (e["from"], e["to"]))
    lines.append("}")
    return "\n".join(lines)


def dot_to_svg(dot_text, output_path):
    """调用 graphviz dot 渲染 SVG"""
    if not shutil.which("dot"):
        sys.stderr.write("[!] graphviz 'dot' not found, cannot render SVG\n")
        return False
    try:
        proc = subprocess.run(["dot", "-Tsvg"], input=dot_text,
                              capture_output=True, text=True, timeout=60)
        if proc.returncode == 0 and proc.stdout:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(proc.stdout)
            return True
    except Exception as exc:
        sys.stderr.write("[!] dot rendering failed: %s\n" % exc)
    return False


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="函数调用图生成工具")
    ap.add_argument("--file", required=True, help="二进制文件路径")
    ap.add_argument("--format", default="json", choices=["json", "dot", "svg"],
                    help="输出格式")
    ap.add_argument("-o", "--output", help="结果保存路径")
    ap.add_argument("--max-depth", type=int, default=3, help="递归深度")
    ap.add_argument("--use-radare2", action="store_true", help="是否使用 radare2")
    args = ap.parse_args()

    if not os.path.isfile(args.file):
        sys.stderr.write("Error: file not found: %s\n" % args.file)
        return 2

    try:
        elf = ELFMgr(args.file)
    except Exception as exc:
        sys.stderr.write("Error: %s\n" % exc)
        return 3

    funcs = []
    edges = []
    used_r2 = False

    if args.use_radare2 and r2_available():
        r2funcs = r2_functions(args.file)
        if r2funcs:
            for f in r2funcs:
                funcs.append({
                    "name": f.get("name", ""),
                    "address": int(f.get("offset", 0)),
                    "size": int(f.get("size", 0)),
                    "calls": [],
                    "complexity": int(f.get("nbbs", 0)),
                })
            cg = r2_callgraph(args.file)
            if isinstance(cg, list):
                for node in cg:
                    src = node.get("name", "")
                    for kid in node.get("kids", []):
                        edges.append({"from": src, "to": str(kid)})
            used_r2 = True

    if not funcs:
        funcs = discover_functions_py(elf)
        funcs, edges = analyze_calls_py(elf, funcs, args.max_depth)

    # 去重边
    seen = set()
    dedup_edges = []
    for e in edges:
        key = (e["from"], e["to"])
        if key in seen:
            continue
        seen.add(key)
        dedup_edges.append(e)
    edges = dedup_edges

    dot_text = to_dot(funcs, edges)

    if args.format == "dot":
        out = dot_text
    elif args.format == "svg":
        if not args.output:
            sys.stderr.write("Error: --output required for svg format\n")
            return 4
        if not dot_to_svg(dot_text, args.output):
            sys.stderr.write("Error: SVG rendering failed, falling back to dot output\n")
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(dot_text)
        sys.stderr.write("[+] Saved SVG to %s\n" % args.output)
        return 0
    else:
        result = {
            "file": os.path.abspath(args.file),
            "functions": [{
                "name": f["name"],
                "address": "0x%x" % f["address"],
                "size": f.get("size", 0),
                "calls": f.get("calls", []),
                "complexity": f.get("complexity", 0),
            } for f in funcs],
            "edges": edges,
            "total_functions": len(funcs),
            "total_edges": len(edges),
            "dot": dot_text,
            "analyzer": "radare2" if used_r2 else "python+capstone",
        }
        out = json.dumps(result, indent=2, ensure_ascii=False)

    if args.output and args.format != "svg":
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(out)
        sys.stderr.write("[+] Saved to %s\n" % args.output)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
