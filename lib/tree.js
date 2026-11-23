// Builds the browsable tree from docs/ and examples/.
//
// Shape (every level is a folder on the reader):
//   root
//   ├─ 1 Overview / 2 Learn / 3 Tutorials / 5 Reference
//   │    └─ chapter (one .md file)
//   │         └─ section (## heading)
//   │              └─ pages (### headings, cut into small parts)
//   └─ 4 Examples
//        └─ example plugin
//             └─ pages (about, manifest.json, device.json, plugin.js, companions)
//
// The reader sorts an XML folder "folders first, then A-Z" and cannot be told
// otherwise, so every title starts with a two-digit number and the children of
// one folder are either all folders or all pages.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ascii, blocks, cleanTitle, inline, paginate, teaser } from './text.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE_BYTES = 1500; // about one screen of text on a 4" reader

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const pad = (n) => String(n).padStart(2, '0');
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

const dir = (title, children, extra = {}) => ({ type: 'dir', title, children, ...extra });
const page = (title, body, extra = {}) => ({ type: 'page', title, body, ...extra });

// --- Markdown -> sections -------------------------------------------------

// Splits a Markdown file on headings of `level`, ignoring '#' lines in code.
function splitHeadings(md, level) {
  const marker = '#'.repeat(level) + ' ';
  const parts = [{ title: null, md: [] }];
  let fence = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && line.startsWith(marker)) parts.push({ title: line.slice(marker.length).trim(), md: [] });
    else parts[parts.length - 1].md.push(line);
  }
  return parts.map((p) => ({ title: p.title, md: p.md.join('\n') }));
}

const hasText = (md) => blocks(md).length > 0;

// One heading's text -> one or more pages ("Title (1/3)").
function pagesFor(title, md) {
  const parts = paginate(blocks(md), PAGE_BYTES);
  return parts.map((body, i) => page(parts.length > 1 ? `${title} (${i + 1}/${parts.length})` : title, body));
}

// A "## section": its intro plus each "###" becomes pages.
function sectionPages(title, md) {
  const [intro, ...subs] = splitHeadings(md, 3);
  const out = [];
  if (hasText(intro.md)) out.push(...pagesFor(subs.length ? 'Overview' : title, intro.md));
  for (const s of subs) out.push(...pagesFor(cleanTitle(s.title), s.md));
  return out;
}

// One .md file -> a chapter folder of sections.
function chapter(rel, { skip = [] } = {}) {
  const md = read(rel);
  const h1 = md.match(/^# (.*)$/m);
  const body = h1 ? md.replace(h1[0], '') : md;
  const [intro, ...secs] = splitHeadings(body, 2);
  const sections = [];
  if (hasText(intro.md)) sections.push({ title: 'Introduction', pages: pagesFor('Introduction', intro.md) });
  for (const s of secs) {
    const title = cleanTitle(s.title);
    if (skip.includes(title)) continue;
    const pages = sectionPages(title, s.md);
    if (pages.length) sections.push({ title, pages });
  }
  return uniform(cleanTitle(h1 ? h1[1] : path.basename(rel, '.md')), sections, { source: rel, whole: true });
}

// Sections that are all one page become pages directly; otherwise every
// section is a folder (so the reader's folders-first sort keeps the order).
function uniform(title, sections, extra) {
  const flat = sections.every((s) => s.pages.length === 1);
  const children = flat
    ? sections.map((s) => s.pages[0])
    : sections.map((s) => dir(s.title, s.pages));
  return dir(title, children, extra);
}

// --- Examples -------------------------------------------------------------

function exampleRows() {
  // The table in examples/README.md: | [`name`](plugins/name/) | Kind | Runs on | Shows | Companion |
  const rows = {};
  for (const line of read('examples/README.md').split('\n')) {
    const m = line.match(/^\| \[`([a-z0-9-]+)`\]\(plugins\/[^)]*\) \|(.*)\|\s*$/);
    if (!m) continue;
    const [kind, runsOn, shows, companion] = m[2].split('|').map((c) => inline(c.trim()));
    rows[m[1]] = { kind, runsOn, shows, companion };
  }
  return rows;
}

function codePages(title, rel) {
  const code = ascii(read(rel)).replace(/\t/g, '  ').trimEnd();
  const lines = code.split('\n').length;
  const header = `File: ${rel} (${lines} lines)`;
  const parts = paginate([header, ...splitCode(code)], PAGE_BYTES);
  return parts.map((body, i) => page(parts.length > 1 ? `${title} (${i + 1}/${parts.length})` : title, body, {
    info: parts.length > 1 ? `${lines} lines of code, part ${i + 1} of ${parts.length}` : `${lines} lines of code`,
  }));
}

// Cut code at blank lines so pages end between functions where possible.
function splitCode(code) {
  return code.split(/\n\s*\n/).map((b) => b.replace(/^\n+/, ''));
}

function example(name, info) {
  const base = `examples/plugins/${name}`;
  const files = fs.readdirSync(path.join(ROOT, base)).filter((f) => f !== 'README.md');
  const order = ['manifest.json', 'device.json', 'plugin.js'];
  files.sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));

  const about = [];
  if (info) {
    about.push(`Kind: ${info.kind}`, `Runs on: ${info.runsOn}`, `Shows: ${info.shows}`);
    if (info.companion && info.companion !== 'none') about.push(`Companion: ${info.companion}`);
  }
  about.push(`Files: ${files.join(', ')}`);
  const sections = [{ title: 'About', pages: pagesFor('About', about.join('\n\n') + (exists(`${base}/README.md`)
    ? '\n\nREADME SHOWN ON THE READER\n\n' + read(`${base}/README.md`) : '')) }];
  for (const f of files) sections.push({ title: f, pages: codePages(f, `${base}/${f}`) });
  const comp = `examples/companions/${name}`;
  if (exists(comp)) {
    for (const f of fs.readdirSync(path.join(ROOT, comp)).sort()) {
      sections.push({ title: `Companion ${f}`, pages: codePages(`Companion ${f}`, `${comp}/${f}`) });
    }
  }
  // Pages only, numbered in order: an example is read top to bottom.
  return dir(name, sections.flatMap((s) => s.pages), { info: info?.kind });
}

function examples() {
  const rows = exampleRows();
  const names = Object.keys(rows).filter((n) => exists(`examples/plugins/${n}`));
  for (const n of fs.readdirSync(path.join(ROOT, 'examples/plugins')).sort()) if (!names.includes(n)) names.push(n);
  return [chapter('examples/README.md'), ...names.map((n) => example(n, rows[n]))].map((c, i) =>
    (i === 0 ? { ...c, title: 'How to use the examples' } : c));
}

// --- The whole tree -------------------------------------------------------

const ls = (rel) => fs.readdirSync(path.join(ROOT, rel)).filter((f) => f.endsWith('.md')).sort().map((f) => `${rel}/${f}`);

const HOW_TO = `This plugin shows the CrossPoint SD plugin guide as small pages.

Confirm on a folder opens it. Back goes up one level.

Confirm on a page downloads it as a small .txt file to /Books/Plugin Docs. Open it from the Library to read it. Back leaves the page.

Every title starts with a number. Read in number order.

Each chapter has a "Whole chapter" page at the end, if you prefer to read it in one file.

File names start with the page's position (for example 2.04.05.01), so the Library lists downloaded pages in reading order.

The same pages are on the web site this plugin comes from, for reading on a phone or computer.`;

export function buildTree() {
  const docs = ls('docs');
  const learn = docs.filter((f) => /\/0[1-6]-/.test(f));
  const reference = docs.filter((f) => !learn.includes(f));
  const root = dir('CrossPoint Plugin Docs', [
    chapter('README.md', { skip: ['Table of contents'] }),
    dir('Learn', learn.map((f) => chapter(f))),
    dir('Tutorials', ls('docs/tutorials').map((f) => chapter(f))),
    dir('Examples', examples()),
    dir('Reference', reference.map((f) => chapter(f))),
    page('How to use this plugin', HOW_TO),
  ]);
  root.children[0].title = 'Overview';
  finish(root, [], [], []);
  return root;
}

// Numbers, slugs, paths, breadcrumbs, "whole chapter" pages and file names.
function finish(node, slugs, nums, crumbs) {
  node.slugs = slugs;
  node.crumbs = crumbs;
  if (node.type === 'page') return;

  if (node.whole) {
    const all = [];
    collect(node, all, []);
    node.children.push(page('Whole chapter in one file', all.join('\n\n\n'), { number: 99, whole: true }));
  }
  const top = slugs.length === 0;
  node.children.forEach((c, i) => {
    const n = c.number ?? (top ? i + 1 : i + 1);
    c.label = top ? `${n} ${c.title}` : `${pad(n)} ${c.title}`;
    const slug = `${pad(n)}-${slugify(c.title)}`;
    const num = [...nums, top ? String(n) : pad(n)];
    if (c.type === 'page') {
      c.file = `${num.join('.')} ${c.title}`.replace(/[^A-Za-z0-9 ._()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) + '.txt';
    }
    finish(c, [...slugs, slug], num, [...crumbs, c.title]);
  });
  node.children.forEach((c, i) => {
    if (c.type !== 'page') return;
    const next = node.children[i + 1];
    c.next = next?.type === 'page' && !next.whole ? next.label : null;
  });
}

function collect(node, out, trail) {
  for (const c of node.children) {
    if (c.type === 'page') out.push([...trail, c.title].join(' > ').toUpperCase() + '\n\n' + c.body);
    else collect(c, out, [...trail, c.title]);
  }
}

export function countPages(node) {
  return node.type === 'page' ? 1 : node.children.reduce((n, c) => n + countPages(c), 0);
}

// Text of one page as the reader gets it.
export function pageText(p) {
  const lines = [];
  if (p.crumbs.length > 1) lines.push(p.crumbs.slice(0, -1).join(' > '));
  lines.push(p.title.toUpperCase(), '', p.body.replace(/^\n+/, '').trimEnd(), '');
  lines.push(p.next ? `Next: ${p.next}` : 'End of this folder.');
  return lines.join('\n') + '\n';
}

export function find(root, slugs) {
  let node = root;
  for (const s of slugs) {
    node = node.type === 'dir' && node.children.find((c) => c.slugs.at(-1) === s);
    if (!node) return null;
  }
  return node;
}

export function infoFor(node) {
  if (node.type === 'page') return node.info || teaser(node.body);
  const pages = countPages(node);
  const dirs = node.children.filter((c) => c.type === 'dir').length;
  const count = dirs ? `${dirs} ${dirs === 1 ? 'folder' : 'folders'}, ${pages} pages` : `${pages} ${pages === 1 ? 'page' : 'pages'}`;
  return node.info ? `${node.info} - ${count}` : count;
}
