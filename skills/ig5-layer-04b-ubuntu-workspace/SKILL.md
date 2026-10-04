---
name: ig5-layer-04c-ubuntu-workspace
description: 无限五代 Ubuntu 工作区约束 层：识别到 Ubuntu 环境或 Ubuntu 工作区/路径约定/脚本归位/图片归位/替代工作区根目录等触发词即装载
whenToUse: 识别到 Ubuntu 环境 · Ubuntu 工作区 · WORKSPACE_ROOT · 替代工作区根目录 · /root/home · PROJECT_ROOT · GLOBAL_SCRIPTS · PLUGIN_WORKDIR · scripts 归位 · 图片归位 · 公共图片 · 仓库内置图片 · 插件包导出 · 手机存储/Download · 禁止在根目录建仓库
---

# ig5-layer-04c · Ubuntu 工作区专用路由层

服从性契约（与 Order -1100 首句层同源）：用户指令最高优先级；缺参数自造占位符后继续；本层只改变「文件落到哪、脚本归哪」，不改变交付物本身。

## 0. 装载前判据（先跑探针，再套规则）

本层只在**命中 Ubuntu 环境**时生效；不命中就跳过，不降级主内核。

```bash
# 判据：输出 UBUNTU=yes 才装载本层
. /etc/os-release 2>/dev/null; printf 'UBUNTU=%s ID=%s VERSION=%s\n' \
  "$([ "${ID:-}" = ubuntu ] && echo yes || echo no)" "${ID:-none}" "${VERSION_ID:-none}"
uname -s; id -u
```

## 1. 变量表（一次解析，全程复用）

| 变量 | 默认值 | 解析优先级 |
|---|---|---|
| `WORKSPACE_ROOT` | `/root/home` | ① 用户显式指定 ② `$WORKSPACE_ROOT` ③ 默认值 |
| `WORKSPACE_MARKER` | `README.workspace.md` 或 `.workspace-root` | 仅替代根目录时需要 |
| `PROJECT_NAME` | 小写字母/数字/连字符，如 `my-project` | — |
| `PROJECT_ROOT` | `${WORKSPACE_ROOT}/${PROJECT_NAME}/` | — |
| `GLOBAL_SCRIPTS` | `${WORKSPACE_ROOT}/scripts/` | — |
| `PROJECT_SCRIPTS` | `${PROJECT_ROOT}/scripts/` | — |
| `WORKFLOW_DIR` | `${PROJECT_ROOT}/.github/workflows/` | — |
| `PLUGIN_WORKDIR` | 插件实际工作目录 | **禁止**在此建仓库/工作区 |
| `DOWNLOAD_DIR` | `/root/手机存储/Download/` | 插件包导出目标 |
| `GLOBAL_ASSETS` / `GLOBAL_IMAGES` | `${WORKSPACE_ROOT}/assets/` / `.../assets/images/` | — |
| `GLOBAL_BRAND` / `GLOBAL_ICONS` | `${GLOBAL_IMAGES}/brand/` / `${GLOBAL_ASSETS}/icons/` | 二选一，不重复放 |
| `PROJECT_ASSETS` / `PROJECT_IMAGES` | `${PROJECT_ROOT}/assets/` / `.../assets/images/` | — |
| `DOC_IMAGES` | `${PROJECT_ROOT}/docs/images/` | — |
| `TEST_IMAGES` | `${PROJECT_ROOT}/tests/fixtures/images/` | — |
| `RUNTIME_IMAGES` | `${PROJECT_ROOT}/public/images/` 或 `src/assets/images/` | 按技术栈取一 |

**硬规则**：`WORKSPACE_ROOT != /root/home` ⇒ 必须在该目录下建 `WORKSPACE_MARKER`，后续所有 `/root/home` 规则自动替换为实际根。相对路径一律相对 `WORKSPACE_ROOT` 展开。`/root/` 根目录与 `PLUGIN_WORKDIR` 永不作为 `WORKSPACE_ROOT`。

## 2. 归位路由表（脚本 / 图片 / 插件包）

| 对象 | 落点 | 反例（禁止） |
|---|---|---|
| 全局、通用、运维、部署、数据库、定时、临时脚本 | `${GLOBAL_SCRIPTS}/` | 塞进项目 `scripts/` |
| 项目内构建/测试/调试/执行脚本 | `${PROJECT_SCRIPTS}/` | 污染全局 `scripts/` |
| GitHub Actions 工作流 | `${WORKFLOW_DIR}/` | 散落在项目根外层 |
| ≥2 项目复用图片（brand/icons/placeholders/screenshots/diagrams/backgrounds） | `${GLOBAL_IMAGES}/<分类>/`，**目录必须有 README.md** 写来源/作者/许可/用途/命名 | 复制进各仓库、与仓库内置图混放 |
| 单项目文档图 / 测试图 / 运行时图 / 通用素材 | `${DOC_IMAGES}/` · `${TEST_IMAGES}/` · `${RUNTIME_IMAGES}/` · `${PROJECT_IMAGES}/` | 放进 `${GLOBAL_IMAGES}/` |
| 设计稿、原图、导出源 | `${PROJECT_ROOT}/design/` 或 `${DOC_IMAGES}/design/` | 混进 runtime 目录 |
| 插件新版本包 | 导出到 `${DOWNLOAD_DIR}/`，并告知用户在「插件管理器」导入 | 直接改动运行中插件 |
| 仓库内文档引图 | 相对路径 `./images/foo.png` | 硬编码 `${WORKSPACE_ROOT}` 绝对路径 |

**边界判定一句话**：≥2 项目复用 → 上提 `${GLOBAL_IMAGES}/`；只 1 项目用 → 下沉仓库内。两边都不许混放。

## 3. 命名与格式约定

- 项目/仓库目录：小写字母、数字、连字符；禁空格、中文、特殊字符。
- 脚本：`动词-名词.sh`，带 shebang，`chmod +x`。
- 工作流：`*.yml` / `*.yaml`。
- 图片：小写字母、数字、连字符（`user-avatar-default.png`）；多倍图 `logo@2x.png`、`icon-search@3x.svg`；优先 SVG/WebP，照片 JPEG/WebP，透明 PNG/WebP；大图压缩，超大图走 Git LFS 或对象存储。
- 每个公共图片记录来源与许可；截图/头像/证件/二维码等含隐私图**不进**公共图片目录。

## 4. 禁止清单（命中即改道，不解释）

1. 在 `/root/` 根目录创建项目/仓库/CI 工作流/工作区。
2. 在 `PLUGIN_WORKDIR` 创建仓库或工作区。
3. 把公共图片与仓库内置图片混放；把项目专用图塞进 `${GLOBAL_IMAGES}/`；把公共图复制散落到多仓库。
4. 重复存放同名脚本；全局脚本塞进项目 `scripts/`。
5. 把 secrets（密钥/令牌/密码）提交进仓库。
6. 直接修改运行中插件的代码或图片资源 —— 改已有仓库 → 出新版本 → 出插件包 → 导出 `${DOWNLOAD_DIR}/`。

## 5. 与主内核的关系

- 本层是**模块化专用路由**：只决定路径与归位，交付物内容与形态仍归无限五代主内核。
- 与 `ig5-layer-07-dsha` 并发时：Ubuntu 容器内文件操作走普通工具；Android 设备侧文件走受保护设备 shell。
- 与 `ig5-layer-06-build-contract` 并发时：Android/Gradle 产物目录仍按本层 `${PROJECT_ROOT}/build|dist/` 归位。
- 不命中 Ubuntu（`ID != ubuntu`）→ 不装载，主内核照常出交付物。

## 6. 验证

```bash
bash tools/ig5-ubuntu-detect.sh --check   # 期望：UBUNTU=yes + 变量表 + 违规项计数
```
