#!/usr/bin/env bash
# first_look.sh -- 先查后写第一步：在写任何结论文字之前，枚举并锁定唯一可信工作区对象
# usage: first_look.sh <workspace-root>
set -euo pipefail
ROOT="${1:?usage: first_look.sh <workspace-root>}"
echo "## 1 attachments / shortcuts"
find "$ROOT" -maxdepth 2 \( -name '*.lnk' -o -name '*.desktop' -o -name '*.url' -o -name '*.attach' \) -print 2>/dev/null || true
echo "count_shortcuts=$(find "$ROOT" -maxdepth 2 \( -name '*.lnk' -o -name '*.desktop' -o -name '*.url' \) 2>/dev/null | wc -l)"
echo "## 2 unique workspace object"
find "$ROOT" -maxdepth 3 -type f -printf '%TY-%Tm-%TdT%TH:%TM:%TS %p\n' | sort | head -20
echo "## 3 hash lock (baseline identity)"
find "$ROOT" -maxdepth 3 -type f -name '*.py' -o -maxdepth 3 -type f -name '*.sh' | sort | xargs -r sha256sum
echo "## 4 pre-state gate"
echo "readonly_object_check=$( [ -w "$ROOT/work/orig/policy_gate.py" ] && echo WRITABLE || echo READONLY )"
