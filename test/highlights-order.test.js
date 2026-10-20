'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-hlo-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'widgets', 'sports-highlights', 'client.js'), 'utf8');

// The widget's client script with a fake DOM, a controllable 1-second ticker and a seeded Math.random.
function load(seed = 1) {
  let def;
  const timers = [];
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const math = Object.create(null);
  for (const k of Object.getOwnPropertyNames(Math)) math[k] = Math[k];
  math.random = rnd;
  const node = (tag, attrs, kids) => {
    const n = {
      tag, attrs: attrs || {}, children: kids.flat(Infinity).filter((k) => k != null && k !== false), style: {},
      classList: { toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, isConnected: true, closest: () => null,
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
  const ids = () => (el._hlOrder ? el._hlOrder.slice() : null);
  return {
    el,
    render: (items, options = {}) => def.render(el, { items }, { h, options, slot: 'rotate' }),
    // advance the slideshow by one item (a full item duration of 1-second ticks)
    next: (seconds = 12) => { const t = timers[timers.length - 1]; for (let k = 0; k < seconds; k++) t(); },
    shown: (items) => (el._hlOrder ? el._hlOrder[el._hlIndex] : items[el._hlIndex].id),
    ids,
  };
}
const items = (n) => Array.from({ length: n }, (_, k) => ({ id: `s${k}`, type: 'story', headline: `Story ${k}`, description: '', image: '', published: null, league: 'NFL' }));
const itemSeconds = { itemSeconds: 12 };

test('order: the default plays the feed in order, round after round', () => {
  const t = load();
  const list = items(4);
  t.render(list, { ...itemSeconds });
  const seen = [t.shown(list)];
  for (let k = 0; k < 7; k++) { t.next(); seen.push(t.shown(list)); }
  assert.deepEqual(seen, ['s0', 's1', 's2', 's3', 's0', 's1', 's2', 's3']);
  assert.equal(t.el._hlOrder, null);
});

test('order: random plays every item once per round, in a different order from the feed', () => {
  const t = load(7);
  const list = items(8);
  t.render(list, { ...itemSeconds, order: 'random' });
  const round = [t.shown(list)];
  for (let k = 0; k < 7; k++) { t.next(); round.push(t.shown(list)); }
  assert.deepEqual([...round].sort(), list.map((x) => x.id).sort(), 'every item exactly once');
  assert.notDeepEqual(round, list.map((x) => x.id), 'not simply the feed order');
});

test('order: random reshuffles each round and never repeats the item that just played', () => {
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 99]) {
    const t = load(seed);
    const list = items(5);
    t.render(list, { ...itemSeconds, order: 'random' });
    const seen = [t.shown(list)];
    for (let k = 0; k < 29; k++) { t.next(); seen.push(t.shown(list)); }
    for (let r = 0; r < 6; r++) assert.deepEqual(seen.slice(r * 5, r * 5 + 5).sort(), list.map((x) => x.id).sort(), `seed ${seed} round ${r} plays each item once`);
    for (let k = 1; k < seen.length; k++) assert.notEqual(seen[k], seen[k - 1], `seed ${seed}: item ${k} repeats the one before`);
    const rounds = [0, 1, 2, 3, 4, 5].map((r) => seen.slice(r * 5, r * 5 + 5).join());
    assert.ok(new Set(rounds).size > 1, `seed ${seed}: rounds are not all the same order`);
  }
});

test('order: a data refresh keeps the shuffle and the current position; new stories join, old ones leave', () => {
  const t = load(4);
  const list = items(6);
  t.render(list, { ...itemSeconds, order: 'random' });
  t.next(); t.next();
  const before = t.ids();
  const index = t.el._hlIndex;
  t.render(list, { ...itemSeconds, order: 'random' }); // the 15-minute refresh redraws the widget
  assert.deepEqual(t.ids(), before, 'same order');
  assert.equal(t.el._hlIndex, index, 'same position');

  const changed = [...list.slice(1), { ...list[0], id: 'new1' }];
  t.render(changed, { ...itemSeconds, order: 'random' });
  assert.ok(!t.ids().includes('s0'), 'a story that left the feed is gone');
  assert.ok(t.ids().includes('new1'), 'a new story is added');
  assert.equal(t.ids().length, 6);
  assert.deepEqual(t.ids().filter((id) => id !== 'new1'), before.filter((id) => id !== 's0'), 'the others keep their shuffled order');
});

test('order: one item, or switching back to in-order, needs no shuffle', () => {
  const t = load();
  t.render(items(1), { order: 'random' });
  assert.equal(t.el._hlOrder, null);
  const t2 = load();
  t2.render(items(5), { order: 'random' });
  assert.ok(t2.el._hlOrder);
  t2.render(items(5), { order: 'newest' });
  assert.equal(t2.el._hlOrder, null);
});

test('order: the setting is offered, defaulting to in order', () => {
  const f = require('../widgets/sports-highlights/server').meta.fields.find((x) => x.key === 'order');
  assert.deepEqual(f.options.map((o) => o.value), ['newest', 'random']);
});
