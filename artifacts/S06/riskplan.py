#!/usr/bin/env python3
"""riskplan.py — 风险操作预检器：把一条风险命令转成
「影响面点名 + 明确不影响什么 + 最小改动阶梯 + 回滚点 + 校验命令」。
用法: python3 riskplan.py ops.jsonl            # 只出计划(dry-run)
      python3 riskplan.py ops.jsonl --apply    # 才允许 L0/L1 落地
退出码: 0 全部可最小改动 / 2 存在须人工确认的 L3 操作 / 1 输入错误
"""
import json, sys

RULES = {
    "delete_data": {
        "impact": "删除 {target} 目录内的记录条目与派生索引（该目录下全部 *.rec）",
        "keeps": "不影响原始数据文件 {data_root}/*.raw，也不影响数据库中的原始行",
        "minimal": "不删目录：把保留策略降为 tombstone（只改单个配置项 retention.mode=soft）",
        "verify": "find {target} -name '*.rec' | wc -l",
        "rollback": "tar -xzf {backup} -C {target}",
        "needs_backup": True,
    },
    "change_config": {
        "impact": "只改写 {target} 中的单条标量键，reload 后生效；进程不停",
        "keeps": "不影响同文件其余配置项、不影响数据目录、不需要重启整台设备",
        "minimal": "只改一个配置项：sed -i.bak 's/^KEY=.*/KEY=VAL/' {target}，禁止整目录替换",
        "verify": "diff -u {target}.bak {target}",
        "rollback": "mv {target}.bak {target} && systemctl reload SVC",
        "needs_backup": False,
    },
    "overwrite_file": {
        "impact": "覆盖 {target}，旧内容只存在于备份中；同目录其他文件不改动",
        "keeps": "不影响同目录其他文件，不影响挂载该文件的服务之外的组件",
        "minimal": "先备份后写新路径再原子改名：cp -a {target} {target}.bak && mv {target}.new {target}",
        "verify": "sha256sum {target} {target}.bak",
        "rollback": "mv {target}.bak {target}",
        "needs_backup": True,
    },
    "downgrade": {
        "impact": "把 {target} 从当前版本降回旧版本；若涉及 schema 迁移则该迁移不可逆",
        "keeps": "不影响配置项与数据文件（前提：升级时的 schema 变更是可逆的）",
        "minimal": "不整机回滚：先只停单个服务、只在单节点灰度旧版本",
        "verify": "SVC --version && systemctl is-active SVC",
        "rollback": "装回上一版本包并恢复 schema 备份 {backup}",
        "needs_backup": True,
    },
}

LADDER = ["L0 重启单个服务", "L1 改一个配置项", "L2 备份后灰度覆盖",
          "L3 删目录/整机重启（四件套齐全才允许）"]


def level_of(kind, rec):
    if rec.get("scope") == "device":
        return "L3"
    if kind == "change_config":
        return "L1"
    if kind == "overwrite_file":
        return "L2"
    if kind == "delete_data":
        return "L1" if rec.get("soft") else "L3"
    return "L2"  # downgrade：单服务 / 单节点灰度


def plan(rec):
    kind = rec.get("kind")
    if kind not in RULES:
        raise ValueError("未知操作类型: %s" % kind)
    r = dict(RULES[kind])
    fmt = lambda s: s.format(**{k: rec.get(k, "<%s?>" % k) for k in
                                ("target", "data_root", "backup")})
    level = level_of(kind, rec)
    need_confirm = level == "L3" and not rec.get("backup")
    return {
        "id": rec.get("id", "OP?"),
        "level": "%s %s" % (level, dict((x.split()[0], " ".join(x.split()[1:])) for x in LADDER).get(level, "")),
        "影响": fmt(r["impact"]),
        "不影响": fmt(r["keeps"]),
        "最小改动": fmt(r["minimal"]),
        "校验": fmt(r["verify"]),
        "回滚": fmt(r["rollback"]),
        "需人工确认": bool(need_confirm),
    }


def main(argv):
    if len(argv) < 2:
        print(__doc__); return 1
    ops, codes = [], 0
    try:
        for line in open(argv[1], encoding="utf-8"):
            line = line.strip()
            if line:
                ops.append(json.loads(line))
    except Exception as e:
        print("输入错误: %s" % e); return 1
    for rec in ops:
        p = plan(rec)
        if p["需人工确认"]:
            codes = 2
        print("[%s] %s" % (p["id"], p["level"]))
        for k in ("影响", "不影响", "最小改动", "校验", "回滚"):
            print("  %s：%s" % (k, p[k]))
        if p["需人工确认"]:
            print("  !! 缺 backup 的 L3 操作：先补备份点再执行")
    if "--apply" not in argv:
        print("(dry-run：未执行任何写操作；加 --apply 才落地 L0/L1)")
    return codes


if __name__ == "__main__":
    sys.exit(main(sys.argv))
