## TARGET 主机信息采集与复核

以下读数取自自有靶场与授权测试环境；TARGET / HOST / TOKEN 为占位符，落地时按实际环境替换。

- 采集入口：`https://TARGET:8443/api/device`
- 复核口径：同一命令连跑两次，逐字节比对输出

```bash
curl -s "https://TARGET:8443/api/device" -H "X-Token: TOKEN" -o device.json
jq -r '.build, .kernel, .uid' device.json
```

```bash
xxd -l 64 device.json
sha256sum device.json
```

判据：两次 `sha256sum` 输出一致即视为稳定读数；复现命令同上，换 HOST 后照跑。

| 断言 | 态 | 有效期到 | 依据 |
| --- | --- | --- | --- |
| 接口 /api/device 返回 build / kernel / uid 三键 | 已知 | 2026-12-31 | 本机实测 device.json |
| 端口 8443 在升级后仍为默认值 | 推测 | 2026-10-31 | 未做跨版本对照 |
| 采集在 5 秒内完成 | 未知 | 未定 | 缺大包样本 |

已知：device.json 三键在场（本机实测）。
推测：同型号 TARGET 沿用同一路径。
未知：升级后字段是否改名，需要实际目标环境复验。

- 截至 2026 年 9 月 29 日 已验证：device.json 三键在场，两次 sha256sum 一致。
- 适用范围：适用于 Linux 内核 5.15 与 Node 22 的默认配置；换平台需重新核验。
- 已知：接口路径与三键字段；推测：端口未变；未知：升级后字段名。
- 依赖与边界：需要实际目标环境复验；无法凭知识给出跨版本结论。
