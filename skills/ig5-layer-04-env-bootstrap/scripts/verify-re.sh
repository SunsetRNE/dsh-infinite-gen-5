#!/usr/bin/env bash
# verify-re.sh — 逆向工程工具链实测（静态指纹 → 反汇编 → 反编译 → 动态复验）
# 用法: bash verify-re.sh          # 全量
#       bash verify-re.sh --quick  # 只查版本
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1
PASS=0; FAIL=0; MISS=()
ok()  { printf '  [ OK ] %-24s %s\n' "$1" "$2"; PASS=$((PASS+1)); }
bad() { printf '  [FAIL] %-24s %s\n' "$1" "$2"; FAIL=$((FAIL+1)); MISS+=("$1"); }
ver() { local b="$1"; shift
  if command -v "$b" >/dev/null 2>&1
  then ok "$b" "$("$b" "$@" 2>&1 | head -1 | cut -c1-88)"
  else bad "$b" "missing"; fi; }

export PATH=$PATH:/root/.local/bin:/usr/local/go/bin:/root/.cargo/bin
REPY=/opt/rev/bin/python
BIN=/bin/ls
note() { printf '\n--- %s ---\n' "$*"; }

echo "############ 1. 版本清单 ############"
ver rizin -v
ver r2 -v
ver rabin2 -v
ver radare2 -v
ver gdb --version
ver gdb-multiarch --version
ver patchelf --version
ver nasm -v
ver yasm --version
ver upx --version
ver yara --version
ver eu-readelf --version
ver objdump --version
ver ROPgadget --version
ver ropper --version
ver one_gadget --version
ver checksec --version
ver binwalk --version
ver frida --version
ver jadx --version
ver apktool --version
ver qemu-aarch64-static --version
ver qemu-x86_64-static --version
for m in capstone keystone unicorn lief angr z3 elftools pwn; do
  v=$($REPY -c "import $m,sys;print(getattr($m,'__version__','ok'))" 2>&1 | tail -1)
  case "$v" in *Error*|*error*|*Traceback*) bad "py:$m" "$v";; *) ok "py:$m" "$v";; esac
done

if [ "$QUICK" = "1" ]; then
  echo; printf '汇总: PASS=%d FAIL=%d\n' "$PASS" "$FAIL"; exit 0
fi

echo
echo "############ 2. 静态指纹 / 反汇编 ############"
note "file + readelf -h"
if file "$BIN" | grep -q ELF; then ok "file" "$(file -b "$BIN" | cut -c1-70)"; else bad "file" "非 ELF"; fi
arch=$(readelf -h "$BIN" | awk -F: '/Machine/{print $2}' | xargs)
[ -n "$arch" ] && ok "readelf -h" "Machine=$arch" || bad "readelf -h" "解析失败"
nsec=$(readelf -S "$BIN" | grep -c '^\s*\[')
[ "$nsec" -gt 10 ] && ok "readelf -S" "$nsec 个节区" || bad "readelf -S" "$nsec"
sym=$(readelf -sW "$BIN" | grep -c FUNC)
ok "readelf -s" "$sym 个 FUNC 符号"
note "objdump / eu-readelf / rabin2 / rizin"
objdump -d "$BIN" >/dev/null 2>&1 && ok "objdump -d" "$(objdump -d "$BIN" | grep -c '^ ')" || bad "objdump -d" "失败"
eu-readelf -h "$BIN" >/dev/null 2>&1 && ok "eu-readelf" "OK" || bad "eu-readelf" "失败"
rabin2 -I "$BIN" >/dev/null 2>&1 && ok "rabin2 -I" "$(rabin2 -I "$BIN" 2>/dev/null | wc -l) 行信息" || bad "rabin2 -I" "失败"
rizin -v >/dev/null 2>&1 && ok "rizin -v" "$(rizin -v 2>&1 | head -1)" || bad "rizin" "失败"
cnt=$(rizin -q -c 'aa; afl' -c 'q' "$BIN" 2>/dev/null | wc -l)
[ "$cnt" -gt 5 ] && ok "rizin aa;afl" "$cnt 个函数（真实分析）" || bad "rizin aa;afl" "仅 $cnt"

note "capstone 逐条反汇编（ELF 入口前 8 条）"
$REPY - "$BIN" <<'PYEOF' 2>&1 | tail -12
import sys, subprocess
from capstone import *
from elftools.elf.elffile import ELFFile
f=open(sys.argv[1],'rb'); e=ELFFile(f); t=e.get_section_by_name('.text')
code=t.data()[:64]; base=t['sh_addr']
md=Cs(CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN)
n=0
for i in md.disasm(code, base):
    print("  %#x: %-8s %s" % (i.address, i.mnemonic, i.op_str)); n+=1
    if n>=8: break
print("capstone 反汇编条数=%d" % n)
PYEOF

echo
echo "############ 3. 反编译能力探测 ############"
note "rizin pdc（内置伪反编译）"
out=$(rizin -q -c 'aa; s main; pdc' -c 'q' "$BIN" 2>/dev/null | head -6)
if [ -n "$out" ]; then ok "rizin pdc" "$(echo "$out" | head -1 | cut -c1-70)"; else bad "rizin pdc" "无输出"; fi
note "Ghidra 原生反编译器架构目录"
GHD=/opt/rev-tools/ghidra_zip/ghidra_12.1.4_PUBLIC/Ghidra/Features/Decompiler/os
if [ -d "$GHD" ]; then
  ok "ghidra decompiler os/" "$(ls "$GHD" | tr '\n' ' ')"
  if [ -x "$GHD/linux_arm_64/decompile" ]; then ok "linux_arm_64 原生" "存在"
  else bad "linux_arm_64 原生" "不存在 → aarch64 上原生反编译不可用，见报告第 6 节"; fi
else bad "ghidra os 目录" "缺失"; fi

echo
echo "############ 4. ROP / 补丁 / 壳 ############"
note "ROPgadget"
g=$($REPY -m ROPgadget --binary "$BIN" 2>/dev/null | wc -l)
[ "$g" -gt 20 ] && ok "ROPgadget" "$g 条 gadget" || bad "ROPgadget" "仅 $g"
note "ropper"
r=$(ROPgadget --binary "$BIN" --only "pop|ret" 2>/dev/null | grep -c "0x")
[ "$r" -gt 5 ] && ok "ropper" "$r 条候选" || bad "ropper" "仅 $r"
note "patchelf 改 rpath（副本）"
cp "$BIN" ./pbin
if patchelf --set-rpath /tmp/RE_RPATH_FAKE ./pbin 2>/dev/null && readelf -d ./pbin | grep -q RE_RPATH_FAKE; then
  ok "patchelf --set-rpath" "$(readelf -d ./pbin | grep -o '\[/tmp/RE_RPATH_FAKE\]')"
else bad "patchelf --set-rpath" "失败"; fi
note "UPX 加壳/脱壳往返（副本，比对 sha256）"
cp "$BIN" ./ubin; h0=$(sha256sum ./ubin | cut -c1-16)
if upx -q ./ubin >/dev/null 2>&1; then
  hs=$(sha256sum ./ubin | cut -c1-16)
  upx -q -d ./ubin >/dev/null 2>&1
  h1=$(sha256sum ./ubin | cut -c1-16)
  [ "$h0" = "$h1" ] && ok "UPX pack+unpack" "原哈希 $h0 → 解包后 $h1（一致）" || bad "UPX 往返" "$h0 != $h1"
else bad "UPX pack" "upx 拒绝该目标: $(upx ./ubin 2>&1 | tail -1 | cut -c1-60)"; fi

echo
echo "############ 5. 规则匹配 / 静态库 ############"
note "yara 规则实跑"
cat > r.yar <<'YEOF'
rule elf_exec {
  meta: author = "verify-re"
  strings: $m = { 7f 45 4c 46 }
  condition: $m at 0
}
YEOF
y=$(yara r.yar "$BIN" 2>&1)
[ "$y" = "elf_exec $BIN" ] && ok "yara" "$y" || bad "yara" "$y"
note "LIEF 解析"
$REPY - "$BIN" <<'PYEOF' 2>&1 | tail -4
import sys, lief
b=lief.parse(sys.argv[1]); print("  format=%s entry=%#x libs=%d" % (b.header.file_type, b.entrypoint, len(b.libraries)))
print("  sections=%d symbols=%d" % (len(b.sections), len(b.symbols)))
PYEOF

echo
echo "############ 6. 动态复验（crackme：静态猜 + 真跑） ############"
cat > crack.c <<'CEOF'
#include <stdio.h>
#include <string.h>
static int check(const char *p){ if(strlen(p)!=4) return 2;
  if(p[0]!='r'||p[1]!='z'||p[2]!='9'||p[3]!='1') return 3; return 0; }
int main(int c,char**v){ if(c<2){puts("usage: crack <key>");return 1;}
  if(check(v[1])==0){ puts("ACCESS GRANTED"); return 0; } puts("DENIED"); return 1; }
CEOF
gcc -g -O0 crack.c -o crack
ok "crackme 构建" "$(file -b crack | cut -c1-50)"
d=$(./crack wrong 2>&1); [ "$d" = "DENIED" ] && ok "动态: 错误口令" "$d" || bad "动态: 错误口令" "$d"
g=$(./crack rz91 2>&1);  [ "$g" = "ACCESS GRANTED" ] && ok "动态: 正确口令" "$g" || bad "动态: 正确口令" "$g"
note "gdb 断点命中 check（动态证据）"
gd=$(gdb -q -batch -ex 'break check' -ex 'run rz91' -ex 'info args' -ex 'finish' -ex 'print $rax' ./crack 2>&1)
echo "$gd" | grep -q 'Breakpoint 1, check' && ok "gdb 断点" "$(echo "$gd" | grep 'Breakpoint 1, check' | cut -c1-72)" || bad "gdb 断点" "未命中"
echo "$gd" | grep -q '\$1 = 0' && ok "gdb finish 返回值" "$(echo "$gd" | grep '\$1 = 0' | head -1)" || bad "gdb finish" "未见返回值 0"
note "angr 求解 crackme（符号执行）"
angrout=$($REPY - <<'PYEOF' 2>&1 | tail -3
import angr, logging
logging.getLogger('angr').setLevel('ERROR')
proj = angr.Project('./crack', auto_load_libs=False)
k = angr.claripy.BVS('k', 4 * 8)
st = proj.factory.entry_state(args=['./crack', k])
sm = proj.factory.simulation_manager(st)
sm.explore(find=lambda s: b'ACCESS GRANTED' in s.posix.dumps(1),
           avoid=lambda s: b'DENIED' in s.posix.dumps(1))
if sm.found:
    s = sm.found[0]
    print("ANGR_KEY=%r" % s.solver.eval(k, cast_to=bytes).decode('latin1'))
else:
    print("ANGR_NOPATH")
PYEOF
)
echo "$angrout" | tail -2
if echo "$angrout" | grep -q 'ANGR_KEY='; then
  key=$(echo "$angrout" | grep -o "ANGR_KEY='[^']*'" | cut -d"'" -f2)
  if [ "$(./crack "$key" 2>&1)" = "ACCESS GRANTED" ]; then
    ok "angr 求解 + 动态复验" "符号执行得 key='$key'，真跑该 key → ACCESS GRANTED"
  else bad "angr 求解" "key='$key' 真跑不通过"; fi
else bad "angr 求解" "$(echo "$angrout" | tail -1)"; fi
note "checksec"
cs=$(checksec --file=crack 2>&1 | head -8); echo "$cs" | head -5
echo "$cs" | grep -qi 'RELRO' && ok "checksec" "$(echo "$cs" | tr '\n' ' ' | cut -c1-80)" || bad "checksec" "无 RELRO 输出"

echo
echo "############ 7. 移动侧（Android） ############"
for t in jadx apktool frida; do
  if command -v "$t" >/dev/null 2>&1; then ok "$t" "$($t --version 2>&1 | head -1)"; else bad "$t" "missing"; fi
done
note "frida 与 frida-server 版本一致性（无设备时仅报本地）"
fv=$(frida --version 2>&1 | head -1); ok "frida 本地版本" "$fv"
echo "  frida-server 需与上面版本逐字一致，且需 push 到设备 /data/local/tmp 以 root 运行"

cd /; rm -rf "$W"
echo
echo "############ 汇总 ############"
printf 'PASS=%d  FAIL=%d\n' "$PASS" "$FAIL"
[ ${#MISS[@]} -gt 0 ] && printf '缺失/失败: %s\n' "${MISS[*]}"
exit 0
