# 应急响应模块 (Incident Response)

> NIST SP 800-61: 检测→遏制→根因→恢复→复盘
> 环境：ps/netstat/lsof✅ tcpdump✅ strace✅ foremost✅ tshark✅

---

## 知识锚点（Playbook + H1 案例）

> 应急响应的根因分析往往对应"信息泄露/权限管理"类漏洞，对接 playbook 让复盘结论可复用。

### 关联 Playbook

- `references/playbooks/info-disclosure.md` — 入侵过程中的数据渗出、日志泄露走信息泄露 playbook 评估影响
- `references/playbooks/unauth-access.md` — 横向移动、后门账号、SSH 密钥植入走未授权访问 playbook

### 关联 H1 案例（references/h1-reports/by-weakness/）

- `information-disclosure.md` — 入侵过程中暴露的敏感数据泄露
- `improper-privilege-management.md` — 提权、后门账号、SUID 滥用等权限管理缺陷

### Payload / 工具

- 检测脚本 / 时间线合成 / 遏制操作模板：脚本已内联于下方各阶段段落，直接复制执行
- 工具链：ps/netstat/lsof（检测）→ tcpdump/tshark（网络取证）→ strace（行为追踪）→ foremost（数据恢复）→ /proc（内存取证）

## 底层原理：应急响应不是"关服务器"，是"在最短时间内最小化损失"

```
应急响应的核心矛盾：
- 速度 vs 完整性：越快遏制，损失越小；但太快可能破坏证据
- 隔离 vs 业务连续性：断开网络最安全，但业务不能停
- 取证 vs 恢复：取证需要保持现场，但用户需要恢复服务

处理原则：
1. 先遏制，再取证（损失优先）
2. 先拍照，再操作（证据优先）
3. 先隔离，再清理（安全优先）
4. 先备份，再分析（数据优先）
```

---

## 严重级别 (SEV)

```
SEV1 (15分钟响应): 核心业务中断、数据泄露、正在进行的攻击
SEV2 (30分钟响应): 部分业务受影响、发现后门、异常外联
SEV3 (2小时响应):  疑似入侵、异常登录、策略违规
SEV4 (24小时响应): 低风险告警、日常异常、合规检查
```

---

## 阶段1：检测 — 发现入侵

```bash
# === 1. 进程异常检测 ===
# 异常进程名（伪装的进程）
ps aux | grep -vE "\[|kworker|migration" | awk '{print $11}' | sort | uniq -c | sort -rn
# 高风险进程名
ps aux | grep -iE "nc |ncat|socat|meterpreter|shell|backdoor|payload|beacon|miner|crypto"

# CPU/内存异常
ps aux --sort=-%cpu | head -20    # CPU 占用最高的进程
ps aux --sort=-%mem | head -20    # 内存占用最高的进程
# 如果某个不认识的进程 CPU 100%，可能是挖矿

# 隐藏进程检测
# 对比 /proc 和 ps 输出
ls /proc/ | grep -E '^[0-9]+$' | sort > /tmp/proc_list
ps -eo pid | sort > /tmp/ps_list
diff /tmp/proc_list /tmp/ps_list
# 差异 = 隐藏进程（被 rootkit 隐藏）

# === 2. 网络连接异常 ===
# 异常外联
netstat -antp | grep ESTABLISHED | grep -vE "127.0.0.1|::1"
# 监听端口
netstat -tlnp | grep -v "127.0.0.1"
# 关注：高端口监听（> 10000）、非标准端口上的已知服务

# DNS 异常
# 大量 DNS 查询可能是 C2 通信
tcpdump -i any port 53 -c 100 | grep -oE '[a-zA-Z0-9.-]+\.(com|net|org|io|xyz|top|tk|ml|ga|cf)'

# === 3. 用户异常 ===
# 异常登录
last -20                              # 最近登录
who                                   # 当前在线
w                                     # 当前活动
grep "Accepted" /var/log/auth.log | tail -20  # SSH 登录记录
grep "Failed" /var/log/auth.log | tail -20    # 失败登录

# 新增用户
grep -E ":/bin/(bash|sh)$" /etc/passwd | tail -20
cat /etc/shadow | grep -vE ":\*|:!" | tail -20

# === 4. 文件异常 ===
# 最近修改的文件（可能是 Webshell/后门）
find /var/www -type f -mtime -1 -ls        # 最近24小时修改的Web文件
find / -type f -perm -4000 -mtime -7 -ls   # 最近7天新增的SUID文件
find /tmp -type f -mtime -1 -ls            # /tmp 下的新文件
find / -name "*.php" -mtime -1 -ls         # 最近24小时的PHP文件

# 异常文件路径
# Webshell 常见位置
find /var/www -name "*.php" -exec grep -l "eval\|exec\|system\|shell_exec\|passthru\|base64_decode" {} \;
# 后门常见位置
find / -name "*.sh" -newer /etc/passwd -ls 2>/dev/null

# === 5. 持久化机制检测 ===
# Crontab 后门
for user in $(cut -d: -f1 /etc/passwd); do
  echo "=== $user ==="
  crontab -u $user -l 2>/dev/null
done
cat /etc/crontab /etc/cron.d/* /etc/cron.hourly/* /etc/cron.daily/* 2>/dev/null

# Systemd 后门
systemctl list-units --type=service --state=running | grep -vE "systemd|network|ssh|cron|rsyslog"

# SSH 后门
cat ~/.ssh/authorized_keys 2>/dev/null
cat /root/.ssh/authorized_keys 2>/dev/null

# LD_PRELOAD 后门
cat /etc/ld.so.preload 2>/dev/null
env | grep LD_PRELOAD

# .bashrc 后门
grep -r "alias\|nc\|curl\|wget\|bash -i\|python" ~/.bashrc /root/.bashrc 2>/dev/null
```

---

## 阶段2：遏制 — 阻止扩散

```bash
# 1. 网络隔离（最小化影响）
# 封锁恶意IP
iptables -A INPUT -s {恶意IP} -j DROP
iptables -A OUTPUT -d {恶意IP} -j DROP
# 封锁可疑端口
iptables -A OUTPUT -p tcp --dport {可疑端口} -j DROP

# 2. 用户隔离
# 锁定被入侵的账户
passwd -l {被入侵用户}
# 踢出恶意会话
pkill -9 -u {被入侵用户}

# 3. 进程隔离
# 暂停可疑进程（不杀，保留取证）
kill -STOP {PID}
# 确认后终止
kill -9 {PID}

# 4. 服务隔离
# 停止被利用的服务
systemctl stop nginx  # 或者 apache2
# 保持服务离线但保留配置
systemctl disable nginx
```

---

## 阶段3：根因分析

```bash
# 1. 时间线重建
# 从日志中重建攻击时间线
grep -h "Accepted\|Failed\|session opened\|session closed\|COMMAND" /var/log/auth.log | sort

# 2. 入侵路径分析
# 检查 Web 日志中的攻击 payload
grep -iE "union select|or 1=1|eval\(|exec\(|\.\./\.\./|cmd=|wget |curl " /var/log/nginx/access.log
grep -iE "POST.*php|POST.*jsp|POST.*asp" /var/log/nginx/access.log | grep -v "200 "

# 3. 横向移动分析
# 检查 SSH 连接记录
grep "Accepted" /var/log/auth.log | awk '{print $9, $11}' | sort | uniq -c
# 检查 sudo 使用
grep "sudo.*COMMAND" /var/log/auth.log | tail -50

# 4. 数据渗出分析
# 异常大的出站流量
tcpdump -i any -c 1000 -w exfil.pcap
tshark -r exfil.pcap -Y "tcp.len > 1000" -T fields -e ip.dst -e tcp.dstport -e frame.len | sort -rnk3

# 5. 内存取证
# 用 foremost 提取进程内存中的关键数据
cat /proc/{PID}/maps
# 用 strings 提取内存中的字符串
strings /proc/{PID}/mem 2>/dev/null | grep -iE "password|key|secret|http|https" | head -50
```

---

## 阶段4：恢复

```bash
# 1. 移除恶意文件
# 定位后门文件
find / -name "*.php" -newer /etc/passwd -exec grep -l "eval\|exec\|shell_exec" {} \; 2>/dev/null
# 删除前备份
cp /path/to/backdoor.php /evidence/backdoor.php.bak
rm /path/to/backdoor.php

# 2. 重置凭据
# 所有受影响用户的密码
passwd {user}
# 重置 SSH 密钥
mv ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak

# 3. 修补漏洞
# 更新系统
apt update && apt upgrade -y
# 修复 Web 漏洞（根据根因分析结果）

# 4. 恢复备份
# 从干净的备份恢复数据
# 注意：先确认备份未被感染
```

---

## 本机环境速查

```
已安装: ps/netstat/lsof✅ tcpdump✅ strace✅ foremost✅ tshark✅ gdb✅
缺失:   volatility(内存取证) / sleuthkit(磁盘取证) / auditd(审计)
替代:   /proc 文件系统分析替代内存取证
        foremost + strings 替代磁盘取证
        通过日志分析替代 auditd

proot 限制: 无法加载内核模块（auditd等），但用户态分析完全可用
```

---

## 威胁狩猎 (Threat Detection — threat-detection 能力)

> 主动搜寻已绕过自动化防御的攻击者活动
> 与应急响应的区别：应急响应是"警报响了再处理"，威胁狩猎是"警报没响自己找"

### 底层原理：狩猎不是"搜所有日志"，是"假设驱动的搜索"

```
威胁狩猎五步循环：
1. 假设：攻击者可能用 X 技术（MITRE ATT&CK Txxxx）
2. 数据源：哪些日志能验证这个假设？
3. 查询：在数据源中搜索 TTP 特征
4. 分类：命中是真阳性还是假阳性？
5. 反馈：如果确认，更新检测规则 → 下次警报自动捕获

假设优先级公式：
优先级 = 威胁相关性 ×3 + 控制缺口 ×2 + 数据可用性 ×1
```

### 高价值狩猎假设（15个）

```
假设1: WMI 横向移动 (T1047)
  数据源: ps aux 查看进程树
  搜索: wmic.exe / wmiprvse.exe 被非系统进程启动

假设2: LOLBin 执行 (T1218)
  数据源: 进程创建日志
  搜索: certutil.exe|regsvr32.exe|mshta.exe 有网络连接
  本机: ps aux | grep -E "certutil|regsvr32|mshta"

假设3: 信标 C2 通信 (T1071.001)
  数据源: DNS/代理日志
  搜索: 固定间隔的出站连接（±10%抖动）
  本机: tcpdump 抓包 → 分析连接间隔

假设4: Pass-the-Hash (T1550.002)
  数据源: 认证日志
  搜索: NTLM 认证从不寻常的源主机
  本机: 不适用（需要Windows域环境）

假设5: LSASS 内存访问 (T1003.001)
  数据源: 进程内存访问
  搜索: 非系统进程打开 lsass.exe
  本机: ps aux | grep lsass (Linux 无此风险)

假设6: Kerberoasting (T1558.003)
  数据源: Windows 事件 4769
  搜索: 大量 TGS 请求
  本机: 不适用（需要Windows域环境）

假设7: 计划任务持久化 (T1053.005)
  数据源: 计划任务创建
  搜索: 非标准目录的计划任务
  本机: crontab -l(所有用户) + cat /etc/cron*

假设8: SSH 横向移动 (T1021.004)
  数据源: SSH 日志
  搜索: 从一个主机突然 SSH 到多个主机
  本机: grep "Accepted" /var/log/auth.log | awk '{print $11}' | sort | uniq -c

假设9: 数据渗出 via DNS (T1048.003)
  数据源: DNS 查询日志
  搜索: 异常长的域名查询（>50字符）
  本机: tcpdump port 53 → tshark 分析查询长度

假设10: 数据渗出 via HTTP POST (T1048.002)
  数据源: 代理日志
  搜索: 异常大的出站 POST 请求
  本机: tcpdump → tshark 分析出站流量大小

假设11: WebShell 上传 (T1505.003)
  数据源: Web 访问日志
  搜索: POST .php/.jsp/.asp 文件，返回 200
  本机: grep "POST.*\.php" /var/log/nginx/access.log | grep -v "404\|403"

假设12: 新增用户 (T1136)
  数据源: /etc/passwd, /etc/shadow
  搜索: 最近修改的账户文件
  本机: find /etc/passwd /etc/shadow -mtime -7

假设13: SUID 后门 (T1548.001)
  数据源: 文件系统
  搜索: 最近新增的 SUID 文件
  本机: find / -perm -4000 -mtime -7 -ls 2>/dev/null

假设14: LD_PRELOAD 劫持 (T1574.006)
  数据源: 环境变量、ld.so.preload
  搜索: 异常 LD_PRELOAD 设置
  本机: cat /etc/ld.so.preload && env | grep LD_PRELOAD

假设15: 挖矿进程 (T1496)
  数据源: 进程列表
  搜索: CPU 100% 的未知进程
  本机: ps aux --sort=-%cpu | head -10
```

### IOC 时效性管理

```
IOC 类型         过期阈值    搜索目标
─────────────────────────────────────
IP 地址          30天        防火墙日志、NetFlow
域名             30天        DNS 解析日志、代理日志
文件哈希         90天        EDR 文件创建、AV 扫描
URL              14天        代理访问日志
Mutex 名称       180天       EDR 运行时工件

规则：超过阈值的 IOC 标记为 stale，排除出搜索
      用新鲜 IOC 搜索，避免误报膨胀
```

### z-score 异常检测（统计方法）

```bash
# 不用机器学习，用简单的统计方法检测异常
# z-score = (当前值 - 历史均值) / 历史标准差

python3 << 'EOF'
import statistics

# 历史基线数据（过去14天，每小时的DNS查询量）
baseline = [100, 110, 95, 105, 98, 102, 108, 97, 103, 101, 99, 106, 104, 100]

# 当前值
current = 450  # 突然飙升

mean = statistics.mean(baseline)
stdev = statistics.stdev(baseline)
z_score = (current - mean) / stdev

print(f"历史均值: {mean:.0f}, 标准差: {stdev:.0f}")
print(f"当前值: {current}, z-score: {z_score:.1f}")

if z_score < 2.0:
    print("正常 → 无需操作")
elif z_score < 3.0:
    print("软异常 → 记录并监控，增加采样频率")
else:
    print("!! 硬异常 → 升级为安全事件，立即调查")
EOF

# 需要基线：至少14天历史数据
# 基线需在以下情况后重新计算：
#   - 安全事件后（行为模式改变）
#   - 重大基础设施变更（云迁移、新SaaS部署）
#   - 季节性变化（季度末、节假日）
```

### 蜜罐/欺骗资产

```
任何与蜜罐的交互 = 明确的安全信号，直接升级为 SEV2

蜜罐类型：
- 蜜罐凭据：在密码库中放置假凭据 → 检测凭据盗窃
- 蜂蜜令牌：在代码仓库中放置假 AWS 密钥 → 检测泄露扫描
- 蜜罐文件：在文件共享中放置 "passwords.xlsx" → 检测横向移动
- 蜜罐账户：在 AD 中放置休眠账户 → 检测凭据枚举
- 蜜罐服务：在DMZ中放置假服务 → 检测网络扫描
```

---

## 反爬钩子

> 应急响应以本地分析为主，反爬场景集中在样本获取与在线情报查询环节。

- **本地响应不涉及反爬**：进程分析、网络抓包、日志取证、遏制操作全部在本地完成
- **下载样本/上传分析平台可能遇反爬**：从样本库下载恶意文件、上传 PCAP 到在线分析服务时，可能遇到速率限制或登录验证
- **在线威胁情报查询有配额**：查询 IOC、威胁情报平台时有 API 配额和反爬策略
- **应对策略**：详见 `references/methodology/06-anti-antibot.md`，本地响应保持原节奏，在线查询时使用官方 API Key 并控制 QPS