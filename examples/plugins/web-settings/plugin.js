// web-settings: a reusable settings page for any plugin.
//
// Edit FIELDS below. Values are saved FLAT to <plugin dir>/config.json, so a
// device.json in the same folder can use them as {cfg.KEY}. Rules the device
// enforces on config.json: flat object, string or whole-number values only,
// max 2 KB. Booleans would read as empty on the device, so checkboxes are
// stored as "1" / "0".
//
// Special key: "dest_dir" overrides download.dest_dir of a device.json catalog.

const FIELDS = [
  { key: 'server',   label: 'Server URL', type: 'url',      placeholder: 'https://books.example.com' },
  { key: 'username', label: 'Username',   type: 'text' },
  { key: 'password', label: 'Password',   type: 'password' },
  { key: 'dest_dir', label: 'Save books to', type: 'text',  placeholder: '/Books/Example' },
  { key: 'page',     label: 'Items per page', type: 'number', min: 1, max: 16, value: '8' },
  { key: 'sort',     label: 'Sort order', type: 'select',
    options: [['added', 'Recently added'], ['title', 'Title'], ['author', 'Author']] },
  { key: 'wifi_ok',  label: 'Sync at sleep', type: 'checkbox' },
];

// Optional: a GET request to run when "Test" is clicked. Return null to hide the button.
const testUrl = (cfg) => (cfg.server ? cfg.server + '/' : null);

CrossPoint.registerPlugin(async (container, api) => {
  const $ = (sel) => container.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const b64 = (text) => {
    let bin = '';
    for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
    return btoa(bin);
  };
  const CONFIG = 'config.json';

  async function readConfig() {
    try {
      const r = await fetch(api.pluginFile(CONFIG)); // 404 before the first save
      return r.ok ? await r.json() : {};
    } catch (e) {
      return {};
    }
  }

  async function writeConfig(cfg) {
    const json = JSON.stringify(cfg);
    if (json.length > 2000) throw new Error('config.json would exceed 2 KB');
    // writeFile rejects empty bodies; "{}" is the smallest valid config.
    await api.writeFile(api.dir + '/' + CONFIG, b64(json));
  }

  function control(f) {
    const attrs = `data-k="${f.key}" id="${api.name}-${f.key}"`;
    if (f.type === 'select') {
      return `<select ${attrs}>${f.options.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select>`;
    }
    if (f.type === 'checkbox') {
      return `<label class="toggle-switch"><input type="checkbox" ${attrs}><span class="toggle-slider"></span></label>`;
    }
    const type = f.type === 'url' ? 'text' : f.type;
    const extra = [
      f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '',
      f.min != null ? `min="${f.min}"` : '',
      f.max != null ? `max="${f.max}"` : '',
      f.type === 'password' ? 'autocomplete="new-password"' : 'autocomplete="off"',
    ].join(' ');
    return `<input type="${type}" ${attrs} ${extra}>`;
  }

  container.innerHTML = `
    <h2>${esc(api.name)}</h2>
    ${FIELDS.map((f) => `
      <div class="setting-row">
        <div class="setting-name"><label for="${api.name}-${f.key}">${esc(f.label)}</label></div>
        <div class="setting-control">${control(f)}</div>
      </div>`).join('')}
    <p>
      <button type="button" class="btn-small btn-add" data-act="save">Save</button>
      <button type="button" class="btn-small" data-act="test">Test</button>
      <button type="button" class="btn-small" data-act="clear">Clear</button>
    </p>
    <p data-out></p>
    <p style="color:var(--muted-color);font-size:.9em">
      Stored unencrypted on the SD card: ${esc(api.dir)}/${CONFIG}
    </p>`;

  // Use the manifest title as heading.
  try {
    const list = await (await fetch('/api/plugins')).json();
    const me = list.find((p) => p.name === api.name);
    if (me && me.title) $('h2').textContent = me.title;
  } catch (e) { /* keep the fallback heading */ }

  const out = (msg, ok = true) => {
    $('[data-out]').textContent = msg;
    $('[data-out]').style.color = ok ? 'var(--success-color)' : 'var(--danger-color)';
  };

  function fill(cfg) {
    for (const f of FIELDS) {
      const el = $(`[data-k="${f.key}"]`);
      const v = cfg[f.key] ?? f.value ?? '';
      if (f.type === 'checkbox') el.checked = String(v) === '1';
      else el.value = v;
    }
  }

  function collect() {
    const cfg = {};
    for (const f of FIELDS) {
      const el = $(`[data-k="${f.key}"]`);
      let v = f.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value.trim();
      if (f.type === 'url') v = v.replace(/\/+$/, '');               // no trailing slash
      if (f.key === 'dest_dir' && v && !v.startsWith('/')) v = '/' + v;
      if (v !== '') cfg[f.key] = v;
    }
    return cfg;
  }

  fill(await readConfig());
  if (!FIELDS.some((f) => f.type === 'url')) $('[data-act=test]').hidden = true;

  $('[data-act=save]').onclick = async () => {
    try {
      await writeConfig(collect());
      out('Saved.');
    } catch (e) {
      out('Save failed: ' + e.message, false);
    }
  };

  $('[data-act=test]').onclick = async () => {
    const url = testUrl(collect());
    if (!url) return out('Nothing to test yet.', false);
    out('Testing ' + url + ' …');
    try {
      // api.relay goes through the reader: no CORS, but no redirects followed either.
      const r = await api.relay('GET', url, { Accept: '*/*' });
      out(`Server answered HTTP ${r.status}.`, r.status < 500);
    } catch (e) {
      out('No answer: ' + e.message, false);
    }
  };

  $('[data-act=clear]').onclick = async () => {
    if (!confirm('Delete all saved settings?')) return;
    await writeConfig({});
    fill({});
    out('Cleared.');
  };
});
