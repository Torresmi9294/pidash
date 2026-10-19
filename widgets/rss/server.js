'use strict';
const { XMLParser } = require('fast-xml-parser');

exports.meta = {
  type: 'rss',
  name: 'News (RSS)',
  description: 'Headlines from any RSS or Atom feed.',
  refreshSec: 600,
  fields: [
    { key: 'feeds', label: 'Feed URLs (one per line)', type: 'textarea', placeholder: 'https://feeds.bbci.co.uk/news/rss.xml' },
    { key: 'maxItems', label: 'Max headlines', type: 'number', placeholder: '8' },
  ],
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const text = (v) => (typeof v === 'object' && v ? v['#text'] || '' : v || '');
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

exports.data = async (options) => {
  const urls = String(options.feeds || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!urls.length) throw new Error('Add at least one feed URL in the widget settings.');
  const all = [];
  await Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url, { headers: { 'user-agent': 'PiDash/1.0' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const doc = parser.parse(await res.text());
      const channel = doc.rss ? doc.rss.channel : doc.feed;
      const source = String(text(channel && channel.title)).trim();
      const items = doc.rss ? arr(channel.item) : arr(channel && channel.entry);
      for (const it of items) {
        all.push({
          title: String(text(it.title)).trim(),
          source,
          date: text(it.pubDate) || text(it.updated) || text(it.published) || null,
        });
      }
    })
  );
  all.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  return { items: all.slice(0, Number(options.maxItems) || 8) };
};
