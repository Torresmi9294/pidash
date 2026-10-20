'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (w, f) => fs.readFileSync(path.join(__dirname, '..', 'widgets', w, f), 'utf8');
process.env.DATA_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pidash-slide-'));

for (const [widget, requireName] of [['sports-highlights', '../widgets/sports-highlights/server'], ['rss', '../widgets/rss/server']]) {
  test(`${widget}: timer and dots are options that default to ON`, () => {
    const fields = require(requireName).meta.fields;
    for (const key of ['showTimer', 'showDots']) {
      const f = fields.find((x) => x.key === key);
      assert.ok(f, `${widget} has a ${key} setting`);
      assert.equal(f.type, 'checkbox');
      assert.equal(f.default, true, 'existing slideshows keep their bar and dots until you turn them off');
    }
  });

  test(`${widget}: the display hides the progress bar / dots only when the option is explicitly false`, () => {
    const src = read(widget, 'client.js');
    assert.match(src, /options\.showTimer === false\) bar\.style\.display = 'none'/);
    assert.match(src, /options\.showDots === false\) dots\.style\.display = 'none'/);
    // never hidden by default: an unset option (undefined) must not match "=== false"
    assert.ok(!/showTimer\s*!==?\s*true|!options\.showTimer/.test(src));
  });
}
