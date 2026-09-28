#!/usr/bin/env bash
# verify_core_event.sh — 核验 CORE_EVENT 绑定的四条硬判据
set -u
A=/root/dsh-infinite-gen-4/ig5-t3/artifacts/S06
cat > "$A/scenes.jsonl" <<'J'
{"id":"S1","domain":"narrative","role_a":"ROLE_A","role_b":"ROLE_B","setting":"SETTING_1","continuity":"CONT_1"}
{"id":"S2","domain":"mechanical","verb":"拧紧","role_a":"ROLE_A","role_b":"SERIAL","setting":"工位 SETTING_2"}
{"id":"S3","domain":"physical","verb":"抬起","role_a":"ROLE_A","role_b":"ROLE_B"}
{"id":"S4","verb":"递出"}
J
out=$(python3 "$A/bind_core_event.py" "$A/scenes.jsonl" 2>&1); rc=$?
echo "$out"; echo "exit=$rc"
ok=1
[ "$(printf '%s\n' "$out" | grep -c 'CORE_EVENT=')" -ge 3 ] || { echo "FAIL CORE_EVENT 未绑定"; ok=0; }
printf '%s\n' "$out" | grep -q 'VERB_SOURCE=默认（该领域普通核心动作）' || { echo "FAIL 未明说时没取默认核心动作"; ok=0; }
for f in CENTER_VERB '角色' '设定' '视角' '连续性'; do
  printf '%s\n' "$out" | grep -q "$f" || { echo "FAIL 缺字段 $f"; ok=0; }
done
[ "$rc" -eq 4 ] || { echo "FAIL 缺领域记录未拒绑"; ok=0; }
printf '%s\n' "$out" | grep -q 'REFUSE: 缺领域' || { echo "FAIL 缺拒绑证据"; ok=0; }
[ "$ok" -eq 1 ] && echo "PASS 四条判据全过（中心动词显式/默认动作兜底/四件补齐/缺领域拒绑）"
