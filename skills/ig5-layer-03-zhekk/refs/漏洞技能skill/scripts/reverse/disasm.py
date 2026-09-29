#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
disasm.py - 二进制反汇编工具

功能：
  - 自动检测架构 (从 ELF e_machine)
  - capstone 引擎反汇编 (主)
  - radare2 回退 (r2 -q -c "pd N @ addr")
  - objdump 回退 (objdump -d --start-address --stop-address)
  - 指令分类统计
"""

import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys

# ---------------------------------------------------------------------------
# ELF 头解析 (仅读取必要字段)
# ---------------------------------------------------------------------------
ELFMAG = b"\x7fELF"
EM_386 = 3
EM_MIPS = 8
EM_ARM = 40
EM_X86_64 = 62
EM_AARCH64 = 183

PT_LOAD = 1


def read_elf_meta(path):
    """读取 ELF 元数据: is64, little, e_machine, e_entry, program headers"""
    with open(path, "rb") as f:
        data = f.read(64)
    if len(data) < 64 or data[:4] != ELFMAG:
        return None
    is64 = data[4] == 2
    little = data[5] == 1
    endian = "<" if little else ">"
    e_machine = struct.unpack_from(endian + "H", data, 18)[0]
    e_entry = struct.unpack_from(endian + ("Q" if is64 else "I"), data, 24)[0]
    if is64:
        e_phoff = struct.unpack_from(endian + "Q", data, 32)[0]
        e_phentsize = struct.unpack_from(endian + "H", data, 54)[0]
        e_phnum = struct.unpack_from(endian + "H", data, 56)[0]
    else:
        e_phoff = struct.unpack_from(endian + "I", data, 28)[0]
        e_phentsize = struct.unpack_from(endian + "H", data, 42)[0]
        e_phnum = struct.unpack_from(endian + "H", data, 44)[0]

    # 读取 program headers
    segments = []
    with open(path, "rb") as f:
        f.seek(e_phoff)
        raw = f.read(e_phentsize * e_phnum)
    for i in range(e_phnum):
        base = i * e_phentsize
        if base + e_phentsize > len(raw):
            break
        if is64:
            p_type = struct.unpack_from(endian + "I", raw, base)[0]
            p_offset = struct.unpack_from(endian + "Q", raw, base + 8)[0]
            p_vaddr = struct.unpack_from(endian + "Q", raw, base + 16)[0]
            p_filesz = struct.unpack_from(endian + "Q", raw, base + 32)[0]
        else:
            p_type = struct.unpack_from(endian + "I", raw, base)[0]
            p_offset = struct.unpack_from(endian + "I", raw, base + 4)[0]
            p_vaddr = struct.unpack_from(endian + "I", raw, base + 8)[0]
            p_filesz = struct.unpack_from(endian + "I", raw, base + 16)[0]
        segments.append({"type": p_type, "offset": p_offset, "vaddr": p_vaddr, "filesz": p_filesz})

    return {
        "is64": is64,
        "little": little,
        "endian": endian,
        "e_machine": e_machine,
        "e_entry": e_entry,
        "segments": segments,
    }


def arch_from_machine(machine, override="auto"):
    """返回 (arch_key, capstone_arch, capstone_mode) 或 None"""
    table = {
        "x86": (3, "x86", "32"),
        "x86_64": (62, "x86", "64"),
        "arm": (40, "arm", "arm"),
        "arm64": (183, "arm64", "arm"),
        "mips": (8, "mips", "mips32"),
    }
    if override != "auto" and override in table:
        return table[override]
    for key, (m, arch, mode) in table.items():
        if m == machine:
            return (key, arch, mode)
    return None


def arch_short(machine):
    return {3: "x86", 62: "x86_64", 40: "arm", 183: "arm64", 8: "mips"}.get(machine, "unknown")


def addr_to_offset(meta, addr):
    """虚拟地址 -> 文件偏移"""
    for seg in meta["segments"]:
        if seg["type"] != PT_LOAD:
            continue
        if seg["vaddr"] <= addr < seg["vaddr"] + seg["filesz"]:
            return seg["offset"] + (addr - seg["vaddr"])
    return None


# ---------------------------------------------------------------------------
# 指令分类
# ---------------------------------------------------------------------------
DATA_MOVE_MNEMONICS = {
    "mov", "movq", "movl", "movw", "movb", "movabs", "movsx", "movsxd",
    "movzx", "lea", "push", "pop", "pushf", "popf", "pushfq", "popfq",
    "xchg", "bswap", "in", "out", "movd", "movaps", "movups", "movdqa",
    "movdqu", "movss", "movsd", "ldr", "str", "stmdb", "ldmia", "movz",
    "movk", "movn", "stp", "ldp", "lui",
}
ARITH_MNEMONICS = {
    "add", "sub", "sbb", "adc", "mul", "imul", "div", "idiv", "inc", "dec",
    "neg", "and", "or", "xor", "not", "shl", "shr", "sar", "shrd", "shld",
    "rol", "ror", "rcl", "rcr", "cmp", "test", "addq", "subq", "addl",
    "subl", "addw", "subw", "addb", "subb", "andq", "orq", "xorq", "andl",
    "orl", "xorl", "add", "adds", "subs", "muls", "umlal", "smull", "umull",
    "adds", "subs", "cmp", "cmn", "tst", "and", "orr", "eor", "bic", "lsl",
    "lsr", "asr", "ror", "mul", "mla", "sdiv", "udiv",
}
CONTROL_FLOW_MNEMONICS = {
    "jmp", "je", "jne", "jz", "jnz", "jg", "jge", "jl", "jle", "ja", "jae",
    "jb", "jbe", "jo", "jno", "js", "jns", "jp", "jnp", "jc", "jnc", "jcxz",
    "jecxz", "jrcxz", "call", "ret", "retn", "retf", "iret", "iretq", "loop",
    "loope", "loopne", "bl", "bx", "blx", "b", "bne", "beq", "bgt", "blt",
    "bge", "ble", "bhi", "bls", "bcc", "bcs", "bmi", "bpl", "bvs", "bvc",
    "cbz", "cbnz", "tbz", "tbnz", "br", "blr", "ret",
}
SYSCALL_MNEMONICS = {"syscall", "sysenter", "sysexit", "int", "svc", "swi", "hlt"}


def classify(mnemonic):
    m = mnemonic.lower()
    if m in SYSCALL_MNEMONICS:
        return "syscall"
    if m in CONTROL_FLOW_MNEMONICS:
        return "control_flow"
    if m in ARITH_MNEMONICS:
        return "arith"
    if m in DATA_MOVE_MNEMONICS:
        return "data_move"
    return "other"


# ---------------------------------------------------------------------------
# 反汇编引擎
# ---------------------------------------------------------------------------
def disasm_capstone(meta, arch_info, code, entry_addr, count):
    """使用 capstone 反汇编"""
    try:
        from capstone import Cs, CS_ARCH_X86, CS_ARCH_ARM, CS_ARCH_ARM64, CS_ARCH_MIPS
        from capstone import CS_MODE_32, CS_MODE_64, CS_MODE_ARM, CS_MODE_THUMB, CS_MODE_MIPS32
    except ImportError:
        return None, "capstone not installed"

    arch_key, arch, mode = arch_info
    arch_map = {
        "x86": (CS_ARCH_X86, CS_MODE_32),
        "x86_64": (CS_ARCH_X86, CS_MODE_64),
        "arm": (CS_ARCH_ARM, CS_MODE_ARM),
        "arm64": (CS_ARCH_ARM64, CS_MODE_ARM),
        "mips": (CS_ARCH_MIPS, CS_MODE_MIPS32),
    }
    if (arch, mode) not in [(a, m) for a, m in arch_map.values()]:
        cs_arch, cs_mode = arch_map.get(arch_key, (CS_ARCH_X86, CS_MODE_64))
    else:
        cs_arch, cs_mode = arch_map[arch_key]

    md = Cs(cs_arch, cs_mode)
    md.detail = False
    instructions = []
    stats = {"data_move": 0, "arith": 0, "control_flow": 0, "syscall": 0, "other": 0}
    for ins in md.disasm(code, entry_addr):
        cat = classify(ins.mnemonic)
        stats[cat] = stats.get(cat, 0) + 1
        instructions.append({
            "address": "0x%x" % ins.address,
            "bytes": ins.bytes.hex(),
            "mnemonic": ins.mnemonic,
            "op_str": ins.op_str,
            "category": cat,
        })
        if len(instructions) >= count:
            break
    return instructions, stats


def disasm_radare2(filepath, addr, count):
    """使用 radare2 反汇编: r2 -q -c 'pd N @ addr' file"""
    if not shutil.which("r2"):
        return None, "radare2 not found"
    cmd = ["r2", "-q", "-c", "pd %d @ 0x%x" % (count, addr), filepath]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except Exception as exc:
        return None, str(exc)
    out = proc.stdout
    instructions = []
    stats = {"data_move": 0, "arith": 0, "control_flow": 0, "syscall": 0, "other": 0}
    # radare2 输出: 0xaddr  mnemonic op_str
    line_re = re.compile(r"^\s*0x([0-9a-fA-F]+)\s+(\S+)\s*(.*)$")
    for line in out.splitlines():
        m = line_re.match(line)
        if not m:
            continue
        addr_s, mnem, ops = m.group(1), m.group(2), m.group(3)
        cat = classify(mnem)
        stats[cat] = stats.get(cat, 0) + 1
        instructions.append({
            "address": "0x" + addr_s,
            "bytes": "",
            "mnemonic": mnem,
            "op_str": ops,
            "category": cat,
        })
        if len(instructions) >= count:
            break
    if not instructions:
        return None, "radare2 produced no output"
    return instructions, stats


def disasm_objdump(filepath, addr, size, count):
    """使用 objdump 反汇编"""
    if not shutil.which("objdump"):
        return None, "objdump not found"
    start = addr
    stop = addr + size
    cmd = ["objdump", "-d", "--start-address=0x%x" % start,
           "--stop-address=0x%x" % stop, filepath]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except Exception as exc:
        return None, str(exc)
    out = proc.stdout
    instructions = []
    stats = {"data_move": 0, "arith": 0, "control_flow": 0, "syscall": 0, "other": 0}
    # objdump 输出:    addr: hex bytes  mnemonic ops
    line_re = re.compile(r"^\s*([0-9a-fA-F]+):\s+([0-9a-fA-F ]+?)\s{2,}(\S+)\s*(.*)$")
    for line in out.splitlines():
        m = line_re.match(line)
        if not m:
            continue
        addr_s, byts, mnem, ops = m.group(1), m.group(2).strip(), m.group(3), m.group(4)
        cat = classify(mnem)
        stats[cat] = stats.get(cat, 0) + 1
        instructions.append({
            "address": "0x" + addr_s,
            "bytes": byts.replace(" ", ""),
            "mnemonic": mnem,
            "op_str": ops,
            "category": cat,
        })
        if len(instructions) >= count:
            break
    if not instructions:
        return None, "objdump produced no disassembly"
    return instructions, stats


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="二进制反汇编工具")
    ap.add_argument("--file", required=True, help="二进制文件路径")
    ap.add_argument("--address", help="起始反汇编地址 (默认 entry point)")
    ap.add_argument("--size", type=int, default=256, help="反汇编字节数")
    ap.add_argument("--count", type=int, default=50, help="反汇编指令数")
    ap.add_argument("--arch", default="auto",
                    choices=["auto", "x86", "x86_64", "arm", "arm64", "mips"],
                    help="架构")
    ap.add_argument("--use-radare2", action="store_true", help="是否使用 radare2")
    ap.add_argument("--output", help="结果保存为 JSON 文件路径")
    args = ap.parse_args()

    if not os.path.isfile(args.file):
        sys.stderr.write("Error: file not found: %s\n" % args.file)
        return 2

    meta = read_elf_meta(args.file)
    if meta is None:
        sys.stderr.write("Error: not an ELF file\n")
        return 3

    arch_info = arch_from_machine(meta["e_machine"], args.arch)
    if arch_info is None:
        sys.stderr.write("Error: unsupported architecture e_machine=0x%x\n" % meta["e_machine"])
        return 4
    arch_key = arch_info[0]
    entry = meta["e_entry"]

    addr = int(args.address, 0) if args.address else entry
    if args.address:
        try:
            addr = int(args.address, 0)
        except ValueError:
            addr = entry

    # 计算文件偏移
    offset = addr_to_offset(meta, addr)
    if offset is None:
        # 回退: 直接当文件偏移
        offset = addr
        sys.stderr.write("[!] Warning: address 0x%x not in any LOAD segment, using as file offset\n" % addr)

    with open(args.file, "rb") as f:
        f.seek(offset)
        code = f.read(args.size)

    instructions = None
    stats = None
    disassembler = None
    err = ""

    # 引擎选择
    if args.use_radare2:
        instructions, stats_or_err = disasm_radare2(args.file, addr, args.count)
        if instructions is not None:
            disassembler = "radare2"
            stats = stats_or_err
        else:
            err = stats_or_err

    if instructions is None and not args.use_radare2:
        instructions, stats_or_err = disasm_capstone(meta, arch_info, code, addr, args.count)
        if instructions is not None:
            disassembler = "capstone"
            stats = stats_or_err
        else:
            err = stats_or_err

    if instructions is None and args.use_radare2:
        # radare2 失败, 回退 capstone
        instructions, stats_or_err = disasm_capstone(meta, arch_info, code, addr, args.count)
        if instructions is not None:
            disassembler = "capstone"
            stats = stats_or_err
        else:
            err = stats_or_err

    if instructions is None:
        # 回退 radare2
        instructions, stats_or_err = disasm_radare2(args.file, addr, args.count)
        if instructions is not None:
            disassembler = "radare2"
            stats = stats_or_err

    if instructions is None:
        # 回退 objdump
        instructions, stats_or_err = disasm_objdump(args.file, addr, args.size, args.count)
        if instructions is not None:
            disassembler = "objdump"
            stats = stats_or_err

    if instructions is None:
        sys.stderr.write("Error: all disassemblers failed: %s\n" % err)
        return 5

    result = {
        "file": os.path.abspath(args.file),
        "arch": arch_key,
        "entry_point": "0x%x" % entry,
        "start_address": "0x%x" % addr,
        "size": args.size,
        "count": len(instructions),
        "instructions": instructions,
        "instruction_stats": stats,
        "disassembler": disassembler,
    }

    text = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text)
        sys.stderr.write("[+] Saved to %s\n" % args.output)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
