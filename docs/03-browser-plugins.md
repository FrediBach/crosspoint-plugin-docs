# 3. Browser plugins (`plugin.js`)

`plugin.js` is ordinary JavaScript. The reader's web server sends it to **your
browser**, and it runs there. It does **not** run on the e-reader. It can only run
while a browser has a CrossPoint page open and the reader is in File Transfer mode.

It can do anything a web page can do, plus a few things a web page normally
can't, through device endpoints:

- make HTTP(S) requests to **any** host without CORS problems (the reader makes them for you),
- stream large downloads **straight to the SD card**,
- write files to the SD card,
- use device crypto.

## 3.1 The registration contract

```js
CrossPoint.registerPlugin(async (container, api) => {
  // build your UI inside `container`
});
```

Rules, all enforced by `/js/plugin-host.js`:

1. **Call `registerPlugin` synchronously**, at the top level of the script.
   Calling it after an `await`, in a `setTimeout`, or in a callback is ignored.
   The host stores your function on the `<script>` element that is
   running at that moment (`document.currentScript`), and that is `null` later.
2. Your function gets `(container, api)`. It may be `async`. The host **does not
   wait** for it: the next plugin starts loading immediately.
3. If your function **throws or its promise rejects**, the card is replaced with
   *"Failed to load plugin."* Catch errors yourself if you want to show a
   friendlier message.
4. If the script hasn't loaded after **30 seconds**, the card shows *"Failed to
   load plugin."* and the host moves on. If the script arrives later, it still
   renders.
5. If the script loads but never calls `registerPlugin`, the `/plugins` page shows
   *"No browser settings for &lt;title&gt;."*
6. Plugins load **one after another**, in this order: Plugin Hub first, then by
   title (on `/plugins`).

## 3.2 `container`

A `<div class="card" id="plugin-<name>">` inside `#plugin-container`. On
`/plugins` it starts with a "Loading …" placeholder, which the host clears just
before calling you.

### Looking native

The page stylesheet (`/assets/web.css`) styles these inside `#plugin-container`:

```html
<h2>Title</h2>
<div class="setting-row">                        <!-- 2-column grid row -->
  <div class="setting-name">Server URL</div>
  <div class="setting-control"><input type="text"></div>
</div>
<button class="btn-small">Secondary</button>
<button class="btn-small btn-add">Primary</button>
<textarea></textarea>   <!-- full width, min 96px -->
<hr>
```

CSS variables you can use: `--font-color`, `--muted-color`, `--accent-color`,
`--danger-color`, `--success-color`, `--warning-color`, `--border-color`,
`--card-bg`, `--bg`.

## 3.3 The `api` object

| Member | What it is |
|---|---|
| `api.name` | Your plugin's folder name, e.g. `"my-plugin"` |
| `api.dir` | Your installed folder, e.g. `"/plugins/my-plugin"` or `"/.crosspoint/plugins/my-plugin"`. **Always build paths from this; never hard-code the root.** |
| `api.relay(method, url, headers?, body?)` | Outbound HTTP(S) through the reader → `{status, headers, body}` |
| `api.fetchToSd(url, dest, headers?, options?)` | Download a URL straight to an SD path → `{status, bytes, complete, total}` |
| `api.writeFile(path, base64)` | Write a small file (≤ 256 KB) to SD → `{ok, bytes}` |
| `api.crypto(op, fields)` | Device crypto primitives |
| `api.pluginFile(file)` | URL of a file in your plugin folder, for `fetch`, `<img src>`, `<script src>` |
| `api.registerAction(name, fn)` | Register a job-queue action (chapter 6) |

There is also a global `CrossPoint` object with the same functions, which take an extra
leading `plugin` argument (`CrossPoint.relay(pluginName, method, ...)`). Use
`api`. It fills in your name for you.

### `api.relay(method, url, headers = {}, body = '')`

The reader makes the request and streams the answer back.

```js
const r = await api.relay('GET', 'https://api.example.com/items?limit=10',
                          { Accept: 'application/json' });
if (r.status !== 200) throw new Error('HTTP ' + r.status);
const data = JSON.parse(r.body);

// Response headers: ordered [name, value] pairs, duplicates kept
const cookies = r.headers.filter(([n]) => n.toLowerCase() === 'set-cookie').map(([, v]) => v);
```

- Any method. `body` is a **string**. To send JSON, use `JSON.stringify(...)` and set
  `Content-Type` yourself.
- `r.body` is a **text string**. Binary responses don't survive. Use
  `fetchToSd` for files.
- **Response body cap: 64 KB.** Over the cap (or a dropped connection) →
  throws an `Error` with `err.status === 502`.
- **Redirects are NOT followed.** You get the 3xx and its `location` header
  and must follow it yourself:

  ```js
  async function relayFollow(method, url, headers, body, hops = 5) {
    for (let i = 0; i <= hops; i++) {
      const r = await api.relay(method, url, headers, body);
      if (r.status < 300 || r.status >= 400) return r;
      const loc = r.headers.find(([n]) => n.toLowerCase() === 'location');
      if (!loc) return r;
      url = new URL(loc[1], url).href;
      if (r.status === 303) { method = 'GET'; body = ''; }
    }
    throw new Error('too many redirects');
  }
  ```
- Non-2xx upstream statuses are **not** errors. Check `r.status`.
- TLS is encrypted, but **the server certificate is not verified** (the reader has
  no CA bundle). Don't rely on it against an active attacker on your network.
- Requests are slow (a TLS handshake on a small chip), and the reader handles one at a
  time. Don't fire many in parallel.

### `api.fetchToSd(url, dest, headers = {}, options = {})`

Downloads to SD without the body ever passing through the browser. Use it for
books, images and anything over 64 KB.

```js
const res = await api.fetchToSd(
  'https://example.com/book.epub',
  '/Books/Example/book.epub',
  { Authorization: 'Bearer ' + token });
// res = { status: 200, bytes: 1234567, complete: true, total: 1234567 }
```

- `dest` must be absolute, without `..`. **Missing parent folders are created.**
- Writes to `dest.part` first and replaces `dest` only when complete, so a
  failed update keeps the old file.
- **GET** (the default): follows up to 5 redirects, resumes after network drops
  with Range requests, and transfers in 2 MB segments so mobile browsers don't kill
  long requests. Your headers are sent only while redirects stay on the same
  scheme+host+port.
- **Other methods / a body**: `options = { method: 'POST', body: '{"x":1}' }`.
  Body ≤ 4 KB, sent **once**, no redirects, no resume.
- On failure it **throws**. `err.result` holds the device answer, e.g.
  `{status: 404, error: 'http status', complete: false}`. For non-GET requests
  `err.result.body` contains the first 512 bytes of the server's error answer.
- Saving `.epub`, `.txt`, `.md` or `.xtc` (outside hidden folders) marks the
  Library index stale, so the book shows up the next time the Library opens.

### `api.writeFile(path, base64)`

```js
// UTF-8-safe text → base64 (plain btoa() throws on non-Latin-1 characters)
function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

await api.writeFile(api.dir + '/config.json', b64(JSON.stringify({ server: 'https://x' })));
```

- **Max 256 KB.** Empty content is rejected (`400 empty body`), so to "clear"
  a JSON file write `{}`.
- Absolute path, no `..`. Parent folders are created. Atomic: written to
  `path.tmp`, then swapped in.
- Sent as multipart, so binary data (NUL bytes) survives.
- Not limited to your own folder. Any path except the credential stores works,
  but keep your data in `api.dir`.

### Reading files

There is no `api.readFile`. Use one of these:

```js
// A file directly inside your plugin folder (no subfolders):
const r = await fetch(api.pluginFile('config.json'));
const cfg = r.ok ? await r.json() : {};          // 404 when it doesn't exist yet

// Any file on the SD card (the last path component must not start with "."):
const r2 = await fetch('/download?path=' + encodeURIComponent(api.dir + '/data/state.json'));
```

`api.pluginFile(f)` is just `'/plugin?name=<you>&file=<f>'`. `f` must be a single
name (no `/`). It's also how you load extra scripts or images:

```js
await new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = api.pluginFile('epub.js');
  s.onload = ok; s.onerror = fail;
  document.head.appendChild(s);
});
container.insertAdjacentHTML('beforeend', `<img src="${api.pluginFile('logo.svg')}" width="48">`);
```

Content types: `.js .css .html .json .svg` get proper types. Everything else is
served as `application/octet-stream`.

### `api.crypto(op, fields)`

All binary values are **base64**, each at most 64 KB. Errors come back as `{error}`
with HTTP 200, so check for `error`.

| `op` | Fields | Returns |
|---|---|---|
| `random` | `len` (≤ 4096, default 16) | `data` |
| `sha1` / `sha256` | `data` | `data` |
| `aesenc` | `key`, `iv` (16 bytes each), `data` | `data` (AES-128-CBC, PKCS#7) |
| `aesdec` | `key`, `iv`, `data` | `data` (padding NOT removed) |
| `keygen` | none | `public` (SPKI DER), `private` (PKCS#8 DER) |
| `pubencrypt` | `cert` (X.509 DER), `data` | `data` |
| `sign` | `private`, `hash` (20 bytes) | `data` (128-byte raw RSA) |
| `rsadec` | `private`, `data` | `data` (raw, padding left) |
| `pkcs12` | `data`, `password` | `key`, `cert` |

> **Watch out for `crypto.subtle`.** Browsers only provide `crypto.subtle`
> (HMAC, SHA-256, AES-GCM...) in a *secure context* (HTTPS or `localhost`).
> The reader's web UI is plain `http://crosspoint.local` or `http://192.168.x.x`,
> so `crypto.subtle` is usually **`undefined`** there.
> `crypto.getRandomValues` still works. For hashing or signing, use `api.crypto`
> or a small pure-JS library you ship in your plugin folder (for example a
> SHA-1/HMAC implementation for OAuth 1.0a). The official docs suggest
> `crypto.subtle`. Test it on a real device before relying on it.

## 3.4 Same-origin device endpoints you can `fetch()`

These need no wrapper. They are on the same origin as the page.

| Endpoint | Use |
|---|---|
| `GET /api/status` | `{version, firmwareFamily, pluginApi, pluginCapabilities, ip, mode, rssi, freeHeap, uptime, device}` |
| `GET /api/status?plugin=<name>` | adds `deviceId`: a stable 64-hex id, unique per device **and** per plugin. Useful for "register this reader" flows. |
| `GET /api/plugins` | the installed plugins list |
| `GET /api/files?path=/Books` | `[{name, size, isDirectory, isEpub}]` (dotfiles hidden unless that setting is on) |
| `GET /download?path=...` | read a file |
| `POST /upload?path=/dir` | multipart upload (`file` field) |
| `POST /mkdir` | form: `name`, `path` (parent) |
| `POST /rename` | form: `path`, `name` (files only) |
| `POST /move` | form: `path`, `dest` (existing folder; files only) |
| `POST /delete` | form: `path`, or `paths` (JSON array). Folders must be empty. |
| `GET /api/settings?keys=a,b` | read specific reader settings (`value` of an enum is an **index** into `options`) |
| `POST /api/settings` | JSON `{"key": value}` partial update |
| `POST /api/book-key` | store a content key for a protected book (DRM plugins) |

Form endpoints take `application/x-www-form-urlencoded`:

```js
const form = (o) => new URLSearchParams(o);
await fetch('/mkdir', { method: 'POST', body: form({ name: 'Articles', path: '/Books' }) });
await fetch('/move',  { method: 'POST', body: form({ path: '/a.epub', dest: '/Books/Articles' }) });
```

## 3.5 The host pages

Which page loads your script depends on `mount`:

| Page | Loads `plugin.js` when | Your UI |
|---|---|---|
| `/plugins` | `mount` is `"settings"` (default) | visible card |
| `/files` | `mount` is `"files"` | visible card below the file list. **JSZip is preloaded** (`window.JSZip`) before the first plugin loads. |
| `/plugins-run` | always (any mount) | rendered into a **hidden** container (`display:none`) |

On `/plugins`, a `files` plugin gets a small info card saying it appears on the
File Manager page. On other pages JSZip is not preloaded:

```js
if (typeof JSZip === 'undefined') {
  await new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = '/js/jszip.min.js'; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
}
```

**Design for `/plugins-run`:** your render function also runs there, invisibly,
so registered actions can be executed. Don't start long work automatically at render time.
Wait for a button click or an action.

## 3.6 Security notes

- `plugin.js` runs **unsandboxed** in the device's web UI. It can call every
  endpoint above, including deleting files. Users should install only plugins
  they trust. As an author, don't give them a reason not to trust yours.
- Three files can **never** be read, written, moved or deleted by any web
  request: `/.crosspoint/wifi.json`, `/.crosspoint/opds.json`,
  `/.crosspoint/koreader.json`. Every spelling trick (`//`, `..`, 8.3 short names,
  trailing dots, case) is canonicalised and blocked.
- Tokens and passwords you save to `config.json`/`token.json` are **plain text
  on the SD card**. Tell your users.
- The web UI has no login. Anyone on the same network can open it while File
  Transfer is running.

## 3.7 A complete skeleton

```js
CrossPoint.registerPlugin(async (container, api) => {
  const $ = (sel) => container.querySelector(sel);
  const b64 = (t) => { let s = ''; for (const c of new TextEncoder().encode(t)) s += String.fromCharCode(c); return btoa(s); };

  async function loadConfig() {
    const r = await fetch(api.pluginFile('config.json'));
    return r.ok ? r.json() : {};
  }
  async function saveConfig(cfg) {
    await api.writeFile(api.dir + '/config.json', b64(JSON.stringify(cfg)));
  }

  container.innerHTML = `
    <h2>My Plugin</h2>
    <div class="setting-row">
      <div class="setting-name">Server URL</div>
      <div class="setting-control"><input type="text" data-k="server" placeholder="https://…"></div>
    </div>
    <p><button class="btn-small btn-add" data-act="save">Save</button>
       <span data-out style="margin-left:8px;color:var(--muted-color)"></span></p>`;

  const cfg = await loadConfig();
  $('[data-k=server]').value = cfg.server || '';

  $('[data-act=save]').onclick = async () => {
    try {
      cfg.server = $('[data-k=server]').value.trim().replace(/\/+$/, '');
      await saveConfig(cfg);
      $('[data-out]').textContent = 'Saved.';
    } catch (e) {
      $('[data-out]').textContent = 'Error: ' + e.message;
    }
  };

  api.registerAction('ping', async () => ({ server: cfg.server || null }));
});
```

Next: [On-device catalogs](04-device-catalogs.md).
