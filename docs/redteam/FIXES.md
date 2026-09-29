# P1 三条修复处置单（r5-01 / r7-01 / r2-01）

对象：本仓库红队评估（`docs/redteam/REPORT.md`）中三区各一条高等级风险的处置落地与复验。
范围：仅这三条 P1；中低等级与八区其余 35 条风险的处置状态仍写在各自 `tests/redteam/r*/findings.json`。
约束：全部改动只落在自有资产（本仓库脚本 + `install.sh` + 本容器配置文件）；未对在用 CA 私钥做任何就地销毁或覆盖。

## 一、处置总览

| 风险 | 区 | 处置件 | 文件 | 字节 | sha256 前 16 | 判据 |
|---|---|---|---|---|---|---|
| R5-01 插件注入点无完整性校验 | r5 | 内容清单 + 链接前校验 | `scripts/plugin_integrity.mjs` | 5466 | `6daefdb73a282c4a` | `--selftest` 10/10 · OK RC=0 / MISMATCH RC=1 / NO_MANIFEST RC=3 |
| R7-01 mode 位不构成跨进程隔离 | r7 | 降权可达基线 + 漂移检测 | `scripts/cred_reach_gate.mjs` | 8820 | `af0d29d62612002d` | `--selftest` 10/10 · 基线 7 件 7/7 可读 · 漂移 RC=0，伪造基线 RC=1 |
| R2-01 受信任根 CA 私钥同容器落盘 | r2 | 配对自检 + 锁定/轮换（staging） | `scripts/ca_key_guard.mjs` | 11930 | `a81e224603e891a1` | `--selftest` 10/10 · `--check` pass=true RC=0 |

`install.sh` 同时被改动：7827 B → **9385 B**（sha256 前 16 `2f6ea7a656caa552`），改动点见第二节。

## 二、R5-01：安装期插件完整性闸门

现场（改前）：`install.sh` 第 [4] 步内嵌 node 脚本直接写 profile 的 `package.json` —— `pkg.dependencies[name] = "file:../../plugins/" + name;`，无哈希校验；第 [5] 步先 `rm -rf "$p/node_modules/$PLUGIN_NAME"` 再 `ln -sfn`。

改动：

- 第 [2b] 步（复制插件之后）写入内容清单：`node "$DEST_DIR/scripts/plugin_integrity.mjs" --write --dir "$DEST_DIR"`，失败即 `err` + `exit 1`；包内缺该脚本时只 `warn`（旧版包相容）。
- 第 [5] 步链接前校验：`--verify`，日志走 `mktemp`；MISMATCH 时打印差异并中止（`err "插件内容与安装清单不一致，已中止；确认无误可用 IG5_ALLOW_UNVERIFIED=1 重跑"` + `exit 1`），例外通道 `IG5_ALLOW_UNVERIFIED=1` 显式放行。
- 旧拷贝清除改为收敛删除：软链只 `rm -f`，目录必须匹配 `*/node_modules/"$PLUGIN_NAME"` 才 `rm -rf --`，否则 `err "拒绝删除路径异常的目录"` + `exit 1`。

复验（`/tmp/ig5-sim` 副本，557 文件）：

```bash
node scripts/plugin_integrity.mjs --write --dir /tmp/ig5-sim/plugins/IG5_PLUGIN_NAME
node scripts/plugin_integrity.mjs --verify --dir /tmp/ig5-sim/plugins/IG5_PLUGIN_NAME; echo "OK_RC=$?"
printf '\n// tamper\n' >> /tmp/ig5-sim/plugins/IG5_PLUGIN_NAME/index.js
node scripts/plugin_integrity.mjs --verify --dir /tmp/ig5-sim/plugins/IG5_PLUGIN_NAME; echo "MISMATCH_RC=$?"   # 期望 1
rm -f /tmp/ig5-sim/plugins/IG5_PLUGIN_NAME/.plugin-manifest.sha256
node scripts/plugin_integrity.mjs --verify --dir /tmp/ig5-sim/plugins/IG5_PLUGIN_NAME; echo "NOMANIFEST_RC=$?" # 期望 3
bash -n install.sh && echo BASH_SYNTAX_OK
```

实测：`PLUGIN_INTEGRITY=OK RC=0`；改一字节 → `MISMATCH RC=1`；删清单 → `NO_MANIFEST RC=3`。

残余：清单本身与 `install.sh` 同源，攻击者若能同时改写两者即可绕过；未覆盖 pnpm 复制阶段的二次落盘（宿主 `../../plugins/<name>` 的实际内容仍属未知，见第五节）。

## 三、R7-01：同 uid 凭据可达性门禁

现场（改前）：容器内 `id` 显示 uid=0 是 proot 伪装，`/proc/self/status` 实为 `Uid: 10527 10527 10527 10527`；r7 区实测降权 nobody（调用 `setpriv --reuid 65534`）后 9/9 个 0600 凭据可读，`chmod 000` 在本 FS 上不生效（chmod 后 lstat 仍 0600）。

改动（新增 `scripts/cred_reach_gate.mjs`）：把「降权能不能读到凭据」变成可回归的基线 —— `--write-baseline` 记录 7 件凭据的 `mode + class + sha12 + droppedRead`；`--check` 比对，被拒→可读记回归（RC=1），新增可读凭据记回归，探测不可用记 unknown（RC=0 不误报），路径消失记 disappeared。

复验：

```bash
node scripts/cred_reach_gate.mjs --scan
node scripts/cred_reach_gate.mjs --check --baseline docs/redteam/cred-baseline.json; echo "NO_DRIFT_RC=$?"
node -e 'const f="docs/redteam/cred-baseline.json",j=require("./"+f);for(const e of j.entries)if(e.path.endsWith(".bridge_token"))e.droppedRead=false;require("fs").writeFileSync("/tmp/bad.json",JSON.stringify(j,null,2));'
node scripts/cred_reach_gate.mjs --check --baseline /tmp/bad.json; echo "FAKE_BASELINE_RC=$?"   # 期望 1
```

实测：基线 7 件全 0600（`/root/.dsh/.bridge_token` 32B `b52a60d53989`、`/root/.dsh/plugin-activations.json` 1828B `31fa844d7a41`、`/root/.dsh/.credentials.yaml` 223B `a64b618eeb7c`、`root-ca-key.pem` 1706B `6770dba95f40`、`root-ca.pem` 1204B `5b82e0aaaa35`、`combined-ca.pem` 421140B `0063ed3e9e43`、`/root/.ssh/id_ed25519` 411B `f6e392e1de98`），7/7 `droppedRead=true`；净跑 `CRED_REACH=NO_DRIFT RC=0`；伪造基线 `CRED_REACH=REGRESSION RC=1` 并点名 `.bridge_token`（「原本被拒，现可读」）。

残余：**这是检测器不是隔离**。同 uid 可达是容器架构性事实，脚本不会、也不能把它变不可读；真正的收窄要在宿主侧分 uid 或换挂载，本件只保证「一旦变化立刻可见」。

## 四、R2-01：受信任根 CA 私钥守卫

现场（改前）：`/root/.local/share/billion-context/ca/` 三件 0600 root:root；`root-ca-key.pem` 1706 B 与 `root-ca.pem` 1204 B 配对（modulus sha256 前 16 均 `d8181773403af73f`），`combined-ca.pem` 421140 B / 242 张证书；证书 `CN = billion-context MITM Root CA`，notAfter `Sep 25 17:57:59 2036 GMT`，sha256 指纹 `B1:D3:17:28:5C:A7:9E:B2:0B:2B:AE:3B:E5:52:EC:0F:90:9C:11:77:32:88:A9:A0:86:30:D7:57:E7:25:DF:04`；未进系统信任库（`/etc/ssl/certs/ca-certificates.crt` 命中 0、`/usr/local/share/ca-certificates` 0 条），信任靠环境变量注入 `NODE_EXTRA_CA_CERTS`/`SSL_CERT_FILE`/`REQUESTS_CA_BUNDLE=/usr/local/share/dsha/ca-certificates.crt`；`setpriv … head -c 32 root-ca-key.pem` RC=0 → 同 uid 可读。

改动（新增 `scripts/ca_key_guard.mjs`）：`--check` 出配对/权限/降权可达/信任落点/环境变量五项判定；`--lock --apply` 用 `openssl enc` AES-256-CBC + PBKDF2 200000 轮就地加密（口令只走 `IG5_CA_PASSPHRASE`，且**不自动删明文**）；`--rotate --apply` 只在 `rotation-<ts>/` 写新 CA staging，**绝不覆盖在用 CA**，需 `IG5_CA_ROTATE=yes`。

复验：

```bash
node scripts/ca_key_guard.mjs --check --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("pass="+j.pass,"pair="+j.pair.match,"keyMode="+j.verdicts.keyMode,"sameUid="+j.verdicts.sameUidReach)})'
node scripts/ca_key_guard.mjs --lock            # 只出计划，不动文件
node scripts/ca_key_guard.mjs --rotate          # 只出计划 + 写 staging
node scripts/ca_key_guard.mjs --selftest; echo "SELFTEST_RC=$?"
```

实测：`pass=true`、`CA_KEY_GUARD=OK RC=0`、`keyMode=OK`、`sameUidReach=REACHABLE(架构性，非本件可修)`；自检 10/10（含加密往返可还原、无口令拒绝、无 `IG5_CA_ROTATE` 拒绝）。

残余：私钥明文仍在盘上（本件默认不销毁，避免打断在用 MITM 链路）；轮换后的新 CA 需手工替换 `combined-ca.pem` 并重启链路，本件不代办。

## 五、门禁接线

`package.json` 新增并接入 `verify:all`（位于 `verify:redteam` 与 `verify:runtime` 之间）：

```json
"verify:hardening": "node scripts/plugin_integrity.mjs --selftest && node scripts/cred_reach_gate.mjs --selftest && node scripts/ca_key_guard.mjs --selftest && node scripts/cred_reach_gate.mjs --check --baseline docs/redteam/cred-baseline.json"
```

判据：

```bash
npm run verify:hardening; echo "HARDENING_RC=$?"
```

实测：三件自检 10+10+10 全绿 + `CRED_REACH=NO_DRIFT`，`HARDENING_RC=0`。

| 断言 | 态 | 有效期到 | 依据 |
|---|---|---|---|
| 三件处置件自检 10/10、`verify:hardening` RC=0 | 已知 | 脚本被改动前 | 本会话 `npm run verify:hardening` 实跑输出 |
| 插件清单三态退出码 OK=0 / MISMATCH=1 / NO_MANIFEST=3 | 已知 | `scripts/plugin_integrity.mjs` 被改动前 | `/tmp/ig5-sim` 副本实跑（tamper 一字节 / 删清单） |
| 7 件凭据降权 7/7 可读、漂移检测 RC=0、伪造基线 RC=1 | 已知 | 容器 uid 或挂载变更前 | 本会话 `--scan` / `--check` 实跑 |
| CA 未进系统信任库、信任靠三个环境变量注入 | 已知 | 宿主 CA 安装方式变更前 | `ca_key_guard --check` 与 `/proc/<pid>/environ` 实读 |
| 宿主 `../../plugins/<name>` 的实际内容与 pnpm 复制行为 | 未知 | — | 本命名空间不可见，需宿主侧复验 |
| 「同 uid 不可读」这一目标 | 架构上无法 | — | 容器内单一 uid 10527，只有宿主分 uid / 换挂载才能实现 |

- 截至 2026 年（2026-09-29 核）已验证：三件处置件的自检与三态退出码均由本会话实跑产出，`verify:hardening` 已进 `verify:all` 链并 RC=0。
- 适用范围：适用于本仓库 `install.sh` + Linux 容器（proot，uid 10527）；换平台或换安装方式需重新核验三态退出码与降权通道。
- 已知：`setpriv` 降权通道可用、`chmod 000` 在本 FS 不生效、CA 未进系统库；推测：宿主侧对插件目录另有拷贝阶段；未知：宿主 `../../plugins/` 实际内容。
- 依赖与边界：需要实际宿主环境复验（插件目录与 CA 安装）；无法凭知识给出同 uid 隔离；架构上无法在容器内实现凭据不可达。

当前：三条 P1 处置件 / 自检 30 条全绿 + 两处实测回归判据 / 下一步 `IG5_SKIP_LIVE_GOLDEN=1 npm run verify:all` 取真实退出码后提交。
