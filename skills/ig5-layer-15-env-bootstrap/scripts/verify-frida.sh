#!/usr/bin/env bash
# verify-frida.sh — 设备端动态调试链路体检：产物指纹 + 设备桥状态 + 本机插桩能力矩阵
# 不重试同一条失败命令；桥不可用时只报原话与去哪个开关
export LANG=C.UTF-8 LC_ALL=C.UTF-8
export PATH=$PATH:/root/.local/bin
PASS=0; FAIL=0; WARN=0
ok(){ printf '  [ OK ] %-22s %s\n' "$1" "$2"; PASS=$((PASS+1)); }
no(){ printf '  [FAIL] %-22s %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }
wn(){ printf '  [WARN] %-22s %s\n' "$1" "$2"; WARN=$((WARN+1)); }

FS_DIR=/opt/rev-tools/frida
PY=/root/.local/share/pipx/venvs/frida-tools/bin/python

echo "############ 1. 版本对齐（frida 与 frida-server 必须逐字相同） ############"
L=$($PY -c "import frida;print(frida.__version__)" 2>/dev/null)
S=$(ls "$FS_DIR"/frida-server-*-android-arm64 2>/dev/null | head -1)
echo "  本地 frida-python : ${L:-未装}"
if [ -n "$S" ]; then
  SV=$(basename "$S" | sed 's/^frida-server-//; s/-android-arm64$//')
  echo "  frida-server 版本 : $SV"
  [ "$L" = "$SV" ] && ok "版本一致" "$L == $SV" || no "版本不一致" "$L != $SV（必须逐字一致）"
  ok "server 指纹" "$(file -b "$S")"
  ok "server sha256" "$(sha256sum "$S" | cut -d' ' -f1)"
  [ -s "$S" ] && ok "server 大小" "$(stat -c%s "$S") 字节"
else no "frida-server" "未下载（见 fetch/deploy 脚本）"; fi
G=$(ls "$FS_DIR"/frida-gadget-*.so 2>/dev/null | head -1)
[ -n "$G" ] && ok "gadget" "$(file -b "$G" | cut -c1-60)" || wn "gadget" "未下载"

echo
echo "############ 2. 设备桥状态（单次探测，不重试） ############"
T=$(cat /root/.dsh/.bridge_token 2>/dev/null)
echo "  bridge token 长度 : ${#T}"
for p in version device; do
  R=$(curl -s --max-time 6 -o /dev/null -w '%{http_code}' "http://127.0.0.1:3090/app/$p?token=$T" 2>&1)
  if [ "$R" = "200" ]; then ok "桥 /app/$p" "HTTP 200"; else no "桥 /app/$p" "HTTP $R（000=连不上）"; fi
done
OUT=$(timeout 25 adb-shell id 2>&1 | head -3)
if echo "$OUT" | grep -qE 'EXECUTION_UNKNOWN|URLError|EXIT=125|POLICY_BLOCKED|DISABLED|NO_PERMISSION'; then
  no "adb-shell" "$(echo "$OUT" | head -1)"
  echo "        原话: $OUT"
  echo "        去处: App 内「设置 → 设备能力授权」检查桥接与授权开关后重跑"
else ok "adb-shell" "$OUT"; fi

echo
echo "############ 3. 本机插桩能力矩阵（决定能不能在主机上跑 Frida） ############"
cat > /tmp/cap.c <<'EOF'
#include <stdio.h>
#include <sys/ptrace.h>
#include <sys/wait.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
int main(void){
  pid_t p=fork();
  if(p==0){ ptrace(PTRACE_TRACEME,0,0,0); raise(SIGSTOP); _exit(0);} 
  int s; waitpid(p,&s,WUNTRACED);
  errno=0; long a=ptrace(PTRACE_SEIZE,p,0,0);   printf("PTRACE_SEIZE  rc=%ld errno=%d (%s)\n",a,errno,strerror(errno));
  errno=0; long b=ptrace(PTRACE_ATTACH,p,0,0);  printf("PTRACE_ATTACH rc=%ld errno=%d (%s)\n",b,errno,strerror(errno));
  errno=0; long c=ptrace(PTRACE_CONT,p,0,0);    printf("PTRACE_CONT   rc=%ld errno=%d (%s)\n",c,errno,strerror(errno));
  return 0; }
EOF
gcc -O0 /tmp/cap.c -o /tmp/cap 2>/dev/null && /tmp/cap | sed 's/^/  /'
echo "  --- frida 注入实测 ---"
J=$($PY - <<'PYEOF' 2>&1 | tail -1
import frida,sys
try:
    pid=frida.spawn(["/bin/true"])
    frida.attach(pid); print("FRIDA_ATTACH=OK")
except Exception as e: print("FRIDA_ATTACH=%s: %s" % (type(e).__name__, e))
PYEOF
)
echo "  $J"
case "$J" in *OK*) ok "本机 frida 注入" "可用";; *) no "本机 frida 注入" "${J#FRIDA_ATTACH=}";; esac
if [ -x /tmp/gadget/frida-gadget-17.19.0-linux-arm64.so ] || [ -x /tmp/gadget/*.so ]; then
  GSO=$(ls /tmp/gadget/*.so 2>/dev/null | head -1)
  LD_PRELOAD="$GSO" /tmp/gadget/c rz91 >/dev/null 2>&1
  RC=$?
  [ $RC -eq 0 ] && ok "LD_PRELOAD gadget" "rc=0" || no "LD_PRELOAD gadget" "rc=$RC（139=SIGSEGV）"
fi

echo
echo "############ 4. 可用的本机动态手段（替代路径） ############"
command -v gdb >/dev/null && ok "gdb（TRACEME 路线）" "$(gdb --version | head -1)"
command -v strace >/dev/null && ok "strace" "$(strace -V 2>&1 | head -1)"
command -v ltrace >/dev/null && ok "ltrace" "$(ltrace -V 2>&1 | head -1)"
$PY -c "import frida;print(frida.__version__)" >/dev/null 2>&1 && ok "frida CLI/py" "$(frida --version 2>&1 | head -1)"

echo
printf '汇总: PASS=%d FAIL=%d WARN=%d\n' "$PASS" "$FAIL" "$WARN"
exit 0
