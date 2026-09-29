#!/usr/bin/env bash
# 无限五代 v0.39.0 内核拆分回归验证（离线、确定性、无需 API Key）
#
# 用法：bash scripts/verify_kernel_v039.sh
# 判据（全部必须成立，任一失败即 exit 1）：
#   ① 常驻内核 UTF-8 字节 ≤ 17000（v0.38.6 实测 17538 → 唯一失败项）
#   ② 惰性单元数 = 11，且每段惰性正文都是原文的连续片段、常驻内核无残留
#   ③ 重拆幂等：连续两次 --from-core --unlock 后 core+lazy 的联合哈希不变
#   ④ 主校验件 verify_prompt_gen5.mjs 全绿（0 失败）
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
fail=0
say() { printf '%s\n' "$*"; }
bad() { fail=1; say "❌ $*"; }

say "== ① 体积 =="
before=17538
bytes=$(wc -c < prompts/infinite-gen-5.md)
chars=$(wc -m < prompts/infinite-gen-5.md)
say "常驻内核：${chars} 字符 / ${bytes} B（v0.38.6 基线 ${before} B，预算 17000 B）"
[ "$bytes" -le 17000 ] || bad "常驻内核超过 17000 B"
say "净减：$(( before - bytes )) B"

say "== ② 惰性单元与覆盖 =="
node scripts/kernel-lazy-split.mjs --from-core --dry | tee /tmp/kernel-v039-dry.txt | tail -4
grep -q "覆盖校验" /tmp/kernel-v039-dry.txt || bad "覆盖校验未通过"
units=$(grep -c '^@@unit:' prompts/infinite-gen-5-lazy.md)
ends=$(grep -c '^@@end:' prompts/infinite-gen-5-lazy.md)
say "单元：${units} 个（@@end ${ends} 个）"
[ "$units" = "11" ] && [ "$ends" = "11" ] || bad "惰性单元数不是 11"

say "== ③ 重拆幂等 =="
h1=$(sha256sum prompts/infinite-gen-5.md prompts/infinite-gen-5-lazy.md | sha256sum | cut -c1-16)
node scripts/kernel-lazy-split.mjs --from-core --unlock >/dev/null 2>&1
h2=$(sha256sum prompts/infinite-gen-5.md prompts/infinite-gen-5-lazy.md | sha256sum | cut -c1-16)
say "run1=${h1} run2=${h2}"
[ "$h1" = "$h2" ] || bad "重拆不幂等（core 或 lazy 每次都在变）"

say "== ④ 主校验件 =="
node scripts/verify_prompt_gen5.mjs | tail -2
node scripts/verify_prompt_gen5.mjs | grep -q "0 失败" || bad "verify_prompt_gen5.mjs 有失败项"

if [ "$fail" = "0" ]; then
  say "VERIFY OK: v0.39.0 内核拆分（常驻 ${bytes} B ≤ 17000 · 11 单元 · 幂等 · 主校验全绿）"
else
  say "VERIFY FAILED"
fi
exit "$fail"
