// password-catalog: web setup for a device.json catalog that signs in with
// username + password (auth.type "password").
//
// The browser only collects and tests the credentials. It writes:
//   config.json  {server, username, password}   → {cfg.*} on the device
//   token.json   {token: "..."}                 → {token} on the device
// The reader re-mints the token by itself whenever the server answers 401/403.
//
// To adapt: change TOKEN_PATH / loginRequest() to match your server, and keep
// device.json's auth.request identical to loginRequest().

const REQUIRED_CAPS = ['catalog.list_index_mapping', 'catalog.encoded_item_fields', 'catalog.server_paths'];

function loginRequest(cfg) {
  return {
    method: 'POST',
    url: cfg.server + '/oauth/token',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
  };
}
const tokenFrom = (json) => json && json.access_token;

CrossPoint.registerPlugin(async (container, api) => {
  const $ = (s) => container.querySelector(s);
  const b64 = (t) => { let s = ''; for (const c of new TextEncoder().encode(t)) s += String.fromCharCode(c); return btoa(s); };
  const write = (name, obj) => api.writeFile(`${api.dir}/${name}`, b64(JSON.stringify(obj)));
  const read = async (name) => {
    try { const r = await fetch(api.pluginFile(name)); return r.ok ? await r.json() : {}; } catch (e) { return {}; }
  };

  container.innerHTML = `
    <h2>Password Catalog Example</h2>
    <p data-warn style="color:var(--warning-text)" hidden></p>
    <div class="setting-row"><div class="setting-name">Server</div>
      <div class="setting-control"><input type="text" data-k="server" placeholder="http://192.168.1.20:8080"></div></div>
    <div class="setting-row"><div class="setting-name">Username</div>
      <div class="setting-control"><input type="text" data-k="username" autocomplete="off"></div></div>
    <div class="setting-row"><div class="setting-name">Password</div>
      <div class="setting-control"><input type="password" data-k="password" autocomplete="new-password"></div></div>
    <p><button type="button" class="btn-small btn-add" data-act="save">Test &amp; save</button>
       <button type="button" class="btn-small" data-act="signout">Sign out</button></p>
    <p data-out></p>
    <p style="color:var(--muted-color);font-size:.9em">
      The password is stored unencrypted on the SD card so the reader can sign in by itself.</p>`;

  const inputs = [...container.querySelectorAll('[data-k]')];
  const out = (m, ok = true) => {
    $('[data-out]').textContent = m;
    $('[data-out]').style.color = ok ? 'var(--success-color)' : 'var(--danger-color)';
  };

  // Warn when the firmware lacks features device.json relies on.
  try {
    const status = await (await fetch('/api/status')).json();
    const have = String(status.pluginCapabilities || '').split(',');
    const missing = REQUIRED_CAPS.filter((c) => !have.includes(c));
    if (missing.length) {
      $('[data-warn]').hidden = false;
      $('[data-warn]').textContent = 'This firmware lacks ' + missing.join(', ') + '. Update CrossPoint for this catalog to work.';
    }
  } catch (e) { /* status is informational only */ }

  const cfg = await read('config.json');
  const tok = await read('token.json');
  for (const el of inputs) el.value = cfg[el.dataset.k] || '';
  if (tok.token) out('Signed in.');

  $('[data-act=save]').onclick = async () => {
    const next = {};
    for (const el of inputs) next[el.dataset.k] = el.value.trim();
    next.server = next.server.replace(/\/+$/, '');
    if (!/^https?:\/\//.test(next.server)) return out('Server must start with http:// or https://', false);
    out('Signing in…');
    try {
      const req = loginRequest(next);
      const r = await api.relay(req.method, req.url, req.headers, req.body);
      let json = null;
      try { json = JSON.parse(r.body); } catch (e) { /* not JSON */ }
      const token = tokenFrom(json);
      if (r.status < 200 || r.status >= 300 || !token) {
        throw new Error((json && (json.message || json.error)) || 'HTTP ' + r.status);
      }
      await write('config.json', next);
      await write('token.json', { token });
      out('Signed in and saved. Open Home → Plugins on the reader.');
    } catch (e) {
      out('Sign-in failed: ' + e.message, false);
    }
  };

  $('[data-act=signout]').onclick = async () => {
    // An empty file is rejected by writeFile; {} means "no token".
    await write('token.json', {});
    await write('config.json', { server: $('[data-k=server]').value.trim() });
    $('[data-k=password]').value = '';
    out('Signed out. Credentials removed from the SD card.');
  };
});
