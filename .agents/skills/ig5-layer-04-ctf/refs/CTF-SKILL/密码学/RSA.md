# RSA 密码

## 概述

RSA 是最著名的公钥密码算法，由 Rivest、Shamir 和 Adleman 在 1977 年提出。其安全性基于大整数分解的困难性。RSA 在 CTF 密码学题目中占据核心地位，涉及大量数学分析和攻击方法。

**算法原理**：
- 选择两个大素数 $p, q$，计算 $n = p \times q$
- 计算欧拉函数 $\phi(n) = (p-1)(q-1)$
- 选择公钥 $e$ 满足 $\gcd(e, \phi(n)) = 1$
- 计算私钥 $d \equiv e^{-1} \pmod{\phi(n)}$
- 加密：$c \equiv m^e \pmod{n}$
- 解密：$m \equiv c^d \pmod{n}$

## 常见攻击手法

### e 和 φ(n) 不互素
当 $\gcd(e, \phi(n)) \neq 1$ 时，私钥 $d$ 不存在。如果 $e$ 很小或 $e$ 整除 $\phi(n)$，需要特殊处理。若 $e \mid \phi(n)$ 且加密的消息空间有限，可通过开 $e$ 次方根求解。

### 暴力分解 N
当 $n$ 较小时（小于 256 位），可以用工具直接分解。使用在线分解或本地工具如 `factor`、`yafu`、`msieve`。

### p & q 不当分解 N
当 $p$ 和 $q$ 选取不当或过于接近时，可被攻击：
- **Fermat 分解**：当 $p$ 和 $q$ 接近时，$n = a^2 - b^2$ 可分解
- **Pollard's p-1**：当 $p-1$ 只有小素因子时
- **Williams p+1**：当 $p+1$ 只有小素因子时

### 中国剩余定理（CRT）
在 RSA-CRT 实现中，解密计算可分解为 $m_p = c^{d \bmod (p-1)} \bmod p$ 和 $m_q$ 再组合。

### 提取 PEM 文件信息
使用 `openssl` 或 `Python Crypto` 库从 PEM/DER 格式文件中提取 RSA 参数（n, e, d, p, q 等）。

### 私钥文件修复
损坏或不完整的私钥文件，通过已知的部分信息（如部分 $d$、$p$ 或 $q$）结合数学关系恢复完整私钥。

### 模不互素（GCD Attack）
多个 RSA 模数 $n_i$ 共享相同的素因子。计算任意两个 $n_i$ 的 GCD 即可分解。

### 共模攻击（Common Modulus Attack）
同一明文用相同的 $n$ 和两个不同的公钥 $e_1, e_2$ 加密。若 $\gcd(e_1, e_2) = 1$，可用扩展欧几里得算法求解。

### 小公钥指数攻击（Small e Attack）
当 $e$ 很小（最常见为 3）且明文 $m$ 较小时，$m^e < n$，直接对 $c$ 开 $e$ 次方即可。

### Rabin 算法
$e = 2$ 的特殊情况，即 $c \equiv m^2 \pmod{n}$。用 Tonelli-Shanks 算法求平方根，得到四个可能的 $m$。

### dp & dq 泄漏攻击
若 $d_p = d \bmod (p-1)$ 和 $d_q = d \bmod (q-1)$ 泄露，可恢复 $p$ 和 $q$。

### Broadcast Attack（广播攻击）
同一明文用 $e$ 个不同的 $n$ 加密（$e$ 个接收者），可通过 CRT 得到 $m^e$ 再开 $e$ 次方。

### Coppersmith 攻击
当已知明文的部分位（如高位）时，使用 Coppersmith 方法恢复完整的明文或分解 $n$。

### Known High Bits
已知 $p$ 或 $q$ 的高位部分，通过 Coppersmith 或二元 Coppersmith 恢复完整因子。

### Boneh and Durfee
当私钥 $d$ 较小时（$d < n^{0.292}$），使用格基约简方法在多项式时间内恢复 $d$。

### RSA Parity Oracle
一个解密预言机每次告知解密结果是奇数还是偶数，通过二分法在 $\log_2(n)$ 次查询中恢复完整明文。

### RSA 侧信道攻击（Side-Channel Attack）
通过分析解密过程中的时间、功耗、电磁辐射等物理量泄漏的信息恢复私钥。

### RSA 签名伪造
利用 RSA 的同态性质：$\text{sign}(m_1) \times \text{sign}(m_2) \equiv \text{sign}(m_1 \times m_2) \pmod{n}$，可伪造签名。

### 低解密指数攻击（Wiener's Attack）
当 $d < \frac{1}{3}n^{1/4}$ 时，可通过连分数展开攻击恢复 $d$。

## 相关工具

- **`openssl`**：rsa, rsautl, pkey 等命令
- **`yafu`**：大整数分解
- **`sage`**：数论库，Coppersmith 实现
- **`RsaCtfTool`**：集成了大量 RSA 攻击
- **`gmpy2`**：大整数运算（invert, powmod）
- **`PyCryptoCryptodome`**：RSA 密钥处理

## 防御建议

- 使用足够大的模数（≥2048 位）
- p 和 q 长度相近但差值足够大
- 公钥指数 e 不宜过小（建议 65537）
- 私钥 d 需要足够大（防止 Wiener 攻击）
- 不同用户使用独立的模数（防止 GCD 攻击）

## 示例思路

```
共模攻击：
n1 = n2 = n (相同)
e1 = 65537, e2 = 65539
c1, c2 已知
# 扩展欧几里得求 s1, s2 使 e1*s1 + e2*s2 = 1
# m = pow(c1, s1, n) * pow(c2, s2, n) % n
```

## 相关技能

- [离散对数](离散对数.md)
- [基于格的密码](基于格的密码.md)
- [数字签名](电子签名.md)
- [密钥交换](密钥交换.md)
- [加密与解密](../逆向工程/加密与解密.md)
