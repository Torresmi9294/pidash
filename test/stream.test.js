'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-strm-'));
process.env.PIDASH_STREAM_IDLE_MS = '600';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createApp } = require('../server/app');
const stream = require('../server/stream');
const wsClient = require('../server/ws-client');

const { state, setLauncher } = stream._internals;
let server;
let base;
const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json' }, body: o.body && JSON.stringify(o.body) });

// A pretend pipeline: a folder with a playlist and one segment, no browser or ffmpeg involved.
let launches;
function fakeLauncher(opts = {}) {
  return async (args) => {
    launches.push(args);
    if (opts.fail) throw new Error(opts.fail(launches.length));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-hls-'));
    fs.writeFileSync(path.join(dir, 'live.m3u8'), '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.000000,\nseg_00000.ts\n');
    fs.writeFileSync(path.join(dir, 'seg_00000.ts'), Buffer.from([0x47, 0x40, 0x00, 0x10]));
    return { dir, stop: async () => fs.rmSync(dir, { recursive: true, force: true }), set onExit(fn) { this._exit = fn; } };
  };
}

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await stream.stop(); server.close(); });
test.beforeEach(async () => {
  launches = [];
  await stream.stop('settings changed');
  state.retryAt = 0;
  state.noSandbox = false;
  setLauncher(fakeLauncher());
  await j('/api/admin/stream', { method: 'PUT', body: { enabled: false, size: '1280x720', fps: 5 } });
});

test('settings: off by default, validated, and enabling makes a private token', async () => {
  let s = await (await j('/api/admin/stream')).json();
  assert.equal(s.enabled, false);
  assert.equal(s.token, '', 'no token until it is enabled');
  assert.deepEqual(s.sizes, ['854x480', '1280x720', '1920x1080']);
  assert.deepEqual(s.fpsOptions, [2, 5, 10, 15]);

  assert.equal((await j('/api/admin/stream', { method: 'PUT', body: { size: '4000x3000' } })).status, 400);
  assert.equal((await j('/api/admin/stream', { method: 'PUT', body: { fps: 60 } })).status, 400);

  s = await (await j('/api/admin/stream', { method: 'PUT', body: { enabled: true, size: '854x480', fps: 10 } })).json();
  assert.match(s.token, /^[0-9a-f]{32}$/);
  assert.deepEqual([s.enabled, s.size, s.fps], [true, '854x480', 10]);
  const again = await (await j('/api/admin/stream', { method: 'PUT', body: { fps: 2 } })).json();
  assert.equal(again.token, s.token, 'the link stays the same when other settings change');

  const fresh = await (await j('/api/admin/stream/token', { method: 'POST' })).json();
  assert.match(fresh.token, /^[0-9a-f]{32}$/);
  assert.notEqual(fresh.token, s.token);
});

test('links only work with the right token and only while the stream is enabled', async () => {
  const on = await (await j('/api/admin/stream', { method: 'PUT', body: { enabled: true } })).json();
  const bad = '0'.repeat(32);
  for (const f of ['playlist.m3u', 'live.m3u8', 'seg_00000.ts']) assert.equal((await fetch(`${base}/stream/${bad}/${f}`)).status, 404, `wrong token: ${f}`);
  assert.equal((await fetch(`${base}/stream/${on.token.slice(0, 31)}/playlist.m3u`)).status, 404, 'a prefix of the token is not enough');
  assert.equal(launches.length, 0, 'a wrong token never starts anything');

  await j('/api/admin/stream', { method: 'PUT', body: { enabled: false } });
  assert.equal((await fetch(`${base}/stream/${on.token}/playlist.m3u`)).status, 404, 'switched off: the old link is dead');
  assert.equal((await fetch(`${base}/stream/${on.token}/live.m3u8`)).status, 404);
});

test('the M3U playlist is one channel pointing at the stream, using the address it was asked on', async () => {
  const { token } = await (await j('/api/admin/stream', { method: 'PUT', body: { enabled: true } })).json();
  const res = await fetch(`${base}/stream/${token}/playlist.m3u`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /audio\/x-mpegurl/);
  const text = await res.text();
  assert.match(text, /^#EXTM3U\n#EXTINF:-1 tvg-id="pidash" tvg-name="[^"\n]*" group-title="PiDash",[^\n]*\n/);
  assert.ok(text.trim().endsWith(`${base}/stream/${token}/live.m3u8`), text);
  assert.equal(launches.length, 0, 'fetching the playlist does not start the stream');
  const proxied = await (await fetch(`${base}/stream/${token}/playlist.m3u`, { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'dash.example.com' } })).text();
  assert.ok(proxied.trim().endsWith(`https://dash.example.com/stream/${token}/live.m3u8`), 'works behind a reverse proxy');
});

test('asking for the stream starts it; the playlist and segments are served with HLS types; it stops when nobody watches', async () => {
  const { token } = await (await j('/api/admin/stream', { method: 'PUT', body: { enabled: true, size: '854x480', fps: 2 } })).json();
  const res = await fetch(`${base}/stream/${token}/live.m3u8`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/vnd.apple.mpegurl');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('cache-control'), /no-cache/);
  assert.match(await res.text(), /seg_00000\.ts/);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].baseUrl, `http://127.0.0.1:${server.address().port}/?stream=1`, 'it shows the stream copy of the display');
  assert.deepEqual([launches[0].size, launches[0].fps], ['854x480', 2]);

  const seg = await fetch(`${base}/stream/${token}/seg_00000.ts`);
  assert.equal(seg.status, 200);
  assert.equal(seg.headers.get('content-type'), 'video/mp2t');
  assert.deepEqual([...new Uint8Array(await seg.arrayBuffer())], [0x47, 0x40, 0x00, 0x10]);
  assert.equal((await fetch(`${base}/stream/${token}/seg_00099.ts`)).status, 404, 'a segment that does not exist');

  assert.equal(stream.status().phase, 'running');
  assert.equal(stream.status().viewers, 1);
  await fetch(`${base}/stream/${token}/live.m3u8`);
  assert.equal(launches.length, 1, 'a second viewer shares the same pipeline');

  const dir = state.pipeline.dir;
  await new Promise((r) => setTimeout(r, 1800)); // idle limit is 0.6s in this test
  assert.equal(stream.status().phase, 'stopped', 'nobody is watching any more');
  assert.equal(fs.existsSync(dir), false, 'and its files are removed');
  await fetch(`${base}/stream/${token}/live.m3u8`);
  assert.equal(launches.length, 2, 'the next viewer starts it again');
});

test('only the playlist and numbered segments can be fetched: no other file names, no path tricks', async () => {
  const { token } = await (await j('/api/admin/stream', { method: 'PUT', body: { enabled: true } })).json();
  await fetch(`${base}/stream/${token}/live.m3u8`);
  for (const f of ['..%2Fconfig.json', '%2e%2e%2f%2e%2e%2fconfig.json', 'profile', 'live.m3u8.bak', 'seg_1.ts.bak', 'seg_.ts', 'SEG_00000.TS', 'seg_123456789.ts']) {
    const r = await fetch(`${base}/stream/${token}/${f}`);
    assert.ok([404, 400].includes(r.status), `${f} -> ${r.status}`);
  }
  assert.ok(stream._internals.HLS_FILE.test('seg_00001.ts') && stream._internals.HLS_FILE.test('live.m3u8'));
  assert.ok(!stream._internals.HLS_FILE.test('../live.m3u8') && !stream._internals.HLS_FILE.test('seg_00001.ts/../x'));
});

test('a failure to start is reported, not hidden, and is retried after a short pause', async () => {
  const { token } = await (await j('/api/admin/stream', { method: 'PUT', body: { enabled: true } })).json();
  setLauncher(fakeLauncher({ fail: () => 'Streaming needs ffmpeg installed on this device (sudo apt install -y chromium ffmpeg).' }));
  const res = await fetch(`${base}/stream/${token}/live.m3u8`);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '3');
  assert.match(await res.text(), /needs ffmpeg/);
  assert.equal(stream.status().phase, 'error');
  assert.match(stream.status().error, /ffmpeg/);
  await fetch(`${base}/stream/${token}/live.m3u8`);
  assert.equal(launches.length, 1, 'not hammered while it is failing');
  state.retryAt = 0;
  setLauncher(fakeLauncher());
  assert.equal((await fetch(`${base}/stream/${token}/live.m3u8`)).status, 200, 'works once the problem is fixed');
  assert.equal(stream.status().error, null);
});

test('if the browser\'s sandbox cannot start (a locked-down service) it retries without it, once', async () => {
  const { token } = await (await j('/api/admin/stream', { method: 'PUT', body: { enabled: true } })).json();
  let n = 0;
  setLauncher(async (args) => {
    n++;
    if (n === 1) { launches.push(args); throw new Error('the browser stopped before it was ready: No usable sandbox!'); }
    return fakeLauncher()(args); // records its own call
  });
  assert.equal((await fetch(`${base}/stream/${token}/live.m3u8`)).status, 200);
  assert.deepEqual(launches.map((l) => l.noSandbox), [false, true]);
  assert.equal(state.noSandbox, true, 'remembered, so the next start does not fail first');

  await stream.stop('settings changed');
  launches = [];
  await fetch(`${base}/stream/${token}/live.m3u8`);
  assert.equal(launches[0].noSandbox, true);
  // other failures do not drop the sandbox
  state.noSandbox = false;
  await stream.stop('settings changed');
  setLauncher(async () => { throw new Error('ffmpeg stopped (exit 1)'); });
  assert.equal((await fetch(`${base}/stream/${token}/live.m3u8`)).status, 503);
  assert.equal(state.noSandbox, false);
});

test('changing a setting or the link stops a running stream so the next viewer gets the new one', async () => {
  const { token } = await (await j('/api/admin/stream', { method: 'PUT', body: { enabled: true } })).json();
  await fetch(`${base}/stream/${token}/live.m3u8`);
  assert.equal(stream.status().phase, 'running');
  await j('/api/admin/stream', { method: 'PUT', body: { fps: 10 } });
  assert.equal(stream.status().phase, 'stopped');
  await fetch(`${base}/stream/${token}/live.m3u8`);
  assert.equal(launches.at(-1).fps, 10);
  const fresh = await (await j('/api/admin/stream/token', { method: 'POST' })).json();
  assert.equal(stream.status().phase, 'stopped');
  assert.equal((await fetch(`${base}/stream/${token}/live.m3u8`)).status, 404, 'the old link is dead');
  assert.equal((await fetch(`${base}/stream/${fresh.token}/live.m3u8`)).status, 200);
});

test('status reports whether the tools are installed, with the command to get them', () => {
  const s = stream.status();
  assert.equal(typeof s.requirements.browser, 'boolean');
  assert.equal(typeof s.requirements.ffmpeg, 'boolean');
  assert.equal(s.requirements.installHint, 'sudo apt install -y chromium ffmpeg');
  assert.equal(s.available, s.requirements.browser && s.requirements.ffmpeg);
});

test('display: the streamed copy never goes to sleep; admin has a Stream tab with the links', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  assert.match(read('public', 'dash.js'), /URLSearchParams\(location\.search\)\.has\('stream'\)\) return/);
  const admin = read('public', 'admin', 'admin.js');
  assert.match(admin, /stream: 'Stream'/);
  assert.match(admin, /playlist\.m3u/);
  assert.match(admin, /live\.m3u8/);
  assert.match(admin, /Make a new link/);
});

// ---- the WebSocket client (used to drive the headless browser) ------------------------------------------------------
function wsServer(onConnect) {
  const srv = http.createServer();
  srv.on('upgrade', (req, socket) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.on('error', () => {}); // the client hanging up abruptly is expected
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const frame = (op, payload, fin = true) => {
      const n = payload.length;
      const head = n < 126 ? Buffer.from([(fin ? 0x80 : 0) | op, n]) : n < 65536 ? Buffer.from([(fin ? 0x80 : 0) | op, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = (fin ? 0x80 : 0) | op; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
      return Buffer.concat([head, payload]); // server frames are not masked
    };
    const received = [];
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        let len = buf[1] & 127; let off = 2;
        if (len === 126) { len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + 4 + len) return;
        const key = buf.subarray(off, off + 4);
        const body = Buffer.from(buf.subarray(off + 4, off + 4 + len));
        for (let i = 0; i < body.length; i++) body[i] ^= key[i & 3];
        received.push({ op: buf[0] & 15, masked: (buf[1] & 128) !== 0, text: body.toString() });
        buf = buf.subarray(off + 4 + len);
      }
    });
    onConnect({ socket, frame, received });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `ws://127.0.0.1:${srv.address().port}/devtools/page/X` })));
}

test('ws client: handshake, small / medium / huge text frames, fragmented messages, ping, and masked sends', async () => {
  let conn;
  const { srv, url } = await wsServer((c) => { conn = c; });
  const client = await wsClient.connect(url);
  const got = [];
  client.on('message', (m) => got.push(m));
  try {
  await new Promise((r) => setTimeout(r, 50));

  const big = 'x'.repeat(70000);
  conn.socket.write(conn.frame(1, Buffer.from('hello')));
  conn.socket.write(conn.frame(1, Buffer.from('y'.repeat(300))));
  conn.socket.write(conn.frame(1, Buffer.from(big)));
  conn.socket.write(conn.frame(1, Buffer.from('frag'), false));
  conn.socket.write(conn.frame(0, Buffer.from('men'), false));
  conn.socket.write(conn.frame(0, Buffer.from('ted'), true));
  conn.socket.write(conn.frame(9, Buffer.from('p')));            // ping
  conn.socket.write(conn.frame(1, Buffer.from('é✓')));            // multi-byte text
  const blob = conn.frame(1, Buffer.from('split across packets'));
  conn.socket.write(blob.subarray(0, 5));
  await new Promise((r) => setTimeout(r, 30));
  conn.socket.write(blob.subarray(5));
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(got.map((g) => g.length), [5, 300, 70000, 10, 2, 20]);
  assert.equal(got[3], 'fragmented');
  assert.equal(got[4], 'é✓');
  assert.equal(got[5], 'split across packets');

  client.send('ping from client');
  client.send('z'.repeat(70000));
  await new Promise((r) => setTimeout(r, 200));
  const texts = conn.received.filter((f) => f.op === 1);
  assert.deepEqual(texts.map((f) => f.text.length), [16, 70000]);
  assert.ok(conn.received.every((f) => f.masked), 'everything a client sends is masked');
  assert.ok(conn.received.some((f) => f.op === 10), 'answered the ping with a pong');
  } finally {
    client.close();
    conn.socket.destroy();
    srv.close();
  }
});

test('ws client: refuses a server that does not speak WebSocket, and reports closes', async () => {
  const plain = http.createServer((req, res) => res.end('hi'));
  await new Promise((r) => plain.listen(0, '127.0.0.1', r));
  await assert.rejects(wsClient.connect(`ws://127.0.0.1:${plain.address().port}/x`), /refused|handshake/);
  plain.close();
  await assert.rejects(wsClient.connect('wss://127.0.0.1:1/x'), /ws:\/\//);

  let conn;
  const { srv, url } = await wsServer((c) => { conn = c; });
  const client = await wsClient.connect(url);
  const closed = new Promise((r) => client.on('close', r));
  await new Promise((r) => setTimeout(r, 30));
  conn.socket.end();
  await closed;
  assert.equal(client.closed, true);
  srv.close();
});

// ---- the real thing: headless Chrome + ffmpeg (opt in: PIDASH_E2E_STREAM=1; needs both installed) ---------------------
const real = process.env.PIDASH_E2E_STREAM === '1' && stream._internals.findBrowser() && stream._internals.findFfmpeg();
test('end to end: a real browser and ffmpeg produce an H.264 + AAC HLS stream of the dashboard', { skip: !real, timeout: 90000 }, async () => {
  setLauncher(null); // the real pipeline
  const { token } = await (await j('/api/admin/stream', { method: 'PUT', body: { enabled: true, size: '854x480', fps: 5 } })).json();
  const res = await fetch(`${base}/stream/${token}/live.m3u8`);
  assert.equal(res.status, 200, await res.clone().text());
  const list = await res.text();
  assert.match(list, /#EXTINF:/);
  const seg = list.split('\n').find((l) => l.endsWith('.ts'));
  const bytes = Buffer.from(await (await fetch(`${base}/stream/${token}/${seg}`)).arrayBuffer());
  assert.ok(bytes.length > 1000);
  assert.equal(bytes[0], 0x47, 'MPEG-TS sync byte');
  const file = path.join(os.tmpdir(), `pidash-e2e-${process.pid}.ts`);
  fs.writeFileSync(file, bytes);
  try {
    const out = require('node:child_process').execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,pix_fmt,color_range', '-of', 'compact', file]).toString();
    assert.match(out, /codec_name=h264/);
    assert.match(out, /width=854/);
    assert.match(out, /pix_fmt=yuv420p/);
    assert.match(out, /color_range=tv/);
    assert.match(out, /codec_name=aac/);
  } finally {
    fs.rmSync(file, { force: true });
  }
  const dir = state.pipeline.dir;
  await stream.stop('test over');
  assert.equal(fs.existsSync(dir), false);
});

test('in Docker: missing tools point at the stream image, and Chromium starts without its (impossible) sandbox', () => {
  // module-level settings, so check in a fresh process that looks like the container; PATH has no ffmpeg
  const code = `
    process.env.DATA_DIR = ${JSON.stringify(process.env.DATA_DIR)};
    const s = require(${JSON.stringify(path.join(__dirname, '..', 'server', 'stream.js'))});
    const st = s.status();
    console.log(JSON.stringify({ docker: st.requirements.docker, ffmpeg: st.requirements.ffmpeg, help: st.requirements.help, hint: st.requirements.installHint, noSandbox: s._internals.state.noSandbox }));`;
  const out = require('node:child_process').spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8', env: { PATH: path.dirname(process.execPath), PIDASH_INSTALL: 'docker', SystemRoot: process.env.SystemRoot || '' },
  });
  const r = JSON.parse(out.stdout.trim().split('\n').pop());
  assert.equal(r.docker, true);
  assert.equal(r.ffmpeg, false);
  assert.match(r.help, /Streaming needs .*ffmpeg.* in the container/);
  assert.match(r.help, /ghcr\.io\/torresmi9294\/pidash:stream/);
  assert.match(r.help, /docker compose pull && docker compose up -d/);
  assert.match(r.help, /PIDASH_STREAM=1/);
  assert.doesNotMatch(r.help, /apt install/);
  assert.equal(r.noSandbox, true);
  // and outside Docker the help is the apt command
  assert.match(stream.status().requirements.installHint, /apt install -y chromium ffmpeg/);
  assert.equal(stream._internals.state.noSandbox, false);
});

test('Docker files: the stream image adds Chromium + ffmpeg only when asked, and compose can ask for it', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const df = read('Dockerfile');
  assert.match(df, /ARG STREAM=0/);
  assert.match(df, /\[ "\$STREAM" = "1" \]/);
  assert.match(df, /apk add --no-cache ffmpeg/);
  assert.match(df, /apk add --no-cache chromium/);
  assert.match(read('docker-compose.yml'), /STREAM: \$\{PIDASH_STREAM:-0\}/);
  assert.match(read('.env.example'), /PIDASH_STREAM=0/);
  assert.match(read('deploy', 'docker-compose.yml'), /pidash:stream/);
  const wf = read('.github', 'workflows', 'docker.yml');
  assert.match(wf, /STREAM=1/);
  assert.match(wf, /needs: stream-smoke/, 'the stream image is only published after the smoke test passes');
  assert.match(wf, /value=stream/);
  assert.match(read('docs', 'DOCKER.md'), /ghcr\.io\/torresmi9294\/pidash:stream/);
});
