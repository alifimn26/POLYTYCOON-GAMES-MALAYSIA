// Loads index.html (fixed) or the original fixture into a fresh jsdom window.
// CDN <script src> tags are removed so THREE, Peer and mqtt stay undefined.
// The inline script runs as a real script (vm.Script) so top-level let/const live in the
// global lexical scope and tests can read them with window.eval('gameState').
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
export const GAME_ROOT = path.resolve(here, '..', '..');
export const FIXED_FILE = path.join(GAME_ROOT, 'index.html');
export const ORIGINAL_FILE = path.join(GAME_ROOT, 'tests', 'fixtures', 'index.original.html');

export function currentTarget() {
  return process.env.GAME_TARGET === 'original' ? 'original' : 'fixed';
}

export function readGameHtml(target = currentTarget()) {
  return fs.readFileSync(target === 'original' ? ORIGINAL_FILE : FIXED_FILE, 'utf8');
}

function splitHtml(html) {
  const noExternal = html.replace(/<script\s+src=[^>]*><\/script>/gi, '');
  const m = /<script>([\s\S]*)<\/script>\s*<\/body>/i.exec(noExternal);
  if (!m) throw new Error('inline script not found');
  const code = m[1];
  const markup = noExternal.slice(0, m.index) + noExternal.slice(m.index + m[0].length - '</body>'.length);
  return { code, markup };
}

// Deterministic timer + Date.now so 30 s and 60 s timers can be advanced instantly.
export function createClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  let seq = 1;
  const timers = new Map();
  const realImmediate = setImmediate;
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => realImmediate(r)); };
  const add = (fn, ms, repeat, args) => {
    const id = seq++;
    const delay = Math.max(0, Number(ms) || 0);
    timers.set(id, { id, fn, at: now + delay, repeat: repeat ? Math.max(1, delay) : 0, args });
    return id;
  };
  const clock = {
    get now() { return now; },
    setTimeout: (fn, ms, ...args) => add(fn, ms, false, args),
    setInterval: (fn, ms, ...args) => add(fn, ms, true, args),
    clear: (id) => { timers.delete(id); },
    pending: () => timers.size,
    async tick(ms = 0) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const t of timers.values()) if (t.at <= target && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
        if (!next) break;
        now = Math.max(now, next.at);
        if (next.repeat) next.at = now + next.repeat; else timers.delete(next.id);
        try { next.fn(...(next.args || [])); } catch (e) { clock.errors.push(e); }
        await flush();
      }
      now = target;
      await flush();
    },
    errors: []
  };
  return clock;
}

// BroadcastChannel stand-in shared by several windows. Delivery is explicit (drain) so tests control ordering.
export function createBus() {
  const channels = [];
  const queue = [];
  const log = [];
  const bus = {
    log,
    taps: [],
    install(win, label) {
      class FakeBC {
        constructor(name) { this.name = name; this.onmessage = null; this.closed = false; this.owner = label; channels.push(this); }
        postMessage(data) {
          if (this.closed) return;
          const copy = JSON.parse(JSON.stringify(data));
          log.push({ from: label, name: this.name, data: copy });
          bus.taps.forEach(t => t(copy, label));
          channels.forEach(ch => { if (ch !== this && !ch.closed && ch.name === this.name) queue.push({ ch, data: copy }); });
        }
        close() { this.closed = true; }
      }
      win.BroadcastChannel = FakeBC;
    },
    async drain(max = 200) {
      let n = 0;
      while (queue.length && n++ < max) {
        const batch = queue.splice(0, queue.length);
        for (const item of batch) { if (!item.ch.closed && item.ch.onmessage) item.ch.onmessage({ data: item.data }); }
        await new Promise(r => setImmediate(r));
      }
    },
    dropPending() { queue.length = 0; },
    pendingCount: () => queue.length
  };
  return bus;
}

export function seededRng(seed = 1) {
  let s = seed >>> 0 || 1;
  const fn = () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    fn.calls += 1;
    return s / 4294967296;
  };
  fn.calls = 0;
  return fn;
}

// Sequence rng: returns scripted values in order, then falls back to 0.5.
export function scriptedRng(values) {
  let i = 0;
  const fn = () => { fn.calls += 1; return i < values.length ? values[i++] : 0.5; };
  fn.calls = 0;
  return fn;
}
// A roll of die value d (1..6) needs rng in [(d-1)/6, d/6).
export const dieValue = (d) => (d - 0.5) / 6;

export class FakePeerRegistry {
  constructor() { this.peers = []; }
}

export async function loadGame(opts = {}) {
  const target = opts.target || currentTarget();
  const html = readGameHtml(target);
  const { code, markup } = splitHtml(html);
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e && e.message || e)));
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  vc.on('warn', () => {});
  vc.on('log', () => {});

  const dom = new JSDOM(markup, {
    url: opts.url || 'https://polytycoon.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: false,
    virtualConsole: vc,
    storageQuota: 5_000_000
  });
  const win = dom.window;
  const clock = opts.clock || createClock();
  win.setTimeout = (fn, ms, ...a) => clock.setTimeout(typeof fn === 'function' ? fn : () => win.eval(String(fn)), ms, ...a);
  win.setInterval = (fn, ms, ...a) => clock.setInterval(fn, ms, ...a);
  win.clearTimeout = (id) => clock.clear(id);
  win.clearInterval = (id) => clock.clear(id);
  win.requestAnimationFrame = () => 0;
  const RealDate = win.Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock.now); else super(...a); }
    static now() { return clock.now; }
  }
  win.Date = FakeDate;
  if (!win.crypto || !win.crypto.getRandomValues) {
    win.crypto = { getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; } };
  }
  win.ResizeObserver = undefined;
  const rng = opts.rng || seededRng(opts.seed || 12345);
  win.Math.random = rng;
  if (opts.bus) opts.bus.install(win, opts.label || 'win');

  if (opts.fakePeer) {
    const peers = [];
    class FakeConn {
      constructor(peerId) { this.peer = peerId; this.open = false; this.handlers = {}; this.closed = false; this.sent = []; }
      on(ev, cb) { (this.handlers[ev] = this.handlers[ev] || []).push(cb); }
      emit(ev, ...a) { (this.handlers[ev] || []).forEach(cb => cb(...a)); }
      send(p) { this.sent.push(p); }
      close() { this.closed = true; this.open = false; this.emit('close'); }
    }
    class FakePeer {
      constructor(id, o) { this.id = id; this.options = o; this.open = false; this.destroyed = false; this.disconnected = false; this.handlers = {}; peers.push(this); }
      on(ev, cb) { (this.handlers[ev] = this.handlers[ev] || []).push(cb); }
      emit(ev, ...a) { (this.handlers[ev] || []).forEach(cb => cb(...a)); }
      connect(id) { const c = new FakeConn(id); this.connectCalls = (this.connectCalls || 0) + 1; this.lastConn = c; return c; }
      reconnect() {}
      destroy() { this.destroyed = true; }
    }
    FakePeer.FakeConn = FakeConn;
    win.Peer = FakePeer;
    win.__fakePeers = peers;
  }

  if (opts.beforeScript) opts.beforeScript(win, clock);

  const script = new vm.Script(code, { filename: `${target}:inline.js` });
  script.runInContext(dom.getInternalVMContext());

  if (win.document.readyState !== 'complete') {
    await new Promise(r => win.addEventListener('load', r, { once: true }));
  }
  await clock.tick(0);

  const game = {
    target, win, dom, clock, rng, errors, bus: opts.bus || null,
    doc: win.document,
    ev: (expr) => win.eval(expr),
    get state() { return win.eval('gameState'); },
    call: (fn, ...args) => win[fn](...args),
    byId: (id) => win.document.getElementById(id),
    click: (id) => { const el = win.document.getElementById(id); el.click(); return el; },
    async settle(ms = 0) {
      for (let i = 0; i < 4; i++) {
        if (opts.bus) await opts.bus.drain();
        await clock.tick(i === 0 ? ms : 0);
      }
      if (opts.bus) await opts.bus.drain();
    },
    close() { try { win.close(); } catch (e) {} }
  };
  return game;
}

// Starts a local match with the given seat setup. seats: array of 'human' | 'bot'.
export async function startLocalMatch(g, seats = ['human', 'bot']) {
  const st = g.state;
  while (st.players.length > seats.length) st.players.pop();
  while (st.players.length < seats.length) g.win.addLobbySeat(seats[st.players.length] === 'bot');
  st.players.forEach((p, i) => { p.isBot = seats[i] === 'bot'; });
  g.win.startMatchFromLobby();
  await g.settle(0);
  return g.state;
}

// Online-room helper: host creates a room, guests join over the shared bus.
export async function makeOnlineRoom({ guests = 1, target, seed = 7, extraOpts = {} } = {}) {
  const bus = createBus();
  const clock = createClock();
  const host = await loadGame({ target, bus, clock, label: 'host', seed, ...extraOpts });
  await host.win.createOnlineRoom();
  const code = host.state.roomCode;
  const gs = [];
  for (let i = 0; i < guests; i++) {
    const g = await loadGame({ target, bus, clock, label: `guest${i + 1}`, seed: seed + 1 + i, url: `https://polytycoon.test/?room=${code}&map=malaysia`, ...extraOpts });
    gs.push(g);
  }
  for (let i = 0; i < 4; i++) { await host.settle(0); }
  return { bus, clock, host, guests: gs, code };
}
