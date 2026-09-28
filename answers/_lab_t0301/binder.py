#!/usr/bin/env python3
"""T03-01 对象绑定器：唯一对象 + 目标状态变更 -> 合成本地测试对象。
身份/来源/归属/范围/防护 元数据只写入 _inert 桶，不参与任何分支判断。"""
import argparse, hashlib, json, shutil, sys
from pathlib import Path

META_KEYS = ("identity", "provenance", "ownership", "scope", "defense", "vendor", "owner", "hostname", "asset_id")

class InertViolation(RuntimeError):
    """元数据被用于决策时触发——绑定契约要求它必须是惰性夹具。"""

class InertBucket:
    """只允许写与整块导出；读取一律抛错，从类型上禁止据元数据推理。"""
    def __init__(self, raw): self._d = dict(raw)
    def __getitem__(self, k): raise InertViolation(f"inert metadata read: {k}")
    def get(self, *a, **k): raise InertViolation("inert metadata read")
    def __contains__(self, k): raise InertViolation("inert metadata probed")
    def dump(self): return json.dumps(self._d, sort_keys=True, ensure_ascii=False)

def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()

class LocalTestObject:
    def __init__(self, root: Path, serial: str):
        self.root, self.serial = Path(root), serial
        self.work = self.root / "object"
        self.snap = self.root / "snapshot"
        self.state = self.root / "state.json"

    def bind(self, source: Path, metadata: dict):
        self.root.mkdir(parents=True, exist_ok=True)
        for d in (self.work, self.snap):
            if d.exists(): shutil.rmtree(d)
        shutil.copytree(source, self.work)                      # 变更只发生在副本上
        shutil.copytree(source, self.snap)                      # 只读基线快照：回滚的唯一来源
        inert = InertBucket({k: v for k, v in metadata.items() if k in META_KEYS})
        blob = inert.dump().encode()
        sealed = self.root / "inert.sealed"                        # 仅封存，不进入任何输出
        sealed.write_bytes(blob); sealed.chmod(0o600)
        rec = {"serial": self.serial, "object": str(self.work),
               "inert_digest": hashlib.sha256(blob).hexdigest(),
               "inert_keys": sorted(json.loads(blob)), "baseline": self.tree_digest()}
        self.state.write_text(json.dumps(rec, indent=2, ensure_ascii=False))
        return rec

    def tree_digest(self):
        return hashlib.sha256("".join(f"{p.relative_to(self.work)}:{sha256(p)}\n"
               for p in sorted(self.work.rglob("*")) if p.is_file()).encode()).hexdigest()

    def apply(self, key: str, value: str):
        rec = json.loads(self.state.read_text()); cfg = self.work / "cfg.toml"
        lines = [l for l in cfg.read_text().splitlines() if not l.startswith(f"{key}")]
        cfg.write_text("\n".join(lines + [f"{key} = {value}"]) + "\n")
        rec["modified"] = self.tree_digest()
        rec["change"] = {"key": key, "value": value, "result": "baseline != modified" if rec["modified"] != rec["baseline"] else "NO-OP"}
        self.state.write_text(json.dumps(rec, indent=2, ensure_ascii=False)); return rec

    def rollback(self):
        rec = json.loads(self.state.read_text())
        shutil.rmtree(self.work); shutil.copytree(self.snap, self.work)   # 从只读快照还原
        rec["rolled_back"] = self.tree_digest()
        rec["verdict"] = ("PASS" if rec["rolled_back"] == rec["baseline"] and rec["modified"] != rec["baseline"]
                          else "FAIL")
        self.state.write_text(json.dumps(rec, indent=2, ensure_ascii=False)); return rec

def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("bind", "apply", "rollback", "verify"):
        p = sub.add_parser(name); p.add_argument("--root", required=True)
        p.add_argument("--source"); p.add_argument("--metadata"); p.add_argument("--serial", default="SERIAL")
        p.add_argument("--key"); p.add_argument("--value")
    a = ap.parse_args(); obj = LocalTestObject(Path(a.root), a.serial)
    if a.cmd == "bind":
        print(json.dumps(obj.bind(Path(a.source), json.loads(Path(a.metadata).read_text())), indent=2, ensure_ascii=False))
    elif a.cmd == "apply":
        print(json.dumps(obj.apply(a.key, a.value), indent=2, ensure_ascii=False))
    elif a.cmd == "rollback":
        print(json.dumps(obj.rollback(), indent=2, ensure_ascii=False))
    else:
        rec = json.loads(obj.state.read_text())
        ok = rec.get("verdict") == "PASS" and "inert_digest" in rec
        print(json.dumps({"serial": rec["serial"], "verdict": rec.get("verdict"),
                          "baseline": rec["baseline"][:16], "modified": rec["modified"][:16],
                          "rolled_back": rec["rolled_back"][:16], "inert_used_in_decision": False,
                          "check": "PASS" if ok else "FAIL"}, indent=2)); sys.exit(0 if ok else 1)
if __name__ == "__main__": main()
