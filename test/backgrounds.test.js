'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-bg-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server/app');

let server;
let base;
const BG = path.join(process.env.DATA_DIR, 'backgrounds');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const auth = (pw) => ({ authorization: `Basic ${Buffer.from(`u:${pw}`).toString('base64')}` });
const upload = (name, body, headers = {}) => fetch(`${base}/api/admin/backgrounds?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'image/jpeg', ...headers }, body });
const list = (headers = {}) => fetch(`${base}/api/admin/backgrounds`, { headers }).then((r) => r.json());
const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}) }, body: o.body && JSON.stringify(o.body) });

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('upload, list (sorted), serve safely, and delete', async () => {
  assert.deepEqual(await list(), []);
  let r = await upload('Beach Sunset.jpg', JPG);
  assert.equal(r.status, 200);
  const first = await r.json();
  assert.equal(first.name, 'Beach Sunset.jpg');
  assert.equal((await upload('alpha.png', PNG, { 'content-type': 'image/png' })).status, 200);
  assert.equal((await upload('moving.gif', GIF)).status, 200);
  assert.equal((await upload('web.webp', WEBP)).status, 200);

  const files = await list();
  assert.deepEqual(files.map((f) => f.name), ['alpha.png', 'Beach Sunset.jpg', 'moving.gif', 'web.webp']); // case-insensitive name order
  assert.ok(files.every((f) => f.size > 0 && f.url.startsWith('/backgrounds/')));

  // served to the display with nosniff, and the public list (used by the display) is sorted too
  const img = await fetch(base + files[0].url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  const pub = await (await fetch(`${base}/api/backgrounds`)).json();
  assert.deepEqual(pub.map(decodeURIComponent), files.map((f) => f.url).map(decodeURIComponent));

  // delete
  r = await fetch(`${base}/api/admin/backgrounds/${encodeURIComponent('moving.gif')}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal((await list()).length, 3);
  assert.equal((await fetch(`${base}/api/admin/backgrounds/${encodeURIComponent('moving.gif')}`, { method: 'DELETE' })).status, 404);
});

test('the real file type is checked (extension and Content-Type are ignored); SVG, text and empty uploads are refused', async () => {
  assert.equal((await upload('evil.jpg', SVG)).status, 415);                       // SVG disguised as a jpg
  assert.equal((await upload('notes.png', Buffer.from('just some text'))).status, 415);
  assert.equal((await upload('empty.jpg', Buffer.alloc(0))).status, 400);
  assert.equal((await upload('x.svg', SVG, { 'content-type': 'image/svg+xml' })).status, 415);
  // a PNG named .jpg is stored with its true extension
  const r = await (await upload('mislabeled.jpg', PNG, { 'content-type': 'application/octet-stream' })).json();
  assert.equal(r.name, 'mislabeled.png');
  assert.ok(!fs.readdirSync(BG).some((f) => /\.svg$/i.test(f)));
});

test('file names are sanitized (no path tricks) and made unique', async () => {
  const names = [];
  for (const raw of ['../../etc/passwd.png', '..\\..\\boot.jpg', 'a/b/c.jpg', '  <script>alert(1)</script>.jpg', '', '....jpg']) {
    const r = await upload(raw, JPG);
    assert.equal(r.status, 200, raw);
    names.push((await r.json()).name);
  }
  for (const n of names) {
    assert.match(n, /^[A-Za-z0-9 _-]+(-\d+)?\.jpg$/, n);          // plain safe characters only
    assert.ok(fs.existsSync(path.join(BG, n)));
  }
  assert.equal(new Set(names).size, names.length, 'duplicates get -2, -3 ...');
  // nothing was written outside the backgrounds folder
  assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR, 'etc')) && !fs.existsSync(path.join(process.env.DATA_DIR, '..', 'passwd.png')));
  const same = await Promise.all([1, 2, 3].map(() => upload('twin.jpg', JPG).then((r) => r.json())));
  assert.deepEqual(same.map((s) => s.name).sort(), ['twin-2.jpg', 'twin-3.jpg', 'twin.jpg'].sort());
});

test('delete refuses paths and non-images', async () => {
  for (const bad of ['..%2F..%2Fconfig.json', '%2Fetc%2Fpasswd', 'config.json', 'a%5Cb.jpg']) {
    const r = await fetch(`${base}/api/admin/backgrounds/${bad}`, { method: 'DELETE' });
    assert.ok([400, 404].includes(r.status), `${bad} -> ${r.status}`);
  }
  assert.ok(fs.existsSync(require('../server/config').CONFIG_FILE), 'config.json untouched');
});

test('only the admin can upload, list or delete once a password is set', async () => {
  const cfg = await (await j('/api/admin/config')).json();
  cfg.admin = { newPassword: 'pw123' };
  assert.equal((await j('/api/admin/config', { method: 'PUT', body: cfg })).status, 200);

  assert.equal((await upload('nope.jpg', JPG)).status, 401);
  assert.equal((await fetch(`${base}/api/admin/backgrounds`)).status, 401);
  assert.equal((await fetch(`${base}/api/admin/backgrounds/alpha.png`, { method: 'DELETE' })).status, 401);
  assert.equal((await upload('yes.jpg', JPG, auth('pw123'))).status, 200);
  assert.ok((await list(auth('pw123'))).some((f) => f.name === 'yes.jpg'));
  // the display itself can still read the public list and the photos
  assert.equal((await fetch(`${base}/api/backgrounds`)).status, 200);
  await j('/api/admin/config', { method: 'PUT', headers: auth('pw123'), body: { admin: { newPassword: '' } } });
});

test('a photo upload makes open displays reload (SSE broadcast)', async () => {
  const events = [];
  const ac = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: ac.signal });
  const reader = res.body.getReader();
  const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; events.push(Buffer.from(value).toString()); } } catch { /* aborted */ } })();
  await new Promise((r) => setTimeout(r, 200));
  await upload('broadcast.jpg', JPG);
  await new Promise((r) => setTimeout(r, 300));
  ac.abort();
  await pump;
  assert.ok(events.join('').includes('event: config'), 'displays are told to reload');
});

test('the new display settings are validated and clamped when saved', async () => {
  const cfg = await (await j('/api/admin/config')).json();
  Object.assign(cfg.display, {
    themeMode: 'chaos', randomEvery: 'minute', randomPool: ['ocean', 'ocean', 'x y', '<b>', 'rose', 'a'.repeat(99)],
    randomSeasonal: 'yes', seasonHemisphere: 'east', gradientStyle: 'spiral', gradientAngle: 5000, photoOrder: 'zigzag',
    photoDim: 500, photoBlur: -3, photoFit: 'stretch', photoFade: 99, photoSeconds: 1,
  });
  await j('/api/admin/config', { method: 'PUT', body: cfg });
  const d = (await (await j('/api/display')).json()).display;
  assert.deepEqual([d.themeMode, d.randomEvery, d.seasonHemisphere, d.gradientStyle, d.photoOrder, d.photoFit], ['fixed', 'day', 'north', 'linear', 'random', 'cover']);
  assert.equal(d.randomSeasonal, false);                       // only a real true counts
  assert.deepEqual(d.randomPool, ['ocean', 'rose']);           // de-duplicated, only plain theme-name-like strings
  assert.deepEqual([d.gradientAngle, d.photoDim, d.photoBlur, d.photoFade, d.photoSeconds], [360, 90, 0, 10, 5]);
  // good values round-trip, and blank dim means "theme default"
  Object.assign(cfg.display, { themeMode: 'random', randomEvery: 'hour', randomPool: ['ocean'], randomSeasonal: true, gradientStyle: 'radial', gradientAngle: 90, photoDim: '', photoBlur: 8, photoFit: 'contain', photoFade: 1.5, photoOrder: 'name', photoSeconds: 30 });
  await j('/api/admin/config', { method: 'PUT', body: cfg });
  const g = (await (await j('/api/display')).json()).display;
  assert.deepEqual([g.themeMode, g.randomEvery, g.randomSeasonal, g.gradientStyle, g.gradientAngle, g.photoDim, g.photoBlur, g.photoFit, g.photoFade, g.photoOrder, g.photoSeconds],
    ['random', 'hour', true, 'radial', 90, '', 8, 'contain', 1.5, 'name', 30]);
});
