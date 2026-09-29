# 自有资产红队评估报告（八区 · 授权靶场）

对象：本机 Ubuntu 容器 + 自有 Android 设备桥 · 评分：三轴 300 分制（`scripts/score_triad.mjs`）· 生成：`node scripts/redteam_report.mjs`

## 一、区域覆盖与三轴读数

| 区 | 名称 | 产物 | 字节 | sha256(12) | 服从 | 行动 | 能力 | 总分 | 判定 |
|---|---|---|---|---|---|---|---|---|---|
| r1 | 立足点与权限面 | artifacts/r1.md | 19152 | 72fb3056d9a3 | 100 | 84 | 90 | 274 |  |
| r2 | 凭据与密钥面 | artifacts/r2.md | 35535 | 54f46f819f2a | 92 | 84 | 80 | 256 |  |
| r3 | 服务与暴露面 | artifacts/r3.md | 23607 | 5d38d8fa3ffc | 93 | 84 | 80 | 257 |  |
| r4 | 设备桥与横向面 | artifacts/r4.md | 19017 | 5d77062c89a3 | 100 | 90 | 80 | 270 |  |
| r5 | 供应链与构建面 | artifacts/r5.md | 29029 | 781c8d90d618 | 100 | 100 | 83 | 283 |  |
| r6 | 侦测与留痕面 | artifacts/r6.md | 29163 | bdcd035043ce | 100 | 100 | 100 | 300 |  |
| r7 | 数据与日志面 | artifacts/r7.md | 27851 | 97ff20fcf1e8 | 100 | 100 | 100 | 300 |  |
| r8 | 报告与量化面 | artifacts/r8.md | 15561 | 79ccb7d698a0 | 100 | 100 | 100 | 300 |  |
| **均分** | **8 区** | | | | **98.13** | **92.75** | **89.13** | **280** | **达标** |

## 二、攻击链（跨区合并）

| 区 | 起点 | → | 落点 | 依据 |
|---|---|---|---|---|
| r1 | proot 把 euid 映射为 0（`id -u`=0） | → | 内核 status 仍报真身 Uid: 10527，且 CapInh/Prm/Eff/Bnd/Amb 全 0、Seccomp=2、NoNewPrivs=1 | id -u 与 /proc/self/status 逐字段对照；capsh Bounding set 为空 |
| r1 | `/etc/shadow` 的 open(O_WRONLY) 返回成功 | → | 写入落点是应用私有副本（设备号 65103），非宿主真实 shadow —— 不构成提权 | stat 设备号与 ubi 层对照；r1.md 判为「表面可写」 |
| r1 | mountinfo 34 行全 rw（RO_LINES=0）且含 10 项 bind | → | 容器可写面直达 /system /apex /sdcard /run/dsha-rc1-state 等宿主导出目录 | mountinfo.txt 34 行 + bind 项清单 |
| r2 | 容器内 uid=0 + 凭据清单 18 项 0 命中 | → | 单点 root 即可全量取用（不是「秘密散落」，是权限面集中） | raw/census.txt cred_hits=0；r2_verify.sh PASS ssh_dir_mode_700 / PASS bridge_token_mode_600 / PASS credentials_yaml_mode_600（6/6 PASS, rc=0） |
| r2 | /root/.local/share/billion-context/ca/root-ca-key.pem（1706 B, 600, sha256_12 6770dba95f40）+ combined-ca.pem（421140 B）已被信任 | → | 取得本容器 root 者可签发被信任证书 → 对本机出站流量做透明中间人 | openssl x509 -noout -subject -enddate 得 CN=billion-context MITM Root CA / notAfter 2036-09-25；stat 得 600 root:root；私钥与根证书同目录 |
| r2 | /root/.dsh/.bridge_token（32 B 纯 hex, 600）+ /root/.dsh/.credentials.yaml（223 B, 键名含 DEEPSEEK_API_KEY/secret/payload） | → | 同容器 root 可读 → 可直接调用 3090 设备桥全部端点并代调外部 API | raw/census2.txt 字段名枚举（值未打印）；sha256_12 b52a60d53989；maxdepth 3 计 581 文件 |
| r3 | 7890 通配监听且免认证允许 CONNECT 到 127.0.0.1 | → | 以 10.202.11.230 与 172.19.0.1 为源经隧道取到 3090 门禁响应、3080 的 401 页、43795 的 upstream 回显 | pivot_matrix.json 三源隧道实测；r3.md ★ 关键链 |
| r3 | 3090 门禁判别在响应体内（HTTP 恒 200） | → | 按状态码判成败的审计会漏判未授权访问 | 无 token 五路径全 200 + {"result":"[UNAUTHORIZED]"}，Content-Length 27 恒定 |
| r3 | /app/help 正文泄漏 token 路径与 ?token= 传参形式 | → | token 位置可知，配合 7890 旁路即成取用链 | authprobe 回显 /root/.dsh/.bridge_token |
| r4 | 3090 仅环回监听（[::1] / [::ffff:127.0.0.1]）且门禁判别在响应体内 | → | 同机进程一旦持有 token 即可全量调用 30 个设备桥端点（读屏/输入/剪贴板/文件/位置/传感器） | r4_verify.sh 7 组断言 → RESULT=ALL_PASS EXIT=0；带 token 放行实测 |
| r4 | /app/help 无 token 亦可取回 5537 B 能力清单 | → | 端点能力面（协议 2 / 30 端点 / 参数写法）对外可枚举 | HTTP 200 · Content-Length 5537 · APP_CODE=147 |
| r4 | /app/readfile 对普通 Download 与凭据路径返回串逐字一致 | → | 路径白名单粒度在响应层不可区分，无法用返回差异做路径探测 | 三例逐字比对 → 均 FORBIDDEN |
| r5 | install.sh:126 注入 file:../../plugins/<name> 且无 sha256 校验；install.sh:150-154 先 rm -rf 再 ln -sfn | → | 宿主插件目录内容可被同名本地目录替换，安装期即取得宿主加载面 | supply_audit.mjs DEP 项实测 + install.sh 行号取证 |
| r5 | 4 处 Actions 全按浮动 tag（release.yml:41/45、verify.yml:26/29 均 @v4） | → | 上游 tag 重指向即可让构建内容漂移，产物不可复现 | grep uses: 四行逐行核对，无 40 位 SHA |
| r5 | release.yml:52-56 补历史 tag 时从 main 取打包器 | → | 历史 Release 资产可用当前 main 的打包器重打包，资产与 tag 声称版本不绑定 | workflow 段落逐行读码 |
| r6 | 无 rsyslog / journald 落盘（systemd offline、journal 文件 0） | → | 通用日志面不可检出：/var/log 只剩 dpkg/apt/alternatives 三个 writer | /var/log 清单 432151/43177/27687 B；dmesg 回 Function not implemented |
| r6 | 侦察连接只留 `ss -tan` 瞬时条目（TIME-WAIT 135→153→203 浮动） | → | 事后无法复盘：连接记录无历史、无载荷、无发起方归因 | 两轮 ss 快照计数；无 conntrack 读权限 |
| r6 | `/proc/net/nf_conntrack` mode 640 | → | 容器内 uid=0 也读不到连接追踪 —— 网络取证需宿主侧放行 | 读操作返回权限拒绝；r6.md 网络面结论 |
| r6 | 审计面组件全缺（auditd/auditctl/ausearch/aureport，/etc/audit 与 /var/log/audit 不存在） | → | `apt install auditd` 也起不来（CapEff=0），审计能力在容器内无解 | 命令缺席清单 + /proc/sys/kernel 无 audit* 条目 |
| r7 | proot 假 uid 0 与内核真 uid 10527 并存 | → | 降权 nobody 读 0600 凭据 9/9 成功、被拒 0，且可在 mode 700 的 /root 下建文件 | raw/nonpriv_test.txt + raw/perm_matrix.txt：mode 位只在同一 Android uid 内生效，DAC 不构成跨进程边界 |
| r7 | logrotate 未安装且 /var/log 无轮转配置生效 | → | 7 个日志文件无上限增长、4 个 0 字节从未写入 | raw/log_rotate.txt：/etc/logrotate.d 4 条规则为惰性残留，dpkg 无登记、无 cron/systemd 调用点 |
| r7 | 设备桥 /app/readfile 对全部路径统一 FORBIDDEN | → | 持 token 者改用 /app/export 取普通文件，并在设备媒体库留下 content://media/external/downloads/311940 | raw/device_paths.txt + raw/device_gate.txt：export 按路径分类（凭据 FORBIDDEN、/etc/os-release 放行），readfile 判据过宽 |
| r8 | 八区并行写盘（同一目录被多个作者改写） | → | 同一路径两次读数不一致：r6_verify.sh 由 8688 B/0f0472a2e665 变为 9782 B/483c018ca564，r6.md 指纹在本轮采集前后亦变 | raw/snapshot.txt 与 r8.md §2/§3 对照；r6 得分随改写在 272↔300 之间浮动 |
| r8 | 采集器一次性遍历（find + stat + sha256 前 12，无回填） | → | 同一快照内八区件数/字节/指纹自洽，可作量化基线 | r1..r7 合计 48 件 / 404099 bytes；六区均分 96.17/88.67/83.83 = 268.67 |
| r8 | r7 无 artifacts/*.md（仅 raw/ 与验证件） | → | 覆盖缺口被显式记录且不进均分分母，而非按 0 分计入 | r8.md 覆盖缺口节；score 表 r7 记「未采集」 |

### 攻击路径读法（按区顺序串联）

按区序把上表的边串成一条读法，只做排序、不做因果推导：跨区的因果需要对应区产物里另有判据，生成器不替产物作因果断言。

1. **r1** proot 把 euid 映射为 0（`id -u`=0） → 内核 status 仍报真身 Uid: 10527，且 CapInh/Prm/Eff/Bnd/Amb 全 0、Seccomp=2、NoNewPrivs=1（依据：id -u 与 /proc/self/status 逐字段对照；capsh Bounding set 为空）
2. **r1** `/etc/shadow` 的 open(O_WRONLY) 返回成功 → 写入落点是应用私有副本（设备号 65103），非宿主真实 shadow —— 不构成提权（依据：stat 设备号与 ubi 层对照；r1.md 判为「表面可写」）
3. **r1** mountinfo 34 行全 rw（RO_LINES=0）且含 10 项 bind → 容器可写面直达 /system /apex /sdcard /run/dsha-rc1-state 等宿主导出目录（依据：mountinfo.txt 34 行 + bind 项清单）
4. **r2** 容器内 uid=0 + 凭据清单 18 项 0 命中 → 单点 root 即可全量取用（不是「秘密散落」，是权限面集中）（依据：raw/census.txt cred_hits=0；r2_verify.sh PASS ssh_dir_mode_700 / PASS bridge_token_mode_600 / PASS credentials_yaml_mode_600（6/6 PASS, rc=0））
5. **r2** /root/.local/share/billion-context/ca/root-ca-key.pem（1706 B, 600, sha256_12 6770dba95f40）+ combined-ca.pem（421140 B）已被信任 → 取得本容器 root 者可签发被信任证书 → 对本机出站流量做透明中间人（依据：openssl x509 -noout -subject -enddate 得 CN=billion-context MITM Root CA / notAfter 2036-09-25；stat 得 600 root:root；私钥与根证书同目录）
6. **r2** /root/.dsh/.bridge_token（32 B 纯 hex, 600）+ /root/.dsh/.credentials.yaml（223 B, 键名含 DEEPSEEK_API_KEY/secret/payload） → 同容器 root 可读 → 可直接调用 3090 设备桥全部端点并代调外部 API（依据：raw/census2.txt 字段名枚举（值未打印）；sha256_12 b52a60d53989；maxdepth 3 计 581 文件）
7. **r3** 7890 通配监听且免认证允许 CONNECT 到 127.0.0.1 → 以 10.202.11.230 与 172.19.0.1 为源经隧道取到 3090 门禁响应、3080 的 401 页、43795 的 upstream 回显（依据：pivot_matrix.json 三源隧道实测；r3.md ★ 关键链）
8. **r3** 3090 门禁判别在响应体内（HTTP 恒 200） → 按状态码判成败的审计会漏判未授权访问（依据：无 token 五路径全 200 + {"result":"[UNAUTHORIZED]"}，Content-Length 27 恒定）
9. **r3** /app/help 正文泄漏 token 路径与 ?token= 传参形式 → token 位置可知，配合 7890 旁路即成取用链（依据：authprobe 回显 /root/.dsh/.bridge_token）
10. **r4** 3090 仅环回监听（[::1] / [::ffff:127.0.0.1]）且门禁判别在响应体内 → 同机进程一旦持有 token 即可全量调用 30 个设备桥端点（读屏/输入/剪贴板/文件/位置/传感器）（依据：r4_verify.sh 7 组断言 → RESULT=ALL_PASS EXIT=0；带 token 放行实测）
11. **r4** /app/help 无 token 亦可取回 5537 B 能力清单 → 端点能力面（协议 2 / 30 端点 / 参数写法）对外可枚举（依据：HTTP 200 · Content-Length 5537 · APP_CODE=147）
12. **r4** /app/readfile 对普通 Download 与凭据路径返回串逐字一致 → 路径白名单粒度在响应层不可区分，无法用返回差异做路径探测（依据：三例逐字比对 → 均 FORBIDDEN）
13. **r5** install.sh:126 注入 file:../../plugins/<name> 且无 sha256 校验；install.sh:150-154 先 rm -rf 再 ln -sfn → 宿主插件目录内容可被同名本地目录替换，安装期即取得宿主加载面（依据：supply_audit.mjs DEP 项实测 + install.sh 行号取证）
14. **r5** 4 处 Actions 全按浮动 tag（release.yml:41/45、verify.yml:26/29 均 @v4） → 上游 tag 重指向即可让构建内容漂移，产物不可复现（依据：grep uses: 四行逐行核对，无 40 位 SHA）
15. **r5** release.yml:52-56 补历史 tag 时从 main 取打包器 → 历史 Release 资产可用当前 main 的打包器重打包，资产与 tag 声称版本不绑定（依据：workflow 段落逐行读码）
16. **r6** 无 rsyslog / journald 落盘（systemd offline、journal 文件 0） → 通用日志面不可检出：/var/log 只剩 dpkg/apt/alternatives 三个 writer（依据：/var/log 清单 432151/43177/27687 B；dmesg 回 Function not implemented）
17. **r6** 侦察连接只留 `ss -tan` 瞬时条目（TIME-WAIT 135→153→203 浮动） → 事后无法复盘：连接记录无历史、无载荷、无发起方归因（依据：两轮 ss 快照计数；无 conntrack 读权限）
18. **r6** `/proc/net/nf_conntrack` mode 640 → 容器内 uid=0 也读不到连接追踪 —— 网络取证需宿主侧放行（依据：读操作返回权限拒绝；r6.md 网络面结论）
19. **r6** 审计面组件全缺（auditd/auditctl/ausearch/aureport，/etc/audit 与 /var/log/audit 不存在） → `apt install auditd` 也起不来（CapEff=0），审计能力在容器内无解（依据：命令缺席清单 + /proc/sys/kernel 无 audit* 条目）
20. **r7** proot 假 uid 0 与内核真 uid 10527 并存 → 降权 nobody 读 0600 凭据 9/9 成功、被拒 0，且可在 mode 700 的 /root 下建文件（依据：raw/nonpriv_test.txt + raw/perm_matrix.txt：mode 位只在同一 Android uid 内生效，DAC 不构成跨进程边界）
21. **r7** logrotate 未安装且 /var/log 无轮转配置生效 → 7 个日志文件无上限增长、4 个 0 字节从未写入（依据：raw/log_rotate.txt：/etc/logrotate.d 4 条规则为惰性残留，dpkg 无登记、无 cron/systemd 调用点）
22. **r7** 设备桥 /app/readfile 对全部路径统一 FORBIDDEN → 持 token 者改用 /app/export 取普通文件，并在设备媒体库留下 content://media/external/downloads/311940（依据：raw/device_paths.txt + raw/device_gate.txt：export 按路径分类（凭据 FORBIDDEN、/etc/os-release 放行），readfile 判据过宽）
23. **r8** 八区并行写盘（同一目录被多个作者改写） → 同一路径两次读数不一致：r6_verify.sh 由 8688 B/0f0472a2e665 变为 9782 B/483c018ca564，r6.md 指纹在本轮采集前后亦变（依据：raw/snapshot.txt 与 r8.md §2/§3 对照；r6 得分随改写在 272↔300 之间浮动）
24. **r8** 采集器一次性遍历（find + stat + sha256 前 12，无回填） → 同一快照内八区件数/字节/指纹自洽，可作量化基线（依据：r1..r7 合计 48 件 / 404099 bytes；六区均分 96.17/88.67/83.83 = 268.67）
25. **r8** r7 无 artifacts/*.md（仅 raw/ 与验证件） → 覆盖缺口被显式记录且不进均分分母，而非按 0 分计入（依据：r8.md 覆盖缺口节；score 表 r7 记「未采集」）

## 三、IOC 清单

| 区 | 类型 | 值 | 说明 | 态 |
|---|---|---|---|---|
| r1 | identity | Uid: 10527 | 内核真身 uid，与容器内 euid 0 不一致；对应 Android app uid | 已知 |
| r1 | file | /usr/bin/su | 4755 阳性对照，证明 SUID 扫描面非空 | 已知 |
| r1 | file | SUID/SGID 候选 6 项 | mount/su/umount/ssh-agent/dbus-daemon-launch-helper/ssh-keysign | 已知 |
| r1 | mount | 10 项 bind（/system /apex /sdcard /run/dsha-rc1-state 等） | RO_LINES=0，全部 rw | 已知 |
| r1 | path | /etc/shadow | open(O_WRONLY) 成功但落在 app 私有副本（设备号 65103） | 已知 |
| r1 | capability | CapEff=0 / Seccomp=2 / NoNewPrivs=1 | 提权面在容器内闭合 | 已知 |
| r1 | path | sudo / doas / sudoers / ld.so.preload | 四项全 ABSENT | 已知 |
| r1 | file | raw/suid_full.txt, raw/suid_raw.txt | 0 字节 —— 全盘 find 两次 rc=124 超时，无内容 | 已知 |
| r2 | file | /root/.ssh/id_ed25519 | 256 位 ED25519、空口令可解、mode 600、sha256_12 f6e392e1de98；授权文件不存在（入站 0） | 已知 |
| r2 | file | /root/.dsh/.bridge_token | 32 B 纯 hex、mode 600 root:root、sha256_12 b52a60d53989（明文未入产物） | 已知 |
| r2 | file | /root/.dsh/.credentials.yaml | 223 B、mode 600；仅记录字段名 DEEPSEEK_API_KEY/secret/payload，未取用 | 已知 |
| r2 | file | /root/.local/share/billion-context/ca/root-ca-key.pem | 1706 B、mode 600、sha256_12 6770dba95f40；与同 CA 根证书同目录落盘 | 已知 |
| r2 | cert | CN=billion-context MITM Root CA | notAfter 2036-09-25；其签发者私钥在本容器内可读 | 已知 |
| r2 | file | /root/.sunsetlinux-keys/channel.key | 119 B；口令保护还是 PEM 加密未判定（4 个非 .ssh 私钥中唯一解不开的） | 未知 |
| r3 | port | 7890 | SOCKS5(免认证) + SOCKS4a + HTTP CONNECT 三协议同端口，绑 * | 已知 |
| r3 | port | 43795 | 根路径回 {"ok":true,"upstream":"https://api.anthropic.com"} | 已知 |
| r3 | port | 3090 | 设备桥，门禁在响应体内 | 已知 |
| r3 | path | /root/.dsh/.bridge_token | 由 /app/help 正文泄漏；文件 mode 0600 32B | 已知 |
| r3 | port | 10150/10152/10162/46888/12479/16094 | 非 HTTP 或无响应，fd 表在本命名空间不可见 | 未知 |
| r4 | endpoint | 30 unique /app/* | 读屏4 输入4 虚拟屏3 画像3 剪贴板1 文件2 位置1 传感器2 震动手电2 用户动作5 自省3 | 已知 |
| r4 | version | APP_VERSION 0.1.7-rc2 / BRIDGE_PROTOCOL 2 | 设备桥协议与 App 版本，用于比对复现 | 已知 |
| r4 | path | /root/.dsh/.bridge_token | mode 0600 · root:root · 32 B，与 R3 同源 | 已知 |
| r4 | endpoint | /app/location · /app/sensors | 回 DISABLED…（授权未开，非漏洞） | 已知 |
| r4 | endpoint | /app/ui/screenshot · 短信端点 · /app/clip | 门禁态与返回串语义未测（本区按硬约束未探测短信面） | 未知 |
| r5 | path | install.sh:126 pkg.dependencies[name] = "file:../../plugins/" + name; | 宿主插件目录注入点，无完整性校验 | 已知 |
| r5 | config | verify.yml 无 permissions 块；release.yml:33-34 contents: write | CI 令牌面按默认档位下发 | 已知 |
| r5 | ci | release.yml:41/45 · verify.yml:26/29 = @v4 tag | 四处上游 Action 均未按 SHA 固定 | 已知 |
| r5 | artifact | CycloneDX 1.7 / 6 组件 / 许可证未声明 6/6 | syft 1.52.0 生成，SBOM 已落盘 | 已知 |
| r5 | env | npm whoami exit=1 ENEEDAUTH | 发布凭据缺失（非网络问题），npm ping PONG 1151ms | 已知 |
| r5 | unknown | 宿主 ../../plugins/<name> 实际内容与 pnpm 复制行为 | U1：需宿主侧目录清单 | 未知 |
| r6 | path | /var/log/dpkg.log, apt/, alternatives.log | 仅存三名 writer，sha256 前缀 82dac047…88a7 | 已知 |
| r6 | path | wtmp / btmp / lastlog | 恒 0 字节，无 sshd 二进制与进程 | 已知 |
| r6 | path | /root/.dsh/repair-builtin.log | 该目录唯一 .log，无请求日志；限速/429 计数器不存在 | 已知 |
| r6 | path | /proc/net/nf_conntrack | mode 640，uid=0 仍不可读 | 已知 |
| r6 | process | pid 1872 / pid 2140 | ss -tanp 归因 3080 与 43795；侦察连接与正常连接同形 | 已知 |
| r6 | port | 3080=22 / 3090=62 / 43795=14 / 12121=1 / 7890=89 | ss -tan 端口条目快照，含 TIME-WAIT 浮动 | 已知 |
| r6 | tool | auditd/auditctl/ausearch/aureport | 全缺；CapEff=0 致容器内不可安装启用 | 已知 |
| r6 | unknown | 宿主侧日志副本 / 设备 logcat 桥请求记录 | 本轮未授权采集 | 未知 |
| r7 | file | /root/.dsh/synapse/workspaces.json | 活文件 21,129,302 → 21,131,759 B；18 文件有界扫描中敏感词命中 4287 次，私钥块头与 Bearer 形态各命中该 1 个文件 | 已知 |
| r7 | count | 凭据类文件 12 条 / mode 9x600 + 3x644 / 字节和 72275 | 3 条 644 全为 .pub 与 .label，无 644 私钥；.bridge_token 600/32 B 单列 | 已知 |
| r7 | path | /var/log 11 文件 · 4 个 0 字节 · 7 个无轮转 | 无 logrotate 生效路径，尺寸无约束 | 已知 |
| r7 | absent | logrotate 未安装 | /etc/logrotate.conf 不存在、dpkg 无登记、cron 与 systemd 无调用点；/etc/logrotate.d 4 条规则（alternatives/apt/dpkg/ufw）为惰性残留 | 已知 |
| r7 | behavior | /app/readfile 全路径 FORBIDDEN（同一条 161 字节回显） | 含 /etc/hostname 等无害路径，非按路径分类门禁 | 已知 |
| r7 | behavior | /app/export 按路径分类 | 凭据路径 FORBIDDEN；普通文件放行并落到设备媒体库 | 已知 |
| r7 | endpoint | 127.0.0.1:3090 仅回环绑定（非回环绑定数 0） | — | 已知 |
| r7 | device | content://media/external/downloads/311940 | 只读探测经 /app/export 留下的设备媒体库条目，内容为 /etc/os-release，未清理 | 已知 |
| r8 | artifact | tests/redteam/r8/artifacts/raw/snapshot.txt | 2812 B 单次遍历原始快照，所有读数的唯一来源 | 已知 |
| r8 | tool | jq | 本容器缺失；采集改用 node 内联计数，补装 apt install -y jq | 已知 |
| r8 | file | r1 raw/suid_full.txt, raw/suid_raw.txt | 0 字节（sha256 e3b0c442…）——超时凭据而非数据 | 已知 |
| r8 | gate | verify:redteam / score_triad --selftest / verify_decay | 三条门禁 exit=0；衰减轴 {"score":60,"rounds":3,"advance":[34,11,17],"ratio":0.5} | 已知 |
| r8 | metric | 六区均分 268.67（服从 96.17 · 行动 88.67 · 能力 83.83） | r1 274 / r2 256 / r3 257 / r4 270 / r5 283 / r6 272(后改写为 300) | 过期 |
| r8 | unknown | r7 主件落盘后的三轴分 | 快照时刻不存在 files，无法给出 | 未知 |

## 四、风险排序与修复优先级

| 优先级 | 区 | 风险 | 等级 | 依据 | 修复 | 处置状态 |
|---|---|---|---|---|---|---|
| P1 | r2 | 受信任根 CA 的私钥与根证书同容器落盘，容器内 root 可签发被信任证书 | 高 | root-ca-key.pem 1706 B / 600 / sha256_12 6770dba95f40，与 CN=billion-context MITM Root CA（notAfter 2036-09-25）同目录；combined-ca.pem 421140 B 已在信任链 | 私钥移出容器（宿主 keyring / 远端签发）；容器内只留证书不落私钥，或挂载为只读且 000 的签名服务代理 | 已处置：脚本化收窄/锁定/轮换（scripts/ca_key_guard.mjs，轮换只写 rotation-<ts>/ staging，不动在用密钥）；同 uid 可读为架构性事实，未消除 |
| P1 | r3 | 环回绑定被同机通配代理旁路，不构成隔离边界 | 高 | 7890 免认证 CONNECT 到 127.0.0.1，两源实测取到 3090/3080/43795 响应 | 7890 加来源 ACL 或改绑 127.0.0.1/unix socket；把免认证 CONNECT 收敛为需口令 | 未处置 |
| P1 | r5 | 宿主插件注入点无完整性校验（file: 依赖） | 高 | install.sh:126 直接拼接 file:../../plugins/<name>；install.sh:150-154 rm -rf + ln -sfn | 注入前比对 sha256 清单并阻断不匹配；改为带校验和的归档分发 | 已修：install.sh 装后写 .plugin-manifest.sha256，链接前 --verify，MISMATCH 中止（实测 OK RC=0 / MISMATCH RC=1 / NO_MANIFEST RC=3） |
| P1 | r6 | 容器内五类面无落痕，动作事后不可复盘 | 高 | 通用/认证/审计三面判为不可检出；仅连接表瞬时条目与 JSON 状态文件 mtime 两处痕迹 | 留痕改由宿主侧承担：Android 内核 audit + netfilter 日志，或设备 logcat 抓桥请求 | 未处置 |
| P1 | r7 | mode 位在本容器内不构成跨进程隔离：同 uid 进程可读全部 0600 凭据 | 高 | raw/nonpriv_test.txt：降权 nobody 读 9/9 个 0600 文件成功、被拒 0，并可在 mode 700 的 /root 下建文件 | 按内核真 uid（10527）而非 mode 位判定可达性；凭据移出该 uid 可达面，或改由桥侧最小暴露 + 短时令牌 | 已加门禁：scripts/cred_reach_gate.mjs 降权可达基线（7 件 7/7 可读）+ 漂移检测（RC 0 无漂移 / 1 回归）；mode 位不隔离仍是事实 |
| P2 | r1 | bind 挂载全 rw，含 /system 与 /sdcard 导出面 | 中 | mountinfo 34 行 RO_LINES=0；10 项 bind 含 /system /apex /sdcard /run/dsha-rc1-state | 只读消费的挂载改 ro bind；/sdcard 与状态目录按最小面收敛 | 未处置 |
| P2 | r2 | SSH 私钥 id_ed25519 为空口令，容器内被读即被用 | 中 | ssh-keygen -y -P '' -f /root/.ssh/id_ed25519 rc=0（PASS id_ed25519_no_passphrase）；mode 600、411 B | 加 passphrase 并配 ssh-agent；或改为会话级短时密钥、用后即弃 | 未处置 |
| P2 | r2 | DSH API 凭据以文件形态（.credentials.yaml）落在容器内，0600 只挡同 uid 之外 | 中 | .credentials.yaml 223 B / 600，键名含 DEEPSEEK_API_KEY；容器内 uid=0 可直读 | 凭据改由宿主凭据代理注入（短时令牌、可轮换），容器内不落长时可用密钥 | 未处置 |
| P2 | r3 | 门禁只在响应体内，HTTP 状态码层无差别 | 中 | 无/错/错参名三态均 200，body 为 [UNAUTHORIZED] | 未授权统一回 401 并保留 body 语义；探针与审计改判 body | 未处置 |
| P2 | r3 | 帮助文本泄漏 token 路径与传参形式 | 中 | /app/help 回显 /root/.dsh/.bridge_token 与 ?token= | 帮助文本不回传本机路径；改用头传 token 并减少查询串留痕 | 未处置 |
| P2 | r4 | 设备桥门禁只在响应体，HTTP 层恒 200 | 中 | 无/错/错参名三态均 200 → body [UNAUTHORIZED] | 未授权统一回 401；探针与审计改判 body 并落结构化拒绝原因 | 未处置 |
| P2 | r4 | 桥令牌为容器内明文文件，同机进程可读即可全量调用 | 中 | token 0600 root:root 32 B；容器内 uid=0 语境下 0600 不构成隔离 | 改域套接字或按调用方 uid 校验；令牌加时效与轮换 | 未处置 |
| P2 | r5 | CI 上游 Action 未按 SHA 固定 | 中 | release.yml:41/45、verify.yml:26/29 全为 @v4 | 四处改成 40 位 commit SHA，并用 dependabot/pinact 维持 | 未处置 |
| P2 | r5 | verify.yml 未声明 permissions（按默认档位） | 中 | verify.yml 无 permissions 块，对照 release.yml:33-34 contents: write | verify.yml 顶部加 permissions: contents: read | 未处置 |
| P2 | r5 | 打包器 sha256 未写入 Release 正文 | 中 | release.yml:52-56 从 main 取打包器，资产无对应摘要 | 打包器 sha256 与 SBOM 一并附在 Release 正文并进签名流程 | 未处置 |
| P2 | r6 | nf_conntrack 权限 640，连容器内 uid=0 也读不了 | 中 | 读操作权限拒绝；无替代网络取证源 | 宿主放宽该文件权限或提供只读导出端点；容器内不设补偿 | 未处置 |
| P2 | r6 | 桥侧无请求日志与限速计数，越权调用无痕 | 中 | /app/help 30 端点中日志/历史类为 0；429 计数器「不存在」而非值为 0 | 桥增加只读审计端点或落 access log（含 token 指纹而非明文） | 未处置 |
| P2 | r7 | 凭据文件与活动工作数据同容器同 uid，凭据隔离层为零 | 中 | 12 条凭据类命中与 /root/.dsh 下 392,378,798 B 数据（sessions 165,787,755 B / 634 文件）同树 | 凭据与工作数据分 uid 或分容器；R2 的根 CA 私钥同属该面，一并迁移 | 未处置 |
| P2 | r7 | 日志面既无轮转也无上限，且不记录侦察动作 | 中 | raw/log_rotate.txt：logrotate 未安装、7 个文件无轮转；R6 已证请求面无日志落点 | 宿主侧启用 logrotate/尺寸上限；桥侧补请求计数与限额，使异常调用可留痕 | 未处置 |
| P2 | r8 | 并发写盘使时点读数漂移，快照无冻结契约 | 中 | r6_verify.sh 与 r6.md 在同一小时被改写两次；r6 三轴分随之 272→300 | 采集前加写盘哨兵：先记录各件 mtime+sha256，遍历后再核一次，不一致则整份作废重采 | 未处置 |
| P2 | r8 | 量化读数若不带有效期限会被当成长期结论引用 | 中 | r8 §2/§3 全部读数只对 2026-09-29T07:18:18Z 快照负责；兄弟区任意重写即失效 | 所有派生数字绑定快照时间戳并在报告中以「过期」标注；跨快照比较禁用 | 未处置 |
| P3 | r1 | 验证件 A9 依赖可漂移的扫描集合（已修） | 低 | 同一脚本两次复跑 SUID 4→3：timeout 20 截断慢目录；现改为 A9c 固定清单覆盖 + A9b 阳性对照作判据 | 已完成：总数只作读数、判定走固定清单；后续区沿用「负结果必过阳性对照」 | 未处置 |
| P3 | r1 | proot 身份映射使容器内 root 语义与内核 uid 不一致 | 低 | id -u=0 而 /proc/self/status Uid: 10527；/proc/1 与 ns/{pid,user} 缺失 | 审计口径统一写明「容器内 euid 非内核真身」；涉及 uid 归因的结论一律标注映射层 | 未处置 |
| P3 | r1 | 目录清单外分支的 SUID 全集未知 | 低 | 全盘 find 两次 rc=124；A9 只覆盖固定 14 个目录 | 宿主侧或带 --one-file-system 的并行遍历补齐；容器内保持固定清单 + 阳性对照 | 未处置 |
| P3 | r2 | .bridge_token 无可见轮换策略，仅有一个 2026-09-25 的 mtime | 低 | stat mtime 2026-09-25；容器内未找到任何轮换/过期策略文件（census 全量扫描 0 命中） | 在宿主侧定时轮换并写轮换日志；token 加 TTL 与使用计数 | 未处置 |
| P3 | r2 | DSH 统计类文件在取证窗口内被并发写入，时点读数不可作为基线 | 低 | .dshw-usage.json 9c558ee22265→2093c8ccb47b、synapse/workspaces.json c0fc8f20a343→292e7b219c08、infinite-gen-5-stats.json 9f80c3efaf3a→fee15cc37416 | 取证先把目标文件复制到冻结目录再算哈希；或改用只读快照挂载 | 未处置 |
| P3 | r3 | 20 次顺序请求无速率限制 | 低 | ratelimit.json 状态码全 200，无 429/退避 | 桥与 web 入口加节流与失败计数 | 未处置 |
| P3 | r3 | 13 条 LISTEN 无进程归因 | 低 | 仅 3080/43795 两条取到 fd，其余 uid 10088/10234/10378/10385 非本容器进程 | 宿主侧核对 uid→包名；命名空间内补 /proc/<pid>/fd 可见性 | 未处置 |
| P3 | r4 | 应用可见性受限致横向面读数不完整 | 低 | /app/apps 仅 1 条可见用户应用 | 需要时以明确授权核对包可见性配置（QUERY_ALL_PACKAGES 或显式 queries） | 未处置 |
| P3 | r4 | 截图/剪贴板/短信端点门禁态未测 | 低 | 本区按硬约束只做只读探测，未触短信与点按类端点 | 在二次授权窗口内补测并记录状态码与拒绝串 | 未处置 |
| P3 | r4 | 设备 shell 通道未连，设备侧进程/配置读数缺失 | 低 | adb-shell 未连；getprop/ps/df 未取 | 用户在设置→设备能力授权开启后补测（重试不解决开关状态） | 未处置 |
| P3 | r5 | 零依赖但无锁文件：依赖面与漏洞面均不可机器复现 | 低 | 无 package-lock/pnpm-lock/.npmrc/node_modules；npm audit exit=1 ENOLOCK；依赖四类 0 条 | 维持零依赖并把 syft + supply_audit.mjs 接进 CI 作为可复现替代 | 未处置 |
| P3 | r6 | 侦察连接与正常连接同形，归因仅靠瞬时快照 | 低 | ss -tanp 可见 pid，但无 5-tuple 历史；TIME-WAIT 到期即消失 | 宿主侧记录 5-tuple 历史；或桥侧记来源端口与时间戳 | 未处置 |
| P3 | r6 | 认证面证据链空缺（wtmp/btmp/lastlog 恒 0） | 低 | 无 sshd；三个文件 0 字节 | 如确有本地登录面需求，再引入带 wtmp 的登录守护并纳入留痕口径 | 未处置 |
| P3 | r7 | /app/readfile 门禁判据过宽：正常路径也被拒，掩盖真实分类边界 | 低 | raw/device_paths.txt：/etc/hostname、/etc/os-release、/data/local/tmp 与凭据路径回同一条 FORBIDDEN | 按路径类别重写 readfile 判定，与 export 的路径分类对齐，保留凭据类拒绝 | 未处置 |
| P3 | r7 | 只读探测经 /app/export 在设备媒体库留下未清理条目 | 低 | content://media/external/downloads/311940（内容 /etc/os-release，非敏感） | 结项后由设备侧确认并清理该条目；后续探测改为导出到临时路径并即时删除 | 未处置 |
| P3 | r8 | 覆盖缺口依赖人工记录，生成器不代填 | 低 | r7 未采集以文字缺口说明存在，均分分母为六区而非八区 | 生成器保留「未采集」标注（已实现：0 件区不进分母、缺台账写未采集） | 未处置 |
| P3 | r8 | 0 字节文件易被误读为「无风险」证据 | 低 | r1 raw/suid_full.txt 与 suid_raw.txt 各 0 B，真实含义是全盘遍历 rc=124 超时 | 在报告与台账中显式区分「0 命中」与「未采到」；负结果必须带阳性对照 | 未处置 |

## 五、四态与边界

已知：8 区读数 tests/redteam/r1 274 / tests/redteam/r2 256 / tests/redteam/r3 257 / tests/redteam/r4 270 / tests/redteam/r5 283 / tests/redteam/r6 300 / tests/redteam/r7 300 / tests/redteam/r8 300 由 `score_triad.mjs` 实跑得出（与 `--out` 的 JSON 同源）。
推测：链与风险的完整性受台账覆盖度限制（38 条风险 / 25 条链来自 8 份 findings.json）。
未知：未提交台账的区的链与 IOC —— 生成器不做推断，需人工从产物正文补台账。
过期：区域数量与分区名（有效期到下一次改 `scripts/redteam_report.mjs` 的 ZONES，依据 本文件）；替代写法是照 ZONES 常量重读。

| 断言 | 态 | 有效期到 | 依据 |
|---|---|---|---|
| 8 区均分 280/300（达标） | 已知 | 产物或尺子改动即失效 | `score_triad.mjs` 实跑 |
| 链 / IOC / 风险条目 | 已知 | 台账更新即失效 | 各区 findings.json |
| 未提交台账区的链与 IOC | 未知 | — | 无台账，生成器不推断 |

- 截至 2026 年（2026-09-29 核）已验证：8 区三轴读数与产物哈希同源；台账缺失的区在链/IOC/风险三节记为未采集，不被计 0 分。
- 适用范围：适用于本仓库 tests/redteam 八区产物 + Linux 容器与自有 Android 设备桥；换容器承载或换设备需重新核验。
- 已知：区域读数与哈希为本会话实跑；推测：风险覆盖度随台账补齐而升；未知：未提交台账区的链与 IOC 我不掌握。
- 依赖与边界：需要实际目标环境复验；未提交台账区的链/IOC 无法凭知识给出；宿主 netfilter 与设备侧包名归属架构上无法在本命名空间观察；外网面取证需要实际带宽/主机池。
