'use strict';
// Live stream of the dashboard for IPTV players (Kodi, VLC, TiviMate...): HLS video of exactly what the display shows.
//
// How: a headless Chromium loads the dashboard (/?stream=1), its screencast frames are fed to ffmpeg at a steady frame
// rate, and ffmpeg writes an HLS playlist + short .ts segments that Express serves. Nothing runs until someone asks for
// the stream, and it stops again a little after the last viewer leaves, so an idle Pi pays nothing for it.
// The links carry a secret token (the dashboard shows personal data), and the whole feature is off until switched on.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('./config');
const ws = require('./ws-client');

const HLS_FILE = /^(live\.m3u8|seg_\d{1,8}\.ts)$/;
const SIZES = { '854x480': [854, 480], '1280x720': [1280, 720], '1920x1080': [1920, 1080] };
const FPS = [2, 5, 10, 15];
const IDLE_MS = () => Number(process.env.PIDASH_STREAM_IDLE_MS) || 45000;
const VIEWER_WINDOW = 20000;

// ---- settings --------------------------------------------------------------------------------------------------
function settings() {
  const s = (config.get().stream) || {};
  return {
    enabled: s.enabled === true,
    token: /^[0-9a-f]{32}$/.test(s.token || '') ? s.token : '',
    size: SIZES[s.size] ? s.size : '1280x720',
    fps: FPS.includes(Number(s.fps)) ? Number(s.fps) : 5,
  };
}

function save(next) {
  const cfg = config.get();
  cfg.stream = { ...settings(), ...next };
  config.save(cfg);
}

function ensureToken() {
  const s = settings();
  if (s.token) return s.token;
  const token = crypto.randomBytes(16).toString('hex');
  save({ token });
  return token;
}

function regenerateToken() {
  const token = crypto.randomBytes(16).toString('hex');
  save({ token });
  stop('new link');
  return token;
}

function tokenOk(given) {
  const s = settings();
  if (!s.enabled || !s.token) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(s.token).digest();
  return crypto.timingSafeEqual(a, b);
}

function update(patch) {
  const cur = settings();
  const next = {
    enabled: patch.enabled === undefined ? cur.enabled : patch.enabled === true,
    size: patch.size === undefined ? cur.size : patch.size,
    fps: patch.fps === undefined ? cur.fps : Number(patch.fps),
  };
  if (!SIZES[next.size]) throw new Error(`Size must be one of ${Object.keys(SIZES).join(', ')}.`);
  if (!FPS.includes(next.fps)) throw new Error(`Frame rate must be one of ${FPS.join(', ')}.`);
  if (next.enabled) ensureToken();
  save(next);
  stop('settings changed'); // the next viewer starts it with the new settings
  return settings();
}

// ---- finding the tools -----------------------------------------------------------------------------------------
function which(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const f = path.join(dir, name + ext);
      try { if (fs.statSync(f).isFile()) return f; } catch { /* not here */ }
    }
  }
  return null;
}

function findBrowser() {
  if (process.env.PIDASH_BROWSER && fs.existsSync(process.env.PIDASH_BROWSER)) return process.env.PIDASH_BROWSER;
  for (const n of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']) {
    const f = which(n);
    if (f) return f;
  }
  const known = process.platform === 'win32'
    ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'] : [];
  return known.find((f) => fs.existsSync(f)) || null;
}

function findFfmpeg() {
  if (process.env.PIDASH_FFMPEG && fs.existsSync(process.env.PIDASH_FFMPEG)) return process.env.PIDASH_FFMPEG;
  return which('ffmpeg');
}

// How to get the missing tools. In Docker they cannot be installed into a running container: use the stream image.
const IN_DOCKER = process.env.PIDASH_INSTALL === 'docker';
const INSTALL_HINT = IN_DOCKER ? 'use the stream image: ghcr.io/torresmi9294/pidash:stream' : 'sudo apt install -y chromium ffmpeg';
const installHelp = (missing) => (IN_DOCKER
  ? `Streaming needs ${missing} in the container. Use the "stream" image instead: change the image line in your compose file to ghcr.io/torresmi9294/pidash:stream and run docker compose pull && docker compose up -d (if you build from a checkout, set PIDASH_STREAM=1 in .env and rebuild). It is not available for 32-bit ARMv6 hardware.`
  : `Streaming needs ${missing} on the device that runs PiDash. On a Raspberry Pi or Debian/Ubuntu run: ${INSTALL_HINT} and then restart PiDash.`);

// ---- the pipeline (browser -> ffmpeg -> HLS files) --------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
  }).on('error', reject).setTimeout(5000, function onTimeout() { this.destroy(new Error('timed out')); });
});

async function launchReal({ baseUrl, size, fps, noSandbox }) {
  const browserBin = findBrowser();
  const ffmpegBin = findFfmpeg();
  if (!browserBin || !ffmpegBin) throw new Error(installHelp([!browserBin && 'Chromium', !ffmpegBin && 'ffmpeg'].filter(Boolean).join(' and ')));
  const [w, h] = SIZES[size];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pidash-stream-'));
  const tail = [];
  const remember = (d) => { for (const line of String(d).split('\n')) if (line.trim()) { tail.push(line.trim()); if (tail.length > 12) tail.shift(); } };
  let stopping = false;
  let onExit = () => {};
  const procs = [];
  let timer = null;
  let sock = null;

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (timer) clearInterval(timer);
    try { if (sock) sock.close(); } catch { /* already closed */ }
    for (const p of procs) { try { p.kill('SIGTERM'); } catch { /* gone */ } }
    await wait(300);
    for (const p of procs) { if (p.exitCode === null) { try { p.kill('SIGKILL'); } catch { /* gone */ } } }
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch { await wait(300); } // Windows can hold files a moment
    }
  };
  const died = (why) => { if (!stopping) { const msg = `${why}${tail.length ? `: ${tail.slice(-4).join(' | ')}` : ''}`; stop().then(() => onExit(new Error(msg))); } };

  try {
    const keyint = fps * 2;
    const ff = spawn(ffmpegBin, [
      '-hide_banner', '-loglevel', 'warning',
      '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', // many IPTV players want an audio track, so send silence
      '-map', '0:v', '-map', '1:a',
      // JPEG frames are full-range; TVs and phones expect standard (limited) range video, or the picture looks washed out
      '-vf', 'scale=in_range=full:out_range=limited:flags=bicubic,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '27', '-maxrate', '3M', '-bufsize', '6M',
      '-g', String(keyint), '-keyint_min', String(keyint), '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '32k', '-shortest',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6', '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
      '-hls_segment_filename', path.join(dir, 'seg_%05d.ts'), path.join(dir, 'live.m3u8'),
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    procs.push(ff);
    ff.stderr.on('data', remember);
    ff.stdin.on('error', () => {});
    ff.on('error', (e) => died(`ffmpeg could not start (${e.message})`));
    ff.on('exit', (code) => died(`ffmpeg stopped (exit ${code})`));

    const args = [
      '--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${path.join(dir, 'profile')}`,
      `--window-size=${w},${h}`, '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-dev-shm-usage', '--disable-background-networking', '--force-device-scale-factor=1',
      ...(noSandbox ? ['--no-sandbox'] : []), 'about:blank',
    ];
    const br = spawn(browserBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    procs.push(br);
    br.on('error', (e) => died(`the browser could not start (${e.message})`));
    br.on('exit', (code) => died(`the browser stopped (exit ${code})`));
    const wsUrl = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`the browser did not start${tail.length ? `: ${tail.slice(-3).join(' | ')}` : ''}`)), 20000);
      br.stderr.on('data', (d) => {
        remember(d);
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(d));
        if (m) { clearTimeout(t); resolve(m[1]); }
      });
      br.once('exit', () => { clearTimeout(t); reject(new Error(`the browser stopped before it was ready${tail.length ? `: ${tail.slice(-3).join(' | ')}` : ''}`)); });
    });
    const port = new URL(wsUrl).port;
    const page = (await getJson(`http://127.0.0.1:${port}/json/list`)).find((t) => t.type === 'page');
    if (!page) throw new Error('the browser has no page to show');
    sock = await ws.connect(page.webSocketDebuggerUrl);

    // DevTools protocol: tiny request/response helper plus the screencast
    let nextId = 0;
    const pending = new Map();
    let last = null;
    let casting = false;
    let loaded = () => {};
    sock.on('message', (text) => {
      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const { ok, fail } = pending.get(m.id);
        pending.delete(m.id);
        return m.error ? fail(new Error(m.error.message)) : ok(m.result);
      }
      if (m.method === 'Page.screencastFrame') {
        last = Buffer.from(m.params.data, 'base64');
        sock.send(JSON.stringify({ id: ++nextId, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
      } else if (m.method === 'Inspector.targetCrashed') died('the page crashed');
      else if (m.method === 'Page.loadEventFired') { loaded(); if (casting) startCast().catch(() => {}); } // the dashboard reloads itself when settings change: pick the screencast back up
    });
    sock.on('close', () => died('the browser connection closed'));
    sock.on('error', () => {});
    const call = (method, params = {}) => new Promise((ok, fail) => {
      const id = ++nextId;
      pending.set(id, { ok, fail });
      sock.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.delete(id)) fail(new Error(`${method} timed out`)); }, 15000);
    });
    // A screencast cannot attach while the page is still navigating ("Not attached to an active page"), so it is started
    // after the page has loaded, and retried a few times if the browser is still settling.
    const startCast = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          await call('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
          casting = true;
          return;
        } catch (e) {
          if (attempt >= 8) throw e;
          await wait(400);
        }
      }
    };
    await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    const firstLoad = new Promise((resolve) => { loaded = resolve; });
    await call('Page.navigate', { url: baseUrl });
    await Promise.race([firstLoad, wait(15000)]); // a slow page still gets a screencast
    loaded = () => {};
    await startCast();

    // The screencast only sends a frame when something changes (a still dashboard changes once a minute), but a video
    // needs a steady rate: so the newest frame is sent again every 1/fps seconds.
    timer = setInterval(() => {
      if (last && ff.stdin.writable && ff.stdin.writableLength < 4e6) ff.stdin.write(last);
    }, Math.round(1000 / fps));
  } catch (e) {
    await stop();
    throw new Error(`${e.message}${tail.length && !/:/.test(e.message) ? `: ${tail.slice(-3).join(' | ')}` : ''}`);
  }
  return { dir, stop, set onExit(fn) { onExit = fn; } };
}

// ---- the manager -----------------------------------------------------------------------------------------------
// Chromium's own sandbox needs user namespaces, which Docker's default profile does not allow: skip the doomed first try there.
const state = { phase: 'stopped', error: null, pipeline: null, starting: null, lastRequest: 0, noSandbox: process.env.PIDASH_INSTALL === 'docker', viewers: new Map(), retryAt: 0, idleTimer: null };
let launcher = launchReal;

function touch(who) {
  state.lastRequest = Date.now();
  if (who) state.viewers.set(who, Date.now());
}

function viewers() {
  const cutoff = Date.now() - VIEWER_WINDOW;
  for (const [k, t] of state.viewers) if (t < cutoff) state.viewers.delete(k);
  return state.viewers.size;
}

async function stop(reason) {
  const p = state.pipeline;
  if (state.idleTimer) { clearInterval(state.idleTimer); state.idleTimer = null; }
  state.pipeline = null;
  state.starting = null;
  state.viewers.clear();
  if (reason === 'settings changed' || reason === 'new link') { state.phase = 'stopped'; state.error = null; state.retryAt = 0; } // a fresh start
  if (state.phase !== 'error') state.phase = 'stopped';
  if (p) await p.stop();
  if (reason) state.lastStop = reason;
}

async function ensure(baseUrl) {
  touch();
  if (state.phase === 'running' && state.pipeline) return state.pipeline;
  if (state.starting) return state.starting;
  if (state.phase === 'error' && Date.now() < state.retryAt) throw new Error(state.error);
  const s = settings();
  state.phase = 'starting';
  state.error = null;
  state.starting = (async () => {
    let pipeline;
    try {
      try {
        pipeline = await launcher({ baseUrl, size: s.size, fps: s.fps, noSandbox: state.noSandbox });
      } catch (e) {
        // Chromium's own sandbox needs user namespaces, which some locked-down setups (containers, services) do not
        // allow. It only ever loads this dashboard, so fall back to running without it rather than not streaming at all.
        if (!state.noSandbox && /sandbox|namespace|Operation not permitted|setuid/i.test(e.message)) {
          console.warn('[stream] Chromium would not start with its sandbox here; retrying without it');
          state.noSandbox = true;
          pipeline = await launcher({ baseUrl, size: s.size, fps: s.fps, noSandbox: true });
        } else throw e;
      }
    } catch (e) {
      state.phase = 'error';
      state.error = e.message;
      state.retryAt = Date.now() + 5000;
      state.starting = null;
      console.error(`[stream] could not start: ${e.message}`);
      throw e;
    }
    pipeline.onExit = (err) => {
      if (state.pipeline !== pipeline) return;
      state.pipeline = null;
      state.phase = 'error';
      state.error = err.message;
      state.retryAt = Date.now() + 5000;
      console.error(`[stream] stopped: ${err.message}`);
    };
    state.pipeline = pipeline;
    state.phase = 'running';
    state.starting = null;
    state.idleTimer = setInterval(() => { if (Date.now() - state.lastRequest > IDLE_MS()) stop('nobody is watching'); }, Math.max(50, Math.min(2000, IDLE_MS() / 2)));
    if (state.idleTimer.unref) state.idleTimer.unref();
    return pipeline;
  })();
  return state.starting;
}

// Resolves once ffmpeg has written a playlist with at least one finished segment.
async function waitReady(timeoutMs = 25000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    touch(); // a viewer waiting for the first picture counts as watching
    const p = state.pipeline;
    if (!p) throw new Error(state.error || 'the stream stopped');
    try {
      const m3u8 = fs.readFileSync(path.join(p.dir, 'live.m3u8'), 'utf8');
      if (/#EXTINF/.test(m3u8)) return p;
    } catch { /* not written yet */ }
    await wait(250);
  }
  throw new Error('the stream is taking too long to start');
}

function filePath(name) {
  if (!HLS_FILE.test(name) || !state.pipeline) return null;
  const f = path.join(state.pipeline.dir, name);
  return fs.existsSync(f) ? f : null;
}

function status() {
  const s = settings();
  const browser = findBrowser();
  const ffmpeg = findFfmpeg();
  return {
    enabled: s.enabled, size: s.size, fps: s.fps, sizes: Object.keys(SIZES), fpsOptions: FPS,
    phase: state.phase, error: state.error, viewers: viewers(), idleSeconds: Math.round(IDLE_MS() / 1000),
    requirements: {
      browser: !!browser, ffmpeg: !!ffmpeg, installHint: INSTALL_HINT, docker: IN_DOCKER,
      help: browser && ffmpeg ? '' : installHelp([!browser && 'Chromium', !ffmpeg && 'ffmpeg'].filter(Boolean).join(' and ')),
    },
    available: !!browser && !!ffmpeg,
  };
}

process.on('exit', () => {
  const p = state.pipeline;
  if (p && p.dir) { try { fs.rmSync(p.dir, { recursive: true, force: true }); } catch { /* best effort */ } }
});

module.exports = {
  settings, update, ensureToken, regenerateToken, tokenOk, status, ensure, waitReady, filePath, touch, stop, viewers,
  _internals: { HLS_FILE, SIZES, FPS, findBrowser, findFfmpeg, state, setLauncher: (fn) => { launcher = fn || launchReal; } },
};
