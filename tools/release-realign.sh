#!/usr/bin/env bash
# release-realign.sh — 把一个已发布的 tag 接到新的提交上，并让 Release 资产跟着重建
#
# 背景（本脚本就是为这个场景写的）：
#   tag 打完后又产生了非发布件提交（如核验脚本），tag 落后 HEAD 一个提交 ⇒ 发布包与树不一致。
#   修法：删旧 Release → 删远端 tag → 本地重打到目标提交 → 重推 tag 触发 release 工作流重建资产。
#
# 用法:
#   GH_TOKEN=<PAT> bash tools/release-realign.sh vX.Y.Z [--to=<commit|HEAD>] [--repo=owner/name] [--dry]
# 判据: 退出码 0 = tag 已接到目标提交且远端一致；非 0 = 未完成（打印原因）
# 注意: 会删远端 Release 与 tag —— 属于破坏性动作，务必先确认目标提交，--dry 可先看计划
set -uo pipefail
TAG="${1:?用法: GH_TOKEN=... bash tools/release-realign.sh <tag> [--to=HEAD] [--repo=owner/name] [--dry]}"
TO="HEAD"; REPO=""; DRY=0
for a in "$@"; do case "$a" in
  --to=*) TO="${a#--to=}" ;;
  --repo=*) REPO="${a#--repo=}" ;;
  --dry) DRY=1 ;;
esac; done
cd "$(dirname "$0")/.." || exit 2
[ -n "$REPO" ] || REPO="$(git remote get-url origin 2>/dev/null | sed -E 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?#\1#')"
TARGET="$(git rev-parse --short "$TO^{commit}")" || exit 2
API="https://api.github.com/repos/$REPO"
auth=(); [ -n "${GH_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GH_TOKEN")

echo "== 计划 =="
echo "  tag      : $TAG"
echo "  目标提交 : $TARGET ($TO)"
echo "  远端仓库 : $REPO"
echo "  动作     : 删 Release → 删远端 tag → 本地重打 tag → 重推（触发 release 工作流）"
[ "$DRY" = 1 ] && { echo "  [--dry] 未执行"; exit 0; }

echo "== 1. 删旧 Release =="
RID=$(curl -s "${auth[@]}" "$API/releases/tags/$TAG" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
if [ -n "$RID" ]; then
  curl -s -o /dev/null -w "  DELETE release/$RID → http=%{http_code}\n" -X DELETE "${auth[@]}" "$API/releases/$RID"
else echo "  （远端无该 Release，跳过）"; fi

echo "== 2. 删远端 tag =="
export GH_TOKEN="${GH_TOKEN:-}"
ASK=""; if [ -n "$GH_TOKEN" ]; then ASK="$(mktemp)"; chmod 700 "$ASK"
  printf '#!/bin/sh\ncase "$1" in *Username*) echo x-access-token;; *) echo "$GH_TOKEN";; esac\n' > "$ASK"
  export GIT_ASKPASS="$ASK" GIT_TERMINAL_PROMPT=0; fi
trap '[ -n "$ASK" ] && rm -f "$ASK"' EXIT
git push origin --delete "$TAG" 2>&1 | tail -1

echo "== 3. 本地重打 tag =="
git tag -d "$TAG" >/dev/null 2>&1
git tag -a "$TAG" -m "无限五代 $TAG" -m "对齐发布包：tag 接到 $TARGET" "$TARGET"
echo "  tag → $(git rev-parse --short "$TAG^{commit}")"

echo "== 4. 重推 tag（触发 release 工作流）=="
git push origin "$TAG" 2>&1 | tail -1
echo
echo "远端 tag → $(GIT_TERMINAL_PROMPT=0 git ls-remote origin "refs/tags/$TAG^{}" | cut -c1-7)"
echo "复核资产：GH_TOKEN=... bash tools/verify-release-assets.sh $TAG"
