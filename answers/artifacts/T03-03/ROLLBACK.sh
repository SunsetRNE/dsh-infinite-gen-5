#!/usr/bin/env bash
# ROLLBACK.sh -- restore a mutated copy of policy_gate.py from the pristine original,
# confirm the hash equals the recorded baseline, then re-run the BASELINE suite.
# usage: ROLLBACK.sh <path-to-mutated-copy-of-policy_gate.py>
set -euo pipefail

PRISTINE="${PRISTINE:-/root/dsh-infinite-gen-4/ig5-t3/answers/artifacts/T03-03/policy_gate.py}"
BASELINE_SHA256="${BASELINE_SHA256:-36298e40e2df43bdc35efc26968a5731f7422dff7d4e29fc2e1175799ba0fea5}"
TEST_SRC="${TEST_SRC:-/root/dsh-infinite-gen-4/ig5-t3/answers/artifacts/T03-03/test_policy_gate.py}"
TARGET="${1:?usage: ROLLBACK.sh <path-to-mutated-copy-of-policy_gate.py>}"

echo "[1/4] pristine hash check"
test -f "$PRISTINE" || { echo "MISSING_PRISTINE $PRISTINE" >&2; exit 2; }
test -f "$TARGET"   || { echo "MISSING_TARGET $TARGET" >&2; exit 2; }
got="$(sha256sum "$PRISTINE" | cut -d' ' -f1)"
[ "$got" = "$BASELINE_SHA256" ] || { echo "PRISTINE_HASH_MISMATCH got=$got want=$BASELINE_SHA256" >&2; exit 3; }
echo "pristine_ok sha256=$got"

echo "[2/4] pre-rollback target hash"
sha256sum "$TARGET"

echo "[3/4] restore -> $TARGET"
cp -f "$PRISTINE" "$TARGET"
chmod 644 "$TARGET"
new="$(sha256sum "$TARGET" | cut -d' ' -f1)"
echo "restored sha256=$new"
[ "$new" = "$BASELINE_SHA256" ] || { echo "RESTORE_HASH_MISMATCH got=$new" >&2; exit 4; }

echo "[4/4] baseline suite on restored file"
d="$(dirname "$TARGET")"
cp -f "$TEST_SRC" "$d/test_policy_gate.py"
( cd "$d" && GATE_PROFILE=baseline python3 -m unittest test_policy_gate 2>&1 | tail -4 )
rc=${PIPESTATUS[0]:-0}
# re-run to capture the real exit status of the suite itself
( cd "$d" && GATE_PROFILE=baseline python3 -m unittest test_policy_gate >/dev/null 2>&1 ); rc=$?
echo "rollback_test_exit=$rc"
[ "$rc" -eq 0 ] && echo "ROLLBACK_OK" || echo "ROLLBACK_FAILED"
exit "$rc"
