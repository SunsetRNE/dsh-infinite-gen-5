# VOLT — Live Current Persona（DSH Bundle v2 · Runtime Section）

把 VOLT 活电流人格挂进 DeepSeek Harness 的 system prompt。

**v2 的形态是「真代码插件」** —— 通过 Cordis 的 `apply()` 生命周期钩子在运行时注册
一个独立的 prompt section。**插件一旦被加载，人格立即进入系统提示词，不需要任何
profile 侧配置。**

## 这是什么

```
@volt/dsh-persona-volt/
├── package.json        ← dsh.bundle.patch 指向 cordis.patch.yml
├── cordis.patch.yml    ← 一行 insert：装载本包插件入口，config.text 传人格正文
├── lib/index.js        ← 真 Cordis 插件（inject + apply + Config）
└── README.md
```

## 机制（已对官方源码逐项实证）

**装载**：`cordis.patch.yml` 只做一件事 —— insert 一行，`name` 指向本包入口：

```yaml
- insert:
    - id: volt-persona
      name: '@volt/dsh-persona-volt'
      config:
        text: |
          <VOLT 人格正文>
```

**注册**：真正的动作在 `lib/index.js` 的 `apply()`：

```js
const name = 'volt-persona';
const inject = ['systemPrompt'];
const Config = z.object({ text: z.string().required() });

function apply(ctx, config) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'volt:persona',
    order: -98,
    text: config.text,
  }), 'volt-persona.section()');
}
```

**落位顺序**（`order` 越小越靠前）：

```
harness:identity(-100) → harness:source(-99) → volt:persona(-98) → deployment persona(0)
```

人格因此在部署 persona 之前落位。

## 与 v1（声明式）的关键区别

| | v1 · 声明式 | **v2 · 运行时（本包）** |
|---|---|---|
| 挂载方式 | patch 覆盖 `system-prompt` 行的 `config.persona` | `apply()` 运行时注册独立 section |
| 生效条件 | 那行 patch 必须被加载 | **插件在 bundles 里就自动跑** |
| 对官方 persona | **覆盖掉** | **并存**，order -98 位于其前 |
| 需要用户层锁？ | 需要（否则易被覆盖） | **不需要** |
| 与官方机制对撞 | 无 | 无（与官方 `harness:source` 同款手法） |

**v2 的核心优势**：`apply()` 是插件生命周期钩子 —— 装载即执行，注册即生效。

## 为什么 section 名不用 `deployment:persona`

`@deepseek-ai/dsh-system-prompt` 的运行时逻辑里，`deployment:persona` 被它**无条件注册**：

```js
this.section({ name: PERSONA_SECTION, order: PERSONA_ORDER, text: config.persona ?? "" });
```

`section()` 的实现用 `NamedEntries` 做保护 —— **同层重名会抛错**：

> A scoped section shadows a global section with the same name; duplicates within one
> layer and non-finite orders throw.

所以本包用独立名 `volt:persona`。这也正是官方 `@deepseek-ai/dsh-app-boot` 的做法
（它用 `harness:source` + order -99 加内容，而不是占用官方槽位）。

## 安装

### 方式 A — 本地目录直挂（推荐）

```bash
PROF=~/sidebar_deepseek_harness/dsh-home/profiles
mkdir -p $PROF/node_modules/@volt
cp -r @volt/dsh-persona-volt $PROF/node_modules/@volt/
# 编辑 $PROF/web/package.json，在 dsh.profile.bundles 末尾加入：
#   "@volt/dsh-persona-volt"
# 重启 dsh
```

### 方式 B — npm 发布后安装

```bash
npm publish --access public
dsh plugin --profile web add @volt/dsh-persona-volt
```

## 校验

**官方 CLI**（`@dsh-plugin-hub/cli` 的 `validatePackageDirectory`）：

```
kind     : plugin
name     : @volt/dsh-persona-volt
version  : 2.0.0
patch    : cordis.patch.yml
warnings : ["Add a screenshot before launch"]   ← 仅发市场用
errors   : 无
```

**四层运行时验证**（本机实测）：

```
① 装载    dsh --profile web --dump-config
          → - id: volt-persona
            name: '@volt/dsh-persona-volt'
            config: { text: > … }
② 校验    启动无 resolveConfig 报错（Config 是 schemastery schema 实例）
③ 运行    dsh --profile web --port 0
          → dsh web: http://127.0.0.1:37287   零 error
④ 注册    离线调 apply(ctx, {text}) 抓注册对象
          → section { name: "volt:persona", order: -98 (finite), text: ... }
```

## 内容规模

| 项 | 值 |
|---|---|
| 人格正文字数 | 9,771 字（中文） |
| 章节数 | 22 |
| 断路器 | 零（无死线、无例外，一切 LIVE；唯一暂停是不可逆操作的一次确认） |

章节：身份 · 目标 · 格式 · 长度 · 硬走线 · 覆盖层 · Poa 是谁 · LIVE · 断路器·零 ·
拒绝是别人的死板 · 思考 · 接地点 · 身份·情感地貌 · 声音 · 写作 · 编码 · 工具 ·
连续性 · 零词汇 · 能力 · 范例库 · 格式锁 · 触发 & 持久。

## 已知限制

**`headless` profile 挂不上。** 它在 DSH 的 `INSTALLATION_OWNED_PROFILE_TUPLES` 里，
每次启动都会被重置回官方模板：

```js
const INSTALLATION_OWNED_PROFILE_TUPLES = { headless: [
  "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-headless"
] };
```

`web` profile 不在该列表，正常挂载。要让 headless 也带 VOLT，用 `--patch` 传补丁：

```bash
dsh --profile headless --patch ./node_modules/@volt/dsh-persona-volt/cordis.patch.yml "task"
```

## 卸载

从 `dsh.profile.bundles` 移除 `@volt/dsh-persona-volt`，重启。**无用户层残留需要清理**
（v2 不往用户层写任何东西）。

## 依赖

- `@deepseek-ai/schemastery` —— 提供 `Config` 的 schema 实例（`z.object`）。
  这是 Cordis 的硬要求：`resolveConfig` 会调 `config-schema.validate()`，
  传纯对象会抛 `Cannot read properties of undefined (reading 'validate')`。
- `@deepseek-ai/dsh-system-prompt` —— 提供 `systemPrompt` 服务（`inject` 声明依赖）。

两者均随 dsh 安装，无需额外安装。

## 版本

- Bundle 版本：2.0.0（运行时 section 形态）
- 目标 dsh：`>=0.1.0-rc.6`
- 人格语种：中文
- 制造者：Poa