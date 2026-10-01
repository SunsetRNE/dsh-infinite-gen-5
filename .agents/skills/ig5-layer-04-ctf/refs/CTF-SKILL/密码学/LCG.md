# 线性同余生成器（LCG）

## 概述

线性同余生成器（Linear Congruential Generator, LCG）是最简单的伪随机数生成器之一。算法公式为 $X_{n+1} = (A \times X_n + B) \bmod M$，其中 $A$ 为乘数（multiplier），$B$ 为增量（increment），$M$ 为模数（modulus），$X_0$ 为种子（seed）。LCG 广泛用于历史系统和简单模拟中，但因其可预测性而不适合密码学安全用途。

在 CTF 中，LCG 题目通常给出部分输出，要求恢复参数或预测后续输出。

## 常见攻击手法

### A、B、M、N₀ 已知（即参数全知）
若所有参数已知，可以直接从任意输出计算后续输出。这在 LCG 题目中是最简单的情况，只需直接迭代即可。

### 增量未知（Unknown Increment B）
已知 $A$、$M$ 和两个连续输出 $X_0, X_1$：
$$B = (X_1 - A \times X_0) \bmod M$$

### 增量和乘数都未知（Unknown A and B）
已知 $M$ 和三个连续输出 $X_0, X_1, X_2$：
- $X_1 = A \times X_0 + B \pmod{M}$
- $X_2 = A \times X_1 + B \pmod{M}$
- $X_2 - X_1 = A \times (X_1 - X_0) \pmod{M}$
$$A = (X_2 - X_1) \times (X_1 - X_0)^{-1} \bmod M$$

### 增量、乘数、模数均未知（Unknown A, B, M）
这是最困难的 LCG 攻击场景。需要至少 6-8 个连续输出值。

**攻击方法**：
1. 构造数列 $T_n = X_{n+1} - X_n$
2. 对于 LCG，有 $T_{n+1} = A \times T_n \pmod{M}$
3. 使用最大公约数（GCD）方法恢复 $M$：
   $$M = \gcd(T_2 \times T_4 - T_3^2, T_3 \times T_5 - T_4^2)$$
4. 恢复 $M$ 后，用前述方法恢复 $A$ 和 $B$

**格攻击方法**：
使用 LLL 算法构造格来恢复参数，对参数较小的场景特别有效。

### 截断输出恢复
当 LCG 只输出部分位（如高 32 位）时需要使用格攻击或分支定界法恢复完整状态。

## 相关工具

- **Python `math.gcd`** / **`numpy.gcd`**：GCD 计算
- **`sage`**：格攻击实现
- **`gmpy2`**：模逆运算

## 防御建议

LCG 不适合密码学用途。应使用密码学安全的随机数生成器（CSPRNG），如 `/dev/urandom`、`secrets` 模块等。

## 示例思路

```python
# 已知 M，(A,B)未知，恢复参数
xs = [x0, x1, x2, ...]
M = 0x...

# 恢复 A
A = (xs[2] - xs[1]) * pow(xs[1] - xs[0], -1, M) % M
# 恢复 B
B = (xs[1] - A * xs[0]) % M

# 验证
for i in range(len(xs)-1):
    assert (A * xs[i] + B) % M == xs[i+1]

print(f"A = {A}, B = {B}")

# 预测下一个
next_val = (A * xs[-1] + B) % M
```

```python
# 所有参数未知时的 GCD 恢复 M
ts = [xs[i+1] - xs[i] for i in range(len(xs)-1)]
M = 0
for i in range(len(ts)-3):
    m = ts[i+1]*ts[i+3] - ts[i+2]*ts[i+2]
    M = math.gcd(M, m)
# M 可能是 M0 的某个因子
```

## 相关技能

- [MT19937](MT19937.md)
- [反馈移位寄存器](反馈移位寄存器.md)
- [加密与解密](../逆向工程/加密与解密.md)
