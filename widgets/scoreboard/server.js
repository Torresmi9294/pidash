'use strict';
// Live Scoreboard: live scores, upcoming games and finals from ESPN's free public scoreboard feeds
// (no account, key or subscription; the feed is unofficial and may change). Checks every 30 seconds while
// anything is live, and only every few minutes when nothing is, so it stays polite.
const logos = require('../../server/logos');
const { LEAGUES, leagueOptions } = require('../../server/espn-leagues');

exports.meta = {
  type: 'scoreboard',
  name: 'Live Scoreboard',
  description: 'Live scores, schedules and finals for the leagues you pick. Free ESPN data.',
  refreshSec: 30,
  fields: [
    { key: 'league', label: 'League', type: 'select', options: leagueOptions(false) },
    { key: 'league2', label: 'Second league (optional)', type: 'select', options: leagueOptions(true) },
    { key: 'league3', label: 'Third league (optional)', type: 'select', options: leagueOptions(true) },
    {
      key: 'show', label: 'Games to show', type: 'select',
      options: [
        { value: 'all', label: 'Everything in the feed (live, upcoming and finished)' },
        { value: 'today', label: "Today's games (plus anything still in progress)" },
        { value: 'active', label: 'Live and upcoming (hide finished games)' },
        { value: 'live', label: 'Live games only' },
      ],
    },
    {
      key: 'view', label: 'View', type: 'select', rerender: true,
      options: [
        { value: 'cards', label: 'Cards - a grid of game cards' },
        { value: 'list', label: 'List - one line per game' },
        { value: 'slideshow', label: 'Slideshow - one big game at a time' },
        { value: 'ticker', label: 'Ticker - a scrolling strip of scores' },
      ],
    },
    { key: 'slideLive', label: 'Only show live games while any game is live', type: 'checkbox', default: true, showIf: { key: 'view', value: 'slideshow' }, help: 'When nothing is live it goes back to showing every game.' },
    { key: 'slideSeconds', label: 'Seconds per game', type: 'number', placeholder: '8', showIf: { key: 'view', value: 'slideshow' } },
    { key: 'showDots', label: 'Show the dots', type: 'checkbox', default: true, showIf: { key: 'view', value: 'slideshow' } },
    {
      key: 'tickerSpeed', label: 'Ticker speed', type: 'select', default: 'medium', showIf: { key: 'view', value: 'ticker' },
      options: [{ value: 'slow', label: 'Slow' }, { value: 'medium', label: 'Medium' }, { value: 'fast', label: 'Fast' }],
    },
    { key: 'favorites', label: 'My teams (comma-separated)', type: 'text', placeholder: 'NE, Celtics, Bruins', help: 'Abbreviations or names. Their games get a star and move to the top.' },
    { key: 'onlyFavorites', label: 'Only show games with my teams', type: 'checkbox' },
    { key: 'maxGames', label: 'Max games', type: 'number', placeholder: '12' },
    { key: 'showLogos', label: 'Show team logos', type: 'checkbox', default: true },
    { key: 'showRecords', label: 'Show team records (W-L)', type: 'checkbox', default: true },
  ],
};

const LIVE_TTL = 20e3;     // while any game is live
const IDLE_TTL = 240e3;    // otherwise
const cache = new Map();   // league key -> { at, live, events }

async function fetchLeague(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.live ? LIVE_TTL : IDLE_TTL)) return hit.events;
  const [sport, lg] = LEAGUES[key];
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${lg}/scoreboard`, {
      headers: { 'user-agent': 'Mozilla/5.0 PiDash/1.0', accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`ESPN returned HTTP ${res.status}`);
    const events = (await res.json()).events || [];
    cache.set(key, { at: Date.now(), live: events.some((e) => e && e.status && e.status.type && e.status.type.state === 'in'), events });
    return events;
  } catch (e) {
    if (hit) return hit.events; // stale scores beat an error screen
    throw e;
  }
}

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function favoriteMatcher(text) {
  const tokens = String(text || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  // an abbreviation must match exactly; a name token (3+ letters) may match part of the team name
  return (side) => tokens.some((t) => t === String(side.abbr).toLowerCase() || (t.length >= 3 && String(side.name).toLowerCase().includes(t)));
}

function situationText(comp, state) {
  const s = comp.situation;
  if (state !== 'in' || !s) return '';
  const parts = [];
  if (s.shortDownDistanceText || s.downDistanceText) parts.push(s.shortDownDistanceText || s.downDistanceText);
  if (s.possessionText) parts.push(s.possessionText);
  if (typeof s.outs === 'number') parts.push(`${s.outs} out${s.outs === 1 ? '' : 's'}`);
  if (typeof s.balls === 'number' && typeof s.strikes === 'number') parts.push(`${s.balls}-${s.strikes}`);
  if (s.isRedZone) parts.push('Red zone');
  return parts.join(' · ');
}

function normalize(e, leagueLabel, isFav) {
  const comp = e && Array.isArray(e.competitions) ? e.competitions[0] : null;
  if (!comp || !Array.isArray(comp.competitors) || comp.competitors.length < 2) return null;
  const t = (e.status && e.status.type) || {};
  const state = ['pre', 'in', 'post'].includes(t.state) ? t.state : 'pre';
  const possession = comp.situation && comp.situation.possession != null ? String(comp.situation.possession) : null;

  const side = (c) => {
    const tm = c.team || {};
    const rec = (c.records || []).find((r) => r.type === 'total') || (c.records || [])[0];
    const rank = c.curatedRank && c.curatedRank.current > 0 && c.curatedRank.current < 99 ? c.curatedRank.current : null;
    const s = {
      id: tm.id != null ? String(tm.id) : '',
      abbr: tm.abbreviation || '',
      name: tm.displayName || tm.name || 'TBD',
      short: tm.shortDisplayName || tm.name || tm.abbreviation || 'TBD',
      logo: tm.logo || '',
      color: /^[0-9a-f]{6}$/i.test(tm.color || '') ? `#${tm.color}` : '',
      score: state === 'pre' ? null : num(c.score),
      record: rec && rec.summary ? String(rec.summary) : '',
      rank,
      winner: state === 'post' && !!c.winner,
      home: c.homeAway === 'home',
      hasBall: state === 'in' && possession !== null && possession === String(tm.id),
    };
    s.fav = isFav(s);
    return s;
  };
  const sides = comp.competitors.map(side);
  const away = sides.find((s) => !s.home) || sides[0];
  const home = sides.find((s) => s.home && s !== away) || sides[1];
  const broadcast = (comp.broadcasts || []).flatMap((b) => b.names || []).slice(0, 2).join(', ') || (typeof comp.broadcast === 'string' ? comp.broadcast : '');
  return {
    id: String(e.id),
    league: leagueLabel,
    state,
    status: String(t.shortDetail || t.detail || t.description || ''),
    clock: e.status && e.status.displayClock ? String(e.status.displayClock) : '',
    period: e.status ? num(e.status.period) : null,
    start: e.date || null,
    away,
    home,
    broadcast,
    venue: (comp.venue && comp.venue.fullName) || '',
    situation: situationText(comp, state),
    fav: away.fav || home.fav,
  };
}

const sameLocalDay = (iso, now) => {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

exports.data = async (options, ctx = {}) => {
  const keys = [options.league || 'nfl', options.league2, options.league3].filter((k, i, a) => k && LEAGUES[k] && a.indexOf(k) === i);
  if (!keys.length) throw new Error('Pick a league in the widget settings.');
  const isFav = favoriteMatcher(options.favorites);
  const show = ['all', 'today', 'active', 'live'].includes(options.show) ? options.show : 'all';
  const max = Math.min(Math.max(Number(options.maxGames) || 12, 1), 40);

  const results = await Promise.allSettled(keys.map(async (k) => (await fetchLeague(k)).map((e) => normalize(e, LEAGUES[k][2], isFav)).filter(Boolean)));
  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw results[0].reason;

  const now = new Date();
  let games = ok.flatMap((r) => r.value);
  const anyLive = games.some((g) => g.state === 'in');
  const upcoming = games.filter((g) => g.state === 'pre' && g.start).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  if (options.onlyFavorites) games = games.filter((g) => g.fav);
  if (show === 'live') games = games.filter((g) => g.state === 'in');
  else if (show === 'active') games = games.filter((g) => g.state !== 'post');
  else if (show === 'today') games = games.filter((g) => g.state === 'in' || (g.start && sameLocalDay(g.start, now)));

  // my teams first, then live, then upcoming (soonest first), then finished (most recent first)
  const rank = { in: 0, pre: 1, post: 2 };
  games.sort((a, b) => (b.fav - a.fav) || (rank[a.state] - rank[b.state])
    || (a.state === 'post' ? Date.parse(b.start) - Date.parse(a.start) : Date.parse(a.start) - Date.parse(b.start)));
  games = games.slice(0, max);

  // team logos are fetched and cached by this server (see server/logos.js)
  if (ctx.widgetId && options.showLogos !== false) {
    const sources = [...new Set(games.flatMap((g) => [g.away.logo, g.home.logo]).filter(Boolean))];
    logos.allow(ctx.widgetId, sources);
    for (const g of games) for (const s of [g.away, g.home]) if (s.logo) s.logo = logos.proxyUrl(ctx.widgetId, s.logo);
    logos.warm(ctx.widgetId, sources.map((u) => logos.normalize(u)).filter(Boolean)).catch(() => {});
  }

  return {
    games,
    show,
    anyLive,
    leagues: keys.map((k) => LEAGUES[k][2]),
    multi: keys.length > 1,
    next: upcoming ? { start: upcoming.start, label: `${upcoming.away.abbr || upcoming.away.short} @ ${upcoming.home.abbr || upcoming.home.short}` } : null,
    warnings: results.filter((r) => r.status === 'rejected').map((r) => r.reason.message),
  };
};

exports._internals = { normalize, favoriteMatcher, situationText, cache };
