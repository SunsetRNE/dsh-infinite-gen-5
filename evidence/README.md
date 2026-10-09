# Host 生命周期验证证据索引

取样时区：Asia/Shanghai；取样日期：2026-10-09。

| 产物 | 判据 |
|---|---|
| `host-resource-dedupe-handoff.md` | 下一位 AI 接管报告、改动说明、结论、未知项与复验命令 |
| `verify_stats_http.baseline.txt` | 真实 dsh-host-webserver HTTP/SSE 门禁：24 通过 / 0 失败 |
| `verify_stats_http.stderr.txt` | HTTP/SSE 门禁 stderr：空 |
| `verify_stats_http.status` | HTTP/SSE 门禁 exit=0 |
| `verify_stats_http.initial-tasks-500.txt` | 首次请求级运行暴露 `/tasks` 500 与修复根因 |
| `verify_injection_lifecycle.baseline.txt` | Host 资源生命周期门禁：26 通过 / 0 失败 |
| `verify_injection_lifecycle.stderr.txt` | 三条 `host-identity×1` 残留提示，独立于 JSON 判据 |
| `verify_stats_service.baseline.txt` | Stats Service：PASS；schema `ig5-stats/1`；apply-dispose-apply；升级与失败隔离通过 |
| `verify_stats_panel.baseline.txt` | Stats Panel：120 通过 / 0 失败；4 条路由，其中 1 条 SSE |
| `verify_stats_alias_gate.baseline.txt` | Alias Gate：PASS；scanned=242；允许面为 service/store/compat-tests |
| `verify_boot.baseline.txt` | Boot attest：17 条通过；世代、startup、previous、boots 与旧库回退通过 |
| `host-resource-dedupe.baseline.meta` | 本轮基线取样时间 |

## 复验入口

```bash
cd /root/Documents/deepseek-harness/default-workspace/dsh-infinite-gen-5-v2/dsh-infinite-gen-5
npm run verify:stats-http -- --json
npm run verify:stats-alias-gate
npm run verify:stats-service
npm run verify:stats-panel
npm run verify:boot
npm run verify:injection:lifecycle -- --json
node --check index.js
node --check services/stats-service.mjs
node --check scripts/verify_stats_service.mjs
node --check scripts/verify_injection_lifecycle.mjs
node --check scripts/verify_stats_http.mjs
```

## 解释边界

- `verify_stats_http.baseline.txt` 的 JSON 结果是真实 Host HTTP/SSE 请求级门禁判据。
- `verify_injection_lifecycle.baseline.txt` 的 JSON 结果是 Host 资源生命周期演习台权威判据。
- `verify_injection_lifecycle.stderr.txt` 只记录 Host identity 接管残留检查，不改变 `passed=26 / failed=0`。
- 兼容别名 `set/bump/push/onChange` 仍保留；Alias Gate 通过不等于可立即删除。
- 请求级门禁使用临时 loopback WebServer，不代表当前 GUI 进程的跨进程重启计数。
