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

  win.PIDASH_APPLY_LAYOUT({ sidebarSize: 'bogus', spacing: '', corners: undefined, transition: 'spin' });
  assert.equal(style.get('--side'), '27%');
  assert.equal(style.get('--gap'), '1.2rem');
  assert.equal(style.get('--radius'), '1.1rem');
  assert.equal(root.dataset.transition, 'fade');
  assert.equal(root.dataset.dots, 'on');
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
  assert.deepEqual(Object.keys(win.PIDASH_PANE_SIZES), ['s', 'w', 't', 'l']);
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
    assert.ok(panes.every((p) => p.widgets.length && ['s', 'w', 't', 'l'].includes(p.size)));
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
function fakeBody({ natural, client, items = 0, itemHeight = 40 }) {
  const state = { s: 1 };
  const list = Array.from({ length: items }, () => {
    const attrs = new Set();
    return { style: { display: '', removeProperty() { this.display = ''; } }, setAttribute: (k) => attrs.add(k), removeAttribute: (k) => attrs.delete(k), closest: () => null, querySelectorAll: () => [], attrs };
  });
  const visible = () => list.filter((i) => i.style.display !== 'none').length;
  const body = {
    isConnected: true, clientHeight: client, clientWidth: 400, scrollWidth: 100, dataset: {}, attrs: {},
    get scrollHeight() { return Math.round((items ? visible() * itemHeight : natural) * state.s); },
    style: {
      setProperty: (_k, v) => { state.s = parseFloat(/\*\s*([\d.]+)\)/.exec(v)[1]); },
      removeProperty: () => { state.s = 1; },
    },
    querySelectorAll(sel) {
      if (sel === '*') return [];
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
