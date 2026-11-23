// Walks the reader catalog the way the firmware does and checks its limits
// (see docs/04-device-catalogs.md 4.11 and docs/07-limits-and-gotchas.md).
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import handler from '../lib/app.js';

let base;
let server;
before(async () => {
  server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = async (url) => {
  const res = await fetch(url);
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
};

// Same rules as the reader: entries by local name, first descendant's text/attribute.
function parse(xml) {
  return [...xml.matchAll(/<entry>(.*?)<\/entry>/g)].map(([, e]) => ({
    title: e.match(/<title>(.*?)<\/title>/)?.[1] ?? '',
    info: e.match(/<info>(.*?)<\/info>/)?.[1] ?? '',
    file: e.match(/<file>(.*?)<\/file>/)?.[1] ?? '',
    href: e.match(/<link href="([^"]*)"\/>/)?.[1] ?? '',
    isDir: e.includes('<folder/>'),
  }));
}

// The firmware's order: folders first, then strcasecmp on the title.
const readerOrder = (a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1)
  : a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0);

test('every folder fits the reader and keeps its order', async () => {
  const files = new Set();
  let pages = 0;
  const queue = [`${base}/cat/index.xml`];
  while (queue.length) {
    const url = queue.shift();
    const res = await get(url);
    assert.equal(res.status, 200, url);
    assert.match(res.type, /xml/);
    assert.ok(!/&/.test(res.text), `no entities at all in ${url}`);
    const rows = parse(res.text);
    assert.ok(rows.length > 0 && rows.length <= 200, `${url}: ${rows.length} entries`);
    const fieldBytes = rows.reduce((n, r) => n + r.title.length + r.info.length + r.file.length + r.href.length, 0);
    assert.ok(fieldBytes < 60 * 1024, `${url}: ${fieldBytes} bytes of fields`);

    const sorted = [...rows].sort(readerOrder);
    assert.deepEqual(sorted.map((r) => r.title), rows.map((r) => r.title), `${url}: reader sort changes the order`);

    for (const r of rows) {
      assert.ok(r.title && r.href, `${url}: empty title or link`);
      for (const f of ['title', 'info', 'file', 'href']) assert.ok(r[f].length <= 768, `${url}: ${f} too long`);
      const next = new URL(r.href, url).href;
      if (r.isDir) {
        assert.ok(r.href.endsWith('/index.xml'));
        queue.push(next);
      } else {
        assert.ok(r.href.endsWith('.txt'), 'matches device.json "extensions"');
        assert.ok(Buffer.byteLength(r.file) <= 100 && /^[A-Za-z0-9 ._()-]+\.txt$/.test(r.file), r.file);
        assert.ok(!files.has(r.file), `duplicate file name ${r.file}`);
        files.add(r.file);
        const page = await get(next);
        assert.equal(page.status, 200, next);
        assert.match(page.type, /text\/plain/);
        assert.ok(/^[\x0a\x20-\x7e]*$/.test(page.text), `${next}: only printable ASCII`);
        pages++;
      }
    }
  }
  assert.ok(pages > 100, `${pages} pages`);
});

test('pages are small, except the whole-chapter files', async () => {
  const { buildTree, pageText } = await import('../lib/tree.js');
  const walk = (n) => (n.type === 'page' ? [n] : n.children.flatMap(walk));
  for (const p of walk(buildTree())) {
    if (p.whole) continue;
    assert.ok(Buffer.byteLength(pageText(p)) <= 2048, `${p.file}: ${Buffer.byteLength(pageText(p))} bytes`);
  }
});

test('plugin files are valid and small', async () => {
  const device = JSON.parse((await get(`${base}/plugin/device.json`)).text);
  assert.equal(device.browse.url, `${base}/cat/index.xml`);
  assert.ok(JSON.stringify(device).length < 8192);
  const manifest = JSON.parse((await get(`${base}/plugin/manifest.json`)).text);
  assert.equal(manifest.name, 'plugin-docs');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const zip = await fetch(`${base}/plugin/plugin-docs.zip`);
  assert.equal(zip.status, 200);
  assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(0), 0x04034b50);
});

test('web pages and unknown paths', async () => {
  assert.equal((await get(`${base}/`)).status, 200);
  assert.equal((await get(`${base}/docs/`)).status, 200);
  assert.equal((await get(`${base}/docs/02-learn/`)).status, 200);
  assert.equal((await get(`${base}/docs/nope/`)).status, 404);
  assert.equal((await get(`${base}/cat/%2e%2e/index.xml`)).status, 404);
  assert.equal((await get(`${base}/cat/02-learn.txt`)).status, 404);
});
