#!/usr/bin/env bash
# verify-skill.sh — 本技能的「机械判据」入口（v2，2026-09-30 加）
#
# 为什么需要它：技能原来只有一堆各自为政的 verify-*.sh，跑完靠人眼看输出 —— 没有回执，
# 也就没有「这次到底过没过」的可判定结论。这个脚本把三件事钉成可判定的一条：
#   1) 静态自检（--selftest）：不依赖目标机器，验证脚本自身语法与依赖声明是否自洽；
#   2) 全量复核（默认）：逐个跑 verify-env / verify-re / verify-frida，汇总通过/失败/跳过；
#   3) 四态回执：已知(实测通过) / 未知(未采集) / 不适用(本机架构上不可用) / 过期(被新写法取代)。
#
# 用法:
#   bash scripts/verify-skill.sh --selftest     # 只做静态自检（任何机器都能跑，判据=退出码）
#   bash scripts/verify-skill.sh                # 静态 + 逐个子自检 + 汇总回执
#   bash scripts/verify-skill.sh --quick        # 子自检全部用快速档
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
MODE="${1:-full}"
QUICK=""; [ "$MODE" = "--quick" ] && QUICK="--quick"

PASS=0; FAIL=0; SKIP=0; NOCAP=0; MISSING=0
ok()     { PASS=$((PASS+1));    printf '  [ OK ]   %s\n' "$1"; }
bad()    { FAIL=$((FAIL+1));    printf '  [FAIL]   %s\n' "$1"; }
skip()   { SKIP=$((SKIP+1));    printf '  [SKIP]   %s\n' "$1"; }
nocap()  { NOCAP=$((NOCAP+1));  printf '  [NOSUP]  %s\n' "$1"; }

echo "== 静态自检（不依赖目标机器）=="
for f in scripts/*.sh install.sh; do
  [ -f "$ROOT/$f" ] || continue
  if bash -n "$ROOT/$f" 2>/dev/null; then ok "语法 $f"; else bad "语法 $f"; fi
  head -1 "$ROOT/$f" | grep -q '^#!' || bad "缺 shebang $f"
done

echo
echo "== 文件清单自洽（SKILL.md 提到的脚本都必须在场）=="
for name in verify-env verify-re verify-frida deploy_frida_server restore-dev-env; do
  grep -q "$name" "$ROOT/SKILL.md" || continue
  if [ -f "$ROOT/scripts/$name.sh" ]; then ok "SKILL.md 引用在场 $name.sh"; else bad "SKILL.md 引用缺失 $name.sh"; fi
done
[ -f "$ROOT/references/environment-matrix.md" ] && ok "环境矩阵在场" || bad "环境矩阵缺失"

if [ "$MODE" = "--selftest" ]; then
  echo
  printf '回执（静态档）：已知 %d · 失败 %d\n' "$PASS" "$FAIL"
  [ "$FAIL" -eq 0 ] || exit 1
  exit 0
fi

echo
echo "== 逐个子自检（真跑，每条都要给判据）=="
run() { # run <脚本> <判据说明>
  local script="$1" label="$2"
  if [ ! -f "$ROOT/scripts/$script" ]; then bad "$label（脚本不在场）"; return; fi
  if bash "$ROOT/scripts/$script" $QUICK >/tmp/ig5-skill-$$.log 2>&1; then
    ok "$label — $(tail -1 /tmp/ig5-skill-$$.log | cut -c1-70)"
  else
    local code=$?
    if grep -qiE 'operation not supported|not permitted|架构上不可用' /tmp/ig5-skill-$$.log; then
      nocap "$label（本机架构上不可用，非回归）"
    else
      bad "$label（退出码 $code；日志 /tmp/ig5-skill-$$.log）"
    fi
  fi
}
run verify-env.sh   "环境与工具链"
run verify-re.sh    "逆向工具链"
run verify-frida.sh "Frida 通道"

echo
echo "== 四态回执 =="
printf '已知（实测通过）: %d\n未知（未采集）: %d\n不适用（本机架构上不可用）: %d\n失败: %d\n' \
  "$PASS" "$SKIP" "$NOCAP" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
