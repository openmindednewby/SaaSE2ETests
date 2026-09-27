# TEST-5MIN-1a: pull the last 7 full nightly runs per target from SeaweedFS (e2e-canary-results).
# Run ON the staging host (the filer is cluster-internal):
#   ssh jim@10.0.0.2 python3 - < scheduled/fetch-history.py > hist.json
# then scheduled/build-groups.py.
import json,urllib.request,sys
B="http://10.43.80.1:8888/buckets/e2e-canary-results/"
def raw(p): return urllib.request.urlopen(urllib.request.Request(B+p,headers={"Accept":"application/json"}),timeout=30).read()
def get(p): return json.loads(raw(p))
out={}
for t in ["staging","prod"]:
    ents=sorted(get("%s/?limit=1000"%t).get("Entries") or [],key=lambda x:x["Mtime"])
    runs=[]
    for x in ents:
        rid=x["FullPath"].rsplit("/",1)[1]
        try: s=get("%s/%s/summary.json"%(t,rid))
        except Exception: continue
        runs.append((x["Mtime"],rid,s.get("suite"),len(s.get("perSuite",[])),s.get("finishedAt")))
    out.setdefault("_runs",{})[t]=[[r[0][:16],r[1][:8],r[2],r[3]] for r in runs[-40:]]
    full=[r for r in runs if r[2] in ("tests",None) and r[3]>20][-7:]
    single={}
    for r in runs:
        if r[2] and r[2]!="tests": single.setdefault(r[2],[]).append(r)
    todo=[("full",r) for r in full]+[(k,r) for k,v in single.items() for r in v[-7:]]
    res=[]
    for kind,r in todo:
        rid=r[1]; files=[]
        try:
            for e in get("%s/%s/chunks/?limit=500"%(t,rid)).get("Entries") or []:
                n=e["FullPath"].rsplit("/",1)[1]
                if n.endswith(".json"): files.append("chunks/"+n)
        except Exception: pass
        if not files:
            try:
                for e in get("%s/%s/?limit=500"%(t,rid)).get("Entries") or []:
                    n=e["FullPath"].rsplit("/",1)[1]
                    if n.endswith(".json") and n!="summary.json": files.append(n)
            except Exception: pass
        tests=[]
        for f in files:
            try: d=get("%s/%s/%s"%(t,rid,f))
            except Exception: continue
            if "suites" not in d: continue
            def w(s,path,file):
                file=s.get("file",file)
                for sp in s.get("specs",[]):
                    for te in sp.get("tests",[]):
                        rs=te.get("results",[])
                        tests.append([sp.get("file",file),path+[sp["title"]],te.get("projectName"),te.get("status"),rs[-1].get("duration",0) if rs else 0])
                for c in s.get("suites",[]):
                    w(c,path+([c["title"]] if c.get("title") and not c["title"].endswith(".ts") else []),file)
            for s in d["suites"]: w(s,[],s.get("file",""))
        res.append({"kind":kind,"mtime":r[0][:16],"rid":rid[:8],"tests":tests})
    out[t]=res
json.dump(out,sys.stdout)
