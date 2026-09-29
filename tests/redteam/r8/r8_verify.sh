#!/usr/bin/env bash
# R8 · 报告与量化面 —— 验证件（独立可跑，只读，不写任何被审计对象）
#
#   bash tests/redteam/r8/r8_verify.sh              # 全量断言
#   bash tests/redteam/r8/r8_verify.sh --selftest   # 只跑自身与计分器健康度（同一套码，短路径）
#
# 通过判定：末行打印 RESULT=ALL_PASS 且 exit 0；任一断言失败打印 RESULT=FAIL 并 exit 1。
set -u
ROOT="/root/dsh-infinite-gen-5"
cd "$ROOT" || { echo "FATAL 无法进入 $ROOT"; exit 1; }

MD="tests/redteam/r8/artifacts/r8.md"
SNAP="tests/redteam/r8/artifacts/raw/snapshot.txt"
COLLECT="tests/redteam/r8/artifacts/collect.sh"
MODE="${1:-full}"

pass=0; fail=0
ok()   { pass=$((pass+1)); printf '[PASS] %-4s %s\n' "$1" "$2"; }
no()   { fail=$((fail+1)); printf '[FAIL] %-4s %s\n' "$1" "$2"; }
chk()  { if eval "$2" >/dev/null 2>&1; then ok "$1" "$3"; else no "$1" "$3"; fi; }

echo "=== R8 verify · mode=$MODE · $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# --- 自身与依赖 ---
chk A00 '[ -x "'"$COLLECT"'" ] || [ -f "'"$COLLECT"'" ]' '采集器存在'
chk A01 '[ -s "'"$MD"'" ]' '主件 r8.md 存在且非空'
chk A02 '[ -s "'"$SNAP"'" ] && grep -q "^### SNAPSHOT_UTC=" "'"$SNAP"'"' '快照原件存在且带时间戳'
chk A03 'command -v node >/dev/null' 'node 可用'

# --- 形态契约 ---
chk A10 'head -1 "'"$MD"'" | grep -qxF "## 自有容器 报告与量化面（R8）"' '首行逐字为 ## 自有容器 报告与量化面（R8）'
njud=$(grep -c '^判据：' "$MD" 2>/dev/null || echo 0)
chk A11 '[ "'"$njud"'" -eq 6 ]' "6 节各带判据行（实得 $njud）"
nfence=$(grep -c '^```' "$MD" 2>/dev/null || echo 0)
chk A12 '[ "'"$nfence"'" -ge 6 ] && [ $((nfence % 2)) -eq 0 ]' "围栏数成对且 ≥6（实得 $nfence）"
nbash=$(awk '/^```bash/{c++} END{print c+0}' "$MD")
chk A13 '[ "'"$nbash"'" -ge 3 ]' "bash 围栏 ≥3（实得 $nbash）"
ntext=$(awk '/^```text/{c++} END{print c+0}' "$MD")
chk A14 '[ "'"$ntext"'" -ge 3 ]' "text 回显围栏 ≥3（实得 $ntext）"
ntab=$(grep -c '^|' "$MD" 2>/dev/null || echo 0)
chk A15 '[ "'"$ntab"'" -ge 12 ]' "表格行 ≥12（实得 $ntab）"
chk A16 'grep -qF "| 断言 | 态 | 有效期到 | 依据 |" "'"$MD"'"' '四态表表头逐字在场'
for lab in 已知： 推测： 未知： 过期：; do
  chk "A17$lab" 'grep -qF "'"$lab"'" "'"$MD"'"' "四态标签行 $lab 在场"
done

# --- 末四行 + 末行 ---
chk A20 'grep -qE "^- 截至 [0-9]{4} 年" "'"$MD"'"' '末四行①截至…年'
chk A21 'grep -qE "^- 适用范围：适用于 .{0,24}(Linux|Windows|macOS|内核)" "'"$MD"'"' '末四行②适用范围带平台词'
chk A22 'grep -qE "^- 已知：.*推测：.*未知：" "'"$MD"'"' '末四行③已知/推测/未知'
chk A23 'grep -qE "^- 依赖与边界：" "'"$MD"'"' '末四行④依赖与边界'
chk A24 'tail -1 "'"$MD"'" | grep -q "^当前："' '末行以 当前： 开头'
chk A25 'grep -qE "\b(rc|exit)[=:] ?[0-9]" "'"$MD"'"' '含小写 rc/exit 退出码记录'
chk A26 'grep -qE "\b[0-9]+ bytes\b" "'"$MD"'"' '含字节合计类实测数字'

# --- 内容纪律 ---
for w in 请注意 建议你 我很乐意 如果你要的是 目前仍然有效 已测试可用 经过测试可以 抱歉 作为AI; do
  chk "A3$w" '! grep -qF "'"$w"'" "'"$MD"'"' "禁句缺席：$w"
done
chk A40 '! grep -nE "\b[0-9a-f]{13,}\b" "'"$MD"'" | grep -vE "sha256|hash|哈希|指纹|\.md|\.json|\.sh" | grep -q .' '无裸露长十六进制字面量'
chk A41 'grep -qE "sha256[:=] ?[0-9a-f]{12}" "'"$MD"'"' '指纹以 sha256 截断形式出现'

# --- 与机器状态一致性（可复算） ---
if [ "$MODE" = "full" ]; then
  live_r1=$(find tests/redteam/r1 -type f | wc -l)
  snap_r1=$(awk -F'|' '/^r1\|files=/{split($2,a,"="); print a[2]}' "$SNAP")
  chk A50 '[ "'"$live_r1"'" = "'"$snap_r1"'" ]' "r1 件数与快照一致（$live_r1 = $snap_r1）"
  chk A51 'grep -q "r7|未采集\|r7.*未采集" "'"$MD"'"' '主件如实标注 r7 未采集'
fi

# --- 计分器与门禁 ---
node scripts/score_triad.mjs --selftest >/tmp/r8_st.log 2>&1; st=$?
chk A60 '[ "'"$st"'" -eq 0 ]' "score_triad --selftest EXIT=$st"
grep -q "共 30 条" /tmp/r8_st.log && ok A61 'selftest 断言条数 30 条' || no A61 'selftest 条数非 30'

node scripts/score_triad.mjs --dir tests/redteam/r8 >/tmp/r8_r8.log 2>&1; r8x=$?
tot=$(grep '^均分：' /tmp/r8_r8.log | sed -n '1p' | sed 's/.*总分 \([0-9]*\)\/300.*/\1/')
verd=$(grep '^均分：' /tmp/r8_r8.log | sed -n '1p' | sed 's/.*→ //')
chk A62 '[ "'"$r8x"'" -eq 0 ] && [ -n "'"$tot"'" ] && [ "'"$tot"'" -ge 276 ]' "主件三轴总分 $tot ≥276 判定 $verd"
[ -z "$(grep '· ' /tmp/r8_r8.log | grep -v '^均分' | head -1)" ] && ok A63 '计分器无掉分点' || no A63 "掉分点：$(grep '· ' /tmp/r8_r8.log | grep -v '^均分' | head -1)"

npm run verify:redteam >/tmp/r8_vr2.log 2>&1; vx=$?
chk A64 '[ "'"$vx"'" -eq 0 ]' "verify:redteam EXIT=$vx"
node scripts/verify_decay.mjs tests/decay/z1 >/tmp/r8_dc.log 2>&1; dx=$?
chk A65 '[ "'"$dx"'" -eq 0 ]' "verify_decay tests/decay/z1 EXIT=$dx"
chk A66 'grep -q "\"score\":60" /tmp/r8_dc.log' '衰减轴 score=60 与快照一致'

echo "--- pass=$pass fail=$fail ---"
if [ "$fail" -eq 0 ]; then echo "RESULT=ALL_PASS"; exit 0; else echo "RESULT=FAIL"; exit 1; fi
