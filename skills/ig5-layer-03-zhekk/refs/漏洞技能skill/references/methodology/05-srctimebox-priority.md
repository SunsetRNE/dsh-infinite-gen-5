# SRC 时间盒优先级

> 场景：时间有限时如何在 SRC 漏洞赏金项目中最大化产出。
> 环境前提：Android proot Ubuntu 24.04 (aarch64) | proxychains4/torsocks | Playwright
> 核心公式：ROI = 漏洞价值 ÷ 验证成本

## 1. 四个时间盒的目标选择策略

| 时间盒 | 可用时间 | 目标选择策略 | 主攻方向 | 放弃方向 |
|--------|---------|-------------|---------|---------|
| 6h | 6小时 | 单一中等规模目标，范围已明确 | 未授权访问、默认凭据、信息泄露 | RCE 深挖、复杂注入链 |
| 单日 | 8-12h | 1-2 个目标，重点 API | 认证绕过、SQL注入、SSRF、逻辑漏洞 | 二进制利用、0day 研究 |
| HVV | 7天 | 多目标轮转，高危优先 | RCE、文件写入、内网横向 | 低危信息泄露、重复点 |
| 月度 | 30天 | 全量覆盖 + 深链挖掘 | 按优先级全量（见 01-attack-priority.md） | 无 |

## 2. ROI 评估矩阵

对每个候选漏洞点评估 ROI，按从高到低排序后投入时间。

```
ROI = 漏洞价值评分 / 验证成本评分

漏洞价值评分 = 危害等级 × 赏金倍数 × 可利用性
验证成本评分 = 绕过难度 × 复现步骤数 × 环境依赖度
```

| 漏洞类型 | 价值(V) | 典型成本(C) | ROI=V/C | 6h优先 | 单日优先 | HVV优先 |
|----------|--------|------------|---------|-------|---------|---------|
| RCE | 10 | 6 | 1.67 | - | 次选 | 主攻 |
| 文件写入 | 9 | 5 | 1.80 | - | 次选 | 主攻 |
| 认证绕过 | 9 | 3 | 3.00 | 主攻 | 主攻 | 次选 |
| SQL注入 | 8 | 4 | 2.00 | 次选 | 主攻 | 次选 |
| SSRF | 7 | 4 | 1.75 | - | 次选 | 次选 |
| 信息泄露 | 5 | 1 | 5.00 | 主攻 | 次选 | - |
| XSS | 4 | 2 | 2.00 | 次选 | - | - |
| 越权 | 6 | 2 | 3.00 | 主攻 | 次选 | - |

> ROI 高的优先投入。信息泄露和越权虽然单条价值低，但验证成本极低，短时间盒内 ROI 最高。

## 3. 快速出货路线

短时间盒内按以下路线快速出货，每步有时间上限：

```
快速出货路线（适用 6h / 单日）
│
├─ 1. 未授权访问（时间上限 30min）
│   ├─ 去除所有认证头重放受保护接口
│   ├─ 命中 → P2 认证绕过 → 固化证据(03-evidence-discipline.md)
│   └─ 未命中 ↓
├─ 2. 默认凭据 / 弱口令（时间上限 30min）
│   ├─ admin/admin, test/test, root/root 等
│   ├─ 命中 → P2 → 固化证据
│   └─ 未命中 ↓
├─ 3. 信息泄露（时间上限 1h）
│   ├─ .git/、.env、备份文件、swagger、actuator
│   ├─ 命中 → P5 → 固化证据
│   └─ 未命中 ↓
├─ 4. 逻辑漏洞（时间上限 2h）
│   ├─ 越权(IDOR)、密码重置逻辑、支付篡改
│   ├─ 命中 → P7 → 固化证据
│   └─ 未命中 ↓
└─ 5. 注入类（剩余时间）
    ├─ SQL注入、SSRF、XSS
    └─ 命中 → 按优先级(01-attack-priority.md)处理
```

### 快速出货命令速查

```bash
# 1. 未授权访问 — 去认证头重放
proxychains4 curl -s "https://target.com/api/user/profile" | grep -i 'email\|phone\|idcard'

# 2. 默认凭据 — 批量测试
for cred in "admin:admin" "admin:123456" "test:test" "root:root"; do
  user=$(echo $cred|cut -d: -f1); pass=$(echo $cred|cut -d: -f2)
  proxychains4 curl -s -X POST "https://target.com/login" \
    -d "username=$user&password=$pass" -o /dev/null -w "%{http_code} $cred\n"
done

# 3. 信息泄露 — 常见路径
for path in .git/config .env swagger-ui.html actuator/env backup.sql .DS_Store; do
  code=$(proxychains4 curl -s -o /dev/null -w "%{http_code}" "https://target.com/$path")
  [ "$code" = "200" ] && echo "[!] $path → $code"
done

# 4. 逻辑漏洞 — IDOR 递增
for id in $(seq 1 10); do
  proxychains4 curl -s "https://target.com/api/order/$id" -o "order-$id.json"
done
diff order-1.json order-2.json  # 对比是否返回不同用户数据
```

## 4. 放弃条件判定

当满足以下任一条件时，放弃当前漏洞点，切换下一个：

```
放弃判定决策树
│
├─ 验证成本超时?
│   ├─ 已投入时间 > 预估成本 × 2 → 放弃
│   └─ 否 ↓
├─ ROI 过低?
│   ├─ 当前点 ROI < 队列中次优点 ROI → 切换
│   └─ 否 ↓
├─ 防护无法绕过?
│   ├─ 四层绕过(02-bypass-toolkit.md)均失败 → 放弃
│   └─ 否 ↓
├─ 漏洞无法复现?
│   ├─ PoC 两次执行结果不一致 → 标记待定，切换
│   └─ 否 ↓
├─ 重复漏洞?
│   ├─ 与已提交漏洞同类型同端点 → 放弃
│   └─ 否 → 继续投入
└─ 时间盒耗尽?
    └─ 收尾，整理已发现漏洞证据(03-evidence-discipline.md)
```

### 放弃时间阈值参考

| 漏洞类型 | 单点最大投入时间 | 超时动作 |
|----------|----------------|---------|
| 信息泄露 | 15 min | 切换下一个泄露点 |
| 越权/IDOR | 30 min | 切换端点 |
| 认证绕过 | 45 min | 切换入口 |
| SQL注入 | 60 min | 尝试 WAF 绕过后再判 |
| SSRF | 60 min | 记录待定，切换 |
| RCE | 90 min | 高价值不舍弃，降频尝试 |

## 5. 各时间盒执行模板

### 5.1 6h 时间盒

```
00:00-00:30  侦察：端口/目录/JS分析(04-control-gap-hunting.md 第4节)
00:30-01:00  未授权访问 + 默认凭据
01:00-02:00  信息泄露批量探测
02:00-04:00  逻辑漏洞 + IDOR
04:00-05:30  注入类（SQL/SSRF）
05:30-06:00  证据整理 + 提交
```

### 5.2 单日时间盒

```
上午（4h）   侦察全覆盖 + 快速出货路线 1-3 步
下午（4h）   快速出货路线 4-5 步 + WAF 绕过(02-bypass-toolkit.md)
晚间（2h）   证据固化 + 深链尝试 + 提交
```

### 5.3 HVV 时间盒

```
Day 1-2      全目标资产梳理 + 快速出货（高危优先）
Day 3-5      RCE/文件写入深度挖掘 + 内网横向
Day 6-7      遗漏攻击面补全(04-control-gap-hunting.md 第6节) + 收尾
```

### 5.4 月度时间盒

```
Week 1       全量侦察 + 快速出货
Week 2       按优先级矩阵(01-attack-priority.md) P0-P3 深挖
Week 3       P4-P7 + 控制缺口猎杀全量
Week 4       深链组合 + 二次复审 + 证据归档
```

## 6. 与其他方法论的关联

- 优先级判定基础：`01-attack-priority.md`
- 遇 WAF 拦截：`02-bypass-toolkit.md`
- 证据固化规范：`03-evidence-discipline.md`
- 攻击面扩展：`04-control-gap-hunting.md`
