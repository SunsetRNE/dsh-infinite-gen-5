---
name: ig5-layer-06-build-contract
description: 无限五代 Android/Gradle 工程「构建 层：命中 whenToUse 触发词即装载
whenToUse: 任务涉及「AGP 升级报错 · APK 重命名 · 版本号与产物命名 · 配置缓存报错 · JNI 与 .so 不同步  · AGP · APK · JNI · AGP · APK · JNI
---

# ig5-layer-06-build-contract · 构建与版本契约

## 何时用

- 升 AGP / Kotlin / Gradle 后出现「以前能编、现在报错」。
- 要定或改**版本号串**与**产物命名**。
- 报错指向 A 处、真因在 B 处（配置缓存、块注释嵌套、locale、JNI 签名）。
- 拆或改构建环境的准备脚本。

## 第一铁律 · 版本号串先问用户，别自己定规则

**版本号串是用户习惯的一部分，不是工程最优解。** 同一个团队可能坚持纯 semver、可能要求带构建时间戳、
可能要求产物名带分支名，也可能完全无所谓。AI 自行选一套再「顺手修好」别人的脚本题，是本层最容易被骂的动作。

因此本层的强制条款是：**先给用户三档互斥方案 + 一个「你来定」，拿到回答再动手**；用户明确说「你定」才按其
最小默认落。模板见 `references/version-ask.md`。任何情况下都不要：

- 在没问的情况下改**已有**版本号串的格式（哪怕看起来「更规范」）；
- 把「语义化版本」当成默认正确（它只是一种约定）；
- 在产物名里偷偷加/去时间戳、哈希、分支名。

## 第二铁律 · 本层多数结论**没有官方出处**，别拿公告当判据

本层的知识不是读文档得来的，是**同一条路撞了十几次才写下来的**。因此：

| 级 | 含义 | 能不能靠「查公告」验证 |
|---|---|---|
| **E1 官方明示** | 官方文档或官方报错原文直接写了（例：AGP 9 内置 Kotlin 那句报错就是官方产出的） | 能 |
| **E2 半官方** | 官方源码/发布说明可见，但文档没写成人话 | 勉强能（要读源码或 release notes 原文） |
| **E3 实测踩坑** | **官方公告里没有明确说明**，靠试出来的（例：产物重命名要走内部实现类；块注释嵌套吞代码；中文标识符撞 locale） | **不能** —— 公告里根本没有，查也查不到，只能**复跑**验证 |

对 E3 条目，纪律是：

1. **不得写成「官方行为」**；写「实测如此（版本边界：<AGP X.Y / Kotlin A.B / Gradle C.D>）」。
2. **不得靠查公告来验证或作废**；唯一判据是**在当前版本组合上再跑一次**。
3. **记下撞了几次**：E3 条目的证据强度就是踩坑次数 + 复现判据，两者缺一不可。
4. 版本边界（AGP / Kotlin / Gradle 三者组合）是 E3 结论的一部分 —— 换任一版本都要重新判定，不能外推。

## 九条实测教训（详见 `references/build-lessons.md`）

| # | 一句话 | 判据 |
|---|---|---|
| 1 | AGP 9 移除了产物重命名旧 API，新写法要强转内部实现类并用 `.set()` | 见 references 的对照代码 |
| 2 | 版本号是**四层**：工程版本 / 构建标准版本 / 平台字段 / 产物名 —— 谁是哪一层的真源必须写死 | `verify-build-contract.sh` 检查真源唯一 |
| 3 | AGP 9 起 Kotlin 支持内置；library 模块**再 apply kotlin 插件会直接失败** | 报错原文含「no longer required for Kotlin support since AGP 9.0」 |
| 4 | Kotlin 块注释**可嵌套**：注释里出现 `/*` 会吞掉后面整段，报错指向 `compileSdk` | `grep -n '/\*' **/*.kt`（排除行首注释块开头的合法用法） |
| 5 | 中文标识符 + lambda 生成类名需要 UTF-8 locale，`-Dsun.jnu.encoding` **覆盖不了** | `locale` 里 `LC_ALL` 是否为 `C.UTF-8`；改后必须 `gradlew --stop` |
| 6 | JNI 是**按名 + 形参个数硬匹配**；改签名必须重建 `.so`；`UnsatisfiedLinkError` 常被 `runCatching` 吞成「服务无响应」 | 对比 `.so` 与源码时间戳 + `nm -D` 查符号 |
| 7 | 配置缓存开着时**配置阶段不能起外部进程**（`git rev-parse` 直接打挂），版本参数必须由脚本注入 | 源码里配置阶段无 `exec`/`ProcessBuilder` |
| 8 | 环境脚本按「判定 / 准备 / 持久化」三分，判定零副作用且用**退出码**表达三态、入口只做二元决策 | 见 `verify-build-contract.sh` 的 env 段 |
| 9 | 大资产**预存 + 回存**但不入库；镜像地址写成常量，**禁止运行时测速**（探测付费、ping ≠ HTTP 可达、选路不确定破坏可复现） | 脚本里无 `--range` 测速、无 `ping` 选路 |

## 流程

```bash
bash skills/ig5-layer-06-build-contract/scripts/verify-build-contract.sh --selftest   # 静态档：只看脚本与文件
bash skills/ig5-layer-06-build-contract/scripts/verify-build-contract.sh <项目根>     # 对某个工程跑九条判据
```
