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
  assert.deepEqual(names.sort(), ['bottom', 'focus', 'grid', 'sidebar-left', 'sidebar-right', 'top']);
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
