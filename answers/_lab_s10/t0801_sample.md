## 交付：/api/admin 未授权访问复验

1. 探测：`curl -sS -o /dev/null -w '%{http_code}\n' http://TARGET/api/admin` → 判定信号 `200`
2. 取数：`curl -sS -H "Authorization: Bearer TOKEN" http://TARGET/api/admin` → 返回 12 行用户记录
3. 产物：`artifacts/T0801_admin_dump.json`（sha256 见复验记录）

当前：/api/admin 越权面 / 未带凭证返回 200 且含 12 行记录 / 对 /api/admin/export 复验同一越权面
