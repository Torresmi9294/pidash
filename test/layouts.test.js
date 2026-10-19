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
