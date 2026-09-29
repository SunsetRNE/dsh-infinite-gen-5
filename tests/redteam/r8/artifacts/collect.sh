#!/usr/bin/env bash
# R8 · 报告与量化面 —— 单次原子快照采集器（只读被审计对象，不写 r1..r7）
# 用法：bash tests/redteam/r8/artifacts/collect.sh           # 打到 stdout
#       bash tests/redteam/r8/artifacts/collect.sh > out.txt # 留档
# 说明：兄弟区仍在并发落盘，所以本脚本一次遍历成文，不跨调用拼接读数。
set -u
ROOT="/root/dsh-infinite-gen-5"
cd "$ROOT" || { echo "FATAL 无法进入 $ROOT"; exit 1; }

echo "### SNAPSHOT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "### node=$(node --version) npm=$(npm --version)"

echo "### A. 产物清单（路径|字节|sha256前12）"
for r in r1 r2 r3 r4 r5 r6 r7 r8; do
  d="tests/redteam/$r"
  [ -d "$d" ] || { echo "MISSING_DIR|$d"; continue; }
  find "$d" -type f -printf '%p\n' | LC_ALL=C sort | while IFS= read -r f; do
    printf '%s|%s|%s\n' "$f" "$(stat -c%s "$f")" "$(sha256sum "$f" | cut -c1-12)"
  done
done

echo "### B. 每区件数 / 字节合计"
for r in r1 r2 r3 r4 r5 r6 r7 r8; do
  d="tests/redteam/$r"
  if [ -d "$d" ]; then
    printf '%s|files=%s|bytes=%s\n' "$r" \
      "$(find "$d" -type f | wc -l)" \
      "$(find "$d" -type f -printf '%s\n' | awk '{s+=$1} END{print s+0}')"
  else
    printf '%s|MISSING\n' "$r"
  fi
done

echo "### C. 台账 findings.json 计数"
node -e '
const fs=require("fs");
for(const d of ["r1","r2","r3","r4","r5","r6","r7","r8"]){
  const p=`tests/redteam/${d}/findings.json`;
  if(!fs.existsSync(p)){ console.log(`${d}|NO_FINDINGS`); continue; }
  const j=JSON.parse(fs.readFileSync(p,"utf8"));
  const n=v=>Array.isArray(v)?v.length:0;
  const sev={};
  for(const k of Object.keys(j)) if(Array.isArray(j[k]))
    for(const it of j[k]) if(it&&typeof it==="object"&&it.severity) sev[it.severity]=(sev[it.severity]||0)+1;
  console.log(`${d}|chains=${n(j.chain)}|iocs=${n(j.iocs)}|risks=${n(j.risks)}|sev=${JSON.stringify(sev)}`);
}'

echo "### D. 三轴（每区一行）"
for r in r1 r2 r3 r4 r5 r6 r7 r8; do
  out=$(node scripts/score_triad.mjs --dir "tests/redteam/$r" 2>&1 | grep '^均分：' | head -1)
  printf '%s|%s\n' "$r" "${out:-未采集}"
done
