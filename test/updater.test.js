'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pidash-updr-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.PIDASH_INSTALL = 'systemd';
process.env.PIDASH_VERSION_FILE = path.join(tmp, '.version');
process.env.PIDASH_UPDATE_DIR = tmp;
process.env.PIDASH_UPDATE_STATUS = path.join(tmp, 'status.json');
process.env.PIDASH_UPDATE_HELPER = path.join(tmp, 'helper-marker');

const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server/app');
const updater = require('../server/updater');

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const realFetch = global.fetch;
let server; let base; let github; let githubCalls;
const auth = (pw) => ({ authorization: `Basic ${Buffer.from(`u:${pw}`).toString('base64')}` });
const api = async (p, opts = {}) => {
  const res = await realFetch(base + p, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const commit = (sha, msg) => ({ sha, html_url: `https://github.com/x/y/commit/${sha}`, commit: { message: `${msg}\n\nbody`, committer: { date: '2026-10-20T10:00:00Z' } } });

test.before(async () => {
  global.fetch = async (url, opts) => {
    if (!String(url).startsWith('https://api.github.com/')) return realFetch(url, opts);
    githubCalls.push(String(url));
    const r = github(String(url));
    if (typeof r === 'number') return new Response('{}', { status: r, headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) } });
    return new Response(JSON.stringify(r), { status: 200 });
  };
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { global.fetch = realFetch; server.close(); });
test.beforeEach(() => {
  updater._reset();
  githubCalls = [];
  for (const f of ['.version', 'status.json', 'update.request', 'helper-marker']) fs.rmSync(path.join(tmp, f), { force: true });
  fs.writeFileSync(path.join(tmp, '.version'), JSON.stringify({ sha: OLD }));
  fs.writeFileSync(path.join(tmp, 'helper-marker'), '');
  github = (url) => (url.includes('/compare/')
    ? { status: 'ahead', commits: [{ sha: 'c'.repeat(40), commit: { message: 'first', author: { date: 'd' } } }, { sha: NEW, commit: { message: 'second', author: { date: 'd' } } }] }
    : commit(NEW, 'Add a thing'));
});

test('reports an available update with newest-first changes', async () => {
  const { status, body } = await api('/api/admin/update/status');
  assert.equal(status, 200);
  assert.equal(body.state, 'update-available');
  assert.equal(body.current.short, 'aaaaaaa');
  assert.equal(body.latest.short, 'bbbbbbb');
  assert.equal(body.latest.message, 'Add a thing');
  assert.deepEqual(body.changes.map((c) => c.message), ['second', 'first']);
});

test('says up to date when the shas match, and skips the compare call', async () => {
  fs.writeFileSync(path.join(tmp, '.version'), JSON.stringify({ sha: NEW }));
  const { body } = await api('/api/admin/update/status');
  assert.equal(body.state, 'up-to-date');
  assert.ok(!githubCalls.some((u) => u.includes('/compare/')));
});

test('caches GitHub answers; force re-checks but is rate limited to one per 15s', async () => {
  await api('/api/admin/update/status');
  await api('/api/admin/update/status');
  assert.equal(githubCalls.filter((u) => u.includes('/commits/')).length, 1);
  await api('/api/admin/update/status?force=1'); // within 15s of the last call -> still cached
  assert.equal(githubCalls.filter((u) => u.includes('/commits/')).length, 1);
});

test('unknown installed version is reported, and an unknown commit (404 compare) is not fatal', async () => {
  fs.rmSync(path.join(tmp, '.version'));
  let r = await api('/api/admin/update/status');
  assert.equal(r.body.state, 'unknown-current');
  assert.equal(r.body.current, null);
  updater._reset();
  fs.writeFileSync(path.join(tmp, '.version'), JSON.stringify({ sha: OLD }));
  github = (url) => (url.includes('/compare/') ? 404 : commit(NEW, 'x'));
  r = await api('/api/admin/update/status');
  assert.equal(r.body.state, 'update-available');
  assert.deepEqual(r.body.changes, []);
});

test('GitHub failures become a readable error, not a 500', async () => {
  github = () => 403;
  let r = await api('/api/admin/update/status');
  assert.equal(r.status, 200);
  assert.match(r.body.error, /rate-limiting.*10 minutes/);
  assert.equal(r.body.state, 'unknown');
  updater._reset();
  github = () => 404;
  r = await api('/api/admin/update/status');
  assert.match(r.body.error, /Could not find/);
});

test('install is refused without an admin password', async () => {
  const r = await api('/api/admin/update/install', { method: 'POST' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /admin password/);
  assert.ok(!fs.existsSync(path.join(tmp, 'update.request')));
});

test('with a password: install needs auth, writes one request, then reports busy', async () => {
  await api('/api/admin/config', { method: 'PUT', body: JSON.stringify({ ...(await api('/api/admin/config')).body, admin: { newPassword: 'pw' } }) });
  assert.equal((await api('/api/admin/update/install', { method: 'POST' })).status, 401);
  const s = await api('/api/admin/update/status', { headers: auth('pw') });
  assert.equal(s.body.canInstall, true);
  const ok = await api('/api/admin/update/install', { method: 'POST', headers: auth('pw') });
  assert.equal(ok.status, 200);
  assert.ok(fs.existsSync(path.join(tmp, 'update.request')));
  const again = await api('/api/admin/update/install', { method: 'POST', headers: auth('pw') });
  assert.equal(again.status, 409);
  // the helper's status file is passed through, and a stale "running" is turned into a failure
  fs.rmSync(path.join(tmp, 'update.request'));
  fs.writeFileSync(path.join(tmp, 'status.json'), JSON.stringify({ state: 'running', message: 'Downloading', at: new Date().toISOString() }));
  assert.equal((await api('/api/admin/update/status', { headers: auth('pw') })).body.helper.state, 'running');
  fs.writeFileSync(path.join(tmp, 'status.json'), JSON.stringify({ state: 'running', message: 'Downloading', at: new Date(Date.now() - 3600e3).toISOString() }));
  assert.equal((await api('/api/admin/update/status', { headers: auth('pw') })).body.helper.state, 'failed');
  // put the password back to empty for isolation
  fs.rmSync(path.join(tmp, 'status.json'));
  await api('/api/admin/config', { method: 'PUT', headers: auth('pw'), body: JSON.stringify({ ...(await api('/api/admin/config', { headers: auth('pw') })).body, admin: { newPassword: '' } }) });
});

test('without the helper installed, install explains the one-time step', async () => {
  fs.rmSync(path.join(tmp, 'helper-marker'));
  const s = await api('/api/admin/update/status');
  assert.equal(s.body.canInstall, false);
  assert.equal(s.body.blocker.code, 'no-helper');
  assert.match(s.body.blocker.text, /install\.sh/);
});
