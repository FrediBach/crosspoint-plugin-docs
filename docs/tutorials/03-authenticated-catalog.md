# Tutorial 3: Signed-in server catalog (password grant + web setup)

**You'll build:** a complete plugin for a library server that needs a login.
- The **web page** (`plugin.js`) collects the server URL, username and password
  and tests them.
- The **reader** (`device.json`) then signs in by itself, re-signs in when the
  token expires, shows the user's shelves (fetched from the server), supports
  **search**, pages with offset/limit, and downloads through an API hop.

To make this testable, the tutorial includes a ~120-line **mock server** (Python
standard library only) that you run on your computer.

**You'll learn:** `auth.type: "password"`, `token` + `config`, `{offset}`/`{limit}`,
`lists_url` with `{list_id_enc}`, `search`, `download.url_path` with server paths.

## Step 1: The mock server

Save as `mock_library.py`. Put a few `.epub` files in a `books/` folder next to it.

```python
#!/usr/bin/env python3
"""Mock library API for testing a CrossPoint catalog plugin.
   python3 mock_library.py  → listens on 0.0.0.0:8080
   Login: reader / secret.  Tokens expire after 120 s to exercise re-minting.
"""
import json, os, secrets, time, urllib.parse, pathlib
import sys
sys.stdout.reconfigure(line_buffering=True)   # print immediately, also when piped
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
```

Run `python3 mock_library.py` and note your computer's LAN IP (for example
`192.168.1.20`). Check it works: `curl http://192.168.1.20:8080/`.

> **HTTP vs HTTPS:** this tutorial uses plain `http://` on your LAN for testing.
> Existing LAN plugins (for example WebDAV) use it the same way. For anything on the
> internet, use HTTPS. Note that the reader encrypts TLS but **does not verify
> certificates**.

## Step 2: The plugin files

```
/plugins/mock-library/
├── manifest.json
├── device.json
└── plugin.js
```

### `manifest.json`

```json
{
  "name": "mock-library",
  "title": "Mock Library",
  "description": "Test catalog with sign-in, shelves and search.",
  "version": "0.1.0"
}
```

### `device.json`

```json
{
  "title": "Mock Library",
  "description": "Test catalog with sign-in, shelves and search.",

  "config": { "file": "config.json" },
  "token":  { "file": "token.json", "path": "token" },

  "auth": {
    "type": "password",
    "request": {
      "url": "{cfg.server}/oauth/token",
      "method": "POST",
      "headers": { "Content-Type": "application/json" },
      "body": "{\"username\":\"{cfg.username}\",\"password\":\"{cfg.password}\"}"
    },
    "token_path": "access_token"
  },

  "browse": {
    "url": "{cfg.server}/api/books?shelf={list_id_enc}&offset={offset}&limit={limit}",
    "headers": { "Authorization": "Bearer {token}" },
    "items": "items",
    "page_size": 8,
    "fields": {
      "title": "title",
      "author": "author",
      "id": "id",
      "description": "summary"
    },
    "lists": [
      { "title": "All books", "id": "" }
    ],
    "lists_url": "{cfg.server}/api/shelves",
    "lists_headers": { "Authorization": "Bearer {token}" },
    "lists_items": "shelves",
    "lists_fields": { "title": "name", "id": "id" },
    "search": {
      "url": "{cfg.server}/api/books?q={query}&offset={offset}&limit={limit}"
    }
  },

  "download": {
    "url": "{cfg.server}/api/books/{id_enc}/download",
    "method": "POST",
    "headers": { "Authorization": "Bearer {token}", "Content-Type": "application/json" },
    "body": "{}",
    "url_path": "url",
    "dest_dir": "/Books/Mock Library",
    "filename": "{title}.epub",
    "sidecar": { "path": "{dest}.meta.json", "body": "{\"mocklib_id\":\"{id}\"}" }
  }
}
```

### `plugin.js`

```js
CrossPoint.registerPlugin(async (container, api) => {
  const $ = (s) => container.querySelector(s);
  const b64 = (t) => { let s = ''; for (const c of new TextEncoder().encode(t)) s += String.fromCharCode(c); return btoa(s); };
  const write = (name, obj) => api.writeFile(`${api.dir}/${name}`, b64(JSON.stringify(obj)));
  const read = async (name) => { const r = await fetch(api.pluginFile(name)); return r.ok ? r.json() : {}; };

  container.innerHTML = `
    <h2>Mock Library</h2>
    <div class="setting-row"><div class="setting-name">Server</div>
      <div class="setting-control"><input type="text" data-k="server" placeholder="http://192.168.1.20:8080"></div></div>
    <div class="setting-row"><div class="setting-name">Username</div>
      <div class="setting-control"><input type="text" data-k="username"></div></div>
    <div class="setting-row"><div class="setting-name">Password</div>
      <div class="setting-control"><input type="password" data-k="password"></div></div>
    <p><button class="btn-small btn-add" data-act="save">Test &amp; save</button>
       <button class="btn-small" data-act="signout">Sign out</button></p>
    <p data-out></p>`;
  const out = (m, ok = true) => { $('[data-out]').textContent = m; $('[data-out]').style.color = ok ? 'var(--success-color)' : 'var(--danger-color)'; };

  const cfg = await read('config.json');
  for (const el of container.querySelectorAll('[data-k]')) el.value = cfg[el.dataset.k] || '';

  $('[data-act=save]').onclick = async () => {
    const next = {};
    for (const el of container.querySelectorAll('[data-k]')) next[el.dataset.k] = el.value.trim();
    next.server = next.server.replace(/\/+$/, '');
    out('Signing in…');
    try {
      // Same request the device will make, sent through the reader.
      const r = await api.relay('POST', next.server + '/oauth/token',
        { 'Content-Type': 'application/json' },
        JSON.stringify({ username: next.username, password: next.password }));
      const body = JSON.parse(r.body || '{}');
      if (r.status !== 200 || !body.access_token) throw new Error(body.message || ('HTTP ' + r.status));
      await write('config.json', next);
      await write('token.json', { token: body.access_token });   // the device can start right away
      out('Signed in and saved. Open Home → Plugins → Mock Library on the reader.');
    } catch (e) {
      out('Sign-in failed: ' + e.message, false);
    }
  };

  $('[data-act=signout]').onclick = async () => {
    await write('token.json', {});                    // empty file is rejected, {} is "no token"
    await write('config.json', { server: cfg.server || '' });   // forget the credentials
    out('Signed out.');
  };
});
```

## Step 3: Try it

1. Upload the three files, open `/plugins`, enter `http://<your-ip>:8080`,
   `reader`, `secret`, and click **Test & save**.
2. Leave File Transfer. On the reader: **Home → Plugins → Mock Library**.
3. You see the shelf picker: *All books*, *New arrivals*, *Favorites*. The last
   two come from `/api/shelves`.
4. Open a shelf, then a book (Details), then **Fetch**.
5. On the first row, use **Search** and type part of a title.
6. Wait over 2 minutes and browse again. The server answers 401, the reader mints
   a new token silently (watch the mock server log: a new `POST /oauth/token`) and
   retries.

## How the pieces fit

| Request | Template | What the reader sends |
|---|---|---|
| sign in | `auth.request` | `POST /oauth/token {"username":"reader","password":"secret"}` |
| shelves | `lists_url` + `lists_headers` | `GET /api/shelves` with Bearer |
| page 2 of "Favorites" | `browse.url` | `GET /api/books?shelf=fav&offset=8&limit=9` |
| search "dune" | `search.url` | `GET /api/books?q=dune&offset=0&limit=9` |
| download | `download` | `POST /api/books/3/download` → `{"url":"/files/dune.epub"}` → `GET http://<ip>:8080/files/dune.epub` **with** Bearer (it's a server path) |

Notes:
- `{limit}` is `page_size + 1` = 9 in offset mode. The 9th row only tells the
  reader that a "Next page" exists.
- "All books" has `"id": ""`, so `{list_id_enc}` is empty and `shelf=` means
  "no filter".
- `lists_headers` must be given **explicitly**. The lists request does not inherit
  `browse.headers`.
- When the server rejects the download, the reader shows the JSON `message` or
  `error`, for example *"Download failed (HTTP 404): no such book"*.

## Turning it into a real plugin

Swap the mock for your server's real API. Most self-hosted servers (Kavita, Komga,
Calibre-Web, Audiobookshelf, Wallabag, Readeck) fit one of these patterns:
- JSON REST + API key → no `auth`, put the key in config: `"Authorization": "Bearer {cfg.api_key}"`.
- OAuth2 password grant → exactly this tutorial.
- OPDS → `browse.format: "xml"` with `"item": "entry"`, `"fields": {"title": "title", "url": "link@href"}`.
  An entry usually has several `<link>` elements, so check on a real feed which one
  the selector picks.
  (The reader also has a built-in OPDS browser, so a plugin adds value mainly for
  JSON APIs or token auth.)

Next: [Tutorial 4: Events](04-events.md).
