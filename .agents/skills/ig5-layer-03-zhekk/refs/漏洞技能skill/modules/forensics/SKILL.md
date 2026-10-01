# 数字取证模块 (Forensics)

> 内存取证/磁盘取证/PCAP分析/时间线重建/Android取证
> 环境：foremost✅ tcpdump✅ tshark✅ strace✅ strings✅ python3✅

---

## 知识锚点（Playbook + H1 案例）

> 取证的产出往往能直接佐证某类漏洞的真实影响，对接 playbook 让证据更具说服力。

### 关联 Playbook

- `references/playbooks/info-disclosure.md` — 取证中发现的明文存储凭据、日志泄露的敏感信息，走信息泄露 playbook 组织报告

### 关联 H1 案例（references/h1-reports/by-weakness/）

- `information-disclosure.md` — 日志/内存/磁盘取证中暴露的敏感数据
- `cleartext-storage-of-sensitive-information.md` — 数据库、配置文件、SharedPreferences 中的明文存储

### Payload / 工具

- 日志解析正则 / 时间线合成脚本 / Android 取证模板：脚本已内联于下方各阶段段落，直接复制执行
- 工具链：tcpdump/tshark（网络取证）→ foremost（文件雕刻）→ strings（字符串提取）→ gcore/proc（内存取证）→ adb（Android 取证）

## 底层原理：取证不是"找证据"，是"建立不可篡改的证据链"

```
取证黄金法则：
1. 不改变原始证据 — 写保护/镜像/哈希
2. 易失性优先 — 内存→网络→进程→磁盘
3. 完整记录 — 时间戳/操作者/工具/哈希
4. 双重保管 — 证据转移需两人签名

当前环境(Android proot)限制：
- 无写保护硬件 → 用只读挂载替代
- 无专业取证工具(FTK/EnCase) → foremost + strings + tcpdump
- 内存取证受限 → /proc 文件系统分析
- 但Android设备取证能力独特（ADB提取）
```

---

## 阶段1：易失性证据收集（最先，重启丢失）

```bash
# 1. 内存信息
cat /proc/meminfo
cat /proc/iomem
# 进程内存dump
gcore -o memdump $(pgrep -f target_process)
# 或者用 /proc
cat /proc/$(pgrep -f target_process)/maps
cat /proc/$(pgrep -f target_process)/smaps

# 2. 网络连接
netstat -antp > netstat.txt
ss -antp > ss.txt
cat /proc/net/tcp /proc/net/udp

# 3. 运行进程
ps auxf > ps.txt
ls -la /proc/*/exe 2>/dev/null
lsof -i -n -P > lsof.txt

# 4. 登录用户
who > who.txt
w > w.txt
last -20 > last.txt

# 5. 内核模块
lsmod > lsmod.txt
cat /proc/modules

# 6. 环境变量
env > env.txt
cat /proc/*/environ 2>/dev/null > proc_environ.txt
```

---

## 阶段2：PCAP 网络取证

```bash
# 1. 抓包
tcpdump -i any -w capture.pcap -c 5000

# 2. 分析
# DNS查询
tshark -r capture.pcap -Y "dns" -T fields -e frame.time -e dns.qry.name -e dns.a
# HTTP请求
tshark -r capture.pcap -Y "http.request" -T fields -e frame.time -e http.host -e http.request.uri
# 异常连接
tshark -r capture.pcap -Y "tcp.flags.syn==1 and tcp.flags.ack==0" -T fields -e ip.dst -e tcp.dstport | sort | uniq -c | sort -rn
# 大流量
tshark -r capture.pcap -Y "tcp.len > 1000" -T fields -e frame.time -e ip.src -e ip.dst -e tcp.len

# 3. 提取文件
# 从HTTP流量中提取文件
tshark -r capture.pcap --export-objects "http,/tmp/http_files"
# 从SMB流量中提取
tshark -r capture.pcap --export-objects "smb,/tmp/smb_files"

# 4. 会话重建
tshark -r capture.pcap -q -z conv,tcp
```

---

## 阶段3：时间线重建

```bash
# 1. 文件时间线
find /var/www -type f -printf "%T+ %p\n" | sort > file_timeline.txt
find / -type f -mtime -7 -printf "%T+ %p\n" 2>/dev/null | sort  # 最近7天

# 2. 日志时间线
grep -h "Accepted\|Failed\|session opened\|session closed" /var/log/auth.log | sort > auth_timeline.txt
grep -h "." /var/log/nginx/access.log | awk '{print $4, $1, $7, $9}' | sort > web_timeline.txt

# 3. 进程启动时间线
ps -eo pid,lstart,cmd --sort=lstart > process_timeline.txt

# 4. 合成时间线
python3 << 'EOF'
timeline = []
# 从文件时间线
with open("file_timeline.txt") as f:
    for line in f:
        parts = line.strip().split(" ", 1)
        if len(parts) == 2:
            timeline.append({"time": parts[0], "source": "file", "detail": parts[1]})
# 从auth日志
with open("auth_timeline.txt") as f:
    for line in f:
        timeline.append({"time": line[:19], "source": "auth", "detail": line.strip()})
# 排序
timeline.sort(key=lambda x: x["time"])
for t in timeline[-100:]:
    print(f"[{t['time']}] [{t['source']}] {t['detail'][:120]}")
EOF
```

---

## 阶段4：数据恢复

```bash
# 1. 文件雕刻（foremost）
foremost -i disk.img -o recovered/
foremost -t all -i disk.img -o recovered/

# 2. 删除文件恢复
# ext4文件系统
extundelete /dev/sda1 --restore-all
# 或者用 foremost 扫描原始磁盘
foremost -i /dev/sda1 -o recovered/

# 3. 字符串搜索（最后的希望）
strings disk.img | grep -iE "password|secret|key|confidential|flag"
strings disk.img | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'  # 邮箱
```

---

## Android 取证

```bash
# 用ADB提取数据
adb shell dumpsys > dumpsys.txt
adb shell getprop > build_prop.txt
adb shell pm list packages -f > packages.txt

# 提取应用数据
adb backup -apk -shared -all -f backup.ab
# 解压备份
dd if=backup.ab bs=1 skip=24 | openssl zlib -d > backup.tar

# 提取数据库
adb pull /data/data/com.target.app/databases/ ./db/
# 分析SQLite
sqlite3 app.db ".tables"
sqlite3 app.db "SELECT * FROM messages"

# 提取SharedPreferences
adb pull /data/data/com.target.app/shared_prefs/ ./prefs/
```

---

## 本机环境速查

```
已安装: foremost✅ tcpdump✅ tshark✅ strace✅ strings✅ python3✅ gdb✅
缺失: volatility❌ → /proc + gcore替代
      sleuthkit❌ → foremost + strings替代
      autopsy❌ → 手动分析替代
      extundelete❌ → apt install 可能可用
```

---

## 反爬钩子

> 数字取证以本地分析为主，反爬场景集中在样本获取与在线分析交互环节。

- **本地取证不涉及反爬**：磁盘镜像、内存 dump、PCAP 分析全部在本地完成
- **下载样本/上传分析平台可能遇反爬**：从恶意软件样本站（如沙箱平台）下载样本、上传 PCAP 到在线分析服务时，可能遇到速率限制或验证码
- **在线 Hash/IOC 查询有频率限制**：VirusTotal、AbuseIPDB 等 IOC 查询平台有 API 配额和反爬策略
- **应对策略**：详见 `references/methodology/06-anti-antibot.md`，本地分析保持原节奏，在线查询时使用官方 API Key 并控制 QPS