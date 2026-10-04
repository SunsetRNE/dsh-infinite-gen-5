#!/usr/bin/env bash
# deploy_frida_server.sh — 把已校验的 frida-server 推到设备并拉起（走 DSHA 允许的 adb-shell 通道）
# 原则：不动系统目录、不碰 DCIM/Pictures/Android/data/Android/obb、不绕过设备保护；失败即报原话，不重试同一条
set -uo pipefail
export LANG=C.UTF-8 LC_ALL=C.UTF-8

FS_DIR=/opt/rev-tools/frida
LOCAL_FRIDA=$(/root/.local/share/pipx/venvs/frida-tools/bin/python -c "import frida;print(frida.__version__)" 2>/dev/null)
SRV="$FS_DIR/frida-server-${LOCAL_FRIDA}-android-arm64"
REMOTE=/data/local/tmp/frida-server

log() { printf '\n=== %s ===\n' "$*"; }
die() { printf 'STOP: %s\n' "$*"; exit 1; }

log "0. 前置校验"
echo "本地 frida-python : ${LOCAL_FRIDA:-未知}"
[ -f "$SRV" ] || die "缺少 $SRV（先跑 fetch_frida_server.sh）"
echo "server 指纹       : $(file -b "$SRV")"
echo "server sha256     : $(sha256sum "$SRV" | cut -d' ' -f1)"
command -v adb-shell >/dev/null 2>&1 || die "adb-shell 不存在，设备通道不可用"

log "1. 探测设备通道（单次，不重试）"
OUT=$(timeout 25 adb-shell id 2>&1); RC=$?
echo "$OUT"
if echo "$OUT" | grep -qE 'EXECUTION_UNKNOWN|URLError|\[EXIT=125\]|POLICY_BLOCKED|DISABLED|NO_PERMISSION'; then
  die "设备桥未就绪：$OUT —— 桥不可用时不要重复调用同一条；请到 App 内「设置 → 设备能力授权」检查桥接/授权状态后重跑本脚本"
fi
ABI=$(timeout 25 adb-shell getprop ro.product.cpu.abi 2>&1 | tr -d '\r' | tail -1)
SDK=$(timeout 25 adb-shell getprop ro.build.version.sdk 2>&1 | tr -d '\r' | tail -1)
echo "设备 ABI=$ABI  SDK=$SDK"
case "$ABI" in
  arm64-v8a) [ -n "${SRV##*android-arm64}" ] || true ;;
  *) die "设备 ABI=$ABI 与已下载的 android-arm64 server 不匹配，需换对应架构的 frida-server" ;;
esac

log "2. 推送 server 到 /data/local/tmp（只写这一处，不碰系统目录）"
adb-shell "mkdir -p /data/local/tmp" 2>&1 | tail -2
# 无通用 push 端点时：用 base64 分块经 shell 落盘
B64=$(base64 -w0 "$SRV")
SIZE=${#B64}
echo "base64 长度 = $SIZE"
adb-shell "rm -f $REMOTE.b64 $REMOTE" 2>&1 | tail -1
CHUNK=65536
i=0
while [ $i -lt $SIZE ]; do
  PART=${B64:$i:$CHUNK}
  adb-shell "printf '%s' '$PART' >> $REMOTE.b64" >/dev/null 2>&1 || die "写入分片失败 @offset=$i"
  i=$((i+CHUNK))
  printf '\r  已写 %d/%d 字节' "$i" "$SIZE"
done
echo
adb-shell "base64 -d $REMOTE.b64 > $REMOTE && chmod 755 $REMOTE && rm -f $REMOTE.b64 && ls -l $REMOTE" 2>&1 | tail -3

log "3. 拉起 frida-server（root 下后台运行，仅监听本地）"
adb-shell "su -c '$REMOTE -D &' " 2>&1 | tail -3
sleep 3
adb-shell "ps -A -o PID,NAME 2>/dev/null | grep -i frida || ps -A | grep -i frida" 2>&1 | tail -5

log "4. 主机侧连接校验"
timeout 20 frida-ps -U 2>&1 | head -8 || echo "frida-ps -U 失败：确认 server 已在设备上运行，且 USB/网络转发就绪（adb forward tcp:27042 tcp:27042）"
cat <<'TIP'

后续用法：
  frida-ps -U                                   # 列设备进程
  frida -U -f TARGET_PKG -l /root/仓库合集/env-restore/frida/android_hook.js --no-pause
  frida -U -n TARGET_PROC -l /root/仓库合集/env-restore/frida/android_hook.js
清理（不影响系统）：
  adb-shell "su -c 'pkill -f $REMOTE'"
TIP
