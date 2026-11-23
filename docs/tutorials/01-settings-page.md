# Tutorial 1: A settings page that saves config

**You'll build:** a web settings card that stores a server URL, a username and a
password in `config.json`, tests the connection through the reader, and lets the
user pick a download folder. Tutorials 3 and 4 use this pattern again.

**You'll learn:** `registerPlugin`, reading and writing plugin files,
`api.relay`, the native card styles, and why `config.json` connects the
browser side and the device side.

## Files

```
/plugins/my-server/
├── manifest.json
└── plugin.js
```

### `manifest.json`

```json
{
  "name": "my-server",
  "title": "My Server",
  "description": "Connects the reader to my home server.",
  "author": "You",
  "version": "0.1.0"
}
```

### `plugin.js`

```js
CrossPoint.registerPlugin(async (container, api) => {
  // ---------- helpers ----------
  const $ = (s) => container.querySelector(s);
  const b64 = (text) => {
    let bin = '';
    for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
    return btoa(bin);
  };
  const CONFIG = 'config.json';

  async function readConfig() {
    try {
      const r = await fetch(api.pluginFile(CONFIG));   // 404 before the first save
      return r.ok ? await r.json() : {};
    } catch (e) { return {}; }
  }
  async function writeConfig(cfg) {
    // config.json must stay FLAT (strings/whole numbers) and under 2 KB,
    // because the device reads it as {cfg.KEY} values.
    const json = JSON.stringify(cfg);
    if (json.length > 2000) throw new Error('config too large');
    await api.writeFile(api.dir + '/' + CONFIG, b64(json));
  }

  // ---------- UI ----------
  const row = (label, input) => `
    <div class="setting-row">
      <div class="setting-name">${label}</div>
      <div class="setting-control">${input}</div>
    </div>`;

  container.innerHTML = `
    <h2>My Server</h2>
    ${row('Server URL', '<input type="text" data-k="server" placeholder="https://books.example.com">')}
    ${row('Username',   '<input type="text" data-k="username" autocomplete="off">')}
    ${row('Password',   '<input type="password" data-k="password" autocomplete="new-password">')}
    ${row('Save books to', '<input type="text" data-k="dest_dir" placeholder="/Books/My Server">')}
    <p>
      <button class="btn-small btn-add" data-act="save">Save</button>
      <button class="btn-small" data-act="test">Test connection</button>
    </p>
    <p data-out style="color:var(--muted-color)"></p>
    <p style="color:var(--muted-color);font-size:.9em">
      Stored unencrypted on the SD card in ${api.dir}/${CONFIG}.
    </p>`;

  const out = (msg, ok = true) => {
    $('[data-out]').textContent = msg;
    $('[data-out]').style.color = ok ? 'var(--success-color)' : 'var(--danger-color)';
  };
  const inputs = [...container.querySelectorAll('[data-k]')];

  // ---------- load ----------
  const cfg = await readConfig();
  for (const el of inputs) el.value = cfg[el.dataset.k] ?? '';

  // ---------- save ----------
  $('[data-act=save]').onclick = async () => {
    for (const el of inputs) {
      const v = el.value.trim();
      if (v) cfg[el.dataset.k] = v; else delete cfg[el.dataset.k];
    }
    if (cfg.server) cfg.server = cfg.server.replace(/\/+$/, '');   // no trailing slash
    if (cfg.dest_dir && !cfg.dest_dir.startsWith('/')) cfg.dest_dir = '/' + cfg.dest_dir;
    try {
      await writeConfig(cfg);
      out('Saved.');
    } catch (e) {
      out('Save failed: ' + e.message, false);
    }
  };

  // ---------- test through the reader (no CORS!) ----------
  $('[data-act=test]').onclick = async () => {
    const server = $('[data-k=server]').value.trim().replace(/\/+$/, '');
    if (!server) return out('Enter a server URL first.', false);
    out('Testing…');
    try {
      const r = await api.relay('GET', server + '/', { Accept: '*/*' });
      out(`Server answered HTTP ${r.status}.`, r.status < 500);
    } catch (e) {
      out('No answer: ' + e.message, false);
    }
  };
});
```

## Try it

1. Put the reader in File Transfer mode and upload both files to `/plugins/my-server/`.
2. Open `http://crosspoint.local/plugins`. The card appears.
3. Fill in the fields and click **Save**. Check the File Manager: a `config.json` now exists in the folder.
4. Click **Test connection**.

## Why this matters

Any `device.json` in the same folder can now use these values:

```json
"config": { "file": "config.json" },
"browse": { "url": "{cfg.server}/api/books" }
```

- `{cfg.server}`, `{cfg.username}`, `{cfg.password}` are replaced on the reader.
- The key **`dest_dir`** is special: it overrides `download.dest_dir`, so the
  "Save books to" field works with no extra code.

## Common mistakes

| Symptom | Cause |
|---|---|
| Card shows *"No browser settings for My Server."* | `registerPlugin` wasn't called synchronously (for example after an `await`). |
| *"Failed to load plugin."* | Your function threw. Open the browser console. |
| `btoa` error "invalid character" | You passed non-Latin-1 text to `btoa`. Use the `b64` helper. |
| Device ignores a value | It isn't flat (nested object, boolean, decimal), or the file is over 2 KB. |
| Two plugins fight over elements | You used `document.getElementById` with generic IDs. Use `container.querySelector`. |

Next: [Tutorial 2: Your own book shelf](02-static-catalog.md).
