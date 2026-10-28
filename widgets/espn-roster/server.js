'use strict';
// ESPN Fantasy - one team's roster: starters, bench and injury report, with this week's points.
// Pick a team with "Team ID", or leave it blank to rotate through every team in the league.
const fantasy = require('../../server/espn-fantasy');

exports.meta = {
  type: 'espn-roster',
  name: 'Fantasy Roster',
  description: 'Your ESPN fantasy team\'s lineup: starters, bench, injuries and points.',
  refreshSec: 300,
  fields: [
    ...fantasy.CONNECTION_FIELDS,
    { key: 'teamId', label: 'Team ID (blank = rotate through every team)', type: 'number', help: 'Find it as teamId= in the URL of your team page. Leave blank to cycle through all teams in the league.' },
    { key: 'itemSeconds', label: 'Seconds per team when rotating', type: 'number', placeholder: '12' },
    { key: 'showBench', label: 'Show the bench', type: 'checkbox', default: true },
    { key: 'showProjected', label: 'Show projected points', type: 'checkbox', default: true },
    { key: 'showInjuries', label: 'Show injury tags (Q, D, OUT, IR)', type: 'checkbox', default: true },
    { key: 'showHeadshots', label: 'Show player photos', type: 'checkbox', default: true },
    { key: 'showLogos', label: 'Show team logo', type: 'checkbox', default: true },
  ],
};

exports.data = async (o, ctx = {}) => {
  const { d, headers, sport, season } = await fantasy.fetchLeague(o, ['mTeam', 'mRoster', 'mMatchupScore', 'mSettings']);
  const standings = fantasy.buildStandings(d);
  const byId = new Map((d.teams || []).map((t) => [t.id, t]));
  const period = d.scoringPeriodId || (d.status && d.status.currentMatchupPeriod) || 1;

  // Football weeks are one scoring period, so "this week" is the roster's own total. Basketball, baseball and hockey
  // score every day inside a longer matchup, so also show the matchup's running total (it grows each day).
  const matchupPeriod = d.status && d.status.currentMatchupPeriod;
  const weekScore = (teamId) => {
    if (sport === 'ffl' || !matchupPeriod) return null;
    for (const m of d.schedule || []) {
      if (m.matchupPeriodId !== matchupPeriod) continue;
      const side = [m.home, m.away].find((x) => x && x.teamId === teamId);
      if (side) return fantasy.liveScore(side);
    }
    return null;
  };

  const card = (st) => {
    const t = byId.get(st.id);
    const r = fantasy.parseRoster((t.roster && t.roster.entries) || [], { sport, period });
    return {
      week: weekScore(st.id),
      id: st.id, name: st.name, abbrev: st.abbrev, logo: st.logo, rank: st.rank, record: fantasy.recordText(st), streak: st.streak,
      points: fantasy.sum(r.starters, 'pts'), proj: fantasy.sum(r.starters, 'proj'),
      starters: r.starters, bench: r.bench, reserve: r.reserve,
    };
  };

  const wanted = o.teamId ? Number(o.teamId) : null;
  let picked = standings;
  if (wanted) {
    picked = standings.filter((t) => t.id === wanted);
    if (!picked.length) throw new Error(`Team ${wanted} is not in this league. Teams: ${standings.map((t) => `${t.id} = ${t.name}`).join(', ')}`);
  }
  const teams = picked.filter((st) => byId.has(st.id)).map(card);
  if (teams.some((t) => !t.starters.length && !t.bench.length)) {
    // Not fatal for the other teams, but a league with no roster data at all is almost always a private league without cookies.
    if (teams.every((t) => !t.starters.length && !t.bench.length)) throw new Error('ESPN returned no roster data for this league. Private leagues need the SWID and espn_s2 cookies.');
  }

  fantasy.proxyImages(ctx, headers, [...teams, ...teams.flatMap((t) => [...t.starters, ...t.bench, ...t.reserve])]);
  return { leagueName: (d.settings && d.settings.name) || 'League', season, period, matchupPeriod: matchupPeriod || null, sport, daily: sport !== 'ffl', teams, single: teams.length === 1 };
};
