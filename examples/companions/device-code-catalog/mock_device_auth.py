#!/usr/bin/env python3
"""Mock OAuth 2.0 device-code server for the device-code-catalog example.

    python3 mock_device_auth.py            # listens on 0.0.0.0:8081

Flow:
  POST /device/code   → {device_code, user_code, verification_uri, interval, expires_in}
  POST /device/token  → {"error":"authorization_pending"} until approved, then {"access_token": ...}
  GET  /activate      → page where you type the user code and approve it
  GET  /api/books     → JSON list of books (Bearer token required)
  GET  /files/<name>  → serves an EPUB from ./books (Bearer token required)

Both form-encoded and JSON request bodies are accepted.
"""
import html
import sys
sys.stdout.reconfigure(line_buffering=True)   # print events immediately, also when piped
import json
import pathlib
import secrets
import socket
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8081
BOOKS = pathlib.Path(__file__).with_name("books")
PENDING = {}   # device_code -> {"user_code", "expires", "approved"}
TOKENS = set()


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))   # no packet is sent; picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else (
            json.dumps(body) if ctype == "application/json" else body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
        if raw.strip().startswith("{"):
            return json.loads(raw)
        return {k: v[0] for k, v in urllib.parse.parse_qs(raw).items()}

    def authed(self):
        tok = self.headers.get("Authorization", "")[len("Bearer "):]
        if tok in TOKENS:
            return True
        self.send(401, {"error": "invalid_token"})
        return False

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        data = self.body()
        if path == "/device/code":
            device_code = secrets.token_hex(16)
            user_code = "-".join(secrets.token_hex(2).upper() for _ in range(2))
            PENDING[device_code] = {"user_code": user_code, "expires": time.time() + 600, "approved": False}
            print("new code", user_code)
            return self.send(200, {
                "device_code": device_code, "user_code": user_code,
                "verification_uri": f"http://{lan_ip()}:{PORT}/activate",
                "interval": 5, "expires_in": 600})
        if path == "/device/token":
            entry = PENDING.get(data.get("device_code", ""))
            if not entry or entry["expires"] < time.time():
                return self.send(400, {"error": "expired_token"})
            if not entry["approved"]:
                return self.send(400, {"error": "authorization_pending"})
            del PENDING[data["device_code"]]
            token = secrets.token_hex(16)
            TOKENS.add(token)
            return self.send(200, {"access_token": token, "token_type": "bearer"})
        if path == "/activate":
            code = data.get("code", "").strip().upper()
            for entry in PENDING.values():
                if entry["user_code"] == code:
                    entry["approved"] = True
                    return self.send(200, "<h1>Approved. Go back to your reader.</h1>", "text/html")
            return self.send(404, "<h1>Unknown code</h1><a href='/activate'>try again</a>", "text/html")
        self.send(404, {"error": "not found"})

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/activate":
            return self.send(200, """<!doctype html><meta name=viewport content="width=device-width">
<h1>Approve a reader</h1><form method=post>
<input name=code placeholder="ABCD-1234" autofocus> <button>Approve</button></form>""", "text/html")
        if url.path == "/api/books":
            if not self.authed():
                return
            rows = [{"id": f.stem, "title": f.stem.replace("-", " ").title(),
                     "url": f"http://{self.headers['Host']}/files/{urllib.parse.quote(f.name)}"}
                    for f in sorted(BOOKS.glob("*.epub"))]
            return self.send(200, {"books": rows})
        if url.path.startswith("/files/"):
            if not self.authed():
                return
            f = BOOKS / urllib.parse.unquote(url.path[len("/files/"):])
            if f.parent != BOOKS or not f.is_file():
                return self.send(404, {"error": "no file"})
            return self.send(200, f.read_bytes(), "application/epub+zip")
        self.send(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        print(self.address_string(), fmt % args)


if __name__ == "__main__":
    BOOKS.mkdir(exist_ok=True)
    print(f"Mock device-code server on http://{lan_ip()}:{PORT}  (EPUBs from {BOOKS})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
