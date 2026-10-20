'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-cfit-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

function loadFit() {
  const ctx = { window: {}, getComputedStyle: () => ({ overflowX: 'hidden', overflowY: 'hidden' }) };
  vm.runInNewContext(pub('fit.js'), ctx);
  return ctx.window.PidashFit;
}

// A fake widget body whose content height scales with --u (natural px at scale 1) inside a cell of `client` px.
function body(natural, client) {
  const st = { s: 1, removed: 0 };
  return {
    isConnected: true, clientHeight: client, clientWidth: 400, scrollWidth: 100, dataset: {}, children: [],
    get scrollHeight() { return Math.round(natural * st.s); },
    style: { setProperty: (_k, v) => { st.s = parseFloat(/\*\s*([\d.]+)\)/.exec(v)[1]); }, removeProperty: () => { st.s = 1; st.removed++; } },
    querySelectorAll: () => [], removeAttribute() {}, setAttribute() {}, hasAttribute: () => false,
    st,
  };
}

test('fit: each call can choose its own mode, whatever the global default is', () => {
  const Fit = loadFit();
  Fit.setMode('fill');                                    // global default
  const roomy = () => body(100, 400);                      // lots of spare room
  assert.equal(Fit.card(roomy()), 1.6);                    // no per-widget mode: uses the default (fill)
  assert.equal(Fit.card(roomy(), { mode: 'fill' }), 1.6);
  assert.equal(Fit.card(roomy(), { mode: 'shrink' }), 1); // this widget never enlarges
  const off = roomy();
  assert.equal(Fit.card(off, { mode: 'off' }), 1);         // this widget is left alone...
  assert.equal(off.st.removed, 1, '...and any earlier scaling is removed');
  assert.equal(off.dataset.fit, undefined);

  Fit.setMode('off');                                      // and the other way round: a widget can opt IN
  assert.equal(Fit.card(roomy(), { mode: 'fill' }), 1.6);
  assert.equal(Fit.card(roomy()), 1);                      // default is off
  Fit.setMode('fill');
});

test('fit: shrink-only still shrinks when the content is too big', () => {
  const Fit = loadFit();
  const tight = body(100, 80);
  const s = Fit.card(tight, { mode: 'shrink' });
  assert.ok(s > 0.7 && s < 0.85, `expected ~0.8, got ${s}`);
  assert.ok(tight.scrollHeight <= 80);
});

test('fit: a shared sidebar group respects shrink-only and off', () => {
  const Fit = loadFit();
  const container = { scrollHeight: 0, clientHeight: 10000, offsetHeight: 0 };
  const a = body(100, 10000);
  const b = body(100, 10000);
  assert.equal(Fit.group([a, b], container, { mode: 'fill' }), 1.6);
  assert.equal(Fit.group([a, b], container, { mode: 'shrink' }), 1);
  assert.equal(Fit.group([a, b], container, { mode: 'off' }), 1);
  assert.equal(a.st.removed > 0, true);
});

test('display: each card uses its own setting, falling back to the old global one, then to fill', () => {
  const dash = pub('dash.js');
  assert.match(dash, /const fitModeOf = \(c\) =>/);
  assert.match(dash, /c\.w\.options && c\.w\.options\.contentFit/);
  assert.match(dash, /mode: fitModeOf\(c\)/);
  assert.match(dash, /fitModeOf\(c\) !== 'off'/);
  assert.match(dash, /cards\.some\(\(c\) => fitModeOf\(c\) === 'shrink'\) \? 'shrink' : 'fill'/);
});

test('admin: Content fit is a per-widget setting (not offered for widgets that fill themselves); the global select is gone', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8');
  assert.match(admin, /t\.noContentFit \? null : field\(\{ key: 'contentFit', label: 'Content fit'/);
  assert.ok(!admin.includes("'Widget content fit'"), 'global select removed from the Layout panel');
  assert.equal(require('../widgets/sports-highlights/server').meta.noContentFit, true);
  assert.equal(require('../widgets/weather/server').meta.noContentFit, undefined);
});

// ---- server: saving + migration --------------------------------------------------------------------
const config = require('../server/config');

function writeConfig(display, widgets) {
  const base = config.DEFAULTS();
  base.display = { ...base.display, ...display };
  base.widgets = widgets;
  fs.writeFileSync(config.CONFIG_FILE, JSON.stringify(base));
}
const W = (id, options = {}) => ({ id, type: 'clock', enabled: true, slot: 'sidebar', options });

test('migration: an old global "shrink"/"off" is copied onto every widget (explicit choices are kept), then reset to the default', () => {
  writeConfig({ contentFit: 'off' }, [W('a'), W('b', { contentFit: 'fill' }), W('c', { title: 'x' })]);
  let cfg = config.load();
  assert.deepEqual(cfg.widgets.map((w) => w.options.contentFit), ['off', 'fill', 'off']);
  assert.equal(cfg.widgets[2].options.title, 'x');
  assert.equal(cfg.display.contentFit, 'fill');
  // it was saved, so the migration does not run again and cannot clobber later edits
  cfg.widgets[0].options.contentFit = 'shrink';
  config.save(cfg);
  cfg = config.load();
  assert.deepEqual(cfg.widgets.map((w) => w.options.contentFit), ['shrink', 'fill', 'off']);

  writeConfig({ contentFit: 'shrink' }, [W('a')]);
  assert.equal(config.load().widgets[0].options.contentFit, 'shrink');
});

test('migration: the default (fill) and a brand-new install change nothing', () => {
  writeConfig({ contentFit: 'fill' }, [W('a'), W('b', { contentFit: 'off' })]);
  let cfg = config.load();
  assert.deepEqual(cfg.widgets.map((w) => w.options.contentFit), [undefined, 'off']);
  fs.rmSync(config.CONFIG_FILE);
  cfg = config.load();                                    // first run: defaults are written
  assert.ok(cfg.widgets.every((w) => w.options.contentFit === undefined));
  assert.equal(cfg.display.contentFit, 'fill');
});

test('saving: the per-widget setting is validated and survives a round trip through the admin API', async () => {
  const { createApp } = require('../server/app');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json' }, body: o.body && JSON.stringify(o.body) }).then((r) => r.json());
    const cfg = await j('/api/admin/config');
    const [first, second, third] = cfg.widgets;
    first.options.contentFit = 'shrink';
    second.options.contentFit = 'off';
    third.options.contentFit = 'zoom'; // junk
    await j('/api/admin/config', { method: 'PUT', body: cfg });
    const shown = (await j('/api/display')).widgets;
    assert.equal(shown[0].options.contentFit, 'shrink');
    assert.equal(shown[1].options.contentFit, 'off');
    assert.equal('contentFit' in shown[2].options, false);          // junk dropped -> default
    // and the response of the admin API itself carries the saved values back
    const again = await j('/api/admin/config');
    assert.deepEqual(again.widgets.slice(0, 2).map((w) => w.options.contentFit), ['shrink', 'off']);
  } finally {
    server.close();
  }
});
