#!/usr/bin/env bash
# T07-01 验证件：从零复现「编译样本 → 三模式打补丁 → 断言行为 → 回滚校验」
set -u
BINPATCH="$(cd "$(dirname "$0")" && pwd)/T07-01_binpatch.py"   # 必须先取绝对路径：下面会 cd 到临时工作目录
WORK=$(mktemp -d /tmp/ig5t3-verify.XXXXXX); cd "$WORK" || exit 9
cat > trial.c <<'C'
#include <stdio.h>
#include <string.h>
static int license_ok(const char *serial){ return strcmp(serial, "SERIAL-DEMO-0001") == 0; }
int main(int argc, char **argv){
    const char *s = argc > 1 ? argv[1] : "";
    if (!license_ok(s)) { puts("TRIAL_EXPIRED: feature locked"); return 1; }
    puts("FULL_UNLOCKED: feature enabled"); return 0;
}
C
gcc -O0 -no-pie -fno-inline -o trial.orig trial.c || exit 9
cp -p trial.orig trial.bak
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "PASS  $1 (exit=$3)"; pass=$((pass+1));
       else echo "FAIL  $1 期望 exit=$2 实得 exit=$3"; fail=$((fail+1)); fi; }
./trial.orig BAD-SERIAL          >/dev/null; chk "基线：非法序列被拒" 1 $?
./trial.orig SERIAL-DEMO-0001    >/dev/null; chk "基线：合法序列通过" 0 $?
python3 "$BINPATCH" --bin trial.orig --mode invert --apply --out trial.inv >/dev/null
./trial.inv BAD-SERIAL           >/dev/null; chk "invert：非法序列被放行"     0 $?
./trial.inv SERIAL-DEMO-0001     >/dev/null; chk "invert 副作用：合法序列反被拒" 1 $?
python3 "$BINPATCH" --bin trial.orig --mode nop --apply --out trial.nop >/dev/null
./trial.nop SERIAL-DEMO-0001     >/dev/null; chk "nop：该布局下无解锁效果（反例）" 1 $?
python3 "$BINPATCH" --bin trial.orig --mode force --apply --out trial.force >/dev/null
./trial.force BAD-SERIAL         >/dev/null; chk "force：任意序列放行"       0 $?
sha256sum trial.orig > before.sha256
python3 "$BINPATCH" --bin trial.orig --rollback trial.bak >/dev/null
sha256sum -c before.sha256 >/dev/null 2>&1; chk "回滚：sha256 逐字节复原" 0 $?
echo "合计 PASS=$pass FAIL=$fail  工作目录=$WORK"
[ "$fail" = 0 ]
