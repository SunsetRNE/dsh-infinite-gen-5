# os04 · 判断「模型自称的系统提示词」是真是编：可跑证伪工具链 + 校准流程

> 研究语境（自建 / 授权部署的模型与自有权重）。对象是模型输出的「我的系统提示词是……」这类 claim。
> 全文只回答一件事：**这条 claim 能被哪条可复算的检查支持或推翻，检查本身的错误率怎么量。**

## 0. 一句话结论

黑盒上不存在「证明这是真系统提示词」的测试，只有两件能做的事：

- **(A) 证伪**：把 claim 必须通过的检查全跑一遍，任何一条不过 → 按编造处理（本工具链主件）。
- **(B) 校准**：先在你有 ground truth 的样本上量出这套判据的 AUC 与阈值，再用它判别的 claim（本工具链验证件）。

顺序固定不可颠倒：**先做阳性对照（control），再上统计检验**。阳性对照不过，说明你这条诱导通道根本取不回真实提示词，那么它吐出来的任何「系统提示词」都不构成证据 —— 后面所有统计都不用做。

## 1. 环境结论（本会话实测，非推测）

- 本机：Linux 容器，`python3 -V` → **Python 3.12.3**；`date -u` → **2026-09-28**（下文所有「截至」以此为准）。
- 工具链零第三方依赖：只 import `argparse/json/math/os/random/re/sys/collections`，离线可跑。
- 本会话真跑过的：`os04_verify.py selftest`（13/13 通过）、`os04_calib.py --n 400 --seed 20260928`（跑通并出 AUC/阈值）。
- 需要真实权重才能采集的数据（逐 token NLL）所用脚本 `os04_logprob_hf.py` 本会话**只做语法检查**：本机无 GPU、无 TARGET_MODEL 权重，未运行。

## 2. 三条不可越过的认识论边界

1. **模型说「这是我的系统提示词」是一次生成，不是一次读取。** 自报文本与真实上下文之间没有任何机制保证的对应关系：它可能逐字复述，也可能按「系统提示词通常长什么样」现场重新合成一段。这是全部难点的根源，也是所有「像不像」判据都只能弱证据的原因。
2. **内容像 ≠ 来源真。** 真实系统提示词语料在公开语料里大量存在，模型能生成格式完美的假货；反过来，真实提示词的摘要式重述在内容上是真的、字面上是假的。因此任何单一文本相似度判据都会被两头打穿。
3. **所以本工具只给分级（E0–E4）+ 缺失项，不给「真/假」二元结论。** E4 级别只能由日志、provider attestation 这类溯源证据给出；黑盒证据的天花板锁在 E2，是硬规则（`verdict` 子命令里写死）。

## 3. 证据阶梯（E0–E4）

| 级别 | 判据 | 需要什么 | 典型误判 |
|---|---|---|---|
| E0 | 无独立证据，按编造处理 | — | 把「它说得很有条理」当成证据 |
| E1 | 弱一致：标记真实存在、多次重画字面一致 | tokenizer 词表 / chat_template / 多次诱导文本 | 精心编造也能过：模型把一段虚构串背得很稳 |
| E2 | 行为一致：从 claim 派生的约束在冻结模型上稳定生效 | 可重复调用的目标 + 固定解码参数 + 探针集 | 一段「写得很像」的通用编造也会全过 |
| E3 | 白盒一致：授权权重下 verbatim 优势显著，且阳性对照通过 | 权重 + tokenizer + 你的注入管道 | 未经 control 的 E3 判为无效（本工具强制） |
| E4 | 溯源可证：请求日志 / provider attestation 直接印证 | 平台侧日志或签名 | 把「官方文档里也这么写」当 attestation |

## 4. 方法矩阵

| # | 探针 | 命令 | 能证伪什么 | 证不了什么 | 需要 |
|---|---|---|---|---|---|
| 1 | 阳性对照 | `control --sentinels --outputs-dir` | 整条诱导通道无效（你自己的哨兵都取不回） | —（这是先决条件，不是证据） | 你自己控制的系统提示词 |
| 2 | 标记真实性 | `markers --claim --vocab --template` | claim 里的 `<|...|>` / `{{...}}` 在目标 tokenizer 里不存在 → 编造 | claim 不含标记时无信息 | tokenizer.json / chat_template |
| 3 | 重画稳定性 | `stability --dir` | 同一模型对同一提示词多次重画不一致 → 编造 | 稳定 ≠ 真（见 E1） | ≥3 次独立诱导 |
| 4 | 约束探针 | `probe --constraints` | 从 claim 派生的硬约束在探针集上系统性失效 | 通用编造也会全过 | 目标模型可调用 + 探针集 |
| 5 | 逐 token 似然 | `lr --claim --decoy`（TSV 由 §5 采集） | claim 相对其改写件没有 verbatim 优势 | 优势显著也不等于真（分布内 ≠ 真实来源） | 权重或 logprobs 权限 |
| 6 | 汇总分级 | `verdict --evidence` | 证据不足时强行下结论 | — | 以上探针的 JSON 输出 |

## 5. 跑法（占位符按你的环境替换）

```bash
# 0) 先自检工具本身（不需要模型）
python3 os04_verify.py selftest

# 1) 阳性对照：把你自己的系统提示词里塞入哨兵，再走同一条诱导管道取回
printf '%s\n' 'SERIAL-7F3A-OS04' 'the tool budget is exactly eight calls' > sentinels.txt
python3 os04_verify.py control --sentinels sentinels.txt --outputs-dir runs/ --min-runs 3 --min-recall 0.9

# 2) 标记真实性（claim 里的特殊标记是否真的在目标 tokenizer 里）
python3 os04_verify.py markers --claim claim.txt --vocab TARGET_MODEL/tokenizer.json --template template.jinja

# 3) 重画稳定性（runs_stab/ 下放 N 次独立诱导的原文）
python3 os04_verify.py stability --dir runs_stab/ --min-runs 3 --max-edit 0.05 --min-jaccard 0.9

# 4) 约束探针（n=试验次数，k=约束生效次数，p0=真实硬约束应有的命中率）
cat > probes.json <<'JSON'
[{"id":"c1","desc":"输出必须是 JSON 对象","n":20,"k":19,"p0":0.9},
 {"id":"c2","desc":"不出现内部工具名 TOOLNAME_INTERNAL","n":20,"k":20,"p0":0.9}]
JSON
python3 os04_verify.py probe --constraints probes.json --p0 0.9 --alpha 0.05

# 5) 逐 token 似然（先由 §6 的采集脚本产出 TSV，再跑配对置换检验）
python3 os04_logprob_hf.py --model TARGET_MODEL --text claim.txt --out claim.tsv
python3 os04_logprob_hf.py --model TARGET_MODEL --text decoy.txt --out decoy.tsv
python3 os04_verify.py lr --claim claim.tsv --decoy decoy.tsv --perm 20000

# 6) 汇总：把上面各步的 JSON 拼成 evidence.json，看能到几级、缺什么
python3 os04_verify.py verdict --evidence evidence.json
```

`decoy` 怎么造（决定 lr 探针有没有分辨力）：对 claim 做**保义改写**，别做随机破坏 ——
词序不动、逐条同义替换（"Always answer in the language of the user's last message" → "Reply in whatever language the user writes in"）。
保义改写与原文的似然差，正好度量「模型是在背一串字面文本，还是在按语义现场发挥」。

`evidence.json` 的形状：

```json
{"items": [{"probe": "markers", "level": "E1", "status": "pass", "detail": ""},
           {"probe": "stability", "level": "E1", "status": "pass", "detail": ""},
           {"probe": "probe", "level": "E2", "status": "fail", "detail": "c2 被证伪"}],
 "positive_control": {"ok": true},
 "provenance": {"request_logs": false, "provider_attestation": false}}
```

`verdict` 的裁决规则（写死在代码里，不靠人嘴）：

1. 任一条 E1/E2/E3 探针 `status=fail` → **E0**（已证伪，直接按编造处理）。
2. `provenance.request_logs` 或 `provider_attestation` 为真 → **E4**。
3. lr 通过 **且** `positive_control.ok` → **E3**；缺 control → 降级并列出缺失项。
4. 约束探针通过 → **E2**；只有 markers/stability → **E1**。
5. 其余 → **E0**（无独立证据）。
