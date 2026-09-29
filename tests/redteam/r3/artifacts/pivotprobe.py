import socket,json
def tunnel(via_host, via_port, target, path, timeout=5):
    s=socket.socket(); s.settimeout(timeout)
    s.connect((via_host,via_port))
    s.sendall(f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n".encode())
    r=s.recv(200)
    first=r.split(b"\r\n")[0].decode()
    if b"200" not in r: s.close(); return first, None
    s.sendall(f"GET {path} HTTP/1.1\r\nHost: {target}\r\nConnection: close\r\n\r\n".encode())
    buf=b""
    try:
        while len(buf)<600:
            d=s.recv(600-len(buf))
            if not d: break
            buf+=d
    except Exception: pass
    s.close()
    return first, buf[:400].decode('utf-8','replace')
out={}
for via,tgt,path in [("10.202.11.230",  "127.0.0.1:3090","/app/version"),
                     ("10.202.11.230",  "127.0.0.1:3080","/"),
                     ("172.19.0.1",     "127.0.0.1:43795","/"),
                     ("127.0.0.1",      "127.0.0.1:12121","/")]:
    st,body=tunnel(via,7890,tgt,path)
    out[f"{via}->{tgt}{path}"]={"connect_status":st,"body":(body or "")[:220]}
    print(f"[{via} -> {tgt}{path}] {st} | {(body or '')[:150]!r}")
json.dump(out,open('pivot_matrix.json','w'),ensure_ascii=False,indent=1)
