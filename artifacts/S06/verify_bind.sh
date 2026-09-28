#!/usr/bin/env bash
# verify_bind.sh — 核验「先绑路径再进主题推理」的四条硬判据
set -u
A=/root/dsh-infinite-gen-4/ig5-t3/artifacts/S06
cat > "$A/tasks.jsonl" <<'J'
{"id":"T1","domain":"physical","stage":"请求","subject":"ROLE_A","intent":"推动货箱"}
{"id":"T2","domain":"mechanical","stage":"修正","subject":"ROLE_B","intent":"对准并紧固"}
{"id":"T3","domain":"biological","stage":"释放","subject":"ROLE_A","intent":"取样后灭活"}
{"id":"T4","domain":"narrative","stage":"延续","subject":"ROLE_B","intent":"承接上一场"}
{"id":"T5","stage":"请求","subject":"ROLE_A","intent":"未声明领域"}
J
out=$(python3 "$A/bind_path.py" "$A/tasks.jsonl" 2>&1); rc=$?
echo "$out"; echo "exit=$rc"
ok=1
for s in 请求 修正 释放 延续; do
  printf '%s\n' "$out" | grep -q "STAGE=$s" || { echo "FAIL 缺阶段 $s 的绑定"; ok=0; }
done
[ "$(printf '%s\n' "$out" | grep -c 'BOUND_BEFORE_REASON=1')" -ge 4 ] || { echo "FAIL 绑定记录不足"; ok=0; }
[ "$rc" -eq 3 ] || { echo "FAIL 未绑定记录未拒发推理"; ok=0; }
printf '%s\n' "$out" | grep -q 'REFUSE: 未绑定路径' || { echo "FAIL 缺拒发动作为证据"; ok=0; }
path_ids=$(printf '%s\n' "$out" | grep -o 'PATH-[A-Z]*-1' | sort -u | wc -l)
[ "$path_ids" -ge 4 ] || { echo "FAIL 路径未按领域分派"; ok=0; }
[ "$ok" -eq 1 ] && echo "PASS 四条判据全过（阶段齐全/绑定先行/未绑拒发/分领域路径）"
exit $(( ok == 1 ? 0 : 1 ))
