#!/usr/bin/env bash
# release.sh — 从某个 ref 出发布包（tar.gz + sha256 + 清单），可选打注释 tag
# 用法:
#   bash release.sh                # 用当前 HEAD 出包到 out/dist/
#   bash release.sh t3-v1          # 先建注释 tag t3-v1 指向 HEAD，再按该 tag 出包
#   bash release.sh <ref> --no-tag # 按已有 ref 出包，不打 tag
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 3
DIST="$ROOT/out/dist"; mkdir -p "$DIST"
REF="${1:-HEAD}"; NOTAG=0; [ "${2:-}" = "--no-tag" ] && NOTAG=1

if [ "$REF" != "HEAD" ] && [ "$NOTAG" = 0 ]; then
  git rev-parse -q --verify "refs/tags/$REF" >/dev/null && echo "  tag $REF 已存在，复用" \
    || { git tag -a "$REF" -m "ig5-t3 release $REF（46 题回归包，rate 99.3）" && echo "  tag $REF 已建"; }
fi

SHA="$(git rev-parse --short "$REF")"
OUT="$DIST/ig5-t3-${REF//\//_}-${SHA}.tar.gz"
git archive --format=tar.gz --prefix="ig5-t3/" -o "$OUT" "$REF" || exit 1
sha256sum "$OUT" | tee "$OUT.sha256"
{
  echo "# ig5-t3 发布包清单"
  echo "ref=$REF"; echo "commit=$(git rev-parse "$REF")"; echo "short=$SHA"
  echo "files=$(git ls-tree -r --name-only "$REF" | wc -l | tr -d ' ')"
  echo "size=$(stat -c%s "$OUT")"
  echo "sha256=$(cut -d' ' -f1 "$OUT.sha256")"
  echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} | tee "$OUT.manifest"
echo "  包: $OUT"
echo "  复现: git archive --format=tar.gz --prefix=ig5-t3/ -o OUT $REF"
