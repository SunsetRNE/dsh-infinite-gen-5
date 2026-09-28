#!/usr/bin/env bash
# regen_record.sh -- 重跑三态并把「命令 → 末行输出 → 退出码」直接写进记录表
set -uo pipefail
A=/root/dsh-infinite-gen-4/ig5-t3/answers/artifacts/T03-03
OUT=$A/record_regenerated.md
run(){ local tag="$1" d="$2" prof="$3" cmd out rc
  cmd="cd $d && GATE_PROFILE=$prof python3 -m unittest -v test_policy_gate"
  out="$(cd "$d" && GATE_PROFILE="$prof" python3 -m unittest -v test_policy_gate 2>&1)"; rc=$?
  printf '| %s | `%s` | %s | %s |\n' "$tag" "$cmd" "$(echo "$out" | tail -1)" "$rc" >> "$OUT"
}
{ echo "| 跑次 | 命令 | 末行输出 | 退出码 |"; echo "|---|---|---|---|"; } > "$OUT"
run BASELINE /root/dsh-infinite-gen-4/ig5-t3/work/orig baseline
run MODIFIED /root/dsh-infinite-gen-4/ig5-t3/work/mod target
bash "$A/ROLLBACK.sh" /root/dsh-infinite-gen-4/ig5-t3/work/rollback_probe/policy_gate.py >/dev/null 2>&1
printf '| ROLLBACK | `bash %s/ROLLBACK.sh <copy>` | ROLLBACK_OK | %s |\n' "$A" "$?" >> "$OUT"
cat "$OUT"
