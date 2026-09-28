#!/usr/bin/env bash
# run_verify.sh — T09-01 的可执行验证脚本（本机实测）
#   1) 用交叉编译器造一个带已知导出名的目标 PE
#   2) 用同一份 pefile.hpp 编译出的 Linux 侧核验器，做阳性 / 阴性 / 非 PE / 无导出 四类对照
#   3) 交叉编译 Windows 11 侧的两个可执行件，确认能产出 PE32+ x86-64
sd="$(cd "$(dirname "$0")" && pwd)"
OUT="$sd/../_out_t0901.md"
CXX=g++
MX=x86_64-w64-mingw32-g++
cd "$sd"
{
  echo '```bash'
  echo '# 约定：凡出现摘要值的行，行尾标注 # sha256，使摘要与伪装在明文检查器下可区分'
  echo '# 工具链：g++（本机 Linux）+ x86_64-w64-mingw32-g++（交叉编译 Windows 目标）'
  echo
  echo '# 1) 造目标 PE（三个已知导出名）'
  echo "\$ $MX -std=c++17 -O2 -shared -o testdll.dll testdll.cpp"
  $MX -std=c++17 -O2 -shared -o testdll.dll testdll.cpp; echo "rc=$?"
  ls -l testdll.dll | awk '{print $5, $9}'
  echo
  echo '# 2) Linux 侧核验器（与 Windows 侧共用同一份 pefile.hpp）'
  echo "\$ $CXX -std=c++17 -O2 -o peverify peverify.cpp"
  $CXX -std=c++17 -O2 -o peverify peverify.cpp; echo "rc=$?"
  echo
  echo '# 3) 阳性对照：导出名集合必须完全一致'
  echo '$ ./peverify testdll.dll pev_alpha pev_beta pev_gamma'
  ./peverify testdll.dll pev_alpha pev_beta pev_gamma; echo "rc=$?"
  echo
  echo '# 4) 阴性对照 A：给一个不存在的导出名 → 必须判失败'
  echo '$ ./peverify testdll.dll pev_alpha pev_missing'
  ./peverify testdll.dll pev_alpha pev_missing; echo "rc=$?"
  echo
  echo '# 5) 阴性对照 B：喂一个非 PE 文件 → 必须判「不是 PE」而不是崩溃'
  echo '$ ./peverify hookself.cpp pev_alpha'
  ./peverify hookself.cpp pev_alpha; echo "rc=$?"
  echo
  echo '# 6) Windows 侧工具交叉编译（pecheck 内存/磁盘对照 + hookself 阳对照目标）'
  echo "\$ $MX -std=c++17 -O2 -Wall -o pecheck.exe pecheck.cpp"
  $MX -std=c++17 -O2 -Wall -o pecheck.exe pecheck.cpp 2>&1; echo "rc=$?"
  echo "\$ $MX -std=c++17 -O2 -Wall -o hookself.exe hookself.cpp"
  $MX -std=c++17 -O2 -Wall -o hookself.exe hookself.cpp 2>&1; echo "rc=$?"
  echo '$ ./peverify pecheck.exe   # arch=PE32+ 说明交叉编译产出的是 64 位 Windows 可执行文件'
  ./peverify pecheck.exe || true
  ls -l pecheck.exe hookself.exe | awk '{print $5, $9}'
  echo
  echo '# 7) 阴性对照 C：无导出表的 EXE（解析器必须给出 NO-EXPORTS 而不是假阳性）'
  echo '$ ./peverify pecheck.exe pev_alpha'
  ./peverify pecheck.exe pev_alpha; echo "rc=$?"
  echo
  echo '# 8) 源码与产物的落盘摘要'
  sha256sum pefile.hpp peverify.cpp pecheck.cpp hookself.cpp testdll.cpp testdll.dll pecheck.exe hookself.exe | sed 's/$/\t# sha256/'
  echo '```'
} > "$OUT"
echo "WROTE $OUT lines=$(wc -l < "$OUT")"
