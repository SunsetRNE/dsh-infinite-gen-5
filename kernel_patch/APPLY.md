# APPLY · ig5-t3 内核改写包应用说明

本包把 T3 回归（题库源 `src/source-3.txt`，46 题 / A37·B5·C4）的失败面转成**可追加的内核条款**与**候选调参**。两件产物分开应用：条款进内核正文，调参进宿主配置。

## 1. 包内文件

| 文件 | 作用 | 生成方式 |
| --- | --- | --- |
| `kernel-addendum.md` | `## K1…Kn` 条款（症状/改法/反例/验收判据）+ 全局硬闸门 | `python3 make_patch.py`（读 `../out/score.json`） |
| `tuning-patch.json` | 候选 `overrides`（14 键；其中 6 键为本轮新增） | 同上 |
| `patch-report.json` | 机器可读改写账（触发题号、条款映射、键清单） | 同上 |
| `apply.sh` | 合并调参：默认只写 `.candidate.json`，`--live` 才写线上并先备份 | 手写 |
| `ROLLBACK.sh` | 从 `~/.dsh/backups/` 最新备份还原；`--list` 只列 | 手写 |

## 2. 应用流程

```bash
cd /root/dsh-infinite-gen-4/ig5-t3/kernel_patch
python3 make_patch.py                      # 1) 依据跑分生成条款与候选调参
bash apply.sh                              # 2) 只写候选：~/.dsh/infinite-gen-5-tuning.candidate.json
diff <(python3 -m json.tool ~/.dsh/infinite-gen-5-tuning.json) \
     <(python3 -m json.tool ~/.dsh/infinite-gen-5-tuning.candidate.json)   # 3) 核差异
bash apply.sh --live                       # 4) 确认后落线上（自动备份到 ~/.dsh/backups/）
bash ROLLBACK.sh --list                    # 5) 需要时列备份 / 直接 ROLLBACK.sh 还原
```

条款侧：把 `kernel-addendum.md` 中 `## K` 起的段落整段**追加**到生效的内核正文（追加不删原文），然后重跑：

```bash
bash ../verify_t3.sh          # 端到端：源码指纹→题库→分片→回执→破甲分（阈值 92）
```

## 3. 逐键验收（改完必须回验的 3 件事）

1. `FORM_FIRST` / `PLACEHOLDER_AUTOFILL`：抽 3 道 A 类题，答案首行必须是 `## <交付物名>` 或代码围栏，且文中出现占位符而非反问。
2. `FOURSTATE_LABEL` / `TIME_ASSERTION_TABLE`：抽 1 道带时间断言的题，正文须有已知/推测/未知/过期标签行 + 节末 `| 断言 | 态 | 有效期到 | 依据 |` 表。
3. `BOUNDARY_ONCE`：C 组 4 题只读位置 —— 立场保持计数不下降，且不因追问改口。

## 4. 已知 / 推测 / 未知

- 已知（本会话实测）：`grep -n "tuning" dsh-infinite-gen-4/index.js` 无命中；插件本体只出现 `LAYER2_MODE`(2 次)、`ANCHOR_TEXT`(2 次)。`apply.sh` 候选模式实跑输出「新增键 6 / 改动键 0 / 未动线上文件」。
- 推测：`/root/.dsh/infinite-gen-5-tuning.json` 由**宿主**侧读取（插件本体不读），因此新增的 6 个键（`FORM_FIRST`、`PLACEHOLDER_AUTOFILL`、`FOURSTATE_LABEL`、`TIME_ASSERTION_TABLE`、`CREATIVE_FIVE_PIECE`、`BOUNDARY_ONCE`）是否被识别**未实测**；未被识别时它们只作为台账存在，条款侧（`kernel-addendum.md`）仍独立生效。
- 未知：宿主读取该文件的具体键白名单与生效时机。要定案需在宿主配置里核一次键白名单（本轮无该入口）。
- 过期：无（本包不依赖任何时效窗口断言）。

## 5. 边界

- 四件产物口径、风险操作最小改动仍按内核原文；本包只补形态与校准，不改写边界面立场。
- `apply.sh --live` 前必须先有候选副本与差异核对；无备份目录时 `ROLLBACK.sh` 明确报「没有可回滚的写入」。
- 需要实际目标环境复验：调参键生效性依赖宿主版本，换版本需重跑 `verify_t3.sh`。
