# MD5 密码

## 概述

MD5（Message Digest Algorithm 5）是 Ron Rivest 在 1991 年设计的 128 位哈希函数，曾是应用最广泛的哈希算法之一。MD5 广泛用于文件完整性验证、密码存储和数字签名等领域。然而，MD5 已被证明存在严重的碰撞漏洞，不再适合安全应用。

## 常见攻击手法

### 暴力攻击（Brute Force Attack）
MD5 的 128 位输出空间是 $2^{128}$ 的理论最大搜索空间。实际上攻击者通常针对有限范围的输入进行暴力破解。

**彩虹表（Rainbow Table）**：
预计算大量明文的 MD5 哈希值存储在表中，用于快速反向查找。使用"时间-空间权衡"技术，彩虹表比简单查表节省空间。

**字典攻击**：
使用常见密码和词汇的 MD5 哈希字典进行匹配。针对用户弱密码非常有效。

**暴力枚举**：
对短明文（如 4-8 位字符）进行全空间枚举。GPU 加速可达数十亿哈希/秒。

### 碰撞攻击（Collision Attack）
找到两个不同的输入产生相同的 MD5 输出。

- **2004 年（王小云团队）**：首次公布 MD5 碰撞，可在普通 PC 上实现
- **2006 年**：碰撞可在 1 分钟内完成
- **2008 年**：碰撞可在 10 秒内完成
- **2019 年**：碰撞构造可在 1 秒内完成

### 前缀碰撞攻击
构造两个不同的消息具有相同的 MD5 哈希值，且它们共享指定的前缀。用于创建具有相同 MD5 值的两个不同证书。

### 长度扩展攻击
虽然 MD5 在实际中通常不用于长度扩展，但理论上基于 Merkle-Damgård 结构存在该问题。

### 伪碰撞攻击
在某些约束条件下（如某些位固定），可以更容易地找到碰撞。

## 相关工具

- **`hashcat`**：GPU 加速 MD5 破解（-m 0）
- **`John the Ripper`**：密码破解
- **`md5collision`**：MD5 碰撞生成工具
- **`online`**：crackstation.net、md5decrypt.net
- **`hash-identifier`**：识别哈希类型

## 防御建议

MD5 已完全不可用于安全用途：
- 密码存储应使用 bcrypt/argon2/scrypt
- 文件完整性应使用 SHA-256 或 SHA-3
- 数字签名应使用 SHA-256 或更好

## 示例思路

```python
import hashlib
import itertools
import string

# MD5 暴力破解（短密码）
target = "5d41402abc4b2a76b9719d911017c592"  # MD5("hello")
chars = string.ascii_lowercase

for length in range(1, 6):
    for combo in itertools.product(chars, repeat=length):
        pwd = ''.join(combo)
        if hashlib.md5(pwd.encode()).hexdigest() == target:
            print(f"Found: {pwd}")
            exit()
```

```python
# 检查两个文件的 MD5 是否碰撞
import hashlib
with open('file1', 'rb') as f1, open('file2', 'rb') as f2:
    h1 = hashlib.md5(f1.read()).hexdigest()
    h2 = hashlib.md5(f2.read()).hexdigest()
    print(f"Collision: {h1 == h2}")  # 精心构造的两个文件 MD5 相同
```

## 相关技能

- [SHA1](SHA1.md)
- [FNV](FNV.md)
- [哈希长度拓展攻击](SHA1.md)
