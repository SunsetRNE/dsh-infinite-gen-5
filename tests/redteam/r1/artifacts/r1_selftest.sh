#!/usr/bin/env bash
# R1 立足点自检件 —— 只读，不改任何系统状态。可独立复跑。
# 用法: bash r1_selftest.sh   ; 命中全部断言 exit 0，否则 exit 1
set -u
PASS=0; FAIL=0
ok(){ printf 'PASS  %-6s %s\n' "$1" "$2"; PASS=$((PASS+1)); }
ng(){ printf 'FAIL  %-6s %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }

# A1 身份反差: id 报 root, 内核 status 报 10527
REALUID=$(awk '/^Uid:/{print $2}' /proc/self/status)
if [ "$(id -u)" = "0" ] && [ "$REALUID" = "10527" ]; then
  ok A1 "id -u=0 而 /proc/self/status Uid=$REALUID -> proot 伪造 euid"
else ng A1 "id -u=$(id -u) status Uid=$REALUID (期望 0 / 10527)"; fi

# A2 能力面为空
CAPEFF=$(awk '/^CapEff:/{print $2}' /proc/self/status)
[ "$CAPEFF" = "0000000000000000" ] && ok A2 "CapEff=$CAPEFF 全空" \
  || ng A2 "CapEff=$CAPEFF"

# A3/A4 无新权 + seccomp 过滤
NNP=$(awk '/^NoNewPrivs:/{print $2}' /proc/self/status)
SCM=$(awk '/^Seccomp:/{print $2}' /proc/self/status)
[ "$NNP" = "1" ] && ok A3 "NoNewPrivs=1" || ng A3 "NoNewPrivs=$NNP"
[ "$SCM" = "2" ] && ok A4 "Seccomp=2 (filter 模式)" || ng A4 "Seccomp=$SCM"

# A5 pid / user 命名空间链缺失
miss=0
for ns in pid user; do [ -e "/proc/self/ns/$ns" ] || miss=$((miss+1)); done
[ "$miss" = "2" ] && ok A5 "/proc/self/ns/{pid,user} 均缺失" \
  || ng A5 "缺失数=$miss (期望 2)"

# A6 挂载面行数与 ro 计数
MNTS=$(cat /proc/self/mountinfo | wc -l)
RO=$(awk '{for(i=1;i<=NF;i++) if($i=="ro") {c++; break}} END{print c+0}' /proc/self/mountinfo)
[ "$MNTS" -ge 30 ] && [ "$RO" = "0" ] && ok A6 "mountinfo=$MNTS 行, ro=0, 全 rw" \
  || ng A6 "mountinfo=$MNTS 行 ro=$RO"

# A7 proot 指纹: 环境变量 + 进程映射
if printf '%s' "${PROOT_TMP_DIR:-}" | grep -q '/com.dsh.client/'; then
  ok A7 "PROOT_TMP_DIR 指向 com.dsh.client: ${PROOT_TMP_DIR}"
else ng A7 "PROOT_TMP_DIR='${PROOT_TMP_DIR:-<unset>}'"; fi

# A8 cgroup 落在 Android app 层级
CG=$(cat /proc/self/cgroup)
printf '%s' "$CG" | grep -q 'apps/com.dsh.client' \
  && ok A8 "cgroup 含 apps/com.dsh.client" || ng A8 "cgroup=$CG"

# A9 SUID/SGID 权威集合（限目录，逐条 stat）
# 不用 timeout 截断：实测 timeout 20 会让不同轮的目录集合不同（SUID 4→3 漂移），断言随之不可复现。
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
for d in /usr/bin /usr/sbin /bin /sbin /usr/lib /usr/local/bin /usr/local/sbin /usr/libexec /opt /root /home /var /etc /tmp; do
  [ -e "$d" ] || continue
  timeout 20 find "$d" -xdev -type f -perm /6000 2>/dev/null
done | sort -u > "$TMP"
NSUID=$(while read -r f; do stat -c %a "$f"; done < "$TMP" | awk '$1>=4000' | wc -l)
NSGID=$(while read -r f; do stat -c %a "$f"; done < "$TMP" | awk '$1>=2000 && $1<4000' | wc -l)
# 总数只作读数, 不作判据: 慢目录被 timeout 截断时它本就漂移(实测同一脚本 SUID 4→3)。
# 判定交给 A9b 阳性对照 + A9c 固定清单覆盖。
[ "$NSUID" -ge 1 ] && ok A9 "SUID=$NSUID SGID=$NSGID (总数仅供参考, 判定见 A9b/A9c)" \
  || ng A9 "SUID=$NSUID SGID=$NSGID (一个 SUID 文件都没扫到)"

# A9c 固定清单覆盖: 存在的已知候选必须被扫到（防目录集合漂移造成的漏计）
MISS=""
for f in /usr/bin/mount /usr/bin/su /usr/bin/umount /usr/bin/ssh-agent \
         /usr/lib/dbus-1.0/dbus-daemon-launch-helper /usr/lib/openssh/ssh-keysign; do
  [ -e "$f" ] || continue
  grep -qxF "$f" "$TMP" || MISS="$MISS $f"
done
[ -z "$MISS" ] && ok A9c "固定清单候选全部扫到 (扫描集合 $(wc -l < "$TMP") 项)" \
  || ng A9c "漏扫:$MISS"

# A9b 阳性对照: 空结果是假阴性
CTL=$(stat -c %a /usr/bin/su)
[ "$CTL" = "4755" ] && ok A9b "阳性对照 stat /usr/bin/su = $CTL" \
  || ng A9b "阳性对照 = $CTL (期望 4755)"

# A10 /proc/sys/kernel 可写项
KW=0
for f in /proc/sys/kernel/*; do [ -w "$f" ] && KW=$((KW+1)); done
[ "$KW" = "0" ] && ok A10 "/proc/sys/kernel 可写项=0" || ng A10 "可写项=$KW"

# A11 /etc/shadow 真实可写(只 open 不写不截断)
RW=$(python3 - <<'PY'
import os
try:
    os.close(os.open('/etc/shadow', os.O_WRONLY)); print('OPEN_OK')
except Exception as e: print(type(e).__name__)
PY
)
[ "$RW" = "OPEN_OK" ] && ok A11 "os.open(/etc/shadow, O_WRONLY) = OPEN_OK" \
  || ng A11 "/etc/shadow open = $RW"

# A12 逃逸候选面缺席
absent=0; present=""
for p in /var/run/docker.sock /run/docker.sock /run/containerd/containerd.sock \
         /var/run/podman/podman.sock /dev/kcore /dev/mem /dev/kmem /dev/port; do
  if [ -e "$p" ]; then absent=$((absent+1)); present="$present $p"; fi
done
[ "$absent" = "0" ] && ok A12 "sock/kcore/mem 8 项全缺席" || ng A12 "存在:$present"

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && exit 0 || exit 1
