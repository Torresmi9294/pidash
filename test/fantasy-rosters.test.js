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

test('league widget: Layout setting (side by side by default, or stacked)', () => {
  const league = require('../widgets/espn-fantasy/server');
  const f = league.meta.fields.find((x) => x.key === 'arrange');
  assert.deepEqual(f.options.map((o) => o.value), ['side', 'stacked']);
  const fs = require('fs');
  const path = require('path');
  const client = fs.readFileSync(path.join(__dirname, '..', 'widgets', 'espn-fantasy', 'client.js'), 'utf8');
  assert.match(client, /options\.arrange === 'stacked' \? 'stacked'/);
  assert.match(client, /showM && showS \?/, 'only applies when both sections are shown');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'dash.css'), 'utf8'), /\.espn\.stacked \{/);
});

// ---- basketball-style data: daily scoring periods inside a weekly matchup --------------------------------------------
// ESPN lists season totals, last-7/15/30 and the single-day entries together; only the day entries have a real
// scoringPeriodId, and their statSplitTypeId is not the football one.
function basketball(day = 7) {
  const lg = league();
  const grab = (e) => {
    const p = e.playerPoolEntry.player;
    const mine = p.stats.find((x) => x.statSourceId === 0 && x.statSplitTypeId === 1);
    const proj = p.stats.find((x) => x.statSourceId === 1 && x.statSplitTypeId === 1);
    const pts = mine.appliedTotal;
    p.stats = [
      { id: '002027', scoringPeriodId: 0, statSourceId: 0, statSplitTypeId: 0, appliedTotal: 999 },           // season
      { id: '012027', scoringPeriodId: 0, statSourceId: 0, statSplitTypeId: 2, appliedTotal: 888 },           // last 7
      { id: '102027', scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 777 },           // projected season
      { id: `11202700${day - 1}`, scoringPeriodId: day - 1, statSourceId: 0, statSplitTypeId: 5, appliedTotal: 55 }, // yesterday
      { id: `11202700${day}`, scoringPeriodId: day, statSourceId: 0, statSplitTypeId: 5, appliedTotal: pts },   // today
      { id: `10202700${day}`, scoringPeriodId: day, statSourceId: 1, statSplitTypeId: 5, appliedTotal: proj.appliedTotal },
    ];
    e.lineupSlotId = e.lineupSlotId === 20 ? 12 : e.lineupSlotId === 21 ? 13 : e.lineupSlotId;
  };
  for (const t of lg.teams) t.roster.entries.forEach(grab);
  lg.scoringPeriodId = day;
  lg.status.currentMatchupPeriod = 1;
  // the week's matchups: ESPN keeps the running total in totalPointsLive while totalPoints can still read 0
  lg.schedule = lg.schedule.filter((m) => m.matchupPeriodId === 7).map((m) => ({ ...m, matchupPeriodId: 1 }));
  Object.assign(lg.schedule[0].home, { totalPoints: 0, totalPointsLive: 312.4 });
  Object.assign(lg.schedule[0].away, { totalPoints: 150.2 });
  Object.assign(lg.schedule[1].home, { totalPoints: 0 });
  Object.assign(lg.schedule[1].away, { totalPoints: 0 });
  return lg;
}

test('basketball roster: points come from the current scoring period (day), not season, last-7 or another day', async () => {
  serve(basketball(7));
  const d = await roster.data({ sport: 'fba', leagueId: '42', season: '2027', teamId: 1 });
  const t = d.teams[0];
  assert.ok(t.starters.length > 0);
  assert.ok(t.starters.every((p) => p.pts != null && p.pts < 100), `daily points only: ${t.starters.map((p) => p.pts)}`);
  assert.ok(t.starters.every((p) => p.proj != null && p.proj < 100), 'daily projection, not the 777 season one');
  assert.notEqual(t.points, 0);

  // tomorrow: the same roster now has a different day's entries and the roster follows
  const next = basketball(8);
  serve(next);
  const d2 = await roster.data({ sport: 'fba', leagueId: '42', season: '2027', teamId: 1 });
  assert.equal(d2.period, 8);
  assert.ok(d2.teams[0].starters.every((p) => p.pts < 100));
  assert.equal(d.period, 7);
});

test('basketball roster: a day with no entry yet shows no points (not yesterday\'s)', async () => {
  const lg = basketball(7);
  lg.scoringPeriodId = 9; // today has no stats entries yet
  serve(lg);
  const d = await roster.data({ sport: 'fba', leagueId: '42', season: '2027', teamId: 1 });
  assert.ok(d.teams[0].starters.every((p) => p.pts == null), 'nothing shown for a day that has not been played');
  assert.equal(d.teams[0].points, 0);
});

test('basketball roster: also shows the matchup\'s running total, preferring the live figure', async () => {
  serve(basketball(7));
  const d = await roster.data({ sport: 'fba', leagueId: '42', season: '2027' });
  assert.equal(d.daily, true);
  const by = (id) => d.teams.find((t) => t.id === id);
  assert.equal(by(1).week, 312.4, 'totalPointsLive wins over a lagging totalPoints of 0');
  assert.equal(by(2).week, 150.2, 'falls back to totalPoints when there is no live figure');
  assert.equal(by(3).week, 0);
  // football is one scoring period per week, so there is nothing extra to show
  serve(league());
  const f = await roster.data({ sport: 'ffl', leagueId: '42', season: '2026' });
  assert.equal(f.daily, false);
  assert.ok(f.teams.every((t) => t.week === null));
});

test('basketball matchup: team scores use the live running total', async () => {
  serve(basketball(7));
  const d = await matchup.data({ sport: 'fba', leagueId: '42', season: '2027', teamId: 1 });
  assert.equal(d.matchups[0].home.score, 312.4);
  assert.equal(d.matchups[0].away.score, 150.2);
  assert.equal(d.matchups[0].margin, 162.2);
});

test('league widget: scores use the live total too', async () => {
  const league1 = require('../widgets/espn-fantasy/server');
  serve(basketball(7));
  const d = await league1.data({ sport: 'fba', leagueId: '42', season: '2027' });
  assert.equal(d.matchups[0].home.score, 312.4);
});

test('espn-debug summary shows what ESPN sent, without secrets', async () => {
  const fantasy = require('../server/espn-fantasy');
  serve(basketball(7));
  const s = await fantasy.debugSummary({ sport: 'fba', leagueId: '42', season: '2027', swid: '{SECRET-SWID}', espnS2: 'SECRETCOOKIE' });
  assert.equal(s.scoringPeriodId, 7);
  assert.equal(s.status.currentMatchupPeriod, 1);
  assert.ok(s.sampleTeam.entries.length > 0);
  const e = s.sampleTeam.entries[0];
  assert.equal(typeof e.parsedPoints, 'number');
  assert.ok(e.stats.some((x) => x.scoringPeriodId === 7 && x.statSplitTypeId === 5));
  assert.equal(s.sampleMatchup.home.totalPointsLive, 312.4);
  assert.ok(!JSON.stringify(s).match(/SECRET/));
});

test('admin: /api/admin/espn-debug/<widget id> serves the summary for ESPN widgets only', async () => {
  const { createApp } = require('../server/app');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, o = {}) => realFetch(base + p, { ...o, headers: { 'content-type': 'application/json' }, body: o.body && JSON.stringify(o.body) });
  try {
    const cfg = await (await get('/api/admin/config')).json();
    cfg.widgets.push({ id: 'fr-dbg', type: 'espn-roster', enabled: true, slot: 'rotate', options: { sport: 'fba', leagueId: '42', season: '2027', swid: '{SECRET}', espnS2: 'SECRETCOOKIE' } });
    await get('/api/admin/config', { method: 'PUT', body: cfg });
    global.fetch = async (url, init) => (String(url).includes('lm-api-reads') ? new Response(JSON.stringify(basketball(7)), { status: 200 }) : realFetch(url, init));
    const res = await get('/api/admin/espn-debug/fr-dbg');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(JSON.parse(text).sampleTeam.entries.length > 0);
    assert.ok(!/SECRET/.test(text), 'no cookies in the output');
    assert.equal((await get('/api/admin/espn-debug/clock-1')).status, 404, 'only ESPN widgets');
    assert.equal((await get('/api/admin/espn-debug/nope')).status, 404);
    global.fetch = async () => new Response('{}', { status: 403 });
    assert.equal((await get('/api/admin/espn-debug/fr-dbg')).status, 502, 'ESPN problems come back as a readable error');
  } finally {
    server.close();
  }
});

// ---- the two roster shapes ESPN sends for a matchup -------------------------------------------------------------------
const entry = (id, name, slot, pts, pos = 1) => ({ lineupSlotId: slot, playerPoolEntry: { id, appliedStatTotal: pts, player: { id, fullName: name, defaultPositionId: pos, stats: [] } } });
// today's lineup (real slots) and the matchup-to-date roster (no real slots: everyone in slot 0, week totals)
const dailySide = (teamId, week, live) => ({
  teamId, totalPoints: 0, totalPointsLive: live,
  rosterForCurrentScoringPeriod: { entries: [entry(1, 'Guard One', 0, 0, 1), entry(2, 'Wing Two', 2, 0, 3), entry(3, 'Big Three', 4, 0, 5), entry(4, 'Bench Four', 12, 0, 2)] },
  rosterForMatchupPeriod: { entries: [entry(1, 'Guard One', 0, week[0], 1), entry(2, 'Wing Two', 0, week[1], 3), entry(3, 'Big Three', 0, week[2], 5), entry(4, 'Bench Four', 0, week[3], 2)] },
});
const dailyLeague = () => {
  const lg = basketball(7);
  lg.schedule = [{ matchupPeriodId: 1, home: dailySide(1, [40, 30, 20, 10], 100), away: dailySide(2, [35, 25, 15, 5], 80) }];
  return lg;
};

test('basketball matchup: slots come from today\'s lineup and points are each player\'s matchup-to-date total', async () => {
  serve(dailyLeague());
  const d = await matchup.data({ sport: 'fba', leagueId: '42', season: '2027', teamId: 1 });
  assert.match(seen.url, /view=mBoxscore/);
  const m = d.matchups[0];
  assert.deepEqual(m.rows.map((r) => r.slot), ['PG', 'SF', 'C'], 'real slots, not "PG" for everyone');
  assert.deepEqual(m.rows.map((r) => [r.home.pts, r.away.pts]), [[40, 35], [30, 25], [20, 15]], 'week totals');
  assert.equal(m.rows[0].home.day, 0, 'today\'s points are kept too');
  assert.deepEqual(m.home.bench.map((p) => [p.name, p.pts]), [['Bench Four', 10]]);
  assert.equal(m.home.score, 100);
});

test('matchup: no usable slots (everyone in slot 0) falls back to position labels', async () => {
  const lg = dailyLeague();
  for (const s of [lg.schedule[0].home, lg.schedule[0].away]) s.rosterForCurrentScoringPeriod = { entries: [] };
  serve(lg);
  const d = await matchup.data({ sport: 'fba', leagueId: '42', season: '2027', teamId: 1 });
  assert.deepEqual(d.matchups[0].rows.map((r) => r.slot), ['PG', 'SF', 'C', 'SG'], 'labelled by position, not all PG');
});

test('football matchup: an empty matchup-period roster does not hide the real lineup', async () => {
  const lg = league();
  for (const m of lg.schedule) for (const s of [m.home, m.away]) s.rosterForMatchupPeriod = { appliedStatTotal: 0, entries: [] }; // present but empty before the week's games
  serve(lg);
  const d = await matchup.data({ sport: 'ffl', leagueId: '42', season: '2026', teamId: 2 });
  assert.match(seen.url, /view=mBoxscore/, 'asks for the view that carries lineups');
  assert.deepEqual(d.matchups[0].rows.map((r) => r.slot), ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'D/ST', 'K']);
  assert.ok(d.matchups[0].rows.every((r) => r.home && r.away));
});

test('basketball roster: each player also shows their matchup-to-date total (the Today column is empty before games)', async () => {
  const lg = dailyLeague();
  // the roster's own entries need the same player ids
  lg.teams[0].roster.entries = [entry(1, 'Guard One', 0, 0, 1), entry(2, 'Wing Two', 2, 0, 3), entry(3, 'Big Three', 4, 0, 5), entry(4, 'Bench Four', 12, 0, 2)];
  serve(lg);
  const d = await roster.data({ sport: 'fba', leagueId: '42', season: '2027', teamId: 1 });
  const t = d.teams[0];
  assert.deepEqual(t.starters.map((p) => [p.name, p.week]), [['Guard One', 40], ['Wing Two', 30], ['Big Three', 20]]);
  assert.deepEqual(t.bench.map((p) => [p.name, p.week]), [['Bench Four', 10]]);
  assert.equal(t.week, 100, 'and the team\'s running total');
  assert.ok(t.starters.every((p) => p.pts == null), 'today: nothing played yet');
  // football rows have no week column
  serve(league());
  const f = await roster.data({ sport: 'ffl', leagueId: '42', season: '2026', teamId: 1 });
  assert.ok(f.teams[0].starters.every((p) => p.week === undefined));
});
