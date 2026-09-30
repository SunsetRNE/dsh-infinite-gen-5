#!/usr/bin/env bash
# verify-build-contract.sh — 构建与版本契约九条判据（对某个工程跑）
#
# 用法:
#   bash scripts/verify-build-contract.sh --selftest      # 静态档：只查本脚本与必备文件
#   bash scripts/verify-build-contract.sh [<项目根>]      # 全量档：默认当前目录
set -uo pipefail
MODE="${1:-}"
PASS=0; FAIL=0; WARN=0; SKIP=0
ok()   { PASS=$((PASS+1)); printf '  [ OK ]   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  [FAIL]   %s\n' "$1"; }
warn() { WARN=$((WARN+1)); printf '  [WARN]   %s\n' "$1"; }
skip() { SKIP=$((SKIP+1)); printf '  [SKIP]   %s\n' "$1"; }
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

have() { command -v "$1" >/dev/null 2>&1; }

if [ "$MODE" = "--selftest" ]; then
  bash -n "$SELF/verify-build-contract.sh" 2>/dev/null && ok "自身语法" || bad "自身语法"
  for f in SKILL.md references/build-lessons.md references/version-ask.md; do
    [ -f "$SELF/../$f" ] && ok "必备文件 $f" || bad "缺必备文件 $f"
  done
  grep -q '版本号串先问用户' "$SELF/../SKILL.md" && ok "SKILL.md 含「版本号串先问用户」强制条款" || bad "SKILL.md 缺强制条款"
  printf '回执（静态档）：已知 %d · 警告 %d · 跳过 %d · 失败 %d\n' "$PASS" "$WARN" "$SKIP" "$FAIL"
  [ "$FAIL" -eq 0 ] || exit 1
  exit 0
fi

ROOT="$(cd "${MODE:-$PWD}" && pwd)"
echo "工程根：$ROOT"
echo

# 1 产物重命名走新 API
if grep -rq 'VariantOutputImpl' "$ROOT" --include='*.kts' 2>/dev/null; then ok "1 产物重命名走变体 API（VariantOutputImpl 在场）"
elif grep -rq 'androidComponents' "$ROOT" --include='*.kts' 2>/dev/null; then warn "1 有 androidComponents 但未见 VariantOutputImpl（可能用别的方式命名产物）"
else skip "1 未找到产物重命名代码"; fi
if grep -rq 'applicationVariants' "$ROOT" --include='*.kts' 2>/dev/null; then bad "1 仍在使用 applicationVariants（AGP 9 已移除相关用法）"; fi

# 2 版本真源唯一：小文件只留键值行
vf="$(find "$ROOT" -maxdepth 2 -name 'version.properties' 2>/dev/null | head -1)"
if [ -n "$vf" ]; then
  kv="$(grep -cE '^[A-Za-z]+=' "$vf" 2>/dev/null || echo 0)"
  [ "$kv" -ge 2 ] && ok "2 版本真源在位（$kv 行键值）" || bad "2 版本真源里键值行少于 2"
else skip "2 未见 version.properties（可能用别的真源）"; fi

# 3 AGP9 内置 Kotlin：library 模块不该 apply kotlin.android
if grep -rn 'kotlin.android' "$ROOT" --include='*.kts' --include='*.toml' 2>/dev/null | grep -v 'plugin.compose' | grep -q .; then
  warn "3 仍有 kotlin.android 引用 —— 若目标是 AGP 9+，library 模块应移除（Compose 模块例外）"
else ok "3 未见多余的 kotlin.android 引用"; fi

# 4 注释里出现 /* 会吞代码
hits="$(grep -rn '/\*' "$ROOT" --include='*.kt' 2>/dev/null | grep -vE '^\s*[^:]+:[0-9]+:\s*/\*' | grep -vE '^\s*[^:]+:[0-9]+:\s+\*' | wc -l)"
if [ "$hits" -gt 0 ]; then warn "4 有 $hits 处 .kt 注释里含 /* （嵌套注释会吞掉后面代码）"; else ok "4 未见注释内的 /*"; fi

# 5 UTF-8 locale
enc="$(locale 2>/dev/null | grep -E '^(LC_ALL|LANG)=' | head -1 | cut -d= -f2)"
case "${enc:-}" in *UTF-8*|*utf8*) ok "5 locale 是 UTF-8（$enc）";; *) bad "5 locale 非 UTF-8（${enc:-未设置}）—— 中文标识符/中文用例名会编译失败";; esac

# 6 JNI 与 .so 同步
if grep -rq 'external fun\|native ' "$ROOT" --include='*.kt' 2>/dev/null; then
  so="$(find "$ROOT" -name '*.so' 2>/dev/null | head -1)"
  if [ -z "$so" ]; then skip "6 有 native 声明但未见 .so（可能由 CI 产出，不入库）"
  elif have nm && nm -D "$so" 2>/dev/null | grep -q 'Java_'; then ok "6 .so 含 JNI 导出符号（可用 nm 对比签名）"
  else warn "6 .so 在场但 nm 没读到 JNI 符号（无 nm 或符号被剥离）"; fi
else skip "6 未见 native 声明"; fi

# 7 配置阶段不起外部进程
if grep -rn 'exec(\|ProcessBuilder\|Runtime.getRuntime' "$ROOT" --include='*.kts' 2>/dev/null | grep -q .; then
  bad "7 构建脚本里出现外部进程调用 —— 配置缓存开着时会打挂"
else ok "7 配置阶段未起外部进程"; fi

# 8 环境脚本三分与零副作用
judge="$(find "$ROOT" -name 'env-detect*' 2>/dev/null | head -1)"
if [ -n "$judge" ]; then
  if grep -qE 'curl|wget|>>?\s' "$judge"; then bad "8 判定脚本有副作用（下载/写文件）"; else ok "8 判定脚本零副作用"; fi
else skip "8 未见 env-detect* 判定脚本"; fi

# 9 禁止运行时装镜像测速
if grep -rn -- '--range' "$ROOT" --include='*.sh' 2>/dev/null | grep -q .; then
  bad "9 环境脚本里有分段测速（--range）—— 选路不确定会破坏可复现性"
elif grep -rn 'ping ' "$ROOT" --include='*.sh' 2>/dev/null | grep -qi 'select\|mirror'; then
  warn "9 脚本里用 ping 做镜像选路（ping 通 ≠ HTTP 能下）"
else ok "9 未见镜像测速/ping 选路"; fi

# 附：文档考古 —— 引用了不存在的文档
missing=0
for rel in $(grep -rhoE 'docs/[A-Za-z0-9._/-]+\.md' "$ROOT" 2>/dev/null | sort -u | head -40); do
  [ -f "$ROOT/$rel" ] || missing=$((missing+1))
done
if [ "$missing" -eq 0 ]; then ok "附 文档引用都可解析"; else warn "附 有 $missing 处引用的 docs/*.md 不存在（引用已删文档）"; fi

echo
printf '回执：已知 %d · 警告 %d · 跳过 %d · 失败 %d\n' "$PASS" "$WARN" "$SKIP" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
