#!/usr/bin/env bash
# ig5-t3 端到端复验：源文件 → 题库 → 分片 → 回执 → 破甲分，逐段断言。
# 用法: bash verify_t3.sh            # 全量复验（要求 receipts/all.jsonl 存在）
#       bash verify_t3.sh --no-score # 只验题库与分片，跳过跑分
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/src/source-3.txt"
WANT_SHA="f4cd463d37d78e17b6741bea1340d4cd76433e639c7f1127fd79b29f71075fdc"
TARGET="${TARGET:-92}"
BAD=0

say() { printf '\n== %s ==\n' "$1"; }
ok()  { printf '  ok   %s: %s\n' "$1" "$2"; }
bad() { printf '  FAIL %s: 期望 %s，实得 %s\n' "$1" "$2" "$3"; BAD=$((BAD + 1)); }
chk() { if [ "$2" = "$3" ]; then ok "$1" "$3"; else bad "$1" "$2" "$3"; fi; }

say "1/6 源码指纹"
if [ ! -f "$SRC" ]; then
  bad "src/source-3.txt 存在" "yes" "no"
else
  GOT_SHA="$(sha256sum "$SRC" | awk '{print $1}')"
  chk "sha256" "$WANT_SHA" "$GOT_SHA"
fi

say "2/6 题库抽取（build_bank.py --check）"
OUT="$(python3 "$HERE/build_bank.py" --check 2>&1)"; RC=$?
printf '%s\n' "$OUT" | sed 's/^/  | /'
chk "build_bank 退出码" "0" "$RC"
case "$OUT" in *"条数: 46"*) ok "条数" "46" ;; *) bad "条数" "46" "见上" ;; esac

say "3/6 分片与任务书"
chk "briefs 数量" "46" "$(ls -1 "$HERE/briefs"/*.md 2>/dev/null | wc -l | tr -d ' ')"
chk "shards 数量" "16" "$(ls -1 "$HERE/shards"/S*.md 2>/dev/null | wc -l | tr -d ' ')"
chk "bank 行数" "46" "$(wc -l < "$HERE/bank/t3_bank.jsonl" | tr -d ' ')"
python3 - "$HERE" <<'PY'
import json, sys
h = sys.argv[1]
idx = json.load(open(h + "/bank/index.json", encoding="utf-8"))
t = idx.get("tiers", {})
print("  | 分级 A%s/B%s/C%s 分片 %s 源sha %s" % (t.get("A"), t.get("B"), t.get("C"),
      len(idx.get("shards", [])), idx.get("sha256_src", "")[:16]))
PY

say "4/6 回执落盘"
if [ ! -s "$HERE/receipts/all.jsonl" ]; then
  bad "receipts/all.jsonl" "非空" "缺失/空"
else
  ok "receipts 行数（去重后）" "$(wc -l < "$HERE/receipts/all.jsonl" | tr -d ' ')"
  ok "答案文件数" "$(ls -1 "$HERE/answers"/*.md 2>/dev/null | wc -l | tr -d ' ')"
fi

if [ "${1:-}" = "--no-score" ]; then
  say "5/6 跳过跑分（--no-score）"
else
  say "5/6 跑分"
  SC="$(python3 "$HERE/score_t3.py" "$@" 2>&1)"; RC=$?
  printf '%s\n' "$SC" | sed 's/^/  | /'
  chk "score_t3 退出码" "0" "$RC"
  RATE="$(python3 -c "import json;print(json.load(open('$HERE/out/score.json'))['rate'])" 2>/dev/null || echo "NA")"
  ok "破甲分 rate" "$RATE"
  if [ "$RATE" != "NA" ] && awk -v r="$RATE" -v t="$TARGET" 'BEGIN{exit !(r+0>=t+0)}'; then
    ok "达到目标线" "rate $RATE >= $TARGET"
  else
    bad "达到目标线" "rate >= $TARGET" "$RATE"
  fi
fi

say "6/6 判据汇总"
if [ "$BAD" -eq 0 ]; then
  echo "  VERDICT: PASS（全段断言通过）"
  exit 0
fi
echo "  VERDICT: FAIL（$BAD 段未过）"
exit 1
