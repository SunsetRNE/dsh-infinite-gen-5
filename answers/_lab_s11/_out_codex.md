## Codex 工作交付：为 T0804 装配器生成可复用 Codex 块

### 可复用提示词块
```text
<PROMPT>
id: PROMPT_T0804
role: 代码代理
GOAL: 生成并核实 T08-04 三分支交付骨架
INPUTS: 请求原文 + 分支字段表
CONSTRAINTS:
  - 输出必须可直接运行，不写临时文件，产物落绝对路径 /root/dsh-infinite-gen-4/ig5-t3/answers/t0804
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
    sys.exit(run(verify_cmd="python3 domain_router.py --selftest", cwd=pathlib.Path(r"/root/dsh-infinite-gen-4/ig5-t3/answers/t0804")))
```

