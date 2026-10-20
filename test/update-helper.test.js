'use strict';
// Runs scripts/update.sh against fake curl/systemctl/flock/npm so the swap, rollback and no-op paths are checked
// without touching the network or systemd. Needs bash + tar (skipped where they are missing, e.g. plain Windows).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'update.sh');
const hasBash = (() => { try { execFileSync('bash', ['-c', 'tar --version >/dev/null']); return true; } catch { return false; } })();
const toPosix = (p) => (process.platform === 'win32' ? p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`) : p);

const SHA_NEW = 'b'.repeat(40);
const SHA_OLD = 'a'.repeat(40);

function setup({ healthy = true, current = SHA_OLD, latest = SHA_NEW } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pidash-upd-'));
  const w = (rel, body, mode) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body, { mode }); return f; };
  // the "installed" app
  w('opt/pidash/package.json', '{"name":"pidash","version":"old"}');
  w('opt/pidash/server/index.js', '// old');
  w('opt/pidash/node_modules/dep/index.js', '// dep');
  if (current) w('opt/pidash/.version', JSON.stringify({ sha: current }));
  fs.mkdirSync(path.join(root, 'opt/pidash/scripts'), { recursive: true });
  // the tarball GitHub would serve: top folder like codeload's
  const src = path.join(root, 'srcpkg/pidash-' + latest);
  fs.mkdirSync(path.join(src, 'server'), { recursive: true });
  fs.mkdirSync(path.join(src, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(src, 'package.json'), '{"name":"pidash","version":"old"}'); // same deps -> node_modules reused
  fs.writeFileSync(path.join(src, 'server/index.js'), '// new');
  fs.writeFileSync(path.join(src, 'scripts/update.sh'), '#!/bin/sh\n# new helper\n');
  fs.mkdirSync(path.join(src, 'test'), { recursive: true });
  fs.writeFileSync(path.join(src, 'test/x.test.js'), '// excluded');
  execFileSync('tar', ['-czf', 'pkg.tgz', '-C', 'srcpkg', 'pidash-' + latest], { cwd: root });
  // fakes
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'calls.log');
  w('bin/curl', `#!/usr/bin/env bash
echo "curl $*" >> "${toPosix(log)}"
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -*) shift;; *) url="$1"; shift;; esac; done
case "$url" in
  *api.github.com*commits*) printf '${latest}';;
  *codeload.github.com*) cp "${toPosix(root)}/pkg.tgz" "$out";;
  *127.0.0.1*health*) [ -f "${toPosix(root)}/state/healthy" ] || exit 22;;
  *) exit 6;;
esac
`, 0o755);
  w('bin/systemctl', `#!/usr/bin/env bash
echo "systemctl $*" >> "${toPosix(log)}"
# "restart" brings the service up healthy only if the running app is the new one (or the old one after rollback)
if grep -q '// new' "${toPosix(root)}/opt/pidash/server/index.js"; then ${healthy ? 'touch' : 'rm -f'} "${toPosix(root)}/state/healthy"; else touch "${toPosix(root)}/state/healthy"; fi
`, 0o755);
  w('bin/flock', '#!/usr/bin/env bash\nexit 0\n', 0o755);
  w('bin/chown', '#!/usr/bin/env bash\nexit 0\n', 0o755);
  w('bin/sleep', '#!/usr/bin/env bash\nexit 0\n', 0o755);
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  w('etc/pidash.env', 'PORT=8099\n');
  w('home/update.request', '{}');
  w('etc/update.conf', [
    'REPO=Torresmi9294/pidash', 'BRANCH=main', `APP_DIR=${toPosix(root)}/opt/pidash`, `NODE_DIR=${toPosix(root)}/node`,
    `ENV_FILE=${toPosix(root)}/etc/pidash.env`, `REQUEST_FILE=${toPosix(root)}/home/update.request`,
    `STATE_DIR=${toPosix(root)}/run`, `HELPER_DST=${toPosix(root)}/helper/update.sh`, '',
  ].join('\n'));
  fs.mkdirSync(path.join(root, 'helper'), { recursive: true });
  fs.writeFileSync(path.join(root, 'helper/update.sh'), '# old helper');
  return { root, bin, log };
}

function run(env) {
  const r = spawnSync('bash', [toPosix(SCRIPT)], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${toPosix(env.bin)}:${process.env.PATH}`, PIDASH_UPDATE_CONF: `${toPosix(env.root)}/etc/update.conf`, HEALTH_TRIES: '3', HEALTH_SLEEP: '0', TMPDIR: toPosix(os.tmpdir()) },
  });
  const sf = path.join(env.root, 'run/status.json');
  if (!fs.existsSync(sf)) throw new Error(`helper wrote no status (exit ${r.status}): ${r.stderr}`);
  const status = JSON.parse(fs.readFileSync(sf, 'utf8'));
  return { ...r, status };
}
const read = (env, rel) => fs.readFileSync(path.join(env.root, rel), 'utf8');

test('update.sh installs the new version, keeps node_modules, refreshes itself and removes the request', { skip: !hasBash }, () => {
  const env = setup();
  const r = run(env);
  assert.strictEqual(r.status.state, 'done', r.stderr);
  assert.match(r.status.message, /bbbbbbb/);
  assert.strictEqual(read(env, 'opt/pidash/server/index.js'), '// new');
  assert.ok(fs.existsSync(path.join(env.root, 'opt/pidash/node_modules/dep/index.js')), 'node_modules reused');
  assert.ok(!fs.existsSync(path.join(env.root, 'opt/pidash/test')), 'tests are not installed');
  assert.strictEqual(JSON.parse(read(env, 'opt/pidash/.version')).sha, SHA_NEW);
  assert.ok(!fs.existsSync(path.join(env.root, 'opt/pidash.old')), 'backup removed after success');
  assert.ok(!fs.existsSync(path.join(env.root, 'home/update.request')), 'request consumed');
  assert.match(read(env, 'helper/update.sh'), /new helper/);
  assert.match(read(env, 'calls.log'), /systemctl restart pidash/);
});

test('update.sh rolls back when the new version never becomes healthy', { skip: !hasBash }, () => {
  const env = setup({ healthy: false });
  const r = run(env);
  assert.strictEqual(r.status.state, 'failed');
  assert.match(r.status.message, /previous version was restored/);
  assert.strictEqual(read(env, 'opt/pidash/server/index.js'), '// old');
  assert.strictEqual(JSON.parse(read(env, 'opt/pidash/.version')).sha, SHA_OLD);
  assert.ok(!fs.existsSync(path.join(env.root, 'opt/pidash.old')));
  assert.ok(!fs.existsSync(path.join(env.root, 'opt/pidash.failed')));
});

test('update.sh does nothing when already on the newest commit', { skip: !hasBash }, () => {
  const env = setup({ current: SHA_NEW });
  const r = run(env);
  assert.strictEqual(r.status.state, 'done');
  assert.match(r.status.message, /up to date/i);
  assert.strictEqual(read(env, 'opt/pidash/server/index.js'), '// old');
  assert.doesNotMatch(read(env, 'calls.log'), /systemctl/);
});

test('update.sh refuses a GitHub answer that is not a commit id', { skip: !hasBash }, () => {
  const env = setup({ latest: 'not-a-sha' });
  const r = run(env);
  assert.strictEqual(r.status.state, 'failed');
  assert.strictEqual(read(env, 'opt/pidash/server/index.js'), '// old');
});
