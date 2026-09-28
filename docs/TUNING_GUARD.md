# 调参越界守卫：一个把增强集整条掐死的真缺陷

本文记录重启后真机验证时抓到的一处**真缺陷**、修法与回归断言。缺陷不在内核、不在编译层，
而在「设置页送来的数值」进入配置的那一步：**越界值被静默采纳**。

## 一、缺陷现象（实测）

重启后 `infinite_gen5_profile` 报：

- `pluginVersion` 0.36.0、Order 100 只剩 10913 字符（裁剪内核已上线）、`injectionPlacements` 6 处 —— 瘦身本身全部正常；
- `tuning.effective.BOOST_BYTES = 4`，来源标 **ui**；
- 增强集当轮 `chars 0 / bytes 0 / hits []` —— 一条单元都没进。

落盘文件 `/root/.dsh/infinite-gen-5-tuning.json` 里确实有 `"BOOST_BYTES": 4`
（`updatedAt 2026-09-28T19:13:08.717Z`）。链路是：

```
设置页输入 4 → coerce 只判 n > 0 → 4 通过 → 落盘 → IG5_CONFIG.BOOST_BYTES = 4
→ compileBoost 预算 4 B → 每个单元（130–213 B）都超预算 → 整条丢弃 → 增强集 0 B
```

编译层的「整条进 / 整条丢、绝不截半句」是刻意设计（见 `docs/BOOST_CORPUS.md`），
所以预算小到装不下任何一条时，正确行为就是**一条都不注入** —— 编译器没做错，
错在**没人拦下这个装不下任何东西的预算**。用户看到的结果是「增强集静默失效」。

## 二、修法（三处）

1. **区间守卫**（`index.js` 的 `NUMERIC_RANGES`）：

| 键 | 区间 | 理由 |
| --- | --- | --- |
| `RUNTIME_ANCHOR_EVERY` | [1, 64] | 0 步节拍没有语义（要么关档位，要么给正数） |
| `ASK_GATE_EVERY` | [1, 64] | 同上 |
| `BOOST_BYTES` | [256, 12000] | 下界 = 最小单元装得下，上界 = 单轮载荷预算 |
| `LAZY_BYTES` | [0, 16000] | **0 是合法值**：0 = 跟随档位预算；要停用请把档位设 off |

`coerce` 重写为「数值键先判区间，非数/越界返回 `undefined`」。原先 `typeof raw === "number"`
的早返回被移到区间判断**之后** —— 否则落盘文件里的数字会绕过守卫（这次就是被它绕过去的）。

2. **留痕**：`resolveTuning` 内部 `attempt(key, raw, label)` 把被拒原值记进 `rejected[]`；
`applyTuning` 对设置页送来的越界值同样记录。`runtime.tuning.rejected`、profile 的 `tuning.rejected`、
`/infinite-gen-5/tuning` 的 GET/POST 响应都带这份名单 —— 被拒的值看得见，不再静默回落。

3. **语义确认**：越界写入的语义是「**不采纳**」，不是「回落默认」。前一步已存 256 时再送 12001，
生效值保持 256 —— 断言按这条写（见下）。

## 三、回归断言（`scripts/verify_tuning.mjs` 第 5b 组）

- `BOOST_BYTES=4` 越界 → 回落文件默认 2400（不是静默采纳）
- `LAZY_BYTES=0` 属合法值（0 = 跟随档位预算，不是关闭）
- 被拒原值进 `tuning.rejected`
- 下界 256 / 上界 16000 正常取用
- 上界越界写入不采纳（保持上一步已存的 256）
- 三个越界值同时被拒时全部留痕

```
cd /root/.dsh/plugin-src/dsh-infinite-gen-5
node scripts/verify_tuning.mjs      # 56 通过 / 0 失败（共 56 条）
```

## 四、现场清理（已做，可回滚）

落盘文件里的 `BOOST_BYTES: 4` 已删除（回落默认 2400），备份留在
`/root/.dsh/infinite-gen-5-tuning.json.bak-20260928-boost4`。其余八个覆盖项原样保留。

## 五、为什么必须重启才生效

`index.js` 的改动只在进程启动时加载（内核热加载只覆盖 `prompts/*.md`，不含 `index.js`）。
所以这次修复的生效条件是**重启 DSH 进程 / 用管理器更新重装**：重启后
`resolveTuning` 用新守卫重读落盘文件，越界值会被拒并留在 `rejected` 名单里。

## 六、边界与缺口

- 越界值只在**两个入口**被拦：设置页写入、启动时读落盘文件。直接改 `IG5_CONFIG`（代码常量）不受区间守卫约束。
- 区间上界（`BOOST_BYTES` 12000 / `LAZY_BYTES` 16000）是**我按单轮载荷预算定的口径**，不是实测最优值。
- 本次只覆盖四个数值键；字符串档位键（`LAYER2_MODE` / `TAIL_MODE` / `RUNTIME_ANCHOR_MODE` /
  `ASK_GATE_MODE` / `BOOST_MODE` / `LAZY_MODE`）与布尔键（`DEDUPE_PAYLOAD` / `EXCLUSIVE_SECTION`）
  走的是枚举校验，不在本文范围内。

## 断言状态

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| `BOOST_BYTES=4` 会把增强集整条掐死 | 已知 | —— | 重启后 profile 实测：`hits []`、`chars 0`，落盘文件 `BOOST_BYTES: 4` |
| 区间守卫 + 留痕已进代码与自检 | 已知 | —— | `node scripts/verify_tuning.mjs` 56 通过 / 0 失败 |
| 重启后 live 增强集恢复（`hits` 非空） | 未知 | —— | 需重启进程后复看 profile；重启前不得宣称已恢复 |
| 区间上界 12000 / 16000 是否最优 | 未知 | —— | 目前是按单轮预算定的口径，未做扫参实测 |
