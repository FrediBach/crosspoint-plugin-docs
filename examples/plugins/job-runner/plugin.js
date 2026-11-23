// job-runner: actions an outside program can trigger through the job queue.
//
//   POST /api/plugin-jobs {"plugin":"job-runner","action":"save","args":{"url":"https://…/book.epub"}}
//   GET  /api/plugin-jobs/status?id=N
//
// Jobs run only while a page hosting this plugin is open: /plugins, or the
// headless runner /plugins-run. args and result must each stay < 192 bytes.
// See companions/job-runner/send-to-reader.sh.

CrossPoint.registerPlugin((container, api) => {
  const b64 = (t) => { let s = ''; for (const c of new TextEncoder().encode(t)) s += String.fromCharCode(c); return btoa(s); };
  const INBOX = '/Books/Inbox';

  // A visible card on /plugins with a manual form, nice for testing.
  container.innerHTML = `
    <h2>Job Runner Example</h2>
    <div class="setting-row"><div class="setting-name">Book URL</div>
      <div class="setting-control"><input type="text" data-url placeholder="https://…/book.epub"></div></div>
    <p><button class="btn-small btn-add">Download</button> <span data-out></span></p>`;

  async function save(args) {
    const url = String(args.url || '');
    if (!/^https?:\/\//.test(url)) throw new Error('url must start with http(s)://');
    // Name: explicit, or the last URL segment, made safe for FAT.
    let name = String(args.name || decodeURIComponent(new URL(url).pathname.split('/').pop() || 'book'));
    name = name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    if (!/\.(epub|txt|md|xtc|pdf)$/i.test(name)) name += '.epub';
    const dest = `${INBOX}/${name}`;

    const res = await api.fetchToSd(url, dest);           // follows redirects, resumes, creates /Books/Inbox
    await api.writeFile(dest + '.meta.json',               // sidecar: remember where it came from
      b64(JSON.stringify({ jobrunner_source: url.slice(0, 500) })));
    return { dest, bytes: res.bytes };                      // small: must stay < 192 bytes of JSON
  }

  // The job-queue entry point.
  api.registerAction('save', save);

  // The manual button uses the same code path.
  container.querySelector('button').onclick = async () => {
    const out = container.querySelector('[data-out]');
    out.textContent = 'Downloading…';
    try {
      const r = await save({ url: container.querySelector('[data-url]').value.trim() });
      out.textContent = `Saved ${r.dest} (${r.bytes} bytes)`;
    } catch (e) {
      out.textContent = 'Error: ' + e.message;
    }
  };
});
