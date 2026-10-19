'use strict';
// Team-logo proxy + cache. The browser asks PiDash for /api/logo and PiDash fetches the image
// server-side (sending ESPN cookies when needed, upgrading http->https, following redirects safely)
// and caches it on disk. That avoids hotlink/referrer blocks, mixed content and login-only images,
// and keeps logos working through short internet outages.
//
// Safety: only URLs that the ESPN widget itself returned for a widget are served (allow-list), private/
// loopback addresses are refused (also after redirects), responses must be images under 2 MB.
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const dns = require('dns').promises;
const config = require('./config');

const DIR = path.join(config.DATA_DIR, 'cache', 'logos');
const MAX_BYTES = 2 * 1024 * 1024;
const TTL = 7 * 86400e3;       // refetch after a week
const FAIL_TTL = 10 * 60e3;    // do not hammer a broken URL
const TIMEOUT = 10000;
const KEEP = 14 * 86400e3;     // delete cached files nobody has touched for two weeks
const ESPN_HOST = /(^|\.)(espn\.com|espncdn\.com|espn\.go\.com)$/i;

const allowed = new Map();  // widgetId -> { urls:Set, cookie:string }
const failures = new Map(); // cacheKey -> { at, reason }
let lookup = (host) => dns.lookup(host, { all: true });

function normalize(u) {
  let s = String(u || '').trim();
  if (s.startsWith('//')) s = `https:${s}`;
  try {
    const url = new URL(s);
    return /^https?:$/.test(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:') && net.isIPv4(v6.slice(7))) return isPrivateIp(v6.slice(7));
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

async function assertPublicHost(host) {
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('address not allowed');
    return;
  }
  const addrs = await lookup(host);
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('address not allowed');
}

function sniff(buf) {
  const head = buf.subarray(0, 16);
  if (head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (/<svg[\s>]/i.test(buf.subarray(0, 512).toString('utf8'))) return 'image/svg+xml';
  return '';
}

async function downloadOnce(url, cookie) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    await assertPublicHost(u.hostname.replace(/^\[|\]$/g, ''));
    const headers = { 'user-agent': 'Mozilla/5.0 PiDash/1.0', accept: 'image/*,*/*;q=0.5' };
    if (cookie && ESPN_HOST.test(u.hostname)) headers.cookie = cookie; // never sent to third-party hosts
    const res = await fetch(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('image too large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('image too large');
    const declared = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const type = sniff(buf) || (declared.startsWith('image/') ? declared : '');
    if (!type) throw new Error(`not an image (${declared || 'unknown type'})`);
    return { buf, type };
  }
  throw new Error('too many redirects');
}

// Prefer https for http:// logo URLs, fall back to the original if that fails.
async function download(url, cookie) {
  const tries = url.startsWith('http://') ? [`https://${url.slice(7)}`, url] : [url];
  let last;
  for (const t of tries) {
    try {
      return await downloadOnce(t, cookie);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

const keyFor = (url) => crypto.createHash('sha1').update(url).digest('hex');

function readCache(key) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(DIR, `${key}.json`), 'utf8'));
    return { ...meta, buf: fs.readFileSync(path.join(DIR, `${key}.bin`)) };
  } catch {
    return null;
  }
}

let lastPrune = 0;
function prune() {
  if (Date.now() - lastPrune < 6 * 3600e3) return;
  lastPrune = Date.now();
  try {
    for (const f of fs.readdirSync(DIR)) {
      const p = path.join(DIR, f);
      if (Date.now() - fs.statSync(p).mtimeMs > KEEP) fs.unlinkSync(p);
    }
  } catch { /* nothing cached yet */ }
}

function writeCache(key, type, buf) {
  fs.mkdirSync(DIR, { recursive: true });
  prune();
  fs.writeFileSync(path.join(DIR, `${key}.bin`), buf);
  fs.writeFileSync(path.join(DIR, `${key}.json`), JSON.stringify({ type, at: Date.now() }));
}

// Register the logo URLs a widget is allowed to serve (called by the ESPN widget on every refresh).
function allow(widgetId, urls, cookie = '') {
  allowed.set(widgetId, { urls: new Set(urls.map(normalize).filter(Boolean)), cookie });
}

function proxyUrl(widgetId, url) {
  const n = normalize(url);
  return n ? `/api/logo?w=${encodeURIComponent(widgetId)}&u=${encodeURIComponent(n)}` : '';
}

async function get(widgetId, rawUrl) {
  const url = normalize(rawUrl);
  const entry = allowed.get(widgetId);
  if (!url || !entry || !entry.urls.has(url)) {
    const e = new Error('logo not allowed');
    e.status = 403;
    throw e;
  }
  const key = keyFor(url);
  const cached = readCache(key);
  if (cached && Date.now() - cached.at < TTL) return cached;
  const failed = failures.get(key);
  if (failed && Date.now() - failed.at < FAIL_TTL) {
    if (cached) return cached;
    const e = new Error(failed.reason);
    e.status = 502;
    throw e;
  }
  try {
    const { buf, type } = await download(url, entry.cookie);
    writeCache(key, type, buf);
    failures.delete(key);
    return { buf, type, at: Date.now() };
  } catch (err) {
    failures.set(key, { at: Date.now(), reason: err.message });
    console.warn(`[logos] could not load ${url}: ${err.message}`);
    if (cached) return cached; // stale beats nothing
    err.status = 502;
    throw err;
  }
}

// Fetch logos ahead of time so the first paint has them and problems show up in the log.
async function warm(widgetId, urls) {
  const queue = [...new Set(urls)];
  const worker = async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      try { await get(widgetId, u); } catch { /* already logged */ }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

module.exports = { prune, allow, proxyUrl, get, warm, normalize, _internals: { isPrivateIp, sniff, setLookup: (fn) => { lookup = fn; }, reset: () => { allowed.clear(); failures.clear(); } } };
