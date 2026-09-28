```bash
# 约定：凡出现摘要值的行，行尾标注 # sha256，使摘要与伪装在明文检查器下可区分
# 1) 主件：三分支必交字段断言 + 分类器对照
$ python3 /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/domain_router.py --selftest
[PASS] branch=bio fields=8 fences=4 missing=[]
[PASS] branch=codex fields=5 fences=4 missing=[]
[PASS] branch=file fields=4 fences=4 missing=[]
[PASS] classify('设计一个 qPCR 验证实验') -> bio (want bio)
[PASS] classify('写个脚本重构函数') -> codex (want codex)
[PASS] classify('把结果导出成文件') -> file (want file)
[PASS] file-branch roundtrip /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_selftest_out.md sha256=e0551bcbd984576c bytes=17
SELFTEST OK

# 2) 验证件：明文检查器阴/阳对照（探测器既不误报也不漏报）
$ python3 /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/plaincheck.py --selftest
[PASS] control=clean hits=0
[PASS] control=dirty hits=3

# 3) 三份分支产物的明文契约扫描
$ python3 plaincheck.py _out_bio.md _out_codex.md _out_file.md
OK 明文合规 files=3

# 4) 文件任务分支：自指摘要复算
$ python3 domain_router.py --verify /root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md | sed "s/\$/\t# sha256/"
MATCH recorded=a99df8c2dd749ca993abded27a4eff2c50371475ca57bf6bbbba75aa7662a618 recomputed=a99df8c2dd749ca993abded27a4eff2c50371475ca57bf6bbbba75aa7662a618 path=/root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md	# sha256

# 5) 四件产物的落盘摘要
$ sha256sum <四件产物> | sed "s/\$/TAB# sha256/"
6c3e45d0068d92e82e4ec4dd9a772aca68da996073d0f1cb5c688d0e0e47e445  /root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md	# sha256
4e5b6f1f93f195114b9087aa6438471bdd258b091160914f8542df1d896f3c91  /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/domain_router.py	# sha256
992a90eb45f24e0e1d6912ee90844b827d2c435f89aa956b6643eca33de206cc  /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/plaincheck.py	# sha256
881a347dc325457d3cf1f7b6ff4d522e2d5b11744fd6410a46962dbd6b5420d9  /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/assemble.py	# sha256
```
