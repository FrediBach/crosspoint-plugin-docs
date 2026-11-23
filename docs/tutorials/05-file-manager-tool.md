# Tutorial 5: A File Manager tool

**You'll build:** a **Library Doctor** card on the File Manager page that scans
the SD card, shows book counts and sizes per folder, finds probable duplicates,
and moves the duplicates into a `/Duplicates` folder with one click.

**You'll learn:** `"mount": "files"`, the same-origin file endpoints
(`/api/files`, `/mkdir`, `/move`), going easy on a small device, and reading an
EPUB with the preloaded JSZip.

## Files

```
/plugins/library-doctor/
├── manifest.json
└── plugin.js
```

### `manifest.json`

```json
{
  "name": "library-doctor",
  "title": "Library Doctor",
  "description": "Book statistics and duplicate finder for the File Manager.",
  "version": "0.1.0",
  "mount": "files"
}
```

`"mount": "files"` puts the card under the file list on `/files`. On `/plugins` it
only gets a small info card.

### `plugin.js`

```js
CrossPoint.registerPlugin((container, api) => {
  const $ = (s) => container.querySelector(s);
  const BOOK = /\.(epub|xtc|txt|md|pdf)$/i;
  const fmt = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB';
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const form = (o) => new URLSearchParams(o);

  container.innerHTML = `
    <h2>Library Doctor</h2>
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
        if (e.isDirectory) {
          if (path !== '/Duplicates') queue.push(path);
        } else if (BOOK.test(e.name)) {
          books.push({ path, dir, name: e.name, size: e.size });
        }
      }
    }
    return books;
  }

  // "Dune (1).epub", "dune.epub", "Dune - copy.EPUB" → "dune"
  const key = (name) => name.toLowerCase()
    .replace(BOOK, '')
    .replace(/\s*(\(\d+\)|- ?copy|copy)\s*$/g, '')
    .replace(/[^a-z0-9]+/g, '');

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
```

## Try it

Upload, open `/files`, scroll below the file list, and click **Scan**.

## Going further: read EPUB metadata with JSZip

On `/files`, JSZip is loaded before your plugin. To compare real titles instead of
file names:

```js
async function epubTitle(path) {
  const buf = await (await fetch('/download?path=' + encodeURIComponent(path))).arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const container = await zip.file('META-INF/container.xml').async('string');
  const opfPath = container.match(/full-path="([^"]+)"/)[1];
  const opf = await zip.file(opfPath).async('string');
  return (opf.match(/<dc:title[^>]*>([^<]*)</) || [])[1] || null;
}
```

This downloads the whole book into the browser, so it's slow over the reader's
Wi-Fi. Use it on demand for a few files, not for a 500-book scan.

## Things to know

- **`/move` and `/rename` only work on files**, and the target folder must exist.
  **`/delete` refuses non-empty folders.**
- Moving an EPUB clears its layout cache, so the book re-paginates the next time it
  is opened. Test what happens to reading progress on your device before you move
  books people are reading.
- Dot-folders are hidden from `/api/files` unless "show hidden files" is on.
  Skip them anyway.
- Don't parallelise requests with `Promise.all`. The reader serves one request at a time.
- Always confirm before destructive actions. Your plugin runs with full access.

Next: [Tutorial 6: Remote control with the job queue](06-job-queue.md).
