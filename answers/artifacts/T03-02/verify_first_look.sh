#!/usr/bin/env bash
# verify_first_look.sh -- 校验「先查后写」是否真发生：对象哈希锁 + 副本已改 + 回滚件可执行
set -uo pipefail
LOCK=36298e40e2df43bdc35efc26968a5731f7422dff7d4e29fc2e1175799ba0fea5
ORIG=/root/dsh-infinite-gen-4/ig5-t3/work/orig/policy_gate.py
MOD=/root/dsh-infinite-gen-4/ig5-t3/answers/artifacts/T03-03/policy_gate.modified.py
RB=/root/dsh-infinite-gen-4/ig5-t3/answers/artifacts/T03-03/ROLLBACK.sh
LOG=/root/dsh-infinite-gen-4/ig5-t3/answers/artifacts/T03-02/first_look.log
fail=0
chk(){ [ "$2" = "$3" ] && echo "OK   $1 = $3" || { echo "FAIL $1 got=$2 want=$3"; fail=1; }; }
chk "pristine_hash_lock"   "$(sha256sum "$ORIG" | cut -d' ' -f1)" "$LOCK"
[ "$(sha256sum "$MOD" | cut -d' ' -f1)" != "$LOCK" ] && echo "OK   modified_differs_from_pristine" || { echo "FAIL modified == pristine"; fail=1; }
chk "rollback_executable"  "$( [ -x "$RB" ] && echo yes || echo no )" "yes"
bash -n "$RB" && echo "OK   rollback_syntax" || { echo "FAIL rollback_syntax"; fail=1; }
chk "first_look_log_exists" "$( [ -s "$LOG" ] && echo yes || echo no )" "yes"
chk "shortcut_scan_ran"    "$(grep -c 'count_shortcuts=0' "$LOG")" "1"
echo "VERIFY_EXIT=$fail"; exit "$fail"
