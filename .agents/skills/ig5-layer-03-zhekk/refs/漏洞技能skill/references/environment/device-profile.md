# 设备环境档案

> AI 执行任务前 MUST 先读此文件。基于用户描述的真实环境。

## 硬件

```
设备: Android 16 · 一加 OPD2413 平板
架构: aarch64 (ARM64 原生，非模拟转译)
内核: Linux 6.6.89-android15-8（共享宿主内核，非独立内核）
磁盘: 460GB (已用 239GB, 可用 222GB)
网络: WiFi 192.168.1.8, 可访问外网
身份: uid=0(root) gid=0(root) —— 假 root（proot 用户态模拟，无内核级权限）
```

## 容器环境

```
容器: proot（无 root，用户态模拟）
发行版: Ubuntu 24.04.4 LTS (Noble Numbat)
Python: 3.12.3
终端: proot 内 Linux 命令行
```

## 6 运行时环境（环境配置页六项全选，实测全部已装）

```
├── Node.js ✓（Operit 必需）
│   └── npm 生态：JS 系安全工具、浏览器自动化(Playwright)依赖
├── Python ✓（Operit 必需）
│   └── 渗透主力运行时：sqlmap 本体、pip 可装
│       requests / pwntools / impacket / scapy / pycryptodome 等任意 Python 安全库
├── SSH 工具 ✓
│   └── ssh + sshpass：通往 KaliDroid（:9922）的桥
│       密码认证可自动化——双执行层互备的关键
├── Java ✓
│   └── javac/java：APK 逆向链（jadx 类工具）
│       ysoserial 等 Java 系审计工具的运行前提
├── Rust (Cargo) ✓
│   └── 可源码编译 Rust 系新工具，兜底用
└── Go ✓ ← 最关键的一项
    └── 现代侦察工具几乎全是 Go 单二进制：
        nuclei / ffuf / httpx 就是靠它装的
        待补的 subfinder / dnsx / naabu / katana 也靠它
```

## 已安装安全工具 (33+)

```
扫描:    nmap✅ nuclei✅ masscan✅ sslscan✅
Web:     sqlmap✅ ffuf✅ wpscan✅ ab✅
密码:    hydra✅ john✅ hashcat✅
移动:    adb 1.0.41✅ frida 17.16.4✅ apktool✅ jadx✅
逆向:    radare2✅ gdb✅ objdump✅ strings✅
CVE:     searchsploit✅
网络:    scapy✅ tcpdump✅ tshark✅ impacket 0.13.1✅
IoT:     binwalk✅ qemu-arm-static✅ mosquitto_sub✅
无线:    airodump-ng✅ aircrack-ng✅ hcitool✅
隐身:    proxychains✅ torsocks✅ screen✅
取证:    foremost✅ strace✅
利用:    pwntools 4.15.0✅
```

## 可通过 Go 编译安装的工具（环境已装 Go）

```bash
# 编译后二进制在 ~/go/bin/，加入 PATH 即可用
export PATH=$PATH:~/go/bin

go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest  # 子域名枚举
go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest              # DNS 解析
go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest        # 端口扫描
go install -v github.com/projectdiscovery/katana/cmd/katana@latest          # 爬虫
go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest            # HTTP 探测（如未装）
go install -v github.com/ffuf/ffuf/v2@latest                                # 目录爆破（如需更新）
```

## 可通过 pip 安装的 Python 安全库

```bash
pip install pwntools impacket scapy pycryptodome requests paramiko pillow
# 以下可能 pip 超时，有替代方案：
# sstimap → 手工: {{7*7}} ${7*7}
# xsstrike → 手工: 上下文逃逸
```

## 可通过 npm 安装的 Node.js 工具

```bash
npm install -g retire        # 依赖漏洞扫描
npx playwright install chromium  # 浏览器引擎（反爬主力）
```

## 缺失工具 (11个) — 有替代方案

```
crackmapexec❌ → hydra+ssh+nmap (netexec pip源不可用)
msfconsole❌   → searchsploit+nuclei (>500MB, proot不适合) / SSH到KaliDroid
burpsuite❌    → 浏览器引擎(Playwright)+curl (需Java GUI)
responder❌    → scapy (需raw socket, proot受限) / SSH到KaliDroid
bloodhound❌   → 手动枚举AD (需Neo4j+浏览器) / SSH到KaliDroid
sstimap❌      → 手工: {{7*7}} ${7*7} (pip超时)
xsstrike❌     → 手工: 上下文逃逸 (pip超时)
naabu❌        → nmap+masscan / go install 编译
yara❌         → grep+strings (需编译)
aws❌          → curl替代 (非本地环境)
kubectl❌      → curl k8s API (非本地环境)
```

## Python 安全库

```
scapy 2.7.0✅ requests 2.34.2✅ frida 17.16.4✅
paramiko 5.0.0✅ pycryptodome 3.23.0✅ pillow 12.3.0✅
impacket 0.13.1✅ pwntools 4.15.0✅
```

## 平台引擎（7 引擎联动）

```
引擎1: terminal → Linux命令执行（proot Ubuntu）
引擎2: ADB → Android设备调试（Shizuku/Root）
引擎3: browser(Playwright) → 网页自动化（反爬主力）
引擎4: Shell(Shizuku) → Android系统命令
引擎5: visit_web/download_file → 网页访问/文件下载
引擎6: tavily/various_search → 搜索
引擎7: extended_http_tools → HTTP请求
```

## 双执行层互备

```
本机 proot Ubuntu (主力) ←─SSH:9922─→ KaliDroid (备用)
sshpass -p {password} ssh -p 9922 root@127.0.0.1 "{command}"

主力环境缺失工具时，通过 SSH 隧道调用 KaliDroid：
  msfconsole → KaliDroid 执行
  responder  → KaliDroid 执行
  bloodhound → KaliDroid 执行
```

## 环境限制

```
1. proot: 用户态模拟，无内核级权限
   - 无 raw socket（responder/scapy部分功能受限）
   - 无内核模块加载
   - 无 mount 挂载块设备
2. 假 root: uid=0 但无 CAP_SYS_ADMIN 等内核 capability
3. ARM64: x86_64 二进制需 qemu-x86_64-static 仿真
4. 无 GPU: hashcat 只能用 CPU（速度受限）
5. 无 Docker: 容器操作受限
6. WiFi 监听模式: proot 不支持（无线模块工具受限）
7. 共享宿主内核: 不能升级/替换内核
```

## 更新记录

```
2026-08-05: 安装10个缺失工具，33工具+11缺失
2026-08-07: 确认 6 运行时全部可用(Node/Python/SSH/Java/Rust/Go)
            Go 工具链就绪，可编译 subfinder/dnsx/naabu/katana
            SSH 隧道到 KaliDroid(:9922) 确认可用
            红队级增强：知识层+反爬层+商用授权框架
```
