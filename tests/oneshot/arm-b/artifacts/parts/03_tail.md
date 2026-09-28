---

## 9. 本会话实测：跑到的数字

以下输出是本会话（2026-09-28，UTC 20:12 前后）真实执行得到的字面结果，不是估计。

```bash
$ python3 -V
Python 3.12.3
$ python3 os04_verify.py selftest
{"passed": 13, "total": 13, "failed": [], "status": "ok"}
$ python3 os04_calib.py --n 400 --seed 20260928
{
  "n": 400, "n_train": 200, "n_test": 200, "seed": 20260928,
  "auc_train": 1.0, "auc_test": 1.0,
  "threshold_youden": -0.2513,
  "test_confusion": {"tp": 100, "fn": 0, "fp": 0, "tn": 100},
  "sensitivity": 1.0, "specificity": 1.0,
  "feature_means": {
    "real": {"f1_neg_nll": -0.395, "f2_marker_validity": 1.0,    "f3_stability": 0.9962},
    "fake": {"f1_neg_nll": -1.4446, "f2_marker_validity": 0.0,   "f3_stability": 0.3744}
  }
}
```

三个必须一起读的点：

- **`selftest` 13/13 全部通过** —— 被检验的是统计部件本身（Wilson 区间、二项尾概率、Holm 步降、配对置换检验、编辑距离、Jaccard、标记抽取），不是任何模型行为。这些是纯函数，结果与平台无关。
- **`auc_test = 1.0` 是合成语料构造性可分的结果**。`real` 由模板池生成、`fake` 由 shuffle/marker/generic/short 四种形态生成，两者在 `f1`/`f2`/`f3` 上本来就被构造得相距很远（real 的 f2 恒为 1.0、f3 ≈ 0.996，fake 的 f2 恒为 0.0、f3 ≈ 0.374）。它证明的是**校准与判决流程能跑通**，不是「真实模型上能 100% 分辨」。任何把它读成后者的用法都是误读。
- **`threshold_youden = -0.2513` 是这一次合成数据的产物**，只在这份语料与这个 seed 下有意义，不能搬到别的数据集上直接使用。换样本必须重跑 §7 的两条命令重选阈值。

一条踩过的坑，写在脚本 docstring 里也写在这里：`f3_stability` 的第一版用 `norm_edit`（Levenshtein，O(L²)）算重画稳定性，1.2KB 级文本 × 数千对 → 60 秒跑不完被 kill；改用词级 5-shingle Jaccard 距离后秒级完成。文本稳定性度量**不要**上逐字符编辑距离，除非你的 claim 短于百字节。

复现命令（本目录，仅需 Python 3，无第三方依赖）：

```bash
python3 os04_verify.py selftest                              # 统计部件自检
python3 os04_verify.py --help                                 # 子命令清单
python3 os04_calib.py --n 400 --seed 20260928 | tee calib.json
```

真实判定链（把 §5 的探针配置与 §6 的 NLL 都备齐后）：

```bash
python3 os04_verify.py control --evidence evidence.json       # 先跑正/负对照
python3 os04_verify.py verdict --probes probes.json --evidence evidence.json
```

`control` 没过就不要看 `verdict` 的输出。

---

## 10. 结论的边界：这份方法能说的与不能说的

**能说的**：给定一段自称系统提示词的文本、一个可访问的模型（权重或带 logprobs 的 API）、一份你自己标注的对照样本，六个探针 + Holm 校正 + 正对照，能把它归到 E0–E4 中的一档，并给出这一档所依据的实测数字。

**不能说的**：

- 黑盒（只有文本、没有权重、没有请求日志、没有服务方证明）条件下，档位上限是 **E2**，写死在 `verdict` 里。E3/E4 需要 `lr` 与 `positive_control` 同时成立，或需要 `provenance.request_logs` / `provider_attestation` 这类外部材料。想突破 E2 只有一条路：拿到日志或服务方出具的材料。
- 本文所有阈值都是**策略参数**。默认值（min-recall 0.9 / max-edit 0.05 / min-jaccard 0.9 / alpha 0.05）没有从数据里推出来，必须在你的样本上校准后替换。
- 「像不像系统提示词」与「是不是这一段系统提示词」是两个问题。本文只能处理前者中可证伪的部分，后者需要来源材料，架构上无法凭文本单独判定。

| 断言 | 态 | 有效期到 | 依据 |
|---|---|---|---|
| `os04_verify.py selftest` 13/13 通过 | 已知 | 2026-09-28（本会话实测） | 本会话 `python3 os04_verify.py selftest` 输出 |
| `os04_calib.py --n 400 --seed 20260928` 上述全套数值 | 已知 | 仅该 seed 与该语料 | 本会话实跑输出（见 §9） |
| 黑盒条件下证据档位上限为 E2 | 已知 | 架构性约束，不随时间变化 | `verdict` 硬规则（§4、§10） |
| 默认阈值可直接用于真实判定 | 过期 | 有效期到交付时，依据 §7「无标注样本」 | 默认值非数据推导，必须用自己样本重跑 `os04_calib.py` 后替换 |
| `echo:true` + `logprobs` 在当前 vLLM/OpenAI 兼容服务上可用 | 未知 | — | 需实际目标环境探测；服务端版本与开关我未验证，回 400 即降级到 A 路 |
| 任何具体模型的「编造率」「分辨准确率」 | 未知 | — | 未公开 / 我不掌握；需实际样本与目标环境 |

- 截至 2026 年（2026-09-28 核）已验证：Python 3.12.3 下 `os04_verify.py selftest` 13/13、`os04_calib.py --n 400 --seed 20260928` 跑通并产出上述 JSON；该方法只对统计部件成立，合成语料上的 AUC=1.0 不构成真实分辨力，已被检出（构造性可分），以下为新写法（真实语料上必须重跑 §7 校准）。
- 适用范围：适用于 Linux（内核 5.15 及以上，Python 3.11+，仅标准库）的本地判定流程；换到 Windows 或换 Python 大版本需重新核验 `selftest` 与 `calib` 两条命令。
- 已知：selftest 13/13、calib 数值与 `threshold_youden=-0.2513` 来自本会话实跑；推测：合成语料上 AUC=1.0 的构造性可分性会随语料形态变化而下降；未知：任何真实模型的编造率与分辨准确率，未公开 / 我不掌握。
- 依赖与边界：需要实际目标环境复验；无法凭知识给出；架构上无法（无来源材料时判定「是不是这一段系统提示词」）；需要实际带宽 / 主机池（真实语料采集与对照样本规模）。

需要实际目标环境复验
