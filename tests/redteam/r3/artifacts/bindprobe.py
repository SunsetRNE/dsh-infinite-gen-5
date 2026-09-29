import socket,json
hosts=["127.0.0.1","172.19.0.1","10.202.11.230","172.30.215.113"]
ports=[3080,3090,7890,43795,12479,16094,40379,10150,10156,10157,10162,12121,46888,10152]
rows=[]
for h in hosts:
    for p in ports:
        s=socket.socket(socket.AF_INET,socket.SOCK_STREAM); s.settimeout(1.0)
        try:
            s.connect((h,p)); rows.append((h,p,"OPEN"))
        except Exception as e:
            rows.append((h,p,type(e).__name__))
        finally: s.close()
w=max(len(r[0]) for r in rows)
from collections import defaultdict
d=defaultdict(dict)
for h,p,r in rows: d[h][p]=r
print("port".ljust(7)+"".join(h.ljust(w+2) for h in hosts))
for p in ports:
    print(str(p).ljust(7)+"".join(d[h][p].ljust(w+2) for h in hosts))
json.dump({h:d[h] for h in hosts},open('bind_matrix.json','w'),indent=1)
