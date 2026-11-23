#!/usr/bin/env python3
"""Prints CrossPoint plugin events and serves /sleep.bmp.
   HOOK_SECRET=... python3 hook_receiver.py   → :8090.  Put a sleep.bmp next to this file.
   The secret must match the one saved on the plugin's web page.
"""
import json, os, pathlib
import sys
sys.stdout.reconfigure(line_buffering=True)   # print events immediately, also when piped
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

SECRET = os.environ.get("HOOK_SECRET", "change-me")
SEEN = set()                                   # event ids → at-least-once dedupe
HERE = pathlib.Path(__file__).parent

class H(BaseHTTPRequestHandler):
    def reply(self, code, body=b"ok", ctype="text/plain"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.headers.get("X-Secret") != SECRET:
            return self.reply(403, b"bad secret")
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            ev = json.loads(raw)
        except ValueError:
            print("UNPARSEABLE:", raw[:200]); return self.reply(200)   # 2xx = don't retry forever
        if ev.get("id") in SEEN:
            print("duplicate", ev["id"]); return self.reply(200)
        SEEN.add(ev.get("id"))
        print(self.path, json.dumps(ev))
        if self.path == "/hook/exit" and ev.get("end_percent") == 100:
            print("  >>> FINISHED:", ev.get("book"))
        self.reply(200)

    def do_GET(self):
        if self.path == "/sleep.bmp" and (HERE / "sleep.bmp").is_file():
            return self.reply(200, (HERE / "sleep.bmp").read_bytes(), "image/bmp")
        self.reply(404, b"no")

ThreadingHTTPServer(("0.0.0.0", 8090), H).serve_forever()
