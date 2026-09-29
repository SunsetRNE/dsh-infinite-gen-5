# DSA 数字签名算法

## 概述

DSA（Digital Signature Algorithm）是美国 NIST 标准的数字签名算法，基于离散对数问题的难解性。DSA 使用 SHA 系列哈希函数，广泛应用于数字证书和身份认证。在 CTF 中，DSA 的安全漏洞通常源于随机数 $k$ 的不安全使用。

**算法参数**：
- $p$：大素数（1024-3072 位）
- $q$：$p-1$ 的大素因子（160-256 位）
- $g$：阶为 $q$ 的生成元，$g = h^{(p-1)/q} \bmod p$
- 私钥 $x$：随机数 $0 < x < q$
- 公钥 $y = g^x \bmod p$

**签名**：对消息 $m$ 的哈希 $h = H(m)$
- 选择随机数 $k$，$0 < k < q$
- 计算 $r = (g^k \bmod p) \bmod q$
- 计算 $s = k^{-1}(h + x \times r) \bmod q$
- 签名对为 $(r, s)$

**验签**：验证 $r = (g^{h \times s^{-1}} \times y^{r \times s^{-1}} \bmod p) \bmod q$

## 常见攻击手法

### 已知 k 攻击（Known k Attack）
若 $k$ 被泄露或可预测，可以直接计算私钥：
$$x = (s \times k - h) \times r^{-1} \bmod q$$
这种情况在伪随机数生成器（PRNG）有缺陷时发生。

### k 共享攻击（Shared k Attack / Nonce Reuse）
同一 $k$ 用于签名不同的消息 $(m_1, m_2)$，得到签名 $(r, s_1)$ 和 $(r, s_2)$。由于 $r$ 相同，可消去 $k$：
- $s_1 - s_2 \equiv k^{-1}(h_1 - h_2) \pmod{q}$
- $k \equiv (h_1 - h_2) \times (s_1 - s_2)^{-1} \pmod{q}$
- 恢复 $k$ 后即可计算 $x$

### k 偏置攻击（Biased k Attack）
若 $k$ 的某些位存在偏置（如最高几位总是 0），可通过格攻击（Lattice Attack）恢复私钥。这是针对 DSA/ECDSA 最强大的攻击之一。

### 相同消息多次签名
同一消息的多次签名每次应使用不同的 $k$。若相同消息得到相同签名，说明 PRNG 问题。

### 公钥恢复
已知签名 $(r, s)$ 和消息 $m$，在 ECDSA 中可以恢复公钥 $y$（通常有 2-4 个候选）。

## 相关工具

- **`ecdsa` (Python)**：ECDSA 实现
- **`openssl dsa`**：DSA 密钥和签名处理
- **`sage`**：格攻击实现
- **`hashlib`**：哈希函数

## 防御建议

- 使用安全的随机数生成器生成 $k$（如 RFC 6979 确定性 $k$）
- 永远不重用 $k$
- 使用足够长度的参数（$p \geq 2048$ 位，$q \geq 224$ 位）
- 优先使用 EdDSA 等更安全的签名方案

## 示例思路

```python
# k 重用攻击
h1 = int(hashlib.sha1(m1.encode()).hexdigest(), 16)
h2 = int(hashlib.sha1(m2.encode()).hexdigest(), 16)
r, s1, s2 = ...  # 两个签名
    
k = ((h1 - h2) * pow(s1 - s2, -1, q)) % q
x = ((s1 * k - h1) * pow(r, -1, q)) % q
print(f"Private key: {x}")
```

## 相关技能

- [RSA](RSA.md)
- [ElGamal](ElGamal.md)
- [离散对数](离散对数.md)
- [数字签名](电子签名.md)
- [加密与解密](../逆向工程/加密与解密.md)
