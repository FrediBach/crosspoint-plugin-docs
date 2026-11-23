// A small Z-machine interpreter (versions 3, 4, 5, 7 and 8), no dependencies.
//
// It is built for a turn-based web server, not for a terminal:
//   - run() executes until the game wants input, then returns the text it printed.
//   - sendLine() / sendKey() hand over the player's input and keep running.
//   - snapshot() / ZMachine.restore() turn the whole machine state into JSON, so the
//     server can keep nothing in memory between requests.
//
// Screen model: the lower window becomes plain text. The upper window (status line,
// quote boxes) is kept as a small character grid that the server reads separately.
// Not supported: version 6 graphics, sound, timed input, mouse, menus.
//
// Spec: https://inform-fiction.org/zmachine/standards/z1point1/index.html

const A0 = 'abcdefghijklmnopqrstuvwxyz';
const A1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const A2 = ' \n0123456789.,!?_#\'"/\\-:()'; // index 0 = 10-bit escape, 1 = newline

// ZSCII 155..223, the default Unicode translation table (spec 3.8.5.3).
const DEFAULT_EXTRA = 'äöüÄÖÜß»«ëïÿËÏáéíóúýÁÉÍÓÚÝàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛåÅøØãñõÃÑÕæÆçÇþðÞÐ£œŒ¡¿';

const MAX_STEPS = 20_000_000; // per run(); protects the server from a looping game

export class ZError extends Error {}

const s16 = (v) => (v & 0x8000 ? (v & 0xffff) - 0x10000 : v & 0xffff);
const u16 = (v) => v & 0xffff;

export class ZMachine {
  constructor(story, opts = {}) {
    this.story = story instanceof Uint8Array ? story : new Uint8Array(story);
    this.version = this.story[0];
    if (![3, 4, 5, 7, 8].includes(this.version)) {
      throw new ZError(`Z-machine version ${this.version} is not supported`);
    }
    this.screenWidth = opts.width || 60;
    this.reset();
    this.seed(opts.seed ?? Date.now());
  }

  // ---------------------------------------------------------------- setup

  reset() {
    const keepFlags2 = this.mem ? this.mem[0x11] & 0x03 : 0;
    this.mem = new Uint8Array(this.story);
    this.view = new DataView(this.mem.buffer);
    this.dynamicSize = this.rw(0x0e);
    this.stack = [];
    this.frames = [];      // {ret, store, locals, argc, base}
    this.pc = this.rw(0x06);
    this.out = [];         // lower-window text of the current run
    this.mem3 = [];        // output stream 3 stack: {table, len}
    this.screenOn = true;  // output stream 1
    this.upperHeight = 0;
    this.upper = [];       // rows of characters
    this.window = 0;
    this.cursor = { row: 1, col: 1 };
    this.waiting = null;   // {kind:'line'|'key', ...operands}
    this.quit = false;
    this.undoState = null;
    this.setupHeader();
    this.mem[0x11] = (this.mem[0x11] & ~0x03) | keepFlags2;
    this.loadTables();
  }

  setupHeader() {
    const v = this.version;
    if (v <= 3) {
      // bit 4: status line NOT available (clear), bit 5: split screen available
      this.mem[0x01] = (this.mem[0x01] & ~0x70) | 0x20;
    } else {
      // bold, italic, fixed font; no colours, pictures, sound or timed input
      this.mem[0x01] = (this.mem[0x01] & ~0xbf) | 0x1c;
      this.mem[0x1e] = 6;      // interpreter number: IBM PC
      this.mem[0x1f] = 0x41;   // version 'A'
      this.mem[0x20] = 255;    // screen height: infinite
      this.mem[0x21] = this.screenWidth;
    }
    if (v >= 5) {
      this.ww(0x22, this.screenWidth);
      this.ww(0x24, 255);
      this.mem[0x26] = 1;
      this.mem[0x27] = 1;
      this.mem[0x2c] = 1;      // default colours
      this.mem[0x2d] = 1;
      // flags 2: we can't do pictures, mouse, colours, sound or menus. Undo works.
      this.ww(0x10, this.rw(0x10) & ~(0x08 | 0x20 | 0x40 | 0x80 | 0x100));
    }
    this.ww(0x32, 0x0101);     // standard 1.1
  }

  loadTables() {
    const v = this.version;
    this.abbrevs = this.rw(0x18);
    this.objects = this.rw(0x0a);
    this.globals = this.rw(0x0c);
    this.dictionary = this.rw(0x08);
    this.routineOffset = v === 7 ? this.rw(0x28) * 8 : 0;
    this.stringOffset = v === 7 ? this.rw(0x2a) * 8 : 0;
    this.packScale = v <= 3 ? 2 : v <= 7 ? 4 : 8;

    this.alphabets = [A0, A1, A2];
    const custom = v >= 5 ? this.rw(0x34) : 0;
    if (custom) {
      const read = (base) => Array.from({ length: 26 }, (_, i) => this.zsciiToChar(this.mem[custom + base + i])).join('');
      this.alphabets = [read(0), read(26), ' \n' + read(52).slice(2)];
    }

    this.extra = DEFAULT_EXTRA.split('');
    const ext = v >= 5 ? this.rw(0x36) : 0;
    if (ext && this.rw(ext) >= 3) {
      const table = this.rw(ext + 6);
      if (table) {
        const n = this.mem[table];
        this.extra = Array.from({ length: n }, (_, i) => String.fromCodePoint(this.rw(table + 1 + 2 * i)));
      }
    }
    this.unicodeToZscii = new Map(this.extra.map((ch, i) => [ch, 155 + i]));
  }

  seed(n) {
    // xorshift32; the state lives in the snapshot so restores replay the same way
    this.rng = (Number(n) >>> 0) || 0x2545f491;
  }

  nextRandom() {
    let x = this.rng;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.rng = x;
    return x;
  }

  // ---------------------------------------------------------------- memory

  rb(a) { return this.mem[a]; }
  rw(a) { return (this.mem[a] << 8) | this.mem[a + 1]; }
  wb(a, v) {
    if (a >= this.dynamicSize) throw new ZError(`write to static memory at ${a.toString(16)}`);
    this.mem[a] = v & 0xff;
  }
  ww(a, v) { this.mem[a] = (v >> 8) & 0xff; this.mem[a + 1] = v & 0xff; }
  wwChecked(a, v) {
    if (a + 1 >= this.dynamicSize) throw new ZError(`write to static memory at ${a.toString(16)}`);
    this.ww(a, v);
  }

  routineAddr(p) { return p * this.packScale + this.routineOffset; }
  stringAddr(p) { return p * this.packScale + this.stringOffset; }

  // ---------------------------------------------------------------- variables

  readVar(n) {
    if (n === 0) {
      if (this.stack.length <= this.frameBase()) throw new ZError('stack underflow');
      return this.stack.pop();
    }
    if (n < 16) return this.localsOf()[n - 1] ?? 0;
    return this.rw(this.globals + 2 * (n - 16));
  }

  writeVar(n, v) {
    v = u16(v);
    if (n === 0) this.stack.push(v);
    else if (n < 16) this.localsOf()[n - 1] = v;
    else this.ww(this.globals + 2 * (n - 16), v);
  }

  // "Indirect" access (inc, dec, load, store, pull...): variable 0 is the top
  // of the stack, read or replaced in place (spec 6.3.4).
  peekVar(n) {
    if (n === 0) {
      if (this.stack.length <= this.frameBase()) throw new ZError('stack underflow');
      return this.stack[this.stack.length - 1];
    }
    return this.readVar(n);
  }

  pokeVar(n, v) {
    if (n === 0) {
      if (this.stack.length <= this.frameBase()) this.stack.push(u16(v));
      else this.stack[this.stack.length - 1] = u16(v);
    } else this.writeVar(n, v);
  }

  frameBase() { return this.frames.length ? this.frames[this.frames.length - 1].base : 0; }
  localsOf() {
    if (!this.frames.length) throw new ZError('no routine frame for a local variable');
    return this.frames[this.frames.length - 1].locals;
  }

  // ---------------------------------------------------------------- text

  zsciiToChar(z) {
    if (z === 13) return '\n';
    if (z >= 32 && z <= 126) return String.fromCharCode(z);
    if (z >= 155 && z < 155 + this.extra.length) return this.extra[z - 155];
    return '';
  }

  charToZscii(ch) {
    const c = ch.codePointAt(0);
    if (c === 10 || c === 13) return 13;
    if (c >= 32 && c <= 126) return c;
    return this.unicodeToZscii.get(ch) ?? 63; // '?'
  }

  // Decode a Z-string. Returns {text, end} where end is the byte after it.
  decode(addr, noAbbrev = false) {
    const zchars = [];
    let a = addr;
    for (;;) {
      const w = this.rw(a);
      a += 2;
      zchars.push((w >> 10) & 31, (w >> 5) & 31, w & 31);
      if (w & 0x8000) break;
      if (a >= this.mem.length) break;
    }
    let text = '';
    let alpha = 0;
    for (let i = 0; i < zchars.length; i++) {
      const z = zchars[i];
      if (z === 0) { text += ' '; alpha = 0; continue; }
      if (z >= 1 && z <= 3) {
        if (i + 1 >= zchars.length) break;
        const idx = 32 * (z - 1) + zchars[++i];
        if (!noAbbrev) text += this.decode(this.rw(this.abbrevs + 2 * idx) * 2, true).text;
        alpha = 0;
        continue;
      }
      if (z === 4) { alpha = 1; continue; }
      if (z === 5) { alpha = 2; continue; }
      if (alpha === 2 && z === 6) {
        if (i + 2 >= zchars.length) break;
        text += this.zsciiToChar((zchars[i + 1] << 5) | zchars[i + 2]);
        i += 2;
      } else if (alpha === 2 && z === 7) {
        text += '\n';
      } else {
        text += this.alphabets[alpha][z - 6];
      }
      alpha = 0;
    }
    return { text, end: a };
  }

  // Encode a word the way dictionary entries are stored.
  encodeWord(zsciiCodes) {
    const n = this.version <= 3 ? 6 : 9;
    const out = [];
    for (const z of zsciiCodes) {
      if (out.length >= n) break;
      const ch = this.zsciiToChar(z);
      let i;
      if ((i = this.alphabets[0].indexOf(ch)) >= 0) out.push(i + 6);
      else if ((i = this.alphabets[1].indexOf(ch)) >= 0) out.push(4, i + 6);
      else if ((i = this.alphabets[2].indexOf(ch, 2)) >= 0) out.push(5, i + 6);
      else out.push(5, 6, (z >> 5) & 31, z & 31);
    }
    while (out.length < n) out.push(5);
    out.length = n;
    const bytes = [];
    for (let i = 0; i < n; i += 3) {
      let w = (out[i] << 10) | (out[i + 1] << 5) | out[i + 2];
      if (i + 3 >= n) w |= 0x8000;
      bytes.push(w >> 8, w & 0xff);
    }
    return bytes;
  }

  // ---------------------------------------------------------------- output

  print(s) {
    if (!s) return;
    if (this.mem3.length) {
      const top = this.mem3[this.mem3.length - 1];
      for (const ch of s) {
        this.mem[top.table + 2 + top.len++] = this.charToZscii(ch);
      }
      return;
    }
    if (!this.screenOn) return;
    if (this.window === 1) this.printUpper(s);
    else this.out.push(s);
  }

  printUpper(s) {
    for (const ch of s) {
      if (ch === '\n') { this.cursor.row++; this.cursor.col = 1; continue; }
      const r = this.cursor.row - 1;
      if (r < 0 || r >= Math.max(this.upperHeight, 1) || this.cursor.col > this.screenWidth) {
        this.cursor.col++;
        continue;
      }
      while (this.upper.length <= r) this.upper.push([]);
      this.upper[r][this.cursor.col - 1] = ch;
      this.cursor.col++;
    }
  }

  // The status line / upper window as text lines.
  upperText() {
    const lines = [];
    for (let r = 0; r < Math.max(this.upperHeight, this.version <= 3 ? 1 : 0); r++) {
      const row = this.upper[r] || [];
      const line = Array.from({ length: row.length }, (_, i) => row[i] || ' ').join('').replace(/\s+/g, ' ').trim();
      if (line) lines.push(line);
    }
    return lines;
  }

  showStatusV3() {
    const locObj = this.readVar(16);
    const name = locObj ? this.objectName(locObj) : '';
    let right;
    if (this.version === 3 && this.mem[0x01] & 0x02) {
      const h = s16(this.readVar(17));
      const m = s16(this.readVar(18));
      right = `Time: ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
    } else {
      right = `Score: ${s16(this.readVar(17))}  Moves: ${s16(this.readVar(18))}`;
    }
    this.statusV3 = `${name}  ${right}`;
    this.upper[0] = this.statusV3.split('');
  }

  // ---------------------------------------------------------------- objects

  objAddr(o) {
    if (o < 1) throw new ZError(`bad object number ${o}`);
    return this.version <= 3 ? this.objects + 62 + (o - 1) * 9 : this.objects + 126 + (o - 1) * 14;
  }

  parent(o) { const a = this.objAddr(o); return this.version <= 3 ? this.mem[a + 4] : this.rw(a + 6); }
  sibling(o) { const a = this.objAddr(o); return this.version <= 3 ? this.mem[a + 5] : this.rw(a + 8); }
  child(o) { const a = this.objAddr(o); return this.version <= 3 ? this.mem[a + 6] : this.rw(a + 10); }
  setParent(o, v) { const a = this.objAddr(o); if (this.version <= 3) this.mem[a + 4] = v; else this.ww(a + 6, v); }
  setSibling(o, v) { const a = this.objAddr(o); if (this.version <= 3) this.mem[a + 5] = v; else this.ww(a + 8, v); }
  setChild(o, v) { const a = this.objAddr(o); if (this.version <= 3) this.mem[a + 6] = v; else this.ww(a + 10, v); }
  propTable(o) { return this.rw(this.objAddr(o) + (this.version <= 3 ? 7 : 12)); }

  objectName(o) {
    const t = this.propTable(o);
    return this.mem[t] ? this.decode(t + 1).text : '';
  }

  testAttr(o, n) { return (this.mem[this.objAddr(o) + (n >> 3)] & (0x80 >> (n & 7))) !== 0; }
  setAttr(o, n, on) {
    const a = this.objAddr(o) + (n >> 3);
    if (on) this.mem[a] |= 0x80 >> (n & 7);
    else this.mem[a] &= ~(0x80 >> (n & 7));
  }

  removeObj(o) {
    const p = this.parent(o);
    if (!p) return;
    const sib = this.sibling(o);
    if (this.child(p) === o) this.setChild(p, sib);
    else {
      let c = this.child(p);
      while (c && this.sibling(c) !== o) c = this.sibling(c);
      if (c) this.setSibling(c, sib);
    }
    this.setParent(o, 0);
    this.setSibling(o, 0);
  }

  insertObj(o, d) {
    this.removeObj(o);
    this.setSibling(o, this.child(d));
    this.setChild(d, o);
    this.setParent(o, d);
  }

  // Property entries: returns [{num, addr (data), len}] in table order.
  propAt(a) {
    const b = this.mem[a];
    if (!b) return null;
    if (this.version <= 3) return { num: b & 31, len: (b >> 5) + 1, addr: a + 1 };
    if (b & 0x80) {
      const len = this.mem[a + 1] & 0x3f;
      return { num: b & 0x3f, len: len || 64, addr: a + 2 };
    }
    return { num: b & 0x3f, len: b & 0x40 ? 2 : 1, addr: a + 1 };
  }

  firstProp(o) { const t = this.propTable(o); return t + 1 + 2 * this.mem[t]; }

  findProp(o, n) {
    for (let a = this.firstProp(o), p; (p = this.propAt(a)); a = p.addr + p.len) {
      if (p.num === n) return p;
      if (p.num < n) return null; // properties are stored in descending order
    }
    return null;
  }

  propLen(addr) {
    if (addr === 0) return 0;
    const b = this.mem[addr - 1];
    if (this.version <= 3) return (b >> 5) + 1;
    if (b & 0x80) return (b & 0x3f) || 64;
    return b & 0x40 ? 2 : 1;
  }

  // ---------------------------------------------------------------- input

  tokenise(textAddr, parseAddr, dict = 0, skipUnknown = false) {
    const v = this.version;
    const start = v >= 5 ? textAddr + 2 : textAddr + 1;
    const len = v >= 5 ? this.mem[textAddr + 1] : (() => {
      let n = 0;
      while (this.mem[start + n]) n++;
      return n;
    })();
    const d = dict || this.dictionary;
    const nsep = this.mem[d];
    const seps = new Set(this.mem.subarray(d + 1, d + 1 + nsep));
    const entryLen = this.mem[d + 1 + nsep];
    const count = s16(this.rw(d + 2 + nsep));
    const entries = d + 4 + nsep;

    const words = [];
    let i = 0;
    while (i < len) {
      const c = this.mem[start + i];
      if (c === 32) { i++; continue; }
      if (seps.has(c)) { words.push({ pos: i, len: 1 }); i++; continue; }
      const s = i;
      while (i < len && this.mem[start + i] !== 32 && !seps.has(this.mem[start + i])) i++;
      words.push({ pos: s, len: i - s });
    }

    const max = this.mem[parseAddr];
    const n = Math.min(words.length, max);
    this.mem[parseAddr + 1] = n;
    const keyLen = v <= 3 ? 4 : 6;
    for (let w = 0; w < n; w++) {
      const { pos, len: wl } = words[w];
      const key = this.encodeWord(this.mem.subarray(start + pos, start + pos + wl));
      const found = this.lookup(entries, entryLen, count, key, keyLen);
      const e = parseAddr + 2 + 4 * w;
      if (skipUnknown && !found) continue;
      this.ww(e, found);
      this.mem[e + 2] = wl;
      this.mem[e + 3] = pos + (start - textAddr);
    }
  }

  lookup(entries, entryLen, count, key, keyLen) {
    const cmp = (addr) => {
      for (let k = 0; k < keyLen; k++) {
        const diff = this.mem[addr + k] - key[k];
        if (diff) return diff;
      }
      return 0;
    };
    if (count > 0) {
      let lo = 0, hi = count - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const addr = entries + mid * entryLen;
        const c = cmp(addr);
        if (c === 0) return addr;
        if (c < 0) lo = mid + 1; else hi = mid - 1;
      }
      return 0;
    }
    for (let i = 0; i < -count; i++) {
      const addr = entries + i * entryLen;
      if (cmp(addr) === 0) return addr;
    }
    return 0;
  }

  // Hand over a line of input. Returns what run() returns.
  sendLine(line) {
    const w = this.waiting;
    if (!w) throw new ZError('the game is not waiting for input');
    if (w.kind === 'key') return this.sendKey(line.length ? line : '\n');
    this.waiting = null;
    const v = this.version;
    const codes = [];
    for (const ch of line.toLowerCase()) {
      const z = this.charToZscii(ch);
      if (z !== 13) codes.push(z);
    }
    const text = w.text;
    if (v >= 5) {
      const max = this.mem[text];
      const already = Math.min(this.mem[text + 1], max);
      const room = max - already;
      const take = codes.slice(0, room);
      take.forEach((z, i) => (this.mem[text + 2 + already + i] = z));
      this.mem[text + 1] = already + take.length;
    } else {
      const max = this.mem[text] - (v <= 4 ? 1 : 0);
      const take = codes.slice(0, Math.max(0, max));
      take.forEach((z, i) => (this.mem[text + 1 + i] = z));
      this.mem[text + 1 + take.length] = 0;
    }
    if (w.parse) this.tokenise(text, w.parse);
    if (v >= 5) this.writeVar(w.store, 13);
    return this.run();
  }

  sendKey(key) {
    const w = this.waiting;
    if (!w) throw new ZError('the game is not waiting for input');
    this.waiting = null;
    const ch = [...key][0] || '\n';
    const z = /^(enter|return)$/i.test(key) ? 13 : this.charToZscii(ch);
    if (w.kind === 'line') {
      // A key for a line prompt: just send it as a one-character line.
      this.waiting = w;
      return this.sendLine(ch === '\n' ? '' : ch);
    }
    this.writeVar(w.store, z);
    return this.run();
  }

  // ---------------------------------------------------------------- state

  snapshot() {
    // Dynamic memory, stored as a diff against the story file (much smaller).
    const diff = [];
    for (let i = 0; i < this.dynamicSize; i++) {
      if (this.mem[i] !== this.story[i]) {
        let j = i;
        while (j < this.dynamicSize && this.mem[j] !== this.story[j]) j++;
        diff.push([i, Buffer.from(this.mem.subarray(i, j)).toString('base64')]);
        i = j;
      }
    }
    return {
      v: 1,
      diff,
      pc: this.pc,
      stack: this.stack.slice(),
      frames: this.frames.map((f) => ({ ...f, locals: f.locals.slice() })),
      rng: this.rng,
      waiting: this.waiting,
      upperHeight: this.upperHeight,
      upper: this.upper.map((r) => Array.from({ length: r.length }, (_, i) => r[i] || ' ').join('')),
      window: this.window,
      cursor: { ...this.cursor },
      screenOn: this.screenOn,
      quit: this.quit,
    };
  }

  static restore(story, snap, opts = {}) {
    const m = new ZMachine(story, opts);
    m.load(snap);
    return m;
  }

  load(snap) {
    this.mem.set(this.story.subarray(0, this.dynamicSize));
    this.setupHeader();
    for (const [at, b64] of snap.diff) this.mem.set(Buffer.from(b64, 'base64'), at);
    this.pc = snap.pc;
    this.stack = snap.stack.slice();
    this.frames = snap.frames.map((f) => ({ ...f, locals: f.locals.slice() }));
    this.rng = snap.rng;
    this.waiting = snap.waiting;
    this.upperHeight = snap.upperHeight;
    this.upper = snap.upper.map((r) => r.split(''));
    this.window = snap.window;
    this.cursor = { ...snap.cursor };
    this.screenOn = snap.screenOn;
    this.quit = snap.quit;
    this.mem3 = [];
  }

  // ---------------------------------------------------------------- run loop

  // Runs until the game asks for input or quits.
  // Returns {output, waiting: 'line'|'key'|null, quit}.
  run() {
    if (this.quit) return this.result();
    if (this.waiting) return this.result();
    let steps = 0;
    while (!this.waiting && !this.quit) {
      if (++steps > MAX_STEPS) throw new ZError('the game ran too long without asking for input');
      this.step();
    }
    return this.result();
  }

  result() {
    const output = this.out.join('');
    this.out = [];
    return { output, waiting: this.waiting ? this.waiting.kind : null, quit: this.quit };
  }

  fetchOperands(types) {
    const ops = [];
    for (const t of types) {
      if (t === 3) break;
      if (t === 0) { ops.push(this.rw(this.pc)); this.pc += 2; }
      else if (t === 1) ops.push(this.mem[this.pc++]);
      else ops.push(this.readVar(this.mem[this.pc++]));
    }
    return ops;
  }

  typeByte(b) { return [(b >> 6) & 3, (b >> 4) & 3, (b >> 2) & 3, b & 3]; }

  step() {
    const start = this.pc;
    const op = this.mem[this.pc++];
    let form, num, ops;
    if (op === 0xbe && this.version >= 5) {
      form = 'ext';
      num = this.mem[this.pc++];
      ops = this.fetchOperands(this.typeByte(this.mem[this.pc++]));
    } else if (op >= 0xc0) {
      num = op & 0x1f;
      form = op & 0x20 ? 'var' : '2op';
      let types = this.typeByte(this.mem[this.pc++]);
      if (form === 'var' && (num === 0x0c || num === 0x1a)) types = types.concat(this.typeByte(this.mem[this.pc++]));
      ops = this.fetchOperands(types);
    } else if (op >= 0x80) {
      num = op & 0x0f;
      const t = (op >> 4) & 3;
      form = t === 3 ? '0op' : '1op';
      ops = this.fetchOperands([t]);
    } else {
      form = '2op';
      num = op & 0x1f;
      ops = this.fetchOperands([op & 0x40 ? 2 : 1, op & 0x20 ? 2 : 1]);
    }
    try {
      this.exec(form, num, ops);
    } catch (e) {
      if (e instanceof Restored) return;
      if (e instanceof ZError && !e.message.includes(' at pc ')) {
        e.message += ` at pc ${start.toString(16)} (${form} ${num})`;
      }
      throw e;
    }
  }

  store(v) { this.writeVar(this.mem[this.pc++], v); }

  branch(cond) {
    const b = this.mem[this.pc++];
    let offset;
    if (b & 0x40) offset = b & 0x3f;
    else {
      offset = ((b & 0x3f) << 8) | this.mem[this.pc++];
      if (offset & 0x2000) offset -= 0x4000;
    }
    if (!!cond !== !!(b & 0x80)) return;
    if (offset === 0) this.ret(0);
    else if (offset === 1) this.ret(1);
    else this.pc += offset - 2;
  }

  call(addr, args, store) {
    // store: variable number, or -1 to discard the result
    if (addr === 0) {
      if (store >= 0) this.writeVar(store, 0);
      return;
    }
    const a = this.routineAddr(addr);
    const n = this.mem[a];
    if (n > 15) throw new ZError(`bad routine at ${a.toString(16)}`);
    let p = a + 1;
    const locals = [];
    for (let i = 0; i < n; i++) {
      if (this.version <= 4) { locals.push(this.rw(p)); p += 2; } else locals.push(0);
    }
    for (let i = 0; i < Math.min(n, args.length); i++) locals[i] = u16(args[i]);
    this.frames.push({ ret: this.pc, store, locals, argc: args.length, base: this.stack.length });
    this.pc = p;
  }

  ret(v) {
    const f = this.frames.pop();
    if (!f) throw new ZError('return from the main routine');
    this.stack.length = f.base;
    this.pc = f.ret;
    if (f.store >= 0) this.writeVar(f.store, v);
  }

  printNum(v) { this.print(String(s16(v))); }

  exec(form, num, o) {
    const v = this.version;
    if (form === '2op') {
      const [a, b] = o;
      switch (num) {
        case 0x01: return this.branch(o.slice(1).some((x) => x === a));
        case 0x02: return this.branch(s16(a) < s16(b));
        case 0x03: return this.branch(s16(a) > s16(b));
        case 0x04: { const x = s16(this.peekVar(a)) - 1; this.pokeVar(a, x); return this.branch(s16(x) < s16(b)); }
        case 0x05: { const x = s16(this.peekVar(a)) + 1; this.pokeVar(a, x); return this.branch(s16(x) > s16(b)); }
        case 0x06: return this.branch(a !== 0 && this.parent(a) === b);
        case 0x07: return this.branch((a & b) === b);
        case 0x08: return this.store(a | b);
        case 0x09: return this.store(a & b);
        case 0x0a: return this.branch(a !== 0 && this.testAttr(a, b));
        case 0x0b: if (a) this.setAttr(a, b, true); return;
        case 0x0c: if (a) this.setAttr(a, b, false); return;
        case 0x0d: return this.pokeVar(a, b);
        case 0x0e: if (a && b) this.insertObj(a, b); return;
        case 0x0f: return this.store(this.rw(u16(a + 2 * s16(b))));
        case 0x10: return this.store(this.mem[u16(a + s16(b))]);
        case 0x11: {
          if (!a) return this.store(0);
          const p = this.findProp(a, b);
          if (!p) return this.store(this.rw(this.objects + 2 * (b - 1)));
          return this.store(p.len === 1 ? this.mem[p.addr] : this.rw(p.addr));
        }
        case 0x12: { if (!a) return this.store(0); const p = this.findProp(a, b); return this.store(p ? p.addr : 0); }
        case 0x13: {
          if (!a) return this.store(0);
          let addr = this.firstProp(a);
          if (b) {
            const p = this.findProp(a, b);
            if (!p) throw new ZError(`get_next_prop: object ${a} has no property ${b}`);
            addr = p.addr + p.len;
          }
          const next = this.propAt(addr);
          return this.store(next ? next.num : 0);
        }
        case 0x14: return this.store(s16(a) + s16(b));
        case 0x15: return this.store(s16(a) - s16(b));
        case 0x16: return this.store(Math.imul(s16(a), s16(b)));
        case 0x17: if (!s16(b)) throw new ZError('division by zero'); return this.store(Math.trunc(s16(a) / s16(b)));
        case 0x18: if (!s16(b)) throw new ZError('division by zero'); return this.store(s16(a) % s16(b));
        case 0x19: return this.call(a, o.slice(1), this.mem[this.pc++]);
        case 0x1a: return this.call(a, o.slice(1), -1);
        case 0x1b: return; // set_colour
        case 0x1c: { // throw
          while (this.frames.length > b) this.frames.pop();
          return this.ret(a);
        }
      }
    } else if (form === '1op') {
      const [a] = o;
      switch (num) {
        case 0x00: return this.branch(a === 0);
        case 0x01: { const s = a ? this.sibling(a) : 0; this.store(s); return this.branch(s !== 0); }
        case 0x02: { const c = a ? this.child(a) : 0; this.store(c); return this.branch(c !== 0); }
        case 0x03: return this.store(a ? this.parent(a) : 0);
        case 0x04: return this.store(this.propLen(a));
        case 0x05: return this.pokeVar(a, s16(this.peekVar(a)) + 1);
        case 0x06: return this.pokeVar(a, s16(this.peekVar(a)) - 1);
        case 0x07: return this.print(this.decode(a).text);
        case 0x08: return this.call(a, [], this.mem[this.pc++]);
        case 0x09: if (a) this.removeObj(a); return;
        case 0x0a: if (a) this.print(this.objectName(a)); return;
        case 0x0b: return this.ret(a);
        case 0x0c: this.pc += s16(a) - 2; return;
        case 0x0d: return this.print(this.decode(this.stringAddr(a)).text);
        case 0x0e: return this.store(this.peekVar(a));
        case 0x0f:
          if (v <= 4) return this.store(~a);
          return this.call(a, [], -1);
      }
    } else if (form === '0op') {
      switch (num) {
        case 0x00: return this.ret(1);
        case 0x01: return this.ret(0);
        case 0x02: { const { text, end } = this.decode(this.pc); this.pc = end; return this.print(text); }
        case 0x03: { const { text, end } = this.decode(this.pc); this.pc = end; this.print(text + '\n'); return this.ret(1); }
        case 0x04: return;
        case 0x05: return v <= 3 ? this.branch(this.doSave()) : this.store(this.doSave() ? 1 : 0);
        case 0x06: return v <= 3 ? this.branch(this.doRestore()) : this.store(this.doRestore() ? 2 : 0);
        case 0x07: { const rng = this.rng; this.reset(); this.rng = rng; return; }
        case 0x08: return this.ret(this.readVar(0));
        case 0x09:
          if (v <= 4) { this.readVar(0); return; }
          return this.store(this.frames.length);
        case 0x0a: this.quit = true; return;
        case 0x0b: return this.print('\n');
        case 0x0c: if (v <= 3) this.showStatusV3(); return;
        case 0x0d: return this.branch(true); // verify
        case 0x0f: return this.branch(true); // piracy
      }
    } else if (form === 'var') {
      switch (num) {
        case 0x00: return this.call(o[0], o.slice(1), this.mem[this.pc++]);
        case 0x01: return this.wwChecked(u16(o[0] + 2 * s16(o[1])), o[2]);
        case 0x02: return this.wb(u16(o[0] + s16(o[1])), o[2]);
        case 0x03: {
          const p = this.findProp(o[0], o[1]);
          if (!p) throw new ZError(`put_prop: object ${o[0]} has no property ${o[1]}`);
          if (p.len === 1) this.mem[p.addr] = o[2] & 0xff; else this.ww(p.addr, o[2]);
          return;
        }
        case 0x04: { // sread / aread
          if (v <= 3) this.showStatusV3();
          const store = v >= 5 ? this.mem[this.pc++] : -1;
          this.waiting = { kind: 'line', text: o[0], parse: o[1] || 0, store };
          return;
        }
        case 0x05: return this.print(this.zsciiToChar(o[0]));
        case 0x06: return this.printNum(o[0]);
        case 0x07: {
          const r = s16(o[0]);
          if (r > 0) return this.store((this.nextRandom() % r) + 1);
          this.seed(r < 0 ? -r : Date.now());
          return this.store(0);
        }
        case 0x08: return this.writeVar(0, o[0]);
        case 0x09: { const x = this.readVar(0); return this.pokeVar(o[0], x); }
        case 0x0a: // split_window
          this.upperHeight = o[0];
          this.upper.length = Math.min(this.upper.length, o[0]);
          if (this.cursor.row > o[0]) this.cursor = { row: 1, col: 1 };
          return;
        case 0x0b: // set_window
          this.window = o[0];
          if (o[0] === 1) this.cursor = { row: 1, col: 1 };
          return;
        case 0x0c: return this.call(o[0], o.slice(1), this.mem[this.pc++]);
        case 0x0d: { // erase_window
          const w = s16(o[0]);
          if (w === -1) { this.upperHeight = 0; this.upper = []; this.window = 0; }
          if (w === -2 || w === 1) this.upper = [];
          return;
        }
        case 0x0e: return; // erase_line
        case 0x0f: if (this.window === 1) this.cursor = { row: s16(o[0]), col: o[1] || 1 }; return;
        case 0x10: this.ww(o[0], this.cursor.row); this.ww(o[0] + 2, this.cursor.col); return;
        case 0x11: return; // set_text_style
        case 0x12: return; // buffer_mode
        case 0x13: { // output_stream
          const n = s16(o[0]);
          if (n === 1) this.screenOn = true;
          else if (n === -1) this.screenOn = false;
          else if (n === 3) {
            if (this.mem3.length >= 16) throw new ZError('output stream 3 nested too deeply');
            this.mem3.push({ table: o[1], len: 0 });
          } else if (n === -3) {
            const top = this.mem3.pop();
            if (top) this.ww(top.table, top.len);
          }
          return; // stream 2 (transcript) and 4 are ignored
        }
        case 0x14: return; // input_stream
        case 0x15: return; // sound_effect
        case 0x16: { // read_char
          this.waiting = { kind: 'key', store: this.mem[this.pc++] };
          return;
        }
        case 0x17: { // scan_table
          const [x, table, len, form = 0x82] = o;
          const size = form & 0x7f;
          const words = (form & 0x80) !== 0;
          let found = 0;
          for (let i = 0; i < len; i++) {
            const a = table + i * size;
            if ((words ? this.rw(a) : this.mem[a]) === x) { found = a; break; }
          }
          this.store(found);
          return this.branch(found !== 0);
        }
        case 0x18: return this.store(~o[0]);
        case 0x19: return this.call(o[0], o.slice(1), -1);
        case 0x1a: return this.call(o[0], o.slice(1), -1);
        case 0x1b: return this.tokenise(o[0], o[1], o[2] || 0, !!o[3]);
        case 0x1c: { // encode_text
          const [text, len, from, coded] = o;
          const bytes = this.encodeWord(this.mem.subarray(text + from, text + from + len));
          bytes.forEach((b, i) => (this.mem[coded + i] = b));
          return;
        }
        case 0x1d: { // copy_table
          const [first, second, size] = o;
          const n = Math.abs(s16(size));
          if (second === 0) { for (let i = 0; i < n; i++) this.mem[first + i] = 0; return; }
          if (s16(size) < 0) for (let i = 0; i < n; i++) this.mem[second + i] = this.mem[first + i];
          else this.mem.set(this.mem.slice(first, first + n), second);
          return;
        }
        case 0x1e: { // print_table
          const [text, width, height = 1, skip = 0] = o;
          let a = text;
          for (let r = 0; r < height; r++) {
            if (r) this.print('\n');
            let line = '';
            for (let c = 0; c < width; c++) line += this.zsciiToChar(this.mem[a++]);
            this.print(line);
            a += skip;
          }
          return;
        }
        case 0x1f: return this.branch(o[0] <= this.frames[this.frames.length - 1].argc);
      }
    } else if (form === 'ext') {
      switch (num) {
        case 0x00: return this.store(this.doSave() ? 1 : 0);
        case 0x01: return this.store(this.doRestore() ? 2 : 0);
        case 0x02: { const n = s16(o[1]); return this.store(n >= 0 ? o[0] << n : o[0] >>> -n); }
        case 0x03: { const n = s16(o[1]); return this.store(n >= 0 ? s16(o[0]) << n : s16(o[0]) >> -n); }
        case 0x04: return this.store(o[0] === 1 || o[0] === 4 ? 1 : 0); // set_font
        case 0x09: { // save_undo
          const storeVar = this.mem[this.pc++];
          this.undoState = { snap: this.snapshot(), storeVar };
          return this.writeVar(storeVar, 1);
        }
        case 0x0a: { // restore_undo
          const storeVar = this.mem[this.pc++];
          if (!this.undoState) return this.writeVar(storeVar, 0);
          const u = this.undoState;
          this.load(u.snap);
          this.undoState = null;
          return this.writeVar(u.storeVar, 2);
        }
        case 0x0b: return this.print(String.fromCodePoint(o[0]));
        case 0x0c: return this.store(o[0] >= 32 && o[0] <= 0xffff ? 3 : 0); // check_unicode
        case 0x0d: return; // set_true_colour
        default: return; // other extended opcodes (mostly v6) are ignored
      }
    }
    throw new ZError(`unknown opcode ${form} ${num}`);
  }

  // In-game SAVE/RESTORE use one slot per game, kept by the server. The server
  // copies this.saveSlot into its session file.
  doSave() {
    // The slot is resumed like a restore of this very instruction, so remember
    // where its result goes.
    const v = this.version;
    const at = this.pc; // points at the branch byte (v3) or store byte (v4+)
    this.saveSlot = { snap: this.snapshot(), at, v };
    return true;
  }

  doRestore() {
    const s = this.saveSlot;
    if (!s) return false;
    const slot = s;
    this.load(slot.snap);
    this.saveSlot = slot;
    this.pc = slot.at;
    if (this.version <= 3) {
      // continue as if the save succeeded: take its branch
      this.branch(true);
    } else {
      this.store(2);
    }
    // The caller (the restore instruction) must not store/branch again.
    throw new Restored();
  }
}

// Thrown by doRestore(): the whole state was replaced mid-instruction, so the
// restore opcode must not write its own result. step() swallows it.
class Restored extends Error {}
