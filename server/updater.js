'use strict';
// Update checking + the (unprivileged) request side of one-click updates.
//
// How installing works on a Pi: this web server runs as an unprivileged, sandboxed user and cannot change its own
// code. To install an update it only drops a request file. A small root-owned helper (scripts/update.sh, started by a
// systemd .path unit when that file appears) does the real work: it fetches the latest commit of the configured repo
// from GitHub (it ignores the contents of the request), verifies it, swaps the files, restarts the service, checks
// that the new version is healthy, and rolls back if not. Docker installs can't safely update themselves, so they
// are only told the command to run.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');

const REPO = process.env.PIDASH_REPO || 'Torresmi9294/pidash';
const BRANCH = process.env.PIDASH_BRANCH || 'main';
const ROOT = path.join(__dirname, '..');
const VERSION_FILE = process.env.PIDASH_VERSION_FILE || path.join(ROOT, '.version');
const UPDATE_DIR = process.env.PIDASH_UPDATE_DIR || path.dirname(config.DATA_DIR);
const REQUEST_FILE = path.join(UPDATE_DIR, 'update.request');
// Written by the root helper into its own root-owned directory (never into the service-writable data dir).
const STATUS_FILE = process.env.PIDASH_UPDATE_STATUS || '/run/pidash-update/status.json';
const HELPER_MARKER = process.env.PIDASH_UPDATE_HELPER || '/etc/systemd/system/pidash-update.path';
const CHECK_TTL = 6 * 3600e3;      // reuse a GitHub answer for six hours unless the user presses "Check now"
const MIN_FORCE_GAP = 15e3;        // ...and never hit GitHub more than once per 15s (60 requests/hour unauthenticated)
const STALE_RUNNING = 20 * 60e3;   // an update "in progress" for 20 minutes means the helper died

let cache = null; // { at, latest, changes, error, forSha }
let lastCall = 0;

function mode() {
  const m = process.env.PIDASH_INSTALL;
  return m === 'systemd' || m === 'docker' ? m : 'source';
}

const short = (sha) => (sha ? String(sha).slice(0, 7) : '');
const firstLine = (s) => String(s || '').split('\n')[0].slice(0, 200);

function currentVersion() {
  try {
    const v = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    if (v && /^[0-9a-f]{7,40}$/i.test(v.sha || '')) return { sha: v.sha, short: short(v.sha), date: v.date || null, installedAt: v.installedAt || null, from: 'file' };
  } catch { /* no version file */ }
  if (mode() === 'source' && fs.existsSync(path.join(ROOT, '.git'))) {
    try {
      const run = (args) => execFileSync('git', ['-C', ROOT, ...args], { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const sha = run(['rev-parse', 'HEAD']);
      if (/^[0-9a-f]{40}$/.test(sha)) return { sha, short: short(sha), date: run(['log', '-1', '--format=%cI']) || null, installedAt: null, from: 'git' };
    } catch { /* git missing or not a repo */ }
  }
  return null;
}

async function gh(pathname) {
  lastCall = Date.now();
  const res = await fetch(`https://api.github.com/repos/${REPO}${pathname}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'PiDash-updater', 'x-github-api-version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    const mins = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : null;
    const e = new Error(`GitHub is rate-limiting update checks${mins ? ` - try again in about ${mins} minute${mins === 1 ? '' : 's'}` : ''}.`);
    e.status = 429;
    throw e;
  }
  if (res.status === 404) {
    const e = new Error(`Could not find ${REPO} on GitHub (is it private or renamed?).`);
    e.status = 404;
    throw e;
  }
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}.`);
  return res.json();
}

async function fetchLatest(currentSha) {
  const c = await gh(`/commits/${encodeURIComponent(BRANCH)}`);
  const latest = {
    sha: c.sha,
    short: short(c.sha),
    message: firstLine(c.commit && c.commit.message),
    date: (c.commit && c.commit.committer && c.commit.committer.date) || (c.commit && c.commit.author && c.commit.author.date) || null,
    url: c.html_url || `https://github.com/${REPO}/commit/${c.sha}`,
  };
  let changes = [];
  let relation = null;
  if (currentSha && currentSha !== c.sha) {
    try {
      const cmp = await gh(`/compare/${currentSha}...${c.sha}`);
      relation = cmp.status; // ahead (GitHub is ahead of you), behind, diverged, identical
      changes = (cmp.commits || []).slice(-25).reverse().map((x) => ({ sha: short(x.sha), message: firstLine(x.commit && x.commit.message), date: (x.commit && x.commit.author && x.commit.author.date) || null }));
    } catch (e) {
      if (e.status !== 404) throw e; // 404: the installed commit is not on GitHub (a local build)
    }
  }
  return { latest, changes, relation };
}

function readHelperStatus() {
  try {
    const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    if (s.state === 'running' && s.at && Date.now() - Date.parse(s.at) > STALE_RUNNING) return { ...s, state: 'failed', message: 'The update helper stopped responding.' };
    return s;
  } catch {
    return null;
  }
}

function installBlocker() {
  const m = mode();
  if (m === 'docker') return { code: 'docker', text: 'PiDash is running in Docker, which cannot update itself. Run: docker compose pull && docker compose up -d' };
  if (m !== 'systemd') return { code: 'source', text: 'This is a development/source install. Update it with: git pull (then restart).' };
  if (!fs.existsSync(HELPER_MARKER)) return { code: 'no-helper', text: 'The update helper is not installed yet. Run this once on the Pi: cd ~/pidash && git pull && sudo ./scripts/install.sh' };
  if (!config.get().admin.password) return { code: 'no-password', text: 'Set an admin password on the Security tab first. One-click updates install code, so they are only offered to password-protected admins.' };
  const h = readHelperStatus();
  if (h && h.state === 'running') return { code: 'busy', text: 'An update is already running.' };
  if (fs.existsSync(REQUEST_FILE)) return { code: 'busy', text: 'An update has already been requested.' };
  return null;
}

// Everything the admin page needs. Never throws: problems are reported in `error`.
async function status({ force = false } = {}) {
  const cur = currentVersion();
  const stale = !cache || (cache.forSha || null) !== (cur ? cur.sha : null) || Date.now() - cache.at > CHECK_TTL;
  if (force ? Date.now() - lastCall > MIN_FORCE_GAP || !cache : stale) {
    try {
      const r = await fetchLatest(cur && cur.sha);
      cache = { at: Date.now(), forSha: cur ? cur.sha : null, error: null, ...r };
    } catch (e) {
      cache = { ...(cache || {}), at: Date.now(), forSha: cur ? cur.sha : null, error: e.message };
    }
  }
  const latest = cache && cache.latest ? cache.latest : null;
  let state = 'unknown';
  if (latest && cur) state = cur.sha === latest.sha ? 'up-to-date' : cache.relation === 'behind' ? 'ahead' : 'update-available';
  else if (latest && !cur) state = 'unknown-current';
  const blocker = installBlocker();
  return {
    mode: mode(),
    repo: REPO,
    branch: BRANCH,
    current: cur,
    latest,
    state,
    changes: (cache && cache.changes) || [],
    checkedAt: cache ? new Date(cache.at).toISOString() : null,
    error: (cache && cache.error) || null,
    canInstall: !blocker,
    blocker,
    helper: readHelperStatus(),
  };
}

function requestInstall() {
  const blocker = installBlocker();
  if (blocker) {
    const e = new Error(blocker.text);
    e.status = blocker.code === 'busy' ? 409 : blocker.code === 'no-password' ? 403 : 400;
    throw e;
  }
  fs.mkdirSync(UPDATE_DIR, { recursive: true });
  // The helper ignores the contents; this is only a trigger (and a breadcrumb for debugging).
  fs.writeFileSync(REQUEST_FILE, JSON.stringify({ requestedAt: new Date().toISOString() }), { mode: 0o644 });
  return { accepted: true };
}

module.exports = { status, requestInstall, currentVersion, mode, readHelperStatus, REQUEST_FILE, STATUS_FILE, _reset: () => { cache = null; lastCall = 0; } };
