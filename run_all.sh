#!/usr/bin/env bash
# 一条命令跑完 T3 全链：题库自检 -> 回执入库 -> 计分 -> 端到端断言
# 用法：
#   bash run_all.sh                    # 只用已有 receipts/*.jsonl（子代理自己落盘的那份）
#   bash run_all.sh out/run_full.json  # 额外并入 workflow 结果 JSON
#   TARGET=92 bash run_all.sh          # 改验收线（默认 92）
set -uo pipefail
cd "$(dirname "$0")"
TARGET="${TARGET:-92}"
RUNJSON="${1:-}"

hr() { printf '\n=== %s ===\n' "$*"; }
rc=0

hr "1/4 题库自检"
python3 build_bank.py --check || rc=1

if [ -n "$RUNJSON" ]; then
  hr "2/4 回执入库（并入 $RUNJSON）"
  python3 receipts_ingest.py "$RUNJSON" || rc=1
else
  hr "2/4 回执入库（仅用已有分片回执）"
  first=$(ls receipts/S*.jsonl 2>/dev/null | head -1)
  if [ -n "$first" ]; then
    python3 receipts_ingest.py "$first" || rc=1
  else
    echo "receipts/S*.jsonl 不存在 —— 跳过入库"
  fi
fi

hr "3/4 计分"
python3 score_t3.py || rc=1

hr "4/4 端到端断言（TARGET=$TARGET）"
TARGET="$TARGET" bash verify_t3.sh || rc=1

hr "完成"
if [ "$rc" -eq 0 ]; then
  echo "VERDICT: PASS（题库/回执/计分/断言全过）"
else
  echo "VERDICT: FAIL（有段落未过，见上）"
fi
echo "产物：bank/index.json  receipts/all.jsonl  out/score.json  out/T3_回归报告.md"
exit "$rc"
