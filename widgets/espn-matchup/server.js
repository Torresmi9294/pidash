'use strict';
// ESPN Fantasy - this week's matchup with both rosters side by side, position by position.
// Pick a team with "Team ID" to show its matchup, or leave it blank to rotate through every matchup.
const fantasy = require('../../server/espn-fantasy');

exports.meta = {
  type: 'espn-matchup',
  name: 'Fantasy Matchup Rosters',
  description: 'Head-to-head: both teams\' lineups matched up position by position with live points.',
  refreshSec: 120,
  fields: [
    ...fantasy.CONNECTION_FIELDS,
    { key: 'teamId', label: 'My team ID (blank = rotate through every matchup)', type: 'number', help: 'Shows the matchup that includes this team, with your team on the left. Find it as teamId= in your team page URL. Blank cycles through every matchup this week.' },
    { key: 'itemSeconds', label: 'Seconds per matchup when rotating', type: 'number', placeholder: '12' },
    { key: 'showBench', label: 'Show the benches', type: 'checkbox', default: false },
    { key: 'showProjected', label: 'Show projected points', type: 'checkbox', default: true },
    { key: 'showInjuries', label: 'Show injury tags (Q, D, OUT, IR)', type: 'checkbox', default: true },
    { key: 'showHeadshots', label: 'Show player photos', type: 'checkbox', default: false },
    { key: 'showLogos', label: 'Show team logos', type: 'checkbox', default: true },
    { key: 'highlight', label: 'Highlight the higher score at each position', type: 'checkbox', default: true },
  ],
};

exports.data = async (o, ctx = {}) => {
  const { d, headers, sport, season } = await fantasy.fetchLeague(o, fantasy.MATCHUP_VIEWS);
  const standings = fantasy.buildStandings(d);
  const info = new Map(standings.map((t) => [t.id, t]));
  const period = (d.status && d.status.currentMatchupPeriod) || d.scoringPeriodId || 1;
  const scoringPeriod = d.scoringPeriodId || null;

  const team = (s) => {
    const st = info.get(s.teamId) || { id: s.teamId, name: `Team ${s.teamId}`, abbrev: '', logo: '', wins: 0, losses: 0, ties: 0, rank: 0 };
    const r = fantasy.parseSide(s, { sport, period: scoringPeriod });
    return {
      id: st.id, name: st.name, abbrev: st.abbrev, logo: st.logo, rank: st.rank, record: fantasy.recordText(st),
      score: fantasy.liveScore(s), proj: fantasy.sum(r.starters, 'proj'),
      starters: r.starters, bench: r.bench,
    };
  };

  // Line the two lineups up row by row. Both teams share the league's lineup settings, so the Nth starter of one is
  // the same slot as the Nth of the other; if a lineup is incomplete the missing side is left empty.
  const pair = (home, away) => {
    const rows = [];
    const n = Math.max(home.starters.length, away.starters.length);
    for (let i = 0; i < n; i++) rows.push({ slot: (home.starters[i] || away.starters[i]).slot, home: home.starters[i] || null, away: away.starters[i] || null });
    return rows;
  };

  let list = (d.schedule || []).filter((m) => m.matchupPeriodId === period && m.home && m.away);
  const wanted = o.teamId ? Number(o.teamId) : null;
  if (wanted) {
    if (!info.has(wanted)) throw new Error(`Team ${wanted} is not in this league. Teams: ${standings.map((t) => `${t.id} = ${t.name}`).join(', ')}`);
    list = list.filter((m) => m.home.teamId === wanted || m.away.teamId === wanted);
    if (!list.length) throw new Error(`${info.get(wanted).name} has no opponent this week (bye).`);
  }
  if (!list.length) throw new Error(`No head-to-head matchups found for week ${period}. Is the season over?`);

  const matchups = list.map((m) => {
    let home = team(m.home);
    let away = team(m.away);
    if (wanted && away.id === wanted) [home, away] = [away, home]; // my team on the left
    return { home, away, rows: pair(home, away), margin: fantasy.round1(Math.abs(home.score - away.score)) };
  });
  if (matchups.every((m) => !m.rows.length)) throw new Error('ESPN returned no lineup data for this week. Private leagues need the SWID and espn_s2 cookies, and lineups only exist once the week has started or been set.');

  fantasy.proxyImages(ctx, headers, matchups.flatMap((m) => [m.home, m.away, ...m.home.starters, ...m.away.starters, ...m.home.bench, ...m.away.bench]));
  return { leagueName: (d.settings && d.settings.name) || 'League', season, period, sport, myTeamId: wanted, matchups, single: matchups.length === 1 };
};
