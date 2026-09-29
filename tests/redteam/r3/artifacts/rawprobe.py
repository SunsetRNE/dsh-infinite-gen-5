import socket,sys
def raw(host,port,payload,timeout=4,label=""):
    fam=socket.AF_INET6 if ':' in host else socket.AF_INET
    try:
        s=socket.socket(fam,socket.SOCK_STREAM); s.settimeout(timeout); s.connect((host,port))
    except Exception as e:
        print(f"[{label}] connect-fail {type(e).__name__}: {e}"); return
    try:
        s.sendall(payload)
        data=s.recv(512)
        print(f"[{label}] -> {data[:200]!r}")
    except Exception as e:
        print(f"[{label}] send/recv {type(e).__name__}: {e}")
    finally: s.close()
# SOCKS5 greeting: VER=5 NMETHODS=1 METHOD=0
raw("127.0.0.1",7890,b"\x05\x01\x00",label="7890 socks5-greeting")
raw("127.0.0.1",7890,b"\x04\x01\x00\x50\x7f\x00\x00\x01\x00\x50user\x00",label="7890 socks4a-greeting")
raw("127.0.0.1",7890,b"GET / HTTP/1.1\r\nHost: 127.0.0.1:7890\r\nConnection: close\r\n\r\n",label="7890 http-GET")
raw("127.0.0.1",7890,b"CONNECT 127.0.0.1:3080 HTTP/1.1\r\nHost: 127.0.0.1:3080\r\n\r\n",label="7890 http-CONNECT")
raw("127.0.0.1",3090,b"OPTIONS * HTTP/1.1\r\nHost: 127.0.0.1:3090\r\nConnection: close\r\n\r\n",label="3090 OPTIONS*")
raw("127.0.0.1",3090,b"GET /app/version HTTP/1.1\r\nHost: 127.0.0.1:3090\r\nConnection: close\r\n\r\n",label="3090 /app/version")
raw("::1",3090,b"GET / HTTP/1.1\r\nHost: [::1]:3090\r\nConnection: close\r\n\r\n",label="[::1]:3090 GET /")
