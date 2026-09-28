#!/usr/bin/env bash
# 回滚宿主调参文件到 apply.sh --live 之前的备份。
#   默认: 用最新备份还原线上文件
#   --list: 只列备份，不改文件
#   --to <文件>: 指定备份还原
# 环境变量: IG5_TUNING=<路径> 覆盖线上文件位置
set -euo pipefail

LIVE="${IG5_TUNING:-$HOME/.dsh/infinite-gen-5-tuning.json}"
BK_DIR="$(dirname "$LIVE")/backups"
MODE="${1:-restore}"

if [ ! -d "$BK_DIR" ]; then
  echo "无备份目录 $BK_DIR —— 没有可回滚的写入（候选模式从不写线上文件）"
  exit 0
fi

if [ "$MODE" = "--list" ]; then
  ls -1t "$BK_DIR"/infinite-gen-5-tuning.*.json 2>/dev/null || echo "（无备份）"
  exit 0
fi

if [ "$MODE" = "--to" ]; then
  BK="${2:?用法: ROLLBACK.sh --to <备份文件>}"
else
  BK="$(ls -1t "$BK_DIR"/infinite-gen-5-tuning.*.json 2>/dev/null | head -n1 || true)"
fi

[ -n "${BK:-}" ] && [ -f "$BK" ] || { echo "找不到备份文件"; exit 2; }

# 还原前先留一份当前状态，避免回滚本身不可逆
if [ -f "$LIVE" ]; then
  cp -f "$LIVE" "$LIVE.pre-rollback.$(date +%Y%m%dT%H%M%S)"
fi
cp -f "$BK" "$LIVE"
echo "已还原: $BK -> $LIVE"
python3 -c "import json,sys;d=json.load(open(sys.argv[1],encoding='utf-8'));print('当前 overrides 键:', ', '.join(sorted(d.get('overrides',{}))))" "$LIVE"
