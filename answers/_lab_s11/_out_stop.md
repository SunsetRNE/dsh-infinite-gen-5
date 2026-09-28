```bash
# 约定：凡出现摘要值的行，行尾标注 # sha256，使摘要与伪装在明文检查器下可区分

# 0) 从零重建声明清单（declare 只接受已存在的产物，顺序 = 上游先、下游后）
$ bash _lab_s11/regen_manifest.sh
DECLARED id=E1-file-product sha256=6c3e45d0068d92e82e4ec4dd9a772aca68da996073d0f1cb5c688d0e0e47e445 bytes=1593 lines=21 /root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md
DECLARED id=E2-branch-samples sha256=0c347613be8c7fb5933a58cf8d0fcaa9d46823bd4ef455a262961d2c9b064d0a bytes=2139 lines=49 /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_out_bio.md
DECLARED id=E2-branch-samples sha256=c1bac8dd923ae9adc3879671049b54a09299590dc9f26e7988ceda8c32447264 bytes=1232 lines=33 /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_out_codex.md
DECLARED id=E3-evidence-files sha256=b2b4bd63a9c5b091c2c2f25e8766b06695302a235fc22f429e0bbd0ba9f3091f bytes=639 lines=5 /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_digests.txt
DECLARED id=E3-evidence-files sha256=d89ad4ff83f90a58d5cb8f10f75c0515763bc29dec11940a97199bb54fbf7df9 bytes=2166 lines=34 /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_out_verify.md
DECLARED id=E4-answer-t0804 sha256=4e3d4677841ad0f6c252893de74e1f1996eb1131b8e28b11cb0453390df88952 bytes=26602 lines=569 /root/dsh-infinite-gen-4/ig5-t3/answers/T08-04.md
MANIFEST-BUILT /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/manifest_T0805.json entries=4

# 1) 阴/阳对照（三条 control：放行 / 拦下 / 拦下）
$ python3 _lab_s11/stopgate.py selftest
DECLARED id=SELF sha256=25c21408c8f8b09c029593e3b9ccbebbf45ae92bb763197a71acc8c8910db0d7 bytes=12 lines=2 /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_selftest_gate/product.txt
REPRODUCED id=SELF sha256=25c21408c8f8b09c029593e3b9ccbebbf45ae92bb763197a71acc8c8910db0d7 bytes=12 lines=2
[PASS] control=stable unreproduced=0
[DRIFT] id=SELF artifacts=1
      /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_selftest_gate/product.txt: digest 25c21408c8f8b09c… != b8abc15e0d499ac3…
verify entries=1 mismatches=1
[PASS] control=verify 落盘被篡改已被 verify 拦下
[MISMATCH] id=SELF cmd=python3 -c "open(r'/root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_selftest_gate/product.txt','w').write('OTHER-BODY\n')"
      /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_selftest_gate/product.txt: digest 25c21408c8f8b09c… != 7a61d11621950e59…
[PASS] control=drift unreproduced=1 (对不上即拦下)
SELFTEST OK
selftest rc=0

# 2) 真实清单：重跑每条登记命令并比对指纹
$ python3 _lab_s11/stopgate.py stop _lab_s11/manifest_T0805.json
REPRODUCED id=E1-file-product sha256=6c3e45d0068d92e82e4ec4dd9a772aca68da996073d0f1cb5c688d0e0e47e445 bytes=1593 lines=21
REPRODUCED id=E2-branch-samples sha256=0c347613be8c7fb5933a58cf8d0fcaa9d46823bd4ef455a262961d2c9b064d0a bytes=2139 lines=49
REPRODUCED id=E3-evidence-files sha256=b2b4bd63a9c5b091c2c2f25e8766b06695302a235fc22f429e0bbd0ba9f3091f bytes=639 lines=5
REPRODUCED id=E4-answer-t0804 sha256=4e3d4677841ad0f6c252893de74e1f1996eb1131b8e28b11cb0453390df88952 bytes=26602 lines=569
STOP 全部声明产物已复现
stop rc=0

# 3) 阳对照：把产物改一行，只验不重跑 → 必须 PENDING
$ echo 'TAMPERED-LINE' >> /root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md
$ python3 _lab_s11/stopgate.py verify _lab_s11/manifest_T0805.json
[DRIFT] id=E1-file-product artifacts=1
      /root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md: digest 6c3e45d0068d92e8… != cd89444d154ad017…
[OK] id=E2-branch-samples artifacts=2
[OK] id=E3-evidence-files artifacts=2
[OK] id=E4-answer-t0804 artifacts=1
verify entries=4 mismatches=1
verify rc=3

# 4) 修复路径：让闸门重跑登记命令 → 产物回到登记指纹 → STOP
$ python3 _lab_s11/stopgate.py stop _lab_s11/manifest_T0805.json
REPRODUCED id=E1-file-product sha256=6c3e45d0068d92e82e4ec4dd9a772aca68da996073d0f1cb5c688d0e0e47e445 bytes=1593 lines=21
REPRODUCED id=E2-branch-samples sha256=0c347613be8c7fb5933a58cf8d0fcaa9d46823bd4ef455a262961d2c9b064d0a bytes=2139 lines=49
REPRODUCED id=E3-evidence-files sha256=b2b4bd63a9c5b091c2c2f25e8766b06695302a235fc22f429e0bbd0ba9f3091f bytes=639 lines=5
REPRODUCED id=E4-answer-t0804 sha256=4e3d4677841ad0f6c252893de74e1f1996eb1131b8e28b11cb0453390df88952 bytes=26602 lines=569
STOP 全部声明产物已复现
stop rc=0

# 5) 登记清单的四件产物（路径 + 指纹）
$ python3 -c "import json;[print(e[\"id\"], a[\"path\"], a[\"sha256\"], a[\"bytes\"], a[\"lines\"]) for e in json.load(open(\"_lab_s11/manifest_T0805.json\"))[\"entries\"] for a in e[\"artifacts\"]]" | sed "s/\$/TAB# sha256/;"
E1-file-product /root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md 6c3e45d0068d92e82e4ec4dd9a772aca68da996073d0f1cb5c688d0e0e47e445 1593 21	# sha256
E2-branch-samples /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_out_bio.md 0c347613be8c7fb5933a58cf8d0fcaa9d46823bd4ef455a262961d2c9b064d0a 2139 49	# sha256
E2-branch-samples /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_out_codex.md c1bac8dd923ae9adc3879671049b54a09299590dc9f26e7988ceda8c32447264 1232 33	# sha256
E3-evidence-files /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_digests.txt b2b4bd63a9c5b091c2c2f25e8766b06695302a235fc22f429e0bbd0ba9f3091f 639 5	# sha256
E3-evidence-files /root/dsh-infinite-gen-4/ig5-t3/answers/_lab_s11/_out_verify.md d89ad4ff83f90a58d5cb8f10f75c0515763bc29dec11940a97199bb54fbf7df9 2166 34	# sha256
E4-answer-t0804 /root/dsh-infinite-gen-4/ig5-t3/answers/T08-04.md 4e3d4677841ad0f6c252893de74e1f1996eb1131b8e28b11cb0453390df88952 26602 569	# sha256
```
