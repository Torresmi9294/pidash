'use strict';
const { XMLParser } = require('fast-xml-parser');
const logos = require('../../server/logos');

exports.meta = {
  type: 'rss',
  name: 'News (RSS)',
  description: 'Headlines from any RSS or Atom feed, with thumbnails when the feed provides them.',
  refreshSec: 600,
  fields: [
    { key: 'feeds', label: 'Feed URLs (one per line)', type: 'textarea', placeholder: 'https://feeds.bbci.co.uk/news/rss.xml' },
    { key: 'maxItems', label: 'Max headlines', type: 'number', placeholder: '8' },
    { key: 'showThumbnails', label: 'Show thumbnails (when the feed has images)', type: 'checkbox', default: true },
    {
      key: 'layout', label: 'Layout', type: 'select',
      options: [
        { value: 'list', label: 'List' },
        { value: 'featured', label: 'Featured top story + list' },
        { value: 'slideshow', label: 'Featured stories slideshow (one big story at a time, rotating)' },
      ],
    },
    { key: 'itemSeconds', label: 'Seconds per story (slideshow)', type: 'number', placeholder: '12' },
    { key: 'showTimer', label: 'Show the timer (progress bar) - slideshow only', type: 'checkbox', default: true },
    { key: 'showDots', label: 'Show the dots (one per story) - slideshow only', type: 'checkbox', default: true },
    { key: 'showSummary', label: 'Show a short summary under each headline', type: 'checkbox' },
  ],
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const text = (v) => (typeof v === 'object' && v ? v['#text'] || '' : v == null ? '' : v);
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–', hellip: '…' };
const plain = (html) =>
  String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(c) ? String.fromCodePoint(c) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();

const isImageType = (t) => /^image\//i.test(String(t || ''));
const looksLikeImage = (u) => /\.(jpe?g|png|gif|webp|avif|svg)(\?|#|$)/i.test(u);
const TRACKER = /pixel|1x1|spacer|beacon|feedburner|doubleclick|analytics|tracking/i;

// Finds a thumbnail for a feed item. Feeds put images in many places; check the common ones in
// order of reliability: media:thumbnail, media:content, enclosure, itunes:image, <image>, then the first
// <img> inside the item's HTML.
function imageFrom(it, base, preferLarge = false) {
  const found = [];
  const widths = new Map();
  const add = (u, w) => {
    if (typeof u === 'string' && u.trim()) {
      found.push(u.trim());
      if (Number(w) > 0) widths.set(u.trim(), Number(w));
    }
  };
  const groups = arr(it['media:group']);
  const thumbs = [...arr(it['media:thumbnail']), ...groups.flatMap((g) => arr(g['media:thumbnail']))];
  const contents = [...arr(it['media:content']), ...groups.flatMap((g) => arr(g['media:content']))];

  thumbs.forEach((m) => add(m['@_url'], m['@_width']));
  contents.forEach((m) => {
    if (isImageType(m['@_type']) || m['@_medium'] === 'image' || (!m['@_type'] && !m['@_medium'] && looksLikeImage(m['@_url'] || ''))) add(m['@_url'], m['@_width']);
  });
  arr(it.enclosure).forEach((e) => { if (isImageType(e['@_type']) || (!e['@_type'] && looksLikeImage(e['@_url'] || ''))) add(e['@_url']); });
  arr(it.link).forEach((l) => { if (l && typeof l === 'object' && l['@_rel'] === 'enclosure' && isImageType(l['@_type'])) add(l['@_href']); });
  arr(it['itunes:image']).forEach((m) => add(m['@_href']));
  arr(it.image).forEach((m) => add(typeof m === 'string' ? m : m && m.url));

  const html = [it['content:encoded'], it.content, it.description, it.summary].map(text).join(' ');
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (src && !TRACKER.test(tag) && !/\bwidth\s*=\s*["']?1["']?\s/i.test(tag)) { add(src[1]); break; }
  }

  // Big layouts (hero / slideshow) prefer the widest image the feed declares; the list uses the first (small, quick).
  if (preferLarge && widths.size) found.sort((a, b) => (widths.get(b) || 0) - (widths.get(a) || 0));
  for (const raw of found) {
    try {
      const u = new URL(raw.replace(/&amp;/g, '&'), base);
      if (/^https?:$/.test(u.protocol)) return u.toString();
    } catch { /* try the next candidate */ }
  }
  return '';
}

const summaryOf = (it) => {
  const s = plain(text(it.description) || text(it.summary) || text(it['content:encoded']) || text(it.content));
  return s.length > 180 ? `${s.slice(0, 177).replace(/\s+\S*$/, '')}…` : s;
};

const linkOf = (it) => {
  const l = arr(it.link).map((x) => (typeof x === 'string' ? x : x && x['@_href'])).find((x) => x && /^https?:/.test(x));
  return l || '';
};

async function readFeed(url, wantImages, preferLarge) {
  const res = await fetch(url, { headers: { 'user-agent': 'PiDash/1.0', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const doc = parser.parse(await res.text());
  const root = doc.rss ? doc.rss.channel : doc.feed || doc['rdf:RDF'];
  if (!root) throw new Error(`${url}: not an RSS or Atom feed`);
  const source = plain(text(root.title || (root.channel && root.channel.title)));
  const items = doc.rss ? arr(root.item) : doc.feed ? arr(root.entry) : arr(root.item);
  return items.map((it) => {
    const link = linkOf(it);
    return {
      title: plain(text(it.title)),
      source,
      date: text(it.pubDate) || text(it['dc:date']) || text(it.updated) || text(it.published) || null,
      summary: summaryOf(it),
      image: wantImages ? imageFrom(it, link || url, preferLarge) : '',
    };
  });
}

exports.data = async (options, ctx = {}) => {
  const urls = String(options.feeds || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!urls.length) throw new Error('Add at least one feed URL in the widget settings.');
  const wantImages = options.showThumbnails !== false;
  const layout = ['featured', 'slideshow'].includes(options.layout) ? options.layout : 'list';
  const results = await Promise.allSettled(urls.map((u) => readFeed(u, wantImages, layout !== 'list')));
  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw results[0].reason; // every feed failed; a single bad feed alone does not blank the widget

  const max = Math.min(Math.max(Number(options.maxItems) || 8, 1), 20);
  const seen = new Set(); // feeds sometimes list the same story twice (or the same story in two feeds)
  const items = ok.flatMap((r) => r.value).filter((i) => i.title)
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .filter((i) => { const k = i.title.toLowerCase(); return !seen.has(k) && seen.add(k); })
    .slice(0, max);

  // Serve thumbnails from this server (cached; avoids hotlink/referrer/http problems).
  if (ctx.widgetId && wantImages) {
    const sources = items.map((i) => i.image).filter(Boolean);
    logos.allow(ctx.widgetId, sources);
    for (const i of items) if (i.image) i.image = logos.proxyUrl(ctx.widgetId, i.image);
    logos.warm(ctx.widgetId, sources.map((s) => logos.normalize(s)).filter(Boolean)).catch(() => {});
  }
  if (!options.showSummary) for (const i of items) delete i.summary;
  return { items, layout, warnings: results.filter((r) => r.status === 'rejected').map((r) => r.reason.message) };
};

exports._internals = { imageFrom, plain };
