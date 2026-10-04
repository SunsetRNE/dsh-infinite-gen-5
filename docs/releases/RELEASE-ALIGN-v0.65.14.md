# 发布链终态（v0.65.14 · 对齐会话）

生成时间：2026-10-04（本会话实测）
仓库：`/root/Project-Integrated-Workspace/dsh-infinite-gen-5` → 远端 `SunsetRNE/dsh-infinite-gen-5`

## 一、终态三行

| 对象 | 值 |
|---|---|
| `tag v0.65.14` | **b95eff0**（本地 = 远端，双端一致） |
| GitHub Release | **v0.65.14 · 4 资产 · draft false** |
| 远端 `main` | 8b82806（含核验/对齐脚本 3 个非发布件提交） |

## 二、四步核验（`tools/verify-release-assets.sh v0.65.14`）

| # | 判据 | 结果 |
|---|---|---|
| 1 | tag 双端一致；HEAD 是其后续提交不算分叉 | OK |
| 2 | Release 资产清单（tar.gz / zip / RELEASE-NOTES.md / SHA256SUMS） | OK |
| 3 | 下载包 sha256 == SHA256SUMS 登记值（`efabe0d3c67b59f7…`，15625622 B） | OK |
| 4 | 包内 `04b-ubuntu-workspace/SKILL.md` / `15-env-bootstrap/SKILL.md` / `ig5-ubuntu-detect.sh` 与 tag 树同 blob；包内版本 0.65.14 | OK |

结论：**失败 0 项 · 退出码 0** → 发布包与该 tag 的树逐字节一致。

## 三、CI 状态（GitHub Actions）

| 工作流 | 提交 | 状态 |
|---|---|---|
| release | b95eff0 | completed / success |
| verify | b95eff0 | completed / success |
| verify | c5990f7 | completed / success |
| verify | 64cfb9a | completed / success |
| verify | 8b82806 | in_progress（只动 3 个 `tools/*.sh`，无载荷影响） |

## 四、本会话修掉的两个真实缺陷

1. **核验脚本自身**：`curl` 不带 `-L` 时被 302 重定向吞掉包体（0 字节 → `e3b0c442…` 空体哈希），导致"包体与清单不符"的**假红**。判据件自己骗自己一次，修法是显式 `-fSL --retry 2` 并打印下载字节数。
2. **判据过严**：`tag == HEAD` 强等价把"tag 已对齐、HEAD 只是多了核验脚本"也判成不一致。改为「tag 双端一致 + `merge-base --is-ancestor` 判后继」两段式，能区分**后继**与**分叉**。

## 五、新增的两个可复用件（已推远端 main）

| 脚本 | 作用 | 出口 |
|---|---|---|
| `tools/verify-release-assets.sh` | 核验某 tag 的 Release 资产是否来自该 tag 的树 | 退出码 0 = 一致 |
| `tools/release-realign.sh` | 把已发布的 tag 接到新提交并让资产重建（删 Release → 删 tag → 重打 → 重推触发工作流） | `--dry` 先看计划 |

```bash
GH_TOKEN=<PAT> bash tools/verify-release-assets.sh v0.65.14
GH_TOKEN=<PAT> bash tools/release-realign.sh v0.65.14 --to=b95eff0 --dry
```

## 六、教训（写进流程，避免再犯）

**tag 必须打在「工作区干净、HEAD == 提交」的那一刻**。本次失误链：收口提交 → 打 tag → 又补了两个文件 → HEAD 前移，tag 便落后一个提交，发布包随之与树脱节。以后发版按顺序：收口提交 → `git status --porcelain` 为空 → `git tag -a` → `release-realign.sh` 只在事后补救时用。

## 七、凭据纪律

推送与 API 调用只从内存取 token（来源：`/root/Project-Integrated-Workspace/Branchbase-Android/.local-gh/.token`），构造一次性 `GIT_ASKPASS` 并用 `trap` 退出即删；本文件、日志与提交记录中均不含 token 明文。
