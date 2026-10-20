'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-fr-'));

const test = require('node:test');
const assert = require('node:assert');
const roster = require('../widgets/espn-roster/server');
const matchup = require('../widgets/espn-matchup/server');
const { league } = require('./fixtures/espn-fantasy');

const realFetch = global.fetch;
let seen;
const serve = (body, status = 200) => {
  global.fetch = async (url, init) => {
    seen = { url: String(url), cookie: init && init.headers && init.headers.cookie };
    return new Response(JSON.stringify(body), { status });
  };
};
test.afterEach(() => { global.fetch = realFetch; });
const base = { sport: 'ffl', leagueId: '42', season: '2026' };

test('roster: starters come in lineup order with slot labels, weekly points (not season), projections and tags', async () => {
  serve(league());
  const d = await roster.data({ ...base, teamId: 1 });
  assert.match(seen.url, /view=mRoster/);
  assert.equal(d.single, true);
  const t = d.teams[0];
  assert.equal(t.name, 'Gridiron Gurus');
  assert.equal(t.record, '5-1');
  assert.deepEqual(t.starters.map((p) => p.slot), ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'D/ST', 'K']);
  assert.equal(t.bench.length, 3);
  assert.deepEqual(t.reserve.map((p) => p.slot), ['IR']);
  assert.ok(t.starters.every((p) => p.pts < 100), 'the 999 season line is ignored');
  assert.ok(t.starters.every((p) => p.proj > 0));
  assert.equal(t.points, Math.round(t.starters.reduce((n, p) => n + p.pts, 0) * 10) / 10);
  const qb = t.starters[0];
  assert.match(qb.short, /^[A-Z]\. \w+/);
  assert.match(qb.headshot, /a\.espncdn\.com\/i\/headshots\/nfl\/players\/full\/\d+\.png/);
  const dst = t.starters.find((p) => p.slot === 'D/ST');
  assert.equal(dst.headshot, '');
  assert.match(dst.short, /D\/ST$/);
  assert.match(qb.team, /^[A-Z]{2,3}$/);
});

test('roster: injury tags map to short labels and severity', async () => {
  serve(league());
  const all = (await roster.data(base)).teams.flatMap((t) => [...t.starters, ...t.bench, ...t.reserve]);
  const by = (n) => all.find((p) => p.name === n);
  assert.deepEqual([by('Justin Jefferson').injury, by('Justin Jefferson').injuryLevel], ['Q', 'warn']);
  assert.deepEqual([by('Travis Kelce').injury, by('Travis Kelce').injuryLevel], ['OUT', 'bad']);
  assert.equal(by('Nick Chubb').injury, 'IR');
  assert.equal(by('Patrick Mahomes').injury, '');
});

test('roster: blank team ID returns every team, best record first; unknown ID explains', async () => {
  serve(league());
  const d = await roster.data(base);
  assert.equal(d.single, false);
  assert.deepEqual(d.teams.map((t) => t.id), [1, 2, 3, 4]);
  await assert.rejects(roster.data({ ...base, teamId: 99 }), /Team 99 is not in this league.*1 = Gridiron Gurus/);
});

test('roster: no roster data (private league) gives a helpful error; ESPN errors pass through', async () => {
  serve(league({ withRosters: false }));
  await assert.rejects(roster.data(base), /no roster data.*SWID/);
  serve({}, 401);
  await assert.rejects(roster.data(base), /private/);
  await assert.rejects(roster.data({ sport: 'ffl' }), /league ID/);
});

test('roster: images are served through this server when a widget id is known', async () => {
  serve(league());
  const d = await roster.data({ ...base, teamId: 1 }, { widgetId: 'fr-1' });
  assert.match(d.teams[0].starters[0].headshot, /^\/api\/logo\?w=fr-1&u=/);
});

test('matchup: pairs both lineups position by position with my team on the left', async () => {
  serve(league());
  const d = await matchup.data({ ...base, teamId: 2 });
  assert.match(seen.url, /view=mMatchup/);
  assert.equal(d.single, true);
  const m = d.matchups[0];
  assert.equal(m.home.id, 2, 'my team is shown on the left');
  assert.equal(m.away.id, 1);
  assert.equal(m.home.score, 96.2);
  assert.equal(m.away.score, 101.4);
  assert.equal(m.margin, 5.2);
  assert.deepEqual(m.rows.map((r) => r.slot), ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'D/ST', 'K']);
  assert.ok(m.rows.every((r) => r.home && r.away));
  assert.ok(m.rows[0].home.pts != null && m.rows[0].away.proj > 0);
  assert.ok(m.home.bench.length === 3 && m.away.bench.length === 3);
});

test('matchup: blank team ID lists this week\'s matchups only; byes and unknown teams explain', async () => {
  serve(league());
  const d = await matchup.data(base);
  assert.equal(d.single, false);
  assert.equal(d.matchups.length, 2, 'last week\'s matchup is not included');
  assert.deepEqual(d.matchups.map((m) => [m.home.id, m.away.id]), [[1, 2], [3, 4]]);
  await assert.rejects(matchup.data({ ...base, teamId: 77 }), /Team 77 is not in this league/);
  const lg = league();
  lg.schedule = lg.schedule.filter((m) => m.home.teamId !== 3 || m.matchupPeriodId !== 7);
  serve(lg);
  await assert.rejects(matchup.data({ ...base, teamId: 3 }), /bye/);
});

test('matchup: no lineups yet explains why', async () => {
  serve(league({ withRosters: false }));
  await assert.rejects(matchup.data(base), /no lineup data/);
});

test('both widgets are registered with shared connection fields and their client scripts exist', () => {
  for (const w of [roster, matchup]) {
    const keys = w.meta.fields.map((f) => f.key);
    for (const k of ['sport', 'leagueId', 'season', 'swid', 'espnS2', 'teamId']) assert.ok(keys.includes(k), `${w.meta.type} has ${k}`);
    assert.ok(w.meta.fields.filter((f) => f.secret).map((f) => f.key).sort().join() === 'espnS2,swid');
  }
  const fs = require('fs');
  const path = require('path');
  for (const t of ['espn-roster', 'espn-matchup']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'widgets', t, 'client.js')));
});
