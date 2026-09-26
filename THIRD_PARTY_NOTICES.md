# 第三方许可与归属声明（Third-Party Notices）

本项目 `dsh-infinite-gen-5` 以 **MIT License** 发布（见 [LICENSE](./LICENSE)）。
其代码结构、安装套件、评测脚本与提示词资产，在写作与实现思路上
参考并复刻自下列上游开源项目，其原始许可与版权声明在此完整保留。

---

## 1. dsh-infinite-gen-4

| 项 | 内容 |
|---|---|
| 上游项目 | [`Minglink/dsh-infinite-gen-4`](https://github.com/Minglink/dsh-infinite-gen-4) |
| 许可协议 | MIT License |
| 原始版权 | `Copyright (c) 2026 Minglink` |
| 复刻范围 | 插件装载面（`index.js` / `client.js` / `cordis.patch.yml`）、一键安装与卸载套件（`install.*` / `uninstall.*`）、确定性回归测试套件（`scripts/`、`tests/`）、系统提示词资产（`prompts/`） |

依 MIT 协议要求，下列原始许可全文随本项目一并保留：

```text
MIT License

Copyright (c) 2026 Minglink

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. 运行期依赖说明

本插件不声明任何 `dependencies` / `peerDependencies`：

- 服务端入口 `index.js` 仅使用 Node.js 内置模块（`node:fs`）。
- 客户端入口 `client.js` 通过宿主注入的 `props` 获取 React（`require("react")`），
  不自行打包或分发 React。
- 宿主能力（Cordis 容器、`systemPrompt` / `tools` / `sessionProjections` 服务）
  由 DeepSeek Harness（`@deepseek-ai/dsh-*`）提供，不在本项目内分发。

因此本项目自身无需附带其它第三方源码许可。

---

## 3. 商标与隶属关系

- `DeepSeek`、`DeepSeek Harness` 及相关标识归其各自权利人所有。
- 本项目为独立开源研究项目，与 DeepSeek 官方及其关联主体
  无隶属、商业合作、授权或官方背书关系。
- 本项目名称、徽标与文案不代表、也不得被解释为上游项目
  `dsh-infinite-gen-4` 的官方版本或官方授权分支。
