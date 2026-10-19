'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-hl-'));

const test = require('node:test');
const assert = require('node:assert');
const espn = require('../widgets/espn-fantasy/server');
const weather = require('../widgets/weather/server');
const sports = require('../widgets/sports-highlights/server');
const reminders = require('../widgets/reminders/server');
const store = require('../server/store');

const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });

test('espn: logos, streaks, close games, callouts and pinned teams', async () => {
  const team = (id, name, w, l, pf, extra = {}) => ({ id, name, abbrev: name.slice(0, 3).toUpperCase(), logo: `https://g.espncdn.com/logo/${id}.png`, record: { overall: { wins: w, losses: l, ties: 0, percentage: w / (w + l), pointsFor: pf, streakType: 'WIN', streakLength: 3 } }, ...extra });
  global.fetch = async () => json({
    settings: { name: 'League' },
    status: { currentMatchupPeriod: 4 },
    teams: [team(1, 'Alpha', 3, 1, 400), team(2, 'Bravo', 1, 3, 300), team(3, 'Charlie', 2, 2, 350), team(4, 'Delta', 2, 2, 340, { logo: undefined })],
    schedule: [
      { matchupPeriodId: 4, home: { teamId: 1, totalPoints: 130.4 }, away: { teamId: 2, totalPoints: 80 } },  // blowout 50.4
      { matchupPeriodId: 4, home: { teamId: 3, totalPoints: 100.2 }, away: { teamId: 4, totalPoints: 98.7 } }, // close 1.5
    ],
  });
  const d = await espn.data({ leagueId: '1', myTeamId: '3', pinnedTeams: '2, 4 x' });
  assert.equal(d.standings[0].logo, 'https://g.espncdn.com/logo/1.png');
  assert.equal(d.standings[0].streak, 'W3');
  assert.deepEqual(d.pinned, [2, 4]);
  assert.equal(d.matchups[0].close, false);
  assert.equal(d.matchups[1].close, true);
  assert.equal(d.matchups[1].margin, 1.5);
  assert.equal(d.matchups[1].away.logo, ''); // missing logo -> client shows initials badge
  const byLabel = Object.fromEntries(d.callouts.map((c) => [c.label, c]));
  assert.match(byLabel['Top score'].text, /Alpha 130.4/);
  assert.match(byLabel['Biggest blowout'].text, /Alpha by 50.4/);
  assert.match(byLabel['Closest game'].text, /Charlie by 1.5/);
  assert.match(byLabel['My team'].text, /#\d+ · 2-2 · W3/);
});

test('espn: no callouts before any scores exist', async () => {
  global.fetch = async () => json({
    status: { currentMatchupPeriod: 1 },
    teams: [{ id: 1, name: 'A', record: { overall: {} } }, { id: 2, name: 'B', record: { overall: {} } }],
    schedule: [{ matchupPeriodId: 1, home: { teamId: 1, totalPoints: 0 }, away: { teamId: 2, totalPoints: 0 } }],
  });
  const d = await espn.data({ leagueId: '1' });
  assert.deepEqual(d.callouts, []);
  assert.equal(d.matchups[0].close, false);
});

test('weather: alerts for storms, rain, freeze, heat and wind (units aware)', () => {
  const { buildAlerts } = weather._internals;
  const base = (over = {}) => ({
    current: { temp: 70, condition: 'clear', wind: 5, ...over.current },
    today: { high: 75, low: 55, ...over.today },
    daily: over.daily || [{ date: '2026-10-20', rain: 0, condition: 'clear' }, { date: '2026-10-21', rain: 0, condition: 'clear' }],
    units: { wind: 'mph' },
  });
  const wd = () => 'Wednesday';
  assert.deepEqual(buildAlerts(base(), 'imperial', wd), []);
  const a = buildAlerts(base({ today: { high: 95, low: 28 }, current: { wind: 30 }, daily: [{ date: '2026-10-20', rain: 80, condition: 'rain' }, { date: '2026-10-21', rain: 10, condition: 'thunder' }] }), 'imperial', wd);
  const text = a.map((x) => x.text).join(' | ');
  assert.match(text, /Thunderstorms Wednesday/);
  assert.match(text, /Rain likely tomorrow \(80%\)/);
  assert.equal(a.length, 3); // capped
  // the same 35 degrees: hot in metric, ordinary in imperial
  assert.equal(buildAlerts(base({ today: { high: 35, low: 33 } }), 'imperial', wd).length, 0);
  assert.ok(buildAlerts(base({ today: { high: 35, low: 33 } }), 'metric', wd).some((x) => /Hot today/.test(x.text)));
  assert.ok(buildAlerts(base({ today: { high: 40, low: 31 } }), 'imperial', wd).some((x) => /Freezing/.test(x.text)));
});

test('reminders: starred items sort first and survive updates', async () => {
  const a = store.addReminder({ text: 'A', due: '2030-01-01' });
  const b = store.addReminder({ text: 'B', due: '2031-01-01', starred: true });
  const out = await reminders.data({});
  assert.deepEqual(out.items.map((r) => r.text), ['B', 'A']);
  assert.equal(out.items[0].starred, true);
  store.updateReminder(a.id, { starred: true });
  assert.equal(store.listReminders().find((r) => r.id === a.id).starred, true);
  store.updateReminder(b.id, { starred: false });
  assert.equal((await reminders.data({})).items[0].text, 'A');
});

test('sports highlights: maps feed items, hides paywalled stories, blocks non-ESPN media URLs', async () => {
  const article = (over) => ({ id: 1, type: 'Story', headline: 'H', description: 'D', published: '2026-10-19T10:00:00Z', images: [{ url: 'https://a.espncdn.com/x.jpg' }], links: {}, ...over });
  const clip = (id, mp4) => ({ id, type: 'Media', headline: `Clip ${id}`, published: '2026-10-19T12:00:00Z', images: [{ url: 'https://espnmedia-cdn.akamaized.net/t.jpg' }], links: { api: { self: { href: `https://content.core.api.espn.com/v1/video/clips/${id}` } } }, _mp4: mp4 });
  global.fetch = async (url) => {
    url = String(url);
    if (url.includes('/news')) {
      return json({ articles: [article({ id: 1, headline: 'Free story' }), article({ id: 2, headline: 'Paywalled', premium: true }), clip(10), clip(11), article({ id: 3, headline: 'Evil image', images: [{ url: 'https://evil.example.com/x.jpg' }] })] });
    }
    const id = url.split('/').pop();
    const href = id === '10' ? 'https://espnmedia-cdn.akamaized.net/v.mp4' : 'https://evil.example.com/v.mp4';
    return json({ videos: [{ links: { mobile: { source: { href } }, source: { href } } }] });
  };
  const r = await sports.data({ league: 'nfl', playVideo: true });
  const byHead = Object.fromEntries(r.items.map((i) => [i.headline, i]));
  assert.ok(!byHead.Paywalled);
  assert.equal(byHead['Free story'].type, 'story');
  assert.equal(byHead['Clip 10'].video, 'https://espnmedia-cdn.akamaized.net/v.mp4');
  assert.equal(byHead['Clip 11'].video, '');            // untrusted host dropped
  assert.equal(byHead['Evil image'].image, '');         // untrusted image dropped
  assert.equal(r.items[0].headline.startsWith('Clip'), true); // newest first
  assert.equal(JSON.stringify(r).includes('_api'), false);

  const onlyVideos = await sports.data({ league: 'nfl', content: 'videos' });
  assert.ok(onlyVideos.items.every((i) => i.type === 'video'));
  assert.ok(onlyVideos.items.every((i) => i.video === undefined)); // not fetched unless "play video" is on
  await assert.rejects(sports.data({ league: 'nope' }), /Pick a league/);
});
