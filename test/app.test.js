'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-'));

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createApp } = require('../server/app');

let server;
let base;
const auth = (pw) => ({ authorization: `Basic ${Buffer.from(`u:${pw}`).toString('base64')}` });
const j = async (path, opts = {}) => {
  const res = await fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, body: opts.body && JSON.stringify(opts.body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test.before(async () => {
  // Install the example third-party widget the way a user would.
  const fs = require('fs');
  const path = require('path');
  fs.cpSync(path.join(__dirname, '..', 'examples', 'hello-widget'), path.join(process.env.DATA_DIR, 'widgets', 'hello'), { recursive: true });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('display config lists default widgets and hides nothing sensitive', async () => {
  const { status, body } = await j('/api/display');
  assert.equal(status, 200);
  assert.deepEqual(body.widgets.map((w) => w.type), ['clock', 'weather', 'calendar', 'reminders']);
  assert.ok(body.widgets.find((w) => w.type === 'clock').clientOnly);
});

test('widget client scripts are served', async () => {
  for (const t of ['clock', 'weather', 'calendar', 'reminders', 'espn-fantasy', 'rss']) {
    const res = await fetch(`${base}/widget-client/${t}.js`);
    assert.equal(res.status, 200, t);
  }
  assert.equal((await fetch(`${base}/widget-client/nope.js`)).status, 404);
});

test('secret options are masked, kept on unchanged save, and excluded from the display API', async () => {
  const cfg = (await j('/api/admin/config')).body;
  cfg.widgets.push({ id: 'espn-t', type: 'espn-fantasy', enabled: true, slot: 'rotate', options: { leagueId: '1', swid: '{ABC}', espnS2: 'secretvalue' } });
  const saved = (await j('/api/admin/config', { method: 'PUT', body: cfg })).body;
  const w = saved.widgets.find((x) => x.id === 'espn-t');
  assert.equal(w.options.swid, '__SET__');
  assert.equal(w.options.leagueId, '1');

  // saving again with masks must not overwrite the real value
  await j('/api/admin/config', { method: 'PUT', body: saved });
  const raw = JSON.parse(require('fs').readFileSync(require('../server/config').CONFIG_FILE, 'utf8'));
  assert.equal(raw.widgets.find((x) => x.id === 'espn-t').options.espnS2, 'secretvalue');

  const display = (await j('/api/display')).body;
  const pub = display.widgets.find((x) => x.id === 'espn-t').options;
  assert.equal(pub.swid, undefined);
  assert.equal(pub.espnS2, undefined);
  assert.equal(pub.leagueId, '1');
});

test('rejects unknown widget types', async () => {
  const cfg = (await j('/api/admin/config')).body;
  cfg.widgets.push({ id: 'x', type: 'does-not-exist', options: {} });
  assert.equal((await j('/api/admin/config', { method: 'PUT', body: cfg })).status, 400);
});

test('reminders flow through to the widget data endpoint', async () => {
  const r = await j('/api/admin/reminders', { method: 'POST', body: { text: 'Buy milk', due: '2030-01-01' } });
  assert.equal(r.status, 200);
  const data = await j('/api/widgets/reminders-1/data');
  assert.equal(data.body.items[0].text, 'Buy milk');
  await j(`/api/admin/reminders/${r.body.id}`, { method: 'PATCH', body: { done: true } });
  assert.equal((await j('/api/widgets/reminders-1/data')).body.items.length, 0);
  assert.equal((await j('/api/admin/reminders', { method: 'POST', body: { text: '  ' } })).status, 400);
});

test('admin password protects /api/admin and /admin but not the display', async () => {
  const cfg = (await j('/api/admin/config')).body;
  cfg.admin = { newPassword: 'hunter2' };
  assert.equal((await j('/api/admin/config', { method: 'PUT', body: cfg })).status, 200);

  assert.equal((await j('/api/admin/config')).status, 401);
  assert.equal((await fetch(`${base}/admin/`)).status, 401);
  assert.equal((await j('/api/admin/config', { headers: auth('wrong') })).status, 401);
  assert.equal((await j('/api/admin/config', { headers: auth('hunter2') })).status, 200);
  assert.equal((await j('/api/display')).status, 200);
  assert.equal((await fetch(`${base}/`)).status, 200);

  // remove password again
  assert.equal((await j('/api/admin/config', { method: 'PUT', headers: auth('hunter2'), body: { admin: { newPassword: '' } } })).status, 200);
  assert.equal((await j('/api/admin/config')).status, 200);
});

test('google callback rejects a request without a valid state', async () => {
  const res = await fetch(`${base}/api/google/callback?code=abc&state=bogus`);
  assert.equal(res.status, 400);
});

test('calendar: expands recurring ICS events and handles all-day events', async () => {
  const d = new Date();
  const ymd = (x) => `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, '0')}${String(x.getUTCDate()).padStart(2, '0')}`;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 2, 15, 0, 0));
  const end = new Date(start.getTime() + 3600000);
  const stamp = (x) => `${ymd(x)}T${String(x.getUTCHours()).padStart(2, '0')}0000Z`;
  const tomorrow = new Date(Date.now() + 86400000);
  const dayAfter = new Date(Date.now() + 2 * 86400000);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
    'BEGIN:VEVENT', 'UID:daily@test', `DTSTAMP:${stamp(start)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, 'RRULE:FREQ=DAILY', 'SUMMARY:Standup', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:allday@test', `DTSTAMP:${stamp(start)}`, `DTSTART;VALUE=DATE:${ymd(tomorrow)}`, `DTEND;VALUE=DATE:${ymd(dayAfter)}`, 'SUMMARY:Holiday', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const feed = http.createServer((req, res) => res.end(ics));
  await new Promise((r) => feed.listen(0, r));
  try {
    const cal = require('../widgets/calendar/server');
    const out = await cal.data({ icsUrls: `http://127.0.0.1:${feed.address().port}/c.ics`, daysAhead: 5 });
    const standups = out.events.filter((e) => e.title === 'Standup');
    assert.ok(standups.length >= 5, `expected daily expansion, got ${standups.length}`);
    const holiday = out.events.find((e) => e.title === 'Holiday');
    assert.ok(holiday && holiday.allDay && /^\d{4}-\d{2}-\d{2}$/.test(holiday.start));
    await assert.rejects(cal.data({}), /No calendar source/);
  } finally {
    feed.close();
  }
});

test('weather condition mapping', () => {
  const { wmo, owm } = require('../widgets/weather/server')._internals;
  assert.equal(wmo(0), 'clear');
  assert.equal(wmo(63), 'rain');
  assert.equal(wmo(95), 'thunder');
  assert.equal(owm(801), 'partly');
  assert.equal(owm(601), 'snow');
});

test('espn: season picks the right year per sport', () => {
  const { currentSeason } = require('../widgets/espn-fantasy/server')._internals;
  const year = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  assert.equal(currentSeason('flb'), year);
  assert.equal(currentSeason('fba'), m >= 10 ? year + 1 : year);
});

test('user widgets in the data dir are discovered and usable', async () => {
  const types = (await j('/api/admin/widget-types')).body;
  assert.ok(types.find((t) => t.type === 'hello' && t.origin === 'user'));
  const cfg = (await j('/api/admin/config')).body;
  cfg.widgets.push({ id: 'hello-1', type: 'hello', enabled: true, slot: 'rotate', options: { name: 'Pi' } });
  await j('/api/admin/config', { method: 'PUT', body: cfg });
  assert.equal((await j('/api/widgets/hello-1/data')).body.greeting, 'Hello, Pi!');
  assert.equal((await fetch(`${base}/widget-client/hello.js`)).status, 200);
});

test('espn: parses a league response and sends cleaned cookies to the right host', async () => {
  const espn = require('../widgets/espn-fantasy/server');
  const realFetch = global.fetch;
  let seen;
  global.fetch = async (url, init) => {
    seen = { url: String(url), cookie: init.headers.cookie };
    return new Response(JSON.stringify({
      settings: { name: 'The League' },
      status: { currentMatchupPeriod: 5 },
      teams: [
        { id: 1, name: 'Alpha', record: { overall: { wins: 3, losses: 1, ties: 0, percentage: 0.75, pointsFor: 400.55 } } },
        { id: 2, name: 'Bravo', record: { overall: { wins: 1, losses: 3, ties: 0, percentage: 0.25, pointsFor: 350 } } },
      ],
      schedule: [
        { matchupPeriodId: 5, home: { teamId: 1, totalPoints: 100.24 }, away: { teamId: 2, totalPoints: 90 } },
        { matchupPeriodId: 4, home: { teamId: 2, totalPoints: 1 }, away: { teamId: 1, totalPoints: 2 } },
      ],
    }), { status: 200 });
  };
  try {
    const d = await espn.data({ sport: 'ffl', leagueId: ' 12345 ', season: '2026', swid: ' "ABC-1" ', espnS2: "'tok en'" });
    assert.match(seen.url, /^https:\/\/lm-api-reads\.fantasy\.espn\.com\/apis\/v3\/games\/ffl\/seasons\/2026\/segments\/0\/leagues\/12345\?/);
    assert.equal(seen.cookie, 'SWID={ABC-1}; espn_s2=token');
    assert.equal(d.leagueName, 'The League');
    assert.deepEqual(d.standings.map((t) => [t.rank, t.name, t.wins]), [[1, 'Alpha', 3], [2, 'Bravo', 1]]);
    assert.equal(d.matchups.length, 1);
    assert.equal(d.matchups[0].home.score, 100.2);
  } finally {
    global.fetch = realFetch;
  }
});
