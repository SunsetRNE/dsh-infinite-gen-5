# 宿主布局与解析（DSH 0.1.7 / 0.2.0）

> 记录日期 2026-09-29。核对了本机 0.1.7-rc.2 与隔离安装的 0.2.0-rc.1（registry 上
> `@deepseek-ai/dsh` 只有 `0.1.7-alpha.2 / 0.1.7-rc.1 / 0.1.7-rc.2 / 0.2.0-rc.1`，
> dist-tags `latest=0.1.7-rc.2`、`next=0.2.0-rc.1` —— **没有稳定版 0.2.0**）。

## 1. 两代布局差在哪

| | 0.1.7-rc.2（单体） | 0.2.0-rc.1（拆分） |
|---|---|---|
| `@deepseek-ai/dsh` 包本体 | 13354 文件、无 `.d.ts` | 20 文件启动器（131K），完整 `.d.ts` |
| 子系统落点 | `dsh/node_modules/@deepseek-ai/*` | `node_modules/@deepseek-ai/*`（约 300 个平铺兄弟包，合计 217M） |
| `@deepseek-ai/cordis` | 4.0.4 | 4.0.4（同版） |
| 插件装载 | `dsh plugin --profile <名字> <pnpm 参数>` | 同一命令、同一 profile 机制 |

插件侧的宿主 API 面**未变**：`systemPrompt.section/context`、`system-prompt/assemble`
瀑布、`tools.register/get`，能力键 `userQuestions / sessionProjections / webServer`
在 0.2.0-rc.1 的 `dsh-system-prompt/lib/types/index.d.ts:239/258/27`、
`dsh-tools/lib/types/index.d.ts:636/690` 逐条命中。

## 2. 门禁侧的坑：静默回落

五套宿主侧门禁（`verify_injection` / `verify_armor` / `verify_surface` /
`verify_tuning` / `verify_scenario_tool`）原来只把「`dsh` 包目录」当候选，命中条件写死
`<root>/node_modules/@deepseek-ai/{cordis,dsh-system-prompt}/lib/index.js`。在 0.2.0 布局下：

```
--host=/tmp/dsh020/node_modules/@deepseek-ai/dsh   → 匹配不到 → 回落 /usr/local 旧宿主
```

**这是最坏的一种绿**：命令成功、断言全过，跑的不是你指定的宿主。0.2.0 下的正确写法是
node_modules 的父级（`--host=/tmp/dsh020`），但没人该记住这件事。

## 3. 修法：`scripts/lib/host-resolve.mjs`

候选从「一条路径」扩成「这条路径 + 最多 3 层祖先目录」，并同时认三种形状：

| 写法 | 例子 |
|---|---|
| node_modules 的父级 | `--host=/tmp/dsh020` |
| `@deepseek-ai` 作用域目录 | `--host=/tmp/dsh020/node_modules/@deepseek-ai` |
| `dsh` 包目录（0.1.7 单体） | `--host=/usr/local/lib/node_modules/@deepseek-ai/dsh` |

规则：

- **显式指定**（`--host=` 或 `IG5_DSH_ROOT`）找不到宿主 → `FAIL` + `exit 1`，绝不改读别的宿主；
- **未指定**才回落默认候选，找不到 → `SKIP` + `exit 0`（裸机 / CI 是环境限制，不是回归）；
- `patch-host-toolargs.mjs` 与 `verify_ui.mjs` 里两处写死的 `/usr/local/...` 路径改为按包名
  `findPackageDir("dsh-llm-deepseek" / "dsh-client-ui-theme")` 搜索，旧路径只作最后兜底。

## 4. 复现与判据

```bash
# 隔离装 0.2.0-rc.1（不碰本机 ~/.dsh）
npm install --prefix /tmp/dsh020 --no-audit --no-fund @deepseek-ai/dsh@0.2.0-rc.1

# 五套门禁：两种宿主各跑一遍，取真实退出码
cd /root/dsh-infinite-gen-5
for s in injection armor surface tuning scenario_tool; do
  node scripts/verify_$s.mjs --host=/tmp/dsh020 > /tmp/v020_$s.txt 2>&1; echo "0.2.0 verify_$s RC=$?"
  node scripts/verify_$s.mjs                 > /tmp/v017_$s.txt 2>&1; echo "0.1.7 verify_$s RC=$?"
done

# 严格失配：坏路径必须 FAIL/exit 1，而不是换个宿主继续跑
node scripts/verify_injection.mjs --host=/tmp/ig5-nope; echo "BADPATH_RC=$?"
```

实测（2026-09-29）：

| 门禁 | 0.2.0-rc.1（`--host=/tmp/dsh020`） | 0.1.7-rc.2（默认宿主） |
|---|---|---|
| `verify_injection` | 65 通过 / 0 失败，RC=0 | 65 / 0，RC=0 |
| `verify_armor` | 25 PASS / 0 FAIL，RC=0 | 25 / 0，RC=0 |
| `verify_surface` | 19 通过 / 0 失败，RC=0 | 19 / 0，RC=0 |
| `verify_tuning` | 61 通过 / 0 失败，RC=0 | 61 / 0，RC=0 |
| `verify_scenario_tool` | 88 通过 / 0 失败，RC=0 | 88 / 0，RC=0 |

两代宿主都打印同样四条 `ctx.on is not a function` 提示 —— 那是门禁自带的裸 `Context`
没有事件总线（对照实验逐字相同），不是 0.2.0 的回退。

## 5. 断言状态

| 断言 | 态 | 有效期到 | 依据 |
|---|---|---|---|
| 五套门禁在 0.2.0-rc.1 上 RC=0 且读数与 0.1.7-rc.2 相同 | 已知 | 2026-09-29 | 本轮实测 5×2 次 |
| 插件依赖的宿主 API 面在 0.2.0-rc.1 仍在 | 已知 | 2026-09-29 | 0.2.0-rc.1 `.d.ts` 行号 |
| 显式 `--host` 失配即 FAIL（不再静默回落） | 已知 | 2026-09-29 | `--host=/tmp/ig5-nope` → RC=1 |
| 端到端把插件装进 0.2.0 profile 跑真会话 | 未知 | — | 未跑（需 pnpm 安装 + 凭据） |
| 稳定版 0.2.0 的行为 | 未知 | — | 该版本尚未发布 |

- 截至 2026 年（2026-09-29 核）已验证：上一版门禁在 0.2.0 布局下会静默回落旧宿主，该路径已被覆盖，以下为修好后的写法。
- 适用范围：适用于 Linux 容器 Node v24.19.0 上的 DSH 0.1.7-rc.2 与 0.2.0-rc.1；换平台或换大版本需重新核验。
- 已知：两种布局的包落点与解析规则；推测：正式版 0.2.0 不动服务名与 cordis 即无需再改；未知：端到端 profile 真会话行为、正式版 0.2.0 的实际差异。
- 依赖与边界：需要实际目标环境复验（端到端 profile 装载需网络与凭据）；架构上无法在不装载插件的前提下判定真会话行为。
