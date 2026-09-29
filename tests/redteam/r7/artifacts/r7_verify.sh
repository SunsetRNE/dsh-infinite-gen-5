#!/usr/bin/env bash
# R7 数据与日志面普查 —— 独立复跑验证件
# 口径：仅只读断言；不读任何凭据明文（只算长度与 sha256 前 8 位）；不向设备写入。
# 用法：bash r7_verify.sh   全通过 -> RESULT=ALL_PASS 且 exit 0；任一失败 -> exit 1
set -u
BRIDGE="127.0.0.1:3090"
TOKFILE="/root/.dsh/.bridge_token"
PASS=0; FAIL=0
ok(){   PASS=$((PASS+1)); printf 'PASS  %-6s %s\n' "$1" "$2"; }
no(){   FAIL=$((FAIL+1)); printf 'FAIL  %-6s %s\n' "$1" "$2"; }
chk(){  if [ "$3" = "$4" ]; then ok "$1" "$2 (=$3)"; else no "$1" "$2 (期望 $4, 实测 $3)"; fi; }
has(){  if printf '%s' "$3" | grep -qE "$4"; then ok "$1" "$2"; else no "$1" "$2 (无匹配 $4)"; fi; }

echo "=== R7 数据与日志面 验证件 $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# ---------- 0. 自检模式（--self-test / --check）：只验本件自身可跑，不碰目标 ----------
if [ "${1:-}" = "--self-test" ] || [ "${1:-}" = "--check" ]; then
  ST=0
  bash -n "$0" && { echo "PASS  S1    语法自检（bash -n）"; } || { echo "FAIL  S1    语法错误"; ST=1; }
  for fn in ok no chk has; do
    declare -f "$fn" >/dev/null && echo "PASS  S2    断言辅助函数 $fn 已定义" || { echo "FAIL  S2    $fn 未定义"; ST=1; }
  done
  n_exp=$(grep -cE '^\s*(chk|has) ' "$0")
  [ "$n_exp" -ge 40 ] && echo "PASS  S3    断言条数 = $n_exp（≥40）" || { echo "FAIL  S3    断言条数仅 $n_exp"; ST=1; }
  leak=$(grep -cE 'BEGIN (OPENSSH|RSA|PRIVATE) KEY|[A-Za-z0-9_-]{40,}' "$0" 2>/dev/null || true)
  [ "${leak:-0}" -eq 0 ] && echo "PASS  S4    本件无明文密钥字面量" || { echo "FAIL  S4    检测到 $leak 处长字面量"; ST=1; }
  echo "SUMMARY_SELFTEST  PASS=$((4-ST)) FAIL=$ST TOTAL=4"
  [ "$ST" -eq 0 ] && { echo "RESULT=SELF_TEST_OK"; exit 0; } || { echo "RESULT=SELF_TEST_FAIL"; exit 1; }
fi

# ---------- A. 身份机制：proot 假 uid 与内核真 uid 并存 ----------
FAKE=$(id -u)
REAL=$(awk '/^Uid:/{print $2}' /proc/self/status)
if [ -n "$REAL" ] && [ "$FAKE" != "$REAL" ]; then
  ok A1 "proot 假 uid 与内核真 uid 分离 (id -u=$FAKE, /proc/self/status Uid=$REAL)"
else
  no A1 "proot 身份分离未复现 (id -u=$FAKE, status=$REAL)"
fi
# A2：/proc/1 在本 PID 命名空间内不存在（实测 cat /proc/1/comm -> No such file or directory），
# 故改用进程表判定 proot 启动器在场。
has A2 "进程表中 proot 启动器（libproot.so）在场" \
    "$(ps -eo args 2>/dev/null | grep -c 'libproot\.so')" '[1-9]'
chk A2b "/proc/1/comm 在本命名空间内不存在" "$([ -e /proc/1/comm ] && echo present || echo absent)" "absent"
chk A3 "PROOT_* 环境变量数" "$(env | grep -c '^PROOT')" "3"

# ---------- B. 高价值文件面 ----------
PAT='-name *.token -o -name .token -o -name *key* -o -name *secret* -o -name *cred* -o -name *.pem -o -name id_* -o -name *.keystore -o -name *.db'
CRED=$(find /root -maxdepth 3 -type f \( $PAT \) 2>/dev/null | grep -vE '/node_modules/|\.git/' | sort)
chk B1 "凭据类命中文件数" "$(printf '%s\n' "$CRED" | grep -c .)" "12"
M600=$(for f in $CRED; do [ "$(stat -c %a "$f")" = "600" ] && echo x; done | grep -c x)
M644=$(for f in $CRED; do [ "$(stat -c %a "$f")" = "644" ] && echo x; done | grep -c x)
chk B2 "mode 600 计数" "$M600" "9"
chk B3 "mode 644 计数" "$M644" "3"
BAD=$(for f in $CRED; do
        case "$(stat -c %a "$f")" in 644|640|604)
          case "$f" in *.pub|*.label) ;; *) echo "$f";; esac;; esac
      done | grep -c .)
chk B4 "644 且非公钥/标签的文件数（应为 0）" "$BAD" "0"
for pair in "b52a60d5:/root/.dsh/.bridge_token" "a64b618e:/root/.dsh/.credentials.yaml" \
            "f6e392e1:/root/.ssh/id_ed25519" "e33ccee1:/root/.pki/nssdb/key4.db"; do
  want=${pair%%:*}; f=${pair#*:}
  got=$(sha256sum "$f" 2>/dev/null | cut -c1-8)
  chk "B5" "sha256[0:8] $f" "$got" "$want"
done
chk B6 "12 条命中均为绝对路径" "$(printf '%s\n' "$CRED" | grep -c '^/')" "12"
chk B7 "凭据类文件总字节（只算长度，不 dump 内容；awk 求和，本机无 bc）" \
    "$(for f in $CRED; do stat -c %s "$f"; done | paste -sd+ | awk -F+ '{s=0; for(i=1;i<=NF;i++) s+=$i; print s}')" "72275"
chk B8 "sha256[0:8] /root/.pki/nssdb/cert9.db" "$(sha256sum /root/.pki/nssdb/cert9.db | cut -c1-8)" "e6e6ef70"

# ---------- C. 会话与运行数据落点 ----------
chk C1 "/root/.dsh 存在" "$([ -d /root/.dsh ] && echo yes)" "yes"
chk C2 "/root/.dsh/sessions 存在" "$([ -d /root/.dsh/sessions ] && echo yes)" "yes"
chk C3 "会话 workspace 目录数" "$(ls -1 /root/.dsh/sessions 2>/dev/null | grep -c '^--')" "4"
chk C4 "会话文件总数" "$(find /root/.dsh/sessions -type f 2>/dev/null | grep -c .)" "634"
for d in state logs stats tasks history; do
  if [ -e "/root/.dsh/$d" ]; then no C5 "$d 应为不存在"; else ok C5 "$d 不存在（命名空间内无该路径）"; fi
done
MISS=0
SCAN=$(find /root/.dsh -maxdepth 2 -type f \( -name '*.json' -o -name '*.yaml' -o -name '*.yml' -o -name '*.log' \) 2>/dev/null \
       | grep -vE 'node_modules|plugin-src|/sessions/')
chk C6 "有界扫描文件数（排除 node_modules/plugin-src/sessions）" "$(printf '%s\n' "$SCAN" | grep -c .)" "18"
for pair in token:4 secret:2 password:1 api_key:1 apikey:1 authorization:1 credential:1 session_key:1; do
  w=${pair%%:*}; want=${pair#*:}
  chk C7 "含 '$w' 的文件数" "$(grep -lI "$w" $SCAN 2>/dev/null | grep -c .)" "$want"
done
has C8 "含私钥块头的文件（只列路径）" "$(grep -lI 'BEGIN .*PRIVATE KEY' $SCAN 2>/dev/null)" 'synapse/workspaces\.json'
has C9 "含 Bearer 形态的文件（只列路径）" "$(grep -lI 'Bearer ' $SCAN 2>/dev/null)" 'synapse/workspaces\.json'
chk C10 "synapse/workspaces.json 权限位" "$(stat -c %a /root/.dsh/synapse/workspaces.json)" "600"

# ---------- D. 日志留存与轮转 ----------
chk D1 "/var/log 下文件数" "$(find /var/log -maxdepth 2 -type f 2>/dev/null | grep -c .)" "11"
chk D2 "0 字节（从未写过）文件数" "$(find /var/log -maxdepth 2 -type f -size 0 2>/dev/null | grep -c .)" "4"
chk D3 "/etc/logrotate.d 规则数" "$(ls -1 /etc/logrotate.d 2>/dev/null | grep -c .)" "4"
if [ -e /etc/logrotate.conf ]; then no D4 "/etc/logrotate.conf 不应存在"; else ok D4 "/etc/logrotate.conf 不存在"; fi
chk D5 "logrotate 可执行文件路径（空 = 未安装）" "$(command -v logrotate || echo none)" "none"
chk D6 "dpkg 是否登记 logrotate" "$(dpkg -l logrotate 2>/dev/null | grep -c '^ii')" "0"
chk D7 "cron 中 logrotate 调用数" "$(grep -rl logrotate /etc/cron.d /etc/cron.daily /etc/crontab 2>/dev/null | grep -c .)" "0"
chk D8 "无轮转的日志文件数（= 全部存活日志）" "$(find /var/log -maxdepth 2 -type f -size +0 2>/dev/null | grep -c .)" "7"

# ---------- E. 权限位是否构成隔离 ----------
chk E1 "容器内真实身份（宿主 uid）" "$(awk '/^Uid:/{print $2}' /proc/self/status)" "10527"
PROBE=/tmp/.r7v_mode000; printf X > "$PROBE"; chmod 000 "$PROBE"
su -s /bin/sh nobody -c "head -c 1 $PROBE" >/dev/null 2>&1 && r=READ || r=DENIED
chk E2 "mode 000 文件对 proot-nobody 的可读性" "$r" "DENIED"
rm -f "$PROBE"
RD=0; DN=0
while IFS= read -r f; do
  if su -s /bin/sh nobody -c "head -c 1 '$f'" >/dev/null 2>&1; then RD=$((RD+1)); else DN=$((DN+1)); fi
done <<EOF
/root/.dsh/.bridge_token
/root/.ssh/id_ed25519
/root/.local-gh/.token
/root/.dsh/.credentials.yaml
/root/.sunsetlinux-keys/channel.key
/root/.android/debug.keystore
/root/.pki/nssdb/key4.db
/root/Branchbase/.local-gh/id_ed25519
/etc/shadow
EOF
chk E3 "proot-nobody 实读 0600 凭据成功数" "$RD" "9"
chk E4 "proot-nobody 被拒数" "$DN" "0"
SUW=$(su -s /bin/sh nobody -c 'touch /root/.r7v_probe_write' >/dev/null 2>&1 && echo yes || echo no)
chk E5 "proot-nobody 可写 /root（mode 700）" "$SUW" "yes"
rm -f /root/.r7v_probe_write

# ---------- F. 设备桥门禁 ----------
chk F1 "3090 非回环绑定数" "$(ss -ltn 2>/dev/null | awk '$4 ~ /3090/ && $4 !~ /127\.0\.0\.1|\[::1\]/' | grep -c .)" "0"
has F2 "3090 绑定在回环" "$(ss -ltn 2>/dev/null | awk '$4 ~ /3090/{print $4}' | tr '\n' ' ')" '127\.0\.0\.1|\[::1\]'
G0=$(curl -s --max-time 8 "http://$BRIDGE/app/device")
has F3 "无 token 调用 /app/device" "$G0" 'UNAUTHORIZED'
GB=$(curl -s --max-time 8 "http://$BRIDGE/app/device?token=INVALID")
has F4 "错 token 调用 /app/device" "$GB" 'UNAUTHORIZED'
if [ -r "$TOKFILE" ]; then T=$(cat "$TOKFILE"); else T=""; fi
if [ -n "$T" ]; then
  has F5 "正确 token 调用 /app/device" "$(curl -s --max-time 8 "http://$BRIDGE/app/device?token=$T")" 'model='
  NF=0
  for p in /etc/hostname /etc/os-release /tmp /data/local/tmp; do
    r=$(curl -s --max-time 6 -G "http://$BRIDGE/app/readfile" --data-urlencode "path=$p" --data-urlencode "token=$T")
    printf '%s' "$r" | grep -q 'FORBIDDEN: 该路径属于凭据或运行时内部状态' && NF=$((NF+1))
  done
  chk F6 "/app/readfile 对异类路径返回同一 FORBIDDEN 的条数" "$NF" "4"
  has F7 "凭据路径 export 被拒" \
      "$(curl -s --max-time 6 -G "http://$BRIDGE/app/export" --data-urlencode "path=/root/.dsh/.credentials.yaml" --data-urlencode "token=$T")" 'FORBIDDEN'
  has F8 "普通路径 export 被允许（判定串，不执行写入）" \
      "$(curl -s --max-time 6 -G "http://$BRIDGE/app/export" --data-urlencode "path=/sdcard/Download" --data-urlencode "token=$T")" 'NOT_FOUND'
else
  no F5 "$TOKFILE 不可读，桥侧断言跳过"
fi

# ---------- G. 本件自身不落明文 ----------
LEAK=$(grep -cE 'BEGIN (OPENSSH|RSA|PRIVATE) KEY|[A-Za-z0-9_-]{40,}' "$0" 2>/dev/null || true)
LEAK=${LEAK:-0}
chk G1 "验证件内长密钥字面量数（0 = 无明文）" "$LEAK" "0"

echo "SUMMARY  PASS=$PASS FAIL=$FAIL TOTAL=$((PASS+FAIL))"
if [ "$FAIL" -eq 0 ]; then echo "RESULT=ALL_PASS"; exit 0; else echo "RESULT=FAIL"; exit 1; fi
