# IoT/固件安全模块

> 固件提取/binwalk/仿真/串口/MQTT/UPnP
> 环境：binwalk✅ qemu-arm-static✅ mosquitto_sub✅ nmap✅ strings✅

---

## 知识锚点（Playbook + H1 案例）

> 在动手分析固件之前，先对齐已有的 playbook 和真实 H1 报告，避免重复造轮子。

### 关联 Playbook

- `references/playbooks/rce/00-index.md` — IoT 设备最常见的高危出口是命令注入/RCE，固件中的 CGI 脚本、UPnP SOAP、调试 shell 都是典型入口
- `references/playbooks/unauth-access.md` — MQTT broker、UPnP 服务、Telnet/SSH 后台常默认无认证或弱认证，直接套未授权访问 playbook
- `references/playbooks/info-disclosure.md` — 固件解包后的硬编码凭据、密钥、API token 走信息泄露 playbook 的"静态凭据"分支
- `references/playbooks/mobile.md` — IoT 设备通常配套移动端 App，App 与设备间的配对/控制协议是另一个攻击面

### 关联 H1 案例（references/h1-reports/by-weakness/）

- `os-command-injection.md` — 固件 Web 界面 ping/diag 接口的命令拼接
- `use-of-default-credentials.md` — 出厂默认密码、硬编码后门账号
- `improper-authentication-generic.md` — MQTT/UPnP 缺失认证或可绕过

### Payload / 工具

- 固件硬编码凭据提取 / MQTT topic 枚举 / UPnP SOAP 注入：用 `strings` + `grep` 从固件解包结果中即时提取，`mosquitto_sub -t "#"` 枚举全 topic
- 工具链：binwalk（解包）→ qemu-arm-static（仿真）→ mosquitto_sub（MQTT）→ nmap（服务发现）→ strings（凭据提取）
- 默认凭据字典：`references/dictionaries/default-credentials-cn.md`

## 底层原理：IoT安全不是"网络层"，是"物理+网络+固件"

```
IoT攻击面三层：
1. 物理层 — 串口/JTAG/SPI Flash/拆机
2. 固件层 — 固件提取/解包/逆向/后门/硬编码凭据
3. 网络层 — MQTT/UPnP/mDNS/CoAP/自定义协议

当前环境优势：ARM64原生，qemu可直接仿真ARM固件
```

---

## 固件分析

```bash
# 1. 固件提取
# 从设备：用SPI Flash编程器读取
# 从OTA更新：抓包获取固件包
# 已有固件文件
file firmware.bin
binwalk firmware.bin

# 2. 解包
binwalk -e firmware.bin
binwalk -Me firmware.bin  # 递归提取

# 3. 分析文件系统
cd _firmware.bin.extracted/
find . -name "*.conf" -o -name "*.cfg" -o -name "*.ini"
grep -r "password\|admin\|root\|secret\|key" .
grep -r "http://\|https://" . | grep -v "xmlns"
strings squashfs-root/bin/* | grep -iE "password|backdoor|debug|shell"

# 4. 仿真运行
# ARM固件用qemu仿真
cp $(which qemu-arm-static) squashfs-root/
chroot squashfs-root ./qemu-arm-static /bin/sh
```

---

## MQTT 安全

```bash
# MQTT服务发现
nmap -p 1883,8883 --script mqtt-subscribe target

# 订阅所有主题
mosquitto_sub -h target -t "#" -v

# 未授权检测
mosquitto_sub -h target -t "$SYS/#" -v  # 系统主题
```

---

## 本机环境速查

```
已安装: binwalk✅ qemu-arm-static✅ mosquitto_sub✅ nmap✅ strings✅
缺失: firmware-mod-kit❌ → binwalk + qemu替代
      jtagulator❌ → 需要硬件
```

---

## 反爬钩子

> IoT 安全场景的反爬特征与 Web 渗透不同，需区分对待。

- **设备本体通常无 WAF**：MQTT/CoAP/UPnP/串口等协议直接暴露，模糊测试和枚举一般不会触发反爬机制
- **管理界面（Web UI）可能有 WAF/速率限制**：部分厂商在云端管理后台部署了 WAF 或 Nginx 限速，批量枚举默认凭据、命令注入测试时可能被拦截
- **OTA 下载源可能有 CDN 防护**：从厂商 CDN 抓取固件包时可能遇到 Cloudflare/Akamai 的反爬挑战
- **应对策略**：详见 `references/methodology/06-anti-antibot.md`，对设备本地协议保持正常测试节奏，对云端管理界面按 Web 渗透的反爬策略降速