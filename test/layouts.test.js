'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-lay-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

function loadThemes() {
  const style = new Map();
  const root = { style: { setProperty: (k, v) => style.set(k, v) }, dataset: {} };
  const ctx = { window: {}, document: { documentElement: root } };
  vm.runInNewContext(pub('themes.js'), ctx);
  return { win: ctx.window, style, root };
}

test('every layout preset has display CSS and an admin diagram', () => {
  const { win } = loadThemes();
  const dash = pub('dash.css');
  const adminCss = pub('admin/admin.css');
  const names = Object.keys(win.PIDASH_LAYOUTS);
  assert.deepEqual(names.sort(), ['bottom', 'focus', 'grid', 'grid-rotate', 'sidebar-left', 'sidebar-right', 'top']);
  for (const n of names) {
    assert.ok(win.PIDASH_LAYOUTS[n].label && win.PIDASH_LAYOUTS[n].desc, `${n} needs a label and description`);
    assert.ok(adminCss.includes(`.lay-ico.${n}`), `admin diagram CSS missing for ${n}`);
    // sidebar-left is the base #layout rule; every other preset needs a data-layout rule
    if (n !== 'sidebar-left') assert.ok(dash.includes(`data-layout='${n}'`), `dash.css missing rule for ${n}`);
  }
});

test('layout settings map to CSS variables, with safe fallbacks for unknown values', () => {
  const { win, style, root } = loadThemes();
  win.PIDASH_APPLY_LAYOUT({ sidebarSize: 'wide', spacing: 'tight', corners: 'sharp', transition: 'slide', dots: false });
  assert.equal(style.get('--side'), '36%');
  assert.equal(style.get('--gap'), '0.6rem');
  assert.equal(style.get('--radius'), '0.25rem');
  assert.equal(root.dataset.transition, 'slide');
  assert.equal(root.dataset.dots, 'off');
  assert.equal(root.dataset.titles, 'upper');

  win.PIDASH_APPLY_LAYOUT({ sidebarSize: 'bogus', spacing: '', corners: undefined, transition: 'spin' });
  assert.equal(style.get('--side'), '27%');
  assert.equal(style.get('--gap'), '1.2rem');
  assert.equal(style.get('--radius'), '1.1rem');
  assert.equal(root.dataset.transition, 'fade');
  assert.equal(root.dataset.dots, 'on');
  win.PIDASH_APPLY_LAYOUT({ titleCase: 'normal' });
  assert.equal(root.dataset.titles, 'normal');
});

test('new layout settings have defaults and persist through the admin API', async () => {
  const { createApp } = require('../server/app');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json' }, body: o.body && JSON.stringify(o.body) }).then((r) => r.json());
    const d = (await j('/api/display')).display;
    assert.equal(d.layout, 'sidebar-left');
    assert.equal(d.sidebarSize, 'normal');
    assert.equal(d.dots, true);
    assert.equal(d.gridColumns, 'auto');
    const cfg = await j('/api/admin/config');
    Object.assign(cfg.display, { layout: 'grid', gridColumns: '3', spacing: 'roomy', transition: 'zoom', dots: false });
    await j('/api/admin/config', { method: 'PUT', body: cfg });
    const after = (await j('/api/display')).display;
    assert.deepEqual([after.layout, after.gridColumns, after.spacing, after.transition, after.dots], ['grid', '3', 'roomy', 'zoom', false]);
  } finally {
    server.close();
  }
});

test('suggested panes: each always-visible widget alone, rotating widgets share one pane', () => {
  const { win } = loadThemes();
  const widgets = [
    { id: 'clock-1', slot: 'sidebar', enabled: true }, { id: 'weather-1', slot: 'sidebar', enabled: true },
    { id: 'cal-1', slot: 'rotate', enabled: true }, { id: 'rem-1', slot: 'rotate', enabled: true }, { id: 'off-1', slot: 'rotate', enabled: false },
  ];
  const panes = win.PIDASH_SUGGEST_PANES(widgets);
  assert.deepEqual(panes.map((p) => p.widgets), [['clock-1'], ['weather-1'], ['cal-1', 'rem-1']]);
  assert.equal(panes[2].size, 'w'); // wide when there are two other panes
  assert.equal(win.PIDASH_SUGGEST_PANES(widgets.slice(2, 4))[0].size, 'l'); // no sidebar widgets: one large pane
  assert.deepEqual(win.PIDASH_SUGGEST_PANES([]), []);
  assert.deepEqual(Object.keys(win.PIDASH_PANE_SIZES), ['q', 'hw', 'hh', 's', 'w', 't', 'l', 'xw', 'xt']);
  // widths/heights are whole or half cells (the grid runs on half-cell tracks)
  for (const [k, sz] of Object.entries(win.PIDASH_PANE_SIZES)) {
    assert.ok(Number.isInteger(sz.cols * 2) && Number.isInteger(sz.rows * 2) && sz.cols > 0 && sz.rows > 0, `${k} must be a multiple of half a cell`);
  }
  assert.deepEqual([win.PIDASH_PANE_SIZES.hw.cols, win.PIDASH_PANE_SIZES.hw.rows], [0.5, 1]);  // half wide, full height
  assert.deepEqual([win.PIDASH_PANE_SIZES.hh.cols, win.PIDASH_PANE_SIZES.hh.rows], [1, 0.5]);  // full wide, half height
});

test('grid panes are validated and sanitized when saved', async () => {
  const { createApp } = require('../server/app');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json' }, body: o.body && JSON.stringify(o.body) }).then((r) => r.json());
    const cfg = await j('/api/admin/config');
    cfg.display.layout = 'grid-rotate';
    cfg.display.gridPanes = [
      { widgets: ['clock-1'], size: 's', seconds: '' },
      { widgets: ['calendar-1', 'reminders-1', 42], size: 'huge', seconds: '3' },     // bad size -> s, seconds too small -> ''
      { widgets: ['weather-1'], size: 'l', seconds: 30 },
      { widgets: [], size: 'w' },                                                      // empty pane dropped
      'garbage', null,
      ...Array.from({ length: 20 }, (_, i) => ({ widgets: [`w${i}`], size: 's' })),    // capped at 12 panes
    ];
    await j('/api/admin/config', { method: 'PUT', body: cfg });
    const panes = (await j('/api/display')).display.gridPanes;
    assert.equal(panes.length, 12);
    assert.deepEqual(panes[1], { widgets: ['calendar-1', 'reminders-1', '42'], size: 's', seconds: '' });
    assert.deepEqual(panes[2], { widgets: ['weather-1'], size: 'l', seconds: 30 });
    assert.ok(panes.every((p) => p.widgets.length && ['q', 'hw', 'hh', 's', 'w', 't', 'l', 'xw', 'xt'].includes(p.size)));
    // saving other settings without touching panes keeps them
    const again = await j('/api/admin/config');
    again.display.title = 'Hello';
    delete again.display.gridPanes;
    await j('/api/admin/config', { method: 'PUT', body: again });
    assert.equal((await j('/api/display')).display.gridPanes.length, 12);
  } finally {
    server.close();
  }
});

// ---- content fit ---------------------------------------------------------------------------
function loadFit() {
  const ctx = { window: {}, getComputedStyle: () => ({ overflowX: 'hidden', overflowY: 'hidden' }) };
  vm.runInNewContext(pub('fit.js'), ctx);
  return ctx.window.PidashFit;
}

// A fake widget body whose content height scales with --u, like real text does.
function fakeBody({ natural, client, items = 0, itemHeight = 40, quirk = false, silent = 0 }) {
  const state = { s: 1 };
  const list = Array.from({ length: items }, (_, n) => {
    const attrs = new Set(n >= items - silent ? ['data-fit-silent'] : []); // the LAST `silent` items are optional extras
    return { style: { display: '', removeProperty() { this.display = ''; } }, setAttribute: (k) => attrs.add(k), removeAttribute: (k) => attrs.delete(k), hasAttribute: (k) => attrs.has(k), closest: () => null, querySelectorAll: () => [], attrs };
  });
  const visible = () => list.filter((i) => i.style.display !== 'none').length;
  // one stable element (like a real DOM node): a frame that is always 2px clipped, whatever the scale
  const quirkEl = quirk ? { scrollHeight: 32, clientHeight: 30, scrollWidth: 60, clientWidth: 60, children: [], hasAttribute: () => false, querySelectorAll: () => [] } : null;
  const body = {
    isConnected: true, clientHeight: client, clientWidth: 400, scrollWidth: 100, dataset: {}, attrs: {},
    get scrollHeight() { return Math.round((items ? visible() * itemHeight : natural) * state.s); },
    style: {
      setProperty: (_k, v) => { state.s = parseFloat(/\*\s*([\d.]+)\)/.exec(v)[1]); },
      removeProperty: () => { state.s = 1; },
    },
    querySelectorAll(sel) {
      if (sel === '*') return quirkEl ? [quirkEl] : [];
      if (sel === '[data-fit-item]') return list;
      if (sel === '[data-fit-hidden]') return list.filter((i) => i.style.display === 'none');
      return [];
    },
    removeAttribute(k) { delete this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = v; },
    scale: () => state.s,
  };
  return body;
}

test('fit: shrinks to the largest scale that fits, grows to fill, and respects the modes', () => {
  const Fit = loadFit();
  // natural height 100 px per 1.0 scale; the cell is 80 px tall
  let b = fakeBody({ natural: 100, client: 80 });
  Fit.setMode('fill');
  let s = Fit.card(b);
  assert.ok(Math.abs(s - 0.8) < 0.02, `expected ~0.8, got ${s}`);
  assert.ok(b.scrollHeight <= 80, 'content must fit');

  // plenty of room: fill grows (up to the 1.6 default cap), shrink-only stays at 1
  b = fakeBody({ natural: 100, client: 400 });
  assert.equal(Fit.card(b), 1.6);
  assert.equal(Fit.card(b, { max: 2.5 }), 2.5);
  Fit.setMode('shrink');
  assert.equal(Fit.card(b, { max: 2.5 }), 1);
  b = fakeBody({ natural: 100, client: 80 });
  assert.ok(Fit.card(b) < 0.85);

  Fit.setMode('off');
  assert.equal(Fit.card(b), 1);
  assert.equal(b.scale(), 1);

  Fit.setMode('nonsense'); // falls back to fill
  assert.equal(Fit.mode(), 'fill');
});

test('fit: hidden or zero-size cells are skipped; unfittable content is floored, not looped', () => {
  const Fit = loadFit();
  const hidden = fakeBody({ natural: 100, client: 0 });
  assert.equal(Fit.card(hidden), null);
  const huge = fakeBody({ natural: 100000, client: 50 }); // can never fit
  assert.equal(Fit.card(huge), 0.35); // absolute floor
});

test('fit: when text would get too small, whole trailing items are hidden with a "+N more" count', () => {
  const Fit = loadFit();
  const b = fakeBody({ natural: 0, client: 100, items: 10 }); // 10 rows x 40px: needs scale 0.25 for all
  const s = Fit.card(b);
  const shown = b.querySelectorAll('[data-fit-item]').filter((i) => i.style.display !== 'none').length;
  assert.ok(shown >= 1 && shown < 10, `some items hidden (shown ${shown})`);
  assert.ok(s >= 0.6, `stays readable (${s})`);
  assert.ok(b.scrollHeight <= 100, 'what is shown fits');
  assert.equal(b.attrs['data-fit-trim'], String(10 - shown));
  // a later, roomier fit restores everything
  b.clientHeight = 10000;
  Fit.card(b);
  assert.equal(b.querySelectorAll('[data-fit-item]').filter((i) => i.style.display === 'none').length, 0);
  assert.equal(b.attrs['data-fit-trim'], undefined);
});

test('stylesheet sizes all go through --u so content fit can scale them', () => {
  const css = pub('dash.css');
  const stray = css.split('\n').map((l, i) => [l, i + 1]).filter(([l]) => /\d\s*rem\b/.test(l) && !/--u:\s*1rem/.test(l));
  assert.deepEqual(stray.map(([l, n]) => `${n}: ${l.trim()}`), [], 'use calc(N * var(--u)) instead of rem in dash.css');
  assert.ok(/--u:\s*1rem/.test(css));
  const html = pub('index.html');
  assert.ok(html.indexOf('/fit.js') > -1 && html.indexOf('/fit.js') < html.indexOf('/dash.js'), 'fit.js must load before dash.js');
});

test('content fit defaults to fill and persists', async () => {
  const { createApp } = require('../server/app');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json' }, body: o.body && JSON.stringify(o.body) }).then((r) => r.json());
    assert.equal((await j('/api/display')).display.contentFit, 'fill');
    const cfg = await j('/api/admin/config');
    cfg.display.contentFit = 'shrink';
    await j('/api/admin/config', { method: 'PUT', body: cfg });
    assert.equal((await j('/api/display')).display.contentFit, 'shrink');
  } finally {
    server.close();
  }
});

test('fit: a widget-specific readable floor trims items before shrinking text below it', () => {
  const Fit = loadFit();
  Fit.setMode('fill');
  const b = fakeBody({ natural: 0, client: 100, items: 10 }); // all 10 rows would need ~0.25 scale
  const s = Fit.card(b, { floor: 0.85 });
  assert.ok(s >= 0.85, `text stays at or above the 0.85 floor (got ${s})`);
  const shown = b.querySelectorAll('[data-fit-item]').filter((i) => i.style.display !== 'none').length;
  assert.ok(shown >= 1 && shown <= 3, `more rows hidden than with the default floor (shown ${shown})`);
  assert.ok(b.scrollHeight <= 100);
});

test('news slideshow and list widgets declare how they should be fitted', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'widgets', f, 'client.js'), 'utf8');
  assert.match(src('rss'), /fit:\s*\(o\)\s*=>\s*o\.layout !== 'slideshow'/);
  for (const w of ['rss', 'calendar', 'reminders', 'espn-fantasy']) assert.match(src(w), /fitFloor:\s*0\.\d+/, `${w} should set fitFloor`);
});

test('fit: a tiny scale-independent clip (like an image frame) does not drag the whole widget to the floor', () => {
  const Fit = loadFit();
  Fit.setMode('fill');
  // content needs ~0.8 to fit an 80px cell, and one inner frame is ALWAYS 2px clipped regardless of scale
  const b = fakeBody({ natural: 100, client: 80, quirk: true });
  const s = Fit.card(b);
  assert.ok(s > 0.7 && s < 0.9, `expected ~0.8, got ${s}`);
  assert.ok(b.scrollHeight <= 80, 'real content still has to fit');
  // ...but genuinely too-much content with the same quirk still floors instead of jumping to the maximum
  assert.equal(Fit.card(fakeBody({ natural: 100000, client: 50, quirk: true })), 0.35);
});

test('fit: an overlay pushed out of the TOP of its frame is detected (scrollHeight cannot see that)', () => {
  const Fit = loadFit();
  Fit.setMode('fill');
  const state = { s: 1 };
  // A 100px frame; its text overlay is bottom-anchored and 200px tall at scale 1, so it pokes out of the top once s > 0.5
  const frame = { getBoundingClientRect: () => ({ top: 0, bottom: 100, left: 0, right: 400 }) };
  const overlay = {
    parentElement: frame, children: [], hasAttribute: () => false, querySelectorAll: () => [],
    scrollHeight: 0, clientHeight: 0, scrollWidth: 0, clientWidth: 0,
    getBoundingClientRect: () => ({ top: 100 - 200 * state.s, bottom: 100, left: 0, right: 400 }),
  };
  const body = {
    isConnected: true, clientHeight: 100, clientWidth: 400, scrollHeight: 10, scrollWidth: 10, dataset: {}, children: [],
    style: { setProperty: (_k, v) => { state.s = parseFloat(/\*\s*([\d.]+)\)/.exec(v)[1]); }, removeProperty: () => { state.s = 1; } },
    removeAttribute() {}, setAttribute() {}, hasAttribute: () => false,
    querySelectorAll: (sel) => (sel === '[data-fit-bounds]' ? [overlay] : []),
  };
  const s = Fit.card(body);
  assert.ok(s > 0.45 && s <= 0.51, `scale must shrink until the overlay is inside its frame (~0.5), got ${s}`);
  assert.ok(100 - 200 * s >= -1, 'overlay top is inside the frame');
});

test('news hero keeps its headline in the frame by construction', () => {
  const css = pub('dash.css');
  const rule = (sel) => (css.split('\n').find((l) => l.startsWith(`${sel} {`)) || '');
  assert.ok(!/position:\s*absolute/.test(rule('.rss-hero-text')), 'headline must be in normal flow so the hero grows to hold it');
  assert.match(rule('.rss-hero'), /min-height:\s*min-content/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'widgets', 'rss', 'client.js'), 'utf8'), /'data-fit-bounds': true/);
});

test('half-size panes are accepted and kept when saved (and unknown sizes still fall back to 1x1)', async () => {
  const { createApp } = require('../server/app');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json' }, body: o.body && JSON.stringify(o.body) }).then((r) => r.json());
    const cfg = await j('/api/admin/config');
    cfg.display.gridPanes = ['q', 'hw', 'hh', 'xw', 'xt', 'half', '0.5'].map((size, i) => ({ widgets: [`w${i}`], size }));
    await j('/api/admin/config', { method: 'PUT', body: cfg });
    const sizes = (await j('/api/display')).display.gridPanes.map((p) => p.size);
    assert.deepEqual(sizes, ['q', 'hw', 'hh', 'xw', 'xt', 's', 's']);
  } finally {
    server.close();
  }
});

test('rotating grid CSS uses half-cell tracks and per-pane spans', () => {
  const css = pub('dash.css');
  assert.match(css, /#layout\[data-layout='grid-rotate'\][^}]*repeat\(calc\(var\(--cols, 2\) \* 2\)/);
  assert.match(css, /\.pane \{ grid-column: span var\(--cs, 2\); grid-row: span var\(--rs, 2\); \}/);
  assert.ok(!/\.pane\.span-/.test(css), 'old whole-cell span classes are gone');
});

test('fit: optional extras marked silent are dropped without a "+N more" note; real entries still get one', () => {
  const Fit = loadFit();
  Fit.setMode('fill');
  // 10 rows x 40px in a 100px cell. All 10 are silent extras (like forecast / chart): nothing is announced.
  let b = fakeBody({ natural: 0, client: 100, items: 10, silent: 10 });
  Fit.card(b);
  assert.ok(b.querySelectorAll('[data-fit-item]').some((i) => i.style.display === 'none'), 'extras were hidden');
  assert.equal(b.attrs['data-fit-trim'], undefined, 'no note for silent extras');
  // the last 6 are silent extras, the first 4 are real entries: only hidden real entries are counted
  b = fakeBody({ natural: 0, client: 100, items: 10, silent: 6 });
  Fit.card(b);
  const list = b.querySelectorAll('[data-fit-item]');
  const hiddenReal = list.slice(0, 4).filter((i) => i.style.display === 'none').length;
  assert.equal(b.attrs['data-fit-trim'], hiddenReal > 0 ? String(hiddenReal) : undefined);
});

test('health and weather mark their optional parts so small panes drop them quietly', () => {
  const src = (w) => fs.readFileSync(path.join(__dirname, '..', 'widgets', w, 'client.js'), 'utf8');
  assert.match(src('health'), /class: 'bars', 'data-fit-item': true, 'data-fit-silent': true/);
  assert.match(src('health'), /class: 'hstat', 'data-fit-item': true, 'data-fit-silent': true/);
  assert.match(src('weather'), /class: 'wx-days', 'data-fit-item': true, 'data-fit-silent': true/);
});
