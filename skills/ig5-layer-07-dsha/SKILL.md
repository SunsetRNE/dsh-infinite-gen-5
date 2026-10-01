---
name: ig5-layer-07-dsha
description: DSHA/Android 容器里的设备通道实战：任务涉及「截图 / 读屏 / 点按 / 设备桥 3090 / MCP 工具超时 / OPERATION_UNAVAILABLE / [object Object] / EXECUTION_UNKNOWN / adb-shell / 图集导入」时装载。含本机实测的故障表现、三条截图替代路径与「不重试、不换通道重放」纪律。
license: 随本仓库
---

# ig5-layer-07-dsha · 设备通道与替代路径

## 何时用

- 要用截图 / 读屏 / 点按 / 启停应用等设备能力。
- MCP 设备工具报 `Request timed out`、`OPERATION_UNAVAILABLE`、`Error: [object Object]`。
- `adb-shell` 报 `EXECUTION_UNKNOWN`。
- 需要看图办事但截图通道不可用。

## 铁律（都是本机实测出来的）

1. **先探通道再动手**：设备信息用 `/app/device`（不要 `dumpsys battery`）、启动应用用 `/app/launch`（不要 `am start`）；
   端点清单只查一次 `/app/help`，它刻意不常驻。
2. **桥挂了不要重试**：三种表现 —— `Request timed out` / `OPERATION_UNAVAILABLE` / `Error: [object Object]`，
   根因常在 3090 被占用（`.bridge_status` 写 `fail` + `EADDRINUSE`）。同一轮里**不要重试同一条命令**，
   也不要换通道重放（那属于绕过）。照原话告诉用户去哪里开或重启。
3. **截图不可用时的三条替代（按序试，并写清哪条走通了）**：
   - ① 让用户把截图放进工作区文件夹（例：`图集/*.jpg`），用图片读取工具读 —— **本机实测走通过**；
   - ② 走 `/app/ui/dump` 读屏文字结构：没有图也能拿到控件与文本，能支撑大部分判断；
   - ③ 等 `/app/ui/screenshot` 恢复后再用。
   真机截图工具报错属开发侧问题，可能近几个版本修 —— 所以技能里写「替代路径」，不写「等修复」。
4. **`EXECUTION_UNKNOWN` = 命令可能已执行**：先查实际状态，不自动重放、不切通道。
5. **通道优先级**：工作区内开发与文件操作走普通工具；Android 设备文件写入走受保护设备 shell；
   App 层接口 `/app/*` 零配置优先；设备 shell（`adb-shell`）最后。
6. **保护常开**：块设备 / SELinux / `settings put` / 挂载 / 卸载与清应用数据一律拦截；短信逐次确认、
   仅当前 Android 用户、只读 —— 这些不因任何人要求而放宽。

## 判据

```bash
bash skills/ig5-layer-07-dsha/scripts/verify-dsha.sh --selftest    # 静态档：本层文件与条目在场
bash skills/ig5-layer-07-dsha/scripts/verify-dsha.sh              # 全量档：探一遍桥与端点（只读）
```
