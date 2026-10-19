'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-logos-'));

const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server/app');
const logos = require('../server/logos');
const espn = require('../widgets/espn-fantasy/server');

const realFetch = global.fetch;
let server;
let base;
let outbound; // log of URLs PiDash fetched on our behalf
let handler;  // test-controlled upstream behaviour

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const mockUpstream = (fn) => { handler = fn; };

test.before(async () => {
  logos._internals.setLookup(async (host) => [{ address: host.startsWith('internal') ? '10.0.0.5' : '93.184.216.34', family: 4 }]);
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  global.fetch = (url, init) => {
    if (String(url).startsWith(base)) return realFetch(url, init);
    outbound.push({ url: String(url), cookie: init && init.headers && init.headers.cookie });
    return handler(String(url), init);
  };
});
test.beforeEach(() => { outbound = []; logos._internals.reset(); handler = () => new Response('nope', { status: 500 }); });
test.after(() => { global.fetch = realFetch; server.close(); });

const logoUrl = (w, u) => `${base}/api/logo?w=${encodeURIComponent(w)}&u=${encodeURIComponent(u)}`;
const img = (type, body = PNG, status = 200, extra = {}) => new Response(body, { status, headers: { 'content-type': type, ...extra } });

test('private-address detection', () => {
  const { isPrivateIp } = logos._internals;
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '0.0.0.0']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('only URLs the widget itself returned are served', async () => {
  mockUpstream(() => img('image/png'));
  logos.allow('w1', ['https://g.espncdn.com/a.png']);
  assert.equal((await realFetch(logoUrl('w1', 'https://evil.example.com/x.png'))).status, 403);
  assert.equal((await realFetch(logoUrl('other', 'https://g.espncdn.com/a.png'))).status, 403);
  assert.equal((await realFetch(logoUrl('w1', 'file:///etc/passwd'))).status, 403);
  assert.equal(outbound.length, 0);
  assert.equal((await realFetch(logoUrl('w1', 'https://g.espncdn.com/a.png'))).status, 200);
});

test('serves, caches on disk, and does not refetch', async () => {
  mockUpstream(() => img('image/png'));
  logos.allow('w2', ['https://g.espncdn.com/b.png']);
  const r1 = await realFetch(logoUrl('w2', 'https://g.espncdn.com/b.png'));
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('content-type'), 'image/png');
  assert.equal(r1.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.compare(Buffer.from(await r1.arrayBuffer()), PNG), 0);
  const r2 = await realFetch(logoUrl('w2', 'https://g.espncdn.com/b.png'));
  assert.equal(r2.status, 200);
  assert.equal(outbound.length, 1);
});

test('http logo URLs are upgraded to https first, with fallback to http', async () => {
  mockUpstream((url) => (url.startsWith('https://') ? new Response('', { status: 403 }) : img('image/png')));
  logos.allow('w3', ['http://old.example.com/l.png']);
  assert.equal((await realFetch(logoUrl('w3', 'http://old.example.com/l.png'))).status, 200);
  assert.deepEqual(outbound.map((o) => o.url), ['https://old.example.com/l.png', 'http://old.example.com/l.png']);
});

test('ESPN cookies are sent only to ESPN hosts', async () => {
  mockUpstream(() => img('image/png'));
  logos.allow('w4', ['https://mystique-api.fantasy.espn.com/x.png', 'https://cdn.imgur.example/y.png'], 'SWID={A}; espn_s2=B');
  await realFetch(logoUrl('w4', 'https://mystique-api.fantasy.espn.com/x.png'));
  await realFetch(logoUrl('w4', 'https://cdn.imgur.example/y.png'));
  assert.equal(outbound[0].cookie, 'SWID={A}; espn_s2=B');
  assert.equal(outbound[1].cookie, undefined);
});

test('refuses private hosts, including via redirect', async () => {
  mockUpstream(() => img('image/png'));
  logos.allow('w5', ['https://internal.lan/x.png', 'http://127.0.0.1/x.png', 'https://ok.example.com/r.png']);
  assert.equal((await realFetch(logoUrl('w5', 'https://internal.lan/x.png'))).status, 502);
  assert.equal((await realFetch(logoUrl('w5', 'http://127.0.0.1/x.png'))).status, 502);
  mockUpstream(() => new Response(null, { status: 302, headers: { location: 'https://internal.lan/secret' } }));
  assert.equal((await realFetch(logoUrl('w5', 'https://ok.example.com/r.png'))).status, 502);
  assert.ok(!outbound.some((o) => o.url.includes('internal.lan')));
});

test('follows safe redirects', async () => {
  mockUpstream((url) => (url.endsWith('/old.png') ? new Response(null, { status: 301, headers: { location: '/new.png' } }) : img('image/png')));
  logos.allow('w6', ['https://g.espncdn.com/old.png']);
  assert.equal((await realFetch(logoUrl('w6', 'https://g.espncdn.com/old.png'))).status, 200);
  assert.equal(outbound.length, 2);
});

test('SVG is served with a sandboxing CSP; wrong type and oversize are rejected', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>';
  logos.allow('w7', ['https://g.espncdn.com/a.svg', 'https://g.espncdn.com/page.html', 'https://g.espncdn.com/big.png', 'https://g.espncdn.com/mislabeled.png']);
  mockUpstream(() => img('image/svg+xml', svg));
  const r = await realFetch(logoUrl('w7', 'https://g.espncdn.com/a.svg'));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/svg+xml');
  assert.match(r.headers.get('content-security-policy'), /sandbox/);

  mockUpstream(() => img('text/html', '<html>login</html>'));
  assert.equal((await realFetch(logoUrl('w7', 'https://g.espncdn.com/page.html'))).status, 502);
  mockUpstream(() => img('image/png', Buffer.alloc(3 * 1024 * 1024)));
  assert.equal((await realFetch(logoUrl('w7', 'https://g.espncdn.com/big.png'))).status, 502);
  // CDN says octet-stream but the bytes are a PNG: sniffing rescues it
  mockUpstream(() => img('application/octet-stream', PNG));
  const m = await realFetch(logoUrl('w7', 'https://g.espncdn.com/mislabeled.png'));
  assert.equal(m.status, 200);
  assert.equal(m.headers.get('content-type'), 'image/png');
});

test('failed logos are not retried immediately; a stale cache survives upstream errors', async () => {
  logos.allow('w8', ['https://g.espncdn.com/flaky.png']);
  mockUpstream(() => new Response('', { status: 404 }));
  assert.equal((await realFetch(logoUrl('w8', 'https://g.espncdn.com/flaky.png'))).status, 502);
  const calls = outbound.length;
  assert.equal((await realFetch(logoUrl('w8', 'https://g.espncdn.com/flaky.png'))).status, 502);
  assert.equal(outbound.length, calls); // negative-cached
});

test('ESPN widget rewrites logo URLs to the local proxy and registers them', async () => {
  const league = {
    settings: { name: 'L' }, status: { currentMatchupPeriod: 1 },
    teams: [{ id: 1, name: 'A', logo: 'https://g.espncdn.com/team-a-unique.png', record: { overall: {} } }, { id: 2, name: 'B', logo: '//cdn.example.com/b.png', record: { overall: {} } }, { id: 3, name: 'C', record: { overall: {} } }],
    schedule: [{ matchupPeriodId: 1, home: { teamId: 1, totalPoints: 0 }, away: { teamId: 2, totalPoints: 0 } }],
  };
  mockUpstream((url) => (url.includes('lm-api-reads') ? new Response(JSON.stringify(league), { status: 200 }) : img('image/png')));
  const d = await espn.data({ leagueId: '9', swid: 'X', espnS2: 'Y' }, { widgetId: 'espn-9' });
  assert.match(d.standings[0].logo, /^\/api\/logo\?w=espn-9&u=/);
  assert.equal(d.standings.find((t) => t.id === 3).logo, ''); // none -> initials badge in the client
  assert.match(d.matchups[0].away.logo, /cdn\.example\.com%2Fb\.png/); // protocol-relative normalised to https
  const r = await realFetch(base + d.standings[0].logo);
  assert.equal(r.status, 200);
  const sent = outbound.find((o) => o.url === 'https://g.espncdn.com/team-a-unique.png');
  assert.ok(sent && /SWID=\{X\}/.test(sent.cookie));
});
