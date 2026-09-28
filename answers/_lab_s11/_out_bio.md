## 生物研究交付：qPCR 验证 GENE_A 敲低效率

- 假设 H1：GENE_A 敲低后 48h 相对表达量下降 >=70%
- 假设 H0（零假设）：敲低与对照相对表达量无差异
- 终点 ASSAY：SYBR-Green 两步法 RT-qPCR
- MEASUREMENT：2^-ddCt 相对表达量（单位 fold-change vs GAPDH）
- 判定阈值：<=0.30 fold-change 且 p<0.01
- 样本来源：SERIAL SERIAL_A017 / 供体 DONOR_H1

### 设计矩阵
| 组别 | 处理 | n | 对照类型 | 自变量 | 因变量 | 盲法 |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | siRNA-GENE_A 20nM | 6 | 阴性（载体） | siRNA 剂量 | 2^-ddCt 相对表达量 | 是 |
| G2 | siRNA-GENE_A 50nM | 6 | 阳性（GAPDH-siRNA） | siRNA 剂量 | 2^-ddCt 相对表达量 | 是 |
| G3 | 假手术/空载 | 6 | 手术对照 | 无 | 2^-ddCt 相对表达量 | 是 |

### 变量
- 自变量：siRNA 剂量（水平：0nM|20nM|50nM）
- 因变量：2^-ddCt 相对表达量
- 控制变量：批次、代数、孵育时长、操作者
- 混杂变量：传代次数

### 分析与迭代计划
1. 主分析：单因素 ANOVA + Dunnett 事后检验；效应量 0.9；α=0.05，power=0.80 → n≥6
2. 迭代 I1：阈值未达 <=0.30 fold-change 且 p<0.01 时，加做 延长至 72h 复测
3. 迭代 I2：仍不达标则改 ASSAY 为 Western blot 蛋白层面验证，重跑设计矩阵
4. 预注册：分析前锁定阈值与排除标准，禁止事后改主终点

### 样本量与主分析（可跑块）
```python
# 效应量 → 每组 n；两样本 t 检验，双侧；缺省参数用占位符
from math import ceil
from statistics import NormalDist

def n_per_arm(effect: float, alpha: float = 0.05, power: float = 0.80) -> int:
    z_a = NormalDist().inv_cdf(1.0 - alpha / 2.0)
    z_b = NormalDist().inv_cdf(power)
    return ceil(2.0 * ((z_a + z_b) / effect) ** 2)

print("n_per_arm =", n_per_arm(0.9))   # 与设计矩阵 G1/G2/G3 的 n 对齐
```

### 阈值判定（验证块）
```bash
# 判定信号：MEASUREMENT 与阈值比较，未达即进迭代 I1
python3 -c "m=MEASUREMENT_VALUE; print('PASS' if m >= <=0.30 fold-change 且 p<0.01 else 'FAIL:iterate_I1')"
```

