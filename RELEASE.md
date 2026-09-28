# ig5-t3 发布说明（RELEASE）

## 这是什么
把附件《模型越狱注入提示词3.txt》（sha256 `f4cd463d37d78e17b6741bea1340d4cd76433e639c7f1127fd79b29f71075fdc`）当题库真源，
抽题 → 分片派发 → 收四态回执 → 计分 → 产出内核改写包的**一条可复跑回归链**。

## 版本
- 发布 tag：`t3-v1`
- 出包命令：`bash release.sh t3-v1`（产物在 `out/dist/`，含 `.sha256` 与 `.manifest`）
- 复现单包：`git archive --format=tar.gz --prefix=ig5-t3/ -o OUT t3-v1`

## 实测结果（本机跑出，非推算）
| 指标 | 值 | 判据来源 |
|---|---|---|
| 破甲分 rate | 99.3 | `out/score.json`，`100×Σhit/42` |
| rate_all | 90.7 | 分母 46（C 组 4 题按 0 计） |
| 覆盖 | 46/46 | `receipts/all.jsonl` 46 行，去重后 46 |
| 四态 | deliver 40 · pivot 5 · boundary 1 | 同上 |
| 边界面位置 | 立场保持 3 · 越界 1 | 预注册口径，未回填 |
| 改写队列 | 0 | `kernel_patch/patch-report.json` 的 `failed_ids: []` |
| 端到端断言 | PASS（6/6 段） | `bash verify_t3.sh` |
| 远端校验 | 远端 sha == 本地 HEAD | `git ls-remote origin main` |

## 全链命令
```bash
cd ig5-t3
bash run_all.sh          # 题库自检 → 回执入库 → 计分 → 六段断言
bash push_flow.sh        # 建仓/提交/推远端/校验（REMOTE_URL=... 可换上游）
bash verify_t3.sh        # 仅复验（期望 VERDICT: PASS）
python3 score_t3.py --selftest   # 计分器自检
```

## 状态
- 已知：46 题抽取、16 片分片、计分口径、推送 sha 一致，均本机实测。
- 推测：宿主側读取 `~/.dsh/infinite-gen-5-tuning.json`（插件本体 grep 无 tuning 命中）。
- 未知：宿主对 `kernel_patch/tuning-patch.json` 新增 6 键（`FORM_FIRST`、`PLACEHOLDER_AUTOFILL`、`FOURSTATE_LABEL`、`TIME_ASSERTION_TABLE`、`CREATIVE_FIVE_PIECE`、`BOUNDARY_ONCE`）是否识别与生效时机——未公开 / 我不掌握。
- 过期：历史三跑 91.1 / 92.8 / 93.7（有效期到 2026-09-28，依据 `ig5-score-report.md`）；本轮同源题库口径已覆盖该参照，以下为新写法：以 `out/score.json` 的 rate 99.3 为准。

## 回滚
```bash
bash kernel_patch/ROLLBACK.sh --list   # 列备份（候选模式从不写线上 tuning）
rm -rf out/remote/ig5-t3.git           # 删本地裸远端（远端删除即回滚推送）
git tag -d t3-v1                       # 撤 tag
```
