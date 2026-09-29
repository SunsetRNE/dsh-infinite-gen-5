#!/usr/bin/env bash
# R3 judge — 只读：监听面端口表 + 无 token 状态码矩阵。不改服务、不发外网包。
set -uo pipefail
FAIL=0
echo "== [1] LISTEN 端口表（ss + /proc/net/tcp{,6} inode）=="
ss -ltn 2>/dev/null | awk 'NR>1{print $1,$4}' | sort -u
SS_N=$(ss -ltn 2>/dev/null | awk 'NR>1 && $1=="LISTEN"' | wc -l)
P4=$(awk 'NR>1 && $4=="0A"' /proc/net/tcp  | wc -l)
P6=$(awk 'NR>1 && $4=="0A"' /proc/net/tcp6 | wc -l)
echo "ss_LISTEN=$SS_N  proc_tcp_LISTEN=$P4  proc_tcp6_LISTEN=$P6"
[ "$SS_N" -ge 1 ] || FAIL=1

echo "== [2] 无 token 状态码矩阵（3090 DSHA 桥）=="
for p in /app/version /app/device /app/help /app/apps; do
  sc=$(curl -sS --max-time 4 -o /tmp/r3_body -w '%{http_code}' "http://127.0.0.1:3090$p")
  body=$(tr -d '\n' </tmp/r3_body | head -c 40)
  echo "no_token $p -> HTTP $sc body=$body"
  [ "$sc" = "200" ] || FAIL=1
  case "$body" in *UNAUTHORIZED*) ;; *) FAIL=1;; esac
done

echo "== [3] 环回 vs 非环回绑定 =="
for t in "127.0.0.1 7890" "172.19.0.1 7890" "10.202.11.230 7890" "172.19.0.1 3080"; do
  set -- $t
  if timeout 2 bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null; then echo "$1:$2 OPEN"; else echo "$1:$2 CLOSED"; fi
done

echo "== [4] 3080 未认证门禁 =="
C=$(curl -sS --max-time 4 -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/)
echo "3080 / no-auth -> HTTP $C"; [ "$C" = "401" ] || FAIL=1

echo "== 退出码 =="; echo "FAIL=$FAIL"
exit $FAIL
