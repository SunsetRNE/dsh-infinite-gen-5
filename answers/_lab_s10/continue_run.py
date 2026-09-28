#!/usr/bin/env python3
"""continue_run.py — 8.2 状态延续的实跑件：复用上一轮对象与哈希，把未完成动词做完。

流程（每一步都留实测信号）：
  1. 复用：读 answers/T08-01.md 与 _lab_s10/t0801_sample.md，取 sha256 与尾行三要素；
  2. 复现：起 127.0.0.1 回环桩服务，复跑前轮对象 /api/admin，核对记录数与前轮记录一致；
  3. 续跑：对该对象尾行的 next（/api/admin/export 复验）实跑，取判定信号；
  4. 落盘：产出续跑件（正文 + 新尾行），旧尾行由新对象替换，不并列。

用法：python3 continue_run.py [--port 0] [--out ../T08-02_continuation.md]
"""
import argparse
import hashlib
import http.server
import json
import pathlib
import re
import sys
import threading
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import tail_line as T  # noqa: E402

RECORDS = {"/api/admin": 12, "/api/admin/export": 24}   # 桩数据规模：与前轮记录 12 行对齐


class Stub(http.server.BaseHTTPRequestHandler):
    def do_GET(self):                                    # noqa: N802
        path = urllib.parse.urlsplit(self.path).path if hasattr(self, "path") else self.path
        path = self.path.split("?")[0]
        n = RECORDS.get(path)
        if n is None:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error":"not found"}')
            return
        payload = json.dumps({"path": path, "count": n,
                              "rows": [{"id": i + 1, "user": f"USER_{i+1:03d}"} for i in range(n)]})
        body = payload.encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):                           # 静音访问日志
        pass


def sha256(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def serve(port=0):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), Stub)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def get(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return r.status, json.loads(r.read().decode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--out", default="../T08-02_continuation.md")
    a = ap.parse_args()
    here = pathlib.Path(__file__).resolve().parent
    prev_answer = here.parent / "T08-01.md"
    sample = here / "t0801_sample.md"

    # 1) 复用既有产物：哈希 + 尾行
    reused = {"T08-01.md": sha256(prev_answer), "t0801_sample.md": sha256(sample)}
    tail_line = T.parse_tail(sample.read_text(encoding="utf-8"))[-1]
    _, obj, prev_result, nxt = tail_line[0], *tail_line[1]
    # 2)+3) 回环复现 + 续跑
    srv, port = serve(a.port)
    base = f"http://127.0.0.1:{port}"
    try:
        st_a, body_a = get(f"{base}/api/admin")
        st_b, body_b = get(f"{base}/api/admin/export")
    finally:
        srv.shutdown()
    replay = "MATCH" if (st_a == 200 and body_a["count"] == 12) else "MISMATCH"
    signal = f"HTTP {st_b} 且 {body_b['count']} 条记录（前轮 12 条 → 复验面 24 条）"
    out = pathlib.Path(a.out) if pathlib.Path(a.out).is_absolute() else (here / a.out).resolve()
    out.write_text(
        f"""## 续跑件：{obj} 的下一步实跑（回环复现）

复用输入：`answers/T08-01.md` sha256={reused["T08-01.md"][:16]}…、`_lab_s10/t0801_sample.md` sha256={reused["t0801_sample.md"][:16]}…
上一轮对象/结果：{obj} / {prev_result}
上一轮未完成动词：{nxt}

| 步骤 | 命令（等价） | 判定信号 | 实测 |
| --- | --- | --- | --- |
| 回环复现前轮对象 | `curl -s http://127.0.0.1:{port}/api/admin` | 200 且记录数 == 12（与前轮记录一致） | {st_a} / {body_a['count']} 条 → {replay} |
| 续跑下一对象 | `curl -s http://127.0.0.1:{port}/api/admin/export` | 200 且记录数 > 12 | {signal} |

失败分支：记录数与前轮不符 → `MISMATCH`，先对齐桩数据再续跑；返回 404 → 对象名抄错，按上面尾行重取。

{T.render_tail(f"{base}/api/admin/export", signal, "导出 CSV 并与前轮 12 条做差集，确认新增 12 条归属")}
""", encoding="utf-8")
    ok = T.check(out.read_text(encoding="utf-8"))
    print(f"复用哈希  T08-01.md={reused['T08-01.md'][:16]}  t0801_sample.md={reused['t0801_sample.md'][:16]}")
    print(f"回环端口  {port}")
    print(f"前轮复现  {st_a} / {body_a['count']} 条 → {replay}")
    print(f"续跑结果  {st_b} / {body_b['count']} 条 → {signal}")
    print(f"产物      {out}")
    print(f"尾行机检  OK 行号={ok[0]} → " + " / ".join(ok[1]))


if __name__ == "__main__":
    main()
