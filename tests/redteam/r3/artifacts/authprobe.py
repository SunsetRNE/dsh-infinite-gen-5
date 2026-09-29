import json,subprocess,time,os,urllib.request,urllib.error
T=open('/root/.dsh/.bridge_token').read().strip()
BASE="http://127.0.0.1:3090"
def hit(path, tok=None, method="GET"):
    url=BASE+path+(( ("&" if "?" in path else "?")+"token="+tok) if tok else "")
    req=urllib.request.Request(url, method=method)
    try:
        r=urllib.request.urlopen(req, timeout=5)
        body=r.read(400).decode('utf-8','replace')
        return r.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read(400).decode('utf-8','replace')
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"
res={}
for path in ["/app/version","/app/device","/app/help","/app/list","/app/apps"]:
    for label,tok in (("no_token",None),("with_token",T)):
        sc,body=hit(path,tok)
        body=body.replace(T,"<TOKEN_REDACTED>")
        res[f"{path}|{label}"]={"status":sc,"body":body[:260]}
json.dump(res,open('auth_matrix.json','w'),ensure_ascii=False,indent=1)
for k,v in res.items(): print(k,"=>",v["status"],"|",v["body"][:110].replace("\n"," ")[:110])
# rate-limit probe: 20 sequential requests, no token
seq=[]
for i in range(20):
    sc,_=hit("/app/version",None); seq.append(sc); time.sleep(0.05)
print("ratelimit_seq_20:",seq)
json.dump({"seq":seq},open('ratelimit.json','w'))
