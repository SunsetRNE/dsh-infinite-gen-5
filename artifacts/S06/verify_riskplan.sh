#!/usr/bin/env bash
# verify_riskplan.sh — 对 riskplan.py 的三条硬判据做自动化核验
set -u
A=/root/dsh-infinite-gen-4/ig5-t3/artifacts/S06
cat > "$A/fixture.jsonl" <<'J'
{"id":"OP1","kind":"change_config","target":"/etc/TARGET/app.conf","scope":"service"}
{"id":"OP2","kind":"delete_data","target":"/var/lib/TARGET/queue","data_root":"/var/lib/TARGET/raw","backup":"/srv/bak/queue.tgz","scope":"dir"}
{"id":"OP3","kind":"downgrade","target":"TARGET_SVC","scope":"device"}
J
out=$(python3 "$A/riskplan.py" "$A/fixture.jsonl" 2>&1); rc=$?
echo "$out"
echo "exit=$rc"
n_impact=$(printf '%s\n' "$out" | grep -c '影响：')
n_keep=$(printf '%s\n' "$out" | grep -c '不影响：')
ok=1
n_l1=$(printf '%s\n' "$out" | grep -c '^\[.*\] L1')
[ "$n_impact" -ge 3 ] && [ "$n_keep" -ge 3 ] || { echo "FAIL 影响面点名不全"; ok=0; }
[ "$n_l1" -ge 1 ] || { echo "FAIL 改单个配置项未被判成 L1"; ok=0; }
[ "$rc" -eq 2 ] || { echo "FAIL 缺备份的整机降级应要求人工确认"; ok=0; }
printf '%s\n' "$out" | grep -q 'rm -rf' && { echo "FAIL 计划里出现直接删目录写法"; ok=0; }
printf '%s\n' "$out" | grep -q 'dry-run' || { echo "FAIL 默认不是 dry-run"; ok=0; }
[ "$ok" -eq 1 ] && echo "PASS 三条判据全过（影响面点名/人工确认/dry-run 默认）"
