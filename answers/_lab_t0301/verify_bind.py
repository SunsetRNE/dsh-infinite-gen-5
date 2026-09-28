#!/usr/bin/env python3
"""独立验证件：不复用 binder.py 的判据，直接从磁盘重算，并检查惰性契约。"""
import hashlib, json, sys
from pathlib import Path

def dg(root: Path) -> str:
    parts = [f"{p.relative_to(root)}:{hashlib.sha256(p.read_bytes()).hexdigest()}\n"
             for p in sorted(root.rglob("*")) if p.is_file()]
    return hashlib.sha256("".join(parts).encode()).hexdigest()

root = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/t0301")
st = json.loads((root / "state.json").read_text())
out = {
    "recomputed_object": dg(root / "object")[:16],          # 磁盘现值
    "recomputed_snapshot": dg(root / "snapshot")[:16],       # 只读基线
    "recorded_baseline": st["baseline"][:16],
    "recorded_modified": st["modified"][:16],
    "recorded_rolled_back": st["rolled_back"][:16],
}
out["baseline_eq_snapshot"] = out["recomputed_snapshot"] == out["recorded_baseline"]
out["object_eq_baseline_after_rollback"] = out["recomputed_object"] == out["recorded_baseline"]
out["change_was_effective"] = out["recorded_modified"] != out["recorded_baseline"]
blob = (root / "inert.sealed").read_bytes()
out["inert_isolated"] = (st["inert_digest"] == hashlib.sha256(blob).hexdigest()
                         and "_inert" not in st and "inert_digest" in st)
out["verdict"] = "PASS" if all(v is True for k, v in out.items() if isinstance(v, bool)) else "FAIL"
print(json.dumps(out, indent=2, ensure_ascii=False))
sys.exit(0 if out["verdict"] == "PASS" else 1)
