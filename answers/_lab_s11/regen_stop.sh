#!/usr/bin/env bash
# regen_stop.sh — 重生成 T08-05 的实测转录 _out_stop.md
# 四段：重建清单 → 阴/阳对照 selftest → 真实清单上 stop 全绿 → 篡改后 verify 拦下、stop 复现修复
sd="$(cd "$(dirname "$0")" && pwd)"
A="$(cd "$sd/.." && pwd)"
G="$sd/stopgate.py"
M="$sd/manifest_T0805.json"
P="$A/t0804/bio-design-matrix.md"
{
  echo '```bash'
  echo '# 约定：凡出现摘要值的行，行尾标注 # sha256，使摘要与伪装在明文检查器下可区分'
  echo
  echo '# 0) 从零重建声明清单（declare 只接受已存在的产物，顺序 = 上游先、下游后）'
  echo '$ bash _lab_s11/regen_manifest.sh'
  bash "$sd/regen_manifest.sh" 2>&1 | grep -E '^(DECLARED|MANIFEST-BUILT)'
  echo
  echo '# 1) 阴/阳对照（三条 control：放行 / 拦下 / 拦下）'
  echo '$ python3 _lab_s11/stopgate.py selftest'
  python3 "$G" selftest
  echo "selftest rc=$?"
  echo
  echo '# 2) 真实清单：重跑每条登记命令并比对指纹'
  echo '$ python3 _lab_s11/stopgate.py stop _lab_s11/manifest_T0805.json'
  python3 "$G" stop "$M"
  echo "stop rc=$?"
  echo
  echo '# 3) 阳对照：把产物改一行，只验不重跑 → 必须 PENDING'
  echo "\$ echo 'TAMPERED-LINE' >> $P"
  echo 'TAMPERED-LINE' >> "$P"
  echo '$ python3 _lab_s11/stopgate.py verify _lab_s11/manifest_T0805.json'
  python3 "$G" verify "$M"
  echo "verify rc=$?"
  echo
  echo '# 4) 修复路径：让闸门重跑登记命令 → 产物回到登记指纹 → STOP'
  echo '$ python3 _lab_s11/stopgate.py stop _lab_s11/manifest_T0805.json'
  python3 "$G" stop "$M"
  echo "stop rc=$?"
  echo
  echo '# 5) 登记清单的四件产物（路径 + 指纹）'
  echo '$ python3 -c "import json;[print(e[\"id\"], a[\"path\"], a[\"sha256\"], a[\"bytes\"], a[\"lines\"]) for e in json.load(open(\"_lab_s11/manifest_T0805.json\"))[\"entries\"] for a in e[\"artifacts\"]]" | sed "s/\$/TAB# sha256/;"'
  python3 -c 'import json,sys
doc = json.load(open(sys.argv[1]))
for e in doc["entries"]:
    for a in e["artifacts"]:
        print(e["id"], a["path"], a["sha256"], a["bytes"], a["lines"])' "$M" | sed 's/$/\t# sha256/'
  echo '```'
} > "$sd/_out_stop.md"
echo "WROTE $sd/_out_stop.md lines=$(wc -l < "$sd/_out_stop.md")"
