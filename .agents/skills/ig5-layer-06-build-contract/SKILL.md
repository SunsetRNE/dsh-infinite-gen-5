---
name: ig5-layer-06-build-contract
description: Android/Gradle 工程「构建与版本契约」技能：任务涉及「AGP 升级报错 / APK 重命名 / 版本号与产物命名 / 配置缓存报错 / JNI 与 .so 不同步 / 中文标识符编译失败 / 构建环境脚本拆分 / 镜像与预存资产」时装载。含九条实测踩坑与「版本号串必须先问用户，不许 AI 自己定规则」的强制条款。
license: 随本仓库
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
