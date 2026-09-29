# zhekk 工具可用性索引

> 基于环境实际扫描结果。**禁止凭经验猜路径**。
> 环境：Android 16 · 一加 OPD2413 · proot Ubuntu 24.04.4 (aarch64) · 6 运行时

## 6 运行时环境

| 运行时 | 状态 | 用途 |
|--------|:----:|------|
| Node.js | ✅ | JS 安全工具 / Playwright 浏览器引擎依赖 |
| Python 3.12.3 | ✅ | 渗透主力运行时 / 58 脚本 |
| SSH (ssh+sshpass) | ✅ | KaliDroid 双执行层互备 (:9922) |
| Java (javac/java) | ✅ | APK 逆向链 / ysoserial / jadx |
| Rust (Cargo) | ✅ | 源码编译 Rust 系新工具 |
| Go | ✅ | 编译 Go 系侦察工具（最关键） |

## 已安装安全工具 (33+)

| 工具 | 路径 | 状态 |
|------|------|:----:|
| nmap | /usr/bin/nmap | ✅ |
| nuclei | /usr/local/bin/nuclei | ✅ |
| masscan | /usr/bin/masscan | ✅ |
| sqlmap | /usr/bin/sqlmap | ✅ |
| ffuf | /usr/local/bin/ffuf | ✅ |
| wpscan | /usr/local/bin/wpscan | ✅ |
| hydra | /usr/bin/hydra | ✅ |
| john | /usr/sbin/john | ✅ |
| hashcat | /usr/bin/hashcat | ✅ |
| searchsploit | /usr/local/bin/searchsploit | ✅ |
| frida 17.16.4 | /usr/local/bin/frida | ✅ |
| apktool | /usr/local/bin/apktool | ✅ |
| jadx | /usr/local/bin/jadx | ✅ |
| radare2 | /usr/bin/radare2 | ✅ |
| objdump | /usr/bin/objdump | ✅ |
| strings | /usr/bin/strings | ✅ |
| scapy | Python | ✅ |
| adb 1.0.41 | /opt/android-sdk/platform-tools/adb | ✅ |
| binwalk | /usr/bin/binwalk | ✅ |
| qemu-arm-static | /usr/bin/qemu-arm-static | ✅ |
| airodump-ng | /usr/local/sbin/airodump-ng | ✅ |
| aircrack-ng | /usr/local/bin/aircraft-ng | ✅ |
| proxychains | /usr/bin/proxychains | ✅ |
| torsocks | /usr/bin/torsocks | ✅ |
| strace | /usr/bin/strace | ✅ |
| tcpdump | /usr/bin/tcpdump | ✅ |
| foremost | /usr/bin/foremost | ✅ |
| tshark | /usr/bin/tshark | ✅ |
| gdb | /usr/bin/gdb | ✅ |
| screen | /usr/bin/screen | ✅ |
| mosquitto_sub | /usr/bin/mosquitto_sub | ✅ |
| sslscan | /usr/bin/sslscan | ✅ |
| ab | /usr/bin/ab | ✅ |
| hcitool | /usr/bin/hcitool | ✅ |
| impacket | pip (0.13.1) | ✅ |
| pwntools | pip (4.15.0) | ✅ |

## 可通过 Go 编译安装（环境已装 Go）

```bash
export PATH=$PATH:~/go/bin
```

| 工具 | 安装命令 | 用途 |
|------|---------|------|
| subfinder | `go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest` | 子域名枚举 |
| dnsx | `go install github.com/projectdiscovery/dnsx/cmd/dnsx@latest` | DNS 解析/反查 |
| naabu | `go install github.com/projectdiscovery/naabu/v2/cmd/naabu@latest` | 端口扫描 |
| katana | `go install github.com/projectdiscovery/katana/cmd/katana@latest` | 爬虫 |
| httpx | `go install github.com/projectdiscovery/httpx/cmd/httpx@latest` | HTTP 探测 |

## 可通过 npm 安装（环境已装 Node.js）

| 工具 | 安装命令 | 用途 |
|------|---------|------|
| Playwright | `npx playwright install chromium` | 浏览器引擎（反爬主力） |
| retire | `npm install -g retire` | 依赖漏洞扫描 |

## 可通过 SSH 调用 KaliDroid（:9922）

```bash
sshpass -p {password} ssh -p 9922 root@127.0.0.1 "{command}"
```

| 工具 | KaliDroid 执行 | 用途 |
|------|---------------|------|
| msfconsole | `ssh ... "msfconsole -q -x 'use exploit/...;set RHOSTS ...;run'"` | Metasploit |
| responder | `ssh ... "responder -I eth0 -rdwv"` | LLMNR/NBT-NS 毒化 |
| bloodhound | `ssh ... "bloodhound-python -u user -p pass -d domain"` | AD 分析 |
| crackmapexec | `ssh ... "crackmapexec smb {target} -u user -p pass"` | 内网批量 |

## 缺失工具 (11个) — 有替代方案

| 工具 | 替代方案 | 原因 |
|------|---------|------|
| crackmapexec | hydra + ssh + nmap / KaliDroid | netexec pip源不可用 |
| msfconsole | searchsploit + nuclei / KaliDroid | >500MB，proot不适合 |
| burpsuite | 浏览器引擎(Playwright) + curl | 需Java GUI，Android无桌面 |
| responder | scapy / KaliDroid | raw socket，proot受限 |
| bloodhound | 手动枚举AD / KaliDroid | 需Neo4j+浏览器 |
| sstimap | 手工: {{7*7}} ${7*7} | pip安装超时 |
| xsstrike | 手工: 上下文逃逸 | pip安装超时 |
| naabu | nmap + masscan / `go install` | 可Go编译 |
| yara | grep + strings | 需编译 |
| aws | curl 替代 | 非本地环境 |
| kubectl | curl k8s API | 非本地环境 |

## Python 安全库

| 库 | 状态 |
|----|:----:|
| scapy 2.7.0 | ✅ |
| requests 2.34.2 | ✅ |
| frida 17.16.4 | ✅ |
| paramiko 5.0.0 | ✅ |
| pycryptodome 3.23.0 | ✅ |
| pillow 12.3.0 | ✅ |
| impacket 0.13.1 | ✅ |
| pwntools 4.15.0 | ✅ |

## 平台引擎（7 引擎联动）

| 引擎 | 调用方式 | 用途 |
|------|---------|------|
| terminal | `super_admin:terminal` | Linux 命令执行（proot Ubuntu） |
| ADB | `super_admin:shell` | Android 设备调试（Shizuku/Root） |
| browser | `browser` 包 | Playwright 浏览器自动化（反爬主力） |
| visit_web | `visit_web` / `download_file` | 网页访问/文件下载 |
| search | `tavily` / `various_search` | 搜索引擎查询 |
| HTTP | `extended_http_tools` | HTTP 请求（带 Header/Cookie 控制） |
| 加载 | `use_package("zhekk")` | Skill 包加载 |
