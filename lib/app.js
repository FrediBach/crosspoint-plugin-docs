// One request handler for the local server (server.js) and Vercel (api/index.js).
//
//   /cat/index.xml               reader catalog root (XML, one file per folder)
//   /cat/<slug>/.../index.xml    a folder
//   /cat/<slug>/.../<slug>.txt   a page, as the reader downloads it
//   /                            web frontend: install instructions
//   /docs/<slug>/...             web frontend: the same tree for phones and computers
//   /plugin/<file>               the plugin files, with this server's URL filled in

import zlib from 'node:zlib';
import { buildTree, countPages, find, infoFor, pageText } from './tree.js';

const PLUGIN_ID = 'plugin-docs'; // folder name on the SD card (<= 23 bytes)
const VERSION = '1.0.0';
const DEST_DIR = '/Books/Plugin Docs';

let tree;
const getTree = () => (tree ??= buildTree());

// --- helpers --------------------------------------------------------------

const html = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Reader-facing XML text avoids entities altogether: it is not verified that
// the firmware's streaming XML parser decodes them.
const xmlText = (s) => s.replace(/->/g, 'to').replace(/<=/g, 'max').replace(/>=/g, 'min')
  .replace(/&/g, 'and').replace(/[<>]/g, '').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
const xmlEscape = (s) => html(xmlText(s));

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    // Content only changes on deploy; Vercel's CDN cache is cleared on every deploy.
    'Cache-Control': status === 200 ? 'public, max-age=300, s-maxage=86400' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(body);
}

const notFound = (res) => send(res, 404, 'text/plain; charset=utf-8', 'Not found\n');

// --- reader catalog -------------------------------------------------------

function catalogXml(dir) {
  // Links are relative to this folder's index.xml; the reader resolves them
  // ("resolve_urls": true), so the same tree works on any host.
  const rows = dir.children.map((c) => {
    const slug = c.slugs.at(-1);
    const info = xmlEscape(infoFor(c));
    const title = xmlEscape(c.label);
    if (c.type === 'dir') {
      return `  <entry><title>${title}</title><info>${info}</info><link href="${slug}/index.xml"/><folder/></entry>`;
    }
    return `  <entry><title>${title}</title><info>${info}</info><file>${xmlEscape(c.file)}</file><link href="${slug}.txt"/></entry>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<catalog>\n${rows.join('\n')}\n</catalog>\n`;
}

function serveCatalog(res, rest) {
  if (rest.at(-1) === 'index.xml') {
    const node = find(getTree(), rest.slice(0, -1));
    if (!node || node.type !== 'dir') return notFound(res);
    return send(res, 200, 'application/xml; charset=utf-8', catalogXml(node));
  }
  const last = rest.at(-1) || '';
  if (!last.endsWith('.txt')) return notFound(res);
  const node = find(getTree(), [...rest.slice(0, -1), last.slice(0, -4)]);
  if (!node || node.type !== 'page') return notFound(res);
  return send(res, 200, 'text/plain; charset=utf-8', pageText(node), {
    'Content-Disposition': `inline; filename="${node.file.replace(/"/g, '')}"`,
  });
}

// --- plugin files ---------------------------------------------------------

function pluginFiles(base) {
  const manifest = {
    name: PLUGIN_ID,
    title: 'Plugin Docs',
    description: 'The CrossPoint SD plugin guide, in small pages.',
    author: 'CrossPoint plugin docs',
    version: VERSION,
    files: ['manifest.json', 'device.json', 'README.md'],
  };
  const device = {
    title: 'Plugin Docs',
    description: 'The CrossPoint SD plugin guide, in small pages.',
    browse: {
      format: 'xml',
      url: `${base}/cat/index.xml`,
      item: 'entry',
      container_element: 'folder',
      resolve_urls: true,
      extensions: ['.txt'],
      fields: { title: 'title', author: 'info', id: 'file', url: 'link@href' },
    },
    download: { url: '{url}', dest_dir: DEST_DIR, filename: '{id}' },
  };
  const readme = `PLUGIN DOCS

Browse the CrossPoint SD plugin guide on the reader.

Confirm opens a folder or downloads a page. Back goes up.
Pages are saved to ${DEST_DIR}. Open them from the Library.

Source: ${base}/
`;
  return {
    'manifest.json': JSON.stringify(manifest, null, 2) + '\n',
    'device.json': JSON.stringify(device, null, 2) + '\n',
    'README.md': readme,
  };
}

// A minimal stored (uncompressed) ZIP: the three files in a plugin-docs/ folder.
function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const fname = Buffer.from(name);
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(fname.length, 26);
    local.push(head, fname, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(fname.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, fname);
    offset += head.length + fname.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cdBuf, end]);
}

function servePlugin(req, res, file) {
  const files = pluginFiles(baseUrl(req));
  if (file === `${PLUGIN_ID}.zip`) {
    const entries = Object.fromEntries(Object.entries(files).map(([n, t]) => [`${PLUGIN_ID}/${n}`, t]));
    const body = zip(entries);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': body.length,
      'Content-Disposition': `attachment; filename="${PLUGIN_ID}.zip"`,
      'Cache-Control': 'no-cache',
    });
    return res.end(body);
  }
  if (!files[file]) return notFound(res);
  const type = file.endsWith('.json') ? 'application/json' : 'text/plain';
  return send(res, 200, `${type}; charset=utf-8`, files[file], { 'Cache-Control': 'no-cache' });
}

// --- web frontend ---------------------------------------------------------

const CSS = `
:root{--bg:#fff;--fg:#111;--muted:#555;--line:#ddd;--accent:#0b57d0;--code:#f4f4f4}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111;--fg:#eee;--muted:#aaa;--line:#333;--accent:#8ab4f8;--code:#1c1c1c}}
:root[data-theme="dark"]{--bg:#111;--fg:#eee;--muted:#aaa;--line:#333;--accent:#8ab4f8;--code:#1c1c1c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:44rem;margin:0 auto;padding:1.25rem 16px 3rem}
a{color:var(--accent)}
h1{font-size:1.5rem;line-height:1.25;margin:.5rem 0 1rem}
h2{font-size:1.1rem;margin:2rem 0 .5rem}
nav.crumbs{font-size:.9rem;color:var(--muted)}
nav.crumbs a{color:var(--muted)}
ul.list{list-style:none;padding:0;margin:0;border-top:1px solid var(--line)}
ul.list li{border-bottom:1px solid var(--line)}
ul.list a{display:block;padding:.65rem .25rem;text-decoration:none;color:var(--fg)}
ul.list a:hover{background:var(--code)}
ul.list .t{display:block;font-weight:600}
ul.list .i{display:block;color:var(--muted);font-size:.9rem}
ul.list .dir .t::after{content:" \\203A";color:var(--muted)}
pre{background:var(--code);padding:1rem;overflow-x:auto;font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;border-radius:6px}
pre.page{white-space:pre-wrap;word-wrap:break-word}
code{font:14px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);padding:.1em .3em;border-radius:3px}
.pager{display:flex;justify-content:space-between;gap:1rem;margin-top:1.5rem;font-size:.95rem}
.muted{color:var(--muted)}
.btn{display:inline-block;padding:.55rem 1rem;border:1px solid var(--accent);border-radius:6px;text-decoration:none;font-weight:600}
`;

function layout(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(title)}</title>
<style>${CSS}</style></head>
<body><main>${body}</main></body></html>
`;
}

const webPath = (node) => '/docs/' + node.slugs.join('/') + (node.type === 'dir' && node.slugs.length ? '/' : '');

function crumbs(node) {
  const parts = [`<a href="/">Home</a>`, `<a href="/docs/">Docs</a>`];
  let n = getTree();
  for (const s of node.slugs.slice(0, -1)) {
    n = n.children.find((c) => c.slugs.at(-1) === s);
    parts.push(`<a href="${webPath(n)}">${html(n.title)}</a>`);
  }
  return `<nav class="crumbs">${parts.join(' / ')}</nav>`;
}

function webDir(node) {
  const items = node.children.map((c) => `<li class="${c.type}"><a href="${webPath(c)}">` +
    `<span class="t">${html(c.label)}</span><span class="i">${html(infoFor(c))}</span></a></li>`).join('\n');
  const title = node.slugs.length ? node.title : 'All docs';
  return layout(`${title} - Plugin Docs`, `${crumbs(node)}<h1>${html(title)}</h1><ul class="list">${items}</ul>`);
}

function webPage(node) {
  const parent = find(getTree(), node.slugs.slice(0, -1));
  const i = parent.children.indexOf(node);
  const prev = parent.children[i - 1];
  const next = parent.children[i + 1];
  const link = (n, label) => (n && n.type === 'page' ? `<a href="${webPath(n)}">${label}</a>` : '<span></span>');
  return layout(`${node.title} - Plugin Docs`, `${crumbs(node)}
<h1>${html(node.label)}</h1>
<pre class="page">${html(node.body.replace(/^\n+/, '').trimEnd())}</pre>
<div class="pager">${link(prev, '&lsaquo; Previous')}<a href="/cat/${node.slugs.join('/')}.txt">Reader file (.txt)</a>${link(next, 'Next &rsaquo;')}</div>`);
}

function home(req) {
  const base = baseUrl(req);
  const root = getTree();
  const device = pluginFiles(base)['device.json'];
  const sections = root.children.filter((c) => c.type === 'dir').map((c) =>
    `<li class="dir"><a href="${webPath(c)}"><span class="t">${html(c.label)}</span><span class="i">${html(infoFor(c))}</span></a></li>`).join('\n');
  return layout('Plugin Docs', `
<h1>CrossPoint Plugin Docs</h1>
<p>The CrossPoint SD plugin guide and its examples as a catalog for your e-reader:
${countPages(root)} pages of about one screen each, in nested folders. Every page is a small plain-text file.</p>
<p><a class="btn" href="/plugin/${PLUGIN_ID}.zip">Download the plugin (.zip)</a></p>

<h2>Install</h2>
<ol>
<li>Unzip it. You get a folder <code>${PLUGIN_ID}/</code> with <code>manifest.json</code>, <code>device.json</code> and <code>README.md</code>.</li>
<li>Copy that folder to <code>/plugins/</code> on the SD card, or upload the three files to <code>/plugins/${PLUGIN_ID}/</code> with the reader's File Manager.</li>
<li>On the reader: <b>Settings &rarr; Connectivity &rarr; Plugins &rarr; Enabled</b>, then <b>Home &rarr; Plugins &rarr; Plugin Docs</b>.</li>
</ol>

<h2>On the reader</h2>
<ul>
<li><b>Confirm</b> on a folder opens it. <b>Back</b> goes up.</li>
<li><b>Confirm</b> on a page downloads it to <code>${DEST_DIR}</code>. Open it from the Library.</li>
<li>Titles are numbered because the reader sorts each folder A to Z. File names carry the full position (for example <code>2.04.05.01</code>), so the Library lists pages in reading order.</li>
<li>Each chapter ends with a <i>Whole chapter in one file</i> page.</li>
</ul>

<h2>Read here</h2>
<ul class="list">${sections}</ul>

<h2>device.json</h2>
<p class="muted">Already filled in for this server (<a href="/plugin/device.json">raw</a>).</p>
<pre>${html(device)}</pre>`);
}

function serveWeb(req, res, rest) {
  const trailing = rest.length && rest.at(-1) === '';
  const slugs = rest.filter(Boolean);
  const node = find(getTree(), slugs);
  if (!node) return notFound(res);
  if (node.type === 'dir' && slugs.length && !trailing) {
    res.writeHead(301, { Location: webPath(node) });
    return res.end();
  }
  return send(res, 200, 'text/html; charset=utf-8', node.type === 'dir' ? webDir(node) : webPage(node));
}

// --- router ---------------------------------------------------------------

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed\n', { Allow: 'GET, HEAD' });
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return notFound(res);
  }
  const [first, ...rest] = pathname.split('/').slice(1);
  try {
    if (pathname === '/') return send(res, 200, 'text/html; charset=utf-8', home(req));
    if (first === 'cat') return serveCatalog(res, rest);
    if (first === 'docs') return serveWeb(req, res, rest.length ? rest : ['']);
    if (first === 'plugin' && rest.length === 1) return servePlugin(req, res, rest[0]);
    if (pathname === '/favicon.ico') return send(res, 204, 'text/plain', '');
    return notFound(res);
  } catch (e) {
    console.error(e);
    return send(res, 500, 'text/plain; charset=utf-8', 'Server error\n');
  }
}
