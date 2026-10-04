#!/usr/bin/env bash
# ig5-push-release.sh — 发版推送（凭据只从环境变量取，绝不落盘、绝不回显）
# 用法:
#   GH_TOKEN=ghp_xxx bash tools/ig5-push-release.sh v0.65.14
#   （或先 git config --local credential.helper store 并在 ~/.git-credentials 写入一行）
# 判据: 退出码 0 = main 与 tag 都推上去了；非 0 = 未推送（打印原因）
set -uo pipefail
TAG="${1:?用法: GH_TOKEN=... bash tools/ig5-push-release.sh <tag>}"
cd "$(dirname "$0")/.." || exit 2

echo "== 前置 =="
echo "HEAD: $(git rev-parse --short HEAD)   远端 tag: $TAG   工作区: $(git status --porcelain | wc -l) 个改动"
git tag -l "$TAG" | grep -q . || { echo "本地无 tag $TAG —— 先 git tag -a $TAG -m '无限五代 $TAG'"; exit 2; }

# 凭据：只用环境变量，构造一次性 askpass，用完即删（不进 git config、不进日志）
ASKPASS=""
if [ -n "${GH_TOKEN:-}" ]; then
  ASKPASS="$(mktemp)"; chmod 700 "$ASKPASS"
  printf '#!/bin/sh\ncase "$1" in *Username*) echo x-access-token;; *) echo "$GH_TOKEN";; esac\n' > "$ASKPASS"
  export GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0
  echo "凭据: 从 GH_TOKEN 注入（不回显、不落盘）"
elif git config --get credential.helper >/dev/null 2>&1; then
  echo "凭据: 走 credential.helper $(git config --get credential.helper)"
else
  echo "凭据: 无 —— 请设 GH_TOKEN，或先配置 credential.helper"
  exit 2
fi
trap '[ -n "$ASKPASS" ] && rm -f "$ASKPASS"' EXIT

echo
echo "== 推送 main =="
timeout 300 git push origin HEAD:main 2>&1 | tail -3; m=${PIPESTATUS[0]}
echo "== 推送 tag =="
timeout 300 git push origin "$TAG" 2>&1 | tail -3; t=${PIPESTATUS[0]}

echo
echo "main exit=$m   tag exit=$t"
if [ "$m" = 0 ] && [ "$t" = 0 ]; then
  echo "RESULT: 已推送 —— 可继续 node scripts/release.mjs --yes --release-only --release（补 GitHub Release）"
  exit 0
else
  echo "RESULT: 未完整推送（检查 token 权限：需 repo / contents:write）"
  exit 1
fi
