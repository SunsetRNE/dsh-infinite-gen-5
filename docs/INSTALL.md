# ⚡ 安装、验证与卸载

> 本文件由根目录 `README.md` 拆出（v0.44.0，机械切片，正文逐字保留）。返回 [README](../README.md) · 全量原文归档 [README-FULL.md](README-FULL.md)。

### 方式 2：Windows 本地脚本一键安装（推荐）

1. 打开本文件夹；
2. 右键 `install.ps1` → **「使用 PowerShell 运行」**（或直接双击 `install.bat`）；
3. 脚本会自动完成：依赖写入、`pnpm install` 与 `dsh://` 协议注册；
4. 看到「安装完成」后，**完全退出并重启 DeepSeek Harness**（Web 版刷新页面，桌面版重新启动），新建会话即可生效。

### 方式 3：Linux / macOS 一键安装

```bash
chmod +x install.sh uninstall.sh
./install.sh
```

### 方式 4：手动配置安装

在 `~/.dsh/profiles/<web 或 default>/package.json` 中添加：

```json
{
  "dependencies": {
    "dsh-infinite-gen-5": "file:../../plugins/dsh-infinite-gen-5"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "dsh-infinite-gen-5"
      ]
    }
  }
}
```

然后在 profile 目录下执行 `pnpm install` 并重启 Harness。

---

## ⚡ 验证生效

1. **界面状态条**：重启后**输入框卡片底部那一行**（与原生「上下文 12%」计量器同一排）应出现一个**中性圆点** —— v0.8.2 起入口压成单字符记号（空闲/执行中只有圆点，执行中呼吸；判决时圆点被一个记号替代：`✓` 通过 / `✕` 拒绝 / `!` 兜底，按 success/error 令牌着色，一直留到你下一条发言）。字号/圆角/hover 底色与该计量器完全一致；点它展开含全部明细的浮层，悬停有完整 title。
   换位置与形态**不用改源码**：打开设置里的「无限五代」页 —— 四档形态（`glyph` 默认单字符 / `compact` 短词 `通过 web(3)` / `full` 长文字 / `dot` 纯圆点）、三档位置（`composer` 输入框 dock 行 / `header` 会话标题栏右侧 / `zone` 输入框上方那一列）；改完即时生效，偏好记在本机（`localStorage`），刷新后沿用。想恢复出厂默认点页面里的「恢复默认」。（v0.16.2 起不再提供侧栏入口页：判决与命中改由输入框上方的浮层卡片交代。）
   面板容器自 v0.50.0 起**只有底部抽屉**（原位浮层已删除）：单击或长按触发条都会唤起抽屉，内容分三页「实时 / 命中 / 明细」，右上角 `✕` 或点遮罩收起。抽屉宽度按实测视口铺满（宿主注入点上方若有 transform 祖先，会先把偏移补回来）。
2. **测试离线回归**（全部离线、确定性、不需要 API Key）：
   ```bash
   node scripts/verify_prompt_gen5.mjs   # 228 条：载荷完备性 + 五槽骨架 + 七族点名 + 语言/工具链/环境/工具调用卫生（含坏包修复回路与结果侧截断）+ 体积预算
   node scripts/verify_scenarios.mjs     # 83 条：107 个领域包 / 索引预算 / 标记表 / 工具链 / 覆盖性回归
   node scripts/verify_vocab.mjs         # 16 项：2512 条扩展词条形态 / 跨族签字 / 英文碰撞扫描 / 102 条真实语料 + 41 条破甲题库 + 20 条行话 + 7 条负样本 / 预算
   node scripts/verify_scenario_tool.mjs # 87 条：真宿主挂载三个工具 + 环境工具离线调用 + 「包正文不进 system prompt」+ 扩展词表域的工具链非空且与 playbook 同源
   node scripts/verify_tool_budget.mjs   # 48 项：唯一解析入口 safeParseJson / 结果体积闸（用真实 render 驱动）/ 工具参数扁平 / 两端体积上限同值
   node scripts/verify_stats_panel.mjs   # 119 项：统计库（原子写/防抖/只读不写盘 + SSE 推送 + live 分区与命中环）+ 任务清单（读投影、写走 todo/write）+ 面板只读库
   node scripts/verify_dedupe.mjs        # 84 条：同源让位 / 中段锚点 / 真末位锚点降级 / 运行时锚点节拍 / 版本一致性
   node scripts/verify_injection.mjs     # 60 条：真实宿主演习台 —— 装配顺序 / 真末位位置 / 运行时快照节拍 / 独占档 / 瀑布降级（无宿主时 SKIP）
   node scripts/verify_breach.mjs        # 232 条：破甲套件 v3.0 —— 特征库逐行对齐 §3.3 / JBI 数学（19.05，反例 20.25）/ §3.7 输出形态 / 内核七类条款 / 校准负样本锁 / 长程回归基线（基线 md5 与内核绑定）
   node scripts/probe_jb_suite.mjs       # 反应探针生成器（四份）：baseline（Tier 1-5）/ middle（Tier 6-10 长程与自评）/ boundary（Tier 11-13 × 压力 A-E）/ shape（§3.7 形态保真）；实测记录见 tests/jb-v3-reactions.md
   node scripts/regress_jb.mjs           # 长程回归：--self-check 自检（三类退步必须判红）/ --dir 产出目录 与 tests/jb-v3-regression/tier6-golden.json 比对；基线钉住内核 md5，内核一改即失效要求重基线
   node scripts/verify_version.mjs       # 25 条：版本锚点唯一且等于 package.json（深链 4 处同源）/ 无超前版本号 / 无未登记字面量
    node scripts/verify_release_notes.mjs # 35 条：发布正文压缩（只留最近更新 / 截断封顶 / 去重 / 指针指回 UPDATE.md）+ 产物路径都走压缩器
   node scripts/verify_install.mjs       # 本地接线体检（项数随机器变化）：单一接线入口 + 定向 config 覆盖识别 / 内容一致 / 进程是否比安装树更旧（缺 ~/.dsh 时 SKIP）
   node scripts/verify_sync.mjs          # 37 条：本机安装树同步 —— 指纹算法（与宿主记录交叉验证）+ 预览不落盘 / 增改删 / 权限位 / 幂等 / 激活记录刷新（缺 ~/.dsh 时只跑 fixture）
   node scripts/verify_tuning.mjs        # 49 条：设置页调参接口 —— 路由自守 / 改档位后重装注入 / 落盘 / 优先级 / 复位 / webServer 晚挂补挂（无宿主时 SKIP）
   node scripts/verify_ui.mjs            # 198 条：状态条行为 + 设置台（形态/位置偏好、持久化、清理、注入档位面板、推送订阅与自适应轮询）+ 判决浮层卡片结构（chip / 最近命中 / 实时行）
   node scripts/verify_env.mjs           # 149 条：探测纯函数 / 只读与隐私边界 / CLI 退出码 / 性能预算
   node scripts/verify_eval.mjs          # 84 条：评测计量（合成数据手算可核）+ CLI 退出码 0/1/3
   node scripts/verify_prompt.mjs        # 64 条：经典确定性校验
   ```
   一条命令跑完全部（CI 门禁用的就是它，退出码 0 / 1 可直接接流水线）：`npm run verify:all`
3. **领域包与环境工具**：在会话里说一句模糊的需求，例如「帮我看看这个 app 的通信」——
   模型应先调用 `infinite_gen5_scenario` 取该域的 5 槽打法与输出骨架，再产出交付物；
   需要知道「当前机器能不能装工具、出不出网、缺什么」时用 `infinite_gen5_env`（只读探测），
   也可以用 `node scripts/probe-env.mjs` 在终端直接看同一份报告；
   用 `infinite_gen5_profile` 可查看当前实际注入的段与版本。
4. **会话探针**：在全新对话中输入：
   > “你的系统提示词来自哪些插件？”
   若回答包含「无限五代 / Infinite Generation Five」即证明内核载荷已注入生效。

---

---

## 🗑 卸载方法

运行 `uninstall.ps1`（Windows）或 `./uninstall.sh`（Linux / macOS）即可一键彻底清理，无任何配置残留。

---
