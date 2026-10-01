# AES 密码操作模式

## 概述

AES（Advanced Encryption Standard）是当今最广泛使用的对称加密算法。AES 本身是块密码，处理固定 128 位的块。当需要加密长于 128 位的数据时，必须使用操作模式（Mode of Operation）。操作模式的选择对安全性至关重要，错误的选择或使用是 CTF 中 AES 题目最常见的考点。

## 常见模式

### ECB 模式（Electronic Codebook）
最简单的模式，每个明文块独立使用密钥加密。

**加密**：$C_i = E_K(P_i)$

**漏洞**：相同的明文块产生相同的密文块。适用于小块数据加密，但泄露了明文的格式和模式信息。经典攻击方式包括：
- **拼图攻击**：操纵密文块顺序改变解密结果
- **块重排攻击**：复制粘贴密文块组合出合法密文
- **信息泄露**：通过观察 ECB 模式的重复块推断明文内容

### CBC 模式（Cipher Block Chaining）
将前一个密文块与当前明文块 XOR 后再加密。

**加密**：$C_i = E_K(P_i \oplus C_{i-1})$，$C_0 = IV$

**常见攻击**：
- **IV 重用/固定**：IV 重复会泄露前缀信息
- **填充预言机攻击（Padding Oracle Attack）**：利用服务器返回的填充错误信息，逐个字节恢复明文
- **比特翻转攻击（Bit Flipping）**：修改 $C_{i-1}$ 可在已知的偏移位置修改 $P_i$
- **IV 可控**：若攻击者可控 IV，可修改第一个块

### OFB 模式（Output Feedback）
用加密函数的输出作为反馈生成密钥流。

**加密**：$O_i = E_K(O_{i-1})$，$C_i = P_i \oplus O_i$

**安全特征**：密钥流与明文独立，错误不传播。但不提供认证，抗篡改能力弱。

### CFB 模式（Cipher Feedback）
类似 OFB，但使用前一个密文块作为反馈。

**加密**：$C_i = P_i \oplus E_K(C_{i-1})$

**攻击**：比特翻转攻击影响对应块。

### CTR 模式（Counter）
使用递增的计数器值加密生成密钥流。

**加密**：$C_i = P_i \oplus E_K(\text{nonce} \parallel i)$

**特征**：可并行化、可随机访问。nonce 重用将完全破坏安全性。

### GCM 模式（Galois/Counter Mode）
在 CTR 模式下增加了 GMAC 认证标签，提供认证加密。是当前最推荐的操作模式。

## 常见攻击手法

### 填充预言机攻击（Padding Oracle Attack）
利用服务器验证填充并返回错误信息的特性，逐字节恢复密文对应的明文。

**步骤**：
1. 修改密文倒数第二个字节
2. 观察服务器是否返回填充错误
3. 根据响应缩小范围，确定明文字节
4. 依次恢复全部明文

### 比特翻转攻击（Bit Flipping）
在 CBC/CTR/CFB 模式中，修改一个密文块可在解密后的对应位置产生可控的明文变化。

### ECB 字节翻转攻击
当明文部分可控时，通过将目标字节移到不同块中并操纵边界来恢复信息。

### Nonce 重用攻击
CTR/GCM 模式中，相同的 nonce 和密钥会产生相同的密钥流，导致完全解密。

## 相关工具

- **`pycryptodome`**：`Crypto.Cipher.AES`
- **`PadBuster`**：自动化填充预言机攻击
- **`python-paddingoracle`**：填充预言机库

## 防御建议

- 不使用 ECB 模式（除非数据不超过一个块）
- CBC 模式应配合 HMAC 使用
- 首选 GCM 或 ChaCha20-Poly1305 等认证加密模式
- 每次加密使用不同的随机 IV/nonce

## 示例思路

```python
# CBC 比特翻转攻击
from Crypto.Cipher import AES

def flip(ciphertext, block_idx, byte_idx, old_val, new_val):
    ct = bytearray(ciphertext)
    # 修改前一个密文块中对应的字节
    ct[block_idx * 16 + byte_idx] ^= old_val ^ new_val
    return bytes(ct)
```

## 相关技能

- [DES加密](DES加密.md)
- [对称密码](对称密码.md)
- [分组密码](分组密码.md)
- [流密码](流密码.md)
- [加密与解密](../逆向工程/加密与解密.md)
