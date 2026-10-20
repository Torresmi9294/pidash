'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-sb-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sb = require('../widgets/scoreboard/server');
const { normalize, favoriteMatcher, situationText, cache } = sb._internals;

const realFetch = global.fetch;
let calls;
let feed; // league url fragment -> events (or an Error / status)
test.beforeEach(() => { calls = []; cache.clear(); feed = {}; });
test.afterEach(() => { global.fetch = realFetch; });
const serve = () => {
  global.fetch = async (url) => {
    calls.push(String(url));
    const key = Object.keys(feed).find((k) => String(url).includes(k));
    const v = key ? feed[key] : undefined;
    if (v instanceof Error) throw v;
    if (typeof v === 'number') return new Response('', { status: v });
    return new Response(JSON.stringify({ events: v || [] }), { status: 200 });
  };
};

// ---- ESPN-shaped fixtures ---------------------------------------------------------------------------
const team = (id, abbr, name, extra = {}) => ({ id: String(id), abbreviation: abbr, displayName: name, shortDisplayName: name.split(' ').pop(), logo: `https://a.espncdn.com/i/teamlogos/x/${abbr.toLowerCase()}.png`, color: '112233', ...extra });
const comp = (home, away, o = {}) => ({
  venue: { fullName: 'Some Stadium' },
  broadcasts: [{ names: ['ESPN', 'ABC'] }],
  competitors: [
    { homeAway: 'home', team: home, score: String(o.hs ?? 0), winner: !!o.hw, records: [{ type: 'total', summary: o.hr || '3-3' }], curatedRank: o.hrank && { current: o.hrank } },
    { homeAway: 'away', team: away, score: String(o.as ?? 0), winner: !!o.aw, records: [{ type: 'total', summary: o.ar || '2-4' }] },
  ],
  situation: o.situation,
});
const game = (id, state, date, c, status = {}) => ({
  id: String(id), date, status: { displayClock: status.clock || '0:00', period: status.period || 0, type: { state, completed: state === 'post', detail: status.detail || '', shortDetail: status.short || status.detail || '' } },
  competitions: [c],
});
const NE = team(1, 'NE', 'New England Patriots');
const NYJ = team(2, 'NYJ', 'New York Jets');
const DEN = team(3, 'DEN', 'Denver Broncos');
const KC = team(4, 'KC', 'Kansas City Chiefs');
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();

test('normalize: scheduled, live (football situation), and final games', () => {
  const pre = normalize(game(1, 'pre', iso(5), comp(NYJ, NE), { short: 'Thu 8:15 PM' }), 'NFL', () => false);
  assert.equal(pre.state, 'pre');
  assert.equal(pre.away.abbr, 'NE');
  assert.equal(pre.home.abbr, 'NYJ');
  assert.equal(pre.away.score, null, 'no score before kickoff');
  assert.equal(pre.broadcast, 'ESPN, ABC');
  assert.equal(pre.venue, 'Some Stadium');

  const live = normalize(game(2, 'in', iso(-1), comp(NYJ, NE, { hs: 10, as: 17, situation: { shortDownDistanceText: '2nd & 7', possessionText: 'NE 34', possession: '1', isRedZone: false } }), { short: '5:21 - 3rd', clock: '5:21', period: 3 }), 'NFL', () => false);
  assert.equal(live.state, 'in');
  assert.deepEqual([live.away.score, live.home.score], [17, 10]);
  assert.equal(live.status, '5:21 - 3rd');
  assert.equal(live.clock, '5:21');
  assert.equal(live.period, 3);
  assert.equal(live.situation, '2nd & 7 · NE 34');
  assert.equal(live.away.hasBall, true);
  assert.equal(live.home.hasBall, false);

  const post = normalize(game(3, 'post', iso(-30), comp(DEN, KC, { hs: 27, as: 20, hw: true, hrank: 7 }), { short: 'Final' }), 'NFL', () => false);
  assert.equal(post.state, 'post');
  assert.equal(post.home.winner, true);
  assert.equal(post.away.winner, false);
  assert.equal(post.home.rank, 7);
  assert.equal(post.away.rank, null);
  assert.equal(post.home.record, '3-3');
  assert.equal(post.situation, '', 'no situation text once the game is over');
});

test('normalize: baseball count/outs, bad data, and unknown states are handled', () => {
  assert.equal(situationText({ situation: { outs: 2, balls: 3, strikes: 1 } }, 'in'), '2 outs · 3-1');
  assert.equal(situationText({ situation: { outs: 1 } }, 'in'), '1 out');
  assert.equal(situationText({ situation: { isRedZone: true, shortDownDistanceText: '1st & Goal' } }, 'in'), '1st & Goal · Red zone');
  assert.equal(situationText({}, 'in'), '');
  assert.equal(normalize({ id: 1, competitions: [] }, 'X', () => false), null);
  assert.equal(normalize({ id: 1, competitions: [{ competitors: [{}] }] }, 'X', () => false), null);
  assert.equal(normalize({ id: 1 }, 'X', () => false), null);
  const weird = normalize({ id: 9, date: iso(1), status: { type: { state: 'delayed' } }, competitions: [{ competitors: [{ homeAway: 'home', team: { id: 1 }, score: 'abc' }, { homeAway: 'away', team: {} }] }] }, 'X', () => false);
  assert.equal(weird.state, 'pre');                       // unknown state treated as not started
  assert.equal(weird.home.name, 'TBD');
  assert.equal(weird.home.score, null);
});

test('favorites: abbreviations match exactly, names match by 3+ letter fragments', () => {
  const fav = favoriteMatcher('NE, Celtics, bo');
  assert.equal(fav({ abbr: 'NE', name: 'New England Patriots' }), true);
  assert.equal(fav({ abbr: 'ne', name: 'x' }), true);                       // case-insensitive
  assert.equal(fav({ abbr: 'DEN', name: 'Denver Broncos' }), false);        // "NE" must not match "dENvEr"
  assert.equal(fav({ abbr: 'BOS', name: 'Boston Celtics' }), true);         // name fragment
  assert.equal(fav({ abbr: 'BOS', name: 'Boston Bruins' }), false);         // "bo" is too short to match inside names
  assert.equal(favoriteMatcher('')({ abbr: 'NE', name: 'New England' }), false);
});

test('data: sorts my teams first, then live, upcoming (soonest first), then finals (latest first)', async () => {
  feed.nfl = [
    game(1, 'post', iso(-48), comp(DEN, KC, { hs: 10, as: 7, hw: true }), { short: 'Final' }),
    game(2, 'post', iso(-24), comp(DEN, KC, { hs: 3, as: 6, aw: true }), { short: 'Final' }),
    game(3, 'pre', iso(30), comp(NYJ, KC)),
    game(4, 'pre', iso(6), comp(DEN, KC)),
    game(5, 'in', iso(-1), comp(DEN, KC, { hs: 1, as: 0 }), { short: '9:00 - 1st' }),
    game(6, 'pre', iso(100), comp(NYJ, NE)),     // my team, but far away
  ];
  serve();
  const d = await sb.data({ league: 'nfl', favorites: 'NE', maxGames: 20 });
  assert.deepEqual(d.games.map((g) => g.id), ['6', '5', '4', '3', '2', '1']);
  assert.equal(d.games[0].fav, true);
  assert.equal(d.anyLive, true);
  assert.equal(d.leagues[0], 'NFL');
});

test('data: the "games to show" filters and "only my teams"', async () => {
  feed.nfl = [
    game(1, 'post', iso(-48), comp(DEN, KC), { short: 'Final' }),
    game(2, 'pre', iso(70), comp(NYJ, NE)),
    game(3, 'in', iso(-1), comp(DEN, KC, { hs: 1, as: 0 })),
    game(4, 'post', iso(-0.2), comp(NYJ, KC, { hs: 1, as: 0, hw: true }), { short: 'Final' }), // finished a few minutes ago
  ];
  serve();
  const ids = async (o) => (await sb.data({ league: 'nfl', ...o })).games.map((g) => g.id).sort();
  assert.deepEqual(await ids({ show: 'all' }), ['1', '2', '3', '4']);
  assert.deepEqual(await ids({ show: 'live' }), ['3']);
  assert.deepEqual(await ids({ show: 'active' }), ['2', '3']);
  const today = await ids({ show: 'today' });
  assert.ok(today.includes('3'), 'a game in progress always counts as today');
  assert.ok(!today.includes('1'), 'a game from two days ago is not today');
  assert.deepEqual(await ids({ onlyFavorites: true, favorites: 'NE' }), ['2']);
  assert.deepEqual(await ids({ onlyFavorites: true, favorites: '' }), []);
  // nothing live: the widget can tell the user when the next game starts
  feed.nfl = [game(2, 'pre', iso(5), comp(NYJ, NE)), game(9, 'pre', iso(2), comp(DEN, KC))];
  cache.clear();
  const none = await sb.data({ league: 'nfl', show: 'live' });
  assert.equal(none.games.length, 0);
  assert.equal(none.next.label, 'KC @ DEN');                      // soonest upcoming game
});

test('data: several leagues merge (labelled), one failing league only warns, all failing is an error', async () => {
  feed.nba = [game(1, 'pre', iso(3), comp(NYJ, NE))];
  feed['hockey/nhl'] = new Error('boom');
  feed.mlb = [game(2, 'in', iso(-1), comp(DEN, KC, { hs: 2, as: 2 }))];
  serve();
  const d = await sb.data({ league: 'nba', league2: 'nhl', league3: 'mlb', maxGames: 10 });
  assert.deepEqual(d.games.map((g) => g.league), ['MLB', 'NBA']);          // live first
  assert.equal(d.multi, true);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /boom/);
  cache.clear();
  feed.nba = 503;
  feed.mlb = new Error('down');
  await assert.rejects(sb.data({ league: 'nba', league3: 'mlb' }), /HTTP 503|down/);
  await assert.rejects(sb.data({ league: 'nope' }), /Pick a league/);
  // duplicates and unknown leagues are ignored
  cache.clear();
  feed.nba = [];
  serve();
  const one = await sb.data({ league: 'nba', league2: 'nba', league3: 'bogus' });
  assert.equal(one.multi, false);
});

test('data: caching is short while a game is live and long otherwise, and stale scores survive an outage', async () => {
  feed.nfl = [game(1, 'in', iso(-1), comp(DEN, KC, { hs: 1, as: 0 }))];
  serve();
  await sb.data({ league: 'nfl' });
  await sb.data({ league: 'nfl' });
  assert.equal(calls.length, 1, 'second call within 20s comes from the cache');
  cache.get('nfl').at -= 25e3;                                                 // 25s old while LIVE -> refetch
  await sb.data({ league: 'nfl' });
  assert.equal(calls.length, 2);

  feed.nfl = [game(1, 'pre', iso(5), comp(DEN, KC))];
  cache.clear();
  await sb.data({ league: 'nfl' });
  cache.get('nfl').at -= 100e3;                                                // 100s old while nothing is live -> still cached
  await sb.data({ league: 'nfl' });
  assert.equal(calls.length, 3);
  cache.get('nfl').at -= 200e3;                                                // 300s -> refetch
  await sb.data({ league: 'nfl' });
  assert.equal(calls.length, 4);

  feed.nfl = new Error('offline');                                             // outage: serve the last good scores
  cache.get('nfl').at -= 400e3;
  const stale = await sb.data({ league: 'nfl' });
  assert.equal(stale.games.length, 1);
});

test('data: logos are served from this server\'s cache (allow-listed per widget), only when logos are shown', async () => {
  feed.nfl = [game(1, 'pre', iso(5), comp(DEN, KC))];
  serve();
  const d = await sb.data({ league: 'nfl' }, { widgetId: 'sb-1' });
  assert.match(d.games[0].home.logo, /^\/api\/logo\?w=sb-1&u=/);
  cache.clear();
  const off = await sb.data({ league: 'nfl', showLogos: false }, { widgetId: 'sb-1' });
  assert.match(off.games[0].home.logo, /^https:\/\/a\.espncdn\.com/);        // untouched (the display ignores it)
  cache.clear();
  const direct = await sb.data({ league: 'nfl' });                              // no widget id (tests / scripts): raw URLs
  assert.match(direct.games[0].home.logo, /^https:/);
});

test('maxGames is clamped, and the widget is registered with sensible settings', async () => {
  feed.nba = Array.from({ length: 60 }, (_, i) => game(i, 'pre', iso(i + 1), comp(DEN, KC)));
  serve();
  assert.equal((await sb.data({ league: 'nba', maxGames: 999 })).games.length, 40);
  assert.equal((await sb.data({ league: 'nba', maxGames: 0 })).games.length, 12);
  const keys = sb.meta.fields.map((f) => f.key);
  for (const k of ['league', 'league2', 'league3', 'show', 'favorites', 'onlyFavorites', 'maxGames', 'showLogos', 'showRecords']) assert.ok(keys.includes(k), k);
  assert.equal(sb.meta.refreshSec, 30);
  assert.equal(sb.meta.fields.find((f) => f.key === 'showLogos').default, true);
});

test('client: cards are trim-able items, live games are flagged, nothing is built with innerHTML', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'widgets', 'scoreboard', 'client.js'), 'utf8');
  assert.match(src, /'data-fit-item': true/);
  assert.match(src, /sb-live/);
  assert.ok(!/\.innerHTML\s*=/.test(src));
  assert.match(src, /fitFloor: 0\.75/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'dash.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(src, /sb-star/);
  assert.ok(!/text-overflow:\s*ellipsis/.test(css.slice(css.indexOf('/* ---- scoreboard ---- */'))), 'long names wrap instead of being truncated (a truncated name clips at every scale)');
});

test('views: cards (default), list, slideshow and ticker are offered, with their own settings only shown for their view', () => {
  const view = sb.meta.fields.find((f) => f.key === 'view');
  assert.deepEqual(view.options.map((o) => o.value), ['cards', 'list', 'slideshow', 'ticker']);
  assert.equal(view.options[0].value, 'cards', 'cards stays the default so existing widgets do not change');
  assert.equal(view.rerender, true);
  const only = (k) => sb.meta.fields.find((f) => f.key === k).showIf;
  assert.deepEqual(only('slideLive'), { key: 'view', value: 'slideshow' });
  assert.deepEqual(only('slideSeconds'), { key: 'view', value: 'slideshow' });
  assert.deepEqual(only('showDots'), { key: 'view', value: 'slideshow' });
  assert.deepEqual(only('tickerSpeed'), { key: 'view', value: 'ticker' });
  assert.equal(sb.meta.fields.find((f) => f.key === 'slideLive').default, true);

  const client = fs.readFileSync(path.join(__dirname, '..', 'widgets', 'scoreboard', 'client.js'), 'utf8');
  for (const v of ['cards', 'list', 'slideshow', 'ticker']) assert.match(client, new RegExp(`'${v}'`));
  assert.match(client, /options\.slideLive !== false && anyLive/, 'slideshow shows only live games while any are live');
  assert.match(client, /data-fit-ignore/, 'the ticker is meant to run wider than its box, so the fit must not shrink it');
  assert.ok(!/\.innerHTML\s*=/.test(client));

  const admin = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8');
  assert.match(admin, /function showField\(f, type, options\)/);
  assert.match(admin, /filter\(\(f\) => showField\(f, t, w\.options\)\)/);
});
