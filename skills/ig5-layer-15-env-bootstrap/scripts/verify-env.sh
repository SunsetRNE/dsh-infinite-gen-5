#!/usr/bin/env bash
# verify-env.sh — 环境自检：逐个查工具、真编译一个 C/C++ 程序、真跑 Python/Node 冒烟
# 用法: bash verify-env.sh            # 全量
#       bash verify-env.sh --quick    # 只列版本，不真编译
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

PASS=0; FAIL=0; MISS=()
ok()   { printf '  [ OK ] %-12s %s\n' "$1" "$2"; PASS=$((PASS+1)); }
bad()  { printf '  [FAIL] %-12s %s\n' "$1" "$2"; FAIL=$((FAIL+1)); MISS+=("$1"); }

ver() { # ver <bin> <args...>
  local b="$1"; shift
  if command -v "$b" >/dev/null 2>&1; then
    local v; v="$("$b" "$@" 2>&1 | head -1)"
    ok "$b" "${v:0:80}"
  else
    bad "$b" "missing"
  fi
}

echo "############ 1. 版本清单 ############"
ver gcc --version
ver g++ --version
ver make --version
ver cmake --version
ver ninja --version
ver ld --version
ver ar --version
ver as --version
ver strings --version
ver readelf --version
ver objdump --version
ver gdb --version
ver strace -V
ver python3 -V
ver pip3 --version
ver pipx --version
ver uv --version
ver node -v
ver npm -v
ver pnpm -v
ver git --version
ver ssh -V
ver jq --version
ver rg --version
ver unzip -v
ver zip -v
ver file --version
ver rsync --version
ver tmux -V
ver rustc -V
ver cargo -V
ver go version
ver javac -version
ver java -version

echo
echo "############ 2. SSH / Git 身份 ############"
if [ -f "$HOME/.ssh/id_ed25519" ]; then
  perm="$(stat -c '%a' "$HOME/.ssh/id_ed25519")"
  [ "$perm" = "600" ] && ok "id_ed25519" "600 权限 OK" || bad "id_ed25519" "权限 $perm 应为 600"
else bad "id_ed25519" "缺失"; fi
command -v ssh-keygen >/dev/null 2>&1 && { fp="$(ssh-keygen -lf "$HOME/.ssh/id_ed25519.pub" 2>&1)"; ok "公钥指纹" "$fp"; }
if [ -f "$HOME/.gitconfig" ]; then ok "gitconfig" "$(git config --global user.name) <$(git config --global user.email)>"
else bad "gitconfig" "缺失"; fi

if [ "$QUICK" = "0" ]; then
  echo
  echo "############ 3. 真编译冒烟 ############"
  W="$(mktemp -d)"; cd "$W"
  cat > hello.c <<'EOF'
#include <stdio.h>
#include <zlib.h>
#include <openssl/sha.h>
int main(void){
  unsigned char d[SHA256_DIGEST_LENGTH];
  SHA256((const unsigned char*)"env-restore", 11, d);
  printf("hello-c zlib=%s sha256=%02x%02x\n", zlibVersion(), d[0], d[1]);
  return 0;
}
EOF
  if gcc -O2 hello.c -o hello -lz -lcrypto 2>cc.log && ./hello; then ok "C 编译+运行" "$(./hello)"
  else bad "C 编译+运行" "$(tail -2 cc.log | tr '\n' ' ')"; fi

  cat > hello.cpp <<'EOF'
#include <iostream>
#include <string>
#include <vector>
int main(){ std::vector<std::string> v{"cpp","toolchain","ok"};
  for (auto&s:v) std::cout << s << ' '; std::cout << std::endl; }
EOF
  if g++ -std=c++17 -O2 hello.cpp -o hellocpp 2>cpp.log && ./hellocpp; then ok "C++ 编译+运行" "std=c++17 OK"
  else bad "C++ 编译+运行" "$(tail -2 cpp.log | tr '\n' ' ')"; fi

  cat > CMakeLists.txt <<'EOF'
cmake_minimum_required(VERSION 3.16)
project(smoke C)
add_executable(hello hello.c)
find_library(ZLIB z REQUIRED)
find_library(CRYPTO crypto REQUIRED)
target_link_libraries(hello ${ZLIB} ${CRYPTO})
EOF
  if cmake -S . -B build -G Ninja >cm.log 2>&1 && cmake --build build >>cm.log 2>&1 && ./build/hello; then
    ok "CMake+Ninja" "$(grep -m1 -i 'generator' cm.log | tr -d '\n')"
  else bad "CMake+Ninja" "$(tail -3 cm.log | tr '\n' ' ')"; fi

  if python3 -c "import sys,ssl,hashlib,zlib,json,sqlite3;print('python libs ok', sys.version.split()[0])"; then ok "Python 标准库" "ssl/hashlib/sqlite3 OK"; else bad "Python 标准库" "缺模块"; fi
  if node -e "const c=require('crypto');console.log('node crypto ok', process.version, c.createHash('sha256').update('x').digest('hex').slice(0,8))"; then ok "Node 运行时" "crypto OK"; else bad "Node 运行时" "失败"; fi
  if git init -q . >/dev/null 2>&1 && git config user.email >/dev/null && echo "git ok"; then ok "Git 可用" "$(git config --global init.defaultBranch) 默认分支"; else bad "Git 可用" "失败"; fi

  echo
  echo "############ 4. 多语言运行时冒烟 ############"
  export PATH=$PATH:/usr/local/go/bin:$HOME/.cargo/bin
  if command -v go >/dev/null 2>&1; then
    printf 'package main\nimport ("fmt";"runtime")\nfunc main(){fmt.Println("go ok", runtime.Version(), runtime.GOARCH)}\n' > m.go
    if go run m.go 2>go.log; then ok "Go 编译+运行" "$(go version)"; else bad "Go 编译+运行" "$(tail -2 go.log | tr '\n' ' ')"; fi
  else bad "Go 编译+运行" "未安装 go"; fi

  if command -v rustc >/dev/null 2>&1; then
    printf 'fn main(){println!("rust ok {}", std::env::consts::ARCH);}\n' > m.rs
    if rustc -O m.rs -o mrs 2>rs.log && ./mrs; then ok "Rust 编译+运行" "$(rustc -V)"; else bad "Rust 编译+运行" "$(tail -2 rs.log | tr '\n' ' ')"; fi
  else bad "Rust 编译+运行" "未安装 rustc"; fi

  if command -v javac >/dev/null 2>&1; then
    printf 'public class M { public static void main(String[] a){ System.out.println("java ok "+System.getProperty("os.arch")); } }\n' > M.java
    if javac M.java 2>jv.log && java M; then ok "Java 编译+运行" "$(javac -version 2>&1)"; else bad "Java 编译+运行" "$(tail -2 jv.log | tr '\n' ' ')"; fi
  else bad "Java 编译+运行" "未安装 javac"; fi

  cd /; rm -rf "$W"
fi

echo
echo "############ 5. 通用开发增强件 ############"
export PATH=$PATH:$HOME/.local/bin:/root/.local/bin
ver shellcheck --version
ver sqlite3 -version
ver tree --version
ver parallel --version
ver ncdu -version
ver pytest --version
ver ruff --version
ver mypy --version
ver tsc -v
ver prettier --version
if command -v eslint >/dev/null 2>&1; then ok "eslint" "eslint $(eslint -v 2>&1 | head -1)"; else bad "eslint" "missing"; fi
T="$(mktemp -d)"
printf 'x=1\nif x==1:\n  print("ruff ok")\n' > "$T/r.py"
if ruff check "$T/r.py" 2>&1 | grep -q 'All checks passed'; then ok "ruff 实跑" "All checks passed"; else bad "ruff 实跑" "检查未通过"; fi
if pytest --version >/dev/null 2>&1; then ok "pytest 可用" "$(pytest --version 2>&1 | head -1)"; else bad "pytest" "失败"; fi
if command -v tsx >/dev/null 2>&1; then
  printf 'const n: number = 40 + 2; console.log("tsx ok", n);\n' > "$T/t.ts"
  out="$(tsx "$T/t.ts" 2>&1 | head -1)"
  [ "$out" = "tsx ok 42" ] && ok "tsx 实跑" "$out" || bad "tsx 实跑" "$out"
else bad "tsx 实跑" "missing"; fi
if sqlite3 :memory: "select sqlite_version();" >/dev/null 2>&1; then ok "sqlite3 实跑" "$(sqlite3 :memory: 'select sqlite_version();')"; else bad "sqlite3" "失败"; fi
if ss -ltn >/dev/null 2>&1; then ok "ss 实跑" "$(ss -V 2>&1)"; else bad "ss" "失败"; fi
rm -rf "$T"

echo
echo "############ 汇总 ############"
printf 'PASS=%d  FAIL=%d\n' "$PASS" "$FAIL"
[ ${#MISS[@]} -gt 0 ] && printf '缺失/失败: %s\n' "${MISS[*]}"
exit 0
