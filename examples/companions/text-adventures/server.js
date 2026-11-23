// Text adventure server for the CrossPoint "text-adventures" example plugin.
//
//   node server.js            (PORT=8095, GAMES_DIR=./games, DATA_DIR=./data)
//
// Put .z3/.z5/.z8 (or .zblorb) files into games/ (see fetch-games.sh). The server
// runs the games itself (zmachine.js) and turns every turn into catalog rows for
// the reader:
//
//   GET /games                         list picker: one list per game
//   GET /s/<session>/view?game=<id>    the current turn as rows (sets the active game)
//   GET /s/<session>/cmd?q=<text>      Search box = type a command; answers with rows
//   GET /s/<session>/do?g=&t=&c=       a quick-command row's Details page (HTML)
//   GET /s/<session>/out?g=&t=         a past turn's text (HTML)
//   GET /s/<session>/transcript.txt    the Fetch button: the whole game as a .txt
//
// Every request loads the game state from DATA_DIR, runs one command and saves it
// again. Nothing is kept in memory between requests except the story files.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ZMachine, ZError } from './zmachine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8095;
const GAMES_DIR = path.resolve(process.env.GAMES_DIR || path.join(here, 'games'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(here, 'data'));

const HISTORY = 30;            // past turns kept for /out
const DETAILS_MAX = 20 * 1024; // the reader accepts 24 KB for a Details page
const EXCERPT = 160;           // characters of output under the first row
const MAX_OBJECTS = 6;         // "examine X" rows
const DIRECTIONS = ['north', 'south', 'east', 'west', 'northeast', 'northwest',
  'southeast', 'southwest', 'up', 'down', 'in', 'out'];

// ------------------------------------------------------------------ games

function readStory(file) {
  const data = fs.readFileSync(file);
  if (!/\.(zblorb|zlb|blorb|blb)$/i.test(file)) return new Uint8Array(data);
  // Blorb: IFF "FORM....IFRS", take the first ZCOD chunk.
  if (data.toString('latin1', 0, 4) !== 'FORM' || data.toString('latin1', 8, 12) !== 'IFRS') {
    throw new Error('not a Blorb file');
  }
  for (let at = 12; at + 8 <= data.length;) {
    const type = data.toString('latin1', at, at + 4);
    const len = data.readUInt32BE(at + 4);
    if (type === 'ZCOD') return new Uint8Array(data.subarray(at + 8, at + 8 + len));
    at += 8 + len + (len & 1);
  }
  throw new Error('no Z-code inside this Blorb file');
}

let gameCache = null;
function games() {
  if (gameCache) return gameCache;
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, 'games.json'), 'utf8')); } catch { /* optional */ }
  const list = new Map();
  let files = [];
  try { files = fs.readdirSync(GAMES_DIR); } catch { /* no games yet */ }
  for (const f of files.sort()) {
    if (!/\.(z[345678]|zblorb|zlb)$/i.test(f)) continue;
    const id = f.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    try {
      const story = readStory(path.join(GAMES_DIR, f));
      if (![3, 4, 5, 7, 8].includes(story[0])) { console.warn(`skip ${f}: version ${story[0]}`); continue; }
      const m = meta[id] || {};
      list.set(id, { id, file: f, story, title: m.title || f.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') });
    } catch (e) {
      console.warn(`skip ${f}: ${e.message}`);
    }
  }
  gameCache = list;
  return list;
}

// ------------------------------------------------------------------ state

const validSession = (s) => /^[A-Za-z0-9_-]{8,64}$/.test(s);
const sessionDir = (sid) => path.join(DATA_DIR, sid);
const stateFile = (sid, gid) => path.join(sessionDir(sid), gid + '.json');
const transcriptFile = (sid, gid) => path.join(sessionDir(sid), gid + '.txt');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function activeGame(sid, requested) {
  const all = games();
  const file = path.join(sessionDir(sid), 'active.json');
  if (requested && all.has(requested)) {
    writeJson(file, { game: requested });
    return requested;
  }
  const saved = readJson(file, {}).game;
  if (saved && all.has(saved)) return saved;
  return all.keys().next().value || null;
}

// One request per session at a time: a turn is load → run → save.
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

function machineFor(game, state) {
  const m = ZMachine.restore(game.story, state.snap);
  m.undoState = state.undo || null;
  m.saveSlot = state.slot || null;
  return m;
}

function cleanOutput(text) {
  return text.replace(/\r/g, '').replace(/\n?>\s*$/, '').replace(/^\n+/, '').replace(/\s+$/, '');
}

function location(m) {
  try {
    const loc = m.rw(m.globals); // global 0: the location in Infocom and Inform games
    if (loc > 0 && m.objectName(loc)) return loc;
  } catch { /* not an object */ }
  return 0;
}

function record(state, m, cmd, r, game) {
  let output = cleanOutput(r.output);
  if (r.quit) output += '\n\n[The game has ended. Pick "Start over" to play again.]';
  const loc = location(m);
  const entry = {
    turn: state.turn,
    cmd,
    output,
    status: m.upperText().join(' · '),
    place: loc ? m.objectName(loc) : '',
  };
  state.snap = m.snapshot();
  state.undo = m.undoState;
  state.slot = m.saveSlot;
  state.waiting = r.waiting;
  state.quit = r.quit;
  state.history = [...(state.history || []), entry].slice(-HISTORY);
  state.exits = null; // computed lazily for the current turn
  return entry;
}

function newGame(sid, game) {
  const m = new ZMachine(game.story, { seed: crypto.randomInt(1, 2 ** 31) });
  const r = m.run();
  const state = { game: game.id, turn: 0, history: [] };
  const entry = record(state, m, '', r, game);
  fs.mkdirSync(sessionDir(sid), { recursive: true });
  fs.writeFileSync(transcriptFile(sid, game.id), `${game.title}\n\n${r.output}`);
  writeJson(stateFile(sid, game.id), state);
  return { state, entry };
}

function loadOrStart(sid, game) {
  const state = readJson(stateFile(sid, game.id), null);
  if (state && state.snap) return state;
  return newGame(sid, game).state;
}

// Runs one command. Special commands: "#restart", "#key" (Enter for a key prompt).
function play(sid, game, cmd) {
  cmd = String(cmd || '').trim().slice(0, 120);
  if (cmd === '#restart') return newGame(sid, game).entry;
  const state = loadOrStart(sid, game);
  if (state.quit) return { ...state.history[state.history.length - 1], cmd };
  const m = machineFor(game, state);
  let r;
  try {
    r = cmd === '#key' || (state.waiting === 'key' && !cmd) ? m.sendKey('\n') : m.sendLine(cmd);
  } catch (e) {
    if (!(e instanceof ZError)) throw e;
    console.error(`[${game.id}] ${e.message}`);
    return { turn: state.turn, cmd, output: `[Interpreter error: ${e.message}]`, status: '', place: '' };
  }
  state.turn++;
  const shown = cmd === '#key' ? '' : cmd;
  const entry = record(state, m, shown, r, game);
  writeJson(stateFile(sid, game.id), state);
  fs.appendFileSync(transcriptFile(sid, game.id), shown + '\n' + r.output);
  return entry;
}

// Which directions lead somewhere? Try each one on a throwaway copy of the
// game and see whether the location changes. Also finds the player object
// (the one that moved along), so it isn't offered as "examine yourself".
function survey(game, state) {
  if (state.exits) return state.exits;
  const m = machineFor(game, state);
  const loc = location(m);
  const result = { exits: [], objects: [] };
  if (!loc || state.waiting !== 'line' || state.quit) return (state.exits = result);
  const children = (mm, o) => {
    const list = [];
    for (let c = mm.child(o), n = 0; c && n < 100; c = mm.sibling(c), n++) list.push(c);
    return list;
  };
  const here = children(m, loc);
  let moved = null; // objects that came along on every move: the player (and floating scenery)
  for (const dir of DIRECTIONS) {
    try {
      const probe = machineFor(game, state);
      probe.undoState = null;
      probe.saveSlot = null;
      const r = probe.sendLine(dir);
      const now = location(probe);
      if (!r.quit && now && now !== loc) {
        result.exits.push(dir);
        const along = children(probe, now).filter((c) => here.includes(c));
        moved = moved ? moved.filter((c) => along.includes(c)) : along;
      }
    } catch { /* a probe that crashes is just not an exit */ }
  }
  const player = moved && moved.length === 1 ? moved[0] : 0;
  const skip = /^(\(.*\)|yourself|you|me|myself|self|player|darkness)$/i;
  for (const o of here) {
    if (o === player) continue;
    const name = m.objectName(o).trim();
    if (!name || name.length > 30 || skip.test(name) || /[^\x20-\x7e -ɏ]/.test(name)) continue;
    result.objects.push(name.toLowerCase());
    if (result.objects.length >= MAX_OBJECTS) break;
  }
  state.exits = result;
  return result;
}

// ------------------------------------------------------------------ rows

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function excerpt(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT ? flat.slice(0, EXCERPT - 1).replace(/\s+\S*$/, '') + ' …' : flat;
}

function rowsFor(sid, game, state) {
  const last = state.history[state.history.length - 1];
  const base = `/s/${sid}`;
  const g = encodeURIComponent(game.id);
  const rows = [{
    title: last.place || last.status || game.title,
    sub: excerpt(last.output) || '(no text)',
    id: `out-${last.turn}`,
    details: `${base}/out?g=${g}&t=${last.turn}`,
    fmt: 'html',
  }];
  const cmdRow = (label, cmd) => rows.push({
    title: label,
    id: `do-${state.turn}-${cmd}`,
    details: `${base}/do?g=${g}&t=${state.turn}&c=${encodeURIComponent(cmd)}`,
    fmt: 'html',
  });

  if (state.quit) {
    cmdRow('Start over', '#restart');
  } else if (state.waiting === 'key') {
    cmdRow('Continue (press Enter)', '#key');
    for (const k of ['y', 'n', 'q']) cmdRow(`Press "${k}"`, k);
  } else {
    const { exits, objects } = survey(game, state);
    const dirs = exits.length ? exits : DIRECTIONS.slice(0, 4);
    for (const d of dirs) cmdRow(`> ${d}`, d);
    cmdRow('> look', 'look');
    cmdRow('> inventory', 'inventory');
    for (const o of objects) cmdRow(`> examine ${o}`, `examine ${o}`);
    cmdRow('> wait', 'wait');
    cmdRow('> again', 'again');
    cmdRow('> undo', 'undo');
    if (!exits.length) for (const d of DIRECTIONS.slice(4)) cmdRow(`> ${d}`, d);
    cmdRow('Start over', '#restart');
  }
  return { rows };
}

function entryHtml(game, entry, note) {
  let text = entry.output || '(no text)';
  if (text.length > DETAILS_MAX) text = '…' + text.slice(-DETAILS_MAX);
  const paras = text.split(/\n{2,}/).map((p) => `<p>${p.split('\n').map(esc).join('<br/>')}</p>`).join('\n');
  const head = entry.status ? `<p><i>${esc(entry.status)}</i></p>\n` : '';
  const cmd = entry.cmd ? `<p><b>&gt; ${esc(entry.cmd)}</b></p>\n` : '';
  return `<html><body>${head}${cmd}${paras}${note ? `\n<p><i>${esc(note)}</i></p>` : ''}</body></html>`;
}

const NOT_SET_UP = { rows: [{
  title: 'Not set up yet',
  sub: 'Open the Plugins page in the reader\'s web UI, enter this server\'s address and press Save.',
  id: 'setup',
}] };

const NO_GAMES = { rows: [{ title: 'No games on the server', sub: `Put .z5/.z8 files into ${GAMES_DIR}`, id: 'none' }] };

// ------------------------------------------------------------------ http

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const q = (k) => url.searchParams.get(k) || '';
  const parts = url.pathname.split('/').filter(Boolean);
  console.log(new Date().toISOString(), req.method, url.pathname + url.search);

  if (url.pathname === '/' || url.pathname === '/health') {
    const list = [...games().values()].map((g) => `  ${g.id}  (${g.title}, v${g.story[0]})`).join('\n');
    return send(res, 200, `Text adventure server: ${games().size} game(s)\n${list}\n`, 'text/plain; charset=utf-8');
  }
  if (url.pathname === '/games') {
    const lists = [...games().values()].slice(0, 64).map((g) => ({ title: g.title, id: g.id }));
    return send(res, 200, { lists });
  }
  if (parts[0] !== 's' || parts.length !== 3) return send(res, 404, { error: 'not found' });

  const [, sid, action] = parts;
  if (!validSession(sid)) {
    return action === 'view' || action === 'cmd' ? send(res, 200, NOT_SET_UP) : send(res, 400, { error: 'bad session' });
  }
  const all = games();
  const gid = activeGame(sid, q('game') || q('g'));
  if (!gid) return action === 'view' || action === 'cmd' ? send(res, 200, NO_GAMES) : send(res, 404, { error: 'no games' });
  const game = all.get(gid);

  return withLock(sid, () => {
    switch (action) {
      case 'view': {
        const state = loadOrStart(sid, game);
        const rows = rowsFor(sid, game, state);
        writeJson(stateFile(sid, gid), state); // keeps the survey for this turn
        return send(res, 200, rows);
      }
      case 'cmd': { // Search
        play(sid, game, q('q'));
        const state = loadOrStart(sid, game);
        state.lastKey = null;
        const rows = rowsFor(sid, game, state);
        writeJson(stateFile(sid, gid), state);
        return send(res, 200, rows);
      }
      case 'do': {
        // A row was opened. Rows carry the turn they were made for, so opening
        // the same row again shows the same answer instead of playing it twice.
        const key = `${q('t')}|${q('c')}`;
        const state = loadOrStart(sid, game);
        if (state.lastKey === key) {
          const last = state.history[state.history.length - 1];
          return send(res, 200, entryHtml(game, last, 'Shown again. Type a command with Search to repeat it.'), 'text/html; charset=utf-8');
        }
        const entry = play(sid, game, q('c'));
        const after = loadOrStart(sid, game);
        after.lastKey = key;
        writeJson(stateFile(sid, gid), after);
        const stale = Number(q('t')) !== state.turn;
        return send(res, 200, entryHtml(game, entry, stale ? 'Older command list: go Back and pick the game again to refresh it.' : ''), 'text/html; charset=utf-8');
      }
      case 'out': {
        const state = loadOrStart(sid, game);
        const t = Number(q('t'));
        const entry = state.history.find((h) => h.turn === t) || state.history[state.history.length - 1];
        return send(res, 200, entryHtml(game, entry), 'text/html; charset=utf-8');
      }
      case 'transcript.txt': {
        loadOrStart(sid, game);
        let text = '';
        try { text = fs.readFileSync(transcriptFile(sid, gid), 'utf8'); } catch { /* new game */ }
        return send(res, 200, text, 'text/plain; charset=utf-8');
      }
      default:
        return send(res, 404, { error: 'not found' });
    }
  });
}

export function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: String(e.message || e) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, () => {
    console.log(`Text adventures on http://0.0.0.0:${PORT}/  games: ${GAMES_DIR}  saves: ${DATA_DIR}`);
    if (!games().size) console.log('No games yet. Run ./fetch-games.sh or copy .z5/.z8 files into games/.');
  });
}
