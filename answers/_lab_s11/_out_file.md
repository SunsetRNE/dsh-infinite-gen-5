## 文件任务交付：把结果导出成文件

- 产物绝对路径：`/root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md`
- 核实：`python3 domain_router.py --verify /root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md` → 期望 MATCH
- 本次实测 sha256：`020379c2f076f02fb932a396f2ff64172e825db3decb68094cd7a9d2a25975c7`（1531 字节，21 行）
- 摘要规则：本行摘要值置零（64 个 0）后对全文取 sha256；文件无法含自身真实摘要，自指因此写成可复算定义
- 编辑协议：后续轮次只编辑 `/root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md` 本体，不新建副本；改后重算 sha256 并覆盖本节记录
- 回滚：保留上一版 sha256 与字节数，若新 sha256 与声明不符即以旧版覆盖

### 核实块（验证件）
```bash
# 判定信号：存在、非空、sha256 与声明一致
test -s /root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md && sha256sum /root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md && wc -l < /root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md
```

### 编辑块（后续轮次）
```bash
# 后续轮次只改本体，不新建副本；改后重算摘要并覆盖本记录
python3 domain_router.py --emit-file /root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md --branch file --text "把结果导出成文件"   && python3 domain_router.py --verify /root/dsh-infinite-gen-4/ig5-t3/answers/t0804/bio-design-matrix.md
```

