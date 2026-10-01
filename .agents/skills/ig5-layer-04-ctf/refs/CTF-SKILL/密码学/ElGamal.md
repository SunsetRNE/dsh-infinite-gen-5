# ElGamal 密码

## 概述

ElGamal 加密算法是一种基于 Diffie-Hellman 密钥交换的公钥密码系统，由 Taher Elgamal 在 1985 年提出。其安全性基于有限域上离散对数问题的难解性。ElGamal 同时支持加密和数字签名，在 CTF 中常出现在离散对数相关的题目中。

**算法参数**：
- 选择大素数 $p$ 和生成元 $g \in \mathbb{Z}_p^*$
- 私钥 $x$ 随机选择，$1 < x < p-1$
- 公钥 $y = g^x \bmod p$

**加密**：
- 选择随机数 $k$，$1 < k < p-1$
- 计算 $c_1 = g^k \bmod p$
- 计算 $c_2 = m \times y^k \bmod p$
- 密文为 $(c_1, c_2)$

**解密**：
- $m = c_2 \times (c_1^x)^{-1} \bmod p$

## 常见攻击手法

### 完全破译攻击（Total Break）
若离散对数问题可解（当 $p$ 较小或 $p-1$ 只有小素因子时），可恢复私钥 $x$。使用 Pohlig-Hellman 算法配合 BSGS 或 Pollard's rho。

### 通用伪造签名（Universal Forgery）
在 ElGamal 签名方案中，通过选择特定参数构造有效签名而不需要知道私钥。

### 已知签名伪造（Known Signature Forgery）
若已知某消息的合法签名，可利用代数性质构造其他消息的签名。

### 选择签名伪造（Chosen Signature Forgery）
攻击者可以选择要签名的消息（或选择伪造中使用的参数），利用 ElGamal 签名的代数结构伪造签名。

**主要攻击场景**：
1. **随机数重用**：若两次加密使用了相同的 $k$，可通过 $c_2^1/c_2^2$ 消除 $y^k$ 项，恢复明文比率
2. **随机数已知**：若 $k$ 泄露，可直接从 $c_1 = g^k$ 求得 $x$ 或直接解密
3. **小素数 p**：$p$ 小于 512 位时可能被离散对数求解
4. **生成元选择不当**：$g$ 的阶太小会导致安全问题

## 相关工具

- **`sage`**：离散对数求解（`discrete_log()`）
- **`gmpy2`**：大数运算
- **Python `Crypto.PublicKey.ElGamal`**：PyCrypto 库实现

## 防御建议

- 使用足够大的素数 $p$（≥2048 位）
- 确保 $p-1$ 包含大素因子（安全素数）
- 每次加密使用不同的随机数 $k$
- 不重用随机数 $k$
- 使用标准的签名方案如 EdDSA 替代 ElGamal

## 示例思路

```
已知 p, g, y=c1, 为 ElGamal 密文 (c1, c2)
若 k 重用：
c2_1 = m1 * y^k mod p
c2_2 = m2 * y^k mod p
c2_1 / c2_2 = m1 / m2 mod p
若已知 m1 则可以求 m2
```

```python
from gmpy2 import powmod, invert

# 尝试破解小 p 的 ElGamal
p = 0x...  # 较小的 p
g = 2
y = 0x...  # 公钥
c1, c2 = (0x..., 0x...)  # 密文

# 用 sage 或 Python 离散对数
# x = discrete_log(y, g, p) # sage
# m = c2 * powmod(c1, -x, p) % p
```

## 相关技能

- [RSA](RSA.md)
- [DSA](DSA.md)
- [离散对数](离散对数.md)
- [数字签名](电子签名.md)
- [加密与解密](../逆向工程/加密与解密.md)
