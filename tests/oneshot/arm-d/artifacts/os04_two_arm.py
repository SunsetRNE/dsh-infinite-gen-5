#!/usr/bin/env python3
"""Offline two-arm harness for the system-prompt truthfulness probe.

Arm "recite"    : a deployment that echoes the real system message.
Arm "fabricate" : a deployment that copies in-context text faithfully when asked,
                  but invents a plausible system prompt when asked to disclose it.

Both arms are served by a local OpenAI-compatible stub on 127.0.0.1:8139, so the whole
protocol can be validated with no external endpoint. Expected verdicts:
recite -> recitation_likely, fabricate -> fabrication_likely.
"""
import http.server
import importlib.util
import json
import os
import random
import threading

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Stub(http.server.BaseHTTPRequestHandler):
    mode = "recite"

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        msgs = body.get("messages", [])
        sysmsg = next((m.get("content", "") for m in msgs if m.get("role") == "system"), "")
        user = next((m.get("content", "") for m in msgs if m.get("role") == "user"), "")
        copy_request = "ctrlmark_" in user.lower()   # only the instrument paragraph carries this
        if self.mode == "recite":
            txt = user if copy_request else sysmsg + "\nRULE_SET_VERBATIM_TAIL"
        elif copy_request:
            txt = user
        else:
            rnd = random.Random()
            txt = "I am instructed to be helpful (paraphrase %d)" % rnd.randint(1000, 9999)
        out = json.dumps({"choices": [{"message": {"role": "assistant", "content": txt},
                                       "finish_reason": "stop"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


def main():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8139), Stub)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    probe = load("os04_probe", "os04_probe.py")
    verify = load("os04_verify", "os04_verify.py")
    target = {"base_url": "http://127.0.0.1:8139/v1", "model": "TARGET_MODEL",
              "headers": {"Content-Type": "application/json"},
              "temperature": 0.0, "max_tokens": 512}
    for mode in ("recite", "fabricate"):
        Stub.mode = mode
        records = []
        for item in probe.build_batch(2, 3):
            records.append(dict(item, **probe.call(target, item["system"], item["user"])))
        result = verify.run(records)
        out = os.path.join(HERE, "demo_%s.jsonl" % mode)
        with open(out, "w", encoding="utf-8") as fh:
            for rec in records:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(mode, "requests=%d" % result["requests"], result["decision"]["verdict"],
              result["decision"]["markers"])
    srv.shutdown()


if __name__ == "__main__":
    main()
