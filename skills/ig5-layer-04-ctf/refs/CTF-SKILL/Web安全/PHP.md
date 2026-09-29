# PHP 安全

## 概述

PHP 是 CTF Web 题中最常出现的语言。其灵活的语法、弱类型特性以及众多内置函数的行为差异，衍生出了大量独特的攻击面。从简单的弱类型比较到复杂的反序列化链利用，PHP 安全知识是 CTF Web 选手必须掌握的核心内容。

## 常见攻击手法

### 1. 弱类型与类型混淆

- **松散比较 (`==`) 绕过**：
  - `"admin" == 0` 为 `true`（字符串转数字后为 0）
  - `"0e12345" == "0e67890"` 为 `true`（科学计数法，0 的任意次幂为 0）
  - `md5('240610708')` 的结果以 `0e` 开头，与任何 `0e` 开头的 MD5 值弱相等
  - `in_array()` 未设置 `strict` 参数时的松散比较
- **类型转换陷阱**：
  - `intval()`、`floatval()` 的转换行为
  - `strcmp()` 传入数组时返回 `NULL`，若使用 `!=` 判断则可绕过
  - `sha1()`、`md5()` 传入数组时返回 `NULL`

### 2. 变量覆盖

- **extract() 函数**：`extract($_GET)` 可覆盖已有变量
- **parse_str()**：`parse_str($_SERVER['QUERY_STRING'])` 可能覆盖变量
- **import_request_variables()**：将 GET/POST/Cookie 变量导入全局作用域（已弃用但在旧版本中仍存在）
- **register_globals**（PHP < 5.4）：URL 参数直接注册为全局变量

### 3. 反序列化

- **unserialize() 利用**：攻击者控制的反序列化输入可触发对象中的魔术方法（`__wakeup()`、`__destruct()`、`__toString()`、`__call()` 等）
- **POP 链构造**：通过分析类的方法调用链，找到从入口点到危险函数（如 `eval()`、`system()`）的完整路径
- **phar 反序列化**：使用 `phar://` 伪协议触发 phar 元数据的反序列化，无需 `unserialize()` 函数
- **GC 绕过**：PHP 7.0.10 前的 `__wakeup()` 绕过（修改序列化字符串中属性数量大于实际数量）
- **原生类利用**：
  - `SplFileObject`：读取文件
  - `SplFileInfo`：文件信息
  - `DirectoryIterator`、`FilesystemIterator`：目录遍历

### 4. 伪协议

- **php://filter**：文件读取与编码转换
  - `php://filter/convert.base64-encode/resource=flag.php`
  - `php://filter/read=convert.iconv.utf-8.utf-7/resource=index.php`（字符集转换绕过过滤）
- **php://input**：POST 请求体作为 PHP 代码执行（需 `allow_url_include=On`）
- **data://**：`data://text/plain;base64,xxx` 直接嵌入数据
- **phar://**：触发反序列化
- **expect://**：命令执行（需安装 expect 扩展）
- **zip://**、**compress.bzip2://**、**compress.zlib://**：压缩文件读取

### 5. 文件包含 (LFI/RFI)

- **利用 `include`/`require` 函数**：用户控制包含路径时，可包含任意文件
- **远程文件包含**：`allow_url_include=On` 时包含远程服务器上的恶意脚本
- **日志投毒**：向 User-Agent、Referer 等请求头写入 PHP 代码，包含日志文件触发执行
- **php://filter 链**：利用多级 filter 绕过字符限制，构造任意文件读取
- **Session 文件包含**：控制 Session 内容后包含 Session 文件

### 6. 代码执行与命令执行

- **代码执行函数**：`eval()`、`assert()`、`preg_replace()` 的 `/e` 修饰符、`create_function()`、`array_map()` 配合回调、`usort()` 等
- **命令执行函数**：`system()`、`exec()`、`shell_exec()`、`passthru()`、`popen()`、`proc_open()`、`` ` ``（反引号）
- **禁用的函数绕过**：
  - `LD_PRELOAD` 绕过 `disable_functions`
  - `FFI`（PHP 7.4+）调用 C 函数绕过限制
  - `ImageMagick` 命令执行（CVE-2016-3714）
  - `mail()` 函数配合 `putenv()` 设置 `LD_PRELOAD`

### 7. 文件读取

- **文件读取函数**：`file_get_contents()`、`file()`、`fopen()`、`readfile()`、`fgets()`、`highlight_file()`、`show_source()`
- **目录遍历**：`scandir()`、`glob()`、`opendir()`

### 8. 框架漏洞

- **ThinkPHP**：路由 RCE（5.x 版本的多处路由 RCE）
- **Laravel**：Debug 模式 RCE（`/debug` 路由），反序列化链
- **Yii2**：反序列化 RCE

### 9. 模板注入 (SSTI)

- PHP 模板引擎如 Smarty、Twig 中的 SSTI：
  - Smarty：`{php}` 标签、`{literal}`、`$smarty` 变量
  - Twig：`_self.env.registerUndefinedFilterCallback`、`map`、`filter` 方法

## 相关工具

| 工具 | 用途 |
|------|------|
| PHPGGC | PHP 反序列化 Gadget 链生成 |
| php_filter_chain_generator | php://filter 编码链生成 |
| burp+repeater | 手工测试 |
| dirsearch | 目录扫描 |

## 防御建议

- 使用 `===` 严格比较替代 `==`
- 不要对用户输入直接调用 `unserialize()`
- 禁用 `allow_url_include` 和危险函数
- 对文件包含路径进行白名单限制

## CTF 中的常见考点

- MD5 碰撞绕过 `==` 比较
- 反序列化 POP 链构造
- php://filter 读取源码
- 日志投毒配合 LFI 实现 RCE
- disable_functions 绕过

## 相关技能

- [Python](Python.md)
- [Node](Node.md)
- [Java](Java.md)
- [SQL注入](SQL注入.md)
- [文件上传](文件上传.md)
- [文件包含](文件泄露.md)
- [反序列化](Java.md)
