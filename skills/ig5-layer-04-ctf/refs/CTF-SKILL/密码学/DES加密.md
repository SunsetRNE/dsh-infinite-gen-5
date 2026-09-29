# DES 密码

## 概述

DES（Data Encryption Standard）是 1977 年由美国 NBS（现 NIST）批准为联邦标准的加密算法，是现代块密码的基石。DES 采用 16 轮 Feistel 网络结构，64 位块大小，56 位有效密钥长度。虽然 DES 在现代已被认为不安全，但其设计思想深刻影响了后续的 AES 等算法。在 CTF 中，DES 题目通常考察其短密钥的弱点和各种分析方法。

## 常见攻击手法

### 暴力破解（Brute Force）
56 位密钥只有 $2^{56}$ 种可能。使用现代 GPU（如 8×RTX 4090）或专用硬件（如 COPACOBANA），可在数小时到数天内完成暴力破解。利用已知明文对，遍历所有密钥直到找到匹配的密文。

### 侧信道攻击（Side-Channel Attack）
- **时间攻击**：不同密钥下的 DES 运算时间存在微小差异
- **功耗分析**：简单功耗分析（SPA）和差分功耗分析（DPA）
- **电磁辐射分析**：捕获加密芯片的电磁辐射
- **缓存攻击**：分析 S 盒查表的缓存命中/缺失模式

### 错误注入攻击（Fault Injection Attack）
向 DES 硬件实现注入瞬态错误（如电压毛刺、激光照射），比较正确和错误输出，恢复密钥信息。错误注入可减少暴力搜索空间或直接恢复密钥。

### 线性分析（Linear Cryptanalysis）
Mitsuru Matsui 在 1993 年提出的方法，寻找明文、密文和密钥之间的线性近似关系。

**原理**：找到高概率的线性逼近 $P[i_1] \oplus ... \oplus P[i_a] \oplus C[j_1] \oplus ... \oplus C[j_b] = K[k_1] \oplus ... \oplus K[k_c]$，通过大量明密文对估计密钥位。

**对 DES 的效果**：需要 $2^{43}$ 个已知明文对，比暴力破解更高效。

### 差分分析（Differential Cryptanalysis）
Biham 和 Shamir 在 1990 年代提出的方法，分析输入差分对输出差分的影响。

**原理**：寻找高概率的差分特征（differential characteristic），通过大量选择明文对确定密钥。

**对 DES 的效果**：需要 $2^{47}$ 个选择明文对，理论效率优于暴力破解。

### 量子攻击（Quantum Attack）
应用 Grover 搜索算法可将密钥搜索从 $2^{56}$ 降低到 $2^{28}$（平方根加速）。虽然目前量子计算机还不具备大规模破解能力，但这是未来的威胁。

### 降低轮数 DES 攻击
对 1-8 轮的简化版本，各种分析方法的复杂度大幅降低，常用于 CTF 题目。

### 弱密钥（Weak Keys）
DES 有 4 个弱密钥（$E_k(E_k(P)) = P$）和 12 个半弱密钥（一个密钥加密后可用另一个密钥解密）。

## 相关工具

- **`pycryptodome`**：`Crypto.Cipher.DES`
- **`openssl enc -des`**：命令行 DES
- **`hashcat -m 14000`**：DES 破解
- **`Des_tool`**：DES 分析工具

## 防御建议

DES 已被正式废弃。任何新系统都不应使用 DES，而应使用 AES。现有 DES 系统应迁移到 AES。

## 示例思路

```python
# DES 暴力破解示例
from Crypto.Cipher import DES

def try_des_key(key, known_pt, known_ct):
    cipher = DES.new(key, DES.MODE_ECB)
    if cipher.encrypt(known_pt) == known_ct:
        return True
    return False

# 遍历部分密钥空间
from itertools import product
# 假设已知明文（8 字节）
known_pt = b'KNOWNPT\x00'
known_ct = b'...'  # 从密文获取
# 实际 56 位密钥空间太大，示例只展示概念
# for key_bytes in product(range(256), repeat=8):
#     key = bytes(key_bytes)
#     if try_des_key(key, known_pt, known_ct):
#         print(f"Found key: {key.hex()}")
```

## 相关技能

- [AES加密](AES加密.md)
- [对称密码](对称密码.md)
- [分组密码](分组密码.md)
- [流密码](流密码.md)
- [加密与解密](../逆向工程/加密与解密.md)
