#!/usr/bin/env bash
# emit_product.sh — 生成 T08-04 文件任务分支的真实产物（设计矩阵交付记录）
sd="$(cd "$(dirname "$0")" && pwd)"; A="$(cd "$sd/.." && pwd)"
set -e
python3 "$sd/domain_router.py" --branch file --emit-file "$A/t0804/bio-design-matrix.md" \
  --param OUT_PATH="$A/t0804/bio-design-matrix.md" \
  --param QUESTION="GENE_A 敲低验证设计矩阵（文件任务产物）"
