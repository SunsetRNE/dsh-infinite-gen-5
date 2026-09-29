import os,glob,re,socket,struct,sys
def dec4(h):
    ip,p=h.split(':'); b=bytes.fromhex(ip)
    return socket.inet_ntop(socket.AF_INET,b[::-1]),int(p,16)
def dec6(h):
    ip,p=h.split(':'); b=bytes.fromhex(ip)
    a=socket.inet_ntop(socket.AF_INET6,b)
    if a.startswith('::ffff:') and '.' in a: a=a[7:]
    return a,int(p,16)
rows=[]
for f,fam in (('/proc/net/tcp',4),('/proc/net/tcp6',6)):
    for ln in open(f).read().splitlines()[1:]:
        p=ln.split()
        if p[3]!='0A': continue
        ip,port=(dec4 if fam==4 else dec6)(p[1])
        rows.append(dict(fam=fam,addr=ip,port=port,uid=int(p[7]),inode=p[9]))
# inode -> pid/fd from /proc/*/fd
inode2p={}
for fd in glob.glob('/proc/[0-9]*/fd/*'):
    try: t=os.readlink(fd)
    except OSError: continue
    m=re.match(r'socket:\[(\d+)\]',t)
    if m: inode2p.setdefault(m.group(1),[]).append(fd.split('/')[2]+':'+fd.split('/')[4])
for r in rows: r['procs']=inode2p.get(r['inode'],[])
rows.sort(key=lambda r:(r['port'],r['fam']))
print(f"{'fam':>3} {'addr':>16} {'port':>6} {'uid':>6} {'inode':>12}  procs")
for r in rows:
    print(f"{r['fam']:>3} {r['addr']:>16} {r['port']:>6} {r['uid']:>6} {r['inode']:>12}  {','.join(r['procs']) or 'NO_PID_VISIBLE'}")
print("total",len(rows),"attributed",sum(1 for r in rows if r['procs']))
