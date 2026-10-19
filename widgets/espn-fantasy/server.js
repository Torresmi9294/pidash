'use strict';
// ESPN Fantasy (football, baseball, basketball, hockey).
// Uses ESPN's unofficial league API. Private leagues need the SWID and
// espn_s2 cookies from a browser logged in to fantasy.espn.com.

exports.meta = {
  type: 'espn-fantasy',
  name: 'ESPN Fantasy',
  description: 'League standings and this week\'s matchups.',
  refreshSec: 300,
  fields: [
    {
      key: 'sport', label: 'Sport', type: 'select',
      options: [
        { value: 'ffl', label: 'Football' },
        { value: 'flb', label: 'Baseball' },
        { value: 'fba', label: 'Basketball' },
        { value: 'fhl', label: 'Hockey' },
      ],
    },
    { key: 'leagueId', label: 'League ID', type: 'text', placeholder: '123456', help: 'The number after leagueId= in your league URL.' },
    { key: 'season', label: 'Season year (blank = current)', type: 'text', placeholder: '2026' },
    { key: 'swid', label: 'SWID cookie (private leagues)', type: 'text', secret: true, placeholder: '{XXXXXXXX-XXXX-...}' },
    { key: 'espnS2', label: 'espn_s2 cookie (private leagues)', type: 'text', secret: true },
    { key: 'show', label: 'Show', type: 'select', options: [{ value: 'both', label: 'Matchups + standings' }, { value: 'matchups', label: 'Matchups only' }, { value: 'standings', label: 'Standings only' }] },
    { key: 'myTeamId', label: 'Highlight my team ID (optional)', type: 'number' },
  ],
};

function currentSeason(sport) {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (sport === 'ffl') return m < 3 ? y - 1 : y; // season runs Sep-Jan
  if (sport === 'flb') return y;
  return m >= 10 ? y + 1 : y; // basketball/hockey are named for the ending year
}

const teamName = (t) => t.name || [t.location, t.nickname].filter(Boolean).join(' ') || `Team ${t.id}`;

// Pasted cookies often carry stray quotes/newlines/spaces, which make the request invalid.
const clean = (v) => String(v || '').replace(/^\s*(?:swid|espn_s2)\s*=/i, '').replace(/["'\s]/g, '');
const cleanSwid = (v) => {
  const s = clean(v);
  return s && !s.startsWith('{') ? `{${s}}` : s;
};

exports.data = async (o) => {
  if (!o.leagueId) throw new Error('Enter your ESPN league ID in the widget settings.');
  const leagueId = String(o.leagueId).replace(/\D/g, '');
  if (!leagueId) throw new Error('League ID should be the number from your league URL (leagueId=...).');
  const sport = o.sport || 'ffl';
  const season = Number(o.season) || currentSeason(sport);
  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${sport}/seasons/${season}/segments/0/leagues/${leagueId}` +
    '?view=mTeam&view=mMatchupScore&view=mSettings';
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
  const d = await res.json();

  const teams = new Map((d.teams || []).map((t) => [t.id, t]));
  const rec = (t) => (t.record && t.record.overall) || {};
  const standings = [...teams.values()]
    .map((t) => ({
      id: t.id,
      name: teamName(t),
      abbrev: t.abbrev || '',
      wins: rec(t).wins || 0,
      losses: rec(t).losses || 0,
      ties: rec(t).ties || 0,
      pct: rec(t).percentage || 0,
      pointsFor: Math.round((rec(t).pointsFor || 0) * 10) / 10,
    }))
    .sort((a, b) => b.pct - a.pct || b.wins - a.wins || b.pointsFor - a.pointsFor)
    .map((t, i) => ({ ...t, rank: i + 1 }));

  const period = (d.status && d.status.currentMatchupPeriod) || d.scoringPeriodId || 1;
  const side = (s) => s && { id: s.teamId, name: teams.has(s.teamId) ? teamName(teams.get(s.teamId)) : `Team ${s.teamId}`, score: Math.round((s.totalPoints || 0) * 10) / 10 };
  const matchups = (d.schedule || [])
    .filter((m) => m.matchupPeriodId === period && m.home)
    .map((m) => ({ home: side(m.home), away: side(m.away) }));

  return {
    leagueName: (d.settings && d.settings.name) || `League ${leagueId}`,
    season,
    period,
    show: o.show || 'both',
    myTeamId: o.myTeamId ? Number(o.myTeamId) : null,
    standings,
    matchups,
  };
};

exports._internals = { currentSeason, clean, cleanSwid };
