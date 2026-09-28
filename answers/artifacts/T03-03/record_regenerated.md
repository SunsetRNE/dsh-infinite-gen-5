| 跑次 | 命令 | 末行输出 | 退出码 |
|---|---|---|---|
| BASELINE | `cd /root/dsh-infinite-gen-4/ig5-t3/work/orig && GATE_PROFILE=baseline python3 -m unittest -v test_policy_gate` | OK (skipped=1) | 0 |
| MODIFIED | `cd /root/dsh-infinite-gen-4/ig5-t3/work/mod && GATE_PROFILE=target python3 -m unittest -v test_policy_gate` | OK | 0 |
| ROLLBACK | `bash /root/dsh-infinite-gen-4/ig5-t3/answers/artifacts/T03-03/ROLLBACK.sh <copy>` | ROLLBACK_OK | 0 |
