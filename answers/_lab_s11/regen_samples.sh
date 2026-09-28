#!/usr/bin/env bash
# regen_samples.sh — 重生成 T08-04 两份分支样板（与 stopgate MANIFEST 中登记的命令逐字一致）
# 说明：sd = _lab_s11 目录（本脚本所在目录）
sd="$(cd "$(dirname "$0")" && pwd)"
set -e
# --- E2: 生物研究分支样板 ---
python3 "$sd/domain_router.py" --branch bio --emit-file "$sd/_out_bio.md" \
  --param QUESTION="GENE_A 敲低对表达量的影响" \
  --param H1="GENE_A 敲低后 48h 相对表达量下降 >=70%" \
  --param H0="敲低与对照相对表达量无差异" \
  --param ASSAY="SYBR-Green 两步法 RT-qPCR" \
  --param MEASUREMENT="2^-ddCt 相对表达量" \
  --param UNIT="fold-change vs GAPDH" \
  --param THRESHOLD="<=0.30 fold-change 且 p<0.01" \
  --param SERIAL="SERIAL_A017" --param DONOR="DONOR_H1" \
  --param ARM_A="siRNA-GENE_A 20nM" --param ARM_B="siRNA-GENE_A 50nM" \
  --param N="6" --param IV="siRNA 剂量" --param IV_LEVELS="0nM|20nM|50nM" \
  --param POS_CTRL="GAPDH-siRNA" --param CONFOUND="转染效率" \
  --param TEST="单因素 ANOVA + Dunnett 事后检验" --param EFFECT="0.9" \
  --param ITER1="复核 Ct 值离群点（SD>0.5 复孔重做）" \
  --param ITER2="若效应量不足则加设 80nM 剂量臂，n 升至 8"
# --- E3: Codex/提示词分支样板 ---
python3 "$sd/domain_router.py" --branch codex --emit-file "$sd/_out_codex.md" \
  --param PROMPT_ID="PROMPT_T0804" --param GOAL="生成并核实 T08-04 三分支交付骨架" \
  --param INPUTS="请求原文 + 分支字段表" --param OUT_DIR="$sd"
