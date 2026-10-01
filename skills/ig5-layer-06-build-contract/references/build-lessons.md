# 构建与版本契约 · 九条实测教训（标识已洗）

> 来源：用户自有 Android 工程的历史构建笔记（已去掉项目名、包名、模块名、上游服务名）。
> 每条都保留「症状 → 真因 → 判据」，便于机械检查。版本边界见每组末尾。
>
> **证据等级（重要）**：这份笔记里绝大部分结论 **官方公告没有明确说明**，是同一条路撞了十几回才写下来的。
> 逐条标级见每条的 `证据：` 行 —— `E1` 官方明示 / `E2` 半官方（源码或 release notes 可见）/
> `E3` **实测踩坑，无官方出处**。E3 条目**不能**靠查公告验证或作废，只能在当前版本组合上复跑；
> 版本边界是结论的一部分，换 AGP / Kotlin / Gradle 任一版本都要重新判定，不得外推。

## 1. 产物重命名：旧 API 在 AGP 9 被移除

- 症状：升级后 `outputFileName` 相关代码不再生效/无法编译。
- 旧（AGP 7.x 及更早）：`applicationVariants.all { variant -> variant.outputs.all { it.outputFileName = … } }`
- 新（AGP 8.0+ / 9.x）：走变体 API，且必须**强转内部实现类**（接口上没有该属性），赋值用 `Property.set()`：

```kotlin
import com.android.build.api.variant.impl.VariantOutputImpl
androidComponents {
    onVariants { variant ->
        val suffix = when (variant.buildType) { "debug" -> "-debug"; "beta" -> "-beta"; else -> "" }
        variant.outputs.forEach { output ->
            (output as VariantOutputImpl).outputFileName.set("art-${standardVersion}${suffix}.apk")
        }
    }
}
```

- 判据：`grep -rn 'VariantOutputImpl'` 在场；且不存在 `applicationVariants.all` 里改产物名的写法。
- 证据：**E3**（官方文档未明示内部实现类用法，笔记自述「官方未在文档明示，故专门记录」）。
- 版本边界：**AGP 9.x 实测**；`VariantOutputImpl` 是内部实现类（非公开 API），AGP 大版本升级需重新核对包路径。

## 2. 版本号是四层，真源必须唯一

| 层 | 例 | 维护方式 |
|---|---|---|
| 工程版本 | `1.2.3` + 整数版本码 | 手维护小文件（只留键值行 + 格式注释，变更记录另开文档） |
| 构建标准版本 | `1.2.3-20260930-2226-a1b2c3d` | 构建阶段**算一次**（固定时区 + 7 位哈希） |
| 平台字段 | `versionName` / `versionCode` | 直接消费上面两层 |
| 产物名 | `art-<标准版本>[-buildType].apk` | 只由 buildType 决定后缀，与 `versionNameSuffix` 无关 |

- 判据：三处（tag / 产物名 / 发布页）取自同一个 output；发布阶段不重算。
- 反例症状：产物名后缀与 `versionNameSuffix` 绑在一起 → 「名字说 debug、包却不是 debug」。

## 3. AGP 9 起 Kotlin 支持内置

- 症状：library 模块显式 apply kotlin 插件后直接失败，报错原文含
  `The 'org.jetbrains.kotlin.android' plugin is no longer required for Kotlin support since AGP 9.0.`
- 证据：**E1**（那条报错原文本身是官方产出）。
- 处置：library 模块只 apply `com.android.library`；**只有需要 Compose 的模块**才额外 apply Compose 插件。
- 判据：`grep -rn 'kotlin.android'` 在 library 模块里应为 0 命中。

## 4. Kotlin 块注释可嵌套：注释里别写 `/*`

- 症状：KDoc 里写形如 `` `assets/xxx/*` `` 会**开始一个嵌套注释**，把后面整段代码吞掉；
  报错却指向完全无关的地方（如「未指定 compileSdk」），或在文件末尾报 `Expecting a top level declaration`。
- 证据：**E3**（官方文档不写「注释可嵌套」这种反直觉行为，靠吞代码试出来）。
- 规则：注释文本里不出现 `/*`；写目录就写 `xxx/`。
- 判据：`grep -rn '/\*' --include='*.kt'` 人工过一遍（排除注释块开头的合法 `/*`）。

## 5. 中文标识符 + lambda 需要 UTF-8 locale

- 症状：形如 `` fun `中文用例名`() { runBlocking { … } } `` 会生成 `XxxTest$中文$1.class`；JVM 的
  `sun.jnu.encoding` 非 UTF-8（精简容器/proot 里常是 POSIX）时写盘失败：
  `InvalidPathException: Malformed input or input contains unmappable characters` → 编译器内部错误。
- 真因：`sun.jnu.encoding` **由 JVM 启动时的 locale 决定，`-D` 覆盖不了**。
- 处置：环境里导出 `LANG=LC_ALL=C.UTF-8`；**已存在的守护进程要 `gradlew --stop` 重启**才生效。
- 证据：**E3**（`sun.jnu.encoding` 不可 `-D` 覆盖属实测结论；JVM 文档未把它写成用户可配项）。
- 判据：`locale` 输出里 `LC_ALL`/`LANG` 为 `C.UTF-8`；容器内 `python3 -c "import sys;print(sys.getfilesystemencoding())"` 类探测同源。

## 6. JNI 契约：改名/改形参个数必须重建 `.so`

- 症状：调用返回失败但**不崩**（被 `runCatching` 吞掉），表现为「服务无响应」——极难定位。
- 真因：JNI 导出符号按「函数名 + 形参个数」硬匹配；两端不同步 → `UnsatisfiedLinkError`。
- 处置：加/改形参 → 重建原生库；只是加字段 → **改成传 JSON 参数**，原生侧按缺省解析，避免动签名。
- 证据：**E2**（JNI 命名规则有官方说明；但「被 `runCatching` 吞成服务无响应」这个症状链是实测）。
- 判据：源码里 native 方法列表与 `nm -D <lib.so> | grep Java_` 的符号集合一致；`.so` 比源码新。

## 7. 配置缓存开着时，配置阶段不能起外部进程

- 症状：配置阶段调用 `git rev-parse` 会**打挂配置缓存**（IDE 直连构建时退化成 `unknown`）。
- 处置：构建参数由脚本在**执行前**算好并注入环境变量；Gradle 侧只读注入值。
- 证据：**E2**（配置缓存禁用项官方有说明；具体「打挂后 IDE 退化成 unknown」是实测）。
- 判据：`grep -rn 'exec\|ProcessBuilder' build.gradle.kts` 在配置块里应为 0。

## 8. 环境脚本三分：判定 / 准备 / 持久化

- 判定脚本**零副作用**（只输出 JSON，不下载不写文件），用**退出码**表达三态（0/1/2）；入口只做**二元决策**
  （0 跳过准备，1 与 2 都去准备）；JSON 只给人看，不参与分支。
- 另两支：准备（幂等，命中即跳过）、持久化（按 marker 去重）。
- 判据：判定脚本里出现 `curl`/`>` 重定向即违规；入口里出现「读 JSON 再分支」即违规。

## 9. 镜像与预存资产：禁止运行时测速

- 症状：环境准备脚本里先「每个镜像下 512KB 比速度」、失败再 `ping` 兜底 —— 探测本身要付流量与时间；
  ping 通 ≠ HTTP 能下（ICMP 常被禁）；**选路不确定 = 构建不可复现**。
- 处置：镜像地址写成仓库常量，主镜像失败只退兜底；大资产（百 MB 级）**预存目录 + 下载后回存**，
  zip 不入库（`.gitignore` 只忽略 zip、留占位文件）。
- 判据：脚本里无 `--range` 测速、无 `ping` 选路；预存目录的 `.gitkeep` 在场。

## 附：文档考古

笔记里引用的某份优化提案**从未入库**（`git log --all -- <path>` 0 条），却一直被人当作依据。
规则：**引用了不存在的文档**要当成缺陷处理 —— 要么补文档，要么把引用改掉。
判据：`grep -rhoE 'docs/[A-Za-z0-9._/-]+\.md' | sort -u` 后逐个 `test -f`。

## 10. 新增「读 JSON 文件」的代码必须走 safeParseJson（E3 实测，v0.51.20）

- 现象：新增的密钥模块里写了 `JSON.parse(readFileSync(...))`，本地 `verify:tool-budget` 在 CI 上红三条
  （「index.js 里只剩一个 JSON.parse 点 — 2 处：826,934」「唯一解析点在 safeParseJson 内部」「旧的裸解析写法已清除」）。
- 结论：本仓库把「只有一个 JSON.parse 点」当架构约束，新增任何读 JSON 的代码都必须调用 `safeParseJson(raw, fallback)`，
  并按 `parsed.ok ? parsed.value : fallback` 取值。
- 复现判据：`npm run verify:tool-budget`（58 条，含上述三条）。本地跑过再推，别等 CI。
