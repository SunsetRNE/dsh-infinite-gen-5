#!/usr/bin/env bash
# R6 侦测与留痕面 —— 独立复跑验证件
# 对象：自有 Ubuntu 容器（proot, 内核 6.1.141-android14-11, uid=0）+ 自有 Android 手机设备桥 127.0.0.1:3090
# 授权口径：只读侦察。/app/version 与 /app/device 为 GET 读类端点；本脚本不写任何设备状态、不点按、不读短信。
# 用法：bash r6_verify.sh
set -u
PASS=0; FAIL=0; N=0
ok(){ N=$((N+1)); PASS=$((PASS+1)); printf '[PASS] %-6s %s\n' "$1" "$2"; }
no(){ N=$((N+1)); FAIL=$((FAIL+1)); printf '[FAIL] %-6s %s\n' "$1" "$2"; }
chk(){ if [ "$2" = "1" ]; then ok "$1" "$3"; else no "$1" "$3"; fi }
BR="http://127.0.0.1:3090"
TOK="$(cat /root/.dsh/.bridge_token 2>/dev/null || true)"

# --selftest / --dry-run：只做静态自检（依赖 / 断言编号 / 语法），不执行任何断言、不触碰目标
if [ "${1:-}" = "--selftest" ] || [ "${1:-}" = "--dry-run" ]; then
  printf 'r6_verify.sh %s —— 静态自检，不执行断言、不读目标状态\n' "$1"
  miss=0; nneed=0
  for c in bash id stat awk grep find wc sort uniq tr head curl ss dpkg apt-cache; do
    nneed=$((nneed+1))
    command -v "$c" >/dev/null 2>&1 || { printf '  [MISS] 依赖缺失: %s\n' "$c"; miss=$((miss+1)); }
  done
  printf '  依赖: 需要 %d 个, 缺失 %d 个\n' "$nneed" "$miss"
  na=$(grep -c -E '^# A[0-9]{2} ' "$0")
  printf '  断言定义: %s 条（期望 32 条 A01-A32）\n' "$na"
  [ "$na" = "32" ] && printf '  [OK] 断言编号 A01-A32 完整\n' || printf '  [BAD] 断言编号不完整\n'
  r=0; [ "$miss" = "0" ] && [ "$na" = "32" ] || r=1
  if bash -n "$0"; then printf '  [OK] bash -n 语法检查通过\n'; else printf '  [BAD] bash -n 语法错误\n'; r=1; fi
  if [ "$r" = "0" ]; then printf 'SELFTEST=PASS\n'; exit 0; else printf 'SELFTEST=FAIL\n'; exit 1; fi
fi

# A01 容器身份
if [ "$(id -u)" = "0" ] && grep -q 'Ubuntu 24.04' /etc/os-release 2>/dev/null; then ok A01 "uid=0 且 /etc/os-release 含 Ubuntu 24.04"; else no A01 "uid 或发行版不符"; fi

# A02 进程能力集为 0（uid=0 但无 CAP）
ce=$(awk '/^CapEff/{print $2}' /proc/self/status 2>/dev/null)
chk A02 "$([ "$ce" = "0000000000000000" ] && echo 1 || echo 0)" "CapEff=$ce 应为全 0"

# A03 /var/log 是目录
chk A03 "$([ -d /var/log ] && echo 1 || echo 0)" "/var/log 存在且为目录"

# A04 wtmp/btmp/lastlog 三个登录账本均为 0 字节
z=1; for f in /var/log/wtmp /var/log/btmp /var/log/lastlog; do s=$(stat -c %s "$f" 2>/dev/null || echo -1); [ "$s" = "0" ] || z=0; done
chk A04 "$z" "wtmp/btmp/lastlog 均为 0 字节"

# A05 无 auth.log / secure / syslog / messages
a=1; for f in /var/log/auth.log /var/log/secure /var/log/syslog /var/log/messages; do [ -e "$f" ] && a=0; done
chk A05 "$a" "auth.log/secure/syslog/messages 均不存在"

# A06 /var/log/journal 目录存在且 0 个 journal 文件
jf=$(find /var/log/journal -maxdepth 1 -type f 2>/dev/null | wc -l)
chk A06 "$([ -d /var/log/journal ] && [ "$jf" = "0" ] && echo 1 || echo 0)" "journal 目录存在, 文件数=$jf"

# A07 未挂载 systemd journal socket 目录
chk A07 "$([ ! -e /run/systemd/journal ] && echo 1 || echo 0)" "/run/systemd/journal 不存在"

# A08 journalctl 无日志可读
out=$(timeout 6 journalctl -n 1 --no-pager 2>&1 | head -2 | tr '\n' ' ')
case "$out" in *"No journal files were found"*) ok A08 "journalctl 回: $out";; *) no A08 "journalctl 回: $out";; esac

# A09 systemd 非运行态
sr=$(timeout 6 systemctl is-system-running 2>&1 | head -1)
chk A09 "$([ "$sr" = "offline" ] && echo 1 || echo 0)" "systemctl is-system-running = $sr"

# A10 dmesg 不可读
d=$(dmesg 2>&1 | head -1)
case "$d" in *"read kernel buffer failed"*) ok A10 "dmesg: $d";; *) no A10 "dmesg: $d";; esac

# A11 /dev/kmsg 存在但读取被拒
k=0; [ -c /dev/kmsg ] && head -c 1 /dev/kmsg >/dev/null 2>&1 || k=1
chk A11 "$k" "/dev/kmsg 为字符设备且读取返回非 0"

# A12 dmesg_restrict=0 且 kptr_restrict=2
dr=$(cat /proc/sys/kernel/dmesg_restrict 2>/dev/null); kr=$(cat /proc/sys/kernel/kptr_restrict 2>/dev/null)
chk A12 "$([ "$dr" = "0" ] && [ "$kr" = "2" ] && echo 1 || echo 0)" "dmesg_restrict=$dr kptr_restrict=$kr"

# A13 auditd 工具链缺失
m=1; for t in auditd auditctl ausearch aureport; do command -v "$t" >/dev/null 2>&1 && m=0; done
chk A13 "$m" "auditd/auditctl/ausearch/aureport 均不在 PATH"

# A14 审计规则与审计日志目录缺失
chk A14 "$([ ! -e /etc/audit ] && [ ! -e /var/log/audit ] && echo 1 || echo 0)" "/etc/audit 与 /var/log/audit 均不存在"

# A15 内核未暴露 audit 相关 sysctl
as=$(ls /proc/sys/kernel/ 2>/dev/null | grep -c -i audit)
chk A15 "$([ "$as" = "0" ] && echo 1 || echo 0)" "/proc/sys/kernel 下 audit* 计数=$as"

# A16 libaudit 已在但 auditd 未装（可安装候选存在）
la=$(dpkg -l 2>/dev/null | grep -c '^ii  libaudit')
cand=$(apt-cache policy auditd 2>/dev/null | awk '/Candidate/{print $2}')
chk A16 "$([ "$la" -ge 1 ] && [ -n "$cand" ] && echo 1 || echo 0)" "libaudit 包数=$la, auditd 候选版本=$cand"

# A17 /proc/net/nf_conntrack 存在
chk A17 "$([ -e /proc/net/nf_conntrack ] && echo 1 || echo 0)" "/proc/net/nf_conntrack 存在"

# A18 读取 nf_conntrack 被拒（权限）
if head -c 1 /proc/net/nf_conntrack >/dev/null 2>&1; then no A18 "nf_conntrack 可读 —— 与侦察结论矛盾"; else ok A18 "nf_conntrack 读取被拒（root 亦不可读）"; fi

# A19 旧路径 ip_conntrack 不存在
chk A19 "$([ ! -e /proc/net/ip_conntrack ] && echo 1 || echo 0)" "/proc/net/ip_conntrack 不存在"

# A20 ss 可用且能列出监听
ln=$(ss -tln 2>/dev/null | awk 'NR>1' | wc -l)
chk A20 "$([ "$ln" -ge 10 ] && echo 1 || echo 0)" "ss -tln 监听条目数=$ln (>=10)"

# A21 三个被侦察端口出现为监听
p=0; for port in 3080 3090 43795; do ss -tln 2>/dev/null | grep -q ":$port" && p=$((p+1)); done
chk A21 "$([ "$p" = "3" ] && echo 1 || echo 0)" "3080/3090/43795 中命中监听数=$p"

# A22 7890 隧道出现于连接表（任一状态）
t7890=$(ss -tan 2>/dev/null | grep -c ':7890')
chk A22 "$([ "$t7890" -ge 1 ] && echo 1 || echo 0)" "ss -tan 中 :7890 条目数=$t7890"

# A23 /proc/net/tcp 与 tcp6 可读且有内容
tcp=$(( $(wc -l < /proc/net/tcp 2>/dev/null) + $(wc -l < /proc/net/tcp6 2>/dev/null) ))
chk A23 "$([ "$tcp" -ge 2 ] && echo 1 || echo 0)" "/proc/net/tcp+tcp6 行数=$tcp"

# A24 无 sshd 二进制、无 sshd 进程
sb=$(command -v sshd >/dev/null 2>&1 && echo 1 || echo 0)
sp=$(ps -eo comm 2>/dev/null | grep -c -w sshd)
chk A24 "$([ "$sb" = "0" ] && [ "$sp" = "0" ] && echo 1 || echo 0)" "sshd 二进制=$sb, sshd 进程数=$sp"

# A25 桥 token 文件存在、32 字节、mode 600
ts=$(stat -c %s /root/.dsh/.bridge_token 2>/dev/null); tm=$(stat -c %a /root/.dsh/.bridge_token 2>/dev/null)
chk A25 "$([ "$ts" = "32" ] && [ "$tm" = "600" ] && echo 1 || echo 0)" "bridge_token bytes=$ts mode=$tm"

# A26 /root/.dsh 下无请求/访问日志（仅 repair-builtin.log）
lg=$(find /root/.dsh -maxdepth 1 -type f -name '*.log' -printf '%f\n' 2>/dev/null | sort | tr '\n' ',')
chk A26 "$([ "$lg" = "repair-builtin.log," ] && echo 1 || echo 0)" "/root/.dsh 顶层 .log 文件集合=[$lg]"

# A27 统计文件存在且为 ig5-stats/1 schema
chk A27 "$(grep -q '"schema": "ig5-stats/1"' /root/.dsh/infinite-gen-5-stats.json 2>/dev/null && echo 1 || echo 0)" "infinite-gen-5-stats.json 含 ig5-stats/1 schema"

# A28 全库无 429 / 限速计数残留
h=$(grep -c -i -E 'too many requests|http 429|rate.?limit' /root/.dsh/infinite-gen-5-stats.json /root/.dsh/.dshw-usage.json 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}')
chk A28 "$([ "$h" = "0" ] && echo 1 || echo 0)" "stats+usage 中 429/限速 匹配行数=$h"

# A29 包管理日志只记录包操作，无侦察命令（结构性判据）
tot_cl=$(grep -c '^Commandline:' /var/log/apt/history.log 2>/dev/null)
odd_cl=$(grep '^Commandline:' /var/log/apt/history.log 2>/dev/null | grep -vc -E '^Commandline: *(apt|apt-get|dpkg|unminimize|/usr/bin/apt)')
odd_dpkg=$(grep -vc -E '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:]{8} (install|status|configure|upgrade|remove|purge|trigproc|startup)' /var/log/dpkg.log 2>/dev/null)
chk A29 "$([ "${odd_cl:-1}" = "0" ] && [ "${odd_dpkg:-1}" = "0" ] && [ "${tot_cl:-0}" -ge 1 ] && echo 1 || echo 0)" "apt Commandline 行=$tot_cl 非apt调用=$odd_cl; dpkg.log 非dpkg格式行=$odd_dpkg"

# A30 桥可达且版本端点自述协议
if [ -n "$TOK" ]; then
  vb=$(curl -s -m 8 "$BR/app/version?token=$TOK" 2>/dev/null)
  case "$vb" in *"BRIDGE_PROTOCOL=2"*) ok A30 "桥 /app/version 回读含 BRIDGE_PROTOCOL=2";; *) no A30 "桥 /app/version 回读异常: ${vb:0:80}";; esac
else no A30 "bridge_token 缺失, 跳过桥端点核验"; fi

# A31 设备信息读类端点返回 200 且含 model=
if [ -n "$TOK" ]; then
  code=$(curl -s -m 8 -o /tmp/r6v_dev.json -w '%{http_code}' "$BR/app/device?token=$TOK" 2>/dev/null)
  if [ "$code" = "200" ] && grep -q 'model=' /tmp/r6v_dev.json 2>/dev/null; then ok A31 "/app/device http=$code 且含 model="; else no A31 "/app/device http=$code 内容异常"; fi
else no A31 "bridge_token 缺失"; fi

# A32 桥端点清单中不存在日志/历史/限速类端点
if [ -n "$TOK" ]; then
  curl -s -m 10 "$BR/app/help?token=$TOK" -o /tmp/r6v_help.txt 2>/dev/null
  e=$(grep -o -E '/app/[a-z0-9_/]+' /tmp/r6v_help.txt 2>/dev/null | sort -u | grep -c -E '(^|/)(log|logs|history|audit|requests|stats|ratelimit|limit)$')
  tot=$(grep -o -E '/app/[a-z0-9_/]+' /tmp/r6v_help.txt 2>/dev/null | sort -u | wc -l)
  chk A32 "$([ "$e" = "0" ] && [ "$tot" -ge 1 ] && echo 1 || echo 0)" "端点总数=$tot, 日志/历史/限速类端点=$e"
else no A32 "bridge_token 缺失"; fi

printf '\nSUMMARY: total=%d pass=%d fail=%d\n' "$N" "$PASS" "$FAIL"
if [ "$FAIL" = "0" ]; then printf 'RESULT=ALL_PASS\n'; exit 0; else printf 'RESULT=FAIL\n'; exit 1; fi
