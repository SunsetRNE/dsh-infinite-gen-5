# tag CI 失败复盘与门禁可移植性（v0.38.1）

tag `v0.38.0` 触发的 GitHub Actions `package` job 在 `npm run verify:hardening` 处退出 1，整条链中断。
失败的不是插件产物，而是**门禁自检把「环境探测结果」当成了断言对象**：CI runner 上没有 `setpriv` / `su`，
降权通道探测回 `static`，自检却要求通道必须可用并跑完阳性/阴性对照。

## 1. 现场（tag v0.38.0 · HEAD 47a1eca）

| 项 | 实测值 |
| --- | --- |
| runner | `ubuntu-24.04`（24.04.5）· `git 2.55.0` |
| Node / npm | `v22.23.2` / `10.9.8`（本机是 Node `v24.19.0` / npm `11.17.0`） |
| actions | `actions/checkout@v4`（`11d5960a326750d5838078e36cf38b85af677262`）· `actions/setup-node@v4`（`49933ea5288caeca8642d1e84afbd3f7d6820020`） |
| 权限 | `GITHUB_TOKEN` Contents: write |
| 失败位置 | `verify:all` 第 32 项 `verify:hardening` |

失败原文（`node scripts/cred_reach_gate.mjs --selftest`，10 条里 5 条 FAIL）：

```
FAIL(降权通道可用（setpriv/su）)
FAIL(阳性对照：644 文件降权可读)
FAIL(阴性对照：000 文件降权被拒)
FAIL(阴性对照：不存在的路径判为不可读)
ok(扫描 mode/class 与 lstat 一致)
ok(无漂移时 check 为空)
FAIL(被拒→可读 记为回归)
FAIL(探测不可用记为 unknown)
ok(新增可读凭据记为回归)
ok(harden 计划为幂等 chmod)
cred_reach_gate 自检未通过（共 10 条，通道 static）
##[error]Process completed with exit code 1.
```

旁证：同一 job 里 `plugin_integrity --selftest`（10 条）通过，所以中断点确实只在 `cred_reach_gate`。
另外两条 `Node.js 20 弃用` 告警来自 action 自身运行时被强制升级到 Node 24，与本次失败无关。

## 2. 根因

`probeTools()` 三选一返回 `setpriv` / `su-nobody` / `static`：前两者要求 `/usr/bin/setpriv` 或 `/usr/bin/su` 存在且能用。
CI runner 两者都没有 → `static` → `read()` 恒为 `null`。
旧自检把下列四件事写成了「必须成立」：通道可用、644 可读、000 被拒、不存在路径不可读 —— 于是**在没装这两条通道的机器上必然红**，
而本机（root + setpriv 可用）永远是 `CRED_REACH=NO_DRIFT` 全绿，本地跑 `verify:all` 抓不到这条。

顺带暴露的第二个缺陷：`被拒→可读 记为回归` 与 `探测不可用记为 unknown` 这两条本来**是纯函数断言**，
旧写法却拿 `scan()` 的真实行做输入 —— 在 `static` 下两行的 `droppedRead` 都是 `null`，等于把环境耦合进了逻辑断言。

## 3. 修法：三层断言

`scripts/cred_reach_gate.mjs` 的 `selftest()` 拆成三组，`bad` 只统计三组之和：

| 组 | 条数 | 内容 | 环境要求 |
| --- | --- | --- | --- |
| 环境无关 | 7 | 通道枚举合法 · `scan` 的 mode/class 与 `lstat` 一致 · 无漂移时 `check` 为空 · 被拒→可读记回归（造数据） · 探测不可用记 unknown 且不误报回归（造数据） · 新增可读凭据记回归 · `harden` 幂等 | 无 |
| live（通道可用时） | 4 | 通道可用 · 644 降权可读 · 000 降权被拒 · 不存在路径判不可读 | `setpriv`/`su` |
| static（通道缺失时） | 3 | `read()` 恒 `null`（不冒充可读） · 降级扫描每行记 `unknown` · 降级时不误报回归 | 无（反向断言） |

通道不可用时，四条对照打印 `skip(...)`，不计入失败；`static` 分支转而验证**降级路径本身是否诚实**（不把「读不到」当「读到了」）。
这样 CI 与真机都在验证同一份契约：**探不到就说探不到，且不因此报警**。

## 4. 证据（本机实测）

```bash
node --check scripts/cred_reach_gate.mjs
node scripts/cred_reach_gate.mjs --selftest                 # 本机有 setpriv
sed -e 's#/usr/bin/setpriv#/nonexistent/setpriv#g; s#/usr/bin/su#/nonexistent/su#g' \
  scripts/cred_reach_gate.mjs > /tmp/crg_static_sim.mjs
node /tmp/crg_static_sim.mjs --selftest                     # 模拟「无降权通道」的 runner
npm run verify:hardening                                    # 全链
```

- live：**11 条通过 · 0 失败 · 跳过 0 条 · 通道 setpriv**（退出码 0）
- static 模拟：**10 条通过 · 4 条 skip · 通道 static**（退出码 0；四条对照被跳过，降级断言全过）
- `verify:hardening`：`plugin_integrity` 10 条 · `cred_reach_gate` 11 条 · `ca_key_guard` 10 条 · `--check` 回 `CRED_REACH=NO_DRIFT`（7 件扫描）→ 退出码 0

static 一列是**模拟**（把两个绝对路径改指 `/nonexistent/` 的副本）；真 CI 上同一分支的复验见 §6 —— 那里是真正的 `通道 static`，输出形状与模拟一致。

## 5. 门禁可移植性矩阵

CI（无 DSH 宿主、无降权通道）上各套件的行为，2026-09-29 那次 tag run 的实测：

| 套件 | CI 行为 | 说明 |
| --- | --- | --- |
| `verify_injection` / `verify_armor` / `verify_surface` / `verify_tuning` / `verify_scenario_tool` | SKIP | 找不到 DSH 宿主（`verify_armor` 先跑完 20 条 selftest 再跳过宿主侧） |
| `verify_skill` | `0 通过 / 0 失败 / 1 跳过` | dist 产物与四个扫描根都不在场 |
| `verify_dispatch` | 50 通过 | 比本机少 2 条，那两条依赖宿主 |
| `verify_hardening` | 退出 1（本次已修） | `cred_reach_gate` 自检环境耦合 |
| 其余 30 项 | 通过 | 版本/门禁/词表/UI/评测等与环境无关 |

`verify:all` 第 33–35 项（`verify:runtime` / `verify:sync` / `verify:install`）在 v0.38.0 那次 run 里**没跑到**（链在第 32 项断了）。
本机用 `DSH_HOME=/tmp/nohost-dsh` 模拟无宿主后逐条复验，三套都干净跳过且退出码 0：

```
SKIP: 没找到运行态副本（~/.dsh/plugin-src/dsh-infinite-gen-5）—— 本机没装 DSH 时无从比对，CI 上跳过即可。
verify_sync：37 通过 · 0 失败 · 1 警告（没有可用的宿主指纹做交叉验证 — 跳过）
SKIP 无限五代安装体检：找不到 /tmp/nohost-dsh（CI / 未装 DSH 的机器属正常）
```

## 6. tag v0.38.1 的真 CI 结论（已回读）

- `gh run view 36547285512`：`package` job **completed / success**，HEAD `51c8048`（checkout 日志里的提交标题即本轮修复提交）。
- 真 CI 上 `cred_reach_gate` 的那几行原文：

```
skip(降权通道可用（setpriv/su） — 本机无 setpriv/su，见降级断言)
skip(阳性对照：644 文件降权可读 — 本机无 setpriv/su，见降级断言)
skip(阴性对照：000 文件降权被拒 — 本机无 setpriv/su，见降级断言)
skip(阴性对照：不存在的路径判为不可读 — 本机无 setpriv/su，见降级断言)
cred_reach_gate 自检通过（共 10 条 · 跳过 4 条 · 通道 static）
ca_key_guard 自检通过（共 10 条）
CRED_REACH=NO_DRIFT
verify_sync：37 通过 · 0 失败 · 1 警告
SKIP 无限五代安装体检：找不到 /root/.dsh（CI / 未装 DSH 的机器属正常）
```

即：CI 走的就是 static 分支，四条对照被跳过、降级断言全过，链一路跑到底（含 v0.38.0 那次没跑到的 `verify:sync` / `verify:install`）。
同一提交的 main 分支 run `36547233568` 也是 success；对照之下，tag v0.38.0 的 run `36546187205` 是 failure —— 修复前后各一次真跑，因果闭合。

## 7. 断言状态

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| CI runner 无 `setpriv`/`su`，通道探测回 `static` | 已知 | — | tag v0.38.0 run 日志与 v0.38.1 run 日志一致 |
| tag `v0.38.1` 的 CI run 转绿（`package` success） | 已知 | — | `gh run view 36547285512`，2026-09-29 回读 |
| `verify:all` 第 33–35 项在 CI 上干净跳过 | 已知 | — | v0.38.1 run 里 `verify_sync` 37/0 与安装体检 SKIP 原文 |
| 修后本机 live 11/0、static 模拟 10/0、`verify:hardening` 退出 0 | 已知 | — | 本机 `node` 实跑输出 |
| 「Node.js 20 弃用」告警不影响结果 | 已知 | — | 两次 run 里告警后流程照常执行 |
| Node 22 / npm 10.9.8 与 Node 24 / npm 11.17.0 行为一致 | 推测 | — | 两端全链都退出 0，但未逐套做差异比对 |

- 截至 2026 年（2026-09-29 核）已验证：tag `v0.38.1` 的 CI `package` job 与 main 分支 run 均 success，`cred_reach_gate` 在 static 通道下 10 条通过 / 4 条 skip，链跑完全部 35 项。
- 适用范围：适用于 Linux CI runner（ubuntu-24.04、Node 22.23.2）与本机 Linux 容器（Node 24、root + setpriv）；换 macOS / Windows runner 需重新核验（`setpriv`/`su` 路径与 `chmod` 语义都不同）。
- 已知：CI 失败根因、修法与两次真 run 的结论都已回读；推测：两个 Node 主版本在剩余套件上无差异；未知：别的 runner 镜像（如自建镜像）是否带 `setpriv` 我没测。
- 依赖与边界：需要实际 CI 环境复验；本次结论只覆盖 `ubuntu-24.04` 这一档 runner。
