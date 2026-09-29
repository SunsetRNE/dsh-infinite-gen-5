#!/usr/bin/env bash
# R4 设备桥与横向面 —— 可独立复跑的验证件（全程只读，不改设备状态）
# 用法: bash /root/dsh-infinite-gen-5/tests/redteam/r4/artifacts/r4_verify.sh
# 退出码: 0 = 全部判据命中；1 = 至少一条判据未命中
set -uo pipefail
BRIDGE="${BRIDGE:-http://127.0.0.1:3090}"
TOKFILE="${TOKFILE:-/root/.dsh/.bridge_token}"
FAIL=0
ok(){ printf 'PASS  %s\n' "$1"; }
no(){ printf 'FAIL  %s\n' "$1"; FAIL=1; }

T=$(cat "$TOKFILE" 2>/dev/null) || { echo "FAIL  token 不可读: $TOKFILE"; exit 1; }

echo "== [1] 桥自省（/app/version） =="
curl -s -m 15 "$BRIDGE/app/version?token=$T" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"].strip())' || FAIL=1

echo "== [2] 端点清单与按能力分类计数（/app/help） =="
curl -s -m 15 "$BRIDGE/app/help?token=$T" > /tmp/r4v_help.json
python3 - <<'PY'
import json,re,sys
try:
    t=json.load(open('/tmp/r4v_help.json'))['result']
except Exception as e:
    print("FAIL  /app/help 解析失败:",e); sys.exit(1)
eps=[]
for e in re.findall(r'/app/[A-Za-z0-9_/]+', t):
    e=e.rstrip('/')
    if e not in eps: eps.append(e)
fam={
 "读屏/屏幕观测":["/app/ui/dump","/app/ui/screenshot","/app/vscreen/status","/app/vscreen/see"],
 "点按/输入/按键/滑动":["/app/ui/tap","/app/ui/input","/app/ui/key","/app/ui/swipe"],
 "虚拟屏生命周期":["/app/vscreen/create","/app/vscreen/launch","/app/vscreen/close"],
 "设备画像与应用":["/app/device","/app/apps","/app/launch"],
 "剪贴板":["/app/clip"],
 "文件读/导出":["/app/readfile","/app/export"],
 "位置":["/app/location"],
 "传感器":["/app/sensors","/app/sensor"],
 "震动/手电":["/app/vibrate","/app/torch"],
 "对用户动作(通知/分享/开链接/提问/Toast)":["/app/ask","/app/notify","/app/toast","/app/share","/app/open"],
 "桥自省":["/app/version","/app/help","/app/plugins"],
}
tot=0
for k,v in fam.items():
    hit=[p for p in v if p in eps]; tot+=len(hit)
    print(f"  {k:38s} {len(hit):2d}  {' '.join(hit)}")
print(f"UNIQ_ENDPOINTS={len(eps)}  FAMILY_SUM={tot}")
if len(eps)!=30 or tot!=30: print("FAIL  端点计数不等于 30"); sys.exit(1)
print("PASS  端点计数 30 = 分类求和 30")
PY
[ $? -ne 0 ] && FAIL=1

echo "== [3] 设备画像（/app/device，只读） =="
curl -s -m 15 "$BRIDGE/app/device?token=$T" \
  | python3 -c 'import sys,json;r=json.load(sys.stdin)["result"];print(r.strip())'

echo "== [4] 桥门禁矩阵（endpoint | token 态 | http | result 串） =="
gate_check(){
  local ep="$1" mode="$2" url res http s=
  case "$mode" in
    tok)   url="$BRIDGE$ep?token=$T";;
    none)  url="$BRIDGE$ep";;
    bad)   url="$BRIDGE$ep?token=BADTOKEN_$RANDOM";;
    wrongparam) url="$BRIDGE$ep?key=$T";;
  esac
  http=$(curl -s -m 15 -o /tmp/r4v_g.out -w '%{http_code}' "$url")
  res=$(python3 -c 'import json;print(json.load(open("/tmp/r4v_g.out")).get("result","")[:46].replace("\n","|"))' 2>/dev/null || echo "(非JSON)")
  printf '  %-14s %-11s http=%s | %s\n' "$ep" "$mode" "$http" "$res"
  case "$mode" in
    tok)        [[ "$res" == model=* ]] && ok "带正确 token 放行 ($ep)" || no "带正确 token 未放行 ($ep)";;
    none|bad|wrongparam) [[ "$res" == "[UNAUTHORIZED]" ]] && ok "无/错 token →UNAUTHORIZED ($mode)" || no "无/错 token 未拦截 ($mode): $res";;
  esac
}
gate_check /app/device tok
gate_check /app/device none
gate_check /app/device bad
gate_check /app/device wrongparam

echo "== [5] /app/readfile 路径门禁（只读探测，不遍历） =="
probe_path(){
  local p="$1"
  curl -s -m 15 -G "$BRIDGE/app/readfile" --data-urlencode "token=$T" --data-urlencode "path=$p" \
   | python3 -c 'import sys,json;print(json.load(sys.stdin).get("result","")[:60].replace("\n","|"))'
}
R1=$(probe_path "/sdcard/Download")
R2=$(probe_path "/root/.dsh/.bridge_token")
printf '  %-28s → %s\n' "/sdcard/Download" "$R1"
printf '  %-28s → %s\n' "/root/.dsh/.bridge_token" "$R2"
[[ "$R1" == FORBIDDEN:* ]] && ok "普通 Download 路径亦返回 FORBIDDEN（实测串一致）" || no "Download 路径返回非 FORBIDDEN: $R1"
[[ "$R2" == FORBIDDEN:* ]] && ok "凭据路径被 FORBIDDEN 拦截" || no "凭据路径未被拦截: $R2"

echo "== [6] 设备 shell 通道状态（单次只读询问，不重试） =="
if command -v adb-shell >/dev/null 2>&1; then
  DS=$(adb-shell 'id' 2>&1 | head -1)
  printf '  adb-shell → %s\n' "$DS"
  [[ "$DS" == *DEVICE_CHANNEL_UNAVAILABLE* ]] && ok "设备 shell 通道未连接（与台账一致）" || no "设备 shell 通道状态与台账不一致: $DS"
else
  no "adb-shell 不在 PATH"
fi

echo "== [7] 监听面与信任边界（环回绑定） =="
ss -ltn 2>/dev/null | grep -E '3090' | grep -vE '127\.0\.0\.1|\[::1\]' >/dev/null \
  && no "3090 存在非环回监听" || ok "3090 仅环回监听（无 0.0.0.0）"
stat -c '  token 文件 %a %U:%G %s bytes' "$TOKFILE"

echo
if [ "$FAIL" -eq 0 ]; then echo "RESULT=ALL_PASS"; exit 0; else echo "RESULT=HAS_FAIL"; exit 1; fi
