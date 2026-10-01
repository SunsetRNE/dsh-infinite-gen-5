# 源码审计模块 (Code Audit)

> Python/Java/PHP/JavaScript/Go 安全审计与漏洞发现
> 环境：grep✅ python3✅

---

## 知识锚点（Playbook + H1 案例）

> 代码审计发现漏洞后，查阅对应 playbook 确认利用链，H1 案例提供真实漏洞模式参考，Payload 库提供验证载荷。

### Playbook（攻击手册）

| 漏洞类型 | Playbook 路径 |
|----------|--------------|
| RCE/反序列化/SSTI/XXE | `references/playbooks/rce/00-index.md` |
| SQL注入 | `references/playbooks/sqli.md` |
| 路径穿越 | `references/playbooks/path-traversal/00-index.md` |
| SSRF/缓存/Host | `references/playbooks/ssrf-cache-host/00-index.md` |
| 文件上传 | `references/playbooks/file-upload/00-index.md` |
| XSS | `references/playbooks/xss/00-index.md` |

### H1 真实案例（按弱点分类）

| 漏洞类型 | H1 案例路径 |
|----------|------------|
| SQL注入 | `references/h1-reports/by-weakness/sql-injection.md` / `blind-sql-injection.md` |
| 代码注入 | `references/h1-reports/by-weakness/code-injection.md` |
| 反序列化 | `references/h1-reports/by-weakness/deserialization-of-untrusted-data.md` |
| 命令注入 | `references/h1-reports/by-weakness/os-command-injection.md` |
| 路径穿越 | `references/h1-reports/by-weakness/path-traversal.md` |
| SSRF | `references/h1-reports/by-weakness/server-side-request-forgery-ssrf.md` |
| XXE | `references/h1-reports/by-weakness/xml-external-entities-xxe.md` |
| 硬编码凭据 | `references/h1-reports/by-weakness/use-of-hard-coded-credentials.md` / `use-of-hard-coded-password.md` |
| 不当输入验证 | `references/h1-reports/by-weakness/improper-input-validation.md` |

### Payload 库

| 用途 | Payload 路径 |
|------|-------------|
| SQL注入Payload | `payloads/web/sqli-payloads.md` |
| XSS Payload | `payloads/web/xss-payloads.md` |
| WAF绕过 | `payloads/bypass/waf-bypass.md` |

---

## 底层原理：审计不是"找bug"，是"追踪数据从输入到敏感操作的完整路径"

```
漏洞 = 不可信输入 + 敏感操作 + 缺少验证/过滤

审计的核心问题：
1. 输入从哪里来？（HTTP参数、文件、数据库、外部API、环境变量）
2. 经过什么处理？（验证、过滤、编码、转换）
3. 到达什么敏感操作？（SQL查询、命令执行、文件读写、反序列化、模板渲染）
4. 中间有没有绕过点？（类型混淆、编码差异、解析器差异）

你不只是在看代码，你在画数据流图。
```

### 审计决策树

```
拿到代码库，按这个顺序：

1. 这是什么语言？什么框架？
   → 决定审计重点和搜索模式

2. 入口点在哪里？
   → 路由/控制器/API端点 → 找到所有外部输入

3. 敏感操作在哪里？
   → 数据库查询/命令执行/文件操作/模板渲染/反序列化

4. 输入 → 敏感操作之间有没有防护？
   → 参数化查询？输入验证？输出编码？权限检查？

5. 有没有绕过防护的方法？
   → 类型混淆？Unicode规范化？HTTP参数污染？解析器差异？
```

---

## 通用搜索模式（所有语言）

```bash
# === 1. 硬编码凭据（最容易被忽略的漏洞） ===
grep -rn "password\s*=" --include="*.py" --include="*.java" --include="*.php" --include="*.js" --include="*.go" .
grep -rn "api_key\|api_secret\|secret_key\|private_key\|AWS_KEY\|AKIA\|client_secret" .
grep -rn "token\s*=" --include="*.py" --include="*.java" --include="*.php" --include="*.js" .
grep -rn "BEGIN RSA PRIVATE KEY\|BEGIN PRIVATE KEY\|BEGIN EC PRIVATE KEY" .

# === 2. 危险函数（跨语言） ===
# 命令执行
grep -rn "os.system\|subprocess\|exec\|shell_exec\|popen\|Runtime.exec\|ProcessBuilder" --include="*.py" --include="*.java" --include="*.php" .
# 代码执行
grep -rn "eval\|exec\|assert\|preg_replace.*\/e" --include="*.py" --include="*.php" --include="*.js" .
# 反序列化
grep -rn "pickle\|yaml.load\|unserialize\|ObjectInputStream\|json_decode" --include="*.py" --include="*.php" --include="*.java" .
# 文件操作
grep -rn "open\|file_get_contents\|readFile\|fs.readFile\|os.Open" --include="*.py" --include="*.php" --include="*.js" --include="*.go" .

# === 3. 输入源（追踪所有外部输入） ===
grep -rn "request\.\|req\.\|$_GET\|$_POST\|$_REQUEST\|@RequestParam\|@RequestBody\|@PathVariable\|c.Query\|c.Params\|c.PostForm" .
```

---

## Python 审计

```bash
# === 输入源 ===
# Flask: request.args, request.form, request.json, request.get_json()
# Django: request.GET, request.POST, request.body
# FastAPI: Query(), Body(), Path(), Form()

# === 危险模式 ===
grep -rn "os\.system\|os\.popen\|subprocess\.call\|subprocess\.Popen\|subprocess\.run\|commands\.getoutput" --include="*.py" .
grep -rn "eval\|exec\|compile\|__import__" --include="*.py" .
grep -rn "pickle\.loads\|pickle\.load\|yaml\.load(?!_safe)\|marshal\.loads" --include="*.py" .
grep -rn "\.format.*%\|f['\"].*{.*}" --include="*.py" . | grep -v "logging\|print\|logger"  # 可能的格式化字符串

# === SQL注入 ===
# 危险: cursor.execute(f"SELECT * FROM users WHERE id={user_input}")
# 安全: cursor.execute("SELECT * FROM users WHERE id=%s", (user_input,))
grep -rn "\.execute.*%\|\.execute.*format\|\.execute.*f['\"]" --include="*.py" .
grep -rn "\.raw(" --include="*.py" .  # Django raw query

# === SSTI (模板注入) ===
# Jinja2: render_template_string(user_input)
# Mako: Template(user_input)
grep -rn "render_template_string\|Template(" --include="*.py" .

# === 路径遍历 ===
grep -rn "os\.path\.join\|open.*request\|send_file\|send_from_directory" --include="*.py" .
```

---

## Java 审计

```bash
# === 输入源 ===
# Spring: @RequestParam, @PathVariable, @RequestBody, HttpServletRequest
# Servlet: request.getParameter(), request.getInputStream()
# Struts: ActionContext, ActionForm

# === 危险模式 ===
# 命令注入
grep -rn "Runtime\.getRuntime\(\)\.exec\|ProcessBuilder\|Process" --include="*.java" .
# SQL注入（字符串拼接）
grep -rn "createQuery.*+\|createNativeQuery.*+\|Statement.*execute" --include="*.java" .
# 反序列化
grep -rn "ObjectInputStream\|readObject\|readUnshared\|readResolve" --include="*.java" .
# SSRF
grep -rn "URLConnection\|HttpURLConnection\|HttpClient\|RestTemplate\|WebClient" --include="*.java" .
# XXE
grep -rn "DocumentBuilder\|SAXParser\|XMLReader\|SAXReader\|TransformerFactory" --include="*.java" .
# 表达式注入
grep -rn "SpelExpressionParser\|OGNL\|MVEL\|getValue" --include="*.java" .

# === 权限检查 ===
grep -rn "@PreAuthorize\|@Secured\|@RolesAllowed\|hasRole\|hasAuthority" --include="*.java" .
```

---

## PHP 审计

```bash
# === 输入源 ===
# $_GET, $_POST, $_REQUEST, $_COOKIE, $_SERVER, $_FILES, php://input

# === 危险模式 ===
# 命令注入
grep -rn "exec\|system\|shell_exec\|passthru\|popen\|proc_open\|pcntl_exec\|backtick" --include="*.php" .
# 代码注入
grep -rn "eval\|assert\|preg_replace.*\/e\|create_function\|include.*\$_\|require.*\$_\|include_once.*\$_\|require_once.*\$_\|file_get_contents.*php://" --include="*.php" .
# 反序列化
grep -rn "unserialize\|__wakeup\|__destruct\|__toString\|__call\|__invoke" --include="*.php" .
# 文件包含
grep -rn "include\|require\|include_once\|require_once" --include="*.php" . | grep -v "\.php['\"]\s*;"
# SQL注入
grep -rn "mysql_query\|mysqli_query\|pg_query\|mssql_query\|->query\|->exec" --include="*.php" .
# SSRF
grep -rn "curl_exec\|file_get_contents\|fopen\|readfile\|fsockopen" --include="*.php" .
```

---

## JavaScript/Node.js 审计

```bash
# === 输入源 ===
# Express: req.body, req.query, req.params, req.headers
# Koa: ctx.request.body, ctx.query, ctx.params
# Next.js: req.body, req.query, req.params

# === 危险模式 ===
# 命令注入
grep -rn "child_process\|exec\|spawn\|fork\|execSync\|spawnSync" --include="*.js" --include="*.ts" .
# 代码注入
grep -rn "eval\|Function\|setTimeout.*string\|setInterval.*string\|new Function" --include="*.js" --include="*.ts" .
# 路径遍历
grep -rn "path\.join.*req\|path\.resolve.*req\|readFile.*req\|sendFile" --include="*.js" --include="*.ts" .
# SSTI
grep -rn "\.render\|\.renderFile\|res\.render\|ejs\|pug\|handlebars\|mustache" --include="*.js" --include="*.ts" .
# NoSQL注入
grep -rn "\$where\|\.find.*req\.\|\.findOne.*req\.\|\.\$where" --include="*.js" --include="*.ts" .
# 原型污染
grep -rn "\.__proto__\|\.constructor\.prototype\|Object\.assign.*req\|merge.*req\|extend.*req\|clone.*req" --include="*.js" --include="*.ts" .
# 反序列化
grep -rn "node-serialize\|serialize-javascript\|js-yaml.*load(?!Safe)" --include="*.js" --include="*.ts" .
```

---

## Go 审计

```bash
# === 输入源 ===
# Gin: c.Query(), c.Param(), c.PostForm(), c.GetRawData()
# net/http: r.URL.Query(), r.FormValue(), r.PostFormValue()

# === 危险模式 ===
# 命令注入
grep -rn "exec\.Command\|os\.Exec\|syscall\.Exec\|exec\.CommandContext" --include="*.go" .
# SQL注入
grep -rn "fmt\.Sprintf.*SELECT\|fmt\.Sprintf.*INSERT\|fmt\.Sprintf.*UPDATE\|fmt\.Sprintf.*DELETE" --include="*.go" .
# 路径遍历
grep -rn "path\.Join\|filepath\.Join\|os\.Open.*r\.\|ioutil\.ReadFile" --include="*.go" .
# SSRF
grep -rn "http\.Get\|http\.Post\|http\.NewRequest\|client\.Do" --include="*.go" .
# 模板注入
grep -rn "template\.New\|template\.Must\|\.Execute\|\.ExecuteTemplate" --include="*.go" .
```

---

## 本机环境速查

```
已安装: grep✅ python3✅
缺失:   semgrep / SonarQube / CodeQL / Checkmarx
替代:   grep + 正则表达式 + 手动代码审查
        python3 可编写自定义 AST 分析脚本

审计流程：
1. grep 搜索危险模式（快速过滤）
2. 手动追踪数据流（输入→敏感操作）
3. 验证每个发现是否确实可被利用
4. 记录到漏洞报告
```

## 反爬钩子

> 代码审计本身不直接发包，但验证审计发现时需面对 WAF/反爬。以下场景需在远程验证阶段预判。

| 场景 | 触发条件 | 应对策略 |
|------|----------|----------|
| 审计发现SQL注入需验证 | WAF拦截注入payload | sqlmap --tamper / 编码绕过 / 内联注释 |
| 审计发现XSS需验证 | payload被过滤/编码 | 上下文逃逸 / HTML实体编码 / 模板字符串 |
| 审计发现RCE需验证 | 命令注入符号被拦截 | ${IFS}替代空格 / 关键字拆分 / 反引号 |
| 审计发现SSRF需验证 | 内网请求被WAF拦截 | IP进制转换 / DNS回环 / 协议切换(gopher/dict) |
| 审计发现反序列化需验证 | 大体积payload被拦截 | 分块投递 / Base64编码 / gzip压缩 |
| 审计发现路径穿越需验证 | `../` 被过滤 | 编码绕过(%2e%2e%2f) / 双写绕过(....//) / 绝对路径 |
| 本地审计不受影响 | 纯静态分析无网络请求 | 无需反爬对抗，但远程验证时需OPSEC包裹 |

完整对抗手册：`references/methodology/06-anti-antibot.md`