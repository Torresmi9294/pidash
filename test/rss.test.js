'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-rss-'));

const test = require('node:test');
const assert = require('node:assert');
const rss = require('../widgets/rss/server');

const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });
const feeds = (map) => { global.fetch = async (url) => (map[url] ? new Response(map[url], { status: 200 }) : new Response('', { status: 404 })); };

const wrap = (items, ns = '') => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" ${ns}><channel><title>Test &amp; Co</title>${items}</channel></rss>`;
const item = (n, body, date = `Mon, 19 Oct 2026 1${n}:00:00 GMT`) => `<item><title>Story ${n}</title><link>https://example.com/a/${n}</link><pubDate>${date}</pubDate>${body}</item>`;

test('finds thumbnails in every common place and ignores junk', async () => {
  const xml = wrap([
    item(1, '<media:thumbnail url="https://img.example.com/thumb1.jpg" width="144"/>'),
    item(2, '<media:content url="https://img.example.com/c2.jpg" medium="image"/>'),
    item(3, '<media:content url="https://vid.example.com/v3.mp4" type="video/mp4"/><media:thumbnail url="https://img.example.com/vidthumb3.jpg"/>'),
    item(4, '<enclosure url="https://img.example.com/e4.png" type="image/png" length="1"/>'),
    item(5, '<enclosure url="https://aud.example.com/ep5.mp3" type="audio/mpeg" length="1"/>'),
    item(6, '<description><![CDATA[<p>Hello</p><img src="//cdn.example.com/inline6.jpg" width="600"> text]]></description>'),
    item(7, '<content:encoded><![CDATA[<img src="https://trk.example.com/pixel.gif" width="1" height="1"><img src="/media/real7.jpg">]]></content:encoded>'),
    item(8, '<itunes:image href="https://img.example.com/itunes8.jpg"/>'),
    item(9, '<description>Just text, no image.</description>'),
    item('10', '<media:group><media:content url="https://img.example.com/g10.jpg" type="image/jpeg"/></media:group>'),
  ].join(''));
  feeds({ 'https://feed.test/rss': xml });
  const d = await rss.data({ feeds: 'https://feed.test/rss', maxItems: 20 });
  const img = Object.fromEntries(d.items.map((i) => [i.title, i.image]));
  assert.equal(img['Story 1'], 'https://img.example.com/thumb1.jpg');
  assert.equal(img['Story 2'], 'https://img.example.com/c2.jpg');
  assert.equal(img['Story 3'], 'https://img.example.com/vidthumb3.jpg'); // video file skipped, its thumbnail used
  assert.equal(img['Story 4'], 'https://img.example.com/e4.png');
  assert.equal(img['Story 5'], '');                                      // audio enclosure is not an image
  assert.equal(img['Story 6'], 'https://cdn.example.com/inline6.jpg');   // protocol-relative -> https
  assert.equal(img['Story 7'], 'https://example.com/media/real7.jpg');   // tracking pixel skipped, relative URL resolved
  assert.equal(img['Story 8'], 'https://img.example.com/itunes8.jpg');
  assert.equal(img['Story 9'], '');
  assert.equal(img['Story 10'], 'https://img.example.com/g10.jpg');
});

test('Atom feeds: enclosure links and summaries', async () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title>
    <entry><title>Atom story</title><link href="https://example.com/atom/1"/><link rel="enclosure" type="image/jpeg" href="https://img.example.com/atom1.jpg"/><updated>2026-10-19T10:00:00Z</updated><summary>A &lt;b&gt;bold&lt;/b&gt; claim &amp;amp; more</summary></entry></feed>`;
  feeds({ 'https://atom.test/feed': xml });
  const d = await rss.data({ feeds: 'https://atom.test/feed', showSummary: true });
  assert.equal(d.items[0].image, 'https://img.example.com/atom1.jpg');
  assert.equal(d.items[0].source, 'Atom Feed');
  assert.equal(d.items[0].summary, 'A bold claim & more');
});

test('thumbnails can be turned off; summaries are opt-in and truncated', async () => {
  feeds({ 'https://feed.test/rss': wrap(item(1, `<media:thumbnail url="https://img.example.com/t.jpg"/><description>${'word '.repeat(80)}</description>`)) });
  const off = await rss.data({ feeds: 'https://feed.test/rss', showThumbnails: false });
  assert.equal(off.items[0].image, '');
  assert.equal(off.items[0].summary, undefined);
  const on = await rss.data({ feeds: 'https://feed.test/rss', showSummary: true });
  assert.ok(on.items[0].summary.length <= 181 && on.items[0].summary.endsWith('…'));
});

test('images are routed through the local cache proxy when the widget id is known', async () => {
  feeds({ 'https://feed.test/rss': wrap(item(1, '<media:thumbnail url="http://img.example.com/t.jpg"/>') + item(2, '')) });
  const d = await rss.data({ feeds: 'https://feed.test/rss' }, { widgetId: 'rss-7' });
  assert.match(d.items.find((i) => i.title === 'Story 1').image, /^\/api\/logo\?w=rss-7&u=http%3A%2F%2Fimg\.example\.com%2Ft\.jpg$/);
  assert.equal(d.items.find((i) => i.title === 'Story 2').image, '');
});

test('one broken feed does not blank the widget, but all broken does', async () => {
  feeds({ 'https://good.test/rss': wrap(item(1, '')), 'https://notfeed.test/x': '<html>hi</html>' });
  const d = await rss.data({ feeds: 'https://good.test/rss\nhttps://missing.test/rss\nhttps://notfeed.test/x' });
  assert.equal(d.items.length, 1);
  assert.equal(d.warnings.length, 2);
  await assert.rejects(rss.data({ feeds: 'https://missing.test/rss' }), /HTTP 404/);
  await assert.rejects(rss.data({}), /at least one feed/);
});

test('items merge across feeds, newest first, and respect maxItems', async () => {
  feeds({
    'https://a.test/rss': wrap(item(1, '', 'Mon, 19 Oct 2026 08:00:00 GMT') + item(2, '', 'Mon, 19 Oct 2026 12:00:00 GMT')),
    'https://b.test/rss': wrap(item(3, '', 'Mon, 19 Oct 2026 10:00:00 GMT')),
  });
  const d = await rss.data({ feeds: 'https://a.test/rss\nhttps://b.test/rss', maxItems: 2 });
  assert.deepEqual(d.items.map((i) => i.title), ['Story 2', 'Story 3']);
});

test('cache pruning removes only old files', () => {
  const fs = require('fs');
  const path = require('path');
  const config = require('../server/config');
  const logos = require('../server/logos');
  const dir = path.join(config.DATA_DIR, 'cache', 'logos');
  fs.mkdirSync(dir, { recursive: true });
  const oldF = path.join(dir, 'old.bin');
  const newF = path.join(dir, 'new.bin');
  fs.writeFileSync(oldF, 'x');
  fs.writeFileSync(newF, 'y');
  const past = new Date(Date.now() - 20 * 86400e3);
  fs.utimesSync(oldF, past, past);
  logos.prune();
  assert.equal(fs.existsSync(oldF), false);
  assert.equal(fs.existsSync(newF), true);
});

test('duplicate headlines (same story twice, or in two feeds) are shown once', async () => {
  feeds({
    'https://a.test/rss': wrap(item(1, '', 'Mon, 19 Oct 2026 12:00:00 GMT') + item(1, '', 'Mon, 19 Oct 2026 11:00:00 GMT') + item(2, '', 'Mon, 19 Oct 2026 10:00:00 GMT')),
    'https://b.test/rss': wrap(item(1, '', 'Mon, 19 Oct 2026 09:00:00 GMT')),
  });
  const d = await rss.data({ feeds: 'https://a.test/rss' + String.fromCharCode(10) + 'https://b.test/rss', maxItems: 10 });
  assert.deepEqual(d.items.map((i) => i.title), ['Story 1', 'Story 2']);
});

test('layout option: list, featured, slideshow (unknown values fall back to list)', async () => {
  feeds({ 'https://feed.test/rss': wrap(item(1, '')) });
  for (const [given, expected] of [[undefined, 'list'], ['list', 'list'], ['featured', 'featured'], ['slideshow', 'slideshow'], ['carousel', 'list']]) {
    assert.equal((await rss.data({ feeds: 'https://feed.test/rss', layout: given })).layout, expected, String(given));
  }
});

test('big layouts prefer the widest image the feed declares; the list keeps the first (small) one', async () => {
  const body = '<media:content url="https://img.example.com/small.jpg" medium="image" width="240"/><media:content url="https://img.example.com/large.jpg" medium="image" width="1200"/>';
  feeds({ 'https://feed.test/rss': wrap(item(1, body)) });
  assert.equal((await rss.data({ feeds: 'https://feed.test/rss', layout: 'list' })).items[0].image, 'https://img.example.com/small.jpg');
  assert.equal((await rss.data({ feeds: 'https://feed.test/rss', layout: 'featured' })).items[0].image, 'https://img.example.com/large.jpg');
  assert.equal((await rss.data({ feeds: 'https://feed.test/rss', layout: 'slideshow' })).items[0].image, 'https://img.example.com/large.jpg');
});

test('the slideshow is a configurable layout with its own timing field', () => {
  const f = rss.meta.fields;
  assert.ok(f.find((x) => x.key === 'layout').options.some((o) => o.value === 'slideshow'));
  assert.ok(f.find((x) => x.key === 'itemSeconds'));
});
