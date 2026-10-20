'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-health-'));

const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server/app');

let server;
let base;
let token;
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const post = (body, headers = {}, qs = '') =>
  fetch(`${base}/api/health/ingest${qs}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const bearer = () => ({ authorization: `Bearer ${token}` });
const widgetData = async (id) => (await fetch(`${base}/api/widgets/${id}/data`)).json();

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await fetch(`${base}/api/admin/health/info`)).json()).token;
  // add a health widget (and a second person's widget)
  const cfg = await (await fetch(`${base}/api/admin/config`)).json();
  cfg.widgets.push({ id: 'health-1', type: 'health', enabled: true, slot: 'rotate', options: { stepGoal: 8000 } });
  cfg.widgets.push({ id: 'health-2', type: 'health', enabled: true, slot: 'rotate', options: { person: 'sam' } });
  await fetch(`${base}/api/admin/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg) });
});
test.after(() => server.close());

test('token is generated, long, and not leaked through the admin config', async () => {
  assert.match(token, /^[0-9a-f]{48}$/);
  const cfg = await (await fetch(`${base}/api/admin/config`)).json();
  assert.equal(JSON.stringify(cfg).includes(token), false);
});

test('ingest requires a valid token (bearer, x-api-key or ?token)', async () => {
  assert.equal((await post({ steps: 1 })).status, 401);
  assert.equal((await post({ steps: 1 }, { authorization: 'Bearer nope' })).status, 401);
  assert.equal((await post({ steps: 1000 }, bearer())).status, 200);
  assert.equal((await post({ steps: 1000 }, { 'x-api-key': token })).status, 200);
  assert.equal((await post({ steps: 1000 }, {}, `?token=${token}`)).status, 200);
});

test('rejects empty/unrecognized payloads and absurd values', async () => {
  assert.equal((await post({ hello: 'world' }, bearer())).status, 400);
  assert.equal((await post({ steps: 99999999 }, bearer())).status, 400);
  assert.equal((await post({ heartRate: 'fast' }, bearer())).status, 400);
});

test('simple payload shows up in the widget with goals, units and weekly steps', async () => {
  const r = await post({ steps: 8421, activeCalories: 420, exerciseMinutes: 32, restingHeartRate: 58, sleepMinutes: 432, distanceMi: 3.1, weightLb: 175 }, bearer());
  assert.equal(r.status, 200);
  const d = await widgetData('health-1');
  assert.equal(d.m.steps, 8421);
  assert.equal(d.m.sleepHours, 7.2);
  assert.equal(d.goals.steps, 8000);
  assert.equal(d.isToday, true);
  assert.equal(d.units.distance, 'mi');
  assert.equal(d.m.distance, 3.1);
  assert.equal(d.m.weight, 175);
  assert.equal(d.week.length, 7);
  assert.equal(d.week[6].steps, 8421);
});

test('metrics merge within a day and the latest value wins', async () => {
  await post({ steps: 9000 }, bearer());
  const d = await widgetData('health-1');
  assert.equal(d.m.steps, 9000);
  assert.equal(d.m.activeCalories, 420);
});

test('people are separate and an empty person shows setup help', async () => {
  const res = await fetch(`${base}/api/widgets/health-2/data`);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /No health data received yet for "sam"/);
  await post({ person: 'Sam', steps: 4321 }, bearer());
  assert.equal((await widgetData('health-2')).m.steps, 4321);
  assert.equal((await widgetData('health-1')).m.steps, 9000);
});

test('multi-day backfill via days[]', async () => {
  const y = new Date(Date.now() - 86400000);
  const yk = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  assert.equal((await post({ days: [{ date: yk, steps: 7777 }, { date: today, steps: 100 }] }, bearer())).status, 200);
  const d = await widgetData('health-1');
  assert.equal(d.week[5].steps, 7777);
});

test('Health Auto Export format is understood', async () => {
  const body = {
    data: {
      metrics: [
        { name: 'step_count', units: 'count', data: [{ date: `${today} 00:00:00 -0500`, qty: 12345 }] },
        { name: 'active_energy', units: 'kJ', data: [{ date: `${today} 00:00:00 -0500`, qty: 2092 }] },
        { name: 'heart_rate', units: 'count/min', data: [{ date: `${today} 00:00:00 -0500`, Min: 50, Avg: 71.4, Max: 150 }] },
        { name: 'weight_body_mass', units: 'kg', data: [{ date: `${today} 00:00:00 -0500`, qty: 80 }] },
        { name: 'sleep_analysis', units: 'hr', data: [{ date: `${today} 00:00:00 -0500`, asleep: 6.5 }] },
        { name: 'blood_oxygen_saturation', units: '%', data: [{ date: `${today} 00:00:00 -0500`, qty: 0.97 }] },
      ],
    },
  };
  assert.equal((await post(body, bearer())).status, 200);
  const d = await widgetData('health-1');
  assert.equal(d.m.steps, 12345);
  assert.equal(d.m.activeCalories, 500); // 2092 kJ
  assert.equal(d.m.heartRate, 71.4);
  assert.equal(d.m.sleepHours, 6.5);
  assert.equal(d.m.bloodOxygen, 97);
  assert.ok(Math.abs(d.m.weight - 176.4) < 0.1); // 80 kg in lb
});

test('regenerating the token invalidates the old one', async () => {
  const old = token;
  token = (await (await fetch(`${base}/api/admin/health/token`, { method: 'POST' })).json()).token;
  assert.notEqual(token, old);
  assert.equal((await post({ steps: 1 }, { authorization: `Bearer ${old}` })).status, 401);
  assert.equal((await post({ steps: 1234 }, bearer())).status, 200);
});

test('the admin Health tab carries the step-by-step iPhone Shortcuts walkthrough and the certificate help', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8');
  for (const needle of ['Step 1 - check your iPhone can reach PiDash', 'Step 2 - Apple Health with Shortcuts', 'Find Health Samples', 'Calculate Statistics', 'Get Contents of URL', 'Ask Before Running', 'If steps is greater than 0', 'Certificate Trust Settings', 'fullchain.pem']) {
    assert.ok(src.includes(needle), `missing: ${needle}`);
  }
  assert.ok(!src.includes('Option A - Shortcuts'), 'old one-paragraph instructions should be gone');
});
