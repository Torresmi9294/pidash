'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-rsso-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'widgets', 'rss', 'client.js'), 'utf8');

// The News widget's client script with a fake DOM, a controllable 1-second ticker and a seeded Math.random.
function load(seed = 1) {
  let def;
  const timers = [];
  let s = seed;
  const math = Object.create(null);
  for (const k of Object.getOwnPropertyNames(Math)) math[k] = Math[k];
  math.random = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const node = (tag, attrs, kids) => {
    const n = {
      tag, attrs: attrs || {}, children: kids.flat(Infinity).filter((k) => k != null && k !== false), style: {},
      classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, addEventListener() {}, isConnected: true, closest: () => null,
      replaceChildren(...k) { n.children = k.flat(Infinity); },
      get firstChild() { return n.children[0]; },
    };
    return n;
  };
  const h = (tag, attrs, ...kids) => node(tag, attrs, kids);
  const ctx = {
    Dash: { register: (_t, d) => { def = d; } }, Math: math, Date, Number, Map, Array, Object, String, Promise,
    setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: (id) => { if (id) timers[id - 1] = null; },
  };
  vm.runInNewContext(SRC, ctx);
  const el = node('div', {}, []);
  return {
    el,
    render: (items, options = {}) => def.render(el, { items, layout: 'slideshow' }, { h, options, slot: 'rotate' }),
    next: (seconds = 12) => { const t = timers[timers.length - 1]; for (let k = 0; k < seconds; k++) t(); },
    shown: (list) => (el._rssOrder ? el._rssOrder[el._rssIndex] : list[el._rssIndex].title),
  };
}
const stories = (n, image = '') => Array.from({ length: n }, (_, k) => ({ title: `Story ${k}`, summary: '', source: 'BBC', date: null, image }));
const secs = { itemSeconds: 12 };

test('news slideshow: the default plays the feed in order, round after round', () => {
  const t = load();
  const list = stories(4);
  t.render(list, { ...secs });
  const seen = [t.shown(list)];
  for (let k = 0; k < 7; k++) { t.next(); seen.push(t.shown(list)); }
  assert.deepEqual(seen, ['Story 0', 'Story 1', 'Story 2', 'Story 3', 'Story 0', 'Story 1', 'Story 2', 'Story 3']);
  assert.equal(t.el._rssOrder, null);
});

test('news slideshow: random plays every story once per round, not in feed order', () => {
  const t = load(7);
  const list = stories(8);
  t.render(list, { ...secs, order: 'random' });
  const round = [t.shown(list)];
  for (let k = 0; k < 7; k++) { t.next(); round.push(t.shown(list)); }
  assert.deepEqual([...round].sort(), list.map((x) => x.title).sort());
  assert.notDeepEqual(round, list.map((x) => x.title));
});

test('news slideshow: random reshuffles each round and never repeats the story that just played', () => {
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 99]) {
    const t = load(seed);
    const list = stories(5);
    t.render(list, { ...secs, order: 'random' });
    const seen = [t.shown(list)];
    for (let k = 0; k < 29; k++) { t.next(); seen.push(t.shown(list)); }
    for (let r = 0; r < 6; r++) assert.deepEqual(seen.slice(r * 5, r * 5 + 5).sort(), list.map((x) => x.title).sort(), `seed ${seed} round ${r}`);
    for (let k = 1; k < seen.length; k++) assert.notEqual(seen[k], seen[k - 1], `seed ${seed}: story ${k} repeats the one before`);
    assert.ok(new Set([0, 1, 2, 3, 4, 5].map((r) => seen.slice(r * 5, r * 5 + 5).join())).size > 1, `seed ${seed}: rounds differ`);
  }
});

test('news slideshow: a refresh keeps the shuffle and position; new stories join, gone ones leave', () => {
  const t = load(4);
  const list = stories(6);
  t.render(list, { ...secs, order: 'random' });
  t.next(); t.next();
  const before = t.el._rssOrder.slice();
  const index = t.el._rssIndex;
  t.render(list, { ...secs, order: 'random' });
  assert.deepEqual(t.el._rssOrder, before);
  assert.equal(t.el._rssIndex, index);
  t.render([...list.slice(1), { ...list[0], title: 'Brand new' }], { ...secs, order: 'random' });
  assert.ok(!t.el._rssOrder.includes('Story 0'));
  assert.ok(t.el._rssOrder.includes('Brand new'));
  assert.deepEqual(t.el._rssOrder.filter((x) => x !== 'Brand new'), before.filter((x) => x !== 'Story 0'));
});

test('news slideshow: stories without pictures are still skipped when others have one, and random respects that', () => {
  const t = load(3);
  const list = [...stories(3, 'https://img/x.jpg'), { title: 'No picture', summary: '', source: 'BBC', date: null, image: '' }];
  t.render(list, { ...secs, order: 'random' });
  assert.ok(!t.el._rssOrder.includes('No picture'));
  assert.equal(t.el._rssOrder.length, 3);
});

test('news slideshow: switching back to in-order clears the shuffle; the setting only shows for the slideshow layout', () => {
  const t = load();
  t.render(stories(5), { order: 'random' });
  assert.ok(t.el._rssOrder);
  t.render(stories(5), { order: 'newest' });
  assert.equal(t.el._rssOrder, null);

  const fields = require('../widgets/rss/server').meta.fields;
  const order = fields.find((x) => x.key === 'order');
  assert.deepEqual(order.options.map((o) => o.value), ['newest', 'random']);
  for (const k of ['order', 'itemSeconds', 'showTimer', 'showDots']) assert.deepEqual(fields.find((x) => x.key === k).showIf, { key: 'layout', value: 'slideshow' }, k);
  assert.equal(fields.find((x) => x.key === 'layout').rerender, true);
});
