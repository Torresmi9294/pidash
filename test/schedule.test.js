'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-sched-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../public/schedule.js');

// Local-time helper: 2026-10-19 is a Monday.
const at = (day, hh, mm = 0) => new Date(2026, 9, day, hh, mm);
const WEEKDAYS = [1, 2, 3, 4, 5];
const all = { enabled: true, rules: [{ days: [0, 1, 2, 3, 4, 5, 6], sleep: '22:30', wake: '06:30' }] };

test('sanitize: cleans times and days, drops unusable rules, applies defaults', () => {
  const s = S.sanitize({ enabled: true, rules: [
    { days: [1, '2', 2, 9, -1, 'x'], sleep: '6:05', wake: '22:00' },
    { days: [1], sleep: '25:00', wake: '06:00' },      // bad time
    { days: [], sleep: '22:00', wake: '06:00' },        // no days
    { days: [1], sleep: '22:00', wake: '22:00' },       // zero length
    'junk', null,
  ], mode: 'weird', touchMinutes: 9999 });
  assert.deepEqual(s.rules, [{ days: [1, 2], sleep: '06:05', wake: '22:00' }]);
  assert.equal(s.mode, 'off');
  assert.equal(s.touchMinutes, 240);
  assert.equal(s.touchWake, true);
  assert.equal(s.monitorOff, false);
  assert.equal(s.override, null);
  assert.deepEqual(S.sanitize(undefined).rules, []);
  assert.equal(S.sanitize({ rules: Array.from({ length: 30 }, () => ({ days: [1], sleep: '1:00', wake: '2:00' })) }).rules.length, 8);
  assert.equal(S.sanitize({ override: { mode: 'sleep', until: 'soon' } }).override, null);
  assert.deepEqual(S.sanitize({ override: { mode: 'awake', until: null } }).override, { mode: 'awake', until: null });
});

test('an overnight rule sleeps from evening into the next morning', () => {
  const asleep = (d) => S.status(all, d).asleep;
  assert.equal(asleep(at(19, 12)), false, 'midday awake');
  assert.equal(asleep(at(19, 22, 29)), false, 'one minute before sleeping');
  assert.equal(asleep(at(19, 22, 30)), true, 'at the sleep time');
  assert.equal(asleep(at(19, 23, 59)), true);
  assert.equal(asleep(at(20, 0, 0)), true, 'past midnight');
  assert.equal(asleep(at(20, 6, 29)), true);
  assert.equal(asleep(at(20, 6, 30)), false, 'at the wake time');
  assert.equal(asleep(at(20, 7, 0)), false);
});

test('a same-day rule sleeps within one day', () => {
  const nap = { enabled: true, rules: [{ days: [1], sleep: '13:00', wake: '15:00' }] };
  assert.equal(S.status(nap, at(19, 12, 59)).asleep, false);
  assert.equal(S.status(nap, at(19, 14)).asleep, true);
  assert.equal(S.status(nap, at(19, 15)).asleep, false);
  assert.equal(S.status(nap, at(20, 14)).asleep, false, 'Tuesday is not selected');
});

test('days of the week decide which evenings start a sleep (an overnight sleep belongs to the evening it starts)', () => {
  const weekdays = { enabled: true, rules: [{ days: WEEKDAYS, sleep: '22:00', wake: '06:00' }] };
  assert.equal(S.status(weekdays, at(23, 23)).asleep, true, 'Friday night sleeps');
  assert.equal(S.status(weekdays, at(24, 3)).asleep, true, 'and continues into Saturday morning');
  assert.equal(S.status(weekdays, at(24, 23)).asleep, false, 'Saturday night stays awake');
  assert.equal(S.status(weekdays, at(25, 3)).asleep, false, 'Sunday early morning is awake');
  assert.equal(S.status(weekdays, at(25, 23)).asleep, false, 'Sunday night stays awake');
  assert.equal(S.status(weekdays, at(26, 23)).asleep, true, 'Monday night sleeps');
});

test('several rules combine (weekday vs weekend times)', () => {
  const two = { enabled: true, rules: [
    { days: WEEKDAYS, sleep: '22:00', wake: '06:00' },
    { days: [0, 6], sleep: '00:30', wake: '09:00' },
  ] };
  assert.equal(S.status(two, at(24, 23)).asleep, false, 'Saturday 11 PM: still up');
  assert.equal(S.status(two, at(25, 1)).asleep, true, 'Sunday 1 AM: weekend rule');
  assert.equal(S.status(two, at(25, 8)).asleep, true, 'Sunday 8 AM: still asleep');
  assert.equal(S.status(two, at(25, 9)).asleep, false);
  assert.equal(S.status(two, at(21, 5)).asleep, true, 'Wednesday 5 AM: weekday rule');
});

test('disabled or empty schedules never sleep', () => {
  assert.deepEqual([S.status({ ...all, enabled: false }, at(19, 23)).asleep, S.status({ ...all, enabled: false }, at(19, 23)).source], [false, 'off']);
  assert.equal(S.status({ enabled: true, rules: [] }, at(19, 23)).asleep, false);
  assert.equal(S.status(undefined, at(19, 23)).asleep, false);
});

test('next change: when the display will next sleep or wake', () => {
  const a = S.status(all, at(19, 12));
  assert.equal(a.next, at(19, 22, 30).getTime());
  const b = S.status(all, at(19, 23));
  assert.equal(b.next, at(20, 6, 30).getTime());
  // adjacent rules: waking at 22:00 and sleeping again at 22:00 is not a change
  const touching = { enabled: true, rules: [{ days: [1], sleep: '20:00', wake: '22:00' }, { days: [1], sleep: '22:00', wake: '23:00' }] };
  assert.equal(S.status(touching, at(19, 21)).next, at(19, 23).getTime());
  // weekends only: from Monday the next sleep is Saturday evening
  const wk = { enabled: true, rules: [{ days: [6], sleep: '21:00', wake: '07:00' }] };
  assert.equal(S.status(wk, at(19, 12)).next, at(24, 21).getTime());
});

test('manual override beats the schedule until it ends', () => {
  const sleepNow = { ...all, override: { mode: 'sleep', until: at(19, 18).getTime() } };
  assert.deepEqual([S.status(sleepNow, at(19, 12)).asleep, S.status(sleepNow, at(19, 12)).source, S.status(sleepNow, at(19, 12)).next], [true, 'override', at(19, 18).getTime()]);
  assert.equal(S.status(sleepNow, at(19, 18, 1)).asleep, false, 'expired: the schedule is back in charge');
  assert.equal(S.status(sleepNow, at(19, 18, 1)).source, 'schedule');
  const stayUp = { ...all, override: { mode: 'awake', until: at(20, 2).getTime() } };
  assert.equal(S.status(stayUp, at(19, 23)).asleep, false, 'kept awake past the scheduled bedtime');
  assert.equal(S.status(stayUp, at(20, 2, 1)).asleep, true, 'then it goes to sleep');
  const forever = { enabled: false, rules: [], override: { mode: 'sleep', until: null } };
  assert.deepEqual([S.status(forever, at(19, 12)).asleep, S.status(forever, at(19, 12)).next], [true, null], 'works even with the schedule off');
});

test('sleepNowUntil: a manual sleep ends at the next scheduled wake-up', () => {
  assert.equal(S.sleepNowUntil(all, at(19, 12)), at(20, 6, 30).getTime(), 'awake now: sleeps through the coming night');
  assert.equal(S.sleepNowUntil(all, at(19, 23)), at(20, 6, 30).getTime(), 'already in a scheduled sleep: until it ends');
  assert.equal(S.sleepNowUntil({ enabled: false, rules: [] }, at(19, 12)), null, 'no schedule: until cancelled');
});

test('server and browser run the same file', () => {
  const ctx = { self: {}, window: {} };
  ctx.self = ctx.window;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'schedule.js'), 'utf8'), ctx);
  assert.equal(typeof ctx.window.PidashSchedule.status, 'function');
});

test('server: the schedule is validated on save and /api/sleep answers in the exact shape the kiosk script reads', async () => {
  const { createApp } = require('../server/app');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json' }, body: o.body && JSON.stringify(o.body) });
  try {
    const cfg = await (await j('/api/admin/config')).json();
    assert.equal(cfg.display.schedule.enabled, false, 'off by default');
    assert.equal(cfg.display.schedule.rules.length, 1, 'with a starter rule to edit');
    cfg.display.schedule = {
      enabled: true, mode: 'nonsense', monitorOff: true, touchMinutes: 5000,
      rules: [{ days: [1, 2, 99], sleep: '7:00', wake: '19:30' }, { days: [], sleep: '1:00', wake: '2:00' }, { days: [1], sleep: 'x', wake: '2:00' }],
    };
    await j('/api/admin/config', { method: 'PUT', body: cfg });
    const saved = (await (await j('/api/display')).json()).display.schedule;
    assert.deepEqual(saved.rules, [{ days: [1, 2], sleep: '07:00', wake: '19:30' }]);
    assert.equal(saved.mode, 'off');
    assert.equal(saved.touchMinutes, 240);
    assert.equal(saved.monitorOff, true);

    // an always-asleep schedule: every day, 00:00 to 23:59
    cfg.display.schedule = { enabled: true, monitorOff: true, rules: [{ days: [0, 1, 2, 3, 4, 5, 6], sleep: '00:00', wake: '23:59' }] };
    await j('/api/admin/config', { method: 'PUT', body: cfg });
    const text = await (await j('/api/sleep')).text();
    assert.match(text, /^\{"asleep":true,"monitorOff":true,"next":\d+\}$/, text);

    cfg.display.schedule = { enabled: false, monitorOff: false, rules: [] };
    await j('/api/admin/config', { method: 'PUT', body: cfg });
    assert.equal(await (await j('/api/sleep')).text(), '{"asleep":false,"monitorOff":false,"next":null}');
  } finally {
    server.close();
  }
});

test('display and kiosk are wired to the schedule', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  assert.match(read('public', 'index.html'), /<script src="\/schedule\.js"><\/script>/);
  assert.match(read('public', 'index.html'), /id="sleep"/);
  assert.match(read('public', 'admin', 'index.html'), /<script src="\/schedule\.js"><\/script>/);
  assert.match(read('public', 'dash.js'), /function initSleep\(\)/);
  assert.match(read('public', 'dash.js'), /PidashSchedule\.status\(sch, new Date\(\)\)/);
  assert.match(read('public', 'dash.css'), /html\[data-sleep\] #sleep/);
  assert.match(read('scripts', 'kiosk.sh'), /monitor-watch\.sh" "\$MODE" "\$\$"/);
  assert.match(read('scripts', 'install.sh'), /wlr-randr/);
  assert.match(read('public', 'admin', 'admin.js'), /schedule: viewSchedule/);
});
