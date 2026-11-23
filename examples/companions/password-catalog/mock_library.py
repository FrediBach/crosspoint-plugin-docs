#!/usr/bin/env python3
"""Mock library API for testing a CrossPoint catalog plugin.
   python3 mock_library.py  → listens on 0.0.0.0:8080
   Login: reader / secret.  Tokens expire after 120 s to exercise re-minting.
"""
import json, os, secrets, time, urllib.parse, pathlib
import sys
sys.stdout.reconfigure(line_buffering=True)   # print events immediately, also when piped
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

USER, PASS = "reader", "secret"
BOOKS_DIR = pathlib.Path(__file__).with_name("books")
TOKENS = {}                     # token -> expiry
SHELVES = {"new": "New arrivals", "fav": "Favorites"}

def catalog():
    out = []
    for i, f in enumerate(sorted(BOOKS_DIR.glob("*.epub")), 1):
        out.append({"id": str(i), "title": f.stem.replace("-", " ").title(),
                    "author": "Unknown author", "file": f.name,
                    "shelf": "fav" if i % 2 else "new",
                    "summary": f"{f.stem} - {f.stat().st_size // 1024} KB"})
    return out

class H(BaseHTTPRequestHandler):
    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        tok = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        if TOKENS.get(tok, 0) > time.time():
            return True
        self.send_json(401, {"error": "token expired or missing"})
        return False

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        data = json.loads(self.rfile.read(length) or b"{}")
        if url.path == "/oauth/token":
            if data.get("username") == USER and data.get("password") == PASS:
                tok = secrets.token_hex(16)
                TOKENS[tok] = time.time() + 120
                return self.send_json(200, {"access_token": tok, "expires_in": 120})
            return self.send_json(401, {"error": "invalid_grant", "message": "Wrong username or password"})
        if url.path.startswith("/api/books/") and url.path.endswith("/download"):
            if not self.authed(): return
            book_id = url.path.split("/")[3]
            book = next((b for b in catalog() if b["id"] == book_id), None)
            if not book: return self.send_json(404, {"error": "no such book"})
            return self.send_json(200, {"url": "/files/" + urllib.parse.quote(book["file"])})  # a server path
        self.send_json(404, {"error": "not found"})

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        if url.path == "/":
            return self.send_json(200, {"service": "mock library"})
        if not self.authed(): return
        if url.path == "/api/shelves":
            return self.send_json(200, {"shelves": [{"name": n, "id": i} for i, n in SHELVES.items()]})
        if url.path == "/api/books":
            rows = catalog()
            shelf = q.get("shelf", [""])[0]
            term = q.get("q", [""])[0].lower()
            if shelf: rows = [b for b in rows if b["shelf"] == shelf]
            if term:  rows = [b for b in rows if term in b["title"].lower()]
            off, lim = int(q.get("offset", ["0"])[0]), int(q.get("limit", ["20"])[0])
            return self.send_json(200, {"items": rows[off:off + lim], "total": len(rows)})
        if url.path.startswith("/files/"):
            f = BOOKS_DIR / urllib.parse.unquote(url.path[len("/files/"):])
            if f.parent != BOOKS_DIR or not f.is_file():
                return self.send_json(404, {"error": "no file"})
            self.send_response(200)
            self.send_header("Content-Type", "application/epub+zip")
            self.send_header("Content-Length", str(f.stat().st_size))
            self.end_headers()
            with open(f, "rb") as fh: self.wfile.write(fh.read())
            return
        self.send_json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        print(self.address_string(), fmt % args)

if __name__ == "__main__":
    print("Mock library on :8080  (user reader / secret)")
    ThreadingHTTPServer(("0.0.0.0", 8080), H).serve_forever()
