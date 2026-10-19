'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-verse-'));

const test = require('node:test');
const assert = require('node:assert');
const verse = require('../widgets/verse/server');
const refs = require('../widgets/verse/refs');

const realFetch = global.fetch;
const mock = (fn) => { global.fetch = async (url) => fn(String(url)); };
test.afterEach(() => { global.fetch = realFetch; });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });

test('decodes HTML entities and strips markup and wrapping quotes', () => {
  const { decode, unquote } = verse._internals;
  assert.equal(decode('&ldquo;Take delight in the <span class="x">Lord</span>, &amp; he&#039;s near&rdquo;'), '“Take delight in the Lord, & he\'s near”');
  assert.equal(unquote(decode('&ldquo;Be still.&rdquo;')), 'Be still.');
});

test('Bible Gateway source maps the response and requests the chosen version', async () => {
  let url;
  mock((u) => { url = u; return json({ votd: { text: '&ldquo;Delight yourself in the LORD.&rdquo;', display_ref: 'Psalm 37:4', copyright: '' } }); });
  const v = await verse.data({ source: 'biblegateway', version: 'ESV' });
  assert.match(url, /version=ESV/);
  assert.deepEqual(v, { reference: 'Psalm 37:4', text: 'Delight yourself in the LORD.', version: 'ESV', copyright: '' });
});

test('curated source picks by day of year and uses the chosen translation', async () => {
  let url;
  mock((u) => { url = u; return json({ reference: 'X 1:1', text: ' For God\n so loved ', translation_id: 'kjv' }); });
  const v = await verse.data({ source: 'curated', translation: 'kjv' });
  const expected = refs[verse._internals.dayOfYear(new Date()) % refs.length];
  assert.ok(url.includes(encodeURIComponent(expected)), url);
  assert.match(url, /translation=kjv/);
  assert.equal(v.text, 'For God so loved');
  assert.equal(v.version, 'KJV');
});

test('custom list skips blanks/comments, cycles by day, and explains problems', async () => {
  const { pickFromList } = verse._internals;
  assert.equal(pickFromList(['a', 'b', 'c'], new Date(2026, 0, 1)), 'b'); // day 1 % 3
  assert.equal(pickFromList(['a', 'b', 'c'], new Date(2026, 0, 3)), 'a'); // day 3 % 3
  await assert.rejects(verse.data({ source: 'custom', verses: '# nothing\n\n' }), /at least one verse/);
  mock(() => json({ error: 'not found' }, 404));
  await assert.rejects(verse.data({ source: 'custom', verses: 'Notabook 9:9' }), /Could not find "Notabook 9:9"/);
});

test('every curated reference is unique and well-formed', () => {
  assert.ok(refs.length >= 100);
  assert.equal(new Set(refs).size, refs.length);
  for (const r of refs) assert.match(r, /^(?:[1-3] )?[A-Z][a-z]+ \d+:\d+(?:-\d+)?$/, r);
});
