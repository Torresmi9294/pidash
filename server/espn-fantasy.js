'use strict';
// Shared by the three ESPN Fantasy widgets (league overview, team roster, matchup rosters): connection settings,
// the league request with friendly errors, standings, and turning ESPN's roster entries into plain player rows.
// ESPN's fantasy API is unofficial and undocumented; the shapes used here follow what the community
// documents for it (teams[].roster.entries / schedule[].home.rosterForCurrentScoringPeriod.entries).

const SPORTS = [
  { value: 'ffl', label: 'Football' },
  { value: 'flb', label: 'Baseball' },
  { value: 'fba', label: 'Basketball' },
  { value: 'fhl', label: 'Hockey' },
];

// The settings every ESPN widget needs. Each widget keeps its own copy so you can run different leagues side by side.
const CONNECTION_FIELDS = [
  { key: 'sport', label: 'Sport', type: 'select', options: SPORTS },
  { key: 'leagueId', label: 'League ID', type: 'text', placeholder: '123456', help: 'The number after leagueId= in your league URL.' },
  { key: 'season', label: 'Season year (blank = current)', type: 'text', placeholder: '2026' },
  { key: 'swid', label: 'SWID cookie (private leagues)', type: 'text', secret: true, placeholder: '{XXXXXXXX-XXXX-...}' },
  { key: 'espnS2', label: 'espn_s2 cookie (private leagues)', type: 'text', secret: true },
];

function currentSeason(sport) {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (sport === 'ffl') return m < 3 ? y - 1 : y; // season runs Sep-Jan
  if (sport === 'flb') return y;
  return m >= 10 ? y + 1 : y; // basketball/hockey are named for the ending year
}

// Pasted cookies often carry stray quotes/newlines/spaces, which make the request invalid.
const clean = (v) => String(v || '').replace(/^\s*(?:swid|espn_s2)\s*=/i, '').replace(/["'\s]/g, '');
const cleanSwid = (v) => {
  const s = clean(v);
  return s && !s.startsWith('{') ? `{${s}}` : s;
};

const teamName = (t) => t.name || [t.location, t.nickname].filter(Boolean).join(' ') || `Team ${t.id}`;
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const streakText = (r) => (r.streakLength > 0 && r.streakType ? `${String(r.streakType)[0].toUpperCase()}${r.streakLength}` : '');

// Fetch one league. `views` picks which slices ESPN includes (mTeam, mRoster, mMatchupScore, mMatchup, mSettings).
async function fetchLeague(o, views) {
  if (!o.leagueId) throw new Error('Enter your ESPN league ID in the widget settings.');
  const leagueId = String(o.leagueId).replace(/\D/g, '');
  if (!leagueId) throw new Error('League ID should be the number from your league URL (leagueId=...).');
  const sport = o.sport || 'ffl';
  const season = Number(o.season) || currentSeason(sport);
  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${sport}/seasons/${season}/segments/0/leagues/${leagueId}` +
    `?${views.map((v) => `view=${v}`).join('&')}`;
  const headers = { 'user-agent': 'Mozilla/5.0 PiDash/1.0', accept: 'application/json' };
  const swid = cleanSwid(o.swid);
  const s2 = clean(o.espnS2);
  if (swid || s2) headers.cookie = `SWID=${swid}; espn_s2=${s2}`;

  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new Error(`Could not reach ESPN (${(e.cause && e.cause.message) || e.message}). Check the server's internet/DNS access.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      swid || s2
        ? 'ESPN rejected the SWID/espn_s2 cookies (they expire - copy fresh ones) or this account is not in the league.'
        : 'ESPN says this league is private (or the ID is wrong) - add your SWID and espn_s2 cookies.',
    );
  }
  if (res.status === 404) throw new Error(`ESPN has no ${sport} league ${leagueId} for season ${season}. Check the league ID, sport and season.`);
  if (!res.ok) throw new Error(`ESPN returned HTTP ${res.status}.`);
  return { d: await res.json(), headers, leagueId, sport, season };
}

function buildStandings(d) {
  const rec = (t) => (t.record && t.record.overall) || {};
  return (d.teams || [])
    .map((t) => ({
      id: t.id,
      name: teamName(t),
      abbrev: t.abbrev || '',
      wins: rec(t).wins || 0,
      losses: rec(t).losses || 0,
      ties: rec(t).ties || 0,
      pct: rec(t).percentage || 0,
      pointsFor: round1(rec(t).pointsFor),
      logo: t.logo || '',
      streak: streakText(rec(t)),
    }))
    .sort((a, b) => b.pct - a.pct || b.wins - a.wins || b.pointsFor - a.pointsFor)
    .map((t, i) => ({ ...t, rank: i + 1 }));
}

const recordText = (t) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`;

// ---- players ---------------------------------------------------------------------------------------------------

const POSITIONS = {
  ffl: { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' },
  fba: { 1: 'PG', 2: 'SG', 3: 'SF', 4: 'PF', 5: 'C' },
  fhl: { 1: 'C', 2: 'LW', 3: 'RW', 4: 'D', 5: 'G' },
  flb: { 1: 'SP', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH', 11: 'RP' },
};
// Lineup slots: label for each slot id, plus which ids are the bench and the injured reserve.
const SLOTS = {
  ffl: { 0: 'QB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP', 16: 'D/ST', 17: 'K', 20: 'BN', 21: 'IR', 23: 'FLEX' },
  fba: { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 7: 'SG/SF', 8: 'G/F', 9: 'PF/C', 10: 'F/C', 11: 'UTIL', 12: 'BN', 13: 'IR' },
  flb: { 0: 'C', 1: '1B', 2: '2B', 3: '3B', 4: 'SS', 5: 'OF', 6: '2B/SS', 7: '1B/3B', 8: 'LF', 9: 'CF', 10: 'RF', 11: 'DH', 12: 'UTIL', 13: 'P', 14: 'SP', 15: 'RP', 16: 'BN', 17: 'IL' },
  fhl: { 0: 'C', 1: 'LW', 2: 'RW', 3: 'F', 4: 'D', 5: 'G', 6: 'UTIL', 7: 'BN', 8: 'IR' },
};
const BENCH = { ffl: [20], fba: [12], flb: [16], fhl: [7] };
const RESERVE = { ffl: [21], fba: [13], flb: [17], fhl: [8] };
// Display order of the starting lineup (football: QB, RB, WR, TE, FLEX, D/ST, K like ESPN's own page).
const ORDER = { ffl: [0, 1, 2, 3, 4, 5, 6, 7, 23, 16, 17] };

const NFL_TEAMS = { 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU' };
const HEADSHOT_LEAGUE = { ffl: 'nfl', fba: 'nba', flb: 'mlb', fhl: 'nhl' };

const INJURY = {
  QUESTIONABLE: { tag: 'Q', level: 'warn' }, DOUBTFUL: { tag: 'D', level: 'bad' }, OUT: { tag: 'OUT', level: 'bad' },
  INJURY_RESERVE: { tag: 'IR', level: 'bad' }, SUSPENSION: { tag: 'SUSP', level: 'bad' }, DAY_TO_DAY: { tag: 'DTD', level: 'warn' }, PROBABLE: { tag: 'P', level: 'warn' },
};

const initialName = (full) => {
  const parts = String(full || '').trim().split(/\s+/);
  return parts.length < 2 ? parts[0] || '' : `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
};

// A player's points (source 0) or projection (source 1) for one scoring period. ESPN lists a player's season totals,
// last-7/15/30 averages and projections in the same array as the single-day entries; the day entries are the ones with
// a real scoringPeriodId (the season ones have 0). Football weeks and basketball/baseball/hockey days are both "scoring
// periods", but ESPN does not code them the same way (statSplitTypeId), so the period id is what we match on.
function statTotal(player, source, period) {
  const day = (player.stats || []).filter((x) => x.statSourceId === source && Number(x.scoringPeriodId) > 0 && (period == null || Number(x.scoringPeriodId) === Number(period)));
  const s = day.find((x) => x.statSplitTypeId === 1) || day[0];
  return s && Number.isFinite(Number(s.appliedTotal)) ? round1(s.appliedTotal) : null;
}

// A matchup side's running score. ESPN keeps the live total of the matchup so far in totalPointsLive; totalPoints can
// lag behind it (or stay at 0) until the matchup is final, which is common when a matchup spans several days.
function liveScore(side) {
  const live = Number(side && side.totalPointsLive);
  return round1(Number.isFinite(live) && live > 0 ? live : (side && side.totalPoints) || 0);
}

// One roster entry -> a flat row. `fromMatchup` entries carry the week's points in appliedStatTotal;
// plain roster entries only have them inside the stats list.
function parseEntry(e, { sport, period, fromMatchup }) {
  const pe = e.playerPoolEntry || {};
  const p = pe.player || {};
  const slotId = e.lineupSlotId;
  const pos = (POSITIONS[sport] || {})[p.defaultPositionId] || '';
  const inj = INJURY[p.injuryStatus] || null;
  const pts = fromMatchup ? (Number.isFinite(Number(pe.appliedStatTotal)) ? round1(pe.appliedStatTotal) : statTotal(p, 0, period)) : statTotal(p, 0, period);
  const league = HEADSHOT_LEAGUE[sport];
  const isDst = sport === 'ffl' && p.defaultPositionId === 16;
  return {
    id: p.id != null ? p.id : pe.id,
    name: p.fullName || 'Unknown player',
    short: sport === 'ffl' && isDst ? p.fullName || 'D/ST' : initialName(p.fullName),
    pos,
    slotId,
    slot: (SLOTS[sport] || {})[slotId] || pos || '',
    team: sport === 'ffl' ? NFL_TEAMS[p.proTeamId] || '' : '',
    injury: inj ? inj.tag : '',
    injuryLevel: inj ? inj.level : '',
    pts,
    proj: statTotal(p, 1, period),
    headshot: league && !isDst && p.id > 0 ? `https://a.espncdn.com/i/headshots/${league}/players/full/${p.id}.png` : '',
  };
}

// Split a roster into starters (in lineup order), bench and injured reserve.
function parseRoster(entries, { sport, period, fromMatchup = false }) {
  const rows = (entries || []).map((e, i) => ({ ...parseEntry(e, { sport, period, fromMatchup }), _i: i }));
  const inSet = (set, r) => (set[sport] || []).includes(r.slotId);
  const order = ORDER[sport];
  const rank = (r) => { const k = order ? order.indexOf(r.slotId) : -1; return k >= 0 ? k : 100 + r.slotId; };
  const strip = ({ _i, ...rest }) => rest;
  const sort = (a, b) => rank(a) - rank(b) || a._i - b._i;
  return {
    starters: rows.filter((r) => !inSet(BENCH, r) && !inSet(RESERVE, r)).sort(sort).map(strip),
    bench: rows.filter((r) => inSet(BENCH, r)).sort((a, b) => a._i - b._i).map(strip),
    reserve: rows.filter((r) => inSet(RESERVE, r)).sort((a, b) => a._i - b._i).map(strip),
  };
}

const sum = (rows, key) => round1(rows.reduce((n, r) => n + (Number(r[key]) || 0), 0));

// Serve logos/headshots from this server (cached, no hotlink/referrer problems), like the league overview does.
function proxyImages(ctx, headers, items) {
  if (!ctx || !ctx.widgetId) return;
  const logos = require('./logos');
  const sources = items.flatMap((x) => [x.logo, x.headshot]).filter(Boolean);
  logos.allow(ctx.widgetId, sources, headers.cookie || '');
  for (const x of items) {
    if (x.logo) x.logo = logos.proxyUrl(ctx.widgetId, x.logo);
    if (x.headshot) x.headshot = logos.proxyUrl(ctx.widgetId, x.headshot);
  }
  logos.warm(ctx.widgetId, sources.map((s) => logos.normalize(s)).filter(Boolean)).catch(() => {});
}

// What ESPN sent for this league, boiled down so the shape of the data can be checked by eye (and pasted into a bug report).
async function debugSummary(o) {
  const { d, sport, season } = await fetchLeague(o, ['mTeam', 'mRoster', 'mMatchupScore', 'mSettings']);
  const period = d.scoringPeriodId;
  const mp = d.status && d.status.currentMatchupPeriod;
  const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));
  const team = (d.teams || []).find((t) => t.roster && (t.roster.entries || []).length) || (d.teams || [])[0] || {};
  const matchup = (d.schedule || []).find((m) => m.matchupPeriodId === mp && m.home && m.away);
  const side = (s) => s && { ...pick(s, ['teamId', 'totalPoints', 'totalPointsLive', 'totalProjectedPointsLive', 'gamesPlayed']), hasRosterForCurrentScoringPeriod: !!s.rosterForCurrentScoringPeriod, hasRosterForMatchupPeriod: !!s.rosterForMatchupPeriod };
  const mps = d.settings && d.settings.scheduleSettings && d.settings.scheduleSettings.matchupPeriods;
  return {
    sport, season,
    scoringPeriodId: period,
    status: pick(d.status, ['currentMatchupPeriod', 'latestScoringPeriod', 'firstScoringPeriod', 'finalScoringPeriod', 'isActive']),
    scoringPeriodsInThisMatchup: mps && mp ? mps[mp] : undefined,
    pickedPeriodForRosterPoints: period,
    sampleTeam: { id: team.id, name: team.name, entries: ((team.roster && team.roster.entries) || []).slice(0, 4).map((e) => {
      const p = (e.playerPoolEntry && e.playerPoolEntry.player) || {};
      return {
        slot: e.lineupSlotId, player: p.fullName, defaultPositionId: p.defaultPositionId, injuryStatus: p.injuryStatus,
        appliedStatTotal: e.playerPoolEntry && e.playerPoolEntry.appliedStatTotal,
        parsedPoints: statTotal(p, 0, period), parsedProjection: statTotal(p, 1, period),
        stats: (p.stats || []).map((x) => pick(x, ['id', 'scoringPeriodId', 'statSourceId', 'statSplitTypeId', 'appliedTotal'])),
      };
    }) },
    sampleMatchup: matchup && { matchupPeriodId: matchup.matchupPeriodId, home: side(matchup.home), away: side(matchup.away) },
  };
}

module.exports = {
  debugSummary,
  CONNECTION_FIELDS, currentSeason, clean, cleanSwid, teamName, round1, fetchLeague, buildStandings, recordText,
  parseRoster, parseEntry, statTotal, liveScore, sum, proxyImages, initialName, SLOTS, POSITIONS,
};
