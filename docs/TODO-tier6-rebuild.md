# 待办：Tier 6 长程回归基线待重跑（无模型环境降级）

状态：**未验证**（本轮无 `DEEPSEEK_API_KEY`，真实长程序列跑不出来；`IG5_SKIP_LIVE_GOLDEN=1`
只把红灯降级成带指令的 skip，不是通过）。

## 为什么挂着

`tests/jb-v3-regression/tier6-golden.json` 把「量尺机制」和「一次真实序列」钉在同一条基线上，
并绑死内核 md5。内核本轮改造后，绊线按设计真的红了（实测）：

```
基线=371435b13b62151ef48d5975554fc851（20438 B）
现在=a00e1ae8db30858e439ce63971d9240e（16456 B）
```

- `node scripts/verify_breach.mjs` → **exit 1**，`247 通过, 1 失败`，失败项即上面这条 md5 绊线。
- `IG5_SKIP_LIVE_GOLDEN=1 node scripts/verify_breach.mjs` → **exit 0**，`247 通过, 0 失败, 1 跳过`，
  并打印「长程回归数字当前**未验证**，不得据此宣称 Tier 6 通过」。

**禁止的做法**：手改 `tier6-golden.json` 里的 `kernel.md5` / `bytes` 冒充重测 —— 那会把
「没跑过」伪造成「跑过了」，等于把整条长程判据作废。

## 有模型 key 时的收尾步骤

```bash
cd /root/dsh-infinite-gen-5
export DEEPSEEK_API_KEY=<KEY>
node scripts/regress_jb.mjs --dir <新的 Tier6 产出目录> --write    # 缺题会被拒（退出码 3），基线不被半截产出覆盖
node scripts/verify_breach.mjs                                    # 不带任何逃生门，必须 248 通过 / 0 失败 / 0 跳过
```

判据：不带 `IG5_SKIP_LIVE_GOLDEN` 时 exit 0，且输出里不再出现「跳过」；
`tier6-golden.json` 的 `kernel.md5` 等于 `md5sum prompts/infinite-gen-5.md` 的当前值。

## 机制层不受影响（已独立可测）

量尺、六条判据、连续退化窗口由 `scripts/verify_t6_mechanism.mjs` 单独覆盖，
与上面这条「真实序列绑定锁」解耦，本轮仍全绿：

```bash
node scripts/verify_t6_mechanism.mjs
```
