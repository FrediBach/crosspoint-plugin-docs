// Markdown -> plain text that reads well on a small e-ink screen.
//
// The reader shows .txt files as typed: every newline is a line break and
// leading spaces are kept (lib/Txt/TxtToHtml.cpp). So paragraphs are joined
// into single lines, tables become short "label: value" lines, and code keeps
// its line breaks with a small indent. Characters that the reader fonts may
// lack (arrows, box drawing) are replaced with ASCII.

const ASCII = {
  '─': '-', '│': '|', '├': '+', '└': '+', '┘': '+', '┐': '+', '┌': '+',
  '→': '->', '←': '<-', '►': '>', '◄': '<', '▲': '^', '▼': 'v',
  '…': '...', '≤': '<=', '≥': '>=', '≠': '!=', '–': '-', '—': '-', '×': 'x',
  '•': '-', '‘': "'", '’': "'", '“': '"', '”': '"', ' ': ' ',
};

export function ascii(s) {
  return s.replace(/[─│├└┘┐┌→←►◄▲▼…≤≥≠–—×•‘’“”\u00a0]/g, (c) => ASCII[c])
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\n\t\x20-\x7e]/g, '?');
}

// Inline Markdown -> plain text.
export function inline(s) {
  return ascii(s)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) =>
      /^https?:/.test(url) && !text.includes(url) ? `${text} (${url})` : text)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,:;!?]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,:;!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1');
}

// Heading text without the docs' own numbering ("4.11a ", "2. ", "Tutorial 3: ").
export function cleanTitle(s) {
  return inline(s)
    .replace(/^Tutorial \d+:\s*/, '')
    .replace(/^\d+(\.\d+)*[a-z]?\.?\s+/, '')
    .replace(/\s+&\s+/g, ' and ')
    .trim();
}

const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|')));

function table(rows) {
  const head = cells(rows[0]);
  const body = rows.slice(1).filter((r) => !isTableSep(r)).map(cells);
  const out = [];
  for (const r of body) {
    if (head.length === 2) {
      out.push(`- ${r[0]}: ${r[1] ?? ''}`);
    } else {
      out.push(`- ${r[0]}`);
      for (let i = 1; i < head.length; i++) {
        if (r[i]) out.push(`  ${head[i] || '-'}: ${r[i]}`);
      }
    }
  }
  return out.join('\n');
}

// Splits Markdown into blocks (paragraphs, lists, code, tables), each already
// converted to text. Blocks are the units pages are split on.
export function blocks(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) out.push(para.map(inline).join('\n'));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^(\s*)(```|~~~)/);
    if (fence) {
      flush();
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[2]); i++) {
        code.push('  ' + ascii(lines[i].slice(fence[1].length)).replace(/\t/g, '  ').trimEnd());
      }
      out.push({ code });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { flush(); continue; }
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { flush(); out.push(inline(h[1]).toUpperCase()); continue; }
    if (isTableRow(line)) {
      flush();
      const rows = [];
      for (; i < lines.length && isTableRow(lines[i]); i++) rows.push(lines[i]);
      i--;
      out.push(table(rows));
      continue;
    }
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const indent = ' '.repeat(Math.min(6, Math.floor(li[1].length / 2) * 2));
      const marker = /\d/.test(li[2]) ? li[2] : '-';
      const task = li[3].replace(/^\[ \]\s*/, '[ ] ').replace(/^\[x\]\s*/i, '[x] ');
      para.push(`${indent}${marker} ${task}`);
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    const text = quote ? quote[1] : line.trim();
    if (para.length && !quote) {
      para[para.length - 1] += ' ' + text; // join wrapped lines into one line
    } else if (para.length && quote && /^\s*>/.test(lines[i - 1])) {
      para[para.length - 1] += ' ' + text;
    } else {
      para.push(text);
    }
  }
  flush();
  // code blocks -> text
  return out.map((b) => (typeof b === 'string' ? b : b.code.join('\n'))).filter((b) => b.trim());
}

// Groups blocks into pages of at most `max` bytes. A block bigger than `max`
// (long code) is cut on line breaks.
export function paginate(blockList, max) {
  const pieces = [];
  for (const b of blockList) {
    if (Buffer.byteLength(b) <= max) { pieces.push(b); continue; }
    let cur = [];
    let size = 0;
    for (const line of b.split('\n')) {
      const n = Buffer.byteLength(line) + 1;
      if (size + n > max && cur.length) { pieces.push(cur.join('\n')); cur = []; size = 0; }
      cur.push(line);
      size += n;
    }
    if (cur.length) pieces.push(cur.join('\n'));
  }
  const pages = [];
  let cur = [];
  let size = 0;
  for (const p of pieces) {
    const n = Buffer.byteLength(p) + 2;
    if (size + n > max && cur.length) { pages.push(cur); cur = []; size = 0; }
    cur.push(p);
    size += n;
  }
  if (cur.length) pages.push(cur);
  return pages.map((p) => p.join('\n\n'));
}

// A one-line teaser for the row subtitle on the reader: the first line of
// prose, skipping headings and code (code lines start with two spaces).
export function teaser(text, max = 80) {
  const lines = text.split('\n');
  const prose = (l) => l.trim() && !/^ {2}/.test(l) && l !== l.toUpperCase() && !/^[\s{}[\]()"',;]+$/.test(l);
  const first = lines.find((l) => prose(l) && !/^File: /.test(l)) || 'Code example';
  const t = first.replace(/^[-\d.)\s]+/, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 3).replace(/\s+\S*$/, '') + '...' : t;
}
