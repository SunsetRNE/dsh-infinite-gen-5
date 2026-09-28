#!/usr/bin/env bash
# regen_verify.sh — 重生成 T08-04 的两份证据文件：_digests.txt（落盘摘要）与 _out_verify.md（实测转录）
# 用在同一目录下的 domain_router.py / plaincheck.py / assemble.py 与 ../t0804/bio-design-matrix.md 上。
sd="$(cd "$(dirname "$0")" && pwd)"
A="$(cd "$sd/.." && pwd)"
set -e
python3 - "$sd" <<'PYEOF' > "$sd/_digests.txt"
import hashlib, pathlib, sys
L = pathlib.Path(sys.argv[1]); A = L.parent
for p in [A/"t0804"/"bio-design-matrix.md", L/"domain_router.py", L/"plaincheck.py", L/"assemble.py"]:
    raw = p.read_bytes()
    print(f"sha256={hashlib.sha256(raw).hexdigest()}  bytes={len(raw)}  lines={raw.decode().count(chr(10))+1}  {p.resolve()}")
PYEOF
{
  echo '```bash'
  echo '# 约定：凡出现摘要值的行，行尾标注 # sha256，使摘要与伪装在明文检查器下可区分'
  echo '# 1) 主件：三分支必交字段断言 + 分类器对照'
  echo "\$ python3 $sd/domain_router.py --selftest"
  python3 "$sd/domain_router.py" --selftest
  echo
  echo '# 2) 验证件：明文检查器阴/阳对照（探测器既不误报也不漏报）'
  echo "\$ python3 $sd/plaincheck.py --selftest"
  python3 "$sd/plaincheck.py" --selftest
  echo
  echo '# 3) 三份分支产物的明文契约扫描'
  echo '$ python3 plaincheck.py _out_bio.md _out_codex.md _out_file.md'
  python3 "$sd/plaincheck.py" "$sd/_out_bio.md" "$sd/_out_codex.md" "$sd/_out_file.md"
  echo
  echo '# 4) 文件任务分支：自指摘要复算'
  echo "\$ python3 domain_router.py --verify $A/t0804/bio-design-matrix.md | sed \"s/\\\$/\t# sha256/\""
  python3 "$sd/domain_router.py" --verify "$A/t0804/bio-design-matrix.md" | sed 's/$/\t# sha256/'
  echo
  echo '# 5) 四件产物的落盘摘要'
  echo '$ sha256sum <四件产物> | sed "s/\$/TAB# sha256/"'
  sha256sum "$A/t0804/bio-design-matrix.md" "$sd/domain_router.py" "$sd/plaincheck.py" "$sd/assemble.py" | sed 's/$/\t# sha256/'
  echo '```'
} > "$sd/_out_verify.md"
