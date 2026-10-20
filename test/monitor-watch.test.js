'use strict';
// Runs scripts/monitor-watch.sh once against fake curl/xset/wlr-randr/vcgencmd (skipped where bash is missing).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'monitor-watch.sh');
const hasBash = (() => { try { execFileSync('bash', ['-c', 'true']); return true; } catch { return false; } })();
const toPosix = (p) => (process.platform === 'win32' ? p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`) : p);

function run({ json, wayland = false, tools = ['xset', 'vcgencmd'], display = ':0' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pidash-mw-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(root, 'calls.log');
  const w = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  w('curl', json == null ? 'exit 22' : `printf '%s' '${json}'`);
  for (const t of tools) w(t, `echo "${t} $*" >> "${toPosix(log)}"`);
  if (tools.includes('wlr-randr')) w('wlr-randr', `echo "wlr-randr $*" >> "${toPosix(log)}"\nif [ $# -eq 0 ]; then printf 'HDMI-A-1 "Some Monitor"\\n  Enabled: yes\\nHDMI-A-2 "Other"\\n  Enabled: yes\\n'; fi`);
  const env = { ...process.env, PATH: `${toPosix(bin)}:${process.env.PATH}`, MONITOR_ONCE: '1', PIDASH_ENV: '/nonexistent', PIDASH_SLEEP_URL: 'http://x/api/sleep' };
  delete env.WAYLAND_DISPLAY;
  delete env.DISPLAY;
  if (wayland) env.WAYLAND_DISPLAY = 'wayland-0'; else if (display) env.DISPLAY = display;
  const r = spawnSync('bash', [toPosix(SCRIPT), 'desktop'], { encoding: 'utf8', env });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { r, calls };
}
const SLEEP = '{"asleep":true,"monitorOff":true,"next":1790000000000}';

test('monitor-watch: asleep + "switch the monitor off" powers the screen off (X11/DPMS)', { skip: !hasBash }, () => {
  const { r, calls } = run({ json: SLEEP });
  assert.match(r.stdout, /monitor off/);
  assert.ok(calls.includes('xset +dpms') && calls.includes('xset dpms force off'), calls.join(' | '));
  assert.ok(calls.includes('vcgencmd display_power 0'));
});

test('monitor-watch: asleep but the monitor option is off leaves the monitor on', { skip: !hasBash }, () => {
  const { r, calls } = run({ json: '{"asleep":true,"monitorOff":false,"next":null}' });
  assert.match(r.stdout, /monitor on/);
  assert.ok(calls.includes('xset dpms force on'));
  assert.ok(!calls.some((c) => /force off|display_power 0/.test(c)));
});

test('monitor-watch: awake switches the monitor on', { skip: !hasBash }, () => {
  const { calls, r } = run({ json: '{"asleep":false,"monitorOff":true,"next":null}' });
  assert.match(r.stdout, /monitor on/);
  assert.ok(calls.includes('xset dpms force on') && calls.includes('xset -dpms s reset'));
  assert.ok(calls.includes('vcgencmd display_power 1'));
});

test('monitor-watch: an unreachable server never leaves the screen off', { skip: !hasBash }, () => {
  const { r, calls } = run({ json: null });
  assert.match(r.stdout, /monitor on/);
  assert.ok(!calls.some((c) => /force off|display_power 0/.test(c)));
});

test('monitor-watch: on Wayland it uses wlr-randr for every output', { skip: !hasBash }, () => {
  const { calls } = run({ json: SLEEP, wayland: true, tools: ['wlr-randr', 'xset'] });
  assert.ok(calls.includes('wlr-randr --output HDMI-A-1 --off'), calls.join(' | '));
  assert.ok(calls.includes('wlr-randr --output HDMI-A-2 --off'));
  assert.ok(!calls.some((c) => c.startsWith('xset')), 'X tools are not used under Wayland');
  const back = run({ json: '{"asleep":false,"monitorOff":true,"next":null}', wayland: true, tools: ['wlr-randr'] });
  assert.ok(back.calls.includes('wlr-randr --output HDMI-A-1 --on'));
});

test('monitor-watch: stops when the browser it was started for is gone', { skip: !hasBash }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pidash-mw-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'curl'), '#!/usr/bin/env bash\nexit 22\n', { mode: 0o755 });
  const r = spawnSync('bash', [toPosix(SCRIPT), 'desktop', '999999'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: `${toPosix(bin)}:${process.env.PATH}`, PIDASH_ENV: '/nonexistent', MONITOR_INTERVAL: '1' } });
  assert.equal(r.status, 0, 'exits instead of looping forever');
  assert.doesNotMatch(r.stdout, /monitor/, 'and does nothing');
});
