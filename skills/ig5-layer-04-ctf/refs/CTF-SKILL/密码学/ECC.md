# 椭圆曲线密码（ECC）

## 概述

椭圆曲线密码（Elliptic Curve Cryptography, ECC）是基于椭圆曲线离散对数问题（ECDLP）的公钥密码体制。与基于有限域的离散对数系统相比，ECC 在相同安全级别下使用更短的密钥（256 位 ECC ≈ 3072 位 RSA）。ECC 广泛应用于现代密码学，包括密钥交换（ECDH）、数字签名（ECDSA）和加密（ECIES）。

**椭圆曲线方程**：$y^2 = x^3 + ax + b$（Weierstrass 标准型）
- 判别式 $\Delta = -16(4a^3 + 27b^2) \neq 0$
- 在有限域 $\mathbb{F}_p$ 上的点构成阿贝尔群

## 常见攻击手法

### 模数攻击（Invalid Curve Attack）
当对 ECC 实现提供的点不进行有效性验证（点在曲线上）时，攻击者可以提供不在原曲线上但在小阶曲线上的点，使计算在小阶子群中进行，泄露模数 $p$ 的信息。

### Pohlig-Hellman 攻击
当椭圆曲线的阶 $N$ 可分解为小素数的乘积时，将 ECDLP 分解到小阶子群中分别求解，再用 CRT 组合。对 $p$ 为异常曲线（$N = p$）时无效。

### Smart 攻击
当 $N = p$（异常曲线）时，ECDLP 可在多项式时间内求解。通过将曲线提升到 $p$-adic 数域来解决。

### MOV 攻击（Menezes-Okamoto-Vanstone）
利用 Weil 配对或 Tate 配对将 ECDLP 归约到有限域上的 DLP。当曲线嵌入度 $k$ 很小时有效。

### 小曲线攻击
当曲线参数 $p$ 非常小（如 CTF 题目）时，直接暴力求解或使用 BSGS。

### 同构映射攻击
将目标曲线映射到一条更弱的曲线上求解 ECDLP。

### 侧信道攻击
通过分析标量乘法的时间、功耗或电磁泄漏恢复私钥 $d$。

## 相关工具

- **`sage`**：最强大的 ECC 工具（`EllipticCurve`、`discrete_log`）
- **`ecpy`**：Python ECC 库
- **`ecdsa`**：Python ECDSA 实现

## 防御建议

- 选择安全曲线（如 P-256、Curve25519）
- 使用大素数字域（≥256 位）
- 验证点是否在曲线上
- 避免非素数阶的曲线（抵抗 Pohlig-Hellman）
- 选择大嵌入度（抵抗 MOV 攻击）

## 示例思路

```python
# sage 中求解 ECDLP
p = 0x...
a, b = 0x..., 0x...
E = EllipticCurve(GF(p), [a, b])
G = E(..., ...)  # 基点
Q = E(..., ...)  # 公钥
order = G.order()
print(factor(order))

# 若阶有小素因子，使用 Pohlig-Hellman
d = discrete_log(Q, G, ord=order, algorithm='bsgs')
print(f"Private key: {d}")
```

## 相关技能

- [RSA](RSA.md)
- [离散对数](离散对数.md)
- [基于格的密码](基于格的密码.md)
- [密钥交换](密钥交换.md)
- [加密与解密](../逆向工程/加密与解密.md)
