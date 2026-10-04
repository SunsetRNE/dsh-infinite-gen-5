#!/usr/bin/env bash
# preflight-ci.sh — 推之前本地跑一遍「CI 最容易红的那几条」判据
#
# 背景：本仓 verify 工作流在 runner 上整条链跑，红一次要等一轮 CI。以下四条是最近
# 两次真红的原样复现（版本字面量扫描 / 文档索引过期），加上两条高频兜底。
# 用法：bash tools/preflight-ci.sh        # 退出码 0 = 可以推
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
fail=0
log=/tmp/ig5-preflight.log

step() { # step <说明> <命令...>
  local desc="$1"; shift
  printf '── %s\n' "$desc"
  if "$@" >"$log" 2>&1; then tail -2 "$log" | sed 's/^/   /'; echo "   ✓ 通过"
  else tail -6 "$log" | sed 's/^/   /'; echo "   ✗ 失败（完整日志 $log）"; fail=1; fi
}

step "语法：index.js / client.js" node --check index.js
step "版本一致性（未登记字面量 / 文档越版声明）" node scripts/verify_version.mjs
step "工具注册表（生成文档是否过期）" npm run verify:tools
step "发布说明（CHANGELOG 段数 / 压缩器）" node scripts/verify_release_notes.mjs

printf '── 文档索引幂等（改了 docs/ 必跑 tools:doc）\n'
npm run tools:doc >/dev/null 2>&1
out=$(npm run tools:doc 2>&1 | tail -1)
echo "   $out"
case "$out" in
  *"过期=无"*) echo "   ✓ 文档索引已同步" ;;
  *) echo "   ✗ docs/INDEX.md 或 docs/TOOL-PROTOCOLS.md 需重生成并提交"; fail=1 ;;
esac

echo
if [ "$fail" = 0 ]; then echo "RESULT: 预检通过，可以推"; exit 0; fi
echo "RESULT: 预检失败 —— 先按上面提示修，再跑一遍"; exit 1
