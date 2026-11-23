// webdav-browser: web setup for an XML (WebDAV PROPFIND) catalog.
//
// device.json has no way to compute base64, so this page does it once and
// stores the ready-made header value as cfg.auth ("Basic {cfg.auth}").
// The raw user/pass are also stored, for the file GET's HTTP Basic auth
// (download.username / download.password).

CrossPoint.registerPlugin(async (container, api) => {
  const $ = (s) => container.querySelector(s);
  const b64 = (t) => { let s = ''; for (const c of new TextEncoder().encode(t)) s += String.fromCharCode(c); return btoa(s); };
  const write = (name, obj) => api.writeFile(`${api.dir}/${name}`, b64(JSON.stringify(obj)));
  const read = async (name) => {
    try { const r = await fetch(api.pluginFile(name)); return r.ok ? await r.json() : {}; } catch (e) { return {}; }
  };
  const PROPFIND_BODY = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>';

  container.innerHTML = `
    <h2>WebDAV Browser Example</h2>
    <div class="setting-row"><div class="setting-name">Folder URL</div>
      <div class="setting-control"><input type="text" data-k="url" placeholder="https://cloud.example.com/remote.php/dav/files/me/Books/"></div></div>
    <div class="setting-row"><div class="setting-name">Username</div>
      <div class="setting-control"><input type="text" data-k="user" autocomplete="off"></div></div>
    <div class="setting-row"><div class="setting-name">Password</div>
      <div class="setting-control"><input type="password" data-k="pass" autocomplete="new-password"></div></div>
    <p><button type="button" class="btn-small btn-add" data-act="save">Test &amp; save</button></p>
    <p data-out></p>
    <p style="color:var(--muted-color);font-size:.9em">Use an app password if your server offers one.
      It is stored unencrypted on the SD card.</p>`;

  const out = (m, ok = true) => {
    $('[data-out]').textContent = m;
    $('[data-out]').style.color = ok ? 'var(--success-color)' : 'var(--danger-color)';
  };

  const cfg = await read('config.json');
  for (const el of container.querySelectorAll('[data-k]')) el.value = cfg[el.dataset.k] || '';

  $('[data-act=save]').onclick = async () => {
    const next = {};
    for (const el of container.querySelectorAll('[data-k]')) next[el.dataset.k] = el.value.trim();
    // Folder URLs need a trailing slash, or many servers answer with a redirect
    // (a PROPFIND request should not rely on redirects).
    if (next.url && !next.url.endsWith('/')) next.url += '/';
    next.auth = b64(`${next.user}:${next.pass}`);
    out('Testing…');
    try {
      const r = await api.relay('PROPFIND', next.url,
        { Authorization: 'Basic ' + next.auth, Depth: '1', 'Content-Type': 'application/xml' }, PROPFIND_BODY);
      if (r.status === 401) throw new Error('wrong username or password');
      if (r.status !== 207) throw new Error('expected HTTP 207, got ' + r.status);
      const entries = (r.body.match(/<(\w+:)?response[\s>]/g) || []).length - 1;  // minus the folder itself
      await write('config.json', next);
      out(`OK: ${entries} entries in this folder. Saved.`);
    } catch (e) {
      // relay throws (502) when the listing is over 64 KB. The reader itself streams
      // listings up to 1 MB, so save anyway in that case.
      if (e.status === 502) {
        await write('config.json', next);
        return out('Listing too big to preview here, but saved. Try it on the reader.');
      }
      out('Test failed: ' + e.message, false);
    }
  };
});
