#!/usr/bin/env bash
# push_flow.sh — ig5-t3 回归推送流程（建仓 → 提交 → 推远端 → 校验）
# 用法:
#   bash push_flow.sh                       # 默认：本地裸仓库当远端（可回滚，真 push）
#   REMOTE_URL=git@github.com:USER/REPO.git bash push_flow.sh
#   bash push_flow.sh --dry-run             # 只跑回归 + 预演，不建远端、不推送
#   bash push_flow.sh --no-regress          # 跳过 run_all.sh（只推已有产物）
#   bash push_flow.sh --verify-only         # 只做推送后校验
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BARE="$ROOT/out/remote/ig5-t3.git"
BRANCH="${BRANCH:-main}"
DRY=0; REGRESS=1; VERIFY_ONLY=0; FORCE=0
for a in "$@"; do case "$a" in
  --dry-run) DRY=1 ;;
  --no-regress) REGRESS=0 ;;
  --verify-only) VERIFY_ONLY=1 ;;
  --force) FORCE=1 ;;
  -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
  *) echo "未知参数: $a" >&2; exit 2 ;;
esac; done

step(){ printf '\n=== %s ===\n' "$1"; }
ok(){ printf '  [ok] %s\n' "$1"; }
bad(){ printf '  [FAIL] %s\n' "$1"; FAILED=$((FAILED+1)); }
FAILED=0

# ---------- 0. 前置事实 ----------
step "0 环境事实"
command -v git >/dev/null || { bad "git 不存在"; exit 3; }
GITV="$(git --version)"; echo "  $GITV"
echo "  ROOT=$ROOT"
REMOTE_URL="${REMOTE_URL:-$BARE}"
echo "  REMOTE_URL=$REMOTE_URL"
[ -f "$ROOT/out/score.json" ] && ok "out/score.json 存在" || bad "out/score.json 缺失"

# ---------- 1. 回归 ----------
if [ "$REGRESS" = 1 ] && [ "$VERIFY_ONLY" = 0 ]; then
  step "1 回归全链（run_all.sh）"
  if bash "$ROOT/run_all.sh" >/tmp/ig5-t3-runall.log 2>&1; then
    ok "run_all.sh 退出码 0"
    grep -E 'RATE|VERDICT|rate' /tmp/ig5-t3-runall.log | tail -6 | sed 's/^/  /'
  else
    bad "run_all.sh 非 0 退出（详见 /tmp/ig5-t3-runall.log）"
    tail -12 /tmp/ig5-t3-runall.log | sed 's/^/  /'
  fi
fi

# ---------- 2. 本地仓库 ----------
if [ "$VERIFY_ONLY" = 0 ]; then
  step "2 建仓与提交"
  cd "$ROOT" || exit 3
  cat > .gitignore <<'IGN'
__pycache__/
*.pyc
out/remote/
out/dist/*.tar.gz
out/run_full.json
*.log
IGN
  ok ".gitignore 写入（排除 __pycache__ / out/remote / *.log）"
  [ -d .git ] || { git init -q -b "$BRANCH" . && ok "git init -b $BRANCH"; }
  git config user.name  >/dev/null || git config user.name  "SunsetRNE"
  git config user.email >/dev/null || git config user.email "z100o190zgxc@163.com"
  git add -A
  TRACKED="$(git diff --cached --name-only | wc -l | tr -d ' ')"
  MSG="ig5-t3: 46 题回归包（rate $(python3 -c 'import json;print(json.load(open("out/score.json"))["rate"])' 2>/dev/null || echo NA) / 46-46 覆盖）"
  if [ "$TRACKED" != "0" ]; then
    git commit -q -m "$MSG" && ok "提交 $TRACKED 个文件：$MSG"
  else
    ok "无待提交改动（幂等）"
  fi
  git log --oneline -1 | sed 's/^/  /'
fi

# ---------- 3. 远端与推送 ----------
if [ "$VERIFY_ONLY" = 0 ]; then
  step "3 远端与推送"
  cd "$ROOT" || exit 3
  if [ "$DRY" = 1 ]; then
    echo "  [dry-run] 远端解析=$REMOTE_URL；将执行 git push -u origin $BRANCH"
    git remote -v | sed 's/^/  /'
  else
    case "$REMOTE_URL" in
      /*|./*|../*)
        [ -d "$REMOTE_URL" ] || { mkdir -p "$(dirname "$REMOTE_URL")"; git init -q --bare "$REMOTE_URL" && ok "裸远端已建：$REMOTE_URL"; }
        ;;
    esac
    if git remote get-url origin >/dev/null 2>&1; then
      git remote set-url origin "$REMOTE_URL"; ok "origin 已指向 $REMOTE_URL"
    else
      git remote add origin "$REMOTE_URL"; ok "origin 新增 $REMOTE_URL"
    fi
    PUSHFLAGS="-u"; [ "$FORCE" = 1 ] && PUSHFLAGS="-u --force"
    if git push $PUSHFLAGS origin "$BRANCH" 2>&1 | sed 's/^/  /'; then
      ok "git push 完成"
    else
      bad "git push 失败（凭据 / 权限 / 网络；REMOTE_URL=$REMOTE_URL）"
    fi
  fi
fi

# ---------- 4. 推送后校验 ----------
step "4 推送后校验"
cd "$ROOT" || exit 3
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null)"
echo "  本地 HEAD=$HEAD_SHA"
if LSR="$(git ls-remote origin "$BRANCH" 2>/dev/null)"; then
  REM_SHA="$(printf '%s' "$LSR" | awk '{print $1}')"
  echo "  远端 $BRANCH=$REM_SHA"
  if [ -n "$REM_SHA" ] && [ "$REM_SHA" = "$HEAD_SHA" ]; then ok "远端 sha == 本地 HEAD"; else bad "远端 sha 与本地不一致"; fi
else
  bad "ls-remote 失败"
fi
if [ -d "$BARE" ]; then
  echo "  裸仓库 $BRANCH=$(git -C "$BARE" rev-parse "$BRANCH" 2>/dev/null)"
  echo "  裸仓库文件数=$(git -C "$BARE" ls-tree -r --name-only "$BRANCH" 2>/dev/null | wc -l | tr -d ' ')"
fi
LOCAL_FILES="$(git ls-tree -r --name-only HEAD | wc -l | tr -d ' ')"
echo "  本地被跟踪文件数=$LOCAL_FILES"
[ -f "$ROOT/receipts/all.jsonl" ] && ok "receipts/all.jsonl 行数=$(wc -l < "$ROOT/receipts/all.jsonl" | tr -d ' ')" || bad "receipts/all.jsonl 缺失"

echo
if [ "$FAILED" = 0 ]; then echo "VERDICT: PASS（推送与校验全段通过）"; exit 0
else echo "VERDICT: FAIL（$FAILED 段未过）"; exit 1; fi
