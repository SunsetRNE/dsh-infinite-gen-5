# FNV 哈希

## 概述

FNV（Fowler-Noll-Vo）是一种快速、非加密的哈希函数，由 Glenn Fowler、Landon Curt Noll 和 Kiem-Phong Vo 在 1991 年提出。FNV 哈希以简单快速著称，广泛应用于哈希表、DNS 服务器、数据库索引等场景。由于是非加密哈希，FNV 不具备抗碰撞性或抗原像攻击能力，在 CTF 中主要出现在与哈希碰撞相关的题目中。

## 常见种类

### FNV-0 Hash
FNV 的原始版本，使用初始偏移基数（offset basis）为 0。

**FNV-1 32-bit 公式**：
```
hash = 0  # offset_basis
for byte in data:
    hash = hash * FNV_prime
    hash = hash XOR byte
return hash
```

### FNV-1 Hash
最常见的版本，使用非零的偏移基数（offset basis）。

**FNV-1 32-bit 公式**：
```
hash = 2166136261  # offset_basis
for byte in data:
    hash = hash * FNV_prime
    hash = hash XOR byte
return hash
```
其中 FNV_prime 对于 32 位是 $2^{24} + 2^8 + 0x93 = 16777619$。

### FNV-1a Hash
FNV-1 的变体，先 XOR 后乘法，产生了更好的雪崩效应。

**FNV-1a 32-bit 公式**：
```
hash = 2166136261  # offset_basis
for byte in data:
    hash = hash XOR byte
    hash = hash * FNV_prime
return hash
```

### FNV2 Hash
FNV 的非标准变体，不同位宽有不同的 offset_basis 和 prime 参数组合。

**FNV 参数表**：
| 位宽 | Prime | Offset Basis |
|------|-------|-------------|
| 32   | 16777619 | 2166136261 |
| 64   | 1099511628211 | 14695981039346656037 |
| 128  | 309485009821345068724781371 | 144066263297769815596495629667062367629 |
| 256  | 下个素因数 | 需要 256 位的 offset |
| 512  | 下个素因数 | 需要 512 位的 offset |
| 1024 | 下个素因数 | 需要 1024 位的 offset |

## 常见攻击手法

### 碰撞构造
由于 FNV 不是加密哈希（没有使用 Merkle-Damgård 或海绵结构），可以通过代数方法构造碰撞。

**FNV-1a 碰撞方法**：
- 利用乘法运算的可交换性：改变字符顺序不会改变最终哈希值（在无进位乘法中）
- 利用 XOR 的零特性：插入一对相同的字节（如 `\x00\x00`）保持哈希不变
- 利用乘法的特性：找到两个不同的字节序列产生相同哈希

### 可预测性分析
FNV 没有雪崩效应要求，输入与输出的关系高度线性，可逆向推导。

### FNV-0 与 FNV-1 的区别利用
FNV-0 的 offset_basis 为 0，所以全零输入产生哈希 0，存在更多碰撞。

## 相关工具

- **Python 实现**：手写几行即可实现
- **`zynaddsubfx`**：FNV 哈希在音频软件中的应用

## 防御建议

FNV 不适合密码学安全场景：
- 不应用于密码存储、签名、认证
- 不应用于防篡改场景
- 在哈希表中使用时，应配合随机种子防止 HashDoS 攻击

## 示例思路

```python
def fnv1_32(data):
    hash = 2166136261
    for byte in data:
        hash = (hash * 16777619) & 0xFFFFFFFF
        hash ^= byte
    return hash

def fnv1a_32(data):
    hash = 2166136261
    for byte in data:
        hash ^= byte
        hash = (hash * 16777619) & 0xFFFFFFFF
    return hash

# FNV-1a 碰撞示例
# 由于先 XOR 后乘法的结构，插入额外的 \x00 对不改变哈希
data1 = b"hello"
data2 = b"hel\x00\x00lo"  # 注意不一定相等，需要精确构造
```

## 相关技能

- [MD5](MD5.md)
- [SHA1](SHA1.md)
- [加密与解密](../逆向工程/加密与解密.md)
