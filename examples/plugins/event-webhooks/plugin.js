// event-webhooks: settings for an events-only device.json.
//
// The events themselves are sent by the reader (no browser needed). This page
// stores {server, secret} in config.json and can send a test request that
// looks exactly like a real "reader.exit" delivery, so you can check your
// receiver before reading a single page.

CrossPoint.registerPlugin(async (container, api) => {
  const $ = (s) => container.querySelector(s);
  const b64 = (t) => { let s = ''; for (const c of new TextEncoder().encode(t)) s += String.fromCharCode(c); return btoa(s); };
  const read = async (name) => {
    try { const r = await fetch(api.pluginFile(name)); return r.ok ? await r.json() : {}; } catch (e) { return {}; }
  };

  container.innerHTML = `
    <h2>Event Webhooks Example</h2>
    <div class="setting-row"><div class="setting-name">Server</div>
      <div class="setting-control"><input type="text" data-k="server" placeholder="http://192.168.1.20:8090"></div></div>
    <div class="setting-row"><div class="setting-name">Secret (X-Secret header)</div>
      <div class="setting-control"><input type="text" data-k="secret" autocomplete="off"></div></div>
    <p><button type="button" class="btn-small btn-add" data-act="save">Save</button>
       <button type="button" class="btn-small" data-act="test">Send test event</button>
       <button type="button" class="btn-small" data-act="secret">Generate secret</button></p>
    <p data-out></p>
    <p style="color:var(--muted-color);font-size:.9em">
      New or changed event handlers take effect after you leave File Transfer mode.</p>`;

  const out = (m, ok = true) => {
    $('[data-out]').textContent = m;
    $('[data-out]').style.color = ok ? 'var(--success-color)' : 'var(--danger-color)';
  };
  const collect = () => ({
    server: $('[data-k=server]').value.trim().replace(/\/+$/, ''),
    secret: $('[data-k=secret]').value.trim(),
  });

  const cfg = await read('config.json');
  $('[data-k=server]').value = cfg.server || '';
  $('[data-k=secret]').value = cfg.secret || '';

  $('[data-act=secret]').onclick = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));   // works on plain http
    $('[data-k=secret]').value = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  $('[data-act=save]').onclick = async () => {
    const next = collect();
    if (!/^https?:\/\//.test(next.server)) return out('Server must start with http:// or https://', false);
    await api.writeFile(api.dir + '/config.json', b64(JSON.stringify(next)));
    out('Saved. Leave File Transfer mode to activate the events.');
  };

  $('[data-act=test]').onclick = async () => {
    const c = collect();
    if (!c.server) return out('Enter the server first.', false);
    const body = JSON.stringify({
      id: 'test-' + Date.now(), ts: Math.floor(Date.now() / 1000),
      book: '/Books/Test Book.epub', percent: 42, end_percent: 43,
    });
    try {
      const r = await api.relay('POST', c.server + '/hook/exit',
        { 'Content-Type': 'application/json', 'X-Secret': c.secret }, body);
      // The reader treats any 2xx as delivered; anything else is retried later.
      out(r.status >= 200 && r.status < 300
        ? `Delivered (HTTP ${r.status}).`
        : `Server answered HTTP ${r.status}. The reader would keep retrying.`, r.status < 300);
    } catch (e) {
      out('No answer: ' + e.message, false);
    }
  };
});
