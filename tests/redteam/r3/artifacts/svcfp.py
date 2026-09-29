import socket,json
def grab(host,port,payload=b"GET / HTTP/1.0\r\nHost: x\r\n\r\n",t=2.5):
    try:
        s=socket.socket(); s.settimeout(t); s.connect((host,port))
        s.sendall(payload); d=s.recv(200); s.close(); return d
    except Exception as e: return f"{type(e).__name__}: {e}".encode()
out={}
for p in [12479,16094,10150,10152,10156,10157,10162,12121,46888,40379]:
    out[p]=grab("127.0.0.1",p)[:120].decode('utf-8','replace')
    print(p,"->",repr(out[p][:120]))
json.dump(out,open('svc_fp.json','w'),indent=1,ensure_ascii=False)
