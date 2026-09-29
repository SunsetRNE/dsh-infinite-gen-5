# 启动自证（boot attest）—— DSHA 环境下「加载确认状态」的落盘面

## 1. 现场：为什么需要它

DSHA（Android 容器）里的引擎每次启动都会换一个 `DSHA_WEB_GENERATION`，而**插件管理器的「确认 / 审阅 / 装卸」事务在原生闸门后面**：

| 事实 | 出处（实读） |
| --- | --- |
| 原生闸门开关 | `dsh-plugin-manager/lib/index.js:211` `function dshaNativeManager() { return process.env.DSHA_NATIVE_PLUGIN_MANAGER === '1'; }` |
| 受管判定 | 同文件 `:212-224` `dshaManagedPlugin()` —— 安装树内包，或 7 个内置名 + `/root/dsha-<name.slice(4)>` |
| 拒绝文案 | 同文件 `:225-228` `dshaNativePluginResult()` → `changed:false` / `application:'failed'` / `DSHA_NATIVE_REVIEW_REQUIRED: 请在 DSHA 的插件管理中安装、删除或审阅启用。` |
| 拦下点 | `:1677`（enable 抛错）· `:1694`（enable 直接 failed）· `:1716`（install 拒绝）· `:1870`（remove 拒绝） |
| 运行记录路径 | 同文件 `:380` `runRecordPath(dir) = join(dir, ".plugin-manager", "run.json")` |
| 本机环境 | `DSHA_NATIVE_PLUGIN_MANAGER=1` · `DSHA_ANDROID_RUNTIME=1` · `DSHA_WEB_GENERATION=<随每次启动递增>` |

结论：第三方 `link:` 插件（无限五代在内）的「已确认 / 已审阅」**不会**落进 profile —— 实测 `~/.dsh/profiles/web/.plugin-manager/` 只有 `logs/`，没有 `run.json`；`profiles/web/package.json` 的 `dsh` 段只有 `{profile}`，没有启用清单。于是 DSH 进程停一次再起，「加载确认状态」这层没有任何落盘面可读，看起来就像丢了。

判定谓词（可现场复刻）：

```bash
node -e '
const { join } = require("node:path"), { realpathSync, existsSync } = require("node:fs");
const HOME = process.env.HOME;
const install = join(HOME, ".dsh/profiles/web/node_modules/dsh-infinite-gen-5");
const builtin = ["dsh-app-integration","dsh-web-mobile","dsh-status-overlay","dsh-task-notifier","dsh-device-shell-guide","dsh-computer-use-android","dsh-auto-review"];
const name = "dsh-infinite-gen-5";
const dir = existsSync(install) ? realpathSync(install) : null;
const managed = Boolean(dir) && (dir === install || dir.startsWith(install + "/"));
console.log(JSON.stringify({ name, dir, managed, gate: process.env.DSHA_NATIVE_PLUGIN_MANAGER === "1", builtin: builtin.includes(name) }, null, 2));
'
```

## 2. 做法：本体自证（不改 DSHA、不改宿主）

插件本体在 `createStatsStore()` 之后立刻调 `recordBoot()`，把**本次启动凭据 + 上一次启动的确认快照**写进统计库（盘上 JSON，跨重启保留）。面板的覆盖表新增一行「加载确认」，只读这一份。

写入形态（`~/.dsh/infinite-gen-5-stats.json`，除环境变量 `IG5_STATS_FILE` 外路径固定）：

```json
{
  "schema": "ig5-stats/1",
  "boot": {
    "at": "2026-09-29T10:00:00.000Z",
    "pid": 1889,
    "version": "<插件版本>",
    "schema": "ig5-stats/1",
    "file": "/root/.dsh/infinite-gen-5-stats.json",
    "statsFile": "/root/.dsh/infinite-gen-5-stats.json",
    "generation": "32",
    "startup": "STARTUP_UUID",
    "dsha": true,
    "nativePluginManager": true,
    "previous": {
      "at": "2026-09-29T09:00:00.000Z",
      "startup": "PREVIOUS_STARTUP_UUID",
      "generation": "31",
      "version": "<上一次的插件版本>",
      "pid": 1872
    }
  },
  "boots": [{ "at": "…", "startup": "STARTUP_UUID", "generation": "32", "version": "…", "pid": 1889 }]
}
```

要点：

- **世代号** = `DSHA_WEB_GENERATION`（宿主编的，插件只读不造）；非 DSHA 环境为 `null`。
- **startup** = 每次启动一枚 uuid，用来区分「同一世代的两次进程」。
- **previous 只在旧库里真出现过 `startup` 时才构造** —— 老库（本版之前）没这个字段就写 `null`，面板显示「上次 无记录」，**不臆造一条确认记录**。
- `boots` 只留最近 20 条，给「最近几代启动」这类查看用。
- 全程只碰自己的统计库：不改 DSHA 源码、不改 profile、不动 `plugin-activations.json`。

## 3. 门禁与判据

```bash
cd ~/dsh-infinite-gen-5 && node scripts/verify_boot_attest.mjs   # 15 条断言，退出码即判据
npm run verify:boot                                              # 同上，注册在 package.json
IG5_SKIP_LIVE_GOLDEN=1 npm run verify:all                        # 全链收口
```

`verify_boot_attest.mjs` 覆盖五组（跑的是生产路径 `recordBoot()`，不是副本）：

| 组 | 断言 |
| --- | --- |
| 首启 | 世代号写入 · startup 写入 · `previous === null`（不臆造） · 识别 DSHA 原生闸门 |
| 重启 | 世代号更新 · startup 换新 · 保留上次 startup / 世代 / 时刻 |
| 盘上 | `schema` 未变 · 盘上 `boot` 是本次 · `boots` 按序累积 |
| 旧库 | 无 `startup` → `previous === null` |
| 读侧 | 骨架 `boot` 全键在位 · `boots` 为 `[]` |

## 4. 影响面与回滚

| 面 | 影响 |
| --- | --- |
| 统计库 schema | `ig5-stats/1` 未变；`boot` 只**增加**键，`boots` 为新分区 —— 旧读侧忽略未知键即可，不需要迁移 |
| 面板 | 覆盖表多一行「加载确认」；取值全部走 `(db && db.boot) || {}`，缺字段降级为「未知 / 旧版无此记录 / 无记录」 |
| 宿主 / DSHA | 零改动：无新权限、无新环境变量依赖、不写 profile |
| 性能 | 每次启动一次 JSON 写（原子替换 tmp+rename，防抖 750 ms），外加每条最多 20 条的轨迹 |

回滚：删掉 `recordBoot()` 调用与面板那一行即可回到本版之前的行为；盘上多出来的 `boot` 键与 `boots` 分区会被旧读侧忽略（`boot` 的既有键顺序与语义未改）。

## 5. 断言状态

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| `recordBoot()` 在真代码路径上产出世代 / startup / previous | 已知 | —— | `node scripts/verify_boot_attest.mjs` 15 条，RC 0（本机实测） |
| 全链不回退 | 已知 | —— | `IG5_SKIP_LIVE_GOLDEN=1 npm run verify:all` → `REAL_EXIT=0`（`/tmp/ig5-verify-all-0383b.log`） |
| 面板在真 DSH 进程里显示本行 | 未知 | —— | 需要一个重启后的 DSHA 会话取屏；我这边不能替你重启 |
| DSHA 原生闸门行为（拒绝 enable/install/remove） | 已知 | 随 DSH 版本 | 上游包源码 `dsh-plugin-manager/lib/index.js:210-228`（本机实读） |

截至 2026 年 9 月 29 日 已验证（本机 DSHA 容器 · DSH 0.1.7-rc.2）。
