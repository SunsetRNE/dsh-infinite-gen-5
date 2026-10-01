#!/usr/bin/env bash
# verify-dsha.sh — DSHA 层自检：静态档查本层文件；全量档只读探桥与端点
set -uo pipefail
MODE="${1:-full}"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0; FAIL=0; SKIP=0
ok(){ PASS=$((PASS+1)); printf '  [ OK ]   %s\n' "$1"; }
bad(){ FAIL=$((FAIL+1)); printf '  [FAIL]   %s\n' "$1"; }
skip(){ SKIP=$((SKIP+1)); printf '  [SKIP]   %s\n' "$1"; }

bash -n "$SELF/verify-dsha.sh" 2>/dev/null && ok "自身语法" || bad "自身语法"
for f in SKILL.md references/dsha-problems.md; do
  [ -f "$SELF/../$f" ] && ok "必备文件 $f" || bad "缺必备文件 $f"
done
grep -q '桥挂了不要重试' "$SELF/../SKILL.md" && ok "SKILL.md 含「桥挂了不要重试」" || bad "缺该条"
grep -q '三条替代' "$SELF/../SKILL.md" && ok "SKILL.md 含「三条替代路径」" || bad "缺该条"

if [ "$MODE" = "--selftest" ]; then
  printf '回执（静态档）：已知 %d · 跳过 %d · 失败 %d\n' "$PASS" "$SKIP" "$FAIL"
  [ "$FAIL" -eq 0 ] || exit 1
  exit 0
fi

TOK="$(cat /root/.dsh/.bridge_token 2>/dev/null || true)"
if [ -z "$TOK" ]; then skip "未取到桥令牌（/root/.dsh/.bridge_token）"
else
  if curl -s --max-time 6 "http://127.0.0.1:3090/app/device?token=$TOK" >/tmp/dsha-dev.$$ 2>&1 && head -c 40 /tmp/dsha-dev.$$ | grep -q '{'; then
    ok "桥在线：/app/device 有响应"
  else
    bad "桥不可用（与 .bridge_status 对照；不要重试同一条）"
  fi
  [ -f /root/.dsh/.bridge_status ] && ok "bridge_status 在场（判据：$(head -c 60 /root/.dsh/.bridge_status))" || skip "无 .bridge_status"
fi
printf '回执：已知 %d · 跳过 %d · 失败 %d\n' "$PASS" "$SKIP" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
