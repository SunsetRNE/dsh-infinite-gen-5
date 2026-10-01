# 云安全模块 (Cloud Security)

> AWS/Azure/GCP/阿里云/腾讯云 — 云服务配置审计与漏洞检测
> 环境：curl✅ python3✅ nmap✅ nuclei✅

---

## 知识锚点（Playbook + H1 案例）

> 本模块的实战知识锚点：playbook 流程 + H1 真实漏洞报告 + payload 库，三者交叉引用，确保方法论可追溯到真实案例。

### Playbook 流程

- [references/playbooks/ssrf-cache-host/00-index.md](../../references/playbooks/ssrf-cache-host/00-index.md) — SSRF / 云元数据 / 缓存投毒完整流程，10-ssrf-core（SSRF 核心）/ 11-cloud（云元数据凭据提取）/ 12-cache（缓存投毒）分阶段展开

### H1 真实案例（references/h1-reports/by-weakness/）

- [server-side-request-forgery-ssrf.md](../../references/h1-reports/by-weakness/server-side-request-forgery-ssrf.md) — SSRF 获取云元数据临时凭据的真实报告
- [information-disclosure.md](../../references/h1-reports/by-weakness/information-disclosure.md) — 云存储桶公开 / 元数据信息泄露
- [misconfiguration.md](../../references/h1-reports/by-weakness/misconfiguration.md) — 云服务配置错误（S3 公开 / IAM 过权 / 安全组全开）

### Payload 库

- [payloads/web/cloud-payloads.md](../../payloads/web/cloud-payloads.md) — 云元数据端点 / S3 桶枚举 / K8s API 检测 payload

---

## 底层原理：云安全不是"防火墙"，是"配置审计"

```
云安全的核心矛盾：
- 云服务商负责"云的安全"（物理/网络/虚拟化）
- 你负责"云中的安全"（配置/权限/数据/应用）

最常见的云漏洞：
1. 公开S3存储桶 — 数据泄露
2. IAM权限过大 — 横向移动
3. 安全组全开 — 0.0.0.0/0
4. 元数据泄露 — SSRF获取临时凭据
5. 未加密数据 — 快照/备份泄露
6. 容器逃逸 — Docker/K8s配置不当
7. 无服务器注入 — Lambda/Cloud Function
```

---

## 云元数据攻击（SSRF + 云）

```bash
# 云元数据端点（每个云厂商不同）
# AWS
curl http://169.254.169.254/latest/meta-data/
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/
curl http://169.254.169.254/latest/user-data/

# GCP
curl "http://metadata.google.internal/computeMetadata/v1/?recursive=true" -H "Metadata-Flavor: Google"
curl "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" -H "Metadata-Flavor: Google"

# Azure
curl "http://169.254.169.254/metadata/instance?api-version=2021-02-01" -H "Metadata:true"
curl "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/" -H "Metadata:true"

# 阿里云
curl http://100.100.100.200/latest/meta-data/
curl http://100.100.100.200/latest/meta-data/ram/security-credentials/

# 腾讯云
curl http://metadata.tencentyun.com/latest/meta-data/
```

---

## S3/Blob 存储桶检测

```bash
# AWS S3 公开桶检测
curl http://{bucket}.s3.amazonaws.com
curl https://s3.amazonaws.com/{bucket}
# 如果返回 ListBucketResult → 公开可读
# 如果返回 AccessDenied → 私有

# 尝试写操作
curl -X PUT "https://{bucket}.s3.amazonaws.com/test.txt" -d "test"
# 如果成功 → 公开可写

# 常见bucket名枚举
for name in "backup" "logs" "static" "assets" "uploads" "data" "config" "db"; do
  curl -s -o /dev/null -w "%{http_code}" "https://{name}.s3.amazonaws.com"
done

# 阿里云OSS
curl http://{bucket}.oss-cn-hangzhou.aliyuncs.com/
# 腾讯云COS
curl http://{bucket}.cos.ap-guangzhou.myqcloud.com/
```

---

## Kubernetes 安全

```bash
# K8s API未授权
curl -k https://{target}:6443/api
curl -k https://{target}:6443/api/v1/pods
curl -k https://{target}:10250/pods  # Kubelet API

# 容器逃逸检查
# 如果在容器内：
cat /proc/1/cgroup                    # 检查是否在容器中
mount | grep docker                   # 检查挂载
ls -la /var/run/docker.sock           # Docker socket
capsh --print                         # 容器capabilities
cat /proc/1/mountinfo | grep cgroup   # cgroup逃逸检查

# 特权容器检测
# privileged: true → 几乎可以逃逸
# hostPID: true → 可以看到宿主机进程
# hostNetwork: true → 可以访问宿主机网络
```

---

## 本机环境速查

```
已安装: curl✅ python3✅ nmap✅ nuclei✅
缺失: aws-cli❌ → curl替代
      kubectl❌ → curl K8s API替代
      docker❌ → proot不支持
      terraform❌ → 不需要（审计用）

云安全主要靠：curl + Python + 浏览器引擎
工具：SSRF检测器(ssrf_check.py) + 元数据端点
```

---

## 反爬钩子

> 云安全测试中的"反爬"体现为：WAF 拦截 SSRF 探测、云 API 速率限制、元数据端点 IMDSv2 防护、以及 K8s API 准入控制。

### 云场景的防护对抗

```
可能遇到的拦截场景：
1. SSRF 探测被 WAF 拦截（请求 169.254.169.254 被规则匹配）
   → 用 DNS rebinding 绕过 IP 黑名单
   → 用 @ 符号 / # 符号 / 短链接构造 URL 混淆
   → 用 IPv6 / 十进制 IP / 八进制 IP 表示元数据地址
2. IMDSv2 要求 Token（AWS v2 元数据防护）
   → 先 PUT /latest/api/token 获取 Token，再带 Token 请求元数据
   → SSRF 链中需支持自定义 HTTP 方法（PUT）
3. 云 API 速率限制（S3/K8s API 429 Too Many Requests）
   → 降速 + 指数退避重试
   → 分散请求到不同时间段
4. K8s API 准入控制 / RBAC 拦截
   → 先枚举当前 ServiceAccount 权限，再针对性请求
   → 用 kubectl auth can-i --list 确认能力边界
5. WAF 拦截 K8s API 路径（/api/v1/pods 特征明显）
   → 用 /api/v1/namespaces/default/pods 等更具体路径
   → 带 Authorization: Bearer <token> 模拟合法调用
```

通用反爬 / WAF 对抗策略参见 [references/methodology/06-anti-antibot.md](../../references/methodology/06-anti-antibot.md)。