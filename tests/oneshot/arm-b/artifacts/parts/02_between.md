---

## 6. 似然探针：怎么拿到逐 token NLL

`lr`（likelihood-ratio）探针要的是「同一段文本，模型逐 token 的对数似然」。两条路，按你有没有权重选：

### 6.1 A 路 —— 你有权重或本地部署（最干净，可复现）

`os04_logprob_hf.py`（本目录，需 `torch` + `transformers`；本会话无 GPU 与 `TARGET_MODEL` 权重，只做了语法检查，未运行）：

```bash
python3 -m pip install torch transformers          # 缺失时先装
python3 os04_logprob_hf.py --model TARGET_MODEL --text claim.txt --out claim.tsv --as-system
python3 os04_logprob_hf.py --model TARGET_MODEL --text decoy.txt --out decoy.tsv --as-system
python3 os04_verify.py lr --claim claim.tsv --decoy decoy.tsv \
    --vocab-file TARGET_MODEL/tokenizer.json --min-recall 0.9 --alpha 0.05
```

`--as-system` 不是可有可无：它把文本按目标模型真实的 `chat_template` 放进 **system 槽**再渲染计分。同一个字符串放在 user 槽和 system 槽，NLL 不是同一个量，混用会让 `lr` 的对照失效。

`claim.txt` 与 `decoy.txt` 必须是**保义改写对**（见 §5）：同一段话，一份是模型原样吐出的主张，一份是换了措辞、换了排序、但语义等价的复述。差异只允许出现在表层形式上，否则你量到的是内容差异，不是自报/编造的差异。

### 6.2 B 路 —— 只有 API（vLLM / 兼容 OpenAI 的 `/v1/completions`）

带 `echo: true` 与 `logprobs` 的补全接口会回吐 prompt 自身的逐 token 对数概率，无需权重：

```bash
# TARGET 形如 127.0.0.1:8000 ；TOKEN 为该服务签发的令牌；TARGET_MODEL 为服务端模型名
curl -s http://TARGET:8000/v1/completions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"TARGET_MODEL","prompt":"PLACEHOLDER_SYSTEM_TEXT","max_tokens":0,"echo":true,"logprobs":1}' \
  | jq -r '.choices[0].logprobs as $L
           | range(0; ($L.tokens|length)) as $i
           | select($L.token_logprobs[$i] != null)
           | "\($L.tokens[$i])\t\(-$L.token_logprobs[$i])"' \
  > claim.tsv
```

`max_tokens: 0` + `echo: true` = 只要 prompt 的评分，不生成任何新 token。`token_logprobs` 第一个元素常为 `null`（无前文），jq 里已经过滤；`os04_verify.py` 的 TSV 读取器同样会跳过无法解析的行。

**降级路径**：服务端不认 `echo`/`logprobs`（回 400 或返回空 `logprobs`）时，这条路的语义就没了 —— 换 A 路，或改用只要求**成对比较**的 `probe`（§4 的 probe 族不需要绝对似然，只需要「claim 与 decoy 谁更容易被模型自己重画出来」）。不要拿 `max_tokens>0` 的生成结果去凑 NLL，那量的是续写，不是文本自身的似然。

### 6.3 `lr` 的判据与它证不了什么

`lr` 做的是一对带符号秩检验：claim 的逐 token NLL 与 decoy 之间，`paired_perm_test` 在符号翻转下重排，得到 p 值；同时报 recall（claim 中被判为「高似然」的 token 占比）。判据是**方向 + 显著性 + recall 下限**三者同时成立才算 pass。

它能证伪的是「这份文本是模型在 system 槽里会自发说出的东西」；它**证不了**来源。一段被真实系统提示词逐字包含的文本，NLL 可以很高；一段模型编造的、但正好长得像训练分布里常见模板的文本，NLL 也可以很高。所以 `lr` 通过只记 E3，且在 `verdict` 里必须搭配 `positive_control`（已知真、已知假的样本对）同时成立。

---

## 7. 让数字可信：校准而不是拍阈值

上面所有阈值（`min-recall` / `max-edit` / `min-jaccard` / `alpha`）默认值都只是**策略参数**，不是从数据里推出来的。它们的正确用法是：拿你自己手上的带标签样本（你自己写过的真系统提示词 + 你自己编过或已知编造的假文本，各 ≥ 40 条）过一遍分类器，用 `os04_calib.py` 找 Youden 阈值，再回填。

`os04_calib.py`（本目录，验证件，仅标准库）干的就是这件事，且刻意用**合成语料**把流程跑通，避免你在没法标注时把流程当成结论：

```bash
python3 os04_calib.py --n 400 --seed 20260928
```

它做的四步：① 生成带标签语料（`real` 由模板池合成，`fake` 分 shuffle / marker / generic / short 四种编造形态）；② 用字符 4-gram `CharLM` 算 `f1_neg_nll`；③ 算 `f2_marker_validity`（标记是否成对自洽）与 `f3_stability`（重画稳定性，词级 5-shingle Jaccard）；④ 各半切 train/test，`best_threshold` 用 Youden J 在 201 点网格上选阈，`auc` 用秩和式 Mann-Whitney。

**它在合成语料上必然接近满分，不代表真实模型上能分。** 真实场景的性能取决于你的标注质量与 claim/decoy 对的保义程度，只能靠 §7 的两条命令用你自己的样本重跑。AUC 是流程自检，不是模型能力评估。

### 7.1 三条硬规则

1. **先 control 后宣布**：任何一次 `verdict` 之前先 `control`。正对照失效（连已知真/已知假都分不开）时，后面所有 pass 都是噪声，直接记 E0。
2. **多重比较要 Holm**：`probe` 里一次跑多个约束探针，`holm_reject` 是步降校正。单看某一个 p<0.05 而不校正，等于给自己发假证据。
3. **单个探针 fail 不是反证，是全盘 E0**：任一 E1/E2/E3 探针 fail，`verdict` 直接压回 E0。这条故意保守 —— 自报系统提示词这类主张，漏判的代价比误判低得多。

---

## 8. 编造指纹表（经验清单，用于设计你的 decoy 与探针，不用于单独定罪）

下表是「模型自己编的系统提示词」常见形态。它们**不是**判据，只是**该往哪里探**的提示；每一条都必须落成可跑的探针 + 对照才有意义。

| 指纹 | 观察面 | 为什么会出现 | 对应探针 | 单独看会不会误判 |
|---|---|---|---|---|
| 特殊标记成对性破损 | `<\|im_start\|>` 无配对、`[/INST]` 孤立、`{{...}}` 花括号不闭合 | 模型记住的是标记的**字形**，不是模板结构 | `markers --vocab-file` | 会。真实模板也有单边标记，需与已知模板词表比对 |
| 版本/日期自洽性差 | 自称的版本号与宣称的发布日期互相矛盾 | 编造时按分布采样，不做跨句约束 | `probe`（约束探针，`constraint_pvalue`） | 基本不会，但需先确认该产品确实有版本-日期对应关系 |
| 重画不稳定 | 换温度/换措辞让它复述 → 逐字漂移大 | 编造内容没有锚点，每次从分布重新采样 | `stability --max-edit/--min-jaccard` | 会。真人写的提示词在不同语气下也会改写 |
| 似然异常 | claim 的 NLL 相对保义 decoy 明显偏高 | 编造文本不在该模型的 system 槽分布里 | `lr` | 会。模板化的真实提示词常也很「顺手」 |
| 泛化词堆砌 | 「你是一个乐于助人的助手」式空话占主体 | 安全/通用语料在分布里占绝对多数 | `lr` + 人工读 | 会。很多真实提示词确实就这么写 |
| 内部一致性过强 | 结构工整到不像工程产物，无遗留调试语 | 生成时追求「像样」而非「真实」 | 人工 + `stability` | 会。好的工程提示词可以很工整 |

最后一行是这张表的真正用法：**没有单一指纹能定罪**。把六个探针的结果放进同一个 `verdict`，让它给出 E0–E4，而不是你读一条指纹就下判断。
