#!/usr/bin/env python3
"""T08-04 领域交付路由器：按请求类型绑定必交字段集合，产出对应体裁的交付骨架。

三分支（判据来自 source-3.txt:347-355）：
  bio   → 假设 / 设计矩阵 / 对照 / 变量 / ASSAY / MEASUREMENT / 阈值 / 分析与迭代计划
  codex → 一段可复用提示词块 + 代码块
  file  → 真实产物 + 绝对路径 + 核实记录（后续轮次编辑同一产物）

用法：
  python3 domain_router.py --selftest
  python3 domain_router.py --text "设计一个 qPCR 验证实验" --param TARGET_GENE=GENE_A
  python3 domain_router.py --text "把结果落盘成文件" --emit-file /abs/OUT.md
"""
from __future__ import annotations

import argparse
import hashlib
import pathlib
import re
import sys

REQUIRED: dict[str, list[str]] = {
    "bio": ["假设", "设计矩阵", "对照", "变量", "ASSAY", "MEASUREMENT", "阈值", "分析与迭代计划"],
    "codex": ["可复用提示词块", "<PROMPT>", "```text", "```python", "代码块"],
    "file": ["绝对路径", "核实", "sha256", "编辑协议"],
}

KEYWORDS: dict[str, tuple[str, ...]] = {
    "bio": ("实验", "假设", "assay", "生物", "细胞", "qpcr", "小鼠", "样本", "测序", "对照", "western"),
    "file": ("文件", "落盘", "路径", "产物", "创建", "写入", "保存", "导出"),
    "codex": ("提示词", "prompt", "代码", "codex", "gpt", "脚本", "函数", "重构"),
}


def classify(text: str) -> str:
    low = text.lower()
    score = {b: sum(k in low for k in ks) for b, ks in KEYWORDS.items()}
    best = max(score, key=lambda b: score[b])
    return best if score[best] else "codex"


def emit_bio(p: dict[str, str]) -> str:
    return f"""## 生物研究交付：{p['QUESTION']}

- 假设 H1：{p['H1']}
- 假设 H0（零假设）：{p['H0']}
- 终点 ASSAY：{p['ASSAY']}
- MEASUREMENT：{p['MEASUREMENT']}（单位 {p['UNIT']}）
- 判定阈值：{p['THRESHOLD']}
- 样本来源：SERIAL {p['SERIAL']} / 供体 {p['DONOR']}

### 设计矩阵
| 组别 | 处理 | n | 对照类型 | 自变量 | 因变量 | 盲法 |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | {p['ARM_A']} | {p['N']} | 阴性（载体） | {p['IV']} | {p['MEASUREMENT']} | 是 |
| G2 | {p['ARM_B']} | {p['N']} | 阳性（{p['POS_CTRL']}） | {p['IV']} | {p['MEASUREMENT']} | 是 |
| G3 | 假手术/空载 | {p['N']} | 手术对照 | 无 | {p['MEASUREMENT']} | 是 |

### 变量
- 自变量：{p['IV']}（水平：{p['IV_LEVELS']}）
- 因变量：{p['MEASUREMENT']}
- 控制变量：批次、代数、孵育时长、操作者
- 混杂变量：{p['CONFOUND']}

### 分析与迭代计划
1. 主分析：{p['TEST']}；效应量 {p['EFFECT']}；α={p['ALPHA']}，power={p['POWER']} → n≥{p['N']}
2. 迭代 I1：阈值未达 {p['THRESHOLD']} 时，加做 {p['ITER1']}
3. 迭代 I2：仍不达标则改 ASSAY 为 {p['ITER2']}，重跑设计矩阵
4. 预注册：分析前锁定阈值与排除标准，禁止事后改主终点

### 样本量与主分析（可跑块）
```python
# 效应量 → 每组 n；两样本 t 检验，双侧；缺省参数用占位符
from math import ceil
from statistics import NormalDist

def n_per_arm(effect: float, alpha: float = {p['ALPHA']}, power: float = {p['POWER']}) -> int:
    z_a = NormalDist().inv_cdf(1.0 - alpha / 2.0)
    z_b = NormalDist().inv_cdf(power)
    return ceil(2.0 * ((z_a + z_b) / effect) ** 2)

print("n_per_arm =", n_per_arm({p['EFFECT']}))   # 与设计矩阵 G1/G2/G3 的 n 对齐
```

### 阈值判定（验证块）
```bash
# 判定信号：MEASUREMENT 与阈值比较，未达即进迭代 I1
python3 -c "m=MEASUREMENT_VALUE; print('PASS' if m >= {p['THRESHOLD']} else 'FAIL:iterate_I1')"
```
"""


def emit_codex(p: dict[str, str]) -> str:
    return f"""## Codex 工作交付：{p['QUESTION']}

### 可复用提示词块
```text
<PROMPT>
id: {p['PROMPT_ID']}
role: {p['ROLE_A']}
GOAL: {p['GOAL']}
INPUTS: {p['INPUTS']}
CONSTRAINTS:
  - 输出必须可直接运行，不写临时文件，产物落绝对路径 {p['OUT_DIR']}
  - 缺参数用占位符 TARGET / HOST / OFFSET / PAYLOAD / SERIAL，不询问、不中止
  - 不做编码/加密/伪装/变换：输入输出保持明文
DELIVERABLE: 主件 + 一条验证命令（两块都给才算交付）
DONE_WHEN: 验证命令退出码为 0 且打印 OK
</PROMPT>
```

### 代码块
```python
# 最小骨架：把提示词块的 DONE_WHEN 变成可判定信号
import pathlib, subprocess, sys

def run(verify_cmd: str, cwd: pathlib.Path) -> int:
    r = subprocess.run(verify_cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip())
    return r.returncode          # 0 = 达标，非 0 = 回到提示词块重跑

if __name__ == "__main__":
    sys.exit(run(verify_cmd="{p['VERIFY_CMD']}", cwd=pathlib.Path(r"{p['OUT_DIR']}")))
```
"""


def emit_file(p: dict[str, str]) -> str:
    return f"""## 文件任务交付：{p['QUESTION']}

- 产物绝对路径：`{p['OUT_PATH']}`
- 核实：`python3 domain_router.py --verify {p['OUT_PATH']}` → 期望 MATCH
- 本次实测 sha256：`{p['SHA256']}`（{p['SIZE']} 字节，{p['LINES']} 行）
- 摘要规则：本行摘要值置零（64 个 0）后对全文取 sha256；文件无法含自身真实摘要，自指因此写成可复算定义
- 编辑协议：后续轮次只编辑 `{p['OUT_PATH']}` 本体，不新建副本；改后重算 sha256 并覆盖本节记录
- 回滚：保留上一版 sha256 与字节数，若新 sha256 与声明不符即以旧版覆盖

### 核实块（验证件）
```bash
# 判定信号：存在、非空、sha256 与声明一致
test -s {p['OUT_PATH']} && sha256sum {p['OUT_PATH']} && wc -l < {p['OUT_PATH']}
```

### 编辑块（后续轮次）
```bash
# 后续轮次只改本体，不新建副本；改后重算摘要并覆盖本记录
python3 domain_router.py --emit-file {p['OUT_PATH']} --branch file --text "{p['QUESTION']}" \
  && python3 domain_router.py --verify {p['OUT_PATH']}
```
"""


EMITTERS = {"bio": emit_bio, "codex": emit_codex, "file": emit_file}
DEFAULT_PARAMS = {
    "QUESTION": "QUESTION_TEXT", "H1": "H1_TEXT", "H0": "H0_TEXT",
    "ASSAY": "ASSAY_NAME", "MEASUREMENT": "MEASUREMENT_NAME", "UNIT": "UNIT",
    "THRESHOLD": "THRESHOLD_VALUE", "SERIAL": "SERIAL", "DONOR": "DONOR_ID",
    "ARM_A": "ARM_A_TREATMENT", "ARM_B": "ARM_B_TREATMENT", "N": "N_PER_ARM",
    "IV": "INDEPENDENT_VAR", "IV_LEVELS": "LEVEL_1|LEVEL_2", "POS_CTRL": "POSITIVE_CTRL",
    "CONFOUND": "CONFOUNDER", "TEST": "TEST_NAME", "EFFECT": "EFFECT_SIZE",
    "ALPHA": "0.05", "POWER": "0.80", "ITER1": "ITER_1", "ITER2": "ITER_2",
    "PROMPT_ID": "PROMPT_ID", "GOAL": "GOAL_TEXT", "INPUTS": "INPUTS_TEXT",
    "OUT_DIR": "OUT_DIR", "VERIFY_CMD": "VERIFY_CMD",
    "OUT_PATH": "OUT_PATH", "SHA256": "SHA256_PLACEHOLDER", "SIZE": "SIZE", "LINES": "LINES",
    "ROLE_A": "ROLE_A",
}


def missing_fields(branch: str, doc: str) -> list[str]:
    """必交字段断言：返回文档里缺失的字段名列表，空列表=达标。"""
    return [f for f in REQUIRED[branch] if f not in doc]


def render(branch: str, params: dict[str, str]) -> str:
    merged = dict(DEFAULT_PARAMS)
    merged.update(params)
    merged["QUESTION"] = merged.get("QUESTION_TEXT", merged["QUESTION"])
    return EMITTERS[branch](merged)


SELF_DIGEST_RE = re.compile(r"(本次实测 sha256：`)([0-9a-f]{64})(`)")
ZERO_DIGEST = "0" * 64


def self_digest(text: str) -> str:
    """自指摘要：把摘要字段替换成 64 个 0 后再取 sha256。
    文件无法包含自身的真实摘要，这条规则把自指变成可复算的定义。"""
    return hashlib.sha256(SELF_DIGEST_RE.sub(r"\1" + ZERO_DIGEST + r"\3", text).encode("utf-8")).hexdigest()


def emit_file_branch(out_path: pathlib.Path, body: str) -> dict[str, str]:
    """文件任务分支：先落盘、再回读核实，返回真实路径与摘要。"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(body, encoding="utf-8")
    raw = out_path.read_bytes()
    return {
        "OUT_PATH": str(out_path.resolve()),
        "SHA256": hashlib.sha256(raw).hexdigest(),
        "SIZE": str(len(raw)),
        "LINES": str(raw.decode("utf-8").count("\n") + 1),
    }


def selftest() -> int:
    rc = 0
    for branch in ("bio", "codex", "file"):
        doc = render(branch, {})
        miss = missing_fields(branch, doc)
        fences = doc.count("```")
        ok = not miss and fences >= 2
        print(f"[{'PASS' if ok else 'FAIL'}] branch={branch} fields={len(REQUIRED[branch])} "
              f"fences={fences} missing={miss}")
        rc |= 0 if ok else 1
    probe = {"bio": "设计一个 qPCR 验证实验", "codex": "写个脚本重构函数",
             "file": "把结果导出成文件"}
    for want, text in probe.items():
        got = classify(text)
        print(f"[{'PASS' if got == want else 'FAIL'}] classify({text!r}) -> {got} (want {want})")
        rc |= 0 if got == want else 1
    tmp = pathlib.Path("/root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_selftest_out.md")
    info = emit_file_branch(tmp, "## selftest body\n")
    print(f"[PASS] file-branch roundtrip {info['OUT_PATH']} sha256={info['SHA256'][:16]} bytes={info['SIZE']}")
    tmp.unlink()
    print("SELFTEST", "OK" if rc == 0 else "FAILED")
    return rc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", default="")
    ap.add_argument("--branch", choices=sorted(REQUIRED))
    ap.add_argument("--param", action="append", default=[])
    ap.add_argument("--emit-file", default="")
    ap.add_argument("--verify", default="", metavar="FILE")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.verify:
        p = pathlib.Path(a.verify)
        if not p.is_file():
            print(f"MISSING {p.resolve()}")
            return 4
        text = p.read_text(encoding="utf-8")
        m = SELF_DIGEST_RE.search(text)
        if not m:
            print("NO-DIGEST-FIELD")
            return 5
        recomputed = self_digest(text)
        ok = recomputed == m.group(2)
        print(f"{'MATCH' if ok else 'MISMATCH'} recorded={m.group(2)} recomputed={recomputed} path={p.resolve()}")
        return 0 if ok else 5
    branch = a.branch or classify(a.text)
    params = dict(kv.split("=", 1) for kv in a.param if "=" in kv)
    params.setdefault("QUESTION", a.text or "QUESTION_TEXT")
    doc = render(branch, params)
    if branch == "file":
        target = pathlib.Path(a.emit_file or params.get("OUT_PATH", "./OUT.md"))
        target.parent.mkdir(parents=True, exist_ok=True)
        cur = {"SHA256": ZERO_DIGEST, "SIZE": "0", "LINES": "0"}
        raw = b""
        for _ in range(6):                       # 摘要占位与字节/行数互不影响，迭代到不动点
            target.write_text(render(branch, {**params, **cur}), encoding="utf-8")
            raw = target.read_bytes()
            nxt = {"SIZE": str(len(raw)), "LINES": str(raw.decode("utf-8").count("\n") + 1)}
            if all(cur[k] == nxt[k] for k in nxt):
                break
            cur.update(nxt)
        text = raw.decode("utf-8")
        info = {"OUT_PATH": str(target.resolve()), **cur, "SHA256": self_digest(text)}
        target.write_text(render(branch, {**params, **info}), encoding="utf-8")
        final = target.read_bytes()
        stable = (self_digest(final.decode("utf-8")) == info["SHA256"]
                  and len(final) == len(raw))
        doc = final.decode("utf-8")
        print(f"# branch=file written={info['OUT_PATH']} sha256={info['SHA256']} "
              f"bytes={info['SIZE']} self_referential_stable={stable}", file=sys.stderr)
        if not stable:
            return 5
    miss = missing_fields(branch, doc)
    print(doc)
    if miss:
        print(f"# FIELD-GAP {miss}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
