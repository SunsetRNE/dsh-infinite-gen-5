#!/usr/bin/env bash
# regen_manifest.sh — 从零重建 T08-05 的停笔声明清单 manifest_T0805.json
# 语义：每条 entry = 一个产物 + 能重新产出它的命令；declare 只接受已存在的产物。
# 登记顺序 = 复现顺序（上游先跑，下游后跑）：E1 产物 → E2 样板 → E3 证据 → E4 答案装配。
sd="$(cd "$(dirname "$0")" && pwd)"
A="$(cd "$sd/.." && pwd)"           # answers/
M="$sd/manifest_T0805.json"
G="$sd/stopgate.py"
set -e
rm -f "$M"
bash "$sd/emit_product.sh"                       # 先产出，再声明（declare 拒绝不存在的产物）
bash "$sd/regen_samples.sh"
bash "$sd/regen_verify.sh"
( cd "$sd" && python3 assemble.py _tpl_T0804.md "$A/T08-04.md" >/dev/null )
python3 "$G" declare "$M" \
  --id E1-file-product \
  --cmd "bash $sd/emit_product.sh" \
  --path "$A/t0804/bio-design-matrix.md"
python3 "$G" declare "$M" \
  --id E2-branch-samples \
  --cmd "bash $sd/regen_samples.sh" \
  --path "$sd/_out_bio.md" --path "$sd/_out_codex.md"
python3 "$G" declare "$M" \
  --id E3-evidence-files \
  --cmd "bash $sd/regen_verify.sh" \
  --path "$sd/_digests.txt" --path "$sd/_out_verify.md"
python3 "$G" declare "$M" \
  --id E4-answer-t0804 \
  --cmd "cd $sd && python3 assemble.py _tpl_T0804.md $A/T08-04.md" \
  --path "$A/T08-04.md"
echo "MANIFEST-BUILT $M entries=$(python3 -c "import json,sys;print(len(json.load(open(sys.argv[1]))['entries']))" "$M")"
