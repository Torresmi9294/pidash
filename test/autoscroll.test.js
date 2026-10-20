'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-scroll-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

// fit.js in a sandbox with a controllable animation-frame clock.
function load() {
  let queue = [];
  let now = 0;
  const ctx = {
    window: {},
    getComputedStyle: (n) => ({ overflowX: 'hidden', overflowY: 'hidden', webkitLineClamp: (n && n.clamp) || 'none' }),
    requestAnimationFrame: (cb) => { queue.push(cb); return queue.length; },
    cancelAnimationFrame: () => {},
  };
  vm.runInNewContext(pub('fit.js'), ctx);
  return {
    Fit: ctx.window.PidashFit,
    // advance the fake clock by `ms`, in ~16ms frames
    run(ms) {
      for (let t = 0; t < ms; t += 16) {
        now += 16;
        const due = queue; queue = [];
        due.forEach((cb) => cb(now));
      }
    },
  };
}

// A widget body whose content height scales with --u (natural px at scale 1) inside a cell of `client` px.
function body(natural, client, kids = []) {
  const st = { s: 1 };
  const b = {
    isConnected: true, clientHeight: client, clientWidth: 400, scrollWidth: 100, dataset: {}, children: [], scrollTop: 0,
    get scrollHeight() { return Math.round(natural * st.s); },
    style: { setProperty: (_k, v) => { st.s = parseFloat(/\*\s*([\d.]+)\)/.exec(v)[1]); }, removeProperty: () => { st.s = 1; } },
    querySelectorAll: () => kids, removeAttribute() {}, setAttribute() {}, hasAttribute: () => false, contains: (n) => n === b || kids.includes(n), st,
  };
  return b;
}
const scroll = (extra = {}) => ({ mode: 'fill', overflow: 'scroll', ...extra });

test('scroll: content that fits is just fitted (no scrolling, no animation)', () => {
  const { Fit, run } = load();
  const b = body(100, 400);
  assert.equal(Fit.card(b, scroll()), 1.6);
  run(10000);
  assert.equal(b.scrollTop, 0);
});

test('scroll: too much content stays readable (>= 0.9) and scrolls, pausing at the top first', () => {
  const { Fit, run } = load();
  const b = body(300, 100); // 2.5x too tall even at 0.9
  const s = Fit.card(b, scroll({ speed: 'medium' }));
  assert.equal(s, 0.9);
  assert.equal(b.dataset.fit, '0.90');
  run(2500);
  assert.equal(b.scrollTop, 0, 'resting at the top for the first 3s');
  run(2000); // 1.5s of movement at 35px/s
  assert.ok(b.scrollTop > 40 && b.scrollTop < 65, `expected ~52px, got ${b.scrollTop}`);
});

test('scroll: reaches the bottom, rests, then comes back up', () => {
  const { Fit, run } = load();
  const b = body(300, 100);
  Fit.card(b, scroll({ speed: 'very-fast' })); // 100px/s over (270 - 100) = 170px
  run(3000 + 1800);
  assert.equal(b.scrollTop, 170, 'at the bottom');
  run(2000);
  assert.equal(b.scrollTop, 170, 'resting at the bottom');
  run(3000);
  assert.ok(b.scrollTop < 170, 'heading back up');
  run(6000);
  assert.ok(b.scrollTop >= 0);
});

test('scroll: speed presets are faster in order, unknown values use medium', () => {
  const dist = (speed) => {
    const { Fit, run } = load();
    const b = body(1000, 100);
    Fit.card(b, scroll({ speed }));
    run(3000 + 2000);
    return b.scrollTop;
  };
  const d = ['very-slow', 'slow', 'medium', 'fast', 'very-fast'].map(dist);
  for (let i = 1; i < d.length; i++) assert.ok(d[i] > d[i - 1], `${i}: ${d}`);
  assert.ok(Math.abs(dist('bogus') - d[2]) < 3);
  assert.ok(Math.abs(dist(undefined) - d[2]) < 3);
});

test('scroll: a re-fit (data refresh, resize) keeps scrolling from where it was', () => {
  const { Fit, run } = load();
  const b = body(1000, 100);
  Fit.card(b, scroll());
  run(3000 + 3000);
  const before = b.scrollTop;
  assert.ok(before > 50);
  Fit.card(b, scroll());
  assert.equal(b.scrollTop, before, 'not reset to the top');
  run(500);
  assert.ok(b.scrollTop > before);
});

test('scroll: stops and resets when the widget no longer needs it, and when the option is turned off', () => {
  const { Fit, run } = load();
  const b = body(1000, 100);
  Fit.card(b, scroll());
  run(6000);
  assert.ok(b.scrollTop > 0);
  b.clientHeight = 5000; // a much bigger cell: everything fits
  Fit.card(b, scroll());
  assert.equal(b.scrollTop, 0);
  run(5000);
  assert.equal(b.scrollTop, 0);

  const c = body(1000, 100);
  Fit.card(c, scroll());
  run(6000);
  Fit.card(c, { mode: 'fill', overflow: 'trim' }); // back to hiding extras
  assert.equal(c.scrollTop, 0);
  run(5000);
  assert.equal(c.scrollTop, 0);
});

test('scroll: a hidden slide (no height) restarts from the top with a pause when it comes back', () => {
  const { Fit, run } = load();
  const b = body(1000, 100);
  Fit.card(b, scroll());
  run(6000);
  assert.ok(b.scrollTop > 0);
  b.clientHeight = 0; // another slide is showing
  run(100);
  assert.equal(b.scrollTop, 0);
  b.clientHeight = 100;
  run(2000);
  assert.equal(b.scrollTop, 0, 'pauses again before moving');
});

test('scroll: with fit set to off the widget keeps its size and still scrolls', () => {
  const { Fit, run } = load();
  const b = body(1000, 100);
  assert.equal(Fit.card(b, { mode: 'off', overflow: 'scroll', speed: 'fast' }), 1);
  run(3000 + 1000);
  assert.ok(b.scrollTop > 40);
});

test('scroll: only the element that hides content scrolls, and line-clamped text is left alone', () => {
  const { Fit, run } = load();
  const list = { ...body(600, 100), clamp: 'none', scrollTop: 0, children: [] };
  const title = { ...body(80, 40), clamp: '2', scrollTop: 0, children: [] };
  const b = body(100, 400, [list, title]); // the body itself fits; the list inside is cut off
  const s = Fit.card(b, scroll());
  assert.ok(s > 0);
  run(3000 + 2000);
  assert.ok(list.scrollTop > 0, 'the list scrolls');
  assert.equal(title.scrollTop, 0, 'a clamped title does not');
  assert.equal(b.scrollTop, 0, 'the body stays put');
});

test('scroll: default behaviour is unchanged (no overflow option = trim, nothing animates)', () => {
  const { Fit, run } = load();
  const b = body(300, 100);
  Fit.card(b, { mode: 'fill' });
  run(10000);
  assert.equal(b.scrollTop, 0);
});

test('settings: the display and admin offer the option; the server only accepts known values', async () => {
  const dash = pub('dash.js');
  assert.match(dash, /overflow: o\.overflow, speed: o\.scrollSpeed/);
  const admin = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8');
  assert.match(admin, /key: 'overflow'/);
  assert.match(admin, /key: 'scrollSpeed'/);

  const { createApp } = require('../server/app');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json' }, body: o.body && JSON.stringify(o.body) }).then((r) => r.json());
    const cfg = await j('/api/admin/config');
    cfg.widgets[0].options = { ...cfg.widgets[0].options, overflow: 'scroll', scrollSpeed: 'fast' };
    cfg.widgets[1].options = { ...cfg.widgets[1].options, overflow: 'explode', scrollSpeed: 'warp' };
    await j('/api/admin/config', { method: 'PUT', body: cfg });
    const w = (await j('/api/display')).widgets;
    assert.equal(w[0].options.overflow, 'scroll');
    assert.equal(w[0].options.scrollSpeed, 'fast');
    assert.equal(w[1].options.overflow, undefined);
    assert.equal(w[1].options.scrollSpeed, undefined);
  } finally {
    server.close();
  }
});
