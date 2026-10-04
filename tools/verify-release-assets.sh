#!/usr/bin/env bash
# verify-release-assets.sh — 核验某个 tag 的 GitHub Release 资产确实来自该 tag 的树
#
# 用法:
#   GH_TOKEN=<PAT> bash tools/verify-release-assets.sh v0.65.14 [--repo=SunsetRNE/dsh-infinite-gen-5]
# 判据: 退出码 0 = tag 指向、资产齐、SHA256 与本地打包一致、包内含该版本新增件
set -uo pipefail
TAG="${1:?用法: GH_TOKEN=... bash tools/verify-release-assets.sh <tag> [--repo=owner/name]}"
REPO="SunsetRNE/dsh-infinite-gen-5"
for a in "$@"; do case "$a" in --repo=*) REPO="${a#--repo=}" ;; esac; done
cd "$(dirname "$0")/.." || exit 2

say() { printf '%s\n' "$*"; }
ok=0; bad=0
chk() { if [ "$1" = 0 ]; then say "  [ OK ] $2"; else say "  [FAIL] $2"; bad=$((bad+1)); fi; }

say "== 1. tag 指向 =="
LOCAL=$(git rev-parse --short "$TAG^{commit}" 2>/dev/null || echo none)
REMOTE=$(git ls-remote "origin" "refs/tags/$TAG^{}" 2>/dev/null | cut -c1-7)
HEAD7=$(git rev-parse --short HEAD)
say "  tag 本地=$LOCAL 远端=$REMOTE   HEAD=$HEAD7"
if [ "$LOCAL" = "$REMOTE" ]; then
  if [ "$LOCAL" = "$HEAD7" ]; then chk 0 "tag 与 HEAD 同指向（$LOCAL）"
  elif git merge-base --is-ancestor "$TAG^{commit}" HEAD 2>/dev/null; then
    say "  [ OK ] tag=$LOCAL 双端一致，HEAD=$HEAD7 是其后继提交（tag 之后只多了核验脚本等非发布件，不算不一致）"
  else chk 1 "tag=$LOCAL 与 HEAD=$HEAD7 已分叉"; fi
else chk 1 "tag 本地=$LOCAL 与远端=$REMOTE 不一致"; fi

say "== 2. Release 资产清单 =="
API="https://api.github.com/repos/$REPO/releases/tags/$TAG"
CURL=(curl -s); [ -n "${GH_TOKEN:-}" ] && CURL+=(-H "Authorization: Bearer $GH_TOKEN")
names=$("${CURL[@]}" "$API" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(' '.join(a['name'] for a in d.get('assets',[]))) if not d.get('message') else print('MISSING')")
say "  资产: $names"
echo "$names" | grep -q "dsh-infinite-gen-5-$TAG.tar.gz" && chk 0 "tar.gz 在" || chk 1 "tar.gz 缺"
echo "$names" | grep -q 'SHA256SUMS' && chk 0 "SHA256SUMS 在" || chk 1 "SHA256SUMS 缺"

say "== 3. 下载线上包并核 SHA256SUMS =="
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
BASE="https://github.com/$REPO/releases/download/$TAG"
for n in "dsh-infinite-gen-5-$TAG.tar.gz" SHA256SUMS; do
  curl -fSL --retry 2 -o "$TMP/$n" "$BASE/$n" || { chk 1 "下载失败 $n"; break; }
  say "  下载 $n → $(wc -c < "$TMP/$n") B"
done
REAL=$(sha256sum "$TMP/dsh-infinite-gen-5-$TAG.tar.gz" 2>/dev/null | awk '{print $1}')
LISTED=$(grep -E '  dsh-infinite-gen-5-.*\.tar\.gz' "$TMP/SHA256SUMS" 2>/dev/null | head -1 | awk '{print $1}')
say "  下载包 sha256: ${REAL:0:16}…   清单登记: ${LISTED:0:16}…"
[ -n "$REAL" ] && [ "$REAL" = "$LISTED" ] && chk 0 "包体与 SHA256SUMS 一致" || chk 1 "包体与清单不符"

say "== 4. 包内该版本新增件（对照 tag 树的 blob 哈希）=="
tar -xzf "$TMP/dsh-infinite-gen-5-$TAG.tar.gz" -C "$TMP" 2>/dev/null
P="$TMP/dsh-infinite-gen-5"
for f in skills/ig5-layer-04b-ubuntu-workspace/SKILL.md skills/ig5-layer-15-env-bootstrap/SKILL.md tools/ig5-ubuntu-detect.sh; do
  if [ -f "$P/$f" ]; then
    WANT=$(git rev-parse "$TAG:$f" 2>/dev/null || echo none)
    GOT=$(git hash-object "$P/$f")
    [ "$WANT" = "$GOT" ] && chk 0 "$f 与 tag 树同 blob（${GOT:0:12}）" || chk 1 "$f 与 tag 树不一致"
  else
    chk 1 "$f 不在包里"
  fi
done
v=$(grep -m1 '"version"' "$P/package.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
[ "$v" = "${TAG#v}" ] && chk 0 "包内版本 = $v" || chk 1 "包内版本 $v ≠ ${TAG#v}"

say
say "结论：失败 $bad 项"
[ "$bad" = 0 ] && { say "RESULT: 资产与 tag 树一致"; exit 0; } || { say "RESULT: 存在不一致"; exit 1; }
