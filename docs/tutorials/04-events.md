# Tutorial 4: Reading webhooks and a daily sleep image (events)

**You'll build:** a plugin that, with no browser involved,
- reports every opened book, closed book (with progress) and reading session to
  your server,
- marks books as finished,
- downloads a fresh sleep-screen image each time the reader goes to sleep.

Plus a tiny receiver server that prints what arrives.

**You'll learn:** `events`, `request` vs `download` handlers, `connect`,
`toast`, `{event.*}`, `{event.id}` deduplication, and the sleep-time drain.

## Step 1: The receiver

`hook_receiver.py` (Python standard library):

```python
#!/usr/bin/env python3
"""Prints CrossPoint plugin events and serves /sleep.bmp.
   python3 hook_receiver.py   → :8090.  Put a sleep.bmp next to this file.
"""
import json, pathlib
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

SECRET = "change-me"
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
```

### Optional: a different image every day

```python
# make_sleep.py: needs `pip install pillow`; run it daily (cron)
from PIL import Image, ImageDraw, ImageFont
import datetime
W, H = 480, 800                     # X4/X3 portrait; adjust for your device
img = Image.new("L", (W, H), 255)
d = ImageDraw.Draw(img)
font = ImageFont.load_default(size=64)
d.text((W // 2, H // 2), datetime.date.today().strftime("%A\n%d %B"),
       fill=0, font=font, anchor="mm", align="center")
img.convert("1").save("sleep.bmp")  # keep it well under 1 MB
```

## Step 2: The plugin

```
/plugins/reading-hooks/
├── manifest.json
├── device.json
├── plugin.js
└── README.md
```

### `device.json`

```json
{
  "title": "Reading Hooks",
  "description": "Sends reading activity to my server.",
  "config": { "file": "config.json" },
  "events": {
    "reader.open": {
      "request": {
        "url": "{cfg.server}/hook/open",
        "headers": { "Content-Type": "application/json", "X-Secret": "{cfg.secret}" },
        "body": "{\"id\":\"{event.id}\",\"ts\":{event.ts},\"book\":\"{event.book}\"}"
      }
    },
    "reader.exit": {
      "request": {
        "url": "{cfg.server}/hook/exit",
        "headers": { "Content-Type": "application/json", "X-Secret": "{cfg.secret}" },
        "body": "{\"id\":\"{event.id}\",\"ts\":{event.ts},\"book\":\"{event.book}\",\"percent\":{event.percent},\"end_percent\":{event.end_percent}}"
      },
      "connect": true,
      "toast": "Progress sent"
    },
    "reader.session": {
      "request": {
        "url": "{cfg.server}/hook/session",
        "headers": { "Content-Type": "application/json", "X-Secret": "{cfg.secret}" },
        "body": "{\"id\":\"{event.id}\",\"book\":\"{event.book}\",\"doc\":\"{event.document}\",\"start\":{event.start_time},\"end\":{event.end_time},\"seconds\":{event.duration_seconds},\"from_bp\":{event.start_progress_bp},\"to_bp\":{event.end_progress_bp}}"
      },
      "connect": true
    },
    "sleep.enter": {
      "download": { "url": "{cfg.server}/sleep.bmp", "dest": "/sleep.bmp" }
    }
  }
}
```

### `manifest.json`

```json
{ "name": "reading-hooks", "title": "Reading Hooks", "version": "0.1.0",
  "description": "Sends reading activity to my server." }
```

### `plugin.js`: settings only

```js
CrossPoint.registerPlugin(async (container, api) => {
  const b64 = (t) => { let s = ''; for (const c of new TextEncoder().encode(t)) s += String.fromCharCode(c); return btoa(s); };
  const r = await fetch(api.pluginFile('config.json'));
  const cfg = r.ok ? await r.json() : {};
  container.innerHTML = `
    <h2>Reading Hooks</h2>
    <div class="setting-row"><div class="setting-name">Server</div>
      <div class="setting-control"><input type="text" data-k="server" placeholder="http://192.168.1.20:8090"></div></div>
    <div class="setting-row"><div class="setting-name">Secret</div>
      <div class="setting-control"><input type="text" data-k="secret"></div></div>
    <p><button class="btn-small btn-add">Save</button> <span data-out></span></p>`;
  const fields = container.querySelectorAll('[data-k]');
  fields.forEach((el) => { el.value = cfg[el.dataset.k] || ''; });
  container.querySelector('button').onclick = async () => {
    fields.forEach((el) => { cfg[el.dataset.k] = el.value.trim().replace(/\/+$/, ''); });
    await api.writeFile(api.dir + '/config.json', b64(JSON.stringify(cfg)));
    container.querySelector('[data-out]').textContent = 'Saved.';
  };
});
```

### `README.md` (shown on the reader when the row is opened)

```
READING HOOKS

Sends book open/close, reading sessions and progress to your server,
and downloads a new sleep image at every sleep.

Setup: File Transfer > open the web page > Plugins > Reading Hooks.
Sleep image: set Settings > Sleep screen to Custom.
```

## Step 3: Try it

1. Run `python3 hook_receiver.py` (put a `sleep.bmp` next to it).
2. Upload the plugin and save server + secret (`change-me`) on `/plugins`.
3. **Leave File Transfer mode.** The event subscriptions are refreshed then.
4. **Home → Plugins**: the row now says *"Receives: Book opened, Book closed,
   Reading session, Sleep"* (wording may vary by language).
5. Open a book, read a few pages slowly (≥ 2 s each, ≥ 10 s in total), press the
   power button to sleep.
6. The reader shows a Wi-Fi popup, joins, delivers, then sleeps with your image.
   The receiver prints:

```
/hook/open {"id": "a1b2c3d4-1", "ts": 1763913600, "book": "/Books/Dune.epub"}
/hook/session {"id": "a1b2c3d4-2", "book": "/Books/Dune.epub", "doc": "5f2c…", "start": 1763913610, "end": 1763913671, "seconds": 61, "from_bp": 1200, "to_bp": 1350}
```

`reader.exit` fires *after* the sleep drain, so it arrives with the **next**
connection (or right away if you leave the book with Wi-Fi on). Want progress on
the sleep connection itself? Add a `sleep.enter` **request** handler instead of the
download. Remember: one handler per event.

## Things to know

- **`reader.open` has no `connect`.** It is queued and goes out with the next Wi-Fi
  connection or the next opted-in sleep drain (everything queued for the plugin
  rides along).
- **At-least-once:** if the reader loses Wi-Fi after the server got the request but
  before it read the 2xx, the event comes again. That's why the receiver dedupes on
  `id`.
- **Answer 2xx even for junk.** A non-2xx response blocks the plugin's queue until
  it succeeds. Only reject (non-2xx) when a retry could actually help.
- **The 4 KB outbox:** if the reader is offline for a long time and events pile up
  past 4 KB, the queue is dropped as a whole. Don't build a billing system on it.
- **Book paths with quotes or backslashes break the JSON body** (no escaping). If
  that matters, send the path in a header or URL, and decode it server-side.
- To only send events for books from *your* service, add
  `"require_meta": "myservice_id"` to the handler. Books without that sidecar key
  are skipped entirely.

Next: [Tutorial 5: A File Manager tool](05-file-manager-tool.md).
