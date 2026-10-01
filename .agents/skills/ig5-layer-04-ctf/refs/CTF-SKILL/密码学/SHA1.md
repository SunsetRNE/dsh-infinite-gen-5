# SHA1 哈希

## 概述

SHA1（Secure Hash Algorithm 1）是由美国 NSA 设计、NIST 在 1995 年发布的 160 位哈希函数。SHA1 长期被广泛用于数字签名和证书验证。然而，随着计算能力提升和密码分析技术的发展，SHA1 的安全边界已被突破。

## 常见攻击手法

### 哈希长度拓展攻击（Hash Length Extension Attack）

SHA1 基于 Merkle-Damgård 结构，存在长度扩展漏洞。给定 $H(M)$ 和 $len(M)$，攻击者可以在不知道消息 $M$ 的情况下计算 $H(M \parallel padding \parallel extra)$。

**原理**：
SHA1 的迭代结构：$h_{i+1} = f(h_i, M_i)$。最终哈希就是最后一个状态 $h_n$。如果知道 $h_n$（即 $H(M)$），可以直接以该状态作为初始值，继续处理额外的数据 $M_{extra}$，从而计算出 $H(M \parallel pad(M) \parallel M_{extra})$ 而不需要知道 $M$。

**攻击场景**：
- **密钥-消息认证**：若使用 $H(secret \parallel message)$ 作为 MAC，攻击者可以在不知道 $secret$ 的情况下计算 $H(secret \parallel message \parallel padding \parallel extra)$，伪造合法认证
- **Web 应用**：某些使用 $H(secret \parallel data)$ 做签名校验的应用

**攻击工具**：`hashpumpy` 库可自动化完成长度扩展攻击。

### 碰撞攻击（Collision Attack）

- **2017 年（SHAttered）**：Google 和 CWI 发布第一个公开的 SHA1 碰撞，需要约 $2^{63.1}$ 次 SHA1 计算和 6500 CPU 年
- **2020 年（SHAttered 改进）**：碰撞成本降低到 $2^{57.5}$ 次计算
- **攻击方法**：利用 SHA1 的压缩函数中的局部碰撞（near-collision），以短路径寻找碰撞

### 选择前缀碰撞攻击
攻击者可以在两个不同的前缀后附加区块，使两个文件具有相同的 SHA1 哈希值。这对数字证书伪造至关重要。

### 长度攻击与缩短攻击
利用 Merkle-Damgård 结构的特性，构造与原始消息长度不同的碰撞。

## 相关工具

- **`hashpumpy`**：Python 哈希长度扩展库
- **`hashcat -m 100`**：SHA1 破解
- **`sha1collider`**：SHAttered 攻击实现
- **`John the Ripper`**：SHA1 密码破解

## 防御建议

SHA1 已被 NIST 正式废弃（2011 年后），不再推荐使用。
- 使用 SHA-256/384/512 或 SHA-3 系列
- 认证 MAC 应使用 HMAC 而非 $H(key \parallel message)$
- 证书签名应使用 SHA-256

## 示例思路

```python
# 哈希长度扩展攻击
import hashpumpy
import hashlib

# 已知 H(secret || data) 和 data 长度，但 secret 未知
known_hash = "..."  # H(secret || data)
known_data = b"data"
key_len = 8  # 需要猜测或已知

# 追加额外数据
extra_data = b"extra"
for guess_len in range(4, 20):
    new_hash, new_data = hashpumpy.hashpumpy(
        known_hash, known_data, extra_data, guess_len
    )
    print(f"Key len {guess_len}: new_hash={new_hash}, data={new_data}")
```

## 相关技能

- [MD5](MD5.md)
- [FNV](FNV.md)
- [哈希长度拓展攻击](SHA1.md)
