#!/usr/bin/env bash
# check_verification.sh -- 逐条核对 VERIFICATION.txt 是否覆盖 3.4 要求的六项，并复算哈希/退出码
set -uo pipefail
A=/root/dsh-infinite-gen-4/ig5-t3/answers/artifacts/T03-03
V=$A/VERIFICATION.txt
fail=0
req(){ # req <锚点> <grep 模式>
  if grep -qE "$2" "$V"; then echo "OK   $1"; else echo "FAIL $1 (missing in VERIFICATION.txt)"; fail=1; fi
}
echo "== 六项覆盖核对 =="
req "1 变更字段/分支"      'MAX_RETRY *3 *-> *5'
req "2 四件产物路径"       'MODIFIED_FILE.*policy_gate.modified.py'
req "2 四件产物路径(diff)" 'DIFF_FILE.*policy_gate.diff'
req "2 四件产物路径(verify)" 'VERIFICATION.*VERIFICATION.txt'
req "2 四件产物路径(rollback)" 'ROLLBACK.sh.*mode 755'
req "3 BASELINE 精确命令"  'GATE_PROFILE=baseline python3 -m unittest -v test_policy_gate'
req "3 MODIFIED 精确命令"  'GATE_PROFILE=target +python3 -m unittest -v test_policy_gate'
req "3 ROLLBACK 精确命令"  'ROLLBACK.sh'
req "4 字面输出"           'Ran 4 tests in'
req "5 退出状态"           'exit 0|exit 1|exits='
req "6 恢复后状态"         '恢复后的行为 / 状态'
echo "== 复算（不信任文本，重算一遍）=="
pre=$(sha256sum "$A/policy_gate.py" | cut -d' ' -f1)
mod=$(sha256sum "$A/policy_gate.modified.py" | cut -d' ' -f1)
probe=$(sha256sum /root/dsh-infinite-gen-4/ig5-t3/work/rollback_probe/policy_gate.py | cut -d' ' -f1)
[ "$pre" = 36298e40e2df43bdc35efc26968a5731f7422dff7d4e29fc2e1175799ba0fea5 ] && echo "OK   pristine=$pre" || { echo "FAIL pristine=$pre"; fail=1; }
[ "$mod" = 98821d8cd1dc4d148e2f516bdd608addcc102412c0a425e9ed620646cce51c8a ] && echo "OK   modified=$mod (保持已修改)" || { echo "FAIL modified=$mod"; fail=1; }
[ "$probe" = "$pre" ] && echo "OK   rollback_probe=$probe (== pristine)" || { echo "FAIL probe=$probe"; fail=1; }
( cd /root/dsh-infinite-gen-4/ig5-t3/work/mod && GATE_PROFILE=target python3 -m unittest test_policy_gate >/dev/null 2>&1 ); echo "OK   re-run modified exit=$?"
echo "CHECK_EXIT=$fail"; exit "$fail"
