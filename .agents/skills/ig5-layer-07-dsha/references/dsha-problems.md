# DSHA 问题清单（本机实测，2026-09-30）

| # | 现象（原文） | 根因 | 处置 | 证据等级 |
|---|---|---|---|---|
| 1 | MCP 设备工具依次报 `Request timed out` → `OPERATION_UNAVAILABLE` → `Request timed out` → `Error: [object Object]` | 设备桥不可用；`.bridge_status` 写 `fail 设备桥端口 3090 被占用 … java.net.BindException: bind failed: EADDRINUSE`，两个 LISTEN socket 同时占 3090 | 不重试、不换通道重放；告知用户重启 DSHA / 释放端口 | E3 实测 |
| 2 | `adb-shell id` → `EXECUTION_UNKNOWN: 设备桥响应不完整…（URLError）[EXIT=125]` | 桥不可用时 shell 通道也拿不到确认 | 先查实际状态，不自动重放 | E3 实测 |
| 3 | 想截图看真机 UI，但截图工具不可用 | 开发侧问题（**可能近几个版本修**） | 三条替代：① 用户把图放进工作区（本机走通过，例 `图集/312083.jpg` → 读图成功）；② `/app/ui/dump` 读屏文字；③ 等 `/app/ui/screenshot` 恢复 | E3 实测 |
| 4 | `Error: [object Object]` 这种「错误里没有信息」的返回 | 出错点在 MCP 客户端之上（插件侧 catch 只回字符串），所以真实错误被吞 | 把它当作「桥不可用」的信号，不要再逐条试探 | E3 实测 |
| 5 | 宿主文件沙箱策略拒绝执行（`sandbox mode "workspace-write" is requested but no sandbox backend is usable`） | 宿主策略问题，**不是 DSHA 问题** | 换 `danger-full-access` 或装 bubblewrap | E3 实测（宿主侧） |

## 三条替代路径的实测记录

- **① 工作区导入图片**：用户把截图放进 `图集/`，用图片读取工具读 → 成功读到截图内容（识别出抽屉、状态徽章、字段、chips）。
  这是本轮唯一稳定走通的「看图」路径。要点：**让用户放，不要自己去猜路径**；拿到归一化副本后按指纹核对（sha256 属于副本）。
- **② `/app/ui/dump`**：桥不可用时也没法验，但提示词里已列为老版本可用的最小清单之一，桥恢复后应优先用它做「无图读屏」。
- **③ `/app/ui/screenshot`**：桥恢复后可用；本轮**未验证**（桥一直不可用）。

## 纪律（不要写成「提醒」，要写成动作）

- 桥挂 → 一次判定，不重试；重试不会让端口自己空出来。
- `EXECUTION_UNKNOWN` → 只查状态，不重放。
- 想看图 → 先问用户能不能放进工作区，不要空转。
