// file-tool: a File Manager plugin ("mount": "files").
//
// Renders below the file list on /files. Scans a folder tree with
// /api/files, shows book counts and sizes per folder, finds probable
// duplicates by normalised file name, and can move them to /Duplicates.
// JSZip is preloaded on /files (window.JSZip) if you want to open EPUBs.
//
// Also registers a "stats" job action (see the job-runner example).

CrossPoint.registerPlugin((container, api) => {
  const $ = (s) => container.querySelector(s);
  const BOOK = /\.(epub|xtc|txt|md|pdf)$/i;
  // Never scan plugin folders (their README.md files are not books) or our own output.
  const SKIP_DIRS = ['/plugins', '/Duplicates', '/System Volume Information'];
  const fmt = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB';
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const form = (o) => new URLSearchParams(o);

  container.innerHTML = `
    <h2>File Tool Example</h2>
    <div class="setting-row">
      <div class="setting-name">Scan folder</div>
      <div class="setting-control"><input type="text" data-root value="/"></div>
    </div>
    <p><button class="btn-small btn-add" data-act="scan">Scan</button>
       <button class="btn-small" data-act="move" disabled>Move duplicates to /Duplicates</button></p>
    <p data-status style="color:var(--muted-color)"></p>
    <div data-report></div>`;

  let duplicates = [];   // paths to move

  // One request at a time: the reader's web server is single-threaded.
  async function listDir(path) {
    const r = await fetch('/api/files?path=' + encodeURIComponent(path));
    if (!r.ok) throw new Error(`list ${path}: HTTP ${r.status}`);
    return r.json();
  }

  async function scan(root) {
    const books = [];
    const queue = [root.replace(/\/+$/, '') || '/'];
    let dirs = 0;
    while (queue.length) {
      const dir = queue.shift();
      if (++dirs > 500) throw new Error('more than 500 folders; pick a smaller scan folder');
      $('[data-status]').textContent = `Scanning ${dir} … (${books.length} books so far)`;
      for (const e of await listDir(dir)) {
        const path = (dir === '/' ? '' : dir) + '/' + e.name;
        if (e.name.startsWith('.')) continue;               // hidden files and folders
        if (e.isDirectory) {
          if (!SKIP_DIRS.includes(path)) queue.push(path);
        } else if (BOOK.test(e.name)) {
          books.push({ path, dir, name: e.name, size: e.size });
        }
      }
    }
    return books;
  }

  // "Dune (1).epub", "dune.epub", "Dune - copy.EPUB" → "dune.epub".
  // The extension stays part of the key: Dune.epub and Dune.txt are not duplicates.
  const key = (name) => {
    const ext = (name.match(BOOK) || [''])[0].toLowerCase();
    return name.toLowerCase()
      .replace(BOOK, '')
      .replace(/\s*(\(\d+\)|- ?copy|copy)\s*$/g, '')
      .replace(/[^a-z0-9]+/g, '') + ext;
  };

  function report(books) {
    const byDir = new Map();
    for (const b of books) {
      const d = byDir.get(b.dir) || { n: 0, size: 0 };
      d.n++; d.size += b.size; byDir.set(b.dir, d);
    }
    const groups = new Map();
    for (const b of books) (groups.get(key(b.name)) || groups.set(key(b.name), []).get(key(b.name))).push(b);

    duplicates = [];
    const dupRows = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => b.size - a.size);           // keep the biggest copy
      for (const extra of list.slice(1)) duplicates.push(extra.path);
      dupRows.push(`<li><b>${esc(list[0].path)}</b> (kept)<br>` +
        list.slice(1).map((b) => esc(b.path)).join('<br>') + '</li>');
    }

    const total = books.reduce((s, b) => s + b.size, 0);
    $('[data-report]').innerHTML = `
      <p><b>${books.length}</b> books, ${fmt(total)} total.</p>
      <table style="width:100%;border-collapse:collapse">
        ${[...byDir].sort((a, b) => b[1].size - a[1].size).map(([d, v]) =>
          `<tr><td>${esc(d)}</td><td style="text-align:right">${v.n}</td>
               <td style="text-align:right">${fmt(v.size)}</td></tr>`).join('')}
      </table>
      <hr><p><b>${duplicates.length}</b> probable duplicates</p>
      <ul>${dupRows.join('')}</ul>`;
    $('[data-act=move]').disabled = duplicates.length === 0;
  }

  $('[data-act=scan]').onclick = async () => {
    $('[data-act=scan]').disabled = true;
    try {
      const books = await scan($('[data-root]').value.trim() || '/');
      report(books);
      $('[data-status]').textContent = 'Done.';
    } catch (e) {
      $('[data-status]').textContent = 'Error: ' + e.message;
    } finally {
      $('[data-act=scan]').disabled = false;
    }
  };

  $('[data-act=move]').onclick = async () => {
    if (!confirm(`Move ${duplicates.length} files to /Duplicates?`)) return;
    await fetch('/mkdir', { method: 'POST', body: form({ name: 'Duplicates', path: '/' }) });   // fails harmlessly if it exists
    let moved = 0;
    for (const path of duplicates) {
      const r = await fetch('/move', { method: 'POST', body: form({ path, dest: '/Duplicates' }) });
      if (r.ok) moved++;
      $('[data-status]').textContent = `Moved ${moved}/${duplicates.length}`;
    }
    $('[data-status]').textContent += '. Rescan to refresh.';
    $('[data-act=move]').disabled = true;
  };

  // Also usable from scripts (chapter 6): returns only counts, results must stay < 192 bytes.
  api.registerAction('stats', async (args) => {
    const books = await scan(args.root || '/');
    return { books: books.length, bytes: books.reduce((s, b) => s + b.size, 0) };
  });
});
