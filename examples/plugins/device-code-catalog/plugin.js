// device-code-catalog: web side of an OAuth 2.0 device-code catalog.
//
// The reader can sign in on its own (device.json "auth"), so this page is
// optional. It offers:
//   - the server address (config.json → {cfg.server}); a real service would
//     hard-code its URLs in device.json and drop this field,
//   - the SAME sign-in from the browser (handy when the reader is in your bag),
//   - sign out.
// Both sides write token.json as {"token": "..."}, so either sign-in works for both.

const CLIENT_ID = 'crosspoint-example';

CrossPoint.registerPlugin(async (container, api) => {
  const $ = (s) => container.querySelector(s);
  const b64 = (t) => { let s = ''; for (const c of new TextEncoder().encode(t)) s += String.fromCharCode(c); return btoa(s); };
  const write = (name, obj) => api.writeFile(`${api.dir}/${name}`, b64(JSON.stringify(obj)));
  const read = async (name) => {
    try { const r = await fetch(api.pluginFile(name)); return r.ok ? await r.json() : {}; } catch (e) { return {}; }
  };
  const form = (o) => new URLSearchParams(o).toString();
  const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  container.innerHTML = `
    <h2>Device Code Catalog Example</h2>
    <div class="setting-row"><div class="setting-name">Server</div>
      <div class="setting-control"><input type="text" data-server placeholder="http://192.168.1.20:8081"></div></div>
    <p><button type="button" class="btn-small" data-act="save">Save server</button>
       <button type="button" class="btn-small btn-add" data-act="signin">Sign in here</button>
       <button type="button" class="btn-small" data-act="signout">Sign out</button></p>
    <div data-code hidden style="text-align:center">
      <p>Open <a data-url target="_blank" rel="noopener"></a> and enter</p>
      <p style="font-size:1.8em;letter-spacing:.15em"><b data-user-code></b></p>
    </div>
    <p data-out></p>`;

  const out = (m, ok = true) => {
    $('[data-out]').textContent = m;
    $('[data-out]').style.color = ok ? 'var(--success-color)' : 'var(--danger-color)';
  };
  const server = () => $('[data-server]').value.trim().replace(/\/+$/, '');

  const cfg = await read('config.json');
  $('[data-server]').value = cfg.server || '';
  out((await read('token.json')).token ? 'Signed in.' : 'Not signed in.');

  async function relayJson(url, body) {
    const r = await api.relay('POST', url, FORM, form(body));
    let json = {};
    try { json = JSON.parse(r.body); } catch (e) { /* keep {} */ }
    return { status: r.status, json };
  }

  $('[data-act=save]').onclick = async () => {
    cfg.server = server();
    await write('config.json', cfg);
    out('Server saved.');
  };

  let busy = false;
  $('[data-act=signin]').onclick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (!server()) throw new Error('enter the server first');
      cfg.server = server();
      await write('config.json', cfg);

      const dev = await relayJson(cfg.server + '/device/code', { client_id: CLIENT_ID });
      if (!dev.json.device_code) throw new Error('code request failed (HTTP ' + dev.status + ')');
      $('[data-url]').textContent = $('[data-url]').href = dev.json.verification_uri;
      $('[data-user-code]').textContent = dev.json.user_code;
      $('[data-code]').hidden = false;
      out('Waiting for approval…');

      // Same timing rules the reader uses: interval ≥ 3 s, lifetime ≥ 60 s, slow_down adds 5 s.
      let interval = Math.max(3, dev.json.interval || 5) * 1000;
      const deadline = Date.now() + Math.max(60, dev.json.expires_in || 900) * 1000;
      while (Date.now() < deadline) {
        await sleep(interval);
        const poll = await relayJson(cfg.server + '/device/token', {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: CLIENT_ID,
          device_code: dev.json.device_code,
        });
        if (poll.json.access_token) {
          await write('token.json', { token: poll.json.access_token });
          $('[data-code]').hidden = true;
          return out('Signed in. The reader can browse now.');
        }
        const err = poll.json.error;
        if (err === 'slow_down') interval += 5000;
        else if (err === 'expired_token' || err === 'access_denied') throw new Error(err.replace('_', ' '));
      }
      throw new Error('the code expired');
    } catch (e) {
      $('[data-code]').hidden = true;
      out('Sign-in failed: ' + e.message, false);
    } finally {
      busy = false;
    }
  };

  $('[data-act=signout]').onclick = async () => {
    await write('token.json', {});
    out('Signed out.');
  };
});
