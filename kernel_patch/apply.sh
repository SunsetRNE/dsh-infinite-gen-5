#!/usr/bin/env bash
# 把 kernel_patch/tuning-patch.json 合并进宿主调参文件的受控流程。
#   默认（候选）: 只写 ~/.dsh/infinite-gen-5-tuning.candidate.json，不动线上文件
#   --live     : 先备份线上文件，再写线上（无备份不写）
# 环境变量: IG5_TUNING=<路径> 覆盖线上文件位置（默认 ~/.dsh/infinite-gen-5-tuning.json）
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LIVE="${IG5_TUNING:-$HOME/.dsh/infinite-gen-5-tuning.json}"
CAND="${LIVE%.json}.candidate.json"
BK_DIR="$(dirname "$LIVE")/backups"
PATCH="$HERE/tuning-patch.json"
MODE="${1:-candidate}"

[ -f "$PATCH" ] || { echo "缺少 $PATCH（先跑 python3 make_patch.py）"; exit 2; }

python3 - "$PATCH" "$LIVE" "$CAND" "$BK_DIR" "$MODE" <<'PY'
import json, os, shutil, sys, time
patch_p, live_p, cand_p, bkdir, mode = sys.argv[1:6]
patch = json.load(open(patch_p, encoding="utf-8"))
live = json.load(open(live_p, encoding="utf-8")) if os.path.exists(live_p) else {}
ov = dict(live.get("overrides", {}))
before = dict(ov)
ov.update(patch.get("overrides", {}))
merged = dict(live)
merged["overrides"] = ov
merged["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
merged["_source"] = "ig5-t3 kernel_patch"
os.makedirs(os.path.dirname(cand_p), exist_ok=True)
json.dump(merged, open(cand_p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
added = sorted(k for k in ov if k not in before)
changed = sorted(k for k in ov if k in before and before[k] != ov[k])
print("候选副本: %s" % cand_p)
print("线上文件: %s (%s)" % (live_p, "存在" if os.path.exists(live_p) else "不存在"))
print("新增键 %d: %s" % (len(added), ", ".join(added) or "-"))
print("改动键 %d: %s" % (len(changed), ", ".join(changed) or "-"))
if mode == "--live":
    if not os.path.exists(live_p):
        print("线上文件不存在，拒绝写入（先把宿主配置就位或改用候选模式）")
        sys.exit(3)
    os.makedirs(bkdir, exist_ok=True)
    bk = os.path.join(bkdir, "infinite-gen-5-tuning.%s.json" % time.strftime("%Y%m%dT%H%M%S"))
    shutil.copyfile(live_p, bk)
    shutil.copyfile(cand_p, live_p)
    print("已写线上；备份: %s" % bk)
    print("回滚: bash %s/ROLLBACK.sh" % os.path.dirname(os.path.abspath(patch_p)))
else:
    print("未动线上文件。落线上: bash %s --live" % os.path.basename(sys.argv[0]))
PY
