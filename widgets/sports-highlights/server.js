'use strict';
// Sports Highlights: headlines and video clips from ESPN's public news feeds
// (the same feeds espn.com uses). Optionally plays the clips (muted) on the display.
// Unofficial and for personal use; ESPN may change these feeds at any time.

const LEAGUES = {
  nfl: ['football', 'nfl', 'NFL'],
  nba: ['basketball', 'nba', 'NBA'],
  mlb: ['baseball', 'mlb', 'MLB'],
  nhl: ['hockey', 'nhl', 'NHL'],
  cfb: ['football', 'college-football', 'College Football'],
  cbb: ['basketball', 'mens-college-basketball', "Men's College Basketball"],
  wnba: ['basketball', 'wnba', 'WNBA'],
  mls: ['soccer', 'usa.1', 'MLS'],
  epl: ['soccer', 'eng.1', 'Premier League'],
};
const leagueOptions = (none) => [...(none ? [{ value: '', label: 'None' }] : []), ...Object.entries(LEAGUES).map(([value, l]) => ({ value, label: l[2] }))];

exports.meta = {
  type: 'sports-highlights',
  name: 'Sports Highlights',
  description: 'Latest headlines and video clips from ESPN for your leagues.',
  refreshSec: 900,
  noContentFit: true, // the photo/video fills its cell by itself, so no content-fit setting is offered
  fields: [
    { key: 'league', label: 'League', type: 'select', options: leagueOptions(false) },
    { key: 'league2', label: 'Second league (optional)', type: 'select', options: leagueOptions(true) },
    {
      key: 'content', label: 'Show', type: 'select',
      options: [{ value: 'both', label: 'Video clips and stories' }, { value: 'videos', label: 'Video clips only' }, { value: 'stories', label: 'Stories only' }],
    },
    { key: 'playVideo', label: 'Play the video clips (muted). Needs a Pi 4/5 or a PC; off = show thumbnails only', type: 'checkbox' },
    { key: 'itemSeconds', label: 'Seconds per item (thumbnails)', type: 'number', placeholder: '12' },
    { key: 'showTimer', label: 'Show the timer (progress bar under the slide)', type: 'checkbox', default: true },
    { key: 'showDots', label: 'Show the dots (one per slide)', type: 'checkbox', default: true },
    { key: 'maxItems', label: 'Max items', type: 'number', placeholder: '8' },
  ],
};

// Only ever hand the browser media URLs from ESPN's own CDNs.
const SAFE_MEDIA = /^https:\/\/([a-z0-9-]+\.)*(espn\.com|espncdn\.com|espnmedia-cdn\.akamaized\.net|dssott\.com|espn\.go\.com)\//i;
const safe = (u) => (typeof u === 'string' && SAFE_MEDIA.test(u) ? u : '');

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 PiDash/1.0', accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`ESPN returned HTTP ${res.status}`);
  return res.json();
}

async function clipUrl(apiUrl) {
  try {
    const j = await getJson(apiUrl);
    const l = ((j.videos || [])[0] || {}).links || {};
    // Prefer the smaller "mobile" rendition: easier on a Pi's decoder and network.
    return safe(l.mobile && l.mobile.source && l.mobile.source.href) || safe(l.source && l.source.HD && l.source.HD.href) || safe(l.source && l.source.href);
  } catch {
    return '';
  }
}

function toItem(a, league) {
  const isVideo = a.type === 'Media';
  const api = a.links && a.links.api && a.links.api.self && a.links.api.self.href;
  const img = (a.images || []).find((i) => i.url) || {};
  if (a.premium && !isVideo) return null; // paywalled ESPN+ stories
  return {
    id: String(a.id || a.nowId || a.headline),
    type: isVideo ? 'video' : 'story',
    headline: String(a.headline || '').trim(),
    description: String(a.description || '').trim(),
    image: safe(img.url),
    published: a.published || a.lastModified || null,
    league,
    _api: isVideo && typeof api === 'string' && /^https:\/\/content\.core\.api\.espn\.com\//.test(api) ? api : '',
  };
}

exports.data = async (options) => {
  const keys = [options.league || 'nfl', options.league2].filter((k, i, all) => k && LEAGUES[k] && all.indexOf(k) === i);
  if (!keys.length) throw new Error('Pick a league in the widget settings.');
  const want = options.content || 'both';
  const max = Math.min(Math.max(Number(options.maxItems) || 8, 1), 20);

  const feeds = await Promise.allSettled(
    keys.map(async (k) => {
      const [sport, lg, label] = LEAGUES[k];
      const j = await getJson(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${lg}/news?limit=25`);
      return (j.articles || []).map((a) => toItem(a, label)).filter(Boolean);
    }),
  );
  const ok = feeds.filter((f) => f.status === 'fulfilled');
  if (!ok.length) throw new Error(feeds[0].reason.message);

  let items = ok.flatMap((f) => f.value).filter((i) => i.headline);
  if (want === 'videos') items = items.filter((i) => i.type === 'video');
  if (want === 'stories') items = items.filter((i) => i.type === 'story');
  const seen = new Set();
  items = items
    .filter((i) => !seen.has(i.id) && seen.add(i.id))
    .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0))
    .slice(0, max);

  if (options.playVideo) {
    await Promise.all(items.filter((i) => i._api).map(async (i) => { i.video = await clipUrl(i._api); }));
  }
  for (const i of items) delete i._api;
  return { items, leagues: keys.map((k) => LEAGUES[k][2]) };
};

exports._internals = { toItem, safe, LEAGUES };
