#!/usr/bin/env bash
# verify-release-ready.sh — 发版前五项机械判据（本仓库专用）
#
# 为什么存在：本仓库的 CI 红过四次，其中三次是同一类「生成物/计数/顺序」问题，
# 每次都要重新读 CI 日志才知道红在哪。这个脚本把那五类判据提前到本地，一条命令给回执。
#
# 用法:
#   bash scripts/verify-release-ready.sh --selftest   # 静态档：只看文件与自身语法，不跑仓库脚本
#   bash scripts/verify-release-ready.sh              # 全量档：真跑注册表/版本/计数三类检查
set -uo pipefail
MODE="${1:-full}"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SELF" rev-parse --show-toplevel 2>/dev/null)"
# 注意：不要写成 A || B && C —— 那是 (A||B)&&C，git 成功时后面的 pwd 照样会覆盖。
[ -n "$ROOT" ] || ROOT="$(cd "$SELF/../../.." && pwd)"

PASS=0; FAIL=0; WARN=0; SKIP=0
ok()   { PASS=$((PASS+1)); printf '  [ OK ]   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  [FAIL]   %s\n' "$1"; }
warn() { WARN=$((WARN+1)); printf '  [WARN]   %s\n' "$1"; }
skip() { SKIP=$((SKIP+1)); printf '  [SKIP]   %s\n' "$1"; }

# 中文路径下仓库脚本会静默空转（import.meta.url 守卫），这里统一用百分号编码的 argv 技巧。
# 用法: run_node <仓库内相对路径.mjs> [参数...]
run_node() {
  local rel="$1"; shift
  local abs="$ROOT/$rel"
  [ -f "$abs" ] || { echo "MISSING $rel"; return 127; }
  if LC_ALL=C printf '%s' "$abs" | grep -q '[^ -~]'; then
    local enc args
    enc="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$abs")"
    args="$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1:]))' "$@")"
    IG5_ENC="$enc" IG5_ARGS="$args" node -e '
      process.argv[1] = process.env.IG5_ENC;
      for (const a of JSON.parse(process.env.IG5_ARGS || "[]")) process.argv.push(a);
      import("file://" + process.env.IG5_ENC).catch((e) => { console.error(e.message); process.exit(1); });'
  else
    node "$abs" "$@"
  fi
}

echo "仓库根：$ROOT"
echo
echo "== 五项判据 =="

# ① 必备脚本在场（缺一个就别谈发版）
for rel in scripts/bump-version.mjs scripts/gen_tool_docs.mjs scripts/verify_tool_registry.mjs \
           scripts/verify_version.mjs scripts/verify_ui.mjs scripts/verify_dedupe.mjs scripts/changelog.mjs; do
  if [ -f "$ROOT/$rel" ]; then ok "必备脚本在场 $rel"; else bad "缺必备脚本 $rel"; fi
done

# ② 中文路径守卫：会静默空转的路径必须显式提示
if LC_ALL=C printf '%s' "$ROOT" | grep -q '[^ -~]'; then
  warn "仓库根含非 ASCII 字符 —— 凡用 import.meta.url===file://\${argv[1]} 判定的脚本会静默空转；本脚本已自动改用 argv 编码技巧"
else
  ok "仓库根是 ASCII 路径（生成器守卫可正常工作）"
fi

# ③ docs/INDEX.md 内嵌 UPDATE.md 首行 —— 顺序反了必然 CI 红
# 注意：INDEX 内嵌的是 UPDATE.md **正文首行**（跳过 `## vX.Y.Z` 标题），不是标题行 ——
# 早先按标题行取，结果每次都报「内容过期」，而 CI 的 verify:tools 是绿的（工具自己在骗人）。
# 两侧都先做同样的归一化：去 Markdown 强调符（*）、去首尾空白，再截前 24 字比较。
norm() { sed 's/\*//g; s/^[[:space:]]*//; s/[[:space:]]*$//' | cut -c1-24; }
update_line="$(awk 'NF && $0 !~ /^#/ {print; exit}' "$ROOT/UPDATE.md" 2>/dev/null | norm)"
index_line="$(grep -m1 'UPDATE.md' "$ROOT/docs/INDEX.md" 2>/dev/null | sed 's/^.*| //' | norm)"
if [ -z "$update_line" ]; then skip "UPDATE.md 不在场，跳过内嵌首行比对"
elif [ "$update_line" = "$index_line" ]; then ok "docs/INDEX.md 内嵌的就是 UPDATE.md 当前首行（$update_line…）"
else bad "docs/INDEX.md 内容过期：期望「$update_line…」实为「$index_line…」→ 先改 UPDATE/VERSIONS 再跑 tools:doc"; fi

# ④ 钩子计数：verify_dedupe 会把注释里的字面量一起数
hooks_src="$(grep -c 'useProjection(' "$ROOT/client.js" 2>/dev/null || echo 0)"
hooks_expect="$(grep -oE 'hooks === [0-9]+' "$ROOT/scripts/verify_dedupe.mjs" 2>/dev/null | grep -oE '[0-9]+' | head -1)"
if [ -z "$hooks_expect" ]; then skip "verify_dedupe 里没找到钩子不变量"
elif [ "$hooks_src" = "$hooks_expect" ]; then ok "client.js 的 useProjection 计数与不变量一致（$hooks_src）"
else bad "钩子计数不符：client.js 实际 $hooks_src，不变量要求 $hooks_expect（注意注释里的字面量也会被数进去）"; fi

# ⑤ 技能层编号唯一
dups="$(ls -d "$ROOT"/skills/ig5-layer-* 2>/dev/null | sed 's#.*/ig5-layer-##; s#-.*##' | sort | uniq -d | tr '\n' ' ')"
if [ -z "$dups" ]; then ok "技能层编号无重复"
else warn "技能层编号重复：$dups（当前按目录名字典序装载，语义优先不保证；新增层请取未占用编号）"; fi

if [ "$MODE" = "--selftest" ]; then
  echo
  printf '回执（静态档）：已知 %d · 警告 %d · 跳过 %d · 失败 %d\n' "$PASS" "$WARN" "$SKIP" "$FAIL"
  [ "$FAIL" -eq 0 ] || exit 1
  exit 0
fi

echo
echo "== 真跑三类（会调仓库脚本，可能十几秒）=="
if run_node scripts/verify_tool_registry.mjs --selftest >/tmp/ig5-rel-tools.$$ 2>&1; then
  ok "工具注册表自洽 — $(tail -1 /tmp/ig5-rel-tools.$$ | cut -c1-60)"
else bad "工具注册表自洽失败（详见 /tmp/ig5-rel-tools.$$）"; fi
if run_node scripts/verify_version.mjs >/tmp/ig5-rel-ver.$$ 2>&1; then
  ok "版本一致性 — $(grep -m1 '当前版本' /tmp/ig5-rel-ver.$$ | cut -c1-60)"
else bad "版本一致性失败（详见 /tmp/ig5-rel-ver.$$）"; fi
if node "$ROOT/scripts/verify_ui.mjs" >/tmp/ig5-rel-ui.$$ 2>&1; then
  ok "客户端自检 — $(grep -m1 '通过' /tmp/ig5-rel-ui.$$ | cut -c1-60)"
else bad "客户端自检失败（详见 /tmp/ig5-rel-ui.$$）"; fi

echo
printf '回执：已知 %d · 警告 %d · 跳过 %d · 失败 %d\n' "$PASS" "$WARN" "$SKIP" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
