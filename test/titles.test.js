'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-titles-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server/app');

let server;
let base;
const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json' }, body: o.body && JSON.stringify(o.body) }).then((r) => r.json());

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const withOptions = async (id, options) => {
  const cfg = await j('/api/admin/config');
  cfg.widgets.find((w) => w.id === id).options = options;
  await j('/api/admin/config', { method: 'PUT', body: cfg });
  return (await j('/api/display')).widgets.find((w) => w.id === id).options;
};

test('custom widget titles are saved, trimmed and length-limited', async () => {
  let o = await withOptions('calendar-1', { title: '   Family    Calendar  ' });
  assert.equal(o.title, 'Family Calendar');                       // whitespace collapsed + trimmed
  o = await withOptions('calendar-1', { title: 'x'.repeat(200) });
  assert.equal(o.title.length, 60);
  o = await withOptions('calendar-1', { title: '   ' });
  assert.equal('title' in o, false);                              // blank = default name again
  o = await withOptions('calendar-1', { title: "Brian's League \u{1F3C8}" });
  assert.equal(o.title, "Brian's League \u{1F3C8}");              // apostrophes and emoji are fine
});

test('hideTitle is a strict boolean and titles reach the display API', async () => {
  let o = await withOptions('weather-1', { hideTitle: 'yes please', location: 'Boston' });
  assert.equal(o.hideTitle, false);                               // only a real true counts
  o = await withOptions('weather-1', { hideTitle: true, title: 'Outside', location: 'Boston' });
  assert.equal(o.hideTitle, true);
  assert.equal(o.title, 'Outside');
});

test('titles are plain data: markup is never interpreted by the display', () => {
  // the title is placed with the safe DOM builder (textContent), never innerHTML
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'dash.js'), 'utf8');
  assert.ok(!/\.innerHTML\s*=/.test(js), 'no innerHTML assignments in the display runtime');
  assert.match(js, /h\('h2', \{ class: 'card-title' \}, titleText\)/);
});

test('every widget type can be renamed (the title fields are generic, not per-widget)', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8');
  assert.match(admin, /key: 'title', label: 'Title shown on this widget'/);
  assert.match(admin, /key: 'hideTitle', label: 'Hide the title bar'/);
});

test('admin tabs: Themes has its own tab (theme, background, night); Display keeps layout and basics', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8');
  assert.match(src, /const TABS = \{ widgets: 'Widgets', display: 'Display', themes: 'Themes', google:/);
  assert.match(src, /themes: viewThemes/);
  const fn = (name) => {
    const i = src.indexOf(`function ${name}() {`);
    assert.ok(i > 0, `${name} exists`);
    const j = src.indexOf('\n  }\n', i);
    return src.slice(i, j);
  };
  const themes = fn('viewThemes');
  const display = fn('viewDisplay');
  for (const h of ["'Theme'", "'Night'"]) assert.ok(themes.includes(`h('h2', {}, ${h})`), `Themes tab has ${h}`);
  assert.ok(themes.includes('backgroundPanel(d, F)'), 'Themes tab has the Background panel');
  for (const h of ["'Layout'", "'Display'"]) assert.ok(display.includes(`h('h2', {}, ${h})`), `Display tab has ${h}`);
  assert.ok(display.includes('paneEditor(d)'), 'Rotating Grid Panes stay with the layout');
  // nothing is duplicated across the two tabs
  for (const h of ["'Theme'", "'Night'"]) assert.ok(!display.includes(`h('h2', {}, ${h})`), `Display tab no longer has ${h}`);
  for (const h of ["'Layout'", "'Display'"]) assert.ok(!themes.includes(`h('h2', {}, ${h})`), `Themes tab does not have ${h}`);
  assert.ok(!display.includes('backgroundPanel'));
});
