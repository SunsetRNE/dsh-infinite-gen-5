#!/usr/bin/env bash
# ig5-ubuntu-detect.sh — ig5-layer-04b 的装载判据与工作区体检
# 用法: bash tools/ig5-ubuntu-detect.sh [--check]
# 判据: --check 退出码 0 = 合规；>0 = 违规项数（封顶 2）
set -uo pipefail
. /etc/os-release 2>/dev/null || true
UBUNTU=no; [ "${ID:-}" = ubuntu ] && UBUNTU=yes
echo "== 装载判据 =="
echo "UBUNTU=$UBUNTU   ID=${ID:-none}   VERSION_ID=${VERSION_ID:-none}   arch=$(uname -m)   uid=$(id -u)"
[ "$UBUNTU" = yes ] || { echo "RESULT: 非 Ubuntu —— 不装载本层，主内核照常"; exit 0; }

WR="${IG5_WORKSPACE_ROOT:-${WORKSPACE_ROOT:-/root/home}}"
[ "$WR" = /root/home ] && ALT=no || ALT=yes
MARK=""
if [ "$ALT" = yes ]; then
  for m in README.workspace.md .workspace-root; do [ -f "$WR/$m" ] && MARK="$WR/$m" && break; done
fi
PN="${PROJECT_NAME:-${PWD##*/}}"
echo; echo "== 变量表 =="
printf '%-18s %s\n' WORKSPACE_ROOT "$WR" ALT_ROOT "$ALT" WORKSPACE_MARKER "${MARK:-<无需>}" \
  PROJECT_NAME "$PN" PROJECT_ROOT "$WR/$PN/" GLOBAL_SCRIPTS "$WR/scripts/" \
  PROJECT_SCRIPTS "$WR/$PN/scripts/" WORKFLOW_DIR "$WR/$PN/.github/workflows/" \
  DOWNLOAD_DIR "/root/手机存储/Download/" GLOBAL_IMAGES "$WR/assets/images/" \
  PROJECT_IMAGES "$WR/$PN/assets/images/" DOC_IMAGES "$WR/$PN/docs/images/"
[ "${1:-}" = "--check" ] || exit 0

V=0; viol() { echo "  [违规] $1"; V=$((V+1)); }
echo; echo "== 违规体检 =="
[ "$ALT" = yes ] && [ -z "$MARK" ] && viol "替代根 $WR 缺 WORKSPACE_MARKER"
for f in /root/*.sh; do [ -e "$f" ] && viol "脚本散落 /root/ 根：$(basename "$f")"; done
for d in /root/*/; do b="$(basename "$d")"
  case "$b" in 手机存储|home|.dsh|.cache|.npm|.local|.agents) continue;; esac
  [ -d "$d/.git" ] && viol "/root/ 下存在 Git 仓库：$b"; done
echo "$PN" | grep -Eq '^[a-z0-9-]+$' || viol "PROJECT_NAME 不合规：$PN"
if [ -d "$WR/assets/images" ]; then
  [ -f "$WR/assets/images/README.md" ] || viol "$WR/assets/images/ 缺 README.md"
  n=$(find "$WR/assets/images" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
  [ "$n" -lt 2 ] && viol "$WR/assets/images/ 未见分类目录（brand/icons/…）"
fi
BAD=$(find "$WR" -maxdepth 6 -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.webp' -o -iname '*.svg' \) -printf '%f\n' 2>/dev/null | grep -Ev '^[a-z0-9@._-]+$' | head -5)
[ -n "$BAD" ] && viol "图片名含空格/中文/大写：$(echo "$BAD" | tr '\n' ' ')"
if [ -d "$WR/$PN" ]; then
  H=$(grep -rIl --exclude-dir=.git -- "$WR" "$WR/$PN" 2>/dev/null | head -3)
  [ -n "$H" ] && viol "仓库内硬编码根路径：$(echo "$H" | tr '\n' ' ')"; fi
if [ -d "$WR/scripts" ] && [ -d "$WR/$PN/scripts" ]; then
  D=$(comm -12 <(ls "$WR/scripts" 2>/dev/null | sort) <(ls "$WR/$PN/scripts" 2>/dev/null | sort) | head -3)
  [ -n "$D" ] && viol "全局与项目 scripts 同名：$(echo "$D" | tr '\n' ' ')"; fi
echo; echo "违规项：$V   判据：0 = 合规；>0 = 逐条改道"
exit $(( V > 2 ? 2 : V ))
