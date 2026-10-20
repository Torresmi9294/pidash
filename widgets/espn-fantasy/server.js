'use strict';
// ESPN Fantasy (football, baseball, basketball, hockey).
// Uses ESPN's unofficial league API. Private leagues need the SWID and
// espn_s2 cookies from a browser logged in to fantasy.espn.com.

const fantasy = require('../../server/espn-fantasy');

exports.meta = {
  type: 'espn-fantasy',
  name: 'ESPN Fantasy',
  description: 'League standings and this week\'s matchups.',
  refreshSec: 300,
  fields: [
    ...fantasy.CONNECTION_FIELDS,
    { key: 'show', label: 'Show', type: 'select', options: [{ value: 'both', label: 'Matchups + standings' }, { value: 'matchups', label: 'Matchups only' }, { value: 'standings', label: 'Standings only' }] },
    {
      key: 'arrange', label: 'Layout', type: 'select',
      options: [{ value: 'side', label: 'Side by side (matchups left, standings right)' }, { value: 'stacked', label: 'Stacked (matchups on top, standings below)' }],
      help: 'Stacked suits tall, narrow spaces. It only matters when both matchups and standings are shown.',
    },
    { key: 'myTeamId', label: 'My team ID (optional)', type: 'number', help: 'Your team is always highlighted and gets its own callout. Find it as teamId= in the URL of your team page.' },
    { key: 'pinnedTeams', label: 'Also pin these team IDs (comma-separated)', type: 'text', placeholder: '3, 7', help: 'Pinned teams are always highlighted - handy for a rival or a friend.' },
    { key: 'showLogos', label: 'Show team logos', type: 'checkbox', default: true },
    { key: 'highlight', label: 'Highlight what matters (leaders, close games, top 3)', type: 'checkbox', default: true },
    { key: 'callouts', label: 'Show matchup callouts (top score, blowout, closest game, my streak)', type: 'checkbox', default: true },
  ],
};

const logos = require('../../server/logos');

const { teamName, currentSeason, clean, cleanSwid } = fantasy;

// Fun facts about the current matchup period, shown as chips under the matchups.
function buildCallouts(matchups, standings, myTeamId) {
  const out = [];
  const played = matchups.filter((m) => m.away && (m.home.score > 0 || m.away.score > 0));
  const winner = (m) => (m.home.score >= m.away.score ? m.home : m.away);
  if (played.length) {
    const sides = played.flatMap((m) => [m.home, m.away]);
    const best = sides.reduce((a, b) => (b.score > a.score ? b : a));
    out.push({ icon: '\u{1F525}', label: 'Top score', text: `${best.name} ${best.score}`, teamId: best.id });
    const blow = played.reduce((a, b) => (b.margin > a.margin ? b : a));
    if (blow.margin > 0) out.push({ icon: '\u{1F4A5}', label: 'Biggest blowout', text: `${winner(blow).name} by ${blow.margin}`, teamId: winner(blow).id });
    if (played.length > 1) {
      const tight = played.reduce((a, b) => (b.margin < a.margin ? b : a));
      out.push({ icon: '\u{1F62C}', label: 'Closest game', text: tight.margin > 0 ? `${winner(tight).name} by ${tight.margin}` : 'Tied!', teamId: winner(tight).id });
    }
  }
  const mine = myTeamId && standings.find((t) => t.id === myTeamId);
  if (mine) {
    out.push({ icon: '\u2B50', label: 'My team', text: `#${mine.rank} \u00B7 ${mine.wins}-${mine.losses}${mine.ties ? `-${mine.ties}` : ''}${mine.streak ? ` \u00B7 ${mine.streak}` : ''}`, teamId: mine.id });
  }
  return out;
}

exports.data = async (o, ctx = {}) => {
  const { d, headers, leagueId, season } = await fantasy.fetchLeague(o, ['mTeam', 'mMatchupScore', 'mSettings']);
  const teams = new Map((d.teams || []).map((t) => [t.id, t]));
  const standings = fantasy.buildStandings(d);

  const period = (d.status && d.status.currentMatchupPeriod) || d.scoringPeriodId || 1;
  const side = (s) => {
    if (!s) return s;
    const t = teams.get(s.teamId);
    return {
      id: s.teamId,
      name: t ? teamName(t) : `Team ${s.teamId}`,
      abbrev: (t && t.abbrev) || '',
      logo: (t && t.logo) || '',
      score: Math.round((s.totalPoints || 0) * 10) / 10,
    };
  };
  const matchups = (d.schedule || [])
    .filter((m) => m.matchupPeriodId === period && m.home)
    .map((m) => {
      const home = side(m.home);
      const away = side(m.away);
      const margin = away ? Math.round(Math.abs(home.score - away.score) * 10) / 10 : 0;
      const top = away ? Math.max(home.score, away.score) : 0;
      return { home, away, margin, close: !!away && top > 0 && margin / top <= 0.06 };
    });

  const myTeamId = o.myTeamId ? Number(o.myTeamId) : null;
  const pinned = String(o.pinnedTeams || '').split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const callouts = buildCallouts(matchups, standings, myTeamId);

  // Serve team logos from this server (cached; avoids hotlink/referrer/mixed-content/login problems).
  if (ctx.widgetId) {
    const sources = [...standings.map((t) => t.logo), ...matchups.flatMap((m) => [m.home, m.away].filter(Boolean).map((s) => s.logo))].filter(Boolean);
    logos.allow(ctx.widgetId, sources, headers.cookie || '');
    const swap = (item) => { if (item.logo) item.logo = logos.proxyUrl(ctx.widgetId, item.logo); };
    standings.forEach(swap);
    matchups.forEach((m) => { swap(m.home); if (m.away) swap(m.away); });
    logos.warm(ctx.widgetId, sources.map((s) => logos.normalize(s)).filter(Boolean)).catch(() => {});
  }

  return {
    leagueName: (d.settings && d.settings.name) || `League ${leagueId}`,
    season,
    period,
    show: o.show || 'both',
    myTeamId,
    pinned,
    standings,
    matchups,
    callouts,
  };
};

exports._internals = { currentSeason, clean, cleanSwid };
