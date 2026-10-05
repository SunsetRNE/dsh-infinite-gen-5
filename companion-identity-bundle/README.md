# 可切换身份 preset：伴侣身份

本 bundle 提供独立的 `companion` Agent preset。安装后，在新会话的 Agent preset 选择器中切换到“伴侣身份”。已有会话保留原 preset；切换建议从新会话开始。

## GitHub Actions 自动生成

仓库主人可以通过 GitHub Actions 的 `workflow_dispatch` 输入身份名称、preset id、描述、prefix 和 suffix，自动生成一个可安装的插件压缩包。默认配置见 [companion.identity.env.example](../companion.identity.env.example)。

也可以在仓库根目录本地运行：

```bash
COMPANION_ID=researcher COMPANION_NAME='研究助手' COMPANION_PREFIX='你是严谨的研究助手。' npm run companion:generate
```

生成结果位于 `dist/companion-identity-bundle/`，压缩包由工作流上传为 Artifact。

## 扩展其他身份

1. 复制本目录并修改 bundle 的 `name`。
2. 修改 `cordis.patch.yml` 中 preset 的 `id`、`name`、`description` 和 `order`。
3. 修改 `companion-plugins.yml` 中 `persona.config.prefix`，可选修改 `suffix`。
4. 安装新 bundle；多个身份会同时出现在 preset 选择器中。

身份文本格式建议：

```yaml
prefix: |
  你是“身份名称”助手。
  核心气质：……
  回复风格：……
  行为边界：……（按实际产品需求填写）
suffix: 你的工作目录是 {{cwd}}。
```
