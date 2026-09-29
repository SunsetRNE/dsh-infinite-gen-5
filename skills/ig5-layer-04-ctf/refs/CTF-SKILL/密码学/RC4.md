# RC4 密码

## 概述

RC4 是由 Ron Rivest 在 1987 年设计的流密码，曾是 TLS/SSL、WEP 和 WPA 等协议中的重要组成部分。RC4 算法包含两个部分：密钥调度算法（KSA）和伪随机生成算法（PRGA）。RC4 以其简洁快速著称，但现已发现多种严重漏洞。

**算法原理**：
1. **KSA（Key Scheduling Algorithm）**：使用密钥初始化状态向量 $S[0..255]$
2. **PRGA（Pseudo-Random Generation Algorithm）**：生成密钥流字节
3. 加密：$c_i = m_i \oplus k_i$

## 常见攻击手法

### 密钥泄露（Key Leakage）
若密钥 $K$ 被泄露，攻击者可以重新生成全部密钥流，解密所有 RC4 加密数据。

### 密钥流重用（Key Stream Reuse）
RC4 是流密码，密钥流 $k = \text{RC4}(K)$ 不可重复使用。若同一密钥加密了两个不同的消息：
$$c_1 \oplus c_2 = m_1 \oplus m_2$$
可通过 XOR 恢复明文信息。

### Weak Key / Fluhrer-Mantin-Shamir 攻击
对 WEP 协议的攻击，利用 IV 引起的前几个密钥字节的偏置，恢复密钥。

### 概率偏差攻击
RC4 输出存在统计偏差（第二个字节为 0 的概率是 $1/128$ 而非 $1/256$），通过大量密文可区分 RC4 流。

### Mantin 偏置攻击
在明文和密钥流的 XOR 中，特定位置存在偏置（如协议中经常出现的特定字节）。

## 相关工具

- **Python `Crypto.Cipher.ARC4`**：PyCrypto 库实现
- **`aircrack-ng`**：WEP/WPA RC4 攻击
- **Wireshark**：分析 TLS 中 RC4 流量

## 防御建议

RC4 已被 RFC 7465 禁止在 TLS 中使用。现代协议方案应使用 AES-GCM 或 ChaCha20-Poly1305 等现代密码。

## 示例思路

```python
# RC4 密钥流重用攻击
from Crypto.Cipher import ARC4

def rc4_crypt(key, data):
    cipher = ARC4.new(key)
    return cipher.encrypt(data)

c1 = rc4_crypt(key, msg1)
c2 = rc4_crypt(key, msg2)

# c1 ^ c2 = msg1 ^ msg2
xor_result = bytes(a ^ b for a, b in zip(c1, c2))
# 若知道 msg1 的一部分，可恢复 msg2
```

## 相关技能

- [流密码](流密码.md)
- [反馈移位寄存器](反馈移位寄存器.md)
- [对称密码](对称密码.md)
- [分组密码](分组密码.md)
- [加密与解密](../逆向工程/加密与解密.md)
