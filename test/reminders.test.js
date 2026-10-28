'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-rem-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../server/store');

test('reminders: add, edit text and date, pin, finish and delete', () => {
  const a = store.addReminder({ text: '  Buy milk  ', due: '2030-01-02' });
  assert.equal(a.text, 'Buy milk');
  const b = store.updateReminder(a.id, { text: 'Buy oat milk', due: '2030-02-03' });
  assert.deepEqual([b.text, b.due], ['Buy oat milk', '2030-02-03']);
  assert.equal(store.updateReminder(a.id, { due: '' }).due, null, 'a date can be cleared');
  assert.equal(store.updateReminder(a.id, { starred: true }).starred, true);
  assert.equal(store.updateReminder(a.id, { done: true }).done, true);
  assert.equal(store.updateReminder('nope', { done: true }), null);
  assert.equal(store.deleteReminder(a.id), true);
  assert.equal(store.deleteReminder(a.id), false);
});

test('reminders: an edit cannot blank the text or store a malformed date, and a refused edit changes nothing', () => {
  const r = store.addReminder({ text: 'Keep me', due: '2030-01-02' });
  assert.throws(() => store.updateReminder(r.id, { text: '   ' }), /required/);
  assert.throws(() => store.updateReminder(r.id, { text: null }), /required/);
  assert.throws(() => store.updateReminder(r.id, { due: 'tomorrow' }), /2026-10-31/);
  assert.throws(() => store.addReminder({ text: 'x', due: '31/10/2026' }), /date/);
  const after = store.listReminders().find((x) => x.id === r.id);
  assert.deepEqual([after.text, after.due], ['Keep me', '2030-01-02']);
});

test('admin: replaceChildren is never given an array (the browser would print "[object HTMLDivElement]")', () => {
  // Node.replaceChildren(a, b, c) takes nodes as separate arguments. An array, or a ternary that can produce one, is turned into text.
  for (const file of [['public', 'admin', 'admin.js'], ['public', 'dash.js'], ...fs.readdirSync(path.join(__dirname, '..', 'widgets')).map((w) => ['widgets', w, 'client.js'])]) {
    const full = path.join(__dirname, '..', ...file);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    const bad = [...src.matchAll(/replaceChildren\(\s*(?!\.\.\.|h\()([A-Za-z_$][\w$.]*\.map\(|[A-Za-z_$][\w$.]*\s*\?[^;]*?\.map\()/g)].map((m) => m[0]);
    assert.deepEqual(bad, [], `${file.join('/')} passes an array to replaceChildren: ${bad.join(' | ')}`);
  }
  const admin = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8');
  assert.match(admin, /list\.replaceChildren\(\.\.\.\(items\.length \? items\.map\(row\)/);
  assert.match(admin, /'Edit'/);
  assert.match(admin, /ondblclick: startEdit/);
});
