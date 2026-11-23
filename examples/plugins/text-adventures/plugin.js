// text-adventures: web setup for the on-device game catalog (device.json).
//
// Writes config.json {server, session}. device.json uses both:
//   {cfg.server}   the companion server (examples/companions/text-adventures)
//   {cfg.session}  a random id for this reader: the server keeps its saved games under it
//
// The game itself never runs here. The server plays it, and the reader shows the
// turns as catalog rows.

const REQUIRED_CAPS = ['catalog.lists', 'catalog.list_index_mapping', 'catalog.item_details', 'catalog.server_paths'];

CrossPoint.registerPlugin(async (container, api) => {
  const $ = (s) => container.querySelector(s);
  const b64 = (t) => { let s = ''; for (const c of new TextEncoder().encode(t)) s += String.fromCharCode(c); return btoa(s); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const newSession = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

  async function readConfig() {
    try { const r = await fetch(api.pluginFile('config.json')); return r.ok ? await r.json() : {}; } catch (e) { return {}; }
  }
  const writeConfig = (cfg) => api.writeFile(`${api.dir}/config.json`, b64(JSON.stringify(cfg)));

  container.innerHTML = `
    <h2>Text Adventures</h2>
    <p data-warn style="color:var(--warning-color)" hidden></p>
    <div class="setting-row"><div class="setting-name">Server</div>
      <div class="setting-control"><input type="text" data-k="server" placeholder="http://192.168.1.20:8095" autocomplete="off"></div></div>
    <div class="setting-row"><div class="setting-name">Player id</div>
      <div class="setting-control"><input type="text" data-k="session" readonly></div></div>
    <p><button type="button" class="btn-small btn-add" data-act="save">Test &amp; save</button>
       <button type="button" class="btn-small" data-act="new">New player id</button></p>
    <p data-out></p>
    <p style="color:var(--muted-color);font-size:.9em">
      Experimental. The games run on your server. On the reader: Home → Plugins → Text Adventures.
      Anyone who knows the player id can see and play your saved games.</p>`;

  const out = (html, ok = true) => {
    $('[data-out]').innerHTML = html;
    $('[data-out]').style.color = ok ? 'var(--success-color)' : 'var(--danger-color)';
  };

  try {
    const status = await (await fetch('/api/status')).json();
    const have = String(status.pluginCapabilities || '').split(',');
    const missing = REQUIRED_CAPS.filter((c) => !have.includes(c));
    if (missing.length) {
      $('[data-warn]').hidden = false;
      $('[data-warn]').textContent = 'This firmware lacks ' + missing.join(', ') + '. Update CrossPoint for this plugin to work.';
    }
  } catch (e) { /* older firmware without /api/status: just try */ }

  const cfg = await readConfig();
  $('[data-k=server]').value = cfg.server || '';
  $('[data-k=session]').value = cfg.session || newSession();

  $('[data-act=new]').onclick = () => {
    if (cfg.session && !confirm('Start with a new player id? Your saved games stay on the server under the old id.')) return;
    $('[data-k=session]').value = newSession();
    out('New id. Press Test & save to keep it.');
  };

  $('[data-act=save]').onclick = async () => {
    const server = $('[data-k=server]').value.trim().replace(/\/+$/, '');
    const session = $('[data-k=session]').value;
    if (!/^https?:\/\/[^/]+$/.test(server)) {
      return out('Enter the server as http://host:port, without a path (row links are relative to the server root).', false);
    }
    out('Testing ' + esc(server) + ' …');
    try {
      // api.relay goes through the reader, so this also proves the reader can reach the server.
      const r = await api.relay('GET', server + '/games', { Accept: 'application/json' });
      if (r.status !== 200) return out('The server answered HTTP ' + r.status + '.', false);
      const lists = (JSON.parse(r.body).lists || []);
      await writeConfig({ server, session });
      cfg.server = server;
      cfg.session = session;
      out(lists.length
        ? 'Saved. Games on the server: ' + lists.map((l) => esc(l.title)).join(', ') + '.'
        : 'Saved, but the server has no games yet. Put .z5/.z8 files into its games/ folder.', lists.length > 0);
    } catch (e) {
      out('The reader could not reach the server: ' + esc(e.message), false);
    }
  };
});
