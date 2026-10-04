#!/usr/bin/env bash
# install.sh — 把 env-bootstrap 技能装进宿主的技能扫描根
# 用法:
#   bash install.sh              # dry-run，只打印将要做什么
#   bash install.sh --apply      # 真装（默认根 ~/.dsh/skills）
#   bash install.sh --apply --root ~/.agents/skills
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SRC/../.." && pwd)"          # env-restore/
ROOT="$HOME/.dsh/skills"
APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --root)  ROOT="${2:-}"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done
DST="$ROOT/env-bootstrap"

echo "技能源     : $SRC"
echo "仓库脚本源 : $REPO"
echo "安装目标   : $DST"
echo "技能扫描根 : ~/.dsh/skills  或  ~/.agents/skills（宿主四个根之一即可被加载）"
echo
echo "将执行："
echo "  1) mkdir -p $DST/{scripts,references}"
echo "  2) 复制 SKILL.md 与 references/"
echo "  3) 从 $REPO 复制四个可跑脚本到 $DST/scripts/"
for f in restore-dev-env.sh verify-env.sh verify-re.sh; do
  [ -f "$REPO/$f" ] && echo "       - $f" || echo "       ! 缺 $REPO/$f（跳过）"
done
[ -f "$REPO/frida/verify-frida.sh" ] && echo "       - frida/verify-frida.sh"

if [ "$APPLY" != "1" ]; then
  echo
  echo "DRY-RUN：未写盘。加 --apply 真装。"
  exit 0
fi

mkdir -p "$DST/scripts" "$DST/references"
cp -a "$SRC/SKILL.md" "$DST/"
cp -a "$SRC/references/." "$DST/references/"
for f in restore-dev-env.sh verify-env.sh verify-re.sh; do
  [ -f "$REPO/$f" ] && cp -a "$REPO/$f" "$DST/scripts/"
done
[ -f "$REPO/frida/verify-frida.sh" ] && cp -a "$REPO/frida/verify-frida.sh" "$DST/scripts/"
chmod +x "$DST"/scripts/*.sh 2>/dev/null

echo
echo "已装到 $DST："
find "$DST" -maxdepth 2 -type f -printf '  %-40p %s 字节\n' | sort
echo
echo "验证："
echo "  test -f $DST/SKILL.md && head -3 $DST/SKILL.md"
echo "  bash $DST/scripts/verify-env.sh | tail -4"
