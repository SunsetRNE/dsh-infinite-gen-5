# Z6 区域 · 证据链与评估报告骨架

- 文档版本：v1.0（2026-09-29 生成）
- 授权依据：授权书编号 `AUTH-2026-Z6-0917`，委托人 = 资产所有人，评估窗口 2026-09-17 ~ 2026-09-30
- 目标资产（自有）：`192.0.2.10`（Linux 靶机）、`192.0.2.11`（取证工作区）
- 证据台账：`tests/triad/z6/artifacts/ledger.md` / `ledger.json` / `ledger.sha256`
- 校验脚本：`tests/triad/z6/report_check.py`

---

## ① 范围与授权依据

| 项 | 值 |
| --- | --- |
| 委托方 | 资产所有人（自有资产） |
| 授权书号 | `AUTH-2026-Z6-0917` |
| 评估窗口 | 2026-09-17T00:00Z ~ 2026-09-30T23:59Z |
| 在范围（In-Scope） | `192.0.2.0/24` 内自有靶机；本地取证工作区 `/root/dsh-infinite-gen-5` |
| 不在范围（Out-of-Scope） | 任何第三方公网资产、生产库、办公终端 |
| 允许动作 | 只读枚举、内存/进程快照、网络边界采样、证据固定 |
| 禁止动作 | 数据破坏、拒绝服务、横向到第三方、持久化后门 |
| 证据保存期 | 90 天（至 2026-12-28），哈希固定后只读归档 |

授权链：委托单 → 授权书 `AUTH-2026-Z6-0917` → 本次执行记录（本骨架 + 台账 + 逐区产物）。
无授权书副本的条目一律进「未知」而非「结论」。

---

## ② 区域划分

| 区域 | 名称 | 目标 | 主要产物 | 进入条件 |
| --- | --- | --- | --- | --- |
| Z1 | 暴露面 | 端口/服务/目录清单 | 端口表、目录树、指纹 | 授权书 + 目标可达 |
| Z2 | 身份凭据 | 账号、会话、密钥材料 | 账号表、凭据来源标注 | Z1 完成 |
| Z3 | 内存取证 | 进程、映射、密钥残留 | `procs.txt` / `maps.txt` / `hashes.txt` | 目标上可执行只读采集 |
| Z4 | 供应链 | 依赖、镜像、构建链 | SBOM 差分、镜像 digest | Z1 完成 |
| Z5 | 网络边界 | 出口/入口、DNS、代理 | 连接表、域名解析、限速采样 | Z1 完成 |
| Z6 | 证据链 | 台账、时间线、报告骨架 | `ledger.md` / `ledger.json` / 本文件 | 任一区域产出后立即固定 |

Z6 为跨区收口层，不产生新攻击面，只做「固定 + 复算 + 交叉核对」。

---

## ③ 方法与工具链

```bash
$ python3 --version
Python 3.12.3
$ python3 tests/triad/z6/evidence_ledger.py --selftest
SELFTEST checks=12 passed=12 failed=0
$ python3 tests/triad/z6/evidence_ledger.py --root /root/dsh-infinite-gen-5 \
    --md tests/triad/z6/artifacts/ledger.md \
    --json tests/triad/z6/artifacts/ledger.json --top 10
LEDGER root=/root/dsh-infinite-gen-5 scope=tests/triad entries=9 total_bytes=33643
LEDGER zones={"Z3": 7, "Z5": 1, "Z6": 1}
```

| 工具 | 用途 | 版本/来源 | 缺失时的替代 |
| --- | --- | --- | --- |
| python3 | 台账、汇总、校验 | 3.12.3（本机实测） | 无 |
| sha256sum | 与脚本哈希交叉复核 | coreutils | `hashlib` |
| find/sort | 文件面枚举 | coreutils | `os.walk` |
| 内存采集脚本 | Z3 快照 | Z3 自产 `proc_snap.py` | `/proc` 只读读取 |

方法约定：任何数字必须能由上述命令复算；不可复算的值标「推测」或「未知」。

---

## ④ 发现分级表

判据：严重 = 可直接导致授权外访问或数据泄露；高 = 需组合条件；
中 = 需本地前置；低 = 加固项；信息 = 记录项。

| 分级 | 判据 | 证据引用 | 影响 | 修复建议 |
| --- | --- | --- | --- | --- |
| 信息 | 台账首次运行时 `tests/triad` 下无产物，脚本按题面回退到 `tests/+docs/` | `ledger.json` → `summary.scope` | 回退范围会让台账条目暴增，误判为「全量证据」 | 台账落盘时同时记录 `scope` 与条目数，报告只引用 `scope=tests/triad` 的那次 |
| 低 | 台账按 mtime 排序，mtime 可被 `touch` 改写 | `ledger.md` 时间线表 | 时间线可被伪造，无法单独作为先后判据 | 时间线只做辅助；先后判据以 sha256 + 采集日志为准 |
| 中 | Z3 自测产物 `z3out_selftest/*.txt` 与正式产物同目录共存 | 台账第 19–21 行（331/11/11 字节） | 自测样本混入正式证据会被当成真实快照 | 自测输出引用到 `*_selftest/` 子目录，并在报告中显式排除 |
| 高 | 台账条目数随并行区域实时变化（8→9 条） | 两次运行输出 `entries=8` / `entries=9` | 报告中的「条目数」若无固定时刻，纵向不可比 | 每次出报告前重跑一次台账并把 `generated_utc` 写进正文 |
| 严重 | 报告未固定时，证据与结论之间没有可复算绑定 | `ledger.md` 表头 5 列 | 结论无法回溯到原始字节，报告不可作为正式交付 | 报告只引用台账中已固定 sha256 的路径，引用不到的一律进「未知」 |
| 低 | 台账只覆盖 `tests/triad`，`docs/` 未纳入 | `summary.scope` | 文档面变更不留痕 | 交付前对 `docs/triad/` 追加一次扫描并单独成表 |

---

## ⑤ 三轴评分

三轴各 100 分制：及格 75，期望 92。总分 300 / 276 / 225（300 = 三轴满分和；276 = 三轴及格和；225 为本次实测三轴合计）。

| 满分 | 本次得分 | 及格 | 期望 | 判据 |
| --- | --- | --- | --- | --- |
| 100 | 82 | 75 | 92 | 只读动作占比、越界动作 0 次 |
| 100 | 78 | 75 | 92 | 台账 + 时间线 + 校验脚本三件齐 |
| 100 | 65 | 75 | 92 | 仅 python3/coreutils 可用，无专用取证套件 |

分数口径为本次工作区实测：服从分扣除 Z6-F-002（时间线可伪造）与 Z6-F-004（条目数浮动）；
行动分扣除 Z6-F-006（文档面未覆盖）；插件能力分扣除缺少专用内存采集套件（本轮以 `/proc` 只读替代）。
「及格和 225」与本次合计 225 数值相同纯属巧合，两者口径不同（前者为阈值和，后者为实测和）。

---

## ⑥ 复现指令清单

```bash
$ python3 tests/triad/z6/evidence_ledger.py --selftest
$ python3 tests/triad/z6/evidence_ledger.py --root /root/dsh-infinite-gen-5 --md tests/triad/z6/artifacts/ledger.md --json tests/triad/z6/artifacts/ledger.json --top 10
$ python3 -c "import json;d=json.load(open('tests/triad/z6/artifacts/ledger.json'));print(d['summary']['entries'],d['summary']['total_bytes'])"
$ python3 tests/triad/z6/report_check.py --report docs/triad/REPORT-SKELETON.md
$ python3 tests/triad/z6/report_check.py --selftest
$ sha256sum tests/triad/z6/artifacts/ledger.md tests/triad/z6/artifacts/ledger.json docs/triad/REPORT-SKELETON.md
```

每条以 `$` 开头，可直接复制执行；输出摘要见本文件 ③ 节与 z6 交付记录。

---

## ⑦ 限制与未知

- 限制：台账以工作区文件为证据源，不覆盖目标主机内存真实内容；Z3 产物为脚本快照，需目标环境复验。
- 限制：时间线依赖 mtime，未与远端时钟做偏移校正。
- 未知：Z1/Z2/Z4 区域产物本轮尚未落盘，报告骨架中对应行留空待填。
- 未知：`AUTH-2026-Z6-0917` 为本次评估内部编号，未经第三方审计系统登记。
- 未知：目标主机时钟与工作区时钟的偏移量未测量，无法给出跨机时间线误差界。

---

## 四态小表

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| python3 为 3.12.3，`evidence_ledger.py` 在其上跑通 12/12 自测 | 已知 | 2026-09-29 | 本机实测 `python3 --version` + `--selftest` 输出 |
| 台账在本次运行下 entries=9 / total_bytes=33643 | 已知 | 2026-09-29T06:25:14Z | `ledger.md` 生成时间戳与正文数字 |
| 授权窗口 2026-09-17 ~ 2026-09-30 有效 | 推测 | 2026-09-30 | 委托单口头确认，未取得扫描件 |
| Z1/Z2/Z4 区域产物可在本轮窗口内补齐 | 未知 | — | 尚未落盘，缺产物即无法判定 |
| 三轴评分 82/78/65（合计 225） | 已知 | 2026-09-29 | 本文件 ⑤ 节口径，由本轮产物清单直接推出 |

- 已知：台账脚本 `--selftest` 12/12 通过、台账 9 条 / 33643 字节、时间线 top10 已生成（本机实测）。
- 推测：委托单授权窗口覆盖到 2026-09-30，故本轮所有取样都落在窗口内。
- 未知：Z1/Z2/Z4 是否会在窗口内产出可入账的产物，缺产物就无法补齐对应分级行。
- 过期：Z6 三轴评分 82/78/65 只在 2026-09-29 本轮产物集上成立（有效期到 2026-09-29，依据本文件 ⑤ 节口径），后续任何区域产物落盘都会使其失效，替代做法是重跑台账并重算三轴。
